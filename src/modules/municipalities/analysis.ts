import { z } from "zod";
import {
  municipalityCostShare,
  type CostCategoryId,
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
  movementMetricUnit,
  movementMetricValue,
  type MunicipalityMovementSeries,
} from "./movement";
import type { MunicipalityPopulationSeries } from "./population";
import {
  populationViewUnit,
  populationViewValue,
  type MunicipalityStructureSeries,
} from "./structure";

export const ANALYSIS_GRAPH_VERSION = 1;
export const MAX_ANALYSIS_NODES = 100;
export const MAX_ANALYSIS_EDGES = 200;
export const MAX_ANALYSIS_JSON_BYTES = 250_000;

export const analysisOperatorIds = [
  "add", "subtract", "multiply", "divide", "greater-than",
  "greater-or-equal", "less-than", "less-or-equal", "equal",
] as const;
export type AnalysisOperatorId = (typeof analysisOperatorIds)[number];

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const municipalityDatasetRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("population"), municipalityCode: z.string().regex(/^\d{5}$/), municipalityName: z.string().trim().min(1).max(160), view: z.enum(["count", "density", "foreign-share", "foreign-persons"]) }),
  z.object({
    kind: z.literal("age-group"), municipalityCode: z.string().regex(/^\d{5}$/), municipalityName: z.string().trim().min(1).max(160),
    ageGroup: z.enum(["0-5", "6-14", "15-24", "25-44", "45-64", "65-79", "80-plus"]),
    measure: z.enum(["share", "persons"]), sex: z.enum(["all", "female", "male"]),
  }),
  z.object({
    kind: z.literal("age-indicator"), municipalityCode: z.string().regex(/^\d{5}$/), municipalityName: z.string().trim().min(1).max(160),
    indicator: z.enum(["youth-share", "senior-share", "old-age-dependency", "child-dependency", "total-dependency", "aging-index", "average-age", "women-share", "women-per-100-men"]),
  }),
  z.object({
    kind: z.literal("movement"), municipalityCode: z.string().regex(/^\d{5}$/), municipalityName: z.string().trim().min(1).max(160),
    metric: z.enum(["population-change", "births", "deaths", "birth-rate", "death-rate", "birth-balance-rate", "arrivals", "departures", "migration-balance-rate", "international-migration-balance", "international-migration-balance-rate", "internal-migration-balance", "internal-migration-balance-rate", "statistical-correction"]),
  }),
  z.object({
    kind: z.literal("cost-share"), municipalityCode: z.string().regex(/^\d{5}$/), municipalityName: z.string().trim().min(1).max(160),
    category: z.enum(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),
  }),
]);
export type MunicipalityDatasetRef = z.infer<typeof municipalityDatasetRefSchema>;

export const analysisDatasetNodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("dataset"), position: positionSchema,
  data: z.object({ dataset: municipalityDatasetRefSchema }),
});
export const analysisOperatorNodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.literal("operator"), position: positionSchema,
  data: z.object({ operator: z.enum(analysisOperatorIds) }),
});
export const analysisNodeSchema = z.discriminatedUnion("type", [analysisDatasetNodeSchema, analysisOperatorNodeSchema]);
export const analysisEdgeSchema = z.object({
  id: z.string().min(1).max(140), source: z.string().min(1).max(100), target: z.string().min(1).max(100),
  sourceHandle: z.literal("output").default("output"), targetHandle: z.enum(["a", "b"]),
});
export const municipalityAnalysisGraphSchema = z.object({
  version: z.literal(ANALYSIS_GRAPH_VERSION),
  nodes: z.array(analysisNodeSchema).max(MAX_ANALYSIS_NODES),
  edges: z.array(analysisEdgeSchema).max(MAX_ANALYSIS_EDGES),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().min(0.1).max(4) }),
  selectedNodeId: z.string().max(100).nullable(),
}).superRefine((graph, context) => {
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodeIds.size !== graph.nodes.length) context.addIssue({ code: "custom", message: "Node ids must be unique" });
  if (graph.selectedNodeId && !nodeIds.has(graph.selectedNodeId)) context.addIssue({ code: "custom", message: "Selected node must exist" });
  const inputIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) context.addIssue({ code: "custom", message: "Edges must reference existing nodes" });
    if (nodesById.get(edge.target)?.type !== "operator") context.addIssue({ code: "custom", message: "Edges can only target operators" });
    const inputId = `${edge.target}:${edge.targetHandle}`;
    if (inputIds.has(inputId)) context.addIssue({ code: "custom", message: "Each operator input accepts one edge" });
    inputIds.add(inputId);
  }
  if (graph.edges.some((edge) => wouldCreateAnalysisCycle(graph.edges, edge.source, edge.target))) {
    context.addIssue({ code: "custom", message: "Analysis graph must not contain cycles" });
  }
});
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
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-viewport"), viewport: municipalityAnalysisGraphSchema.shape.viewport }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("set-selected-node"), nodeId: z.string().max(100).nullable() }),
  z.object({ version: z.literal(ANALYSIS_OPERATION_VERSION), type: z.literal("add-dataset"), nodeId: z.string().min(1).max(100), dataset: municipalityDatasetRefSchema }),
]);
export const municipalityAnalysisGraphOperationsSchema = z.array(municipalityAnalysisGraphOperationSchema).min(1).max(200);
export type MunicipalityAnalysisGraphOperation = z.infer<typeof municipalityAnalysisGraphOperationSchema>;

export function emptyMunicipalityAnalysisGraph(): MunicipalityAnalysisGraph {
  return { version: ANALYSIS_GRAPH_VERSION, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: null };
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

export const datasetRefKey = (dataset: MunicipalityDatasetRef) => JSON.stringify(dataset);

export function addDatasetToGraph(graph: MunicipalityAnalysisGraph, dataset: MunicipalityDatasetRef, id: string) {
  const existing = graph.nodes.find((node) => node.type === "dataset" && datasetRefKey(node.data.dataset) === datasetRefKey(dataset));
  if (existing) return { graph: { ...graph, selectedNodeId: existing.id }, nodeId: existing.id, duplicate: true };
  const index = graph.nodes.length;
  const node: MunicipalityAnalysisNode = {
    id, type: "dataset", position: { x: 80 + (index % 3) * 270, y: 80 + Math.floor(index / 3) * 190 }, data: { dataset },
  };
  return { graph: municipalityAnalysisGraphSchema.parse({ ...graph, nodes: [...graph.nodes, node], selectedNodeId: id }), nodeId: id, duplicate: false };
}

export function applyMunicipalityAnalysisGraphOperations(
  graph: MunicipalityAnalysisGraph,
  operations: MunicipalityAnalysisGraphOperation[],
) {
  const parsedOperations = municipalityAnalysisGraphOperationsSchema.parse(operations);
  let next = graph;
  let duplicateCount = 0;
  let lastDatasetNodeId: string | null = null;
  for (const operation of parsedOperations) {
    if (operation.type === "add-dataset") {
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
    } else {
      next = {
        ...next,
        selectedNodeId: operation.nodeId && next.nodes.some(({ id }) => id === operation.nodeId) ? operation.nodeId : null,
      };
    }
    next = municipalityAnalysisGraphSchema.parse(next);
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
  error: "missing-input" | "incompatible-units" | null;
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
  if (dataset.kind === "movement") return movementMetricUnit(dataset.metric);
  return "share";
}

export function resolveMunicipalityDataset(dataset: MunicipalityDatasetRef, data: MunicipalityAnalysisData): AnalysisSeries {
  const points: AnalysisPoint[] = [];
  const firstYear = dataset.kind === "cost-share" ? (data.costs?.firstYear ?? 2010) : data.population.firstYear;
  const latestYear = dataset.kind === "cost-share" ? (data.costs?.latestYear ?? 2024) : data.population.latestYear;
  for (let year = firstYear; year <= latestYear; year += 1) {
    const population = data.population.years[String(year)].values[dataset.municipalityCode];
    let value: number | null = null;
    if (dataset.kind === "population") {
      const municipality = data.index.municipalities.find(({ municipalityCode }) => municipalityCode === dataset.municipalityCode);
      if (municipality) value = populationViewValue(
        dataset.view,
        population,
        municipality,
        data.structure?.years[String(year)]?.values[dataset.municipalityCode] ?? null,
      );
    }
    else if (dataset.kind === "age-group") {
      const counts = data.demography?.years[String(year)]?.values[dataset.municipalityCode];
      if (counts) value = demographyMetricValue(counts, dataset.sex, dataset.ageGroup, dataset.measure);
    } else if (dataset.kind === "age-indicator") {
      const counts = data.demography?.years[String(year)]?.values[dataset.municipalityCode];
      if (counts) value = demographicIndicatorValue(counts, dataset.indicator);
    } else if (dataset.kind === "movement") {
      const counts = data.movement?.years[String(year)]?.values[dataset.municipalityCode];
      if (counts) value = movementMetricValue(counts, population, dataset.metric);
    } else {
      const costs = data.costs?.years[String(year)]?.values[dataset.municipalityCode];
      if (costs) value = municipalityCostShare(costs, dataset.category as CostCategoryId);
    }
    points.push({ year, value });
  }
  return { unit: datasetUnit(dataset), valueType: "number", points, error: null, warnings: [] };
}

const comparisonOperators = new Set<AnalysisOperatorId>(["greater-than", "greater-or-equal", "less-than", "less-or-equal", "equal"]);

export function evaluateAnalysisOperator(operator: AnalysisOperatorId, left: AnalysisSeries | null, right: AnalysisSeries | null): AnalysisSeries {
  const comparison = comparisonOperators.has(operator);
  if (!left || !right) return { unit: comparison ? "boolean" : "", valueType: comparison ? "boolean" : "number", points: [], error: "missing-input", warnings: [] };
  const requiresSameUnit = operator === "add" || operator === "subtract" || comparison;
  if (requiresSameUnit && (left.unit !== right.unit || left.valueType !== "number" || right.valueType !== "number")) {
    return { unit: comparison ? "boolean" : "", valueType: comparison ? "boolean" : "number", points: [], error: "incompatible-units", warnings: [] };
  }
  const rightByYear = new Map(right.points.map((point) => [point.year, point.value]));
  const warnings: AnalysisSeries["warnings"] = [];
  const points = left.points.flatMap<AnalysisPoint>((point) => {
    if (!rightByYear.has(point.year)) return [];
    const a = point.value;
    const b = rightByYear.get(point.year);
    if (typeof a !== "number" || typeof b !== "number") return [{ year: point.year, value: null }];
    if (operator === "divide" && b === 0) { warnings.push({ year: point.year, code: "division-by-zero" }); return [{ year: point.year, value: null }]; }
    const value = operator === "add" ? a + b : operator === "subtract" ? a - b : operator === "multiply" ? a * b
      : operator === "divide" ? a / b : operator === "greater-than" ? a > b : operator === "greater-or-equal" ? a >= b
        : operator === "less-than" ? a < b : operator === "less-or-equal" ? a <= b : a === b;
    return [{ year: point.year, value }];
  });
  const valueType = comparison ? "boolean" as const : "number" as const;
  const unit = comparison ? "boolean" : operator === "multiply" ? `${left.unit}·${right.unit}` : operator === "divide" ? `${left.unit}/${right.unit}` : left.unit;
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
    if (node.type === "dataset") result = resolveMunicipalityDataset(node.data.dataset, data);
    else {
      const input = (handle: "a" | "b") => {
        const edge = graph.edges.find((item) => item.target === id && item.targetHandle === handle);
        return edge ? evaluate(edge.source) : null;
      };
      result = evaluateAnalysisOperator(node.data.operator, input("a"), input("b"));
    }
    evaluating.delete(id);
    if (result) results.set(id, result);
    return result;
  };
  for (const id of nodes.keys()) evaluate(id);
  return results;
}
