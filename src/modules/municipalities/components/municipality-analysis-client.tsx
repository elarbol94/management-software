"use client";

import "@xyflow/react/dist/style.css";
import { createId } from "@paralleldrive/cuid2";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { BarChart3, Database, GripVertical, Pencil, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createMunicipalityAnalysisAndRedirect,
  deleteMunicipalityAnalysis,
  renameMunicipalityAnalysis,
} from "../actions";
import {
  ANALYSIS_OPERATION_VERSION,
  analysisOperatorIds,
  applyMunicipalityAnalysisGraphOperations,
  evaluateAnalysisGraph,
  wouldCreateAnalysisCycle,
  type AnalysisOperatorId,
  type AnalysisSeries,
  type MunicipalityAnalysisData,
  type MunicipalityAnalysisGraph,
  type MunicipalityAnalysisGraphOperation,
  type MunicipalityDatasetRef,
} from "../analysis";
import { loadMunicipalityAnalysisData } from "../analysis-data";
import type { MunicipalityAnalysisSummary } from "../queries";
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

type DisplayNodeData = {
  kind: "dataset" | "operator";
  title: string;
  subtitle: string;
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
          <p className="truncate text-[10px] text-muted-foreground">{data.subtitle}</p>
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

function datasetTitle(dataset: MunicipalityDatasetRef, t: ReturnType<typeof useTranslations>) {
  if (dataset.kind === "cost-share") {
    return `${t("metricCosts")} · ${t(`costCategory${dataset.category}` as "costCategory0")}`;
  }
  if (dataset.kind === "population") {
    return t(dataset.view === "count" ? "populationCount" : dataset.view === "density" ? "populationDensity" : dataset.view === "foreign-share" ? "populationForeignShare" : "populationForeignPersons");
  }
  if (dataset.kind === "movement") {
    const key = dataset.metric === "population-change" ? "movementPopulationChange" : dataset.metric === "births" ? "movementBirths" : dataset.metric === "deaths" ? "movementDeaths" : dataset.metric === "birth-rate" ? "movementBirthRate" : dataset.metric === "death-rate" ? "movementDeathRate" : dataset.metric === "birth-balance-rate" ? "movementBirthBalanceRate" : dataset.metric === "arrivals" ? "movementArrivals" : dataset.metric === "departures" ? "movementDepartures" : dataset.metric === "migration-balance-rate" ? "movementMigrationBalanceRate" : dataset.metric === "international-migration-balance" ? "movementInternationalBalance" : dataset.metric === "international-migration-balance-rate" ? "movementInternationalBalanceRate" : dataset.metric === "internal-migration-balance" ? "movementInternalBalance" : dataset.metric === "internal-migration-balance-rate" ? "movementInternalBalanceRate" : "movementStatisticalCorrection";
    return t(key);
  }
  if (dataset.kind === "age-group") {
    const groupKey = `ageGroup${dataset.ageGroup}` as "ageGroup0-5";
    return `${t(groupKey)} · ${t(dataset.measure === "share" ? "ageMeasureShare" : "ageMeasurePersons")}`;
  }
  const key = dataset.indicator === "youth-share" ? "indicatorYouthShare" : dataset.indicator === "senior-share" ? "indicatorSeniorShare" : dataset.indicator === "old-age-dependency" ? "indicatorOldAgeDependency" : dataset.indicator === "child-dependency" ? "indicatorChildDependency" : dataset.indicator === "total-dependency" ? "indicatorTotalDependency" : dataset.indicator === "aging-index" ? "indicatorAgingIndex" : dataset.indicator === "average-age" ? "indicatorAverageAge" : dataset.indicator === "women-share" ? "indicatorWomenShare" : "indicatorWomenPer100Men";
  return t(key);
}

function AnalysisEditor({ analysis, analyses }: { analysis: AnalysisRecord; analyses: MunicipalityAnalysisSummary[] }) {
  const t = useTranslations("municipalities");
  const router = useRouter();
  const reactFlow = useReactFlow<DisplayNode, Edge>();
  const { enqueue, getPendingOperations, getSaveState } = useMunicipalityAnalysisPersistence();
  const optimisticOperations = getPendingOperations(analysis.id);
  const [graph, setGraph] = useState(() => {
    return optimisticOperations.length
      ? applyMunicipalityAnalysisGraphOperations(analysis.graph, optimisticOperations).graph
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
    const next = applyMunicipalityAnalysisGraphOperations(graphRef.current, optimisticOperations).graph;
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
      const next = applyMunicipalityAnalysisGraphOperations(graphRef.current, operations).graph;
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
    const errorLabel = series?.error === "missing-input" ? t("analysisMissingInput") : series?.error === "incompatible-units" ? t("analysisIncompatibleUnits") : null;
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: graph.selectedNodeId === node.id,
      dragHandle: ".drag-handle",
      data: node.type === "dataset" ? {
        kind: "dataset", title: datasetTitle(node.data.dataset, t), subtitle: node.data.dataset.municipalityName, series,
        errorLabel, warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
      } : {
        kind: "operator", title: t(`operator_${node.data.operator}`), subtitle: t("operatorNode"), symbol: OPERATOR_SYMBOLS[node.data.operator], series,
        errorLabel, warningLabel: series?.warnings.length ? t("analysisDivisionWarnings", { count: series.warnings.length }) : null,
      },
    };
  }), [graph.nodes, graph.selectedNodeId, results, t]);
  const displayEdges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({ ...edge, type: "smoothstep", animated: false })), [graph.edges]);
  const selectedNode = graph.selectedNodeId ? graph.nodes.find(({ id }) => id === graph.selectedNodeId) : null;
  const selectedSeries = selectedNode ? results.get(selectedNode.id) ?? null : null;
  const selectedTitle = selectedNode ? selectedNode.type === "dataset" ? datasetTitle(selectedNode.data.dataset, t) : t(`operator_${selectedNode.data.operator}`) : t("analysisNoResultSelected");

  const onNodesChange = useCallback((changes: NodeChange<DisplayNode>[]) => {
    for (const change of changes) {
      if (change.type === "remove") {
        commitOperations([{
          version: ANALYSIS_OPERATION_VERSION, type: "remove-node", nodeId: change.id,
        }]);
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
  }, [commitOperations]);

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
    <div className="grid min-h-[42rem] gap-3 xl:grid-cols-[12rem_minmax(0,1fr)_20rem]" data-testid="municipality-analysis-editor">
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
          : selectedSeries?.error ? <p className="mt-5 flex gap-2 text-sm text-destructive"><TriangleAlert className="size-4 shrink-0" />{t(selectedSeries.error === "missing-input" ? "analysisMissingInput" : "analysisIncompatibleUnits")}</p>
            : selectedSeries ? <div className="mt-4"><AnalysisSeriesChart series={selectedSeries} label={selectedTitle} trueLabel={t("booleanTrue")} falseLabel={t("booleanFalse")} />{selectedSeries.warnings.length > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t("analysisDivisionWarnings", { count: selectedSeries.warnings.length })}</p>}</div>
              : <p className="mt-5 text-sm leading-6 text-muted-foreground">{t("analysisSelectResult")}</p>}
      </aside>
    </div>
  );
}

function AnalysisLanding({ analyses }: { analyses: MunicipalityAnalysisSummary[] }) {
  const t = useTranslations("municipalities");
  const router = useRouter();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="municipality-analysis-landing">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{t("savedAnalyses")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("savedAnalysesDescription")}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {analyses.map((analysis) => <Button key={analysis.id} variant="outline" className="h-auto justify-start px-4 py-3" onClick={() => router.push(`/municipalities/analysis?analysis=${encodeURIComponent(analysis.id)}`)}><BarChart3 className="size-4" /><span className="truncate">{analysis.name}</span></Button>)}
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
  );
}

export function MunicipalityAnalysisClient({ analyses, initialAnalysis }: { analyses: MunicipalityAnalysisSummary[]; initialAnalysis: AnalysisRecord | null }) {
  if (!initialAnalysis) return <AnalysisLanding analyses={analyses} />;
  return <ReactFlowProvider><AnalysisEditor key={initialAnalysis.id} analysis={initialAnalysis} analyses={analyses} /></ReactFlowProvider>;
}
