"use client";

import "@xyflow/react/dist/style.css";
import { createId } from "@paralleldrive/cuid2";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Background,
  BaseEdge,
  MiniMap,
  NodeResizer,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  SelectionMode,
  type Viewport,
  useReactFlow,
} from "@xyflow/react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal,
  AlignStartVertical, BarChart3, Bookmark, ChartLine,
  Columns3, Copy, Database, Loader2, MapPin, Maximize2, Menu,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Pin, PinOff, Plus,
  Redo2, Rows3, Save, Search, Sigma, SlidersHorizontal, StickyNote, Trash2, TriangleAlert, Undo2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createMunicipalityAnalysis,
  createMunicipalityAnalysisAndRedirect,
  deleteMunicipalityAnalysis,
  renameMunicipalityAnalysis,
  saveMunicipalityAnalysisGraph,
  saveMunicipalityAnalysisNodeAsMetric,
} from "../actions";
import {
  ANALYSIS_OPERATION_VERSION,
  ANALYSIS_OPERATOR_SYMBOLS,
  analysisAnnotationColors,
  analysisNodeHeight,
  analysisNodeWidth,
  analysisOperatorIds,
  analysisSeriesToCsv,
  isUnaryAnalysisOperator,
  MAX_ANALYSIS_SHIFT_YEARS,
  MAX_ANALYSIS_NODE_HEIGHT,
  MAX_ANALYSIS_NODE_WIDTH,
  MIN_ANALYSIS_NODE_HEIGHT,
  MIN_ANALYSIS_NODE_WIDTH,
  MIN_ANALYSIS_NOTE_HEIGHT,
  MIN_ANALYSIS_NOTE_WIDTH,
  applyMunicipalityAnalysisGraphOperations,
  datasetMunicipalityName,
  evaluateAnalysisGraph,
  wouldCreateAnalysisCycle,
  type AnalysisOperatorId,
  type AnalysisAnnotationColor,
  type AnalysisSeries,
  type MunicipalityAnalysisData,
  type MunicipalityAnalysisGraph,
  type MunicipalityAnalysisGraphOperation,
  type MunicipalityDatasetRef,
} from "../analysis";
import { arrangeAnalysisNodes, autoLayoutAnalysisGraph, type AnalysisArrangeAction } from "../analysis-layout";
import { analysisEdgePath, analysisStubRoute, routeAnalysisEdge } from "../analysis-edge-routing";
import { loadMunicipalityAnalysisData, loadMunicipalityIndex } from "../analysis-data";
import { normalizeMunicipalitySearch, searchMunicipalities, type MunicipalityIndexItem } from "../data";
import type { MapMetric } from "../demography";
import type { MovementTargetId } from "../movement";
import type { PopulationViewId } from "../structure";
import {
  AUSGANGSDATEN_CATALOG,
  bindKennzahlInput,
  expandKennzahlIntoGraph,
  kennzahlExpressionFor,
  kennzahlFormulaText,
  KENNZAHL_CATALOG,
  type KennzahlExpression,
  type KennzahlInput,
} from "../kennzahlen";
import type { MunicipalityAnalysisSummary, MunicipalityMetricRecord } from "../queries";
import { AnalysisSeriesChart } from "./analysis-series-chart";
import { useMunicipalityAnalysisPersistence } from "./municipality-analysis-persistence-provider";

type AnalysisRecord = {
  id: string;
  name: string;
  graph: MunicipalityAnalysisGraph;
  updatedAt: number;
};

const OPERATOR_DRAG_TYPE = "application/x-municipality-analysis-operator";
/** Dragged like an operator, but drops a constant node. */
const CONSTANT_DRAG_VALUE = "constant";
/** How many edits back undo reaches. Each entry is a whole graph, capped at 100 nodes. */
const UNDO_DEPTH = 50;
// The node card is w-52 and roughly this tall — enough to tell whether a restored
// viewport still shows anything, which is all these are used for.
const NODE_WIDTH = 208;
const NODE_HEIGHT = 150;

/** "Bevölkerungsdichte · Steinfeld · 7 Knoten" — enough to tell two same-named ones apart. */
function analysisOptionLabel(analysis: MunicipalityAnalysisSummary, t: ReturnType<typeof useTranslations>) {
  return [analysis.name, analysis.municipalityName, t("analysisNodeCount", { count: analysis.nodeCount })]
    .filter(Boolean).join(" · ");
}

function seriesErrorLabel(error: AnalysisSeries["error"], t: ReturnType<typeof useTranslations>) {
  if (!error) return null;
  if (error === "missing-input") return t("analysisMissingInput");
  if (error === "incompatible-units") return t("analysisIncompatibleUnits");
  if (error === "no-common-years") return t("analysisNoCommonYears");
  return t("analysisMissingMunicipality");
}

type DisplayNodeData = {
  kind: "dataset" | "operator" | "annotation";
  title: string;
  technicalTitle: string;
  subtitle?: string;
  pinned?: boolean;
  /** Present on a dataset node: releases the pin, or pins it to the graph's subject. */
  togglePin?: { label: string; apply: () => void };
  symbol?: string;
  /** Constants and unary operators carry a number the reader edits on the node itself. */
  editor?: { value: number; label: string; min?: number; max?: number; step: number; commit: (value: number) => void };
  /** Unary operators read input A only, so B would be an input nothing can satisfy. */
  singleInput?: boolean;
  series: AnalysisSeries | null;
  errorLabel: string | null;
  warningLabel: string | null;
  rename?: (title: string | null) => void;
  annotation?: { text: string; color: AnalysisAnnotationColor; commit: (text: string, color: AnalysisAnnotationColor) => void };
};
type DisplayNode = Node<DisplayNodeData, "dataset" | "operator" | "annotation">;
type AnalysisEdgeData = { path: string; [key: string]: unknown };
type AnalysisDisplayEdge = Edge<AnalysisEdgeData, "analysis">;

const NOTE_STYLES: Record<AnalysisAnnotationColor, string> = {
  gray: "border-slate-300 bg-slate-50 text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50",
  sand: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50",
  blue: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-50",
  green: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50",
};

function AnalysisNodeCard({ data, selected }: NodeProps<DisplayNode>) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(data.title);

  const finishTitle = () => {
    const value = draftTitle.trim();
    data.rename?.(value && value !== data.technicalTitle ? value : null);
    setEditingTitle(false);
  };

  if (data.kind === "annotation" && data.annotation) {
    return (
      <div className={cn("h-full w-full cursor-grab rounded-xl border shadow-sm active:cursor-grabbing", NOTE_STYLES[data.annotation.color], selected && "ring-2 ring-teal-600/35")}>
        <NodeResizer isVisible={selected} minWidth={MIN_ANALYSIS_NOTE_WIDTH} minHeight={MIN_ANALYSIS_NOTE_HEIGHT} maxWidth={MAX_ANALYSIS_NODE_WIDTH} maxHeight={MAX_ANALYSIS_NODE_HEIGHT} color="var(--color-teal-600)" />
        <div className="flex h-full min-h-0 flex-col p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><StickyNote className="size-3.5" />{data.technicalTitle}</div>
          <Textarea
            key={data.annotation.text}
            className="nodrag mt-2 min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:ring-0"
            defaultValue={data.annotation.text}
            maxLength={2_000}
            aria-label={data.technicalTitle}
            onBlur={(event) => data.annotation?.commit(event.currentTarget.value, data.annotation.color)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex h-full w-full cursor-grab flex-col rounded-xl border bg-card shadow-sm transition-shadow active:cursor-grabbing",
      data.kind === "operator" ? "border-violet-200 dark:border-violet-900" : "border-teal-200 dark:border-teal-900",
      selected && "border-teal-600 ring-2 ring-teal-600/20",
    )}>
      <NodeResizer isVisible={selected} minWidth={MIN_ANALYSIS_NODE_WIDTH} minHeight={MIN_ANALYSIS_NODE_HEIGHT} maxWidth={MAX_ANALYSIS_NODE_WIDTH} maxHeight={MAX_ANALYSIS_NODE_HEIGHT} color="var(--color-teal-600)" />
      {data.kind === "operator" && (
        <>
          <Handle type="target" id="a" position={Position.Left} style={{ top: data.singleInput ? "50%" : "38%" }} />
          {!data.singleInput && <Handle type="target" id="b" position={Position.Left} style={{ top: "72%" }} />}
          <span className="pointer-events-none absolute left-2 top-[32%] text-[9px] font-bold text-violet-700 dark:text-violet-300">A</span>
          {!data.singleInput && <span className="pointer-events-none absolute left-2 top-[66%] text-[9px] font-bold text-violet-700 dark:text-violet-300">B</span>}
        </>
      )}
      <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
        {data.kind === "dataset" ? <Database className="size-4 shrink-0 text-teal-700 dark:text-teal-300" /> : <span className="grid size-5 shrink-0 place-items-center rounded-md bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{data.symbol}</span>}
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              className="nodrag h-6 w-full rounded border bg-background px-1.5 text-xs font-semibold"
              value={draftTitle}
              maxLength={120}
              aria-label={data.technicalTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={finishTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { setDraftTitle(data.title); setEditingTitle(false); }
              }}
            />
          ) : (
            <button
              type="button"
              className="nodrag block max-w-full truncate text-left text-xs font-semibold"
              onDoubleClick={() => { setDraftTitle(data.title); setEditingTitle(true); }}
              onKeyDown={(event) => { if (event.key === "Enter") { setDraftTitle(data.title); setEditingTitle(true); } }}
              title={data.title}
            >{data.title}</button>
          )}
          <p className={cn("flex items-center gap-1 truncate text-[10px]", data.pinned ? "text-foreground" : "text-muted-foreground")}>
            {/* The pin is the control, not a badge: a node that arrived from the map is
                pinned, and releasing it here is what makes it follow the graph's subject. */}
            {data.togglePin ? (
              <button
                type="button"
                className="nodrag grid size-4 shrink-0 place-items-center rounded hover:bg-accent"
                aria-label={data.togglePin.label}
                title={data.togglePin.label}
                onClick={(event) => { event.stopPropagation(); data.togglePin?.apply(); }}
              >
                {data.pinned ? <Pin className="size-2.5" /> : <PinOff className="size-2.5" />}
              </button>
            ) : data.pinned && <Pin className="size-2.5 shrink-0" />}
            <span className="truncate">{data.title !== data.technicalTitle ? data.technicalTitle : data.subtitle}</span>
          </p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2.5 py-2">
        {data.editor && (
          <input
            type="number"
            className="nodrag mb-2 h-8 w-full cursor-text rounded-lg border bg-background px-2 text-xs"
            aria-label={data.editor.label}
            min={data.editor.min}
            max={data.editor.max}
            step={data.editor.step}
            // Uncontrolled: the value settles on blur or Enter, so a half-typed "-" or
            // an empty field is never pushed into the graph. Keyed on the committed value
            // so a clamped or discarded entry does not keep standing in the field.
            key={data.editor.value}
            defaultValue={data.editor.value}
            onBlur={(event) => data.editor?.commit(Number(event.target.value))}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        )}
        {data.errorLabel ? (
          <p className="flex min-h-14 items-center gap-1.5 text-[11px] text-destructive"><TriangleAlert className="size-4 shrink-0" />{data.errorLabel}</p>
        ) : data.series ? (
          <div className="min-h-14 flex-1"><AnalysisSeriesChart series={data.series} label={data.title} compact trueLabel="1" falseLabel="0" /></div>
        ) : <div className="h-14 animate-pulse rounded-md bg-muted" />}
        {data.warningLabel && <p className="mt-1 truncate text-[10px] text-amber-700 dark:text-amber-300">{data.warningLabel}</p>}
      </div>
      <Handle type="source" id="output" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { dataset: AnalysisNodeCard, operator: AnalysisNodeCard, annotation: AnalysisNodeCard };

function ObstacleAvoidingEdge({ data, sourceX, sourceY, targetX, targetY, style, markerEnd, markerStart, interactionWidth }: EdgeProps<AnalysisDisplayEdge>) {
  return (
    <BaseEdge
      path={data?.path ?? `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`}
      style={style}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  );
}

const edgeTypes = { analysis: ObstacleAvoidingEdge };

// Exhaustive maps rather than ternary chains: a new Ausgangsdatum then fails to compile
// instead of silently borrowing the label of whatever the chain fell through to.
const POPULATION_VIEW_KEYS: Record<PopulationViewId, string> = {
  count: "populationCount", density: "populationDensity", "foreign-share": "populationForeignShare",
  "foreign-persons": "populationForeignPersons", "structure-population": "populationStructurePopulation",
};
const MOVEMENT_KEYS: Record<MovementTargetId, string> = {
  "population-change": "movementPopulationChange", births: "movementBirths", deaths: "movementDeaths",
  "birth-rate": "movementBirthRate", "death-rate": "movementDeathRate", "birth-balance-rate": "movementBirthBalanceRate",
  arrivals: "movementArrivals", departures: "movementDepartures",
  "migration-balance-rate": "movementMigrationBalanceRate",
  "international-migration-balance": "movementInternationalBalance",
  "international-migration-balance-rate": "movementInternationalBalanceRate",
  "internal-migration-balance": "movementInternalBalance",
  "internal-migration-balance-rate": "movementInternalBalanceRate",
  "statistical-correction": "movementStatisticalCorrection",
  "international-arrivals": "movementInternationalArrivals",
  "international-departures": "movementInternationalDepartures",
  "internal-arrivals": "movementInternalArrivals",
  "internal-departures": "movementInternalDepartures",
};

function datasetTitle(dataset: MunicipalityDatasetRef | KennzahlInput, t: ReturnType<typeof useTranslations>) {
  if (dataset.kind === "constant") return String(dataset.value);
  if (dataset.kind === "attribute") return t("attributeArea");
  if (dataset.kind === "cost-share") {
    const measure = dataset.measure ?? "share";
    const measureKey = measure === "absolute" ? "costMeasureAbsolute" : measure === "share" ? "costMeasureShare" : measure === "per-capita" ? "costMeasurePerCapita" : measure === "real-per-capita" ? "costMeasureRealPerCapita" : "costMeasurePeerDeviation";
    const categoryLabel = dataset.category === "total" ? t("costCategoryTotal") : t(`costCategory${dataset.category}` as "costCategory0");
    return `${t("metricCosts")} · ${categoryLabel} · ${t(measureKey)}`;
  }
  if (dataset.kind === "population") return t(POPULATION_VIEW_KEYS[dataset.view] as "populationCount");
  if (dataset.kind === "movement") return t(MOVEMENT_KEYS[dataset.metric] as "movementBirths");
  if (dataset.kind === "age-group") {
    const groupLabel = dataset.ageGroup === "total"
      ? t("ageGroupTotal")
      : t(`ageGroup${dataset.ageGroup}` as "ageGroup0-5");
    return `${groupLabel} · ${t(dataset.measure === "share" ? "ageMeasureShare" : "ageMeasurePersons")}`;
  }
  const key = dataset.indicator === "youth-share" ? "indicatorYouthShare" : dataset.indicator === "senior-share" ? "indicatorSeniorShare" : dataset.indicator === "old-age-dependency" ? "indicatorOldAgeDependency" : dataset.indicator === "child-dependency" ? "indicatorChildDependency" : dataset.indicator === "total-dependency" ? "indicatorTotalDependency" : dataset.indicator === "aging-index" ? "indicatorAgingIndex" : dataset.indicator === "average-age" ? "indicatorAverageAge" : dataset.indicator === "women-share" ? "indicatorWomenShare" : "indicatorWomenPer100Men";
  return t(key);
}

/** Search-and-pick over the municipality index, used wherever one has to be chosen. */
function MunicipalityPicker({
  label,
  placeholder,
  compact = false,
  onPick,
}: {
  label: string;
  placeholder: string;
  compact?: boolean;
  onPick: (municipality: MunicipalityIndexItem) => void;
}) {
  const [municipalities, setMunicipalities] = useState<MunicipalityIndexItem[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadMunicipalityIndex()
      .then((index) => { if (!cancelled) setMunicipalities(index.municipalities); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(
    () => (query.trim() ? searchMunicipalities(municipalities, query).slice(0, 6) : []),
    [municipalities, query],
  );

  return (
    <div className="relative">
      <Input
        className={cn(compact && "h-8 text-xs")}
        value={query}
        maxLength={80}
        aria-label={label}
        placeholder={placeholder}
        onValueChange={(value) => setQuery(value)}
      />
      {results.length > 0 && (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 grid gap-0.5 rounded-lg border bg-background p-1 shadow-lg">
          {results.map((item) => (
            <button
              key={item.municipalityCode}
              type="button"
              className={cn("truncate rounded-md px-2 py-1 text-left hover:bg-accent", compact ? "text-[11px]" : "text-sm")}
              onClick={() => { onPick(item); setQuery(""); }}
            >
              {item.name} · {item.municipalityCode}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type CatalogVariant = "sidebar" | "page";

/** One line of either catalog: what it is called, and what it is made of. */
type CatalogEntry = {
  id: string;
  category: MapMetric;
  label: string;
  /** The derivation, or null for an Ausgangsdatum, which is read straight from a file. */
  formula: string | null;
  dataset: MunicipalityDatasetRef;
  /** False for a Kennzahl the app computes directly: it is listed, but cannot be opened. */
  derivable: boolean;
};

function CatalogRow({
  entry,
  variant,
  openLabel,
  onOpen,
}: {
  entry: CatalogEntry;
  variant: CatalogVariant;
  openLabel: string;
  onOpen: () => void;
}) {
  const page = variant === "page";
  return (
    <button
      type="button"
      aria-label={`${entry.label} — ${openLabel}`}
      className={cn(
        "rounded-lg border bg-background text-left hover:border-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950",
        page ? "px-3 py-2" : "px-2 py-1.5",
      )}
      onClick={onOpen}
    >
      <span className="flex items-center gap-1.5">
        {entry.formula === null
          ? <Database className={cn("shrink-0 text-teal-700 dark:text-teal-300", page ? "size-4" : "size-3")} />
          : <Sigma className={cn("shrink-0 text-teal-700 dark:text-teal-300", page ? "size-4" : "size-3")} />}
        <span className={cn("font-medium", page ? "text-sm" : "text-[11px]")}>{entry.label}</span>
      </span>
      {/* Never truncated: a formula cut off after three terms is not a derivation. */}
      {entry.formula !== null && (
        <span className={cn("mt-1 block break-words text-muted-foreground", page ? "text-xs leading-5" : "text-[10px] leading-4")}>
          {entry.formula}
        </span>
      )}
    </button>
  );
}

/** A Kennzahl the app cannot derive — shown so the reader knows it exists, not clickable. */
function CatalogNote({ label, note, variant }: { label: string; note: string; variant: CatalogVariant }) {
  const page = variant === "page";
  return (
    <div className={cn("rounded-lg border border-dashed bg-muted/20 px-2 py-1.5", page && "px-3 py-2")}>
      <p className={cn("font-medium", page ? "text-sm" : "text-[11px]")}>{label}</p>
      <p className={cn("mt-0.5 text-muted-foreground", page ? "text-xs" : "text-[10px]")}>{note}</p>
    </div>
  );
}

/**
 * Everything the analysis can read: the Ausgangsdaten straight out of the data files, and
 * the Kennzahlen with the formula they are built from. Clicking an entry puts it on the
 * canvas — an Ausgangsdatum as one node, a Kennzahl as its whole derivation in real nodes,
 * so the way it is calculated is something you can read and edit rather than take on trust.
 *
 * Neither list needs a municipality; only putting one on a canvas does.
 */
function DatasetCatalog({
  variant,
  ownMetrics = [],
  onOpen,
}: {
  variant: CatalogVariant;
  ownMetrics?: MunicipalityMetricRecord[];
  onOpen: (request: { label: string; dataset: MunicipalityDatasetRef }) => void;
}) {
  const t = useTranslations("municipalities");
  const format = useFormatter();
  const page = variant === "page";
  const [query, setQuery] = useState("");

  const describe = useCallback((expression: KennzahlExpression) =>
    kennzahlFormulaText(expression, (input) => datasetTitle(input, t), (value) => format.number(value)), [format, t]);

  const sections = useMemo(() => {
    const group = (entries: CatalogEntry[]) => {
      const byCategory = new Map<MapMetric, CatalogEntry[]>();
      for (const entry of entries) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
      return [...byCategory];
    };
    return {
      ausgangsdaten: group(AUSGANGSDATEN_CATALOG.map(({ id, category, output }) => ({
        id, category, label: datasetTitle(output, t), formula: null,
        dataset: bindKennzahlInput(output), derivable: true,
      }))),
      kennzahlen: group(KENNZAHL_CATALOG.map(({ id, category, labelKey, output }) => {
        const expression = kennzahlExpressionFor(output);
        return {
          id, category,
          label: t(labelKey as "populationDensity"),
          formula: expression ? describe(expression) : null,
          dataset: bindKennzahlInput(output),
          derivable: expression !== null,
        };
      })),
    };
  }, [describe, t]);

  const needle = normalizeMunicipalitySearch(query);
  const matches = (entry: CatalogEntry) => !needle
    || normalizeMunicipalitySearch(`${entry.label} ${entry.formula ?? ""}`).includes(needle);
  const filter = (groups: ReadonlyArray<readonly [MapMetric, CatalogEntry[]]>) => groups
    .map(([category, entries]) => [category, entries.filter(matches)] as const)
    .filter(([, entries]) => entries.length > 0);

  const categoryLabel = (category: MapMetric) => t(
    (category === "population" ? "metricPopulation"
      : category === "age" ? "metricAge"
        : category === "movement" ? "metricMovement"
          : category === "costs" ? "metricCosts"
            : category === "politics" ? "metricPolitics"
              : category === "digital" ? "metricDigital" : "metricCustom") as "metricPopulation",
  );

  const visibleAusgangsdaten = filter(sections.ausgangsdaten);
  const visibleKennzahlen = filter(sections.kennzahlen);
  const visibleOwn = ownMetrics.filter(({ name, expression }) =>
    !needle || normalizeMunicipalitySearch(`${name} ${describe(expression)}`).includes(needle));
  const empty = !visibleAusgangsdaten.length && !visibleKennzahlen.length && !visibleOwn.length;

  const renderGroups = (groups: ReturnType<typeof filter>) => groups.map(([category, entries]) => (
    <div key={category}>
      <h3 className={cn("font-semibold text-muted-foreground", page ? "text-xs tracking-wide uppercase" : "text-[10px] uppercase")}>
        {categoryLabel(category)}
      </h3>
      <div className={cn("mt-1.5 grid gap-1.5", page && "sm:grid-cols-2 xl:grid-cols-3")}>
        {entries.map((entry) => !entry.derivable
          ? <CatalogNote key={entry.id} label={entry.label} note={t("kennzahlPrimary")} variant={variant} />
          : (
            <CatalogRow
              key={entry.id}
              entry={entry}
              variant={variant}
              openLabel={t("kennzahlOpenAsGraph")}
              // Open, not pinned: the derivation is the same everywhere, and which
              // municipality it is read for is the graph's business.
              onOpen={() => onOpen({ label: entry.label, dataset: entry.dataset })}
            />
          ))}
      </div>
    </div>
  ));

  return (
    <section className={cn(page ? "" : "mt-3 border-t pt-3")} data-testid="kennzahl-catalog">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={cn("font-semibold", page ? "text-xl" : "text-xs tracking-wide uppercase")}>
          {page ? t("catalogTitle") : t("catalog")}
        </h2>
        <span className={cn("text-muted-foreground", page ? "text-sm" : "text-[10px]")}>
          {page ? t("catalogDescription") : t("kennzahlCatalogHint")}
        </span>
      </div>

      <div className="relative mt-2">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className={cn("pl-7", page ? "max-w-sm" : "h-8 text-xs")}
          value={query}
          maxLength={80}
          aria-label={t("catalogSearch")}
          placeholder={t("catalogSearch")}
          onValueChange={(value) => setQuery(value)}
        />
      </div>

      <div className={cn("mt-3 grid", page ? "gap-5" : "gap-2.5")}>
        {empty && <p className={cn("text-muted-foreground", page ? "text-sm" : "text-[10px]")}>{t("catalogNoMatches")}</p>}

        {visibleAusgangsdaten.length > 0 && (
          <div className={page ? "grid gap-5" : "grid gap-2.5"}>
            <h3 className={cn("font-semibold", page ? "text-sm tracking-wide uppercase" : "text-[10px] tracking-wide uppercase")}>
              {t("dataKindBase")}
            </h3>
            {renderGroups(visibleAusgangsdaten)}
          </div>
        )}

        {visibleKennzahlen.length > 0 && (
          <div className={page ? "grid gap-5" : "grid gap-2.5"}>
            <h3 className={cn("font-semibold", page ? "text-sm tracking-wide uppercase" : "text-[10px] tracking-wide uppercase")}>
              {t("dataKindDerived")}
            </h3>
            {renderGroups(visibleKennzahlen)}
          </div>
        )}

        {visibleOwn.length > 0 && (
          <div>
            <h3 className={cn("font-semibold text-muted-foreground", page ? "text-xs tracking-wide uppercase" : "text-[10px] uppercase")}>
              {t("kennzahlOwnSection")}
            </h3>
            <div className={cn("mt-1.5 grid gap-1.5", page && "sm:grid-cols-2 xl:grid-cols-3")}>
              {visibleOwn.map((metric) => (
                <div key={metric.id} className={cn("rounded-lg border bg-background", page ? "px-3 py-2" : "px-2 py-1.5")}>
                  <p className={cn("font-medium", page ? "text-sm" : "text-[11px]")}>{metric.name}</p>
                  <p className={cn("mt-1 break-words text-muted-foreground", page ? "text-xs leading-5" : "text-[10px] leading-4")}>
                    {describe(metric.expression)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const OPERATOR_GROUPS: Array<{ key: "arithmetic" | "comparison" | "logic" | "utility"; operators: AnalysisOperatorId[] }> = [
  { key: "arithmetic", operators: ["add", "subtract", "multiply", "divide"] },
  { key: "comparison", operators: ["greater-than", "greater-or-equal", "less-than", "less-or-equal", "equal", "not-equal"] },
  { key: "logic", operators: ["and", "or"] },
  { key: "utility", operators: ["shift"] },
];

function StudioPalette({
  metrics,
  onOperator,
  onConstant,
  onAnnotation,
  onDataset,
}: {
  metrics: MunicipalityMetricRecord[];
  onOperator: (operator: AnalysisOperatorId) => void;
  onConstant: () => void;
  onAnnotation: () => void;
  onDataset: (request: { label: string; dataset: MunicipalityDatasetRef }) => void;
}) {
  const t = useTranslations("municipalities");
  return (
    <Tabs defaultValue="data" className="min-h-0 flex-1">
      <TabsList className="grid h-9 w-full grid-cols-2">
        <TabsTrigger value="data"><Database className="size-3.5" />{t("studioData")}</TabsTrigger>
        <TabsTrigger value="blocks"><Sigma className="size-3.5" />{t("studioBlocks")}</TabsTrigger>
      </TabsList>
      <TabsContent value="data" className="min-h-0 overflow-y-auto pr-1">
        <DatasetCatalog variant="sidebar" ownMetrics={metrics} onOpen={onDataset} />
      </TabsContent>
      <TabsContent value="blocks" className="min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-4 py-3">
          {OPERATOR_GROUPS.map((group) => (
            <section key={group.key}>
              <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t(`studioOperatorGroup_${group.key}`)}</h3>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {group.operators.map((operator) => (
                  <button
                    key={operator}
                    type="button"
                    draggable
                    className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2 text-left text-xs font-medium hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950"
                    title={t(`operator_${operator}`)}
                    aria-label={t("addOperator", { operator: t(`operator_${operator}`) })}
                    onClick={() => onOperator(operator)}
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(OPERATOR_DRAG_TYPE, operator); }}
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-violet-100 font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{ANALYSIS_OPERATOR_SYMBOLS[operator]}</span>
                    <span className="truncate">{t(`operator_${operator}`)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <section>
            <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("studioOperatorGroup_inputs")}</h3>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {/* Draggable like the operators beside it: the drop handler has always
                  accepted a constant, but nothing offered one to drag. */}
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                draggable
                aria-label={t("addConstant")}
                onClick={onConstant}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(OPERATOR_DRAG_TYPE, CONSTANT_DRAG_VALUE); }}
              ><span className="font-mono text-xs">123</span>{t("constantNode")}<span className="sr-only">{t("addConstant")}</span></Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={onAnnotation}><StickyNote className="size-3.5" />{t("studioNote")}</Button>
            </div>
          </section>
          <p className="text-[10px] leading-4 text-muted-foreground">{t("analysisUnitRule")}</p>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function AnalysisEditor({ analysis, analyses, metrics }: { analysis: AnalysisRecord; analyses: MunicipalityAnalysisSummary[]; metrics: MunicipalityMetricRecord[] }) {
  const t = useTranslations("municipalities");
  const format = useFormatter();
  const router = useRouter();
  const reactFlow = useReactFlow<DisplayNode, Edge>();
  const { enqueue, flush, getPendingOperations, getSaveState, markApplied } = useMunicipalityAnalysisPersistence();
  const optimisticOperations = getPendingOperations(analysis.id);
  const [graph, setGraph] = useState(analysis.graph);
  const graphRef = useRef(graph);
  const [data, setData] = useState<MunicipalityAnalysisData | null>(null);
  const [dataError, setDataError] = useState(false);
  const saveState = getSaveState(analysis.id);
  const [name, setName] = useState(analysis.name);
  const [renaming, setRenaming] = useState(false);
  // A drag streams a position per frame. Committing each one would clone the graph and
  // re-evaluate every series mid-drag, so the live positions stay local until the drop.
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [resizeDrafts, setResizeDrafts] = useState<Record<string, { x?: number; y?: number; width?: number; height?: number }>>({});
  const resizeDraftsRef = useRef(resizeDrafts);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(analysis.graph.selectedNodeId ? [analysis.graph.selectedNodeId] : []);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  // Which connection is selected is not worth persisting, but it has to reach React Flow:
  // the delete key removes the edges its store has marked selected, and with a controlled
  // edge list nothing marks them unless the selection change is applied here.
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [paletteSheetOpen, setPaletteSheetOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddQuery, setQuickAddQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [savingMetric, setSavingMetric] = useState(false);
  const [metricName, setMetricName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  /** Where a new block lands: the last place the pointer was over the canvas. */
  const pointerFlowPosition = useCallback(
    () => lastPointerPosition.current ? reactFlow.screenToFlowPosition(lastPointerPosition.current) : null,
    [reactFlow],
  );
  // Undo restores a whole earlier graph rather than inverting operations, so this is a
  // bounded stack of snapshots. Selection and viewport are excluded: they would fill it
  // with entries that look like nothing happened.
  const undoStack = useRef<MunicipalityAnalysisGraph[]>([]);
  const redoStack = useRef<MunicipalityAnalysisGraph[]>([]);
  /** Set for the rest of the turn once a snapshot has been taken — see `commitOperations`. */
  const historyRecorded = useRef(false);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const datasetSignature = useMemo(() => JSON.stringify(graph.nodes.flatMap((node) => node.type === "dataset" ? [node.data.dataset] : [])), [graph.nodes]);
  const optimisticSignature = JSON.stringify(optimisticOperations);

  useEffect(() => {
    let cancelled = false;
    loadMunicipalityAnalysisData(graph).then((result) => { if (!cancelled) { setDataError(false); setData(result); } }).catch(() => { if (!cancelled) setDataError(true); });
    return () => { cancelled = true; };
    // Positions and selections do not change which data files are required.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetSignature]);

  /**
   * Operations can also be enqueued from outside this editor: dropping a dataset on the
   * analysis tab queues it and then navigates here. Applying whatever is still unconfirmed
   * shows it immediately instead of waiting for the next server round trip.
   */
  useEffect(() => {
    if (!optimisticOperations.length) return;
    const next = applyMunicipalityAnalysisGraphOperations(graphRef.current, optimisticOperations, expandKennzahlIntoGraph).graph;
    graphRef.current = next;
    setGraph(next);
    markApplied(analysis.id, optimisticOperations);
    // The signature changes only when the operation journal does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticSignature]);

  /**
   * A stored viewport can end up pointing at empty canvas — nodes were moved, or the
   * window is a different size than when it was saved. React Flow only fits the view for
   * an empty graph, which would leave a graph that does have nodes looking like it has
   * none, with nothing on screen to say otherwise.
   */
  useEffect(() => {
    // After paint: before it the canvas has no size, and a zero-sized viewport contains no
    // node — which would discard a perfectly good stored viewport on every load.
    const frame = requestAnimationFrame(() => {
      const container = flowRef.current;
      const { nodes, viewport } = graphRef.current;
      if (!container?.clientWidth || !container.clientHeight || !nodes.length) return;
      const left = -viewport.x / viewport.zoom;
      const top = -viewport.y / viewport.zoom;
      const right = left + container.clientWidth / viewport.zoom;
      const bottom = top + container.clientHeight / viewport.zoom;
      const anyVisible = nodes.some(({ position }) => position.x < right && position.x + NODE_WIDTH > left
        && position.y < bottom && position.y + NODE_HEIGHT > top);
      if (!anyVisible) void reactFlow.fitView();
    });
    return () => cancelAnimationFrame(frame);
  }, [reactFlow]);

  const commitOperations = useCallback((
    operations: MunicipalityAnalysisGraphOperation[],
    options?: { debounceKey?: string; delay?: number; recordHistory?: boolean },
  ) => {
    try {
      const before = graphRef.current;
      const next = applyMunicipalityAnalysisGraphOperations(before, operations, expandKennzahlIntoGraph).graph;
      // One gesture is one step back, even when it reaches the graph as several commits.
      // Deleting a connected block is the case that needs this: React Flow reports the
      // removal of its connections first and the block itself after, both in the same
      // turn, and recording each separately left an undo that restored a block with its
      // connections silently missing.
      if ((options?.recordHistory ?? true) && operations.some(({ type }) => type !== "set-selected-node" && type !== "set-viewport")) {
        if (!historyRecorded.current) {
          undoStack.current = [...undoStack.current, before].slice(-UNDO_DEPTH);
          historyRecorded.current = true;
          queueMicrotask(() => { historyRecorded.current = false; });
        }
        redoStack.current = [];
        setHistoryDepth({ undo: undoStack.current.length, redo: 0 });
      }
      graphRef.current = next;
      setGraph(next);
      enqueue(analysis.id, operations, options);
      // Applied right here, so the queue never hands them back for a replay on top of
      // themselves — see `markApplied`.
      markApplied(analysis.id, operations);
      return true;
    } catch {
      toast.error(t("analysisNodeLimit"));
      return false;
    }
  }, [analysis.id, enqueue, markApplied, setGraph, setHistoryDepth, t]);

  // Debounced: editing a constant is typing, and each keystroke should not become its own
  // entry in the operation journal.
  const setNodeValue = useCallback((nodeId: string, value: number) => {
    if (!Number.isFinite(value)) return;
    commitOperations(
      [{ version: ANALYSIS_OPERATION_VERSION, type: "set-node-value", nodeId, value }],
      { debounceKey: `node-value:${nodeId}`, delay: 400 },
    );
  }, [commitOperations]);

  const setNodeTitle = useCallback((nodeId: string, title: string | null) => {
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "set-node-title",
      nodeId,
      title,
    }]);
  }, [commitOperations]);

  const setAnnotation = useCallback((nodeId: string, text: string, color: AnalysisAnnotationColor) => {
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "set-annotation",
      nodeId,
      text,
      color,
    }], { debounceKey: `annotation:${nodeId}`, delay: 300 });
  }, [commitOperations]);

  /**
   * Undo restores the graph as it stood before the last edit and writes that whole graph,
   * rather than trying to invert each operation. The queue is drained first so a delayed
   * move cannot land on top of the restored state.
   */
  const undoLastEdit = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current = [...redoStack.current, graphRef.current].slice(-UNDO_DEPTH);
    setHistoryDepth({ undo: undoStack.current.length, redo: redoStack.current.length });
    graphRef.current = previous;
    setGraph(previous);
    setDragPositions(null);
    setResizeDrafts({});
    const selection = previous.selectedNodeId ? [previous.selectedNodeId] : [];
    selectedNodeIdsRef.current = selection;
    setSelectedNodeIds(selection);
    startTransition(async () => {
      await flush(analysis.id);
      await saveMunicipalityAnalysisGraph({ analysisId: analysis.id, graph: previous });
      toast(t("analysisUndone"));
      router.refresh();
    });
  }, [analysis.id, flush, router, setDragPositions, setGraph, setHistoryDepth, setResizeDrafts, setSelectedNodeIds, startTransition, t]);

  const redoLastEdit = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current = [...undoStack.current, graphRef.current].slice(-UNDO_DEPTH);
    setHistoryDepth({ undo: undoStack.current.length, redo: redoStack.current.length });
    graphRef.current = next;
    setGraph(next);
    setDragPositions(null);
    setResizeDrafts({});
    const selection = next.selectedNodeId ? [next.selectedNodeId] : [];
    selectedNodeIdsRef.current = selection;
    setSelectedNodeIds(selection);
    startTransition(async () => {
      await flush(analysis.id);
      await saveMunicipalityAnalysisGraph({ analysisId: analysis.id, graph: next });
      toast(t("analysisRedone"));
      router.refresh();
    });
  }, [analysis.id, flush, router, setDragPositions, setGraph, setHistoryDepth, setResizeDrafts, setSelectedNodeIds, startTransition, t]);

  // Ctrl/Cmd+Z anywhere on the page, except while typing into a field — a node's constant
  // and the analysis name both live in inputs with their own undo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) redoLastEdit();
      else undoLastEdit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redoLastEdit, undoLastEdit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setQuickAddOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  /**
   * Pins the node to the graph's subject, or releases a pinned one. A node that arrived
   * from the map carries the municipality that was selected there; without this the
   * header can say "no municipality" while every node is about one.
   */
  const togglePin = useCallback((nodeId: string) => {
    const node = graphRef.current.nodes.find(({ id }) => id === nodeId);
    if (!node || node.type !== "dataset" || node.data.dataset.kind === "constant") return;
    const pinned = Boolean(datasetMunicipalityName(node.data.dataset));
    if (!pinned && !graphRef.current.subject) { toast.error(t("pinNodeNoSubject")); return; }
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION, type: "set-node-municipality", nodeId,
      municipality: pinned ? null : graphRef.current.subject,
    }]);
  }, [commitOperations, t]);

  const results = useMemo(() => data ? evaluateAnalysisGraph(graph, data) : new Map<string, AnalysisSeries>(), [data, graph]);
  const displayNodes = useMemo<DisplayNode[]>(() => graph.nodes.map((node) => {
    const series = results.get(node.id) ?? null;
    const errorLabel = seriesErrorLabel(series?.error ?? null, t);
    const base = {
      id: node.id,
      type: node.type,
      position: node.position,
      width: analysisNodeWidth(node),
      height: analysisNodeHeight(node),
      style: { width: analysisNodeWidth(node), height: analysisNodeHeight(node) },
      selected: selectedNodeIds.includes(node.id),
    };
    if (node.type === "annotation") {
      return {
        ...base,
        type: "annotation" as const,
        data: {
          kind: "annotation" as const,
          title: t("studioNote"),
          technicalTitle: t("studioNote"),
          series: null,
          errorLabel: null,
          warningLabel: null,
          annotation: {
            text: node.data.text,
            color: node.data.color,
            commit: (text: string, color: AnalysisAnnotationColor) => setAnnotation(node.id, text, color),
          },
        },
      };
    }
    if (node.type === "dataset") {
      const technicalTitle = datasetTitle(node.data.dataset, t);
      return {
        ...base,
        type: "dataset" as const,
        data: {
          kind: "dataset" as const,
          title: node.data.alias ?? technicalTitle,
          technicalTitle,
          subtitle: node.data.dataset.kind === "constant"
            ? t("constantNode")
            : datasetMunicipalityName(node.data.dataset)
              ?? graph.subject?.municipalityName
              ?? t("analysisSubjectNone"),
          pinned: Boolean(datasetMunicipalityName(node.data.dataset)),
          togglePin: node.data.dataset.kind === "constant" ? undefined : {
            label: datasetMunicipalityName(node.data.dataset) ? t("unpinNode") : t("pinNode"),
            apply: () => togglePin(node.id),
          },
          editor: node.data.dataset.kind === "constant"
            ? { value: node.data.dataset.value, label: t("constantValue"), step: 1, commit: (value: number) => setNodeValue(node.id, value) }
            : undefined,
          series,
          errorLabel,
          warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
          rename: (title: string | null) => setNodeTitle(node.id, title),
        },
      };
    }
    const technicalTitle = t(`operator_${node.data.operator}`);
    return {
      ...base,
      type: "operator" as const,
      data: {
        kind: "operator" as const,
        title: node.data.alias ?? technicalTitle,
        technicalTitle,
        subtitle: t("operatorNode"),
        symbol: ANALYSIS_OPERATOR_SYMBOLS[node.data.operator],
        series,
        singleInput: isUnaryAnalysisOperator(node.data.operator),
        editor: isUnaryAnalysisOperator(node.data.operator)
          ? { value: node.data.years ?? 1, label: t("shiftYears"), min: 1, max: MAX_ANALYSIS_SHIFT_YEARS, step: 1, commit: (value: number) => setNodeValue(node.id, value) }
          : undefined,
        errorLabel,
        warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
        rename: (title: string | null) => setNodeTitle(node.id, title),
      },
    };
  }), [graph.nodes, graph.subject, results, selectedNodeIds, setAnnotation, setNodeTitle, setNodeValue, togglePin, t]);
  // A node with no live draft is handed back unchanged: React Flow keeps the internal node
  // it already built for an unchanged object, so dragging one card does not re-render the
  // sparkline of every other one.
  const positionedNodes = useMemo<DisplayNode[]>(() => displayNodes.map((node) => {
    const drag = dragPositions?.[node.id];
    const resize = resizeDrafts[node.id];
    if (!drag && !resize) return node;
    const position = drag ?? { x: resize?.x ?? node.position.x, y: resize?.y ?? node.position.y };
    const width = resize?.width ?? node.width;
    const height = resize?.height ?? node.height;
    return { ...node, position, width, height, style: { width, height } };
  }), [displayNodes, dragPositions, resizeDrafts]);

  /** Where each edge leaves its source card and enters its target handle. */
  const edgeGeometry = useMemo(() => {
    const byId = new Map(positionedNodes.map((node) => [node.id, node]));
    return graph.edges.map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const targetRatio = target?.data.singleInput ? 0.5 : edge.targetHandle === "a" ? 0.38 : 0.72;
      return {
        id: edge.id,
        source: { x: (source?.position.x ?? 0) + (source?.width ?? 0), y: (source?.position.y ?? 0) + (source?.height ?? 0) / 2 },
        target: { x: target?.position.x ?? 0, y: (target?.position.y ?? 0) + (target?.height ?? 0) * targetRatio },
      };
    });
  }, [graph.edges, positionedNodes]);

  // While a card is being dragged or resized the layout changes every frame, and routing
  // every edge around every card is an A* per edge — far too much for a frame budget. The
  // stub route follows the pointer for those frames; the real routes are found on drop.
  const interacting = dragPositions !== null || Object.keys(resizeDrafts).length > 0;
  const routedPaths = useMemo(() => {
    if (interacting) return null;
    const bounds = positionedNodes.map((node) => ({
      x: node.position.x, y: node.position.y, width: node.width ?? 0, height: node.height ?? 0,
    }));
    return new Map(edgeGeometry.map(({ id, source, target }) =>
      [id, analysisEdgePath(routeAnalysisEdge(source, target, bounds))]));
  }, [edgeGeometry, interacting, positionedNodes]);

  const displayEdges = useMemo<AnalysisDisplayEdge[]>(() => graph.edges.map((edge, index) => {
    const highlighted = selectedNodeIds.includes(edge.source) || selectedNodeIds.includes(edge.target);
    const geometry = edgeGeometry[index]!;
    return {
      ...edge,
      type: "analysis",
      animated: false,
      selected: selectedEdgeIds.includes(edge.id),
      data: { path: routedPaths?.get(edge.id) ?? analysisEdgePath(analysisStubRoute(geometry.source, geometry.target)) },
      style: highlighted || selectedEdgeIds.includes(edge.id) ? { strokeWidth: 2.5, stroke: "var(--color-teal-600)" } : undefined,
    };
  }), [edgeGeometry, graph.edges, routedPaths, selectedEdgeIds, selectedNodeIds]);
  const selectedNode = selectedNodeIds.length === 1 ? graph.nodes.find(({ id }) => id === selectedNodeIds[0]) ?? null : null;
  const selectedSeries = selectedNode ? results.get(selectedNode.id) ?? null : null;
  const selectedTechnicalTitle = selectedNode?.type === "dataset" ? datasetTitle(selectedNode.data.dataset, t)
    : selectedNode?.type === "operator" ? t(`operator_${selectedNode.data.operator}`)
      : selectedNode?.type === "annotation" ? t("studioNote") : t("analysisNoResultSelected");
  const selectedTitle = selectedNode && selectedNode.type !== "annotation" ? selectedNode.data.alias ?? selectedTechnicalTitle : selectedTechnicalTitle;

  const onNodesChange = useCallback((changes: NodeChange<DisplayNode>[]) => {
    const resizeBatchIds = new Set(changes.flatMap((change) => change.type === "dimensions" && change.resizing !== undefined ? [change.id] : []));
    const selection = new Set(selectedNodeIdsRef.current);
    let selectionChanged = false;
    const updateResizeDraft = (id: string, draft: { x?: number; y?: number; width?: number; height?: number }) => {
      const next = { ...(resizeDraftsRef.current[id] ?? {}), ...draft };
      resizeDraftsRef.current = { ...resizeDraftsRef.current, [id]: next };
      setResizeDrafts(resizeDraftsRef.current);
      return next;
    };
    // Deleting or dropping a multiple selection arrives as one batch of changes. Committing
    // each one on its own would fill the undo stack with steps the reader never took, and
    // stack up a toast per node.
    const removedIds: string[] = [];
    const moves: Array<Extract<MunicipalityAnalysisGraphOperation, { type: "move-node" }>> = [];
    for (const change of changes) {
      if (change.type === "remove") {
        removedIds.push(change.id);
        selection.delete(change.id);
        selectionChanged = true;
      } else if (change.type === "position" && change.position) {
        const { id, position } = change;
        if (resizeBatchIds.has(id)) {
          updateResizeDraft(id, position);
          continue;
        }
        if (change.dragging) {
          setDragPositions((current) => ({ ...current, [id]: position }));
          continue;
        }
        setDragPositions(null);
        const current = graphRef.current.nodes.find((node) => node.id === id);
        if (current?.position.x === position.x && current.position.y === position.y) continue;
        moves.push({ version: ANALYSIS_OPERATION_VERSION, type: "move-node", nodeId: id, position });
      } else if (change.type === "dimensions" && change.dimensions && change.resizing !== undefined) {
        const draft = updateResizeDraft(change.id, change.dimensions);
        if (change.resizing === false) {
          const node = graphRef.current.nodes.find(({ id }) => id === change.id);
          if (node) {
            commitOperations([{
              version: ANALYSIS_OPERATION_VERSION,
              type: "resize-node",
              nodeId: change.id,
              position: { x: draft.x ?? node.position.x, y: draft.y ?? node.position.y },
              width: draft.width ?? analysisNodeWidth(node),
              height: draft.height ?? analysisNodeHeight(node),
            }]);
          }
          const remaining = { ...resizeDraftsRef.current };
          delete remaining[change.id];
          resizeDraftsRef.current = remaining;
          setResizeDrafts(remaining);
        }
      } else if (change.type === "select") {
        if (change.selected) selection.add(change.id);
        else selection.delete(change.id);
        selectionChanged = true;
      }
    }
    if (removedIds.length) {
      // Backspace/Delete removes nodes straight into the persisted graph, so the removal
      // has to be reversible: keep the nodes and their edges for the undo action.
      const removed = new Set(removedIds);
      const removedNodes = graphRef.current.nodes.filter(({ id }) => removed.has(id));
      const removedEdges = graphRef.current.edges.filter(({ source, target }) => removed.has(source) || removed.has(target));
      commitOperations(removedIds.map((nodeId) => ({ version: ANALYSIS_OPERATION_VERSION, type: "remove-node", nodeId })));
      if (removedNodes.length) {
        toast(t("analysisNodeRemoved", { count: removedNodes.length }), {
          action: {
            label: t("analysisUndo"),
            onClick: () => commitOperations([
              ...removedNodes.map((node): MunicipalityAnalysisGraphOperation => ({
                version: ANALYSIS_OPERATION_VERSION, type: "add-node", node,
              })),
              ...removedEdges.map((edge): MunicipalityAnalysisGraphOperation => ({
                version: ANALYSIS_OPERATION_VERSION, type: "add-edge", edge,
              })),
            ]),
          },
        });
      }
    }
    if (moves.length) commitOperations(moves, { debounceKey: `node-position:${moves.map(({ nodeId }) => nodeId).join(",")}`, delay: 500 });
    if (selectionChanged) {
      const ids = [...selection];
      selectedNodeIdsRef.current = ids;
      setSelectedNodeIds(ids);
      const primary = ids.at(-1) ?? null;
      if (primary !== graphRef.current.selectedNodeId) {
        commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-selected-node", nodeId: primary }], { recordHistory: false });
      }
    }
  }, [commitOperations, setDragPositions, setResizeDrafts, setSelectedNodeIds, t]);

  /**
   * Connections carry no selection of their own in the saved graph, so it is held here and
   * handed back to React Flow — which is what lets one be clicked and then deleted.
   */
  const onEdgesChange = useCallback((changes: EdgeChange<AnalysisDisplayEdge>[]) => {
    const removed = changes.flatMap((change) => change.type === "remove" ? [change.id] : []);
    if (removed.length) {
      commitOperations(removed.map((edgeId) => ({ version: ANALYSIS_OPERATION_VERSION, type: "remove-edge", edgeId })));
    }
    const selections = changes.filter((change) => change.type === "select");
    if (removed.length || selections.length) {
      setSelectedEdgeIds((current) => {
        const next = new Set(current.filter((id) => !removed.includes(id)));
        for (const change of selections) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        return [...next];
      });
    }
  }, [commitOperations, setSelectedEdgeIds]);

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || (connection.targetHandle !== "a" && connection.targetHandle !== "b")) return;
    if (wouldCreateAnalysisCycle(graphRef.current.edges, connection.source, connection.target)) {
      toast.error(t("analysisCycleError"));
      return;
    }
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-edge",
      edge: { id: createId(), source: connection.source, target: connection.target, sourceHandle: "output", targetHandle: connection.targetHandle },
    }]);
  }, [commitOperations, t]);

  // Stable identities: the palette below is a hundred-odd catalog entries, and it must
  // not be rebuilt on every frame of a node drag just because a callback is new.
  const addOperator = useCallback((operator: AnalysisOperatorId, position?: { x: number; y: number }) => {
    if (graphRef.current.nodes.length >= 100) { toast.error(t("analysisNodeLimit")); return; }
    const id = createId();
    if (commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-node",
      node: { id, type: "operator", position: position ?? pointerFlowPosition() ?? { x: 360, y: 120 + graphRef.current.nodes.length * 30 }, data: { operator } },
    }])) {
      selectedNodeIdsRef.current = [id];
      setSelectedNodeIds([id]);
    }
  }, [commitOperations, pointerFlowPosition, setSelectedNodeIds, t]);

  const addConstant = useCallback((position?: { x: number; y: number }) => {
    if (graphRef.current.nodes.length >= 100) { toast.error(t("analysisNodeLimit")); return; }
    const id = createId();
    if (commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-node",
      node: {
        id, type: "dataset",
        position: position ?? pointerFlowPosition() ?? { x: 360, y: 120 + graphRef.current.nodes.length * 30 },
        data: { dataset: { kind: "constant", value: 0 } },
      },
    }])) {
      selectedNodeIdsRef.current = [id];
      setSelectedNodeIds([id]);
    }
  }, [commitOperations, pointerFlowPosition, setSelectedNodeIds, t]);

  const addAnnotation = useCallback((position?: { x: number; y: number }) => {
    if (graphRef.current.nodes.length >= 100) { toast.error(t("analysisNodeLimit")); return; }
    const id = createId();
    if (commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-node",
      node: {
        id,
        type: "annotation",
        position: position ?? pointerFlowPosition() ?? { x: 240, y: 160 + graphRef.current.nodes.length * 24 },
        data: { text: t("studioNotePlaceholder"), color: "sand" },
      },
    }])) {
      selectedNodeIdsRef.current = [id];
      setSelectedNodeIds([id]);
    }
  }, [commitOperations, pointerFlowPosition, setSelectedNodeIds, t]);

  function applyNodePositions(positions: Record<string, { x: number; y: number }>) {
    const operations = Object.entries(positions).flatMap(([nodeId, position]): MunicipalityAnalysisGraphOperation[] => {
      const node = graphRef.current.nodes.find(({ id }) => id === nodeId);
      if (!node || (node.position.x === position.x && node.position.y === position.y)) return [];
      return [{ version: ANALYSIS_OPERATION_VERSION, type: "move-node", nodeId, position }];
    });
    if (operations.length) commitOperations(operations);
  }

  function autoLayout() {
    applyNodePositions(autoLayoutAnalysisGraph(graphRef.current));
    requestAnimationFrame(() => void reactFlow.fitView({ padding: 0.2, duration: 250 }));
  }

  function arrangeSelection(action: AnalysisArrangeAction) {
    applyNodePositions(arrangeAnalysisNodes(graphRef.current, selectedNodeIdsRef.current, action));
  }

  function resizeSelectedNode(size: { width?: number; height?: number }) {
    const node = selectedNodeIdsRef.current.length === 1
      ? graphRef.current.nodes.find(({ id }) => id === selectedNodeIdsRef.current[0])
      : null;
    if (!node) return;
    const width = size.width ?? analysisNodeWidth(node);
    const height = size.height ?? analysisNodeHeight(node);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "resize-node",
      nodeId: node.id,
      position: node.position,
      width,
      height,
    }], { debounceKey: `node-size:${node.id}`, delay: 300 });
  }

  function deleteSelection() {
    const ids = [...selectedNodeIdsRef.current];
    if (!ids.length) return;
    commitOperations(ids.map((nodeId) => ({ version: ANALYSIS_OPERATION_VERSION, type: "remove-node", nodeId })));
    selectedNodeIdsRef.current = [];
    setSelectedNodeIds([]);
  }

  /**
   * Puts a catalog entry on the canvas. One operation for both catalogs: `add-kennzahl`
   * expands a derivation into real nodes and falls back to a single node for an
   * Ausgangsdatum, which is exactly the difference between the two lists.
   */
  const insertDataset = useCallback((request: { label: string; dataset: MunicipalityDatasetRef }) => {
    const inserted = commitOperations([{
      version: ANALYSIS_OPERATION_VERSION, type: "add-kennzahl", nodeId: createId(), dataset: request.dataset,
    }]);
    if (inserted) toast.success(t("kennzahlInserted", { kennzahl: request.label }));
  }, [commitOperations, t]);

  /**
   * Turns the selected node into a reusable Kennzahl. The server reads the persisted
   * graph, so anything still queued is sent first — otherwise it would save a half-built
   * formula.
   */
  function saveSelectionAsMetric(metricName: string) {
    if (!selectedNode || !metricName.trim()) return;
    setSavingMetric(false);
    startTransition(async () => {
      if (!await flush(analysis.id)) {
        toast.error(t("saveAsKennzahlPending"));
        return;
      }
      const result = await saveMunicipalityAnalysisNodeAsMetric({
        analysisId: analysis.id, nodeId: selectedNode.id, name: metricName,
      });
      if (result.ok) {
        toast.success(t("saveAsKennzahlSaved", { name: result.name }));
        router.refresh();
        return;
      }
      toast.error(t(
        result.reason === "mixed-municipalities" ? "saveAsKennzahlMixedMunicipalities"
          : result.reason === "no-municipality-input" ? "saveAsKennzahlNoMunicipality"
            : "saveAsKennzahlMissingInput",
      ));
    });
  }

  async function copySeriesAsCsv() {
    if (!selectedSeries) return;
    try {
      await navigator.clipboard.writeText(analysisSeriesToCsv(selectedSeries, { year: t("csvYearHeader"), value: selectedTitle }));
      toast.success(t("copiedCsv"));
    } catch {
      toast.error(t("copyCsvFailed"));
    }
  }

  function commitRename() {
    if (!name.trim() || name.trim() === analysis.name) { setName(analysis.name); setRenaming(false); return; }
    startTransition(async () => {
      await renameMunicipalityAnalysis({ analysisId: analysis.id, name });
      setRenaming(false);
      router.refresh();
    });
  }

  function removeAnalysis() {
    setDeleting(false);
    startTransition(async () => {
      await deleteMunicipalityAnalysis(analysis.id);
      router.push("/municipalities/analysis");
      router.refresh();
    });
  }

  type QuickAddItem =
    | { id: string; label: string; group: string; kind: "dataset"; request: { label: string; dataset: MunicipalityDatasetRef } }
    | { id: string; label: string; group: string; kind: "operator"; operator: AnalysisOperatorId }
    | { id: string; label: string; group: string; kind: "constant" | "annotation" };
  // Both catalogs, every operator, in one list. Built once per language rather than per
  // render: it is a hundred-odd entries that never change while a node is being dragged.
  const quickAddItems = useMemo<QuickAddItem[]>(() => [
    ...AUSGANGSDATEN_CATALOG.map(({ id, output }) => ({
      id: `data:${id}`,
      label: datasetTitle(output, t),
      group: t("dataKindBase"),
      kind: "dataset" as const,
      request: { label: datasetTitle(output, t), dataset: bindKennzahlInput(output) },
    })),
    ...KENNZAHL_CATALOG.flatMap(({ id, labelKey, output }) => kennzahlExpressionFor(output) ? [{
      id: `metric:${id}`,
      label: t(labelKey as "populationDensity"),
      group: t("dataKindDerived"),
      kind: "dataset" as const,
      request: { label: t(labelKey as "populationDensity"), dataset: bindKennzahlInput(output) },
    }] : []),
    ...analysisOperatorIds.map((operator) => ({
      id: `operator:${operator}`,
      label: t(`operator_${operator}`),
      group: t("operators"),
      kind: "operator" as const,
      operator,
    })),
    { id: "constant", label: t("constantNode"), group: t("studioBlocks"), kind: "constant" },
    { id: "annotation", label: t("studioNote"), group: t("studioBlocks"), kind: "annotation" },
  ], [t]);
  const visibleQuickAddItems = useMemo(() => {
    const needle = normalizeMunicipalitySearch(quickAddQuery);
    return quickAddItems.filter(({ label, group }) => !needle
      || normalizeMunicipalitySearch(`${label} ${group}`).includes(needle)).slice(0, 40);
  }, [quickAddItems, quickAddQuery]);

  const runQuickAdd = (item: QuickAddItem) => {
    if (item.kind === "dataset") insertDataset(item.request);
    else if (item.kind === "operator") addOperator(item.operator);
    else if (item.kind === "constant") addConstant();
    else addAnnotation();
    setQuickAddOpen(false);
    setQuickAddQuery("");
  };
  // Held across renders: dragging a node re-renders this editor on every frame, and the
  // library it holds is the whole Ausgangsdaten and Kennzahlen catalog.
  const addConstantAtPointer = useCallback(() => addConstant(), [addConstant]);
  const addAnnotationAtPointer = useCallback(() => addAnnotation(), [addAnnotation]);
  const palettePanel = useMemo(() => (
    <StudioPalette
      metrics={metrics}
      onOperator={addOperator}
      onConstant={addConstantAtPointer}
      onAnnotation={addAnnotationAtPointer}
      onDataset={insertDataset}
    />
  ), [addAnnotationAtPointer, addConstantAtPointer, addOperator, insertDataset, metrics]);

  const selectedWidth = selectedNode ? analysisNodeWidth(selectedNode) : 0;
  const selectedHeight = selectedNode ? analysisNodeHeight(selectedNode) : 0;
  const inspectorPanel = (
    <Tabs defaultValue="properties" className="min-h-0 flex-1">
      <TabsList className="grid h-9 w-full grid-cols-2">
        <TabsTrigger value="properties"><SlidersHorizontal className="size-3.5" />{t("studioProperties")}</TabsTrigger>
        <TabsTrigger value="result"><ChartLine className="size-3.5" />{t("resultPreview")}</TabsTrigger>
      </TabsList>
      <TabsContent value="properties" className="min-h-0 overflow-y-auto pr-1">
        {selectedNodeIds.length > 1 ? (
          <div className="grid gap-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">{t("studioSelectionCount", { count: selectedNodeIds.length })}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("studioSelectionHint")}</p>
            </div>
            <div>
              <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("studioAlign")}</h3>
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                {([
                  ["align-left", AlignStartVertical], ["align-center", AlignCenterVertical], ["align-right", AlignEndVertical],
                  ["align-top", AlignStartHorizontal], ["align-middle", AlignCenterHorizontal], ["align-bottom", AlignEndHorizontal],
                ] as const).map(([action, Icon]) => (
                  <Button key={action} variant="outline" size="icon-sm" aria-label={t(`studio_${action}`)} title={t(`studio_${action}`)} onClick={() => arrangeSelection(action)}><Icon className="size-3.5" /></Button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("studioDistribute")}</h3>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <Button variant="outline" size="sm" onClick={() => arrangeSelection("distribute-horizontal")}><Columns3 className="size-3.5" />{t("studioHorizontal")}</Button>
                <Button variant="outline" size="sm" onClick={() => arrangeSelection("distribute-vertical")}><Rows3 className="size-3.5" />{t("studioVertical")}</Button>
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={deleteSelection}><Trash2 className="size-3.5" />{t("studioDeleteSelection")}</Button>
          </div>
        ) : selectedNode ? (
          <div className="grid gap-4 py-3">
            <div>
              <h2 className="truncate text-sm font-semibold">{selectedTitle}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{selectedTechnicalTitle}</p>
            </div>
            {selectedNode.type !== "annotation" && (
              <label className="grid gap-1.5 text-xs font-medium">
                {t("studioCustomTitle")}
                <Input
                  key={`${selectedNode.id}:${selectedTitle}`}
                  className="h-9 text-xs"
                  defaultValue={selectedNode.data.alias ?? ""}
                  maxLength={120}
                  placeholder={selectedTechnicalTitle}
                  onBlur={(event) => setNodeTitle(selectedNode.id, event.target.value.trim() || null)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
              </label>
            )}
            {selectedNode.type === "annotation" && (
              <>
                <label className="grid gap-1.5 text-xs font-medium">
                  {t("studioNoteText")}
                  <Textarea
                    key={`${selectedNode.id}:${selectedNode.data.text}`}
                    defaultValue={selectedNode.data.text}
                    maxLength={2_000}
                    onBlur={(event) => setAnnotation(selectedNode.id, event.target.value, selectedNode.data.color)}
                  />
                </label>
                <div>
                  <h3 className="text-xs font-medium">{t("studioNoteColor")}</h3>
                  <div className="mt-1.5 flex gap-2">
                    {analysisAnnotationColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={cn("size-7 rounded-full border-2", NOTE_STYLES[color], selectedNode.data.color === color && "ring-2 ring-teal-600 ring-offset-2")}
                        aria-label={t(`studioNoteColor_${color}`)}
                        title={t(`studioNoteColor_${color}`)}
                        onClick={() => setAnnotation(selectedNode.id, selectedNode.data.text, color)}
                      ><span className="sr-only">{t(`studioNoteColor_${color}`)}</span></button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div>
              <h3 className="text-xs font-medium">{t("studioDimensions")}</h3>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[10px] text-muted-foreground">{t("studioWidth")}
                  <Input key={`${selectedNode.id}:w:${selectedWidth}`} className="h-8 text-xs" type="number" defaultValue={selectedWidth} min={selectedNode.type === "annotation" ? MIN_ANALYSIS_NOTE_WIDTH : MIN_ANALYSIS_NODE_WIDTH} max={MAX_ANALYSIS_NODE_WIDTH} onBlur={(event) => resizeSelectedNode({ width: Number(event.target.value) })} />
                </label>
                <label className="grid gap-1 text-[10px] text-muted-foreground">{t("studioHeight")}
                  <Input key={`${selectedNode.id}:h:${selectedHeight}`} className="h-8 text-xs" type="number" defaultValue={selectedHeight} min={selectedNode.type === "annotation" ? MIN_ANALYSIS_NOTE_HEIGHT : MIN_ANALYSIS_NODE_HEIGHT} max={MAX_ANALYSIS_NODE_HEIGHT} onBlur={(event) => resizeSelectedNode({ height: Number(event.target.value) })} />
                </label>
              </div>
            </div>
            {selectedNode.type === "dataset" && selectedNode.data.dataset.kind !== "constant" && (
              <Button variant="outline" size="sm" onClick={() => togglePin(selectedNode.id)}>
                {datasetMunicipalityName(selectedNode.data.dataset) ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                {datasetMunicipalityName(selectedNode.data.dataset) ? t("unpinNode") : t("pinNode")}
              </Button>
            )}
            <Button variant="outline" size="sm" className="text-destructive" onClick={deleteSelection}><Trash2 className="size-3.5" />{t("studioDeleteNode")}</Button>
          </div>
        ) : <p className="py-4 text-xs leading-5 text-muted-foreground">{t("studioSelectProperties")}</p>}
      </TabsContent>
      <TabsContent value="result" className="min-h-0 overflow-y-auto pr-1" aria-live="polite">
        {selectedNodeIds.length === 1 && selectedNode && selectedNode.type !== "annotation" && <h2 className="mt-3 truncate text-sm font-semibold">{selectedTitle}</h2>}
        {selectedNodeIds.length > 1 ? <p className="py-4 text-xs leading-5 text-muted-foreground">{t("studioMultiResult")}</p>
          : selectedNode?.type === "annotation" ? <p className="py-4 text-xs leading-5 text-muted-foreground">{t("studioNoteNoResult")}</p>
            : dataError ? <p className="mt-3 flex gap-2 text-xs text-destructive"><TriangleAlert className="size-4 shrink-0" />{t("analysisDataError")}</p>
              : selectedSeries?.error ? <p className="mt-3 flex gap-2 text-xs text-destructive"><TriangleAlert className="size-4 shrink-0" />{seriesErrorLabel(selectedSeries.error, t)}</p>
                : selectedSeries ? (
                  <div className="py-3">
                    <AnalysisSeriesChart series={selectedSeries} label={selectedTitle} trueLabel={t("booleanTrue")} falseLabel={t("booleanFalse")} />
                    {selectedSeries.warnings.length > 0 && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{t("analysisDivisionWarnings", { count: selectedSeries.warnings.length })}</p>}
                    <div className="mt-3 grid gap-2">
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => { setMetricName(selectedTitle); setSavingMetric(true); }}><Bookmark className="size-4" />{t("saveAsKennzahl")}</Button>
                      <Button variant="outline" size="sm" onClick={copySeriesAsCsv}><Copy className="size-4" />{t("copyCsv")}</Button>
                    </div>
                    <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border">
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="px-2 py-1 text-left font-medium">{t("csvYearHeader")}</th><th className="px-2 py-1 text-right font-medium">{t("analysisValueHeader")}</th></tr></thead>
                        <tbody>{[...selectedSeries.points].reverse().map(({ year, value }) => <tr key={year} className="border-t"><td className="px-2 py-1">{year}</td><td className="px-2 py-1 text-right tabular-nums">{value === null ? "—" : typeof value === "boolean" ? (value ? t("booleanTrue") : t("booleanFalse")) : format.number(value, { maximumFractionDigits: 2 })}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                ) : <p className="py-4 text-xs leading-5 text-muted-foreground">{t("analysisSelectResult")}</p>}
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="flex min-h-[42rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm lg:h-[calc(100vh-10.5rem)]" data-analysis-editor data-testid="municipality-analysis-editor">
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <select id="analysis-switcher" className="h-8 max-w-52 rounded-lg border bg-background px-2 text-xs" value={analysis.id} aria-label={t("savedAnalyses")} onChange={(event) => router.push(`/municipalities/analysis?analysis=${encodeURIComponent(event.target.value)}`)}>
          {analyses.map((item) => <option key={item.id} value={item.id}>{analysisOptionLabel(item, t)}</option>)}
        </select>
        <div className="min-w-32 flex-1">
          <div className="min-w-0 flex-1">
            {renaming ? <Input className="h-8 max-w-xs text-sm" value={name} maxLength={120} autoFocus onValueChange={(value) => setName(value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") { setName(analysis.name); setRenaming(false); } }} /> : (
              <button className="flex max-w-full items-center gap-1.5 text-left" onClick={() => setRenaming(true)}>
                <span className="truncate text-sm font-semibold">{analysis.name}</span><Pencil className="size-3 shrink-0 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-32 truncate text-[11px] font-medium" data-testid="analysis-subject">{graph.subject?.municipalityName ?? t("analysisSubjectNone")}</span>
          <div className="w-36"><MunicipalityPicker compact label={t("analysisSubject")} placeholder={t("kennzahlMunicipalityPlaceholder")} onPick={(item) => commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-subject", subject: { municipalityCode: item.municipalityCode, municipalityName: item.name } }])} /></div>
        </div>
        <span className={cn("flex items-center gap-1 text-[11px]", saveState === "error" ? "text-destructive" : "text-muted-foreground")}><Save className="size-3.5" />{t(saveState === "saving" ? "analysisSaving" : saveState === "error" ? "analysisSaveError" : "analysisSaved")}</span>
        <Button variant="ghost" size="icon-sm" className="text-destructive" disabled={pending} aria-label={t("deleteAnalysis")} onClick={() => setDeleting(true)}><Trash2 className="size-3.5" /></Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={cn("hidden min-h-0 shrink-0 border-r bg-muted/10 transition-[width] lg:flex lg:flex-col", paletteCollapsed ? "w-11 p-1" : "w-64 p-3")}>
          <div className="mb-2 flex items-center justify-between">
            {!paletteCollapsed && <h2 className="text-xs font-semibold tracking-wide uppercase">{t("studioLibrary")}</h2>}
            <Button variant="ghost" size="icon-sm" className={cn(paletteCollapsed && "mx-auto")} aria-label={paletteCollapsed ? t("studioOpenPalette") : t("studioClosePalette")} onClick={() => setPaletteCollapsed((value) => !value)}>{paletteCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</Button>
          </div>
          {!paletteCollapsed && palettePanel}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-muted/20">
          <div className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5">
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setPaletteSheetOpen(true)}><Menu className="size-3.5" />{t("studioLibrary")}</Button>
            <Button variant="outline" size="sm" onClick={() => setQuickAddOpen(true)}><Plus className="size-3.5" />{t("studioQuickAdd")}<span className="ml-2 hidden rounded border px-1 text-[9px] text-muted-foreground sm:inline">⌘K</span></Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button variant="ghost" size="icon-sm" aria-label={t("analysisUndo")} title={t("analysisUndo")} disabled={!historyDepth.undo} onClick={undoLastEdit}><Undo2 className="size-3.5" /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("studioRedo")} title={t("studioRedo")} disabled={!historyDepth.redo} onClick={redoLastEdit}><Redo2 className="size-3.5" /></Button>
            <Button variant="ghost" size="sm" onClick={autoLayout}><WandSparkles className="size-3.5" />{t("studioAutoLayout")}</Button>
            <Button variant="ghost" size="sm" onClick={() => void reactFlow.fitView({ padding: 0.2, duration: 250 })}><Maximize2 className="size-3.5" />{t("studioFit")}</Button>
            {selectedNodeIds.length > 1 && <span className="ml-auto rounded-full bg-teal-100 px-2 py-1 text-[10px] font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200">{t("studioSelectionCount", { count: selectedNodeIds.length })}</span>}
            <Button variant="outline" size="sm" className="ml-auto lg:hidden" onClick={() => setInspectorSheetOpen(true)}><SlidersHorizontal className="size-3.5" />{t("studioInspector")}</Button>
          </div>
          <div
            className="relative min-h-0 flex-1"
            ref={flowRef}
            // Only the screen coordinates are kept. Converting them here would measure the
            // canvas on every pointer move, interleaved with the transforms React Flow
            // writes during a drag, which is a forced layout per frame for a number that is
            // read at most once, when a block is placed.
            onPointerMove={(event) => { lastPointerPosition.current = { x: event.clientX, y: event.clientY }; }}
          >
            <ReactFlow
              nodes={positionedNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={connect}
              onMoveEnd={(_, viewport: Viewport) => { const current = graphRef.current.viewport; if (current.x !== viewport.x || current.y !== viewport.y || current.zoom !== viewport.zoom) commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-viewport", viewport }], { debounceKey: "viewport", delay: 500, recordHistory: false }); }}
              defaultViewport={graph.viewport}
              minZoom={0.2}
              maxZoom={2}
              fitView={!graph.nodes.length}
              deleteKeyCode={["Backspace", "Delete"]}
              // Dragging the empty canvas pans it, which React Flow takes as reason enough
              // to ignore `selectionOnDrag` entirely — it was never in effect. Holding
              // shift while dragging draws the selection box instead, and partial mode
              // means a card only has to be touched by it, not enclosed.
              selectionMode={SelectionMode.Partial}
              onPaneClick={() => { selectedNodeIdsRef.current = []; setSelectedNodeIds([]); if (graphRef.current.selectedNodeId) commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-selected-node", nodeId: null }], { recordHistory: false }); }}
              onDragOver={(event) => { if (event.dataTransfer.types.includes(OPERATOR_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
              onDrop={(event) => { event.preventDefault(); const payload = event.dataTransfer.getData(OPERATOR_DRAG_TYPE); const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); if (payload === CONSTANT_DRAG_VALUE) addConstant(position); else if (analysisOperatorIds.includes(payload as AnalysisOperatorId)) addOperator(payload as AnalysisOperatorId, position); }}
            >
              <Background gap={20} size={1} />
              <Controls position="bottom-left" showInteractive={false} />
              {graph.nodes.length > 4 && <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.type === "operator" ? "#8b5cf6" : node.type === "annotation" ? "#f59e0b" : "#0d9488"} maskColor="rgb(15 23 42 / 0.08)" />}
            </ReactFlow>
            {!graph.nodes.length && <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center"><div><BarChart3 className="mx-auto size-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{t("emptyAnalysisTitle")}</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("studioEmptyDescription")}</p></div></div>}
            {!data && !dataError && graph.nodes.some(({ type }) => type !== "annotation") && <div className="pointer-events-none absolute inset-x-0 top-2 grid place-items-center" role="status"><span className="flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1 text-xs shadow-sm backdrop-blur"><Loader2 className="size-3.5 animate-spin" />{t("analysisDataLoading")}</span></div>}
          </div>
        </section>

        <aside className={cn("hidden min-h-0 shrink-0 border-l bg-background transition-[width] lg:flex lg:flex-col", inspectorCollapsed ? "w-11 p-1" : "w-72 p-3")}>
          <div className="mb-2 flex items-center justify-between">
            {!inspectorCollapsed && <h2 className="text-xs font-semibold tracking-wide uppercase">{t("studioInspector")}</h2>}
            <Button variant="ghost" size="icon-sm" className={cn(inspectorCollapsed && "mx-auto")} aria-label={inspectorCollapsed ? t("studioOpenInspector") : t("studioCloseInspector")} onClick={() => setInspectorCollapsed((value) => !value)}>{inspectorCollapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}</Button>
          </div>
          {!inspectorCollapsed && inspectorPanel}
        </aside>
      </div>

      <Sheet open={paletteSheetOpen} onOpenChange={setPaletteSheetOpen}><SheetContent side="left" className="p-4"><SheetHeader className="p-0"><SheetTitle>{t("studioLibrary")}</SheetTitle></SheetHeader>{palettePanel}</SheetContent></Sheet>
      <Sheet open={inspectorSheetOpen} onOpenChange={setInspectorSheetOpen}><SheetContent side="right" className="p-4"><SheetHeader className="p-0"><SheetTitle>{t("studioInspector")}</SheetTitle></SheetHeader>{inspectorPanel}</SheetContent></Sheet>

      <Dialog open={quickAddOpen} onOpenChange={(open) => { setQuickAddOpen(open); if (!open) setQuickAddQuery(""); }}>
        <DialogContent className="gap-3 sm:max-w-xl" data-testid="analysis-quick-add">
          <DialogHeader><DialogTitle>{t("studioQuickAdd")}</DialogTitle><DialogDescription>{t("studioQuickAddHint")}</DialogDescription></DialogHeader>
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus className="pl-9" value={quickAddQuery} onValueChange={setQuickAddQuery} placeholder={t("studioQuickAddSearch")} onKeyDown={(event) => { if (event.key === "Enter" && visibleQuickAddItems[0]) { event.preventDefault(); runQuickAdd(visibleQuickAddItems[0]); } }} /></div>
          <div className="max-h-96 overflow-y-auto rounded-xl border p-1">
            {visibleQuickAddItems.map((item) => <button key={item.id} type="button" className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent" onClick={() => runQuickAdd(item)}><span className="truncate text-sm font-medium">{item.label}</span><span className="shrink-0 text-[10px] text-muted-foreground">{item.group}</span></button>)}
            {!visibleQuickAddItems.length && <p className="p-6 text-center text-sm text-muted-foreground">{t("catalogNoMatches")}</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={savingMetric} onOpenChange={setSavingMetric}>
        <DialogContent className="sm:max-w-md" data-testid="save-kennzahl-dialog"><DialogHeader><DialogTitle>{t("saveAsKennzahl")}</DialogTitle><DialogDescription>{t("saveAsKennzahlPrompt")}</DialogDescription></DialogHeader><Input autoFocus value={metricName} maxLength={120} aria-label={t("saveAsKennzahlPrompt")} onValueChange={setMetricName} onKeyDown={(event) => { if (event.key === "Enter") saveSelectionAsMetric(metricName); }} /><DialogFooter><Button variant="outline" onClick={() => setSavingMetric(false)}>{t("cancel")}</Button><Button disabled={!metricName.trim() || pending} onClick={() => saveSelectionAsMetric(metricName)}>{t("save")}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md" data-testid="delete-analysis-dialog"><DialogHeader><DialogTitle>{t("deleteAnalysis")}</DialogTitle><DialogDescription>{t("deleteAnalysisConfirm", { name: analysis.name })}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleting(false)}>{t("cancel")}</Button><Button variant="destructive" disabled={pending} onClick={removeAnalysis}>{t("delete")}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

function AnalysisLanding({
  analyses,
  metrics,
}: {
  analyses: MunicipalityAnalysisSummary[];
  metrics: MunicipalityMetricRecord[];
}) {
  const t = useTranslations("municipalities");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // No analysis is open here, so opening a derivation creates one for it.
  function openAsAnalysis(request: { label: string; dataset: MunicipalityDatasetRef }) {
    if (pending) return;
    startTransition(async () => {
      const created = await createMunicipalityAnalysis({
        name: request.label.slice(0, 120),
        dataset: request.dataset,
      });
      router.push(`/municipalities/analysis?analysis=${encodeURIComponent(created.id)}`);
    });
  }

  return (
    <div className="grid gap-4" data-testid="municipality-analysis-landing">
      <section className="overflow-hidden rounded-2xl border bg-gradient-to-br from-teal-50 via-background to-violet-50 shadow-sm dark:from-teal-950/35 dark:to-violet-950/25">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border bg-background/75 px-3 py-1 text-xs font-medium text-teal-800 shadow-sm dark:text-teal-200"><BarChart3 className="size-3.5" />{t("analysisTab")}</span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">{t("newAnalysis")}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("newAnalysisDescription")}</p>
          </div>
          <form action={createMunicipalityAnalysisAndRedirect} className="rounded-xl border bg-background/90 p-3 shadow-sm backdrop-blur">
            <Input name="name" maxLength={120} required placeholder={t("analysisNamePlaceholder")} />
            <Button className="mt-2 w-full" size="lg" type="submit"><Plus className="size-4" />{t("create")}</Button>
          </form>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{t("savedAnalyses")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("savedAnalysesDescription")}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {analyses.map((analysis) => (
            <button
              key={analysis.id}
              type="button"
              className="group rounded-xl border bg-background p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              onClick={() => router.push(`/municipalities/analysis?analysis=${encodeURIComponent(analysis.id)}`)}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200"><BarChart3 className="size-4" /></span>
                <span className="text-[10px] text-muted-foreground">{format.dateTime(analysis.updatedAt, { dateStyle: "medium" })}</span>
              </span>
              <span className="mt-4 block truncate text-sm font-semibold group-hover:text-teal-800 dark:group-hover:text-teal-200">{analysis.name}</span>
              <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3" />{analysis.municipalityName ?? t("analysisSubjectNone")}</span>
              <span className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-1">{t("analysisNodeCount", { count: analysis.nodeCount })}</span>
                <span className="rounded-full bg-muted px-2 py-1">{t("analysisNoteCount", { count: analysis.noteCount })}</span>
              </span>
              <span className="mt-3 block truncate text-[10px] text-muted-foreground">{t("analysisUpdatedAt", { date: format.dateTime(analysis.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
            </button>
          ))}
          {!analyses.length && <p className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noAnalyses")}</p>}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <DatasetCatalog variant="page" ownMetrics={metrics} onOpen={openAsAnalysis} />
      </section>
    </div>
  );
}

export function MunicipalityAnalysisClient({ analyses, initialAnalysis, metrics }: { analyses: MunicipalityAnalysisSummary[]; initialAnalysis: AnalysisRecord | null; metrics: MunicipalityMetricRecord[] }) {
  if (!initialAnalysis) return <AnalysisLanding analyses={analyses} metrics={metrics} />;
  return <ReactFlowProvider><AnalysisEditor key={initialAnalysis.id} analysis={initialAnalysis} analyses={analyses} metrics={metrics} /></ReactFlowProvider>;
}
