"use client";

import "@xyflow/react/dist/style.css";
import { createId } from "@paralleldrive/cuid2";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
  useReactFlow,
} from "@xyflow/react";
import { BarChart3, Bookmark, ChevronDown, Copy, Database, Loader2, MapPin, Pencil, Pin, PinOff, Plus, Save, Search, Sigma, Trash2, TriangleAlert } from "lucide-react";
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
  analysisOperatorIds,
  analysisSeriesToCsv,
  isUnaryAnalysisOperator,
  MAX_ANALYSIS_SHIFT_YEARS,
  applyMunicipalityAnalysisGraphOperations,
  datasetMunicipalityName,
  evaluateAnalysisGraph,
  wouldCreateAnalysisCycle,
  type AnalysisOperatorId,
  type AnalysisSeries,
  type MunicipalityAnalysisData,
  type MunicipalityAnalysisGraph,
  type MunicipalityAnalysisGraphOperation,
  type MunicipalityDatasetRef,
} from "../analysis";
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
  kind: "dataset" | "operator";
  title: string;
  subtitle: string;
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
};
type DisplayNode = Node<DisplayNodeData, "dataset" | "operator">;

function AnalysisNodeCard({ data, selected }: NodeProps<DisplayNode>) {
  return (
    <div className={cn(
      "w-52 cursor-grab rounded-xl border bg-card shadow-md transition-shadow active:cursor-grabbing",
      selected && "border-teal-600 ring-2 ring-teal-600/20",
      data.errorLabel && "border-destructive/60",
    )}>
      {data.kind === "operator" && (
        <>
          <Handle type="target" id="a" position={Position.Left} style={{ top: data.singleInput ? "50%" : "38%" }} />
          {!data.singleInput && <Handle type="target" id="b" position={Position.Left} style={{ top: "72%" }} />}
        </>
      )}
      <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
        {data.kind === "dataset" ? <Database className="size-4 shrink-0 text-teal-700 dark:text-teal-300" /> : <span className="grid size-5 shrink-0 place-items-center rounded-md bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{data.symbol}</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{data.title}</p>
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
            <span className="truncate">{data.subtitle}</span>
          </p>
        </div>
      </div>
      <div className="px-2.5 py-2">
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
          <AnalysisSeriesChart series={data.series} label={data.title} compact trueLabel="1" falseLabel="0" />
        ) : <div className="h-14 animate-pulse rounded-md bg-muted" />}
        {data.warningLabel && <p className="mt-1 truncate text-[10px] text-amber-700 dark:text-amber-300">{data.warningLabel}</p>}
      </div>
      <Handle type="source" id="output" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { dataset: AnalysisNodeCard, operator: AnalysisNodeCard };

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

/** Drives the `open` attribute of the side panels: folded on a phone, always open from lg on. */
function useWideViewport() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

function AnalysisEditor({ analysis, analyses }: { analysis: AnalysisRecord; analyses: MunicipalityAnalysisSummary[] }) {
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
  const wide = useWideViewport();
  const [pending, startTransition] = useTransition();
  const [savingMetric, setSavingMetric] = useState(false);
  const [metricName, setMetricName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);
  // Undo restores a whole earlier graph rather than inverting operations, so this is a
  // bounded stack of snapshots. Selection and viewport are excluded: they would fill it
  // with entries that look like nothing happened.
  const undoStack = useRef<MunicipalityAnalysisGraph[]>([]);
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
    options?: { debounceKey?: string; delay?: number },
  ) => {
    try {
      const before = graphRef.current;
      const next = applyMunicipalityAnalysisGraphOperations(before, operations, expandKennzahlIntoGraph).graph;
      if (operations.some(({ type }) => type !== "set-selected-node" && type !== "set-viewport")) {
        undoStack.current = [...undoStack.current, before].slice(-UNDO_DEPTH);
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
  }, [analysis.id, enqueue, markApplied, setGraph, t]);

  // Debounced: editing a constant is typing, and each keystroke should not become its own
  // entry in the operation journal.
  const setNodeValue = useCallback((nodeId: string, value: number) => {
    if (!Number.isFinite(value)) return;
    commitOperations(
      [{ version: ANALYSIS_OPERATION_VERSION, type: "set-node-value", nodeId, value }],
      { debounceKey: `node-value:${nodeId}`, delay: 400 },
    );
  }, [commitOperations]);

  /**
   * Undo restores the graph as it stood before the last edit and writes that whole graph,
   * rather than trying to invert each operation. The queue is drained first so a delayed
   * move cannot land on top of the restored state.
   */
  const undoLastEdit = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    graphRef.current = previous;
    setGraph(previous);
    setDragPositions(null);
    startTransition(async () => {
      await flush(analysis.id);
      await saveMunicipalityAnalysisGraph({ analysisId: analysis.id, graph: previous });
      toast(t("analysisUndone"));
      router.refresh();
    });
  }, [analysis.id, flush, router, setDragPositions, setGraph, startTransition, t]);

  // Ctrl/Cmd+Z anywhere on the page, except while typing into a field — a node's constant
  // and the analysis name both live in inputs with their own undo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      undoLastEdit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoLastEdit]);

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
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: graph.selectedNodeId === node.id,
      data: node.type === "dataset" ? {
        kind: "dataset",
        title: datasetTitle(node.data.dataset, t),
        // Pinned nodes name their own municipality; open ones show the graph's, so
        // switching the subject visibly moves them and leaves the pinned ones behind.
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
        errorLabel, warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
      } : {
        kind: "operator", title: t(`operator_${node.data.operator}`), subtitle: t("operatorNode"), symbol: ANALYSIS_OPERATOR_SYMBOLS[node.data.operator], series,
        singleInput: isUnaryAnalysisOperator(node.data.operator),
        editor: isUnaryAnalysisOperator(node.data.operator)
          ? { value: node.data.years ?? 1, label: t("shiftYears"), min: 1, max: MAX_ANALYSIS_SHIFT_YEARS, step: 1, commit: (value: number) => setNodeValue(node.id, value) }
          : undefined,
        errorLabel, warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
      },
    };
  }), [graph.nodes, graph.selectedNodeId, graph.subject, results, setNodeValue, togglePin, t]);
  const positionedNodes = useMemo<DisplayNode[]>(() => (dragPositions
    ? displayNodes.map((node) => (dragPositions[node.id] ? { ...node, position: dragPositions[node.id] } : node))
    : displayNodes), [displayNodes, dragPositions]);
  const displayEdges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({ ...edge, type: "smoothstep", animated: false })), [graph.edges]);
  const selectedNode = graph.selectedNodeId ? graph.nodes.find(({ id }) => id === graph.selectedNodeId) : null;
  const selectedSeries = selectedNode ? results.get(selectedNode.id) ?? null : null;
  const selectedTitle = selectedNode ? selectedNode.type === "dataset" ? datasetTitle(selectedNode.data.dataset, t) : t(`operator_${selectedNode.data.operator}`) : t("analysisNoResultSelected");

  const onNodesChange = useCallback((changes: NodeChange<DisplayNode>[]) => {
    for (const change of changes) {
      if (change.type === "remove") {
        // Backspace/Delete removes a node straight into the persisted graph, so the
        // removal has to be reversible: keep the node and its edges for the undo action.
        const removedNode = graphRef.current.nodes.find(({ id }) => id === change.id);
        const removedEdges = graphRef.current.edges.filter(
          ({ source, target }) => source === change.id || target === change.id,
        );
        commitOperations([{
          version: ANALYSIS_OPERATION_VERSION, type: "remove-node", nodeId: change.id,
        }]);
        if (removedNode) {
          toast(t("analysisNodeRemoved"), {
            action: {
              label: t("analysisUndo"),
              onClick: () => commitOperations([
                { version: ANALYSIS_OPERATION_VERSION, type: "add-node", node: removedNode },
                ...removedEdges.map((edge): MunicipalityAnalysisGraphOperation => ({
                  version: ANALYSIS_OPERATION_VERSION, type: "add-edge", edge,
                })),
              ]),
            },
          });
        }
      } else if (change.type === "position" && change.position) {
        const { id, position } = change;
        if (change.dragging) {
          setDragPositions((current) => ({ ...current, [id]: position }));
          continue;
        }
        setDragPositions(null);
        const current = graphRef.current.nodes.find((node) => node.id === id);
        if (current?.position.x === position.x && current.position.y === position.y) continue;
        commitOperations(
          [{ version: ANALYSIS_OPERATION_VERSION, type: "move-node", nodeId: id, position }],
          { debounceKey: `node-position:${id}`, delay: 500 },
        );
      } else if (change.type === "select") {
        const selectedNodeId = change.selected ? change.id : graphRef.current.selectedNodeId === change.id ? null : graphRef.current.selectedNodeId;
        if (selectedNodeId !== graphRef.current.selectedNodeId) {
          commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-selected-node", nodeId: selectedNodeId }]);
        }
      }
    }
  }, [commitOperations, setDragPositions, t]);

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

  function addOperator(operator: AnalysisOperatorId, position?: { x: number; y: number }) {
    if (graphRef.current.nodes.length >= 100) { toast.error(t("analysisNodeLimit")); return; }
    const id = createId();
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-node",
      node: { id, type: "operator", position: position ?? { x: 360, y: 120 + graphRef.current.nodes.length * 30 }, data: { operator } },
    }]);
  }

  function addConstant(position?: { x: number; y: number }) {
    if (graphRef.current.nodes.length >= 100) { toast.error(t("analysisNodeLimit")); return; }
    commitOperations([{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-node",
      node: {
        id: createId(), type: "dataset",
        position: position ?? { x: 360, y: 120 + graphRef.current.nodes.length * 30 },
        data: { dataset: { kind: "constant", value: 0 } },
      },
    }]);
  }

  /**
   * Puts a catalog entry on the canvas. One operation for both catalogs: `add-kennzahl`
   * expands a derivation into real nodes and falls back to a single node for an
   * Ausgangsdatum, which is exactly the difference between the two lists.
   */
  function insertDataset(request: { label: string; dataset: MunicipalityDatasetRef }) {
    const inserted = commitOperations([{
      version: ANALYSIS_OPERATION_VERSION, type: "add-kennzahl", nodeId: createId(), dataset: request.dataset,
    }]);
    if (inserted) toast.success(t("kennzahlInserted", { kennzahl: request.label }));
  }

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


  // The grid row is an explicit 1fr rather than auto: the catalog and the year table are
  // taller than the screen, and an auto row would grow to fit them instead of letting them
  // scroll inside their own panel.
  return (
    <div className="grid gap-2 lg:h-full lg:min-h-[34rem] lg:grid-cols-[13rem_minmax(0,1fr)_16rem] lg:grid-rows-[minmax(0,1fr)]" data-analysis-editor data-testid="municipality-analysis-editor">
      {/* Native <details>: the side panels fold away on a phone and are permanently
          open from lg on, where the summary is hidden. */}
      {/* The panel itself scrolls rather than a box inside it: Chrome wraps a <details>
          element's children in ::details-content, so `flex` on the element does not make
          them flex items and a nested `flex-1` scroll area never gets a height. */}
      <details className="group rounded-2xl border bg-card px-3 py-2 shadow-sm lg:min-h-0 lg:overflow-y-auto lg:[&>summary]:hidden" open={wide}>
        <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold tracking-wide uppercase [&::-webkit-details-marker]:hidden">
          {t("operators")}<ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <label htmlFor="analysis-switcher" className="mt-2 block text-[11px] font-semibold text-muted-foreground">{t("savedAnalyses")}</label>
        <select id="analysis-switcher" className="mt-1 h-8 w-full rounded-lg border bg-background px-2 text-xs" value={analysis.id} onChange={(event) => router.push(`/municipalities/analysis?analysis=${encodeURIComponent(event.target.value)}`)}>
          {/* Two analyses may share a name; the municipality and the size are what tell
              them apart in a flat list. */}
          {analyses.map((item) => <option key={item.id} value={item.id}>{analysisOptionLabel(item, t)}</option>)}
        </select>
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-semibold tracking-wide uppercase">{t("operators")}</h2>
          <span className="truncate text-[10px] text-muted-foreground">{t("dragHint")}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-6 gap-1 sm:grid-cols-8 lg:grid-cols-3">
          {analysisOperatorIds.map((operator) => (
            <button
              key={operator}
              type="button"
              draggable
              className="grid h-9 place-items-center rounded-lg border bg-background font-semibold hover:border-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950"
              title={t(`operator_${operator}`)}
              aria-label={t("addOperator", { operator: t(`operator_${operator}`) })}
              onClick={() => addOperator(operator)}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(OPERATOR_DRAG_TYPE, operator); }}
            >{ANALYSIS_OPERATOR_SYMBOLS[operator]}</button>
          ))}
          <button
            type="button"
            draggable
            className="grid h-9 place-items-center rounded-lg border bg-background text-xs font-semibold hover:border-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950"
            title={t("constantNode")}
            aria-label={t("addConstant")}
            onClick={() => addConstant()}
            onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(OPERATOR_DRAG_TYPE, CONSTANT_DRAG_VALUE); }}
          >123</button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{t("analysisUnitRule")}</p>
        <DatasetCatalog variant="sidebar" onOpen={insertDataset} />
      </details>

      <section className="flex min-h-[65vh] flex-col overflow-hidden rounded-2xl border bg-muted/20 shadow-sm lg:min-h-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-2 py-1.5">
          <div className="min-w-0 flex-1">
            {renaming ? <Input className="h-8 max-w-xs text-sm" value={name} maxLength={120} autoFocus onValueChange={(value) => setName(value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") { setName(analysis.name); setRenaming(false); } }} /> : (
              <button className="flex max-w-full items-center gap-1.5 text-left" onClick={() => setRenaming(true)}>
                <span className="truncate text-sm font-semibold">{analysis.name}</span><Pencil className="size-3 shrink-0 text-muted-foreground" />
              </button>
            )}
          </div>
          <span className={cn("flex items-center gap-1 text-[11px]", saveState === "error" ? "text-destructive" : "text-muted-foreground")}>
            <Save className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">{t(saveState === "saving" ? "analysisSaving" : saveState === "error" ? "analysisSaveError" : "analysisSaved")}</span>
          </span>
          <Button variant="ghost" size="icon-sm" className="text-destructive" disabled={pending} aria-label={t("deleteAnalysis")} onClick={() => setDeleting(true)}><Trash2 className="size-3.5" /></Button>
          {/* The graph is a formula; this is the municipality it is evaluated for. */}
          <div className="flex w-full items-center gap-1.5 lg:w-auto">
            <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-32 truncate text-[11px] font-medium" data-testid="analysis-subject">
              {graph.subject?.municipalityName ?? t("analysisSubjectNone")}
            </span>
            <div className="min-w-0 flex-1 lg:w-36 lg:flex-none">
              <MunicipalityPicker
                compact
                label={t("analysisSubject")}
                placeholder={t("kennzahlMunicipalityPlaceholder")}
                onPick={(item) => commitOperations([{
                  version: ANALYSIS_OPERATION_VERSION,
                  type: "set-subject",
                  subject: { municipalityCode: item.municipalityCode, municipalityName: item.name },
                }])}
              />
            </div>
          </div>
        </div>
        <div className="relative min-h-0 flex-1" ref={flowRef}>
          <ReactFlow
            nodes={positionedNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={(changes) => {
              for (const change of changes) {
                if (change.type === "remove") {
                  commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "remove-edge", edgeId: change.id }]);
                }
              }
            }}
            onConnect={connect}
            onMoveEnd={(_, viewport: Viewport) => {
              const current = graphRef.current.viewport;
              if (current.x === viewport.x && current.y === viewport.y && current.zoom === viewport.zoom) return;
              commitOperations(
                [{ version: ANALYSIS_OPERATION_VERSION, type: "set-viewport", viewport }],
                { debounceKey: "viewport", delay: 500 },
              );
            }}
            defaultViewport={graph.viewport}
            minZoom={0.2}
            maxZoom={2}
            fitView={!graph.nodes.length}
            deleteKeyCode={["Backspace", "Delete"]}
            onPaneClick={() => {
              if (graphRef.current.selectedNodeId) {
                commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-selected-node", nodeId: null }]);
              }
            }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes(OPERATOR_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
            onDrop={(event) => {
              event.preventDefault();
              const payload = event.dataTransfer.getData(OPERATOR_DRAG_TYPE);
              const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
              if (payload === CONSTANT_DRAG_VALUE) addConstant(position);
              else if (analysisOperatorIds.includes(payload as AnalysisOperatorId)) addOperator(payload as AnalysisOperatorId, position);
            }}
          >
            <Background gap={20} size={1} />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
          {!graph.nodes.length && <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center"><div><BarChart3 className="mx-auto size-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{t("emptyAnalysisTitle")}</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("emptyAnalysisDescription")}</p></div></div>}
          {/* The data files are megabytes of national statistics. Until they arrive the
              nodes are on the canvas but every chart is blank, which looks like a broken
              graph rather than one that is still loading. */}
          {!data && !dataError && graph.nodes.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-2 grid place-items-center" role="status">
              <span className="flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1 text-xs shadow-sm backdrop-blur">
                <Loader2 className="size-3.5 animate-spin" />{t("analysisDataLoading")}
              </span>
            </div>
          )}
        </div>
      </section>

      <details className="group rounded-2xl border bg-card px-3 py-2 shadow-sm lg:min-h-0 lg:overflow-y-auto lg:[&>summary]:hidden" open={wide} aria-live="polite">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate text-xs font-semibold tracking-wide uppercase">{t("resultPreview")}</span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <h2 className="mt-1 truncate text-sm font-semibold">{selectedTitle}</h2>
        {dataError ? <p className="mt-3 flex gap-2 text-xs text-destructive"><TriangleAlert className="size-4 shrink-0" />{t("analysisDataError")}</p>
          : selectedSeries?.error ? <p className="mt-3 flex gap-2 text-xs text-destructive"><TriangleAlert className="size-4 shrink-0" />{seriesErrorLabel(selectedSeries.error, t)}</p>
            : selectedSeries ? (
              <div className="mt-2">
                <AnalysisSeriesChart series={selectedSeries} label={selectedTitle} trueLabel={t("booleanTrue")} falseLabel={t("booleanFalse")} />
                {selectedSeries.warnings.length > 0 && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{t("analysisDivisionWarnings", { count: selectedSeries.warnings.length })}</p>}
                <div className="mt-3 grid gap-2">
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => { setMetricName(selectedTitle); setSavingMetric(true); }}>
                    <Bookmark className="size-4" />{t("saveAsKennzahl")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={copySeriesAsCsv}>
                    <Copy className="size-4" />{t("copyCsv")}
                  </Button>
                </div>
                {/* The chart shows the shape; only the table lets a year be read off and
                    checked against the source. */}
                <div className="mt-3 rounded-lg border">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                      <tr><th scope="col" className="px-2 py-1 text-left font-medium">{t("csvYearHeader")}</th><th scope="col" className="px-2 py-1 text-right font-medium">{t("analysisValueHeader")}</th></tr>
                    </thead>
                    <tbody>
                      {[...selectedSeries.points].reverse().map(({ year, value }) => (
                        <tr key={year} className="border-t">
                          <td className="px-2 py-1">{year}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {value === null ? "—" : typeof value === "boolean" ? (value ? t("booleanTrue") : t("booleanFalse")) : format.number(value, { maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("analysisSelectResult")}</p>}
      </details>

      <Dialog open={savingMetric} onOpenChange={setSavingMetric}>
        <DialogContent className="sm:max-w-md" data-testid="save-kennzahl-dialog">
          <DialogHeader>
            <DialogTitle>{t("saveAsKennzahl")}</DialogTitle>
            <DialogDescription>{t("saveAsKennzahlPrompt")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={metricName}
            maxLength={120}
            aria-label={t("saveAsKennzahlPrompt")}
            onValueChange={(value) => setMetricName(value)}
            onKeyDown={(event) => { if (event.key === "Enter") saveSelectionAsMetric(metricName); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavingMetric(false)}>{t("cancel")}</Button>
            <Button disabled={!metricName.trim() || pending} onClick={() => saveSelectionAsMetric(metricName)}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md" data-testid="delete-analysis-dialog">
          <DialogHeader>
            <DialogTitle>{t("deleteAnalysis")}</DialogTitle>
            <DialogDescription>{t("deleteAnalysisConfirm", { name: analysis.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>{t("cancel")}</Button>
            <Button variant="destructive" disabled={pending} onClick={removeAnalysis}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{t("savedAnalyses")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("savedAnalysesDescription")}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {analyses.map((analysis) => <Button key={analysis.id} variant="outline" className="h-auto justify-start gap-3 px-4 py-3" onClick={() => router.push(`/municipalities/analysis?analysis=${encodeURIComponent(analysis.id)}`)}>
            <BarChart3 className="size-4 shrink-0" />
            <span className="min-w-0 text-left">
              <span className="block truncate">{analysis.name}</span>
              {/* Names repeat; the municipality and the size are what tell two apart. */}
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {[analysis.municipalityName, t("analysisNodeCount", { count: analysis.nodeCount })].filter(Boolean).join(" · ")}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{t("analysisUpdatedAt", { date: format.dateTime(analysis.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
            </span>
          </Button>)}
          {!analyses.length && <p className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noAnalyses")}</p>}
        </div>
      </section>
      <aside className="rounded-2xl border bg-muted/25 p-5">
        <h2 className="font-semibold">{t("newAnalysis")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("newAnalysisDescription")}</p>
        <form action={createMunicipalityAnalysisAndRedirect}>
          <Input className="mt-4" name="name" maxLength={120} required placeholder={t("analysisNamePlaceholder")} />
          <Button className="mt-2 w-full" type="submit"><Plus className="size-4" />{t("create")}</Button>
        </form>
        </aside>
      </div>

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <DatasetCatalog variant="page" ownMetrics={metrics} onOpen={openAsAnalysis} />
      </section>
    </div>
  );
}

export function MunicipalityAnalysisClient({ analyses, initialAnalysis, metrics }: { analyses: MunicipalityAnalysisSummary[]; initialAnalysis: AnalysisRecord | null; metrics: MunicipalityMetricRecord[] }) {
  if (!initialAnalysis) return <AnalysisLanding analyses={analyses} metrics={metrics} />;
  return <ReactFlowProvider><AnalysisEditor key={initialAnalysis.id} analysis={initialAnalysis} analyses={analyses} /></ReactFlowProvider>;
}
