import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMunicipalityAnalysisGraphOperations,
  ANALYSIS_OPERATION_VERSION,
  emptyMunicipalityAnalysisGraph,
  evaluateAnalysisGraph,
  municipalityAnalysisGraphSchema,
  resolveMunicipalityDataset,
  ANALYSIS_GRAPH_VERSION,
  type MunicipalityAnalysisData,
} from "./analysis";
import { COST_CATEGORIES, COST_MEASURES, type MunicipalityCostSeries } from "./costs";
import type { MunicipalityIndex } from "./data";
import { AGE_GROUPS, DEMOGRAPHIC_INDICATORS, type MunicipalityDemographySeries } from "./demography";
import { MOVEMENT_METRICS, type MunicipalityMovementSeries } from "./movement";
import type { MunicipalityPopulationSeries } from "./population";
import type { MunicipalityStructureSeries } from "./structure";
import {
  ageMeasureFor,
  AGE_VIEWS_BY_KIND,
  bindKennzahlInput,
  buildKennzahlGraph,
  COST_MEASURES_BY_KIND,
  MAP_METRICS_BY_KIND,
  MOVEMENT_VIEWS_BY_KIND,
  POPULATION_VIEWS_BY_KIND,
  datasetClass,
  kennzahlExpressionFor,
  kennzahlFormulaText,
  createKennzahlLookup,
  expandKennzahlIntoGraph,
  kennzahlExpressionUnit,
  kennzahlFromGraph,
  KENNZAHL_CATALOG,
  type DataKind,
  type KennzahlInput,
} from "./kennzahlen";
import { isDemographicIndicatorId } from "./demography";

const read = <T,>(file: string) => JSON.parse(readFileSync(resolve("public/data", file), "utf8")) as T;
const data: MunicipalityAnalysisData = {
  index: read<MunicipalityIndex>("municipalities-at-2026.index.json"),
  population: read<MunicipalityPopulationSeries>("municipality-population-2002-2025.json"),
  structure: read<MunicipalityStructureSeries>("municipality-structure-2022-2024.json"),
  demography: read<MunicipalityDemographySeries>("municipality-demography-2002-2025.json"),
  movement: read<MunicipalityMovementSeries>("municipality-movement-2002-2025.json"),
  costs: read<MunicipalityCostSeries>("municipality-cost-shares-2010-2024.json"),
};

// One city and one small municipality — the small one is where zero denominators and
// missing years actually occur.
const MUNICIPALITIES = [
  { municipalityCode: "60101", municipalityName: "Graz" },
  { municipalityCode: "20501", municipalityName: "Althofen" },
];

const sexes = ["all", "female", "male"] as const;
const DERIVED_OUTPUTS: KennzahlInput[] = [
  { kind: "population", view: "density" },
  { kind: "population", view: "foreign-share" },
  ...AGE_GROUPS.flatMap(({ id }) => sexes.map((sex): KennzahlInput => ({ kind: "age-group", ageGroup: id, measure: "share", sex }))),
  ...DEMOGRAPHIC_INDICATORS.map(({ id }): KennzahlInput => ({ kind: "age-indicator", indicator: id })),
  ...MOVEMENT_METRICS
    .filter(({ id }) => datasetClass({ kind: "movement", metric: id }) === "derived")
    .map(({ id }): KennzahlInput => ({ kind: "movement", metric: id })),
  ...COST_CATEGORIES.flatMap(({ id }) => COST_MEASURES
    .filter((measure) => measure !== "absolute")
    .map((measure): KennzahlInput => ({ kind: "cost-share", category: id, measure }))),
];

/** The four cases the current node vocabulary genuinely cannot express. */
const PRIMARY_ONLY = new Set(["average-age", "real-per-capita", "peer-deviation"]);
const isPrimaryOnly = (output: KennzahlInput) =>
  (output.kind === "age-indicator" && PRIMARY_ONLY.has(output.indicator))
  || (output.kind === "cost-share" && PRIMARY_ONLY.has(output.measure ?? "share"));

// Cost shares divide two euro amounts where the hand-written version divides two cent
// amounts, so the last bits differ. Everything else matches exactly; the tolerance is
// there for the unit conversion, not to paper over a different formula.
const TOLERANCE = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

describe("Kennzahl definitions reproduce their built-in implementations", () => {
  for (const output of DERIVED_OUTPUTS) {
    const expression = kennzahlExpressionFor(output);
    const name = JSON.stringify(output);

    if (isPrimaryOnly(output)) {
      it(`marks ${name} as a primary calculation`, () => {
        expect(expression).toBeNull();
      });
      continue;
    }

    it(`derives ${name} from Ausgangsdaten`, () => {
      expect(expression, "every derived Kennzahl needs a derivation or an explicit null").not.toBeNull();
      for (const municipality of MUNICIPALITIES) {
        const { nodes, edges, rootId } = buildKennzahlGraph(expression!, municipality);
        // The graph the analysis tool would persist has to be valid on its own terms:
        // unique ids, no cycles, one edge per operator input, within the node limits.
        const graph = municipalityAnalysisGraphSchema.parse({
          version: ANALYSIS_GRAPH_VERSION, nodes, edges,
          viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: rootId,
        });

        const actual = evaluateAnalysisGraph(graph, data).get(rootId);
        const expected = resolveMunicipalityDataset(
          bindKennzahlInput(output, municipality.municipalityCode, municipality.municipalityName),
          data,
        );
        expect(actual, name).toBeDefined();
        expect(actual!.error, name).toBeNull();
        expect(actual!.points.map(({ year }) => year), `${name} year span`)
          .toEqual(expected.points.map(({ year }) => year));

        const expectedByYear = new Map(expected.points.map(({ year, value }) => [year, value]));
        for (const { year, value } of actual!.points) {
          const want = expectedByYear.get(year);
          const label = `${name} @ ${municipality.municipalityName}/${year}`;
          if (typeof want === "number" && typeof value === "number") {
            expect(close(value, want), `${label}: ${value} vs ${want}`).toBe(true);
          } else {
            expect(value, label).toBe(want);
          }
        }
      }
    });
  }
});

describe("Kennzahl catalogue and classification", () => {
  it("classifies raw counts as Ausgangsdaten and computed values as Kennzahlen", () => {
    expect(datasetClass({ kind: "population", view: "count" })).toBe("base");
    expect(datasetClass({ kind: "population", view: "structure-population" })).toBe("base");
    expect(datasetClass({ kind: "population", view: "density" })).toBe("derived");
    expect(datasetClass({ kind: "attribute", field: "area" })).toBe("base");
    expect(datasetClass({ kind: "movement", metric: "births" })).toBe("base");
    expect(datasetClass({ kind: "movement", metric: "birth-rate" })).toBe("derived");
    expect(datasetClass({ kind: "cost-share", category: "0", measure: "absolute" })).toBe("base");
    expect(datasetClass({ kind: "cost-share", category: "0", measure: "share" })).toBe("derived");
  });

  it("only lists derived outputs and keeps ids unique", () => {
    expect(KENNZAHL_CATALOG.every(({ output }) => datasetClass(output) === "derived")).toBe(true);
    expect(new Set(KENNZAHL_CATALOG.map(({ id }) => id)).size).toBe(KENNZAHL_CATALOG.length);
  });

  it("reuses one node when the same Ausgangsdatum appears twice", () => {
    // total-dependency is (Jugend + Senioren) ÷ Erwerbsalter × 100 and reads the seven
    // age groups once each, not once per occurrence.
    const expression = kennzahlExpressionFor({ kind: "age-indicator", indicator: "total-dependency" })!;
    const { nodes } = buildKennzahlGraph(expression, MUNICIPALITIES[0]);
    const datasets = nodes.filter((node) => node.type === "dataset");
    expect(new Set(datasets.map((node) => JSON.stringify(node.data.dataset))).size).toBe(datasets.length);
  });

  it("renders the derivation as a readable formula", () => {
    const expression = kennzahlExpressionFor({ kind: "movement", metric: "birth-rate" })!;
    const text = kennzahlFormulaText(expression, (input) => input.kind === "movement" ? "Geburten" : "Einwohnerzahl");
    expect(text).toBe("(Geburten ÷ Einwohnerzahl) × 1000");
  });
});

describe("dropdown lists match the classification", () => {
  const kinds: DataKind[] = ["base", "derived"];

  it.each(kinds)("only offers %s population views of that kind", (kind) => {
    for (const view of POPULATION_VIEWS_BY_KIND[kind]) {
      expect(datasetClass({ kind: "population", view }), view).toBe(kind);
    }
  });

  it.each(kinds)("only offers %s age views of that kind", (kind) => {
    const measure = ageMeasureFor(kind);
    for (const view of AGE_VIEWS_BY_KIND[kind]) {
      const input: KennzahlInput = isDemographicIndicatorId(view)
        ? { kind: "age-indicator", indicator: view }
        : { kind: "age-group", ageGroup: view, measure, sex: "all" };
      expect(datasetClass(input), view).toBe(kind);
    }
  });

  it.each(kinds)("only offers %s movement views of that kind", (kind) => {
    for (const metric of MOVEMENT_VIEWS_BY_KIND[kind]) {
      expect(datasetClass({ kind: "movement", metric }), metric).toBe(kind);
    }
  });

  it.each(kinds)("only offers %s cost measures of that kind", (kind) => {
    for (const measure of COST_MEASURES_BY_KIND[kind]) {
      expect(datasetClass({ kind: "cost-share", category: "0", measure }), measure).toBe(kind);
    }
  });

  it("drops a category that has nothing to show for a Datenart", () => {
    // The digital inventory is Ausgangsdaten only, so it must not appear under Kennzahlen.
    expect(MAP_METRICS_BY_KIND.base).toContain("digital");
    expect(MAP_METRICS_BY_KIND.derived).not.toContain("digital");
    expect(MAP_METRICS_BY_KIND.derived.length).toBeGreaterThan(0);
  });

  it("gives every offered category a non-empty view list", () => {
    for (const kind of kinds) {
      for (const metric of MAP_METRICS_BY_KIND[kind]) {
        const views = metric === "population" ? POPULATION_VIEWS_BY_KIND[kind]
          : metric === "age" ? AGE_VIEWS_BY_KIND[kind]
            : metric === "movement" ? MOVEMENT_VIEWS_BY_KIND[kind]
              : metric === "costs" ? COST_MEASURES_BY_KIND[kind] : null;
        if (views) expect(views.length, `${kind}/${metric}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the map evaluator agrees with the graph evaluator", () => {
  // The map cannot use resolveMunicipalityDataset — it does a linear index scan per year
  // and the peer comparison inside it is quadratic across 2.092 municipalities. This
  // checks the fast reader it uses instead produces the same numbers.
  for (const output of DERIVED_OUTPUTS) {
    if (isPrimaryOnly(output)) continue;
    const expression = kennzahlExpressionFor(output)!;
    const name = JSON.stringify(output);

    it(`reads ${name} the same way`, () => {
      const lookup = createKennzahlLookup(expression, data);
      for (const municipality of MUNICIPALITIES) {
        const expected = resolveMunicipalityDataset(
          bindKennzahlInput(output, municipality.municipalityCode, municipality.municipalityName),
          data,
        );
        for (const { year, value } of expected.points) {
          const actual = lookup(municipality.municipalityCode, year);
          const label = `${name} @ ${municipality.municipalityName}/${year}`;
          if (typeof value === "number" && actual !== null) {
            expect(close(actual, value), `${label}: ${actual} vs ${value}`).toBe(true);
          } else {
            expect(actual, label).toBe(value);
          }
        }
      }
    });
  }

  it("evaluates the peer comparison, which has no derivation of its own", () => {
    const peer: KennzahlInput = { kind: "cost-share", category: "8", measure: "peer-deviation" };
    const lookup = createKennzahlLookup({ input: peer }, data);
    const expected = resolveMunicipalityDataset(bindKennzahlInput(peer, "60101", "Graz"), data);
    for (const { year, value } of expected.points) {
      const actual = lookup("60101", year);
      if (typeof value === "number" && actual !== null) expect(close(actual, value), String(year)).toBe(true);
      else expect(actual, String(year)).toBe(value);
    }
  });
});

describe("saving a graph as a Kennzahl", () => {
  const graphOf = (output: KennzahlInput, municipality = MUNICIPALITIES[0]) => {
    const { nodes, edges, rootId } = buildKennzahlGraph(kennzahlExpressionFor(output)!, municipality);
    return { graph: { nodes, edges }, rootId };
  };

  it("round-trips a derivation back into the same definition", () => {
    const output: KennzahlInput = { kind: "movement", metric: "birth-rate" };
    const { graph, rootId } = graphOf(output);
    const result = kennzahlFromGraph(graph, rootId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.municipality?.municipalityCode).toBe(MUNICIPALITIES[0].municipalityCode);
    expect(result.expression).toEqual(kennzahlExpressionFor(output));
  });

  it("refuses a graph that mixes two municipalities", () => {
    const first = graphOf({ kind: "movement", metric: "births" }, MUNICIPALITIES[0]);
    const second = graphOf({ kind: "movement", metric: "births" }, MUNICIPALITIES[1]);
    const operatorId = "op-1";
    const graph = {
      nodes: [...first.graph.nodes, ...second.graph.nodes, {
        id: operatorId, type: "operator" as const, position: { x: 0, y: 0 }, data: { operator: "add" as const },
      }],
      edges: [
        ...first.graph.edges, ...second.graph.edges,
        { id: "e1", source: first.rootId, target: operatorId, sourceHandle: "output" as const, targetHandle: "a" as const },
        { id: "e2", source: second.rootId, target: operatorId, sourceHandle: "output" as const, targetHandle: "b" as const },
      ],
    };
    const result = kennzahlFromGraph(graph, operatorId);
    expect(result).toEqual({ ok: false, reason: "mixed-municipalities" });
  });

  it("refuses an operator with a dangling input", () => {
    const { graph, rootId } = graphOf({ kind: "movement", metric: "birth-rate" });
    const withoutOneEdge = { nodes: graph.nodes, edges: graph.edges.slice(1) };
    expect(kennzahlFromGraph(withoutOneEdge, rootId)).toEqual({ ok: false, reason: "missing-input" });
  });

  it("refuses a Kennzahl built only from constants", () => {
    const graph = {
      nodes: [
        { id: "a", type: "dataset" as const, position: { x: 0, y: 0 }, data: { dataset: { kind: "constant" as const, value: 2 } } },
        { id: "b", type: "dataset" as const, position: { x: 0, y: 0 }, data: { dataset: { kind: "constant" as const, value: 3 } } },
        { id: "op", type: "operator" as const, position: { x: 0, y: 0 }, data: { operator: "add" as const } },
      ],
      edges: [
        { id: "e1", source: "a", target: "op", sourceHandle: "output" as const, targetHandle: "a" as const },
        { id: "e2", source: "b", target: "op", sourceHandle: "output" as const, targetHandle: "b" as const },
      ],
    };
    expect(kennzahlFromGraph(graph, "op")).toEqual({ ok: false, reason: "no-municipality-input" });
  });

  it("derives the unit from the Ausgangsdaten, ignoring dimensionless factors", () => {
    expect(kennzahlExpressionUnit(kennzahlExpressionFor({ kind: "movement", metric: "birth-rate" })!))
      .toBe("persons/persons");
    expect(kennzahlExpressionUnit(kennzahlExpressionFor({ kind: "population", view: "density" })!))
      .toBe("persons/square-kilometers");
  });
});

describe("adding a Kennzahl to a graph", () => {
  const add = (graph: ReturnType<typeof emptyMunicipalityAnalysisGraph>, dataset: Parameters<typeof expandKennzahlIntoGraph>[0]) =>
    applyMunicipalityAnalysisGraphOperations(
      graph,
      [{ version: ANALYSIS_OPERATION_VERSION, type: "add-kennzahl", nodeId: "fallback-node", dataset }],
      expandKennzahlIntoGraph,
    ).graph;
  const counts = (graph: ReturnType<typeof emptyMunicipalityAnalysisGraph>) => ({
    datasets: graph.nodes.filter(({ type }) => type === "dataset").length,
    operators: graph.nodes.filter(({ type }) => type === "operator").length,
  });

  it("adds an Ausgangsdatum as a single node", () => {
    const graph = add(emptyMunicipalityAnalysisGraph(), {
      kind: "population", municipalityCode: "60101", municipalityName: "Graz", view: "count",
    });
    expect(counts(graph)).toEqual({ datasets: 1, operators: 0 });
  });

  it("adds a Kennzahl as its derivation and reuses what is already there", () => {
    // The map builds a reference with its own field order; the derivation binds a
    // different one. Both name the same Einwohnerzahl, so only Katasterfläche is new.
    let graph = add(emptyMunicipalityAnalysisGraph(), {
      kind: "population", municipalityCode: "60101", municipalityName: "Graz", view: "count",
    });
    graph = add(graph, {
      kind: "population", municipalityCode: "60101", municipalityName: "Graz", view: "density",
    });
    expect(counts(graph)).toEqual({ datasets: 2, operators: 1 });
    expect(graph.edges).toHaveLength(2);
  });

  it("stays put when the same Kennzahl is added twice", () => {
    // The persistence queue retries on failure, so the same operation can arrive twice.
    const dataset = { kind: "population" as const, municipalityCode: "60101", municipalityName: "Graz", view: "density" as const };
    const once = add(emptyMunicipalityAnalysisGraph(), dataset);
    const twice = add(once, dataset);
    expect(counts(twice)).toEqual(counts(once));
    expect(twice.edges).toHaveLength(once.edges.length);
  });

  it("falls back to one node for a primary calculation", () => {
    const graph = add(emptyMunicipalityAnalysisGraph(), {
      kind: "age-indicator", municipalityCode: "60101", municipalityName: "Graz", indicator: "average-age",
    });
    expect(counts(graph)).toEqual({ datasets: 1, operators: 0 });
  });
});

describe("the municipality as a graph parameter", () => {
  const graphOf = (expression: Parameters<typeof buildKennzahlGraph>[0], municipality: Parameters<typeof buildKennzahlGraph>[1], subject: { municipalityCode: string; municipalityName: string } | null) => {
    const { nodes, edges, rootId } = buildKennzahlGraph(expression, municipality);
    const graph = municipalityAnalysisGraphSchema.parse({
      version: ANALYSIS_GRAPH_VERSION, nodes, edges,
      viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: rootId, subject,
    });
    return { graph, rootId };
  };

  // The whole point of the parameter: an open graph evaluated for a municipality has to
  // produce exactly what a graph pinned to it produces.
  for (const output of DERIVED_OUTPUTS) {
    if (isPrimaryOnly(output)) continue;
    const expression = kennzahlExpressionFor(output)!;
    const name = JSON.stringify(output);

    it(`evaluates ${name} the same open as pinned`, () => {
      for (const municipality of MUNICIPALITIES) {
        const { graph, rootId } = graphOf(expression, null, municipality);
        const actual = evaluateAnalysisGraph(graph, data).get(rootId)!;
        const expected = resolveMunicipalityDataset(
          bindKennzahlInput(output, municipality.municipalityCode, municipality.municipalityName),
          data,
        );
        expect(actual.error, name).toBeNull();
        expect(actual.points.map(({ year }) => year), `${name} years`).toEqual(expected.points.map(({ year }) => year));
        const expectedByYear = new Map(expected.points.map(({ year, value }) => [year, value]));
        for (const { year, value } of actual.points) {
          const want = expectedByYear.get(year);
          const label = `${name} @ ${municipality.municipalityName}/${year}`;
          if (typeof want === "number" && typeof value === "number") {
            expect(close(value, want), `${label}: ${value} vs ${want}`).toBe(true);
          } else {
            expect(value, label).toBe(want);
          }
        }
      }
    });
  }

  it("reports an open node without a subject, all the way up the chain", () => {
    const expression = kennzahlExpressionFor({ kind: "movement", metric: "birth-rate" })!;
    const { graph, rootId } = graphOf(expression, null, null);
    const results = evaluateAnalysisGraph(graph, data);
    const openDataset = graph.nodes.find((node) => node.type === "dataset" && node.data.dataset.kind === "movement")!;
    expect(results.get(openDataset.id)!.error).toBe("missing-municipality");
    // The operators above it must say why they are empty, not just be empty.
    expect(results.get(rootId)!.error).toBe("missing-municipality");
  });

  it("lets a pinned node ignore the subject", () => {
    // A graph stored before the subject existed is pinned throughout and must not change
    // its numbers when a subject is set.
    const output: KennzahlInput = { kind: "movement", metric: "birth-rate" };
    const expression = kennzahlExpressionFor(output)!;
    const { graph, rootId } = graphOf(expression, MUNICIPALITIES[0], MUNICIPALITIES[1]);
    const actual = evaluateAnalysisGraph(graph, data).get(rootId)!;
    const expected = resolveMunicipalityDataset(
      bindKennzahlInput(output, MUNICIPALITIES[0].municipalityCode, MUNICIPALITIES[0].municipalityName),
      data,
    );
    const expectedByYear = new Map(expected.points.map(({ year, value }) => [year, value]));
    for (const { year, value } of actual.points) {
      const want = expectedByYear.get(year);
      if (typeof want === "number" && typeof value === "number") expect(close(value, want), String(year)).toBe(true);
      else expect(value, String(year)).toBe(want);
    }
  });

  it("saves an open sub-graph as a Kennzahl without asking for a municipality", () => {
    const expression = kennzahlExpressionFor({ kind: "population", view: "density" })!;
    const { graph, rootId } = graphOf(expression, null, null);
    const result = kennzahlFromGraph(graph, rootId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.municipality).toBeNull();
    expect(result.expression).toEqual(expression);
  });

  it("keeps parsing a graph stored before the subject existed", () => {
    const legacy = municipalityAnalysisGraphSchema.parse({
      version: ANALYSIS_GRAPH_VERSION, nodes: [], edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeId: null,
    });
    expect(legacy.subject).toBeNull();
  });
});
