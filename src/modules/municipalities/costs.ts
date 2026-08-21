export const MUNICIPALITY_COSTS_SCHEMA_VERSION = 1;
export const MUNICIPALITY_COSTS_FIRST_YEAR = 2010;
export const MUNICIPALITY_COSTS_LATEST_YEAR = 2024;

export const COST_CATEGORIES = [
  { id: "0" }, { id: "1" }, { id: "2" }, { id: "3" }, { id: "4" },
  { id: "5" }, { id: "6" }, { id: "7" }, { id: "8" }, { id: "9" },
] as const;

export type CostCategoryId = (typeof COST_CATEGORIES)[number]["id"];
export const COST_MEASURES = ["share", "per-capita", "real-per-capita", "peer-deviation"] as const;
export type CostMeasureId = (typeof COST_MEASURES)[number];

// Statistik Austria, verketteter Verbraucherpreisindex (Jahresdurchschnitt).
// 2024 is the price basis used by the real-per-capita view.
export const AUSTRIAN_CPI_ANNUAL: Record<number, number> = {
  2010: 454.5, 2011: 469.3, 2012: 481.0, 2013: 490.6, 2014: 498.5,
  2015: 503.0, 2016: 507.5, 2017: 518.1, 2018: 528.4, 2019: 536.5,
  2020: 544.3, 2021: 559.4, 2022: 607.2, 2023: 654.6, 2024: 673.9,
};
export type MunicipalityCostTuple = [
  totalCents: number,
  category0Cents: number,
  category1Cents: number,
  category2Cents: number,
  category3Cents: number,
  category4Cents: number,
  category5Cents: number,
  category6Cents: number,
  category7Cents: number,
  category8Cents: number,
  category9Cents: number,
];

export type MunicipalityCostSeries = {
  schemaVersion: typeof MUNICIPALITY_COSTS_SCHEMA_VERSION;
  firstYear: typeof MUNICIPALITY_COSTS_FIRST_YEAR;
  latestYear: typeof MUNICIPALITY_COSTS_LATEST_YEAR;
  unit: "cents";
  categories: readonly CostCategoryId[];
  source: { title: string; url: string; origin: "Statistik Austria" };
  scales: Record<CostCategoryId, [number, number]>;
  years: Record<string, {
    referenceType: "Rechnungsabschluss";
    coverage: number;
    values: Record<string, MunicipalityCostTuple>;
  }>;
};

export function isCostCategoryId(value: string): value is CostCategoryId {
  return COST_CATEGORIES.some(({ id }) => id === value);
}

export function isCostMeasureId(value: string): value is CostMeasureId {
  return COST_MEASURES.some((measure) => measure === value);
}

export function municipalityCostYears() {
  return Array.from(
    { length: MUNICIPALITY_COSTS_LATEST_YEAR - MUNICIPALITY_COSTS_FIRST_YEAR + 1 },
    (_, index) => MUNICIPALITY_COSTS_FIRST_YEAR + index,
  );
}

export function municipalityCostCategoryCents(value: MunicipalityCostTuple, category: CostCategoryId) {
  return value[Number(category) + 1];
}

export function municipalityCostShare(value: MunicipalityCostTuple, category: CostCategoryId) {
  return value[0] > 0 ? municipalityCostCategoryCents(value, category) / value[0] : null;
}

export function municipalityCostPerCapita(
  value: MunicipalityCostTuple,
  category: CostCategoryId,
  population: number,
) {
  return population > 0 ? municipalityCostCategoryCents(value, category) / 100 / population : null;
}

export function municipalityCostRealPerCapita(
  value: MunicipalityCostTuple,
  category: CostCategoryId,
  population: number,
  year: number,
) {
  const nominal = municipalityCostPerCapita(value, category, population);
  const index = AUSTRIAN_CPI_ANNUAL[year];
  return nominal === null || !index ? null : nominal * AUSTRIAN_CPI_ANNUAL[2024] / index;
}

export function municipalityPopulationBand(population: number) {
  const limits = [1_000, 2_500, 5_000, 10_000, 20_000, 50_000];
  return limits.findIndex((limit) => population < limit) + 1 || limits.length + 1;
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isValidCostTuple(value: unknown): value is MunicipalityCostTuple {
  return Array.isArray(value)
    && value.length === 11
    && value.every(Number.isSafeInteger)
    && value[0] > 0
    && value.slice(1).reduce((sum, item) => sum + item, 0) === value[0];
}

export function validateMunicipalityCostSeries(series: MunicipalityCostSeries, municipalityCodes: Iterable<string>) {
  if (
    series.schemaVersion !== MUNICIPALITY_COSTS_SCHEMA_VERSION
    || series.firstYear !== MUNICIPALITY_COSTS_FIRST_YEAR
    || series.latestYear !== MUNICIPALITY_COSTS_LATEST_YEAR
    || series.unit !== "cents"
    || series.categories.join("|") !== COST_CATEGORIES.map(({ id }) => id).join("|")
  ) throw new Error("Unerwartete Version oder Gliederung der Kostenübersicht.");
  const knownCodes = new Set(municipalityCodes);
  if (Object.keys(series.years).length !== municipalityCostYears().length) {
    throw new Error("Unvollständiger Zeitraum der Kostenübersicht.");
  }
  for (const year of municipalityCostYears()) {
    const snapshot = series.years[String(year)];
    if (!snapshot || snapshot.referenceType !== "Rechnungsabschluss") {
      throw new Error(`Fehlende Kostenübersicht für ${year}.`);
    }
    const entries = Object.entries(snapshot.values);
    if (snapshot.coverage !== entries.length || snapshot.coverage > knownCodes.size) {
      throw new Error(`Ungültige Gemeindeabdeckung der Kostenübersicht für ${year}.`);
    }
    for (const [code, value] of entries) {
      if (!knownCodes.has(code)) throw new Error(`Unbekannter Gemeindecode in der Kostenübersicht: ${code}`);
      if (!isValidCostTuple(value)) throw new Error(`Ungültige Kostenübersicht für ${code}/${year}.`);
    }
  }
  for (const { id } of COST_CATEGORIES) {
    const domain = series.scales[id];
    if (!domain || !domain.every(Number.isFinite) || domain[0] >= domain[1]) {
      throw new Error(`Ungültige Farbskala der Kostenübersicht für Aufgabengruppe ${id}.`);
    }
  }
  return series;
}
