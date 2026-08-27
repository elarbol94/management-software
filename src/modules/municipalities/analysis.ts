import { z } from "zod";
import {
  municipalityCostAbsolute,
  municipalityCostShare,
  median,
  municipalityCostPerCapita,
  municipalityCostRealPerCapita,
  municipalityPopulationBand,
  type MunicipalityCostSeries,
} from "./costs";
import type { MunicipalityIndex } from "./data";
import {
  demographicIndicatorUnit,
  demographicIndicatorValue,
  demographyMetricValue,
  type MunicipalityDemographySeries,
} from "./demography";
import {
  movementTargetUnit,
  movementTargetValue,
  type MunicipalityMovementSeries,
} from "./movement";
import type { MunicipalityPopulationSeries } from "./population";
import {
  populationViewUnit,
  populationViewValue,
  type MunicipalityStructureSeries,
} from "./structure";

export const ANALYSIS_GRAPH_VERSION = 2;
export const MAX_ANALYSIS_NODES = 100;
export const MAX_ANALYSIS_EDGES = 200;
export const MAX_ANALYSIS_JSON_BYTES = 250_000;

export const DEFAULT_ANALYSIS_NODE_WIDTH = 240;
export const DEFAULT_ANALYSIS_NODE_HEIGHT = 176;
export const MIN_ANALYSIS_NODE_WIDTH = 200;
export const MIN_ANALYSIS_NODE_HEIGHT = 140;
export const MAX_ANALYSIS_NODE_WIDTH = 640;
export const MAX_ANALYSIS_NODE_HEIGHT = 480;
export const DEFAULT_ANALYSIS_NOTE_WIDTH = 240;
export const DEFAULT_ANALYSIS_NOTE_HEIGHT = 160;
export const MIN_ANALYSIS_NOTE_WIDTH = 160;
export const MIN_ANALYSIS_NOTE_HEIGHT = 100;
export const analysisAnnotationColors = ["gray", "sand", "blue", "green"] as const;
export type AnalysisAnnotationColor = (typeof analysisAnnotationColors)[number];

export const analysisBinaryOperatorIds = [
  "add", "subtract", "multiply", "divide", "greater-than",
  "greater-or-equal", "less-than", "less-or-equal", "equal", "not-equal",
  "and", "or",
] as const;
/** Operators reading input A plus a number typed into the node, rather than a second input. */
export const analysisUnaryOperatorIds = ["shift"] as const;
export const analysisOperatorIds = [...analysisBinaryOperatorIds, ...analysisUnaryOperatorIds] as const;
export type AnalysisOperatorId = (typeof analysisOperatorIds)[number];
export type AnalysisBinaryOperatorId = (typeof analysisBinaryOperatorIds)[number];
export type AnalysisUnaryOperatorId = (typeof analysisUnaryOperatorIds)[number];
export const isUnaryAnalysisOperator = (operator: AnalysisOperatorId): operator is AnalysisUnaryOperatorId =>
  (analysisUnaryOperatorIds as readonly string[]).includes(operator);

export const ANALYSIS_OPERATOR_SYMBOLS: Record<AnalysisOperatorId, string> = {
  add: "+", subtract: "−", multiply: "×", divide: "÷", "greater-than": ">",
  "greater-or-equal": "≥", "less-than": "<", "less-or-equal": "≤", equal: "=",
  "not-equal": "≠", and: "∧", or: "∨", shift: "↺",
};

/** How many years a shift may reach back; also the default when the node carries none. */
export const MAX_ANALYSIS_SHIFT_YEARS = 20;
export const DEFAULT_ANALYSIS_SHIFT_YEARS = 1;

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const analysisSubjectSchema = z.object({
  municipalityCode: z.string().regex(/^\d{5}$/),
  municipalityName: z.string().trim().min(1).max(160),
});
export type AnalysisSubject = z.infer<typeof analysisSubjectSchema>;
/**
 * A dataset node is either pinned to a municipality or left open, in which case it follows
 * the graph's subject. A Kennzahl is the same formula everywhere, so open is the normal
 * case; pinning is what makes comparing two municipalities in one graph possible.
 */
const pinnedMunicipality = {
  municipalityCode: z.string().regex(/^\d{5}$/).optional(),
  municipalityName: z.string().trim().min(1).max(160).optional(),
};

export const municipalityDatasetRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("population"), ...pinnedMunicipality, view: z.enum(["count", "density", "foreign-share", "foreign-persons", "structure-population"]) }),
  z.object({
    kind: z.literal("age-group"), ...pinnedMunicipality,
    ageGroup: z.enum(["0-5", "6-14", "15-24", "25-44", "45-64", "65-79", "80-plus", "total"]),
    measure: z.enum(["share", "persons"]), sex: z.enum(["all", "female", "male"]),
  }),
  z.object({
    kind: z.literal("age-indicator"), ...pinnedMunicipality,
    indicator: z.enum(["youth-share", "senior-share", "old-age-dependency", "child-dependency", "total-dependency", "aging-index", "average-age", "women-share", "women-per-100-men"]),
  }),
  z.object({
    kind: z.literal("movement"), ...pinnedMunicipality,
    metric: z.enum(["population-change", "births", "deaths", "birth-rate", "death-rate", "birth-balance-rate", "arrivals", "departures", "migration-balance-rate", "international-migration-balance", "international-migration-balance-rate", "internal-migration-balance", "internal-migration-balance-rate", "statistical-correction", "international-arrivals", "international-departures", "internal-arrivals", "internal-departures"]),
  }),
  z.object({
    kind: z.literal("cost-share"), ...pinnedMunicipality,
    category: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "total"]),
    measure: z.enum(["absolute", "share", "per-capita", "real-per-capita", "peer-deviation"]).optional(),
  }),
  z.object({
    kind: z.literal("attribute"), ...pinnedMunicipality,
    field: z.literal("area"),
  }),
  // Dimensionless scalar. Rates and shares are only expressible from Ausgangsdaten with
  // one — Geburtenrate is births / population * 1000 — so it carries no municipality.
  z.object({ kind: z.literal("constant"), value: z.number().finite() }),
]);
export type MunicipalityDatasetRef = z.infer<typeof municipalityDatasetRefSchema>;

const analysisAliasSchema = z.string().trim().min(1).max(120).nullable().optional();
const analysisComputationalSize = {
  width: z.number().finite().min(MIN_ANALYSIS_NODE_WIDTH).max(MAX_ANALYSIS_NODE_WIDTH).optional(),
  height: z.number().finite().min(MIN_ANALYSIS_NODE_HEIGHT).max(MAX_ANALYSIS_NODE_HEIGHT).optional(),
};

export const analysisDatasetNodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("dataset"), position: positionSchema,
  ...analysisComputationalSize,
  data: z.object({ dataset: municipalityDatasetRefSchema, alias: analysisAliasSchema }),
});
export const analysisOperatorNodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("operator"), position: positionSchema,
  ...analysisComputationalSize,
  // Only the unary operators read `years`; older graphs carry none and take the default.
  data: z.object({
    operator: z.enum(analysisOperatorIds),
    years: z.number().int().min(1).max(MAX_ANALYSIS_SHIFT_YEARS).optional(),
    alias: analysisAliasSchema,
  }),
});
export const analysisAnnotationNodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("annotation"), position: positionSchema,
  width: z.number().finite().min(MIN_ANALYSIS_NOTE_WIDTH).max(MAX_ANALYSIS_NODE_WIDTH).optional(),
  height: z.number().finite().min(MIN_ANALYSIS_NOTE_HEIGHT).max(MAX_ANALYSIS_NODE_HEIGHT).optional(),
  data: z.object({
    text: z.string().max(2_000),
    color: z.enum(analysisAnnotationColors),
  }),
});
export const analysisNodeSchema = z.discriminatedUnion("type", [analysisDatasetNodeSchema, analysisOperatorNodeSchema, analysisAnnotationNodeSchema]);
export const analysisEdgeSchema = z.object({
  id: z.string().min(1).max(140), source: z.string().min(1).max(100), target: z.string().min(1).max(100),
  sourceHandle: z.literal("output").default("output"), targetHandle: z.enum(["a", "b"]),
});
const municipalityAnalysisGraphV2Schema = z.object({
  version: z.literal(ANALYSIS_GRAPH_VERSION),
  nodes: z.array(analysisNodeSchema).max(MAX_ANALYSIS_NODES),
  edges: z.array(analysisEdgeSchema).max(MAX_ANALYSIS_EDGES),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(0.1).max(4) }),
  selectedNodeId: z.string().max(100).nullable(),
  // Which municipality the open nodes are about. Defaulted so graphs stored before the
  // subject existed keep parsing — they are simply pinned throughout.
  subject: analysisSubjectSchema.nullable().default(null),
}).superRefine((graph, context) => {
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodeIds.size !== graph.nodes.length) context.addIssue({ code: "custom", message: "Node ids must be unique" });
  if (graph.selectedNodeId && !nodeIds.has(graph.selectedNodeId)) context.addIssue({ code: "custom", message: "Selected node must exist" });
  const inputIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) context.addIssue({ code: "custom", message: "Edges must reference existing nodes" });
    if (nodesById.get(edge.target)?.type !== "operator") context.addIssue({ code: "custom", message: "Edges can only target operators" });
    if (nodesById.get(edge.source)?.type === "annotation") context.addIssue({ code: "custom", message: "Annotations cannot be connected" });
    const inputId = `${edge.target}:${edge.targetHandle}`;
    if (inputIds.has(inputId)) context.addIssue({ code: "custom", message: "Each operator input accepts one edge" });
    inputIds.add(inputId);
  }
  if (graph.edges.some((edge) => wouldCreateAnalysisCycle(graph.edges, edge.source, edge.target))) {
    context.addIssue({ code: "custom", message: "Analysis graph must not contain cycles" });
  }
});
export const municipalityAnalysisGraphSchema = z.preprocess((input) => {
  if (input && typeof input === "object" && "version" in input && input.version === 1) {
    return { ...input, version: ANALYSIS_GRAPH_VERSION };
  }
  return input;
}, municipalityAnalysisGraphV2Schema);
export type MunicipalityAnalysisGraph = z.infer<typeof municipalityAnalysisGraphSchema>;
export type MunicipalityAnalysisNode = z.infer<typeof analysisNodeSchema>;
export type MunicipalityAnalysisEdge = z.infer<typeof analysisEdgeSchema>;

export const ANALYSIS_OPERATION_VERSION = 1;
export const municipalityAnalysisGraphOperationSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("add-node"), node: analysisNodeSchema }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("remove-node"), nodeId: z.string().min(1).max(100) }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("move-node"), nodeId: z.string().min(1).max(100), position: positionSchema }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("add-edge"), edge: analysisEdgeSchema }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("remove-edge"), edgeId: z.string().min(1).max(140) }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-viewport"), viewport: municipalityAnalysisGraphV2Schema.shape.viewport }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-selected-node"), nodeId: z.string().max(100).nullable() }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("add-dataset"), nodeId: z.string().min(1).max(100), dataset: municipalityDatasetRefSchema }),
  // Like add-dataset, but for a Kennzahl: the graph decides how it lands, because only it
  // knows which Ausgangsdaten are already on the canvas and where there is room.
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("add-kennzahl"), nodeId: z.string().min(1).max(100), dataset: municipalityDatasetRefSchema }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-subject"), subject: analysisSubjectSchema.nullable() }),
  // The number typed into a node: a constant's value, or a unary operator's year count.
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-node-value"), nodeId: z.string().min(1).max(100), value: z.number().finite() }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-node-title"), nodeId: z.string().min(1).max(100), title: z.string().trim().min(1).max(120).nullable() }),
  z.object({
    version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("resize-node"), nodeId: z.string().min(1).max(100),
    position: positionSchema, width: z.number().finite().positive(), height: z.number().finite().positive(),
  }),
  z.object({
    version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-annotation"), nodeId: z.string().min(1).max(100),
    text: z.string().max(2_000), color: z.enum(analysisAnnotationColors),
  }),
  // Pins one dataset node to a municipality, or releases it so it follows the subject.
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-node-municipality"), nodeId: z.string().min(1).max(100), municipality: analysisSubjectSchema.nullable() }),
]);
export const municipalityAnalysisGraphOperationsSchema = z.array(municipalityAnalysisGraphOperationSchema).min(1).max(200);
export type MunicipalityAnalysisGraphOperation = z.infer<typeof municipalityAnalysisGraphOperationSchema>;

export function emptyMunicipalityAnalysisGraph(): MunicipalityAnalysisGraph {
  return { version: ANALYSIS_GRAPH_VERSION, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: null, subject: null };
}

export function serializeMunicipalityAnalysisGraph(graph: MunicipalityAnalysisGraph) {
  const json = JSON.stringify(municipalityAnalysisGraphSchema.parse(graph));
  if (new TextEncoder().encode(json).byteLength > MAX_ANALYSIS_JSON_BYTES) throw new Error("Analysis graph is too large");
  return json;
}

export function parseMunicipalityAnalysisGraph(json: string) {
  if (new TextEncoder().encode(json).byteLength > MAX_ANALYSIS_JSON_BYTES) throw new Error("Analysis graph is too large");
  return municipalityAnalysisGraphSchema.parse(JSON.parse(json));
}

export function analysisNodeWidth(node: MunicipalityAnalysisNode) {
  return node.width ?? (node.type === "annotation" ? DEFAULT_ANALYSIS_NOTE_WIDTH : DEFAULT_ANALYSIS_NODE_WIDTH);
}

export function analysisNodeHeight(node: MunicipalityAnalysisNode) {
  return node.height ?? (node.type === "annotation" ? DEFAULT_ANALYSIS_NOTE_HEIGHT : DEFAULT_ANALYSIS_NODE_HEIGHT);
}

function clampAnalysisNodeSize(node: MunicipalityAnalysisNode, width: number, height: number) {
  const minWidth = node.type === "annotation" ? MIN_ANALYSIS_NOTE_WIDTH : MIN_ANALYSIS_NODE_WIDTH;
  const minHeight = node.type === "annotation" ? MIN_ANALYSIS_NOTE_HEIGHT : MIN_ANALYSIS_NODE_HEIGHT;
  return {
    width: Math.min(MAX_ANALYSIS_NODE_WIDTH, Math.max(minWidth, Math.round(width))),
    height: Math.min(MAX_ANALYSIS_NODE_HEIGHT, Math.max(minHeight, Math.round(height))),
  };
}

/**
 * Checks a graph the reducer just built and hands back the very same object.
 *
 * Zod rebuilds every node and edge it validates, so returning its output would give each
 * untouched node a new identity — and selecting a node or panning the canvas would then
 * re-render every card on it. The reducer only ever assembles already-validated pieces,
 * so the parse is here for the invariants (unique ids, no cycles, edge targets), not to
 * coerce anything.
 */
function validateAnalysisGraph(graph: MunicipalityAnalysisGraph) {
  municipalityAnalysisGraphSchema.parse(graph);
  return graph;
}

// Key order is not part of a dataset's identity: the same reference built by the map and
// by a Kennzahl derivation lists its fields in a different order, and comparing the raw
// JSON would treat them as two different datasets.
export const datasetRefKey = (dataset: MunicipalityDatasetRef) =>
  JSON.stringify(Object.entries(dataset).sort(([left], [right]) => left.localeCompare(right)));

/** Constants carry no municipality, so every caller reading the name goes through here. */
export const datasetMunicipalityName = (dataset: MunicipalityDatasetRef) =>
  "municipalityName" in dataset ? dataset.municipalityName : null;

export function addDatasetToGraph(graph: MunicipalityAnalysisGraph, dataset: MunicipalityDatasetRef, id: string) {
  // The same operation can arrive twice — a retry after a failed save, or the client
  // replaying what it has not seen confirmed yet. Matching on the id first keeps that a
  // no-op even once the node's dataset has been edited and no longer matches by value.
  if (graph.nodes.some((node) => node.id === id)) {
    return { graph: { ...graph, selectedNodeId: id }, nodeId: id, duplicate: true };
  }
  const existing = graph.nodes.find((node) => node.type === "dataset" && datasetRefKey(node.data.dataset) === datasetRefKey(dataset));
  if (existing) return { graph: { ...graph, selectedNodeId: existing.id }, nodeId: existing.id, duplicate: true };
  const index = graph.nodes.length;
  const node: MunicipalityAnalysisNode = {
    id, type: "dataset", position: { x: 80 + (index % 3) * 270, y: 80 + Math.floor(index / 3) * 190 }, data: { dataset },
  };
  const next = { ...graph, nodes: [...graph.nodes, node], selectedNodeId: id };
  return { graph: validateAnalysisGraph(next), nodeId: id, duplicate: false };
}

/**
 * Expands a Kennzahl into the operations that draw its derivation.
 *
 * Injected rather than imported so this module stays free of the Kennzahl registry —
 * `kennzahlen.ts` builds on the graph types defined here, and importing it back would
 * close the loop.
 */
export type KennzahlExpander = (
  dataset: MunicipalityDatasetRef,
  graph: MunicipalityAnalysisGraph,
) => MunicipalityAnalysisGraphOperation[] | null;

export function applyMunicipalityAnalysisGraphOperations(
  graph: MunicipalityAnalysisGraph,
  operations: MunicipalityAnalysisGraphOperation[],
  expandKennzahl?: KennzahlExpander,
) {
  const parsedOperations = municipalityAnalysisGraphOperationsSchema.parse(operations);
  let next = graph;
  let duplicateCount = 0;
  let lastDatasetNodeId: string | null = null;
  for (const operation of parsedOperations) {
    if (operation.type === "add-kennzahl") {
      const expanded = expandKennzahl?.(operation.dataset, next);
      // An empty array means the derivation is already fully on the canvas — that is a
      // successful no-op, not a missing derivation.
      if (expanded) {
        if (expanded.length) next = applyMunicipalityAnalysisGraphOperations(next, expanded, expandKennzahl).graph;
      } else {
        // No derivation (an Ausgangsdatum, or a primary calculation): one node, as before.
        const added = addDatasetToGraph(next, operation.dataset, operation.nodeId);
        next = added.graph;
        lastDatasetNodeId = added.nodeId;
        if (added.duplicate) duplicateCount += 1;
      }
    } else if (operation.type === "add-dataset") {
      const added = addDatasetToGraph(next, operation.dataset, operation.nodeId);
      next = added.graph;
      lastDatasetNodeId = added.nodeId;
      if (added.duplicate) duplicateCount += 1;
    } else if (operation.type === "add-node") {
      if (!next.nodes.some(({ id }) => id === operation.node.id)) {
        next = { ...next, nodes: [...next.nodes, operation.node], selectedNodeId: operation.node.id };
      }
    } else if (operation.type === "remove-node") {
      next = {
        ...next,
        nodes: next.nodes.filter(({ id }) => id !== operation.nodeId),
        edges: next.edges.filter(({ source, target }) => source !== operation.nodeId && target !== operation.nodeId),
        selectedNodeId: next.selectedNodeId === operation.nodeId ? null : next.selectedNodeId,
      };
    } else if (operation.type === "move-node") {
      next = { ...next, nodes: next.nodes.map((node) => node.id === operation.nodeId ? { ...node, position: operation.position } : node) };
    } else if (operation.type === "add-edge") {
      const edges = next.edges.filter((edge) => edge.id !== operation.edge.id && !(edge.target === operation.edge.target && edge.targetHandle === operation.edge.targetHandle));
      next = { ...next, edges: [...edges, operation.edge], selectedNodeId: operation.edge.target };
    } else if (operation.type === "remove-edge") {
      next = { ...next, edges: next.edges.filter(({ id }) => id !== operation.edgeId) };
    } else if (operation.type === "set-viewport") {
      next = { ...next, viewport: operation.viewport };
    } else if (operation.type === "set-subject") {
      next = { ...next, subject: operation.subject };
    } else if (operation.type === "set-node-value") {
      next = {
        ...next,
        nodes: next.nodes.map((node) => {
          if (node.id !== operation.nodeId) return node;
          // Clamped rather than validated: a typed-in 0 or 99 should settle on the nearest
          // usable value instead of throwing away the whole operation batch.
          if (node.type === "operator") {
            const years = Math.min(MAX_ANALYSIS_SHIFT_YEARS, Math.max(1, Math.round(operation.value)));
            return { ...node, data: { ...node.data, years } };
          }
          if (node.type !== "dataset") return node;
          return node.data.dataset.kind === "constant"
            ? { ...node, data: { ...node.data, dataset: { kind: "constant" as const, value: operation.value } } }
            : node;
        }),
      };
    } else if (operation.type === "set-node-title") {
      next = {
        ...next,
        nodes: next.nodes.map((node) => {
          if (node.id !== operation.nodeId || node.type === "annotation") return node;
          if (node.type === "dataset") return { ...node, data: { ...node.data, alias: operation.title } };
          return { ...node, data: { ...node.data, alias: operation.title } };
        }),
      };
    } else if (operation.type === "resize-node") {
      next = {
        ...next,
        nodes: next.nodes.map((node) => node.id === operation.nodeId
          ? { ...node, position: operation.position, ...clampAnalysisNodeSize(node, operation.width, operation.height) }
          : node),
      };
    } else if (operation.type === "set-annotation") {
      next = {
        ...next,
        nodes: next.nodes.map((node) => node.id === operation.nodeId && node.type === "annotation"
          ? { ...node, data: { text: operation.text, color: operation.color } }
          : node),
      };
    } else if (operation.type === "set-node-municipality") {
      next = {
        ...next,
        nodes: next.nodes.map((node) => {
          if (node.id !== operation.nodeId || node.type !== "dataset") return node;
          const { dataset } = node.data;
          // A constant is the same number everywhere, so it has no municipality to set.
          if (dataset.kind === "constant") return node;
          const open = Object.fromEntries(
            Object.entries(dataset).filter(([key]) => key !== "municipalityCode" && key !== "municipalityName"),
          );
          return {
            ...node,
            data: { ...node.data, dataset: (operation.municipality ? { ...open, ...operation.municipality } : open) as MunicipalityDatasetRef },
          };
        }),
      };
    } else {
      next = {
        ...next,
        selectedNodeId: operation.nodeId && next.nodes.some(({ id }) => id === operation.nodeId) ? operation.nodeId : null,
      };
    }
    next = validateAnalysisGraph(next);
  }
  return { graph: next, duplicateCount, lastDatasetNodeId };
}

export function wouldCreateAnalysisCycle(edges: MunicipalityAnalysisEdge[], source: string, target: string) {
  if (source === target) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  const queue = [target];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export type AnalysisPoint = { year: number; value: number | boolean | null };
export type AnalysisSeries = {
  unit: string; valueType: "number" | "boolean"; points: AnalysisPoint[];
  error: "missing-input" | "incompatible-units" | "missing-municipality" | "no-common-years" | null;
  warnings: Array<{ year: number; code: "division-by-zero" }>;
};
export type MunicipalityAnalysisData = {
  index: MunicipalityIndex;
  population: MunicipalityPopulationSeries;
  structure: MunicipalityStructureSeries | null;
  demography: MunicipalityDemographySeries | null;
  movement: MunicipalityMovementSeries | null;
  costs: MunicipalityCostSeries | null;
};

export function datasetUnit(dataset: MunicipalityDatasetRef) {
  if (dataset.kind === "population") return populationViewUnit(dataset.view);
  if (dataset.kind === "age-group") return dataset.measure;
  if (dataset.kind === "age-indicator") return demographicIndicatorUnit(dataset.indicator);
  if (dataset.kind === "movement") return movementTargetUnit(dataset.metric);
  if (dataset.kind === "attribute") return "square-kilometers";
  if (dataset.kind === "constant") return "";
  const measure = dataset.measure ?? "share";
  if (measure === "absolute") return "currency";
  return measure === "per-capita" || measure === "real-per-capita"
    ? "currency-per-person" : "share";
}

// `AnalysisSeries.unit` stays a machine identity because operators compare it for
// compatibility; only the rendered label is translated.
export const ANALYSIS_UNIT_IDS = [
  "persons", "per-square-kilometer", "share", "per-100", "per-1000", "years", "currency-per-person",
  "currency", "square-kilometers",
] as const;

export function analysisUnitLabel(unit: string, translate: (id: (typeof ANALYSIS_UNIT_IDS)[number]) => string) {
  if (!unit || unit === "boolean") return "";
  return unit
    .split(/([·/])/)
    .map((part) => (ANALYSIS_UNIT_IDS as readonly string[]).includes(part)
      ? translate(part as (typeof ANALYSIS_UNIT_IDS)[number])
      : part)
    .join("");
}

/**
 * The series as CSV, semicolon-separated with a decimal comma — what Excel opens without
 * an import wizard in a de-AT locale. Missing years stay as empty cells rather than being
 * dropped, so the column still lines up with a second export next to it.
 */
export function analysisSeriesToCsv(series: AnalysisSeries, headers: { year: string; value: string }) {
  const cell = (value: number | boolean | null) => {
    if (value === null) return "";
    if (typeof value === "boolean") return value ? "1" : "0";
    return String(value).replace(".", ",");
  };
  const escape = (value: string) => (/[";\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  return [
    `${escape(headers.year)};${escape(headers.value)}`,
    ...series.points.map(({ year, value }) => `${year};${cell(value)}`),
  ].join("\n");
}

export function resolveMunicipalityDataset(
  dataset: MunicipalityDatasetRef,
  data: MunicipalityAnalysisData,
  /** Which municipality open nodes are about; a pinned node ignores it. */
  subject: AnalysisSubject | null = null,
): AnalysisSeries {
  const points: AnalysisPoint[] = [];
  const firstYear = dataset.kind === "cost-share" ? (data.costs?.firstYear ?? 2010) : data.population.firstYear;
  const latestYear = dataset.kind === "cost-share" ? (data.costs?.latestYear ?? 2024) : data.population.latestYear;

  // A constant carries no municipality. It spans the population years so it intersects
  // with every other series an operator can pair it with.
  if (dataset.kind === "constant") {
    for (let year = firstYear; year <= latestYear; year += 1) points.push({ year, value: dataset.value });
    return { unit: datasetUnit(dataset), valueType: "number", points, error: null, warnings: [] };
  }

  // Pinned wins over the graph's subject; an open node without a subject has nothing to
  // read yet, which is a state to report rather than a series of nulls.
  const code = dataset.municipalityCode ?? subject?.municipalityCode ?? null;
  if (code === null) {
    return { unit: datasetUnit(dataset), valueType: "number", points: [], error: "missing-municipality", warnings: [] };
  }

  for (let year = firstYear; year <= latestYear; year += 1) {
    const population = data.population.years[String(year)].values[code];
    let value: number | null = null;
    if (dataset.kind === "attribute") {
      const municipality = data.index.municipalities.find((item) => item.municipalityCode === code);
      value = municipality ? municipality.areaSquareKilometers : null;
    } else if (dataset.kind === "population") {
      const municipality = data.index.municipalities.find(({ municipalityCode }) => municipalityCode === code);
      if (municipality) value = populationViewValue(
        dataset.view,
        population,
        municipality,
        data.structure?.years[String(year)]?.values[code] ?? null,
      );
    }
    else if (dataset.kind === "age-group") {
      const counts = data.demography?.years[String(year)]?.values[code];
      if (counts) value = demographyMetricValue(counts, dataset.sex, dataset.ageGroup, dataset.measure);
    } else if (dataset.kind === "age-indicator") {
      const counts = data.demography?.years[String(year)]?.values[code];
      if (counts) value = demographicIndicatorValue(counts, dataset.indicator);
    } else if (dataset.kind === "movement") {
      const counts = data.movement?.years[String(year)]?.values[code];
      if (counts) value = movementTargetValue(counts, population, dataset.metric);
    } else {
      const costs = data.costs?.years[String(year)]?.values[code];
      const measure = dataset.measure ?? "share";
      if (costs && measure === "absolute") value = municipalityCostAbsolute(costs, dataset.category);
      else if (costs && measure === "share") value = municipalityCostShare(costs, dataset.category);
      else if (costs && measure === "per-capita") {
        value = municipalityCostPerCapita(costs, dataset.category, population);
      } else if (costs && measure === "real-per-capita") {
        value = municipalityCostRealPerCapita(costs, dataset.category, population, year);
      } else if (costs) {
        const selected = data.index.municipalities.find(({ municipalityCode }) => municipalityCode === code);
        const selectedPerCapita = municipalityCostPerCapita(costs, dataset.category, population);
        if (selected && selectedPerCapita !== null) {
          const band = municipalityPopulationBand(population);
          const peers = data.index.municipalities.flatMap((municipality) => {
            const peerPopulation = data.population.years[String(year)].values[municipality.municipalityCode];
            const peerCosts = data.costs?.years[String(year)]?.values[municipality.municipalityCode];
            if (municipalityPopulationBand(peerPopulation) !== band || !peerCosts) return [];
            const peerValue = municipalityCostPerCapita(peerCosts, dataset.category, peerPopulation);
            return peerValue === null ? [] : [{ state: municipality.state, value: peerValue }];
          });
          const regionalPeers = peers.filter(({ state }) => state === selected.state);
          const comparison = regionalPeers.length >= 5 ? regionalPeers : peers;
          const peerMedian = median(comparison.map(({ value: peerValue }) => peerValue));
          value = peerMedian && peerMedian > 0 ? selectedPerCapita / peerMedian - 1 : null;
        }
      }
    }
    points.push({ year, value });
  }
  return { unit: datasetUnit(dataset), valueType: "number", points, error: null, warnings: [] };
}

const comparisonOperators = new Set<AnalysisOperatorId>(["greater-than", "greater-or-equal", "less-than", "less-or-equal", "equal", "not-equal"]);
const booleanOperators = new Set<AnalysisOperatorId>(["and", "or"]);
export const isBooleanAnalysisOperator = (operator: AnalysisOperatorId) =>
  comparisonOperators.has(operator) || booleanOperators.has(operator);

/**
 * The unit an operator produces. A dimensionless side contributes nothing, so scaling a
 * rate by 1.000 stays "persons/persons" instead of picking up a dangling separator.
 */
export function composeAnalysisUnit(operator: AnalysisOperatorId, left: string, right: string) {
  if (operator === "multiply") return !right ? left : !left ? right : `${left}·${right}`;
  if (operator === "divide") return !right ? left : `${left}/${right}`;
  return left || right;
}

export function evaluateAnalysisOperator(
  operator: AnalysisOperatorId,
  left: AnalysisSeries | null,
  right: AnalysisSeries | null,
  years: number = DEFAULT_ANALYSIS_SHIFT_YEARS,
): AnalysisSeries {
  const comparison = comparisonOperators.has(operator);
  const logical = booleanOperators.has(operator);
  const fail = (error: AnalysisSeries["error"]): AnalysisSeries => ({
    unit: comparison || logical ? "boolean" : "",
    valueType: comparison || logical ? "boolean" : "number",
    points: [], error, warnings: [],
  });

  // Shift moves the input forward in time, so the value at a year is what the input read
  // `years` earlier. Unit and value type are untouched; only the years move.
  if (operator === "shift") {
    if (!left) return fail("missing-input");
    if (left.error) return fail(left.error);
    return {
      unit: left.unit, valueType: left.valueType,
      points: left.points.map(({ year, value }) => ({ year: year + years, value })),
      error: null, warnings: [],
    };
  }

  if (!left || !right) return fail("missing-input");
  // An input that could not be computed is the reason this cannot be either — say so
  // here rather than showing an empty chart with no explanation.
  const inherited = left.error ?? right.error;
  if (inherited) return fail(inherited);
  if (logical) {
    if (left.valueType !== "boolean" || right.valueType !== "boolean") return fail("incompatible-units");
  } else if (left.valueType !== "number" || right.valueType !== "number") {
    return fail("incompatible-units");
  } else if (operator === "add" || operator === "subtract" || comparison) {
    // A constant is dimensionless, and "Einwohnerzahl > 2.000" is exactly what it is for,
    // so a bare number pairs with any unit instead of being rejected as incompatible.
    const dimensionless = !left.unit || !right.unit;
    if (left.unit !== right.unit && !dimensionless) return fail("incompatible-units");
  }
  const rightByYear = new Map(right.points.map((point) => [point.year, point.value]));
  const warnings: AnalysisSeries["warnings"] = [];
  const points = left.points.flatMap<AnalysisPoint>((point) => {
    if (!rightByYear.has(point.year)) return [];
    const a = point.value;
    const b = rightByYear.get(point.year);
    if (logical) {
      if (typeof a !== "boolean" || typeof b !== "boolean") return [{ year: point.year, value: null }];
      return [{ year: point.year, value: operator === "and" ? a && b : a || b }];
    }
    if (typeof a !== "number" || typeof b !== "number") return [{ year: point.year, value: null }];
    if (operator === "divide" && b === 0) { warnings.push({ year: point.year, code: "division-by-zero" }); return [{ year: point.year, value: null }]; }
    const value = operator === "add" ? a + b : operator === "subtract" ? a - b : operator === "multiply" ? a * b
      : operator === "divide" ? a / b : operator === "greater-than" ? a > b : operator === "greater-or-equal" ? a >= b
        : operator === "less-than" ? a < b : operator === "less-or-equal" ? a <= b
          : operator === "not-equal" ? a !== b : a === b;
    return [{ year: point.year, value }];
  });
  // Inputs are paired by year. Sharing none is not an empty result but an unanswerable
  // question, and an empty chart with no reason reads as a bug.
  if (!points.length) return fail("no-common-years");
  const valueType = comparison || logical ? "boolean" as const : "number" as const;
  const unit = comparison || logical ? "boolean" : composeAnalysisUnit(operator, left.unit, right.unit);
  return { unit, valueType, points, error: null, warnings };
}

export function evaluateAnalysisGraph(graph: MunicipalityAnalysisGraph, data: MunicipalityAnalysisData) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const results = new Map<string, AnalysisSeries>();
  const evaluating = new Set<string>();
  const evaluate = (id: string): AnalysisSeries | null => {
    const cached = results.get(id);
    if (cached) return cached;
    if (evaluating.has(id)) return null;
    const node = nodes.get(id);
    if (!node) return null;
    evaluating.add(id);
    let result: AnalysisSeries | null;
    if (node.type === "dataset") result = resolveMunicipalityDataset(node.data.dataset, data, graph.subject);
    else if (node.type === "operator") {
      const input = (handle: "a" | "b") => {
        const edge = graph.edges.find((item) => item.target === id && item.targetHandle === handle);
        return edge ? evaluate(edge.source) : null;
      };
      result = evaluateAnalysisOperator(node.data.operator, input("a"), input("b"), node.data.years);
    } else result = null;
    evaluating.delete(id);
    if (result) results.set(id, result);
    return result;
  };
  for (const id of nodes.keys()) evaluate(id);
  return results;
}
