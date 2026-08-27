import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import {
  analysisBinaryOperatorIds,
  analysisUnaryOperatorIds,
  ANALYSIS_OPERATOR_SYMBOLS,
  DEFAULT_ANALYSIS_SHIFT_YEARS,
  isBooleanAnalysisOperator,
  isUnaryAnalysisOperator,
  MAX_ANALYSIS_SHIFT_YEARS,
  type AnalysisBinaryOperatorId,
  type AnalysisSubject,
  type AnalysisUnaryOperatorId,
  municipalityDatasetRefSchema,
  ANALYSIS_OPERATION_VERSION,
  composeAnalysisUnit,
  datasetRefKey,
  datasetUnit,
  type AnalysisOperatorId,
  type MunicipalityAnalysisEdge,
  type MunicipalityAnalysisData,
  type MunicipalityAnalysisGraphOperation,
  type MunicipalityAnalysisNode,
  type MunicipalityDatasetRef,
} from "./analysis";
import {
  median,
  municipalityCostAbsolute,
  municipalityCostPerCapita,
  municipalityCostRealPerCapita,
  municipalityCostShare,
  municipalityPopulationBand,
  COST_TARGETS,
  type CostMeasureId,
  type CostTargetId,
} from "./costs";
import { AGE_GROUPS, AGE_TARGETS, DEMOGRAPHIC_INDICATORS, demographicIndicatorValue, demographyMetricValue, type AgeMeasure, type AgeTargetId, type AgeViewId, type MapMetric, type SexFilter } from "./demography";
import { DIGITAL_PLATFORM_VIEWS, type DigitalPlatformViewId } from "./digital-platforms";
import { MOVEMENT_METRICS, MOVEMENT_RAW_TARGETS, movementTargetValue, type MovementTargetId } from "./movement";
import type { PoliticsView } from "./politics";
import { populationViewValue, type PopulationViewId } from "./structure";

/**
 * Ausgangsdaten are read straight out of a data file; Kennzahlen are computed from them.
 *
 * The built-in Kennzahlen keep their hand-written implementations as the map's execution
 * path — those run over 2.092 municipalities × 24 years and are already tested. What
 * lives here is a second, declarative description of the same arithmetic, used to show
 * the derivation in the analysis tool and to evaluate user-defined Kennzahlen.
 * `kennzahlen.test.ts` asserts the two agree, so they cannot drift apart.
 */
export type DataKind = "base" | "derived";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A dataset reference with the municipality left open — the parameter of a Kennzahl. */
export type KennzahlInput = DistributiveOmit<
  Exclude<MunicipalityDatasetRef, { kind: "constant" }>,
  "municipalityCode" | "municipalityName"
>;

export type KennzahlExpression =
  | { input: KennzahlInput }
  | { constant: number }
  | { op: AnalysisBinaryOperatorId; a: KennzahlExpression; b: KennzahlExpression }
  // A unary operator reads one side plus its year count; `b` is what tells the two apart.
  | { op: AnalysisUnaryOperatorId; a: KennzahlExpression; years: number };

export type KennzahlDefinition = {
  id: string;
  category: MapMetric;
  /** Key in the `municipalities` message namespace. */
  labelKey: string;
  output: KennzahlInput;
};

/** Ties an input to a municipality, or leaves it open when none is given. */
export function bindKennzahlInput(
  input: KennzahlInput,
  municipalityCode?: string,
  municipalityName?: string,
): MunicipalityDatasetRef {
  return (municipalityCode
    ? { ...input, municipalityCode, municipalityName }
    : { ...input }) as MunicipalityDatasetRef;
}

// --- classification ---------------------------------------------------------

const MOVEMENT_BASE_METRICS = new Set<MovementTargetId>([
  "population-change", "births", "deaths", "arrivals", "departures",
  "international-arrivals", "international-departures", "internal-arrivals", "internal-departures",
]);

export function datasetClass(input: KennzahlInput): DataKind {
  if (input.kind === "attribute") return "base";
  if (input.kind === "population") {
    return input.view === "density" || input.view === "foreign-share" ? "derived" : "base";
  }
  if (input.kind === "age-group") return input.measure === "share" ? "derived" : "base";
  if (input.kind === "age-indicator") return "derived";
  if (input.kind === "movement") return MOVEMENT_BASE_METRICS.has(input.metric) ? "base" : "derived";
  return (input.measure ?? "share") === "absolute" ? "base" : "derived";
}

// --- expression construction ------------------------------------------------

const inp = (input: KennzahlInput): KennzahlExpression => ({ input });
const con = (constant: number): KennzahlExpression => ({ constant });
const bin = (op: AnalysisBinaryOperatorId, a: KennzahlExpression, b: KennzahlExpression): KennzahlExpression => ({ op, a, b });
const add = (a: KennzahlExpression, b: KennzahlExpression) => bin("add", a, b);
const sub = (a: KennzahlExpression, b: KennzahlExpression) => bin("subtract", a, b);
const mul = (a: KennzahlExpression, b: KennzahlExpression) => bin("multiply", a, b);
const div = (a: KennzahlExpression, b: KennzahlExpression) => bin("divide", a, b);

const POPULATION = inp({ kind: "population", view: "count" });
const AREA = inp({ kind: "attribute", field: "area" });
const age = (ageGroup: AgeTargetId, sex: SexFilter = "all") =>
  inp({ kind: "age-group", ageGroup, measure: "persons", sex });
const move = (metric: MovementTargetId) => inp({ kind: "movement", metric });
const cost = (category: CostTargetId) => inp({ kind: "cost-share", category, measure: "absolute" });

const youth = add(age("0-5"), age("6-14"));
const seniors = add(age("65-79"), age("80-plus"));
const workingAge = add(add(age("15-24"), age("25-44")), age("45-64"));
const perMille = (numerator: KennzahlExpression) => mul(div(numerator, POPULATION), con(1_000));
const internationalBalance = sub(move("international-arrivals"), move("international-departures"));
const internalBalance = sub(move("internal-arrivals"), move("internal-departures"));

/**
 * How a Kennzahl is built from Ausgangsdaten, or `null` when it is a primary calculation
 * that the current node vocabulary cannot express.
 *
 * ponytail: the four `null` cases need vocabulary this graph does not have —
 * `average-age` the per-person age sum, `real-per-capita` a year-varying reference series
 * (the CPI), `peer-deviation` an aggregate operator over other municipalities, and
 * politics/digital their own base datasets. Add those node kinds when someone needs to
 * edit one of these; until then the catalogue shows them as Primärberechnung.
 */
export function kennzahlExpressionFor(output: KennzahlInput): KennzahlExpression | null {
  if (datasetClass(output) === "base") return inp(output);

  if (output.kind === "population") {
    if (output.view === "density") return div(POPULATION, AREA);
    // Both citizenship figures come from the same 31 October snapshot; the Einwohner-
    // zeitreihe counts on 1 January and would give a different denominator.
    return div(
      inp({ kind: "population", view: "foreign-persons" }),
      inp({ kind: "population", view: "structure-population" }),
    );
  }

  if (output.kind === "age-group") {
    return div(age(output.ageGroup, output.sex), age("total", output.sex));
  }

  if (output.kind === "age-indicator") {
    const indicator = output.indicator;
    if (indicator === "youth-share") return div(youth, age("total"));
    if (indicator === "senior-share") return div(seniors, age("total"));
    if (indicator === "old-age-dependency") return mul(div(seniors, workingAge), con(100));
    if (indicator === "child-dependency") return mul(div(youth, workingAge), con(100));
    if (indicator === "total-dependency") return mul(div(add(youth, seniors), workingAge), con(100));
    if (indicator === "aging-index") return mul(div(seniors, youth), con(100));
    if (indicator === "women-share") return div(age("total", "female"), age("total"));
    if (indicator === "women-per-100-men") return mul(div(age("total", "female"), age("total", "male")), con(100));
    return null; // average-age
  }

  if (output.kind === "movement") {
    const metric = output.metric;
    if (metric === "birth-rate") return perMille(move("births"));
    if (metric === "death-rate") return perMille(move("deaths"));
    if (metric === "birth-balance-rate") return perMille(sub(move("births"), move("deaths")));
    if (metric === "migration-balance-rate") return perMille(sub(move("arrivals"), move("departures")));
    if (metric === "international-migration-balance") return internationalBalance;
    if (metric === "international-migration-balance-rate") return perMille(internationalBalance);
    if (metric === "internal-migration-balance") return internalBalance;
    if (metric === "internal-migration-balance-rate") return perMille(internalBalance);
    // Gesamtveränderung minus Geburtenbilanz minus Wanderungsbilanz.
    return sub(
      sub(move("population-change"), sub(move("births"), move("deaths"))),
      sub(move("arrivals"), move("departures")),
    );
  }

  // `attribute` is always base and returned above; only cost measures are left.
  if (output.kind !== "cost-share") return null;
  const measure = output.measure ?? "share";
  if (measure === "share") return div(cost(output.category), cost("total"));
  if (measure === "per-capita") return div(cost(output.category), POPULATION);
  return null; // real-per-capita, peer-deviation
}

// --- browsable catalogue ----------------------------------------------------

const AGE_INDICATOR_IDS = [
  "youth-share", "senior-share", "old-age-dependency", "child-dependency", "total-dependency",
  "aging-index", "average-age", "women-share", "women-per-100-men",
] as const;
const DERIVED_MOVEMENT_IDS = [
  "birth-rate", "death-rate", "birth-balance-rate", "migration-balance-rate",
  "international-migration-balance", "international-migration-balance-rate",
  "internal-migration-balance", "internal-migration-balance-rate", "statistical-correction",
] as const;
const INDICATOR_LABEL_KEYS: Record<(typeof AGE_INDICATOR_IDS)[number], string> = {
  "youth-share": "indicatorYouthShare", "senior-share": "indicatorSeniorShare",
  "old-age-dependency": "indicatorOldAgeDependency", "child-dependency": "indicatorChildDependency",
  "total-dependency": "indicatorTotalDependency", "aging-index": "indicatorAgingIndex",
  "average-age": "indicatorAverageAge", "women-share": "indicatorWomenShare",
  "women-per-100-men": "indicatorWomenPer100Men",
};
const MOVEMENT_LABEL_KEYS: Record<(typeof DERIVED_MOVEMENT_IDS)[number], string> = {
  "birth-rate": "movementBirthRate", "death-rate": "movementDeathRate",
  "birth-balance-rate": "movementBirthBalanceRate", "migration-balance-rate": "movementMigrationBalanceRate",
  "international-migration-balance": "movementInternationalBalance",
  "international-migration-balance-rate": "movementInternationalBalanceRate",
  "internal-migration-balance": "movementInternalBalance",
  "internal-migration-balance-rate": "movementInternalBalanceRate",
  "statistical-correction": "movementStatisticalCorrection",
};

/**
 * The entries the analysis tool offers for browsing. Parameterised families (age groups
 * by sex, cost categories) are listed once with a representative parameter — dragging a
 * concrete selection off the map still expands the exact combination that was chosen.
 */
export const KENNZAHL_CATALOG: KennzahlDefinition[] = [
  { id: "population-density", category: "population", labelKey: "populationDensity", output: { kind: "population", view: "density" } },
  { id: "population-foreign-share", category: "population", labelKey: "populationForeignShare", output: { kind: "population", view: "foreign-share" } },
  { id: "age-group-share", category: "age", labelKey: "ageMeasureShare", output: { kind: "age-group", ageGroup: "65-79", measure: "share", sex: "all" } },
  ...AGE_INDICATOR_IDS.map((indicator): KennzahlDefinition => ({
    id: `age-${indicator}`, category: "age", labelKey: INDICATOR_LABEL_KEYS[indicator],
    output: { kind: "age-indicator", indicator },
  })),
  ...DERIVED_MOVEMENT_IDS.map((metric): KennzahlDefinition => ({
    id: `movement-${metric}`, category: "movement", labelKey: MOVEMENT_LABEL_KEYS[metric],
    output: { kind: "movement", metric },
  })),
  { id: "cost-share", category: "costs", labelKey: "costMeasureShare", output: { kind: "cost-share", category: "0", measure: "share" } },
  { id: "cost-per-capita", category: "costs", labelKey: "costMeasurePerCapita", output: { kind: "cost-share", category: "0", measure: "per-capita" } },
  { id: "cost-real-per-capita", category: "costs", labelKey: "costMeasureRealPerCapita", output: { kind: "cost-share", category: "0", measure: "real-per-capita" } },
  { id: "cost-peer-deviation", category: "costs", labelKey: "costMeasurePeerDeviation", output: { kind: "cost-share", category: "0", measure: "peer-deviation" } },
];

// --- graph construction -----------------------------------------------------

const expressionKey = (expression: KennzahlExpression): string =>
  "input" in expression ? `i:${JSON.stringify(expression.input)}`
    : "constant" in expression ? `c:${expression.constant}`
      : "b" in expression ? `o:${expression.op}(${expressionKey(expression.a)},${expressionKey(expression.b)})`
        : `u:${expression.op}:${expression.years}(${expressionKey(expression.a)})`;

/**
 * Lays the expression out as an analysis graph: inputs on the left, the result on the
 * right. Identical sub-expressions become one node feeding several edges, so a Kennzahl
 * that uses the same Ausgangsdatum twice does not show it twice.
 */
export function buildKennzahlGraph(
  expression: KennzahlExpression,
  /** Pins every input to this municipality; open nodes follow the graph's subject. */
  municipality: { municipalityCode?: string; municipalityName?: string } | null,
  origin: { x: number; y: number } = { x: 80, y: 80 },
  /** What is already on the canvas; matching parts wire in instead of being duplicated. */
  existing: { nodes: readonly MunicipalityAnalysisNode[]; edges: readonly MunicipalityAnalysisEdge[] } = { nodes: [], edges: [] },
) {
  const existingNodes = existing.nodes;
  const existingByDataset = new Map(
    existingNodes.flatMap((node) => node.type === "dataset" ? [[datasetRefKey(node.data.dataset), node.id] as const] : []),
  );
  // An operator already fed by exactly these two inputs is this sub-expression, so reuse
  // it. Without this an insert would not be idempotent, and the persistence queue may
  // deliver the same operation twice after a retry.
  const existingOperator = (operator: AnalysisOperatorId, a: string, b: string | null, years?: number) => {
    for (const node of existingNodes) {
      if (node.type !== "operator" || node.data.operator !== operator) continue;
      if (years !== undefined && (node.data.years ?? DEFAULT_ANALYSIS_SHIFT_YEARS) !== years) continue;
      const source = (handle: "a" | "b") =>
        existing.edges.find((edge) => edge.target === node.id && edge.targetHandle === handle)?.source;
      // A unary operator matches only a node whose B is free, so it never reuses half of
      // a binary one.
      if (source("a") === a && (b === null ? !source("b") : source("b") === b)) return node.id;
    }
    return null;
  };
  const depths = new Map<string, number>();
  const measure = (node: KennzahlExpression, depth: number) => {
    const key = expressionKey(node);
    depths.set(key, Math.max(depths.get(key) ?? 0, depth));
    if ("op" in node) {
      measure(node.a, depth + 1);
      if ("b" in node) measure(node.b, depth + 1);
    }
  };
  measure(expression, 0);
  const maximumDepth = Math.max(...depths.values());

  const nodes: MunicipalityAnalysisNode[] = [];
  const edges: MunicipalityAnalysisEdge[] = [];
  const idByKey = new Map<string, string>();
  const rowByColumn = new Map<number, number>();

  const place = (node: KennzahlExpression): string => {
    const key = expressionKey(node);
    const seen = idByKey.get(key);
    if (seen) return seen;

    if (!("op" in node)) {
      const dataset: MunicipalityDatasetRef = "constant" in node
        ? { kind: "constant", value: node.constant }
        : bindKennzahlInput(node.input, municipality?.municipalityCode, municipality?.municipalityName);
      const reused = existingByDataset.get(datasetRefKey(dataset));
      if (reused) {
        idByKey.set(key, reused);
        return reused;
      }
      const id = createId();
      idByKey.set(key, id);
      nodes.push({ id, type: "dataset", position: nextPosition(key), data: { dataset } });
      return id;
    }

    // Children first so their nodes exist before the edges reference them.
    const a = place(node.a);
    if (!("b" in node)) {
      const reusedUnary = existingOperator(node.op, a, null, node.years);
      if (reusedUnary) {
        idByKey.set(key, reusedUnary);
        return reusedUnary;
      }
      const unaryId = createId();
      idByKey.set(key, unaryId);
      nodes.push({ id: unaryId, type: "operator", position: nextPosition(key), data: { operator: node.op, years: node.years } });
      edges.push({ id: createId(), source: a, target: unaryId, sourceHandle: "output", targetHandle: "a" });
      return unaryId;
    }
    const b = place(node.b);
    const reusedOperator = existingOperator(node.op, a, b);
    if (reusedOperator) {
      idByKey.set(key, reusedOperator);
      return reusedOperator;
    }
    const id = createId();
    idByKey.set(key, id);
    nodes.push({ id, type: "operator", position: nextPosition(key), data: { operator: node.op } });
    edges.push({ id: createId(), source: a, target: id, sourceHandle: "output", targetHandle: "a" });
    edges.push({ id: createId(), source: b, target: id, sourceHandle: "output", targetHandle: "b" });
    return id;
  };

  function nextPosition(key: string) {
    const column = maximumDepth - depths.get(key)!;
    const row = rowByColumn.get(column) ?? 0;
    rowByColumn.set(column, row + 1);
    return { x: origin.x + column * 280, y: origin.y + row * 200 };
  }

  const rootId = place(expression);
  return { nodes, edges, rootId };
}

/** Drops the municipality from a dataset reference, leaving the Kennzahl parameter. */
export function unbindKennzahlInput(dataset: MunicipalityDatasetRef): KennzahlInput | null {
  if (dataset.kind === "constant") return null;
  const { municipalityCode, municipalityName, ...input } = dataset;
  void municipalityCode;
  void municipalityName;
  return input as KennzahlInput;
}

/** Places a new block clear of whatever the graph already holds. */
export function nextGraphOrigin(nodes: readonly MunicipalityAnalysisNode[]) {
  if (!nodes.length) return { x: 80, y: 80 };
  return { x: 80, y: Math.max(...nodes.map(({ position }) => position.y)) + 220 };
}

/**
 * The operations that add a Kennzahl's derivation to an analysis graph — or null when the
 * dataset is an Ausgangsdatum or a primary calculation, which go in as a single node.
 */
export function kennzahlDerivationOperations(
  dataset: MunicipalityDatasetRef,
  origin?: { x: number; y: number },
  existing: { nodes: readonly MunicipalityAnalysisNode[]; edges: readonly MunicipalityAnalysisEdge[] } = { nodes: [], edges: [] },
): MunicipalityAnalysisGraphOperation[] | null {
  if (dataset.kind === "constant") return null;
  const input = unbindKennzahlInput(dataset);
  if (!input || datasetClass(input) === "base") return null;
  const expression = kennzahlExpressionFor(input);
  if (!expression) return null;
  const { nodes, edges } = buildKennzahlGraph(expression, dataset, origin, existing);
  // Every node is added before any edge, so an edge never references a missing endpoint.
  return [
    ...nodes.map((node): MunicipalityAnalysisGraphOperation => ({ version: ANALYSIS_OPERATION_VERSION, type: "add-node", node })),
    ...edges.map((edge): MunicipalityAnalysisGraphOperation => ({ version: ANALYSIS_OPERATION_VERSION, type: "add-edge", edge })),
  ];
}

/** Ready-made expander for `applyMunicipalityAnalysisGraphOperations`. */
export const expandKennzahlIntoGraph = (
  dataset: MunicipalityDatasetRef,
  graph: { nodes: readonly MunicipalityAnalysisNode[]; edges: readonly MunicipalityAnalysisEdge[] },
) => kennzahlDerivationOperations(dataset, nextGraphOrigin(graph.nodes), graph);

/** `(Geburten ÷ Einwohnerzahl) × 1.000` — the derivation as one readable line. */
export function kennzahlFormulaText(
  expression: KennzahlExpression,
  label: (input: KennzahlInput) => string,
  formatNumber: (value: number) => string = String,
): string {
  const render = (node: KennzahlExpression, parenthesise: boolean): string => {
    if ("input" in node) return label(node.input);
    if ("constant" in node) return formatNumber(node.constant);
    // `t−1` rather than a symbol: a shift reads as an offset on its input, not as an
    // operation between two of them.
    if (!("b" in node)) return `${render(node.a, true)} (t−${node.years})`;
    const text = `${render(node.a, true)} ${ANALYSIS_OPERATOR_SYMBOLS[node.op]} ${render(node.b, true)}`;
    return parenthesise ? `(${text})` : text;
  };
  return render(expression, false);
}

// --- what each dropdown offers per Datenart ---------------------------------

/**
 * The map's first dropdown picks the Datenart, the third one lists what that Datenart
 * offers for the chosen category. These lists are the single source of truth for that
 * filtering; `kennzahlen.test.ts` checks each entry against `datasetClass`, so a view
 * cannot end up on the wrong side of the split.
 */
export const POPULATION_VIEWS_BY_KIND: Record<DataKind, readonly PopulationViewId[]> = {
  base: ["count", "foreign-persons", "structure-population"],
  derived: ["density", "foreign-share"],
};

const AGE_GROUP_IDS = AGE_GROUPS.map(({ id }) => id);
export const AGE_VIEWS_BY_KIND: Record<DataKind, readonly AgeViewId[]> = {
  base: AGE_GROUP_IDS,
  derived: [...AGE_GROUP_IDS, ...DEMOGRAPHIC_INDICATORS.map(({ id }) => id)],
};

/** Persons under Ausgangsdaten, share under Kennzahlen — the measure follows the Datenart. */
export const ageMeasureFor = (kind: DataKind): AgeMeasure => (kind === "base" ? "persons" : "share");

export const MOVEMENT_VIEWS_BY_KIND: Record<DataKind, readonly MovementTargetId[]> = {
  base: [
    ...MOVEMENT_METRICS.filter(({ id }) => datasetClass({ kind: "movement", metric: id }) === "base").map(({ id }) => id),
    ...MOVEMENT_RAW_TARGETS,
  ],
  derived: MOVEMENT_METRICS.filter(({ id }) => datasetClass({ kind: "movement", metric: id }) === "derived").map(({ id }) => id),
};

export const COST_MEASURES_BY_KIND: Record<DataKind, readonly CostMeasureId[]> = {
  base: ["absolute"],
  derived: ["share", "per-capita", "real-per-capita", "peer-deviation"],
};

export const POLITICS_VIEWS_BY_KIND: Record<DataKind, readonly PoliticsView[]> = {
  // The winning list is read straight off the result; the share and the turnout are both
  // quotients of it.
  base: ["leading-list"],
  derived: ["party-share", "turnout"],
};

// The digital inventory is all Ausgangsdaten; its cost estimates live in the detail panel
// rather than as a map layer, so there is nothing to offer under Kennzahlen.
export const DIGITAL_VIEWS_BY_KIND: Record<DataKind, readonly DigitalPlatformViewId[]> = {
  base: DIGITAL_PLATFORM_VIEWS.map(({ id }) => id),
  derived: [],
};

/**
 * Every Ausgangsdatum the analysis can read, so a graph can be built without going to the
 * map and dragging one back. Assembled from the same `*_BY_KIND` lists the map's dropdowns
 * use, which keeps the two offers from drifting apart.
 *
 * No `labelKey`: `datasetTitle` already names any dataset reference, and it is the one
 * that stays right when a view is added. Age groups are listed for both sexes together
 * because that is the only distinction the title does not spell out.
 */
export type AusgangsdatumDefinition = { id: string; category: MapMetric; output: KennzahlInput };

export const AUSGANGSDATEN_CATALOG: AusgangsdatumDefinition[] = [
  ...POPULATION_VIEWS_BY_KIND.base.map((view): AusgangsdatumDefinition => ({
    id: `population-${view}`, category: "population", output: { kind: "population", view },
  })),
  { id: "attribute-area", category: "population", output: { kind: "attribute", field: "area" } },
  ...AGE_TARGETS.map((ageGroup): AusgangsdatumDefinition => ({
    id: `age-${ageGroup}`, category: "age",
    output: { kind: "age-group", ageGroup, measure: "persons", sex: "all" },
  })),
  ...MOVEMENT_VIEWS_BY_KIND.base.map((metric): AusgangsdatumDefinition => ({
    id: `movement-${metric}`, category: "movement", output: { kind: "movement", metric },
  })),
  ...COST_TARGETS.map((category): AusgangsdatumDefinition => ({
    id: `cost-${category}`, category: "costs",
    output: { kind: "cost-share", category, measure: "absolute" },
  })),
];

const ALL_METRICS: readonly MapMetric[] = ["population", "age", "movement", "costs", "politics", "digital", "custom"];
const VIEW_COUNT: Record<MapMetric, Record<DataKind, number>> = {
  population: { base: POPULATION_VIEWS_BY_KIND.base.length, derived: POPULATION_VIEWS_BY_KIND.derived.length },
  age: { base: AGE_VIEWS_BY_KIND.base.length, derived: AGE_VIEWS_BY_KIND.derived.length },
  movement: { base: MOVEMENT_VIEWS_BY_KIND.base.length, derived: MOVEMENT_VIEWS_BY_KIND.derived.length },
  costs: { base: COST_MEASURES_BY_KIND.base.length, derived: COST_MEASURES_BY_KIND.derived.length },
  politics: { base: POLITICS_VIEWS_BY_KIND.base.length, derived: POLITICS_VIEWS_BY_KIND.derived.length },
  digital: { base: DIGITAL_VIEWS_BY_KIND.base.length, derived: DIGITAL_VIEWS_BY_KIND.derived.length },
  // A user-defined Kennzahl is derived by definition; whether the category is offered at
  // all depends on the user having saved one, which only the caller knows.
  custom: { base: 0, derived: 1 },
};

/** A category is offered only while it has something to show for that Datenart. */
export const MAP_METRICS_BY_KIND: Record<DataKind, readonly MapMetric[]> = {
  base: ALL_METRICS.filter((metric) => VIEW_COUNT[metric].base > 0),
  derived: ALL_METRICS.filter((metric) => VIEW_COUNT[metric].derived > 0),
};

export const isDataKind = (value: string | null): value is DataKind =>
  value === "base" || value === "derived";

// --- turning a saved graph back into a Kennzahl -----------------------------

export type KennzahlFromGraph =
  | { ok: true; expression: KennzahlExpression; municipality: AnalysisSubject | null }
  | { ok: false; reason: "missing-input" | "mixed-municipalities" | "no-municipality-input" };

/**
 * Reads the sub-graph feeding `nodeId` back into a Kennzahl definition.
 *
 * Open nodes are already the parameter and need no unbinding. Pinned nodes do, and that
 * only works if they all name the same municipality — a graph comparing Graz with Wien is
 * a comparison, not a Kennzahl, and is rejected rather than silently reinterpreted.
 */
export function kennzahlFromGraph(
  graph: { nodes: readonly MunicipalityAnalysisNode[]; edges: readonly MunicipalityAnalysisEdge[] },
  nodeId: string,
): KennzahlFromGraph {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const municipalities = new Map<string, string>();
  let inputCount = 0;
  let failure: KennzahlFromGraph | null = null;

  const walk = (id: string): KennzahlExpression | null => {
    const node = nodesById.get(id);
    if (!node) return null;
    if (node.type === "dataset") {
      const dataset = node.data.dataset;
      if (dataset.kind === "constant") return { constant: dataset.value };
      inputCount += 1;
      if (dataset.municipalityCode) {
        municipalities.set(dataset.municipalityCode, dataset.municipalityName ?? dataset.municipalityCode);
      }
      return { input: unbindKennzahlInput(dataset)! };
    }
    const side = (handle: "a" | "b") => {
      const edge = graph.edges.find((item) => item.target === id && item.targetHandle === handle);
      return edge ? walk(edge.source) : null;
    };
    const operator = node.data.operator;
    if (isUnaryAnalysisOperator(operator)) {
      const a = side("a");
      if (!a) {
        failure ??= { ok: false, reason: "missing-input" };
        return null;
      }
      return { op: operator, a, years: node.data.years ?? DEFAULT_ANALYSIS_SHIFT_YEARS };
    }
    const a = side("a");
    const b = side("b");
    if (!a || !b) {
      failure ??= { ok: false, reason: "missing-input" };
      return null;
    }
    return { op: operator, a, b };
  };

  const expression = walk(nodeId);
  if (!expression) return failure ?? { ok: false, reason: "missing-input" };
  if (municipalities.size > 1) return { ok: false, reason: "mixed-municipalities" };
  // Constants alone are not a Kennzahl — it has to read something.
  if (!inputCount) return { ok: false, reason: "no-municipality-input" };
  const [municipalityCode, municipalityName] = municipalities.entries().next().value ?? [];
  return {
    ok: true,
    expression,
    municipality: municipalityCode ? { municipalityCode, municipalityName: municipalityName ?? municipalityCode } : null,
  };
}

/** Every Ausgangsdatum a Kennzahl reads, for working out which data files it needs. */
export function kennzahlExpressionInputs(expression: KennzahlExpression): KennzahlInput[] {
  if ("input" in expression) return [expression.input];
  if ("op" in expression) {
    return "b" in expression
      ? [...kennzahlExpressionInputs(expression.a), ...kennzahlExpressionInputs(expression.b)]
      : kennzahlExpressionInputs(expression.a);
  }
  return [];
}

export function kennzahlExpressionUnit(expression: KennzahlExpression): string {
  if ("constant" in expression) return "";
  if ("input" in expression) return datasetUnit(expression.input as MunicipalityDatasetRef);
  // A shift moves years, not units.
  if (!("b" in expression)) return kennzahlExpressionUnit(expression.a);
  if (isBooleanAnalysisOperator(expression.op)) return "boolean";
  return composeAnalysisUnit(
    expression.op,
    kennzahlExpressionUnit(expression.a),
    kennzahlExpressionUnit(expression.b),
  );
}

// --- evaluating a Kennzahl for the whole map --------------------------------

/**
 * Peer medians for the cost comparison, cached per category and year.
 *
 * `resolveMunicipalityDataset` recomputes this per municipality, which is fine for a
 * single node but quadratic across 2.092 municipalities. This builds the whole year in
 * one pass instead, and is the only copy — both the map and the Kennzahl evaluator use it.
 */
export function createPeerMedianIndex(data: MunicipalityAnalysisData) {
  const cache = new Map<string, Map<string, number | null>>();
  return (code: string, year: number, category: CostTargetId) => {
    const cacheKey = `${category}|${year}`;
    let medians = cache.get(cacheKey);
    if (!medians) {
      const groups = new Map<string, number[]>();
      const yearCosts = data.costs?.years[String(year)]?.values ?? {};
      const populations = data.population.years[String(year)]?.values ?? {};
      for (const municipality of data.index.municipalities) {
        const inhabitants = populations[municipality.municipalityCode];
        const tuple = yearCosts[municipality.municipalityCode];
        if (!tuple || !inhabitants) continue;
        const value = municipalityCostPerCapita(tuple, category, inhabitants);
        if (value === null) continue;
        const band = municipalityPopulationBand(inhabitants);
        for (const key of [`${municipality.state}|${band}`, `*|${band}`]) {
          const group = groups.get(key);
          if (group) group.push(value);
          else groups.set(key, [value]);
        }
      }
      medians = new Map();
      for (const municipality of data.index.municipalities) {
        const band = municipalityPopulationBand(populations[municipality.municipalityCode]);
        const regional = groups.get(`${municipality.state}|${band}`);
        // Fewer than five neighbours in the same Bundesland is too thin a comparison,
        // so those fall back to the nationwide band.
        const comparison = regional && regional.length >= 5 ? regional : groups.get(`*|${band}`) ?? [];
        medians.set(municipality.municipalityCode, median(comparison));
      }
      cache.set(cacheKey, medians);
    }
    return medians.get(code) ?? null;
  };
}

type ValueReader = (code: string, year: number) => number | null;

function baseReader(
  input: KennzahlInput,
  data: MunicipalityAnalysisData,
  peerMedianFor: ReturnType<typeof createPeerMedianIndex>,
): ValueReader {
  const byCode = new Map(data.index.municipalities.map((item) => [item.municipalityCode, item]));

  if (input.kind === "attribute") return (code) => byCode.get(code)?.areaSquareKilometers ?? null;

  if (input.kind === "population") return (code, year) => {
    const municipality = byCode.get(code);
    const inhabitants = data.population.years[String(year)]?.values[code];
    if (!municipality || inhabitants === undefined) return null;
    return populationViewValue(input.view, inhabitants, municipality, data.structure?.years[String(year)]?.values[code] ?? null);
  };

  if (input.kind === "age-group") return (code, year) => {
    const counts = data.demography?.years[String(year)]?.values[code];
    return counts ? demographyMetricValue(counts, input.sex, input.ageGroup, input.measure) : null;
  };

  if (input.kind === "age-indicator") return (code, year) => {
    const counts = data.demography?.years[String(year)]?.values[code];
    return counts ? demographicIndicatorValue(counts, input.indicator) : null;
  };

  if (input.kind === "movement") return (code, year) => {
    const counts = data.movement?.years[String(year)]?.values[code];
    const inhabitants = data.population.years[String(year)]?.values[code];
    if (!counts || inhabitants === undefined) return null;
    return movementTargetValue(counts, inhabitants, input.metric);
  };

  const measure = input.measure ?? "share";
  const category = input.category;
  return (code, year) => {
    const tuple = data.costs?.years[String(year)]?.values[code];
    if (!tuple) return null;
    if (measure === "absolute") return municipalityCostAbsolute(tuple, category);
    if (measure === "share") return municipalityCostShare(tuple, category);
    const inhabitants = data.population.years[String(year)]?.values[code];
    if (inhabitants === undefined) return null;
    if (measure === "real-per-capita") return municipalityCostRealPerCapita(tuple, category, inhabitants, year);
    const perCapita = municipalityCostPerCapita(tuple, category, inhabitants);
    if (measure === "per-capita") return perCapita;
    const peerMedian = peerMedianFor(code, year, category);
    return perCapita !== null && peerMedian && peerMedian > 0 ? perCapita / peerMedian - 1 : null;
  };
}

/**
 * A `(code, year) => value` reader for a Kennzahl, fast enough to paint the whole map.
 *
 * Each Ausgangsdatum is resolved through an O(1) lookup and the expression is walked per
 * cell, so a Kennzahl costs the same order of work as a built-in one.
 */
export function createKennzahlLookup(
  expression: KennzahlExpression,
  data: MunicipalityAnalysisData,
  peerMedianFor: ReturnType<typeof createPeerMedianIndex> = createPeerMedianIndex(data),
): ValueReader {
  const readers = new Map<string, ValueReader>();
  const prepare = (node: KennzahlExpression) => {
    if ("input" in node) {
      const key = JSON.stringify(node.input);
      if (!readers.has(key)) readers.set(key, baseReader(node.input, data, peerMedianFor));
    } else if ("op" in node) {
      prepare(node.a);
      if ("b" in node) prepare(node.b);
    }
  };
  prepare(expression);

  const evaluate = (node: KennzahlExpression, code: string, year: number): number | null => {
    if ("constant" in node) return node.constant;
    if ("input" in node) return readers.get(JSON.stringify(node.input))!(code, year);
    // The map asks for one year at a time, so a shift is simply that question asked of an
    // earlier year; years before the data start read as null, exactly like a gap.
    if (!("b" in node)) return evaluate(node.a, code, year - node.years);
    const a = evaluate(node.a, code, year);
    const b = evaluate(node.b, code, year);
    if (a === null || b === null) return null;
    switch (node.op) {
      case "add": return a + b;
      case "subtract": return a - b;
      case "multiply": return a * b;
      case "divide": return b === 0 ? null : a / b;
      // Comparisons paint the map as 0/1 so a threshold Kennzahl still has a colour.
      case "greater-than": return a > b ? 1 : 0;
      case "greater-or-equal": return a >= b ? 1 : 0;
      case "less-than": return a < b ? 1 : 0;
      case "less-or-equal": return a <= b ? 1 : 0;
      case "equal": return a === b ? 1 : 0;
      case "not-equal": return a !== b ? 1 : 0;
      case "and": return a !== 0 && b !== 0 ? 1 : 0;
      case "or": return a !== 0 || b !== 0 ? 1 : 0;
      default: return null;
    }
  };
  return (code, year) => evaluate(expression, code, year);
}


// --- persistence ------------------------------------------------------------

export const MAX_KENNZAHL_JSON_BYTES = 20_000;

/**
 * Validated against the dataset schema itself, by filling in a placeholder municipality —
 * so a Kennzahl input can never accept something a dataset node would reject, and unknown
 * keys are stripped rather than stored.
 */
const kennzahlInputSchema = z.looseObject({}).transform((value, context) => {
  const parsed = municipalityDatasetRefSchema.safeParse({
    ...value, municipalityCode: "00000", municipalityName: "Platzhalter",
  });
  const input = parsed.success ? unbindKennzahlInput(parsed.data) : null;
  if (!input) {
    context.addIssue({ code: "custom", message: "Unknown Ausgangsdatum in Kennzahl" });
    return z.NEVER;
  }
  return input;
});

export const kennzahlExpressionSchema: z.ZodType<KennzahlExpression> = z.lazy(() => z.union([
  z.object({ constant: z.number().finite() }),
  z.object({ input: kennzahlInputSchema }),
  z.object({ op: z.enum(analysisBinaryOperatorIds), a: kennzahlExpressionSchema, b: kennzahlExpressionSchema }),
  z.object({
    op: z.enum(analysisUnaryOperatorIds), a: kennzahlExpressionSchema,
    years: z.number().int().min(1).max(MAX_ANALYSIS_SHIFT_YEARS),
  }),
]));

export function serializeKennzahlExpression(expression: KennzahlExpression) {
  const json = JSON.stringify(kennzahlExpressionSchema.parse(expression));
  if (new TextEncoder().encode(json).byteLength > MAX_KENNZAHL_JSON_BYTES) {
    throw new Error("Kennzahl expression is too large");
  }
  return json;
}

export function parseKennzahlExpression(json: string) {
  if (new TextEncoder().encode(json).byteLength > MAX_KENNZAHL_JSON_BYTES) {
    throw new Error("Kennzahl expression is too large");
  }
  return kennzahlExpressionSchema.parse(JSON.parse(json));
}
