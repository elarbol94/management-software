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
import { BarChart3, Bookmark, Database, GripVertical, MapPin, Pencil, Pin, Plus, Save, Sigma, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createMunicipalityAnalysis,
  createMunicipalityAnalysisAndRedirect,
  deleteMunicipalityAnalysis,
  renameMunicipalityAnalysis,
  saveMunicipalityAnalysisNodeAsMetric,
} from "../actions";
import {
  ANALYSIS_OPERATION_VERSION,
  analysisOperatorIds,
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
import { searchMunicipalities, type MunicipalityIndexItem } from "../data";
import type { MapMetric } from "../demography";
import type { MovementTargetId } from "../movement";
import type { PopulationViewId } from "../structure";
import {
  bindKennzahlInput,
  expandKennzahlIntoGraph,
  kennzahlDerivationOperations,
  kennzahlExpressionFor,
  kennzahlFormulaText,
  KENNZAHL_CATALOG,
  nextGraphOrigin,
  type KennzahlDefinition,
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

const OPERATOR_SYMBOLS: Record<AnalysisOperatorId, string> = {
  add: "+", subtract: "−", multiply: "×", divide: "÷", "greater-than": ">",
  "greater-or-equal": "≥", "less-than": "<", "less-or-equal": "≤", equal: "=",
};
const OPERATOR_DRAG_TYPE = "application/x-municipality-analysis-operator";

function seriesErrorLabel(error: AnalysisSeries["error"], t: ReturnType<typeof useTranslations>) {
  if (!error) return null;
  if (error === "missing-input") return t("analysisMissingInput");
  if (error === "incompatible-units") return t("analysisIncompatibleUnits");
  return t("analysisMissingMunicipality");
}

type DisplayNodeData = {
  kind: "dataset" | "operator";
  title: string;
  subtitle: string;
  pinned?: boolean;
  symbol?: string;
  series: AnalysisSeries | null;
  errorLabel: string | null;
  warningLabel: string | null;
};
type DisplayNode = Node<DisplayNodeData, "dataset" | "operator">;

function AnalysisNodeCard({ data, selected }: NodeProps<DisplayNode>) {
  return (
    <div className={cn(
      "w-60 rounded-xl border bg-card shadow-md transition-shadow",
      selected && "border-teal-600 ring-2 ring-teal-600/20",
      data.errorLabel && "border-destructive/60",
    )}>
      {data.kind === "operator" && (
        <>
          <Handle type="target" id="a" position={Position.Left} style={{ top: "38%" }} />
          <Handle type="target" id="b" position={Position.Left} style={{ top: "72%" }} />
        </>
      )}
      <div className="drag-handle flex cursor-grab items-center gap-2 border-b px-3 py-2 active:cursor-grabbing">
        <GripVertical className="size-3.5 text-muted-foreground" />
        {data.kind === "dataset" ? <Database className="size-4 text-teal-700 dark:text-teal-300" /> : <span className="grid size-6 place-items-center rounded-md bg-violet-100 font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{data.symbol}</span>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{data.title}</p>
          <p className={cn("flex items-center gap-1 truncate text-[10px]", data.pinned ? "text-foreground" : "text-muted-foreground")}>
            {data.pinned && <Pin className="size-2.5 shrink-0" />}
            <span className="truncate">{data.subtitle}</span>
          </p>
        </div>
      </div>
      <div className="px-3 py-2">
        {data.errorLabel ? (
          <p className="flex min-h-14 items-center gap-2 text-xs text-destructive"><TriangleAlert className="size-4 shrink-0" />{data.errorLabel}</p>
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

/** One row: what the Kennzahl is called, and the formula it is actually computed from. */
function KennzahlRow({
  label,
  formula,
  derivable,
  variant,
  openLabel,
  onOpen,
}: {
  label: string;
  formula: string;
  derivable: boolean;
  variant: CatalogVariant;
  openLabel: string;
  onOpen: () => void;
}) {
  const page = variant === "page";
  if (!derivable) {
    return (
      <div className={cn("rounded-lg border border-dashed bg-muted/20 px-2 py-1.5", page && "px-3 py-2")}>
        <p className={cn("font-medium", page ? "text-sm" : "text-[11px]")}>{label}</p>
        <p className={cn("mt-0.5 text-muted-foreground", page ? "text-xs" : "text-[10px]")}>{formula}</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${label} — ${openLabel}`}
      className={cn(
        "rounded-lg border bg-background text-left hover:border-teal-600 hover:bg-teal-50 disabled:opacity-55 disabled:hover:border-border disabled:hover:bg-background dark:hover:bg-teal-950",
        page ? "px-3 py-2" : "px-2 py-1.5",
      )}
      onClick={onOpen}
    >
      <span className="flex items-center gap-1.5">
        <Sigma className={cn("shrink-0 text-teal-700 dark:text-teal-300", page ? "size-4" : "size-3")} />
        <span className={cn("font-medium", page ? "text-sm" : "text-[11px]")}>{label}</span>
      </span>
      {/* Never truncated: a formula cut off after three terms is not a derivation. */}
      <span className={cn("mt-1 block break-words text-muted-foreground", page ? "text-xs leading-5" : "text-[10px] leading-4")}>
        {formula}
      </span>
    </button>
  );
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

/**
 * Every Kennzahl the app computes, with the formula it is built from. Opening one puts
 * that derivation on a canvas as real Ausgangsdaten and operator nodes, so the way a
 * Kennzahl is calculated is something you can read and edit rather than take on trust.
 *
 * The formulas need no municipality — only turning one into a graph does.
 */
function KennzahlCatalog({
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
  const describe = (expression: KennzahlExpression | null) => (expression
    ? kennzahlFormulaText(expression, (input) => datasetTitle(input, t), (value) => format.number(value))
    : t("kennzahlPrimary"));

  const groups = useMemo(() => {
    const byCategory = new Map<MapMetric, KennzahlDefinition[]>();
    for (const definition of KENNZAHL_CATALOG) {
      byCategory.set(definition.category, [...(byCategory.get(definition.category) ?? []), definition]);
    }
    return [...byCategory];
  }, []);

  const categoryLabel = (category: MapMetric) => t(
    (category === "population" ? "metricPopulation"
      : category === "age" ? "metricAge"
        : category === "movement" ? "metricMovement"
          : category === "costs" ? "metricCosts"
            : category === "politics" ? "metricPolitics"
              : category === "digital" ? "metricDigital" : "metricCustom") as "metricPopulation",
  );

  return (
    <section className={cn(page ? "" : "mt-5 border-t pt-4")} data-testid="kennzahl-catalog">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={cn("font-semibold", page ? "text-xl" : "text-xs tracking-wide uppercase")}>
          {page ? t("kennzahlCatalogTitle") : t("kennzahlCatalog")}
        </h2>
        <span className={cn("text-muted-foreground", page ? "text-sm" : "text-[10px]")}>
          {page ? t("kennzahlCatalogDescription") : t("kennzahlCatalogHint")}
        </span>
      </div>

      <div className={cn("mt-3", page ? "grid gap-5" : "grid max-h-80 gap-3 overflow-y-auto pr-1")}>
        {groups.map(([category, definitions]) => (
          <div key={category}>
            <h3 className={cn("font-semibold text-muted-foreground", page ? "text-xs tracking-wide uppercase" : "text-[10px] uppercase")}>
              {categoryLabel(category)}
            </h3>
            <div className={cn("mt-1.5 grid gap-1.5", page && "sm:grid-cols-2 xl:grid-cols-3")}>
              {definitions.map((definition) => {
                const expression = kennzahlExpressionFor(definition.output);
                const label = t(definition.labelKey as "populationDensity");
                return (
                  <KennzahlRow
                    key={definition.id}
                    label={label}
                    formula={describe(expression)}
                    derivable={Boolean(expression)}
                    variant={variant}
                    openLabel={t("kennzahlOpenAsGraph")}
                    // Open, not pinned: the derivation is the same everywhere, and which
                    // municipality it is read for is the graph's business.
                    onOpen={() => onOpen({ label, dataset: bindKennzahlInput(definition.output) })}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {ownMetrics.length > 0 && (
          <div>
            <h3 className={cn("font-semibold text-muted-foreground", page ? "text-xs tracking-wide uppercase" : "text-[10px] uppercase")}>
              {t("kennzahlOwnSection")}
            </h3>
            <div className={cn("mt-1.5 grid gap-1.5", page && "sm:grid-cols-2 xl:grid-cols-3")}>
              {ownMetrics.map((metric) => (
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

function AnalysisEditor({ analysis, analyses }: { analysis: AnalysisRecord; analyses: MunicipalityAnalysisSummary[] }) {
  const t = useTranslations("municipalities");
  const router = useRouter();
  const reactFlow = useReactFlow<DisplayNode, Edge>();
  const { enqueue, getPendingOperations, getSaveState } = useMunicipalityAnalysisPersistence();
  const optimisticOperations = getPendingOperations(analysis.id);
  const [graph, setGraph] = useState(() => {
    return optimisticOperations.length
      ? applyMunicipalityAnalysisGraphOperations(analysis.graph, optimisticOperations, expandKennzahlIntoGraph).graph
      : analysis.graph;
  });
  const graphRef = useRef(graph);
  const [data, setData] = useState<MunicipalityAnalysisData | null>(null);
  const [dataError, setDataError] = useState(false);
  const saveState = getSaveState(analysis.id);
  const [name, setName] = useState(analysis.name);
  const [renaming, setRenaming] = useState(false);
  const [pending, startTransition] = useTransition();
  const datasetSignature = useMemo(() => JSON.stringify(graph.nodes.flatMap((node) => node.type === "dataset" ? [node.data.dataset] : [])), [graph.nodes]);
  const optimisticSignature = JSON.stringify(optimisticOperations);

  useEffect(() => {
    let cancelled = false;
    loadMunicipalityAnalysisData(graph).then((result) => { if (!cancelled) { setDataError(false); setData(result); } }).catch(() => { if (!cancelled) setDataError(true); });
    return () => { cancelled = true; };
    // Positions and selections do not change which data files are required.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetSignature]);

  useEffect(() => {
    if (!optimisticOperations.length) return;
    const next = applyMunicipalityAnalysisGraphOperations(graphRef.current, optimisticOperations, expandKennzahlIntoGraph).graph;
    graphRef.current = next;
    setGraph(next);
    // The signature changes only when the layout-level operation journal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticSignature]);

  const commitOperations = useCallback((
    operations: MunicipalityAnalysisGraphOperation[],
    options?: { debounceKey?: string; delay?: number },
  ) => {
    try {
      const next = applyMunicipalityAnalysisGraphOperations(graphRef.current, operations, expandKennzahlIntoGraph).graph;
      graphRef.current = next;
      setGraph(next);
      enqueue(analysis.id, operations, options);
      return true;
    } catch {
      toast.error(t("analysisNodeLimit"));
      return false;
    }
  }, [analysis.id, enqueue, t]);

  const results = useMemo(() => data ? evaluateAnalysisGraph(graph, data) : new Map<string, AnalysisSeries>(), [data, graph]);
  const displayNodes = useMemo<DisplayNode[]>(() => graph.nodes.map((node) => {
    const series = results.get(node.id) ?? null;
    const errorLabel = seriesErrorLabel(series?.error ?? null, t);
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: graph.selectedNodeId === node.id,
      dragHandle: ".drag-handle",
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
        series,
        errorLabel, warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
      } : {
        kind: "operator", title: t(`operator_${node.data.operator}`), subtitle: t("operatorNode"), symbol: OPERATOR_SYMBOLS[node.data.operator], series,
        errorLabel, warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
      },
    };
  }), [graph.nodes, graph.selectedNodeId, graph.subject, results, t]);
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
        const current = graphRef.current.nodes.find(({ id }) => id === change.id);
        if (current?.position.x === change.position.x && current.position.y === change.position.y) continue;
        commitOperations(
          [{
            version: ANALYSIS_OPERATION_VERSION, type: "move-node", nodeId: change.id, position: change.position,
          }],
          { debounceKey: `node-position:${change.id}`, delay: 500 },
        );
      } else if (change.type === "select") {
        const selectedNodeId = change.selected ? change.id : graphRef.current.selectedNodeId === change.id ? null : graphRef.current.selectedNodeId;
        if (selectedNodeId !== graphRef.current.selectedNodeId) {
          commitOperations([{ version: ANALYSIS_OPERATION_VERSION, type: "set-selected-node", nodeId: selectedNodeId }]);
        }
      }
    }
  }, [commitOperations, t]);

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

  function insertKennzahl(request: { label: string; dataset: MunicipalityDatasetRef }) {
    const operations = kennzahlDerivationOperations(
      request.dataset,
      nextGraphOrigin(graphRef.current.nodes),
      graphRef.current,
    );
    if (!operations) return;
    if (commitOperations(operations)) toast.success(t("kennzahlInserted", { kennzahl: request.label }));
  }

  /**
   * Turns the selected node into a reusable Kennzahl. The server reads the persisted
   * graph, so anything still queued has to land first — otherwise it would save a
   * half-built formula.
   */
  function saveSelectionAsMetric() {
    if (!selectedNode) return;
    if (saveState === "saving" || getPendingOperations(analysis.id).length) {
      toast.error(t("saveAsKennzahlPending"));
      return;
    }
    const name = window.prompt(t("saveAsKennzahlPrompt"), selectedTitle);
    if (!name?.trim()) return;
    startTransition(async () => {
      const result = await saveMunicipalityAnalysisNodeAsMetric({
        analysisId: analysis.id, nodeId: selectedNode.id, name,
      });
      if (result.ok) {
        toast.success(t("saveAsKennzahlSaved", { name: result.name }));
        return;
      }
      toast.error(t(
        result.reason === "mixed-municipalities" ? "saveAsKennzahlMixedMunicipalities"
          : result.reason === "no-municipality-input" ? "saveAsKennzahlNoMunicipality"
            : "saveAsKennzahlMissingInput",
      ));
    });
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
    if (!window.confirm(t("deleteAnalysisConfirm", { name: analysis.name }))) return;
    startTransition(async () => {
      await deleteMunicipalityAnalysis(analysis.id);
      router.push("/municipalities/analysis");
      router.refresh();
    });
  }

  return (
    <div className="grid min-h-[42rem] gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_20rem]" data-testid="municipality-analysis-editor">
      <aside className="rounded-2xl border bg-card p-3 shadow-sm">
        <label htmlFor="analysis-switcher" className="text-xs font-semibold text-muted-foreground">{t("savedAnalyses")}</label>
        <select id="analysis-switcher" className="mt-1 h-8 w-full rounded-lg border bg-background px-2 text-xs" value={analysis.id} onChange={(event) => router.push(`/municipalities/analysis?analysis=${encodeURIComponent(event.target.value)}`)}>
          {analyses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div className="mt-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide uppercase">{t("operators")}</h2>
          <span className="text-[10px] text-muted-foreground">{t("dragHint")}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {analysisOperatorIds.map((operator) => (
            <button
              key={operator}
              type="button"
              draggable
              className="grid h-10 place-items-center rounded-lg border bg-background text-lg font-semibold hover:border-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950"
              title={t(`operator_${operator}`)}
              aria-label={t("addOperator", { operator: t(`operator_${operator}`) })}
              onClick={() => addOperator(operator)}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(OPERATOR_DRAG_TYPE, operator); }}
            >{OPERATOR_SYMBOLS[operator]}</button>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-5 text-muted-foreground">{t("analysisUnitRule")}</p>
        <KennzahlCatalog variant="sidebar" onOpen={insertKennzahl} />
      </aside>

      <section className="relative min-h-[32rem] overflow-hidden rounded-2xl border bg-muted/20 shadow-sm">
        <div className="absolute top-3 right-3 left-3 z-10 flex items-center justify-between gap-3 rounded-xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            {renaming ? <Input className="max-w-xs" value={name} maxLength={120} autoFocus onValueChange={(value) => setName(value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") { setName(analysis.name); setRenaming(false); } }} /> : (
              <button className="flex max-w-full items-center gap-2 text-left" onClick={() => setRenaming(true)}>
                <span className="truncate font-semibold">{analysis.name}</span><Pencil className="size-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          {/* The graph is a formula; this is the municipality it is evaluated for. */}
          <div className="flex shrink-0 items-center gap-2">
            <MapPin className="size-3.5 text-muted-foreground" />
            <span className="max-w-40 truncate text-xs font-medium" data-testid="analysis-subject">
              {graph.subject?.municipalityName ?? t("analysisSubjectNone")}
            </span>
            <div className="w-40">
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
          <span className={cn("flex items-center gap-1 text-[11px]", saveState === "error" ? "text-destructive" : "text-muted-foreground")}>
            <Save className="size-3.5" />{t(saveState === "saving" ? "analysisSaving" : saveState === "error" ? "analysisSaveError" : "analysisSaved")}
          </span>
          <Button variant="destructive" size="icon-sm" disabled={pending} aria-label={t("deleteAnalysis")} onClick={removeAnalysis}><Trash2 className="size-3.5" /></Button>
        </div>
        <ReactFlow
          nodes={displayNodes}
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
          minZoom={0.25}
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
            const operator = event.dataTransfer.getData(OPERATOR_DRAG_TYPE) as AnalysisOperatorId;
            if (analysisOperatorIds.includes(operator)) addOperator(operator, reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
        >
          <Background gap={22} size={1} />
          <Controls position="bottom-left" />
        </ReactFlow>
        {!graph.nodes.length && <div className="pointer-events-none absolute inset-0 grid place-items-center p-8 text-center"><div><BarChart3 className="mx-auto size-10 text-muted-foreground" /><p className="mt-3 font-semibold">{t("emptyAnalysisTitle")}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("emptyAnalysisDescription")}</p></div></div>}
      </section>

      <aside className="rounded-2xl border bg-card p-4 shadow-sm" aria-live="polite">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("resultPreview")}</p>
        <h2 className="mt-1 truncate font-semibold">{selectedTitle}</h2>
        {dataError ? <p className="mt-5 flex gap-2 text-sm text-destructive"><TriangleAlert className="size-4 shrink-0" />{t("analysisDataError")}</p>
          : selectedSeries?.error ? <p className="mt-5 flex gap-2 text-sm text-destructive"><TriangleAlert className="size-4 shrink-0" />{seriesErrorLabel(selectedSeries.error, t)}</p>
            : selectedSeries ? <div className="mt-4"><AnalysisSeriesChart series={selectedSeries} label={selectedTitle} trueLabel={t("booleanTrue")} falseLabel={t("booleanFalse")} />{selectedSeries.warnings.length > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t("analysisDivisionWarnings", { count: selectedSeries.warnings.length })}</p>}<Button variant="outline" className="mt-4 w-full" disabled={pending} onClick={saveSelectionAsMetric}><Bookmark className="size-4" />{t("saveAsKennzahl")}</Button></div>
              : <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("analysisSelectResult")}</p>}
      </aside>
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
        <KennzahlCatalog variant="page" ownMetrics={metrics} onOpen={openAsAnalysis} />
      </section>
    </div>
  );
}

export function MunicipalityAnalysisClient({ analyses, initialAnalysis, metrics }: { analyses: MunicipalityAnalysisSummary[]; initialAnalysis: AnalysisRecord | null; metrics: MunicipalityMetricRecord[] }) {
  if (!initialAnalysis) return <AnalysisLanding analyses={analyses} metrics={metrics} />;
  return <ReactFlowProvider><AnalysisEditor key={initialAnalysis.id} analysis={initialAnalysis} analyses={analyses} /></ReactFlowProvider>;
}
