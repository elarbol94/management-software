export const MUNICIPALITY_COSTS_SCHEMA_VERSION = 1;
export const MUNICIPALITY_COSTS_FIRST_YEAR = 2010;
export const MUNICIPALITY_COSTS_LATEST_YEAR = 2024;

export const COST_CATEGORIES = [
  { id: "0" }, { id: "1" }, { id: "2" }, { id: "3" }, { id: "4" },
  { id: "5" }, { id: "6" }, { id: "7" }, { id: "8" }, { id: "9" },
] as const;

export type CostCategoryId = (typeof COST_CATEGORIES)[number]["id"];
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
