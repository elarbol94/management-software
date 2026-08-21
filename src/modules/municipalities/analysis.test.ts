import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addDatasetToGraph,
  applyMunicipalityAnalysisGraphOperations,
  emptyMunicipalityAnalysisGraph,
  evaluateAnalysisOperator,
  municipalityAnalysisGraphSchema,
  resolveMunicipalityDataset,
  wouldCreateAnalysisCycle,
  type AnalysisSeries,
  type MunicipalityAnalysisData,
} from "./analysis";
import type { MunicipalityCostSeries } from "./costs";
import type { MunicipalityIndex } from "./data";
import type { MunicipalityPopulationSeries } from "./population";

const series = (unit: string, values: Array<[number, number | null]>): AnalysisSeries => ({
  unit,
  valueType: "number",
  points: values.map(([year, value]) => ({ year, value })),
  error: null,
  warnings: [],
});

const dataset = (municipalityCode: string) => ({ kind: "population" as const, municipalityCode, municipalityName: municipalityCode, view: "count" as const });

describe("municipality analysis graph", () => {
  it("deduplicates identical municipality datasets", () => {
    const dataset = { kind: "population" as const, municipalityCode: "60101", municipalityName: "Graz", view: "count" as const };
    const first = addDatasetToGraph(emptyMunicipalityAnalysisGraph(), dataset, "node-1");
    const second = addDatasetToGraph(first.graph, dataset, "node-2");
    expect(second.duplicate).toBe(true);
    expect(second.nodeId).toBe("node-1");
    expect(second.graph.nodes).toHaveLength(1);
  });

  it("rejects duplicate operator inputs", () => {
    const graph = {
      ...emptyMunicipalityAnalysisGraph(),
      nodes: [
        { id: "a", type: "operator" as const, position: { x: 0, y: 0 }, data: { operator: "add" as const } },
        { id: "b", type: "operator" as const, position: { x: 1, y: 1 }, data: { operator: "add" as const } },
        { id: "c", type: "operator" as const, position: { x: 2, y: 2 }, data: { operator: "add" as const } },
      ],
      edges: [
        { id: "1", source: "a", target: "c", sourceHandle: "output" as const, targetHandle: "a" as const },
        { id: "2", source: "b", target: "c", sourceHandle: "output" as const, targetHandle: "a" as const },
      ],
    };
    expect(municipalityAnalysisGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("detects cycles before connecting nodes", () => {
    const edges = [
      { id: "1", source: "a", target: "b", sourceHandle: "output" as const, targetHandle: "a" as const },
      { id: "2", source: "b", target: "c", sourceHandle: "output" as const, targetHandle: "a" as const },
    ];
    expect(wouldCreateAnalysisCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateAnalysisCycle(edges, "a", "c")).toBe(false);
  });

  it("keeps datasets added after an operator operation", () => {
    const result = applyMunicipalityAnalysisGraphOperations(emptyMunicipalityAnalysisGraph(), [
      { version: 1, type: "add-dataset", nodeId: "dataset-a", dataset: dataset("60101") },
      { version: 1, type: "add-dataset", nodeId: "dataset-b", dataset: dataset("60102") },
      { version: 1, type: "add-node", node: { id: "operator", type: "operator", position: { x: 20, y: 30 }, data: { operator: "add" } } },
      { version: 1, type: "add-dataset", nodeId: "dataset-c", dataset: dataset("60103") },
    ]);
    expect(result.graph.nodes.filter(({ type }) => type === "dataset")).toHaveLength(3);
    expect(result.graph.nodes.filter(({ type }) => type === "operator")).toHaveLength(1);
  });

  it("applies movement, viewport, selection, removal and dataset deduplication", () => {
    const first = applyMunicipalityAnalysisGraphOperations(emptyMunicipalityAnalysisGraph(), [
      { version: 1, type: "add-dataset", nodeId: "dataset-a", dataset: dataset("60101") },
      { version: 1, type: "add-dataset", nodeId: "duplicate", dataset: dataset("60101") },
      { version: 1, type: "move-node", nodeId: "dataset-a", position: { x: 44, y: 55 } },
      { version: 1, type: "set-viewport", viewport: { x: 10, y: 20, zoom: 1.5 } },
      { version: 1, type: "set-selected-node", nodeId: null },
    ]);
    expect(first.duplicateCount).toBe(1);
    expect(first.graph.nodes).toHaveLength(1);
    expect(first.graph.nodes[0]?.position).toEqual({ x: 44, y: 55 });
    expect(first.graph.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
    expect(first.graph.selectedNodeId).toBeNull();
    const removed = applyMunicipalityAnalysisGraphOperations(first.graph, [
      { version: 1, type: "remove-node", nodeId: "dataset-a" },
    ]);
    expect(removed.graph.nodes).toHaveLength(0);
  });

  it("replaces an occupied operator input and removes edges", () => {
    const graph = applyMunicipalityAnalysisGraphOperations(emptyMunicipalityAnalysisGraph(), [
      { version: 1, type: "add-dataset", nodeId: "dataset-a", dataset: dataset("60101") },
      { version: 1, type: "add-dataset", nodeId: "dataset-b", dataset: dataset("60102") },
      { version: 1, type: "add-node", node: { id: "operator", type: "operator", position: { x: 0, y: 0 }, data: { operator: "add" } } },
      { version: 1, type: "add-edge", edge: { id: "edge-a", source: "dataset-a", target: "operator", sourceHandle: "output", targetHandle: "a" } },
      { version: 1, type: "add-edge", edge: { id: "edge-b", source: "dataset-b", target: "operator", sourceHandle: "output", targetHandle: "a" } },
    ]).graph;
    expect(graph.edges).toEqual([{ id: "edge-b", source: "dataset-b", target: "operator", sourceHandle: "output", targetHandle: "a" }]);
    const removed = applyMunicipalityAnalysisGraphOperations(graph, [{ version: 1, type: "remove-edge", edgeId: "edge-b" }]);
    expect(removed.graph.edges).toHaveLength(0);
  });

  it("rejects cycles introduced by ordered edge operations", () => {
    expect(() => applyMunicipalityAnalysisGraphOperations(emptyMunicipalityAnalysisGraph(), [
      { version: 1, type: "add-node", node: { id: "a", type: "operator", position: { x: 0, y: 0 }, data: { operator: "add" } } },
      { version: 1, type: "add-node", node: { id: "b", type: "operator", position: { x: 0, y: 0 }, data: { operator: "add" } } },
      { version: 1, type: "add-edge", edge: { id: "a-b", source: "a", target: "b", sourceHandle: "output", targetHandle: "a" } },
      { version: 1, type: "add-edge", edge: { id: "b-a", source: "b", target: "a", sourceHandle: "output", targetHandle: "a" } },
    ])).toThrow();
  });
});

describe("municipality analysis operators", () => {
  it("calculates only shared years and keeps gaps", () => {
    const result = evaluateAnalysisOperator(
      "add",
      series("persons", [[2022, 10], [2023, 20], [2024, null]]),
      series("persons", [[2023, 2], [2024, 3], [2025, 4]]),
    );
    expect(result.points).toEqual([{ year: 2023, value: 22 }, { year: 2024, value: null }]);
  });

  it("reports incompatible units for strict operators", () => {
    const result = evaluateAnalysisOperator("subtract", series("persons", [[2024, 10]]), series("share", [[2024, 0.5]]));
    expect(result.error).toBe("incompatible-units");
  });

  it("derives units and turns division by zero into a gap", () => {
    const multiplied = evaluateAnalysisOperator("multiply", series("persons", [[2024, 10]]), series("share", [[2024, 0.5]]));
    expect(multiplied.unit).toBe("persons·share");
    const divided = evaluateAnalysisOperator("divide", series("persons", [[2024, 10]]), series("persons", [[2024, 0]]));
    expect(divided.points).toEqual([{ year: 2024, value: null }]);
    expect(divided.warnings).toEqual([{ year: 2024, code: "division-by-zero" }]);
  });

  it("returns boolean comparison series", () => {
    const result = evaluateAnalysisOperator("greater-than", series("persons", [[2024, 10]]), series("persons", [[2024, 8]]));
    expect(result.valueType).toBe("boolean");
    expect(result.unit).toBe("boolean");
    expect(result.points).toEqual([{ year: 2024, value: true }]);
  });
});

describe("municipality cost analysis dataset", () => {
  it("resolves 2010–2024 as a share series and preserves missing municipalities as gaps", () => {
    const data: MunicipalityAnalysisData = {
      index: JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex,
      population: JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries,
      costs: JSON.parse(readFileSync(resolve("public/data/municipality-cost-shares-2010-2024.json"), "utf8")) as MunicipalityCostSeries,
      structure: null, demography: null, movement: null,
    };
    const graz = resolveMunicipalityDataset(
      { kind: "cost-share", municipalityCode: "60101", municipalityName: "Graz", category: "8" },
      data,
    );
    expect(graz.unit).toBe("share");
    expect(graz.points).toHaveLength(15);
    expect(graz.points[0]).toEqual({ year: 2010, value: expect.closeTo(0.1800459, 6) });
    expect(graz.points.at(-1)).toEqual({ year: 2024, value: expect.closeTo(0.1007635, 6) });
    const moertschach = resolveMunicipalityDataset(
      { kind: "cost-share", municipalityCode: "20622", municipalityName: "Mörtschach", category: "8" },
      data,
    );
    expect(moertschach.points.every(({ value }) => value === null)).toBe(true);
  });

  it("resolves per-capita, real-price and peer-deviation cost series", () => {
    const data: MunicipalityAnalysisData = {
      index: JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex,
      population: JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries,
      costs: JSON.parse(readFileSync(resolve("public/data/municipality-cost-shares-2010-2024.json"), "utf8")) as MunicipalityCostSeries,
      structure: null, demography: null, movement: null,
    };
    const base = { kind: "cost-share" as const, municipalityCode: "60101", municipalityName: "Graz", category: "8" as const };
    const nominal = resolveMunicipalityDataset({ ...base, measure: "per-capita" }, data);
    const real = resolveMunicipalityDataset({ ...base, measure: "real-per-capita" }, data);
    const peer = resolveMunicipalityDataset({ ...base, measure: "peer-deviation" }, data);

    expect(nominal.unit).toBe("currency-per-person");
    expect(real.unit).toBe("currency-per-person");
    expect(peer.unit).toBe("share");
    expect(nominal.points[0].value).toEqual(expect.any(Number));
    expect(real.points[0].value).toEqual(expect.any(Number));
    expect(peer.points[0].value).toEqual(expect.any(Number));
    expect(real.points[0].value as number).toBeGreaterThan(nominal.points[0].value as number);
    expect(real.points.at(-1)?.value).toBeCloseTo(nominal.points.at(-1)?.value as number);
  });
});
