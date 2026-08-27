import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_GRAPH_VERSION,
  addDatasetToGraph,
  analysisSeriesToCsv,
  analysisUnitLabel,
  datasetRefKey,
  applyMunicipalityAnalysisGraphOperations,
  emptyMunicipalityAnalysisGraph,
  evaluateAnalysisGraph,
  evaluateAnalysisOperator,
  municipalityAnalysisGraphSchema,
  parseMunicipalityAnalysisGraph,
  resolveMunicipalityDataset,
  serializeMunicipalityAnalysisGraph,
  wouldCreateAnalysisCycle,
  type AnalysisSeries,
  type MunicipalityAnalysisData,
} from "./analysis";
import { arrangeAnalysisNodes, autoLayoutAnalysisGraph } from "./analysis-layout";
import { analysisEdgePath, routeAnalysisEdge } from "./analysis-edge-routing";
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

const truths = (values: Array<[number, boolean]>): AnalysisSeries => ({
  unit: "boolean",
  valueType: "boolean",
  points: values.map(([year, value]) => ({ year, value })),
  error: null,
  warnings: [],
});

const dataset = (municipalityCode: string) => ({ kind: "population" as const, municipalityCode, municipalityName: municipalityCode, view: "count" as const });

describe("municipality analysis graph", () => {
  it("normalizes version 1 graphs without changing their formula", () => {
    const legacy = JSON.stringify({
      version: 1,
      nodes: [
        { id: "a", type: "dataset", position: { x: 1, y: 2 }, data: { dataset: dataset("60101") } },
        { id: "b", type: "operator", position: { x: 3, y: 4 }, data: { operator: "add" } },
      ],
      edges: [{ id: "a-b", source: "a", target: "b", sourceHandle: "output", targetHandle: "a" }],
      viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: "b", subject: null,
    });
    const graph = parseMunicipalityAnalysisGraph(legacy);
    expect(graph.version).toBe(ANALYSIS_GRAPH_VERSION);
    expect(graph.nodes.map(({ id, type }) => ({ id, type }))).toEqual([{ id: "a", type: "dataset" }, { id: "b", type: "operator" }]);
    expect(graph.edges).toHaveLength(1);
  });

  it("deduplicates identical municipality datasets", () => {
    const dataset = { kind: "population" as const, municipalityCode: "60101", municipalityName: "Graz", view: "count" as const };
    const first = addDatasetToGraph(emptyMunicipalityAnalysisGraph(), dataset, "node-1");
    const second = addDatasetToGraph(first.graph, dataset, "node-2");
    expect(second.duplicate).toBe(true);
    expect(second.nodeId).toBe("node-1");
    expect(second.graph.nodes).toHaveLength(1);
  });

  it("treats the same dataset as one regardless of field order", () => {
    const fromMap = { kind: "population" as const, municipalityCode: "60101", municipalityName: "Graz", view: "count" as const };
    const fromDerivation = { kind: "population" as const, view: "count" as const, municipalityCode: "60101", municipalityName: "Graz" };
    expect(datasetRefKey(fromMap)).toBe(datasetRefKey(fromDerivation));
    const first = addDatasetToGraph(emptyMunicipalityAnalysisGraph(), fromMap, "node-1");
    expect(addDatasetToGraph(first.graph, fromDerivation, "node-2").duplicate).toBe(true);
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

  it("persists aliases, clamped dimensions and annotation content", () => {
    const graph = applyMunicipalityAnalysisGraphOperations(emptyMunicipalityAnalysisGraph(), [
      { version: 1, type: "add-dataset", nodeId: "dataset-a", dataset: dataset("60101") },
      { version: 1, type: "set-node-title", nodeId: "dataset-a", title: "Working population" },
      { version: 1, type: "resize-node", nodeId: "dataset-a", position: { x: 10, y: 20 }, width: 999, height: 10 },
      { version: 1, type: "add-node", node: { id: "note", type: "annotation", position: { x: 30, y: 40 }, data: { text: "Check source", color: "sand" } } },
      { version: 1, type: "set-annotation", nodeId: "note", text: "Reviewed", color: "green" },
      { version: 1, type: "resize-node", nodeId: "note", position: { x: 31, y: 41 }, width: 20, height: 999 },
    ]).graph;
    const dataNode = graph.nodes.find(({ id }) => id === "dataset-a")!;
    const note = graph.nodes.find(({ id }) => id === "note")!;
    expect(dataNode.type === "dataset" && dataNode.data.alias).toBe("Working population");
    expect({ width: dataNode.width, height: dataNode.height, position: dataNode.position }).toEqual({ width: 640, height: 140, position: { x: 10, y: 20 } });
    expect(note.type === "annotation" && note.data).toEqual({ text: "Reviewed", color: "green" });
    expect({ width: note.width, height: note.height, position: note.position }).toEqual({ width: 160, height: 480, position: { x: 31, y: 41 } });
    expect(parseMunicipalityAnalysisGraph(serializeMunicipalityAnalysisGraph(graph))).toEqual(graph);
  });

  it("ignores annotations during evaluation", () => {
    const graph = municipalityAnalysisGraphSchema.parse({
      ...emptyMunicipalityAnalysisGraph(),
      nodes: [{ id: "note", type: "annotation", position: { x: 1, y: 2 }, data: { text: "Context", color: "blue" } }],
      selectedNodeId: "note",
    });
    const data: MunicipalityAnalysisData = {
      index: JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex,
      population: JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries,
      structure: null, demography: null, movement: null, costs: null,
    };
    expect(evaluateAnalysisGraph(graph, data)).toEqual(new Map());
  });

  it("lays out the calculation left to right without moving notes", () => {
    const graph = municipalityAnalysisGraphSchema.parse({
      version: ANALYSIS_GRAPH_VERSION,
      nodes: [
        { id: "a", type: "dataset", position: { x: 400, y: 400 }, width: 300, height: 180, data: { dataset: dataset("60101") } },
        { id: "b", type: "dataset", position: { x: 300, y: 100 }, data: { dataset: dataset("60102") } },
        { id: "sum", type: "operator", position: { x: 0, y: 0 }, data: { operator: "add" } },
        { id: "note", type: "annotation", position: { x: 777, y: 888 }, data: { text: "Do not move", color: "gray" } },
      ],
      edges: [
        { id: "a-sum", source: "a", target: "sum", sourceHandle: "output", targetHandle: "a" },
        { id: "b-sum", source: "b", target: "sum", sourceHandle: "output", targetHandle: "b" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: null, subject: null,
    });
    const first = autoLayoutAnalysisGraph(graph);
    expect(first).toEqual(autoLayoutAnalysisGraph(graph));
    expect(first.note).toBeUndefined();
    expect(first.sum!.x).toBeGreaterThan(first.a!.x + 300);
    expect(first.a!.y).not.toBe(first.b!.y);

    const aligned = arrangeAnalysisNodes(graph, ["a", "b"], "align-left");
    expect(aligned.a!.x).toBe(aligned.b!.x);
  });

  it("routes connections around intervening node cards", () => {
    const blockingCard = { x: 300, y: 80, width: 240, height: 176 };
    const route = routeAnalysisEdge(
      { x: 200, y: 168 },
      { x: 680, y: 147 },
      [
        { x: -40, y: 80, width: 240, height: 176 },
        blockingCard,
        { x: 680, y: 80, width: 240, height: 176 },
      ],
    );
    const crossesBlockingCard = route.slice(1).some((point, index) => {
      const previous = route[index]!;
      if (previous.x === point.x) {
        return previous.x > blockingCard.x && previous.x < blockingCard.x + blockingCard.width
          && Math.max(previous.y, point.y) > blockingCard.y
          && Math.min(previous.y, point.y) < blockingCard.y + blockingCard.height;
      }
      return previous.y > blockingCard.y && previous.y < blockingCard.y + blockingCard.height
        && Math.max(previous.x, point.x) > blockingCard.x
        && Math.min(previous.x, point.x) < blockingCard.x + blockingCard.width;
    });
    expect(crossesBlockingCard).toBe(false);
    expect(route.length).toBeGreaterThan(4);
    expect(analysisEdgePath(route)).toMatch(/^M .* Q /);
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

  it("compares a unit-carrying series with a bare constant", () => {
    const result = evaluateAnalysisOperator(
      "greater-than",
      series("persons", [[2023, 1800], [2024, 2200]]),
      series("", [[2023, 2000], [2024, 2000]]),
    );
    expect(result.error).toBeNull();
    expect(result.points).toEqual([{ year: 2023, value: false }, { year: 2024, value: true }]);
  });

  it("combines two comparisons with and/or", () => {
    const above = truths([[2023, true], [2024, true]]);
    const below = truths([[2023, true], [2024, false]]);
    expect(evaluateAnalysisOperator("and", above, below).points).toEqual([{ year: 2023, value: true }, { year: 2024, value: false }]);
    expect(evaluateAnalysisOperator("or", above, below).points).toEqual([{ year: 2023, value: true }, { year: 2024, value: true }]);
    // Numbers are not truth values: anding a series with a count is a mistake, not a cast.
    expect(evaluateAnalysisOperator("and", above, series("persons", [[2023, 1]])).error).toBe("incompatible-units");
  });

  it("negates equality", () => {
    const result = evaluateAnalysisOperator("not-equal", series("persons", [[2024, 10]]), series("persons", [[2024, 10]]));
    expect(result.points).toEqual([{ year: 2024, value: false }]);
  });

  it("shifts a series forward so subtracting it yields the change from n years ago", () => {
    const population = series("persons", [[2022, 100], [2023, 110], [2024, 125]]);
    const previous = evaluateAnalysisOperator("shift", population, null, 1);
    expect(previous.unit).toBe("persons");
    expect(previous.points).toEqual([{ year: 2023, value: 100 }, { year: 2024, value: 110 }, { year: 2025, value: 125 }]);
    // The first year has nothing to compare against and drops out of the intersection.
    expect(evaluateAnalysisOperator("subtract", population, previous).points)
      .toEqual([{ year: 2023, value: 10 }, { year: 2024, value: 15 }]);
  });

  it("reports inputs without a shared year instead of an empty chart", () => {
    const result = evaluateAnalysisOperator("add", series("persons", [[2020, 1]]), series("persons", [[2024, 1]]));
    expect(result.error).toBe("no-common-years");
  });

  it("returns boolean comparison series", () => {
    const result = evaluateAnalysisOperator("greater-than", series("persons", [[2024, 10]]), series("persons", [[2024, 8]]));
    expect(result.valueType).toBe("boolean");
    expect(result.unit).toBe("boolean");
    expect(result.points).toEqual([{ year: 2024, value: true }]);
  });
});

describe("editing the number on a node", () => {
  const graph = {
    ...emptyMunicipalityAnalysisGraph(),
    nodes: [
      { id: "c", type: "dataset" as const, position: { x: 0, y: 0 }, data: { dataset: { kind: "constant" as const, value: 0 } } },
      { id: "s", type: "operator" as const, position: { x: 1, y: 1 }, data: { operator: "shift" as const } },
    ],
  };

  it("sets a constant and clamps a shift into range", () => {
    const result = applyMunicipalityAnalysisGraphOperations(graph, [
      { version: 1, type: "set-node-value", nodeId: "c", value: 2000 },
      { version: 1, type: "set-node-value", nodeId: "s", value: 99 },
    ]).graph;
    const constant = result.nodes.find(({ id }) => id === "c");
    expect(constant?.type === "dataset" && constant.data.dataset).toEqual({ kind: "constant", value: 2000 });
    const shift = result.nodes.find(({ id }) => id === "s");
    expect(shift?.type === "operator" && shift.data.years).toBe(20);
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

describe("analysisUnitLabel", () => {
  const translate = (id: string) => ({
    persons: "Personen", share: "Anteil", "per-1000": "je 1.000",
  }[id] ?? id);

  it("translates every atom of a derived unit", () => {
    expect(analysisUnitLabel("persons/share", translate)).toBe("Personen/Anteil");
    expect(analysisUnitLabel("persons·per-1000", translate)).toBe("Personen·je 1.000");
  });

  it("renders nothing for units without a label", () => {
    expect(analysisUnitLabel("", translate)).toBe("");
    expect(analysisUnitLabel("boolean", translate)).toBe("");
  });

  it("leaves unknown atoms untouched instead of failing the lookup", () => {
    expect(analysisUnitLabel("persons/unknown-unit", translate)).toBe("Personen/unknown-unit");
  });
});

describe("addDatasetToGraph", () => {
  it("treats a repeated node id as the node already there, whatever its dataset now is", () => {
    const first = addDatasetToGraph(emptyMunicipalityAnalysisGraph(), { kind: "population", view: "count" }, "node-1");
    const edited = applyMunicipalityAnalysisGraphOperations(first.graph, [
      { version: 1, type: "set-node-municipality", nodeId: "node-1", municipality: { municipalityCode: "70301", municipalityName: "Steeg" } },
    ] as never).graph;
    // Replaying the insert must not add a second node under the same id.
    const replayed = addDatasetToGraph(edited, { kind: "population", view: "count" }, "node-1");
    expect(replayed.duplicate).toBe(true);
    expect(replayed.graph.nodes).toHaveLength(1);
  });
});

describe("set-node-municipality", () => {
  const pinned = { kind: "population" as const, view: "count" as const, municipalityCode: "70301", municipalityName: "Steeg" };
  const graphWith = (dataset: unknown) => municipalityAnalysisGraphSchema.parse({
    version: 1, nodes: [{ id: "n1", type: "dataset", position: { x: 0, y: 0 }, data: { dataset } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: null, subject: null,
  });
  const setMunicipality = (graph: ReturnType<typeof graphWith>, municipality: unknown) =>
    applyMunicipalityAnalysisGraphOperations(graph, [
      { version: 1, type: "set-node-municipality", nodeId: "n1", municipality },
    ] as never).graph.nodes[0];

  it("releases a pinned node so it follows the graph's subject", () => {
    const node = setMunicipality(graphWith(pinned), null);
    expect(node.type === "dataset" && node.data.dataset).toEqual({ kind: "population", view: "count" });
  });

  it("pins an open node without disturbing the rest of the reference", () => {
    const node = setMunicipality(graphWith({ kind: "population", view: "density" }), { municipalityCode: "70301", municipalityName: "Steeg" });
    expect(node.type === "dataset" && node.data.dataset)
      .toEqual({ kind: "population", view: "density", municipalityCode: "70301", municipalityName: "Steeg" });
  });

  it("leaves a constant alone — it carries no municipality", () => {
    const node = setMunicipality(graphWith({ kind: "constant", value: 1000 }), { municipalityCode: "70301", municipalityName: "Steeg" });
    expect(node.type === "dataset" && node.data.dataset).toEqual({ kind: "constant", value: 1000 });
  });
});

describe("analysisSeriesToCsv", () => {
  const series = (points: Array<{ year: number; value: number | boolean | null }>) =>
    ({ unit: "persons", valueType: "number" as const, points, error: null, warnings: [] });

  it("keeps a gap as an empty cell and writes a decimal comma", () => {
    expect(analysisSeriesToCsv(series([
      { year: 2023, value: 1234.5 },
      { year: 2024, value: null },
      { year: 2025, value: 1240 },
    ]), { year: "Jahr", value: "Einwohnerzahl" })).toBe(
      "Jahr;Einwohnerzahl\n2023;1234,5\n2024;\n2025;1240",
    );
  });

  it("quotes a header carrying the separator and writes booleans as 0/1", () => {
    expect(analysisSeriesToCsv(series([{ year: 2025, value: true }, { year: 2024, value: false }]),
      { year: "Jahr", value: 'Anteil; "roh"' }))
      .toBe('Jahr;"Anteil; ""roh"""\n2025;1\n2024;0');
  });
});
