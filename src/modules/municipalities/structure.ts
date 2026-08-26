import { EXPECTED_MUNICIPALITY_COUNT, type MunicipalityIndexItem } from "./data";
import type { MunicipalityPopulationSeries } from "./population";

export const MUNICIPALITY_STRUCTURE_SCHEMA_VERSION = 1;
export const MUNICIPALITY_STRUCTURE_FIRST_YEAR = 2022;
export const MUNICIPALITY_STRUCTURE_LATEST_YEAR = 2024;

export const POPULATION_VIEWS = [
  { id: "count", unit: "persons" },
  { id: "density", unit: "per-square-kilometer" },
  { id: "foreign-share", unit: "share" },
  { id: "foreign-persons", unit: "persons" },
  // The citizenship statistics count on 31 October, the Einwohnerzeitreihe on 1 January —
  // they disagree for all but ~50 municipalities. Der Ausländeranteil teilt durch diese
  // Zahl, also muss sie als eigenes Ausgangsdatum wählbar sein.
  { id: "structure-population", unit: "persons" },
] as const;

export type PopulationViewId = (typeof POPULATION_VIEWS)[number]["id"];
export type PopulationViewUnit = (typeof POPULATION_VIEWS)[number]["unit"];
export type CitizenshipCounts = [population: number, foreignCitizens: number];
export type MunicipalityStructureSeries = {
  schemaVersion: typeof MUNICIPALITY_STRUCTURE_SCHEMA_VERSION;
  firstYear: typeof MUNICIPALITY_STRUCTURE_FIRST_YEAR;
  latestYear: typeof MUNICIPALITY_STRUCTURE_LATEST_YEAR;
  count: number;
  source: { title: string; url: string; license: string; referenceDate: "October 31" };
  scales: Record<"foreign-share" | "foreign-persons", [number, number]>;
  years: Record<string, { referenceDate: string; values: Record<string, CitizenshipCounts> }>;
};

export function isPopulationViewId(value: string): value is PopulationViewId {
  return POPULATION_VIEWS.some(({ id }) => id === value);
}

export function populationViewUnit(id: PopulationViewId): PopulationViewUnit {
  return POPULATION_VIEWS.find((view) => view.id === id)!.unit;
}

export function populationViewValue(
  view: PopulationViewId,
  population: number,
  municipality: MunicipalityIndexItem,
  citizenship: CitizenshipCounts | null,
) {
  if (view === "count") return population;
  if (view === "density") return municipality.areaSquareKilometers > 0 ? population / municipality.areaSquareKilometers : null;
  if (!citizenship) return null;
  if (view === "foreign-persons") return citizenship[1];
  if (view === "structure-population") return citizenship[0];
  return citizenship[0] > 0 ? citizenship[1] / citizenship[0] : null;
}

export function validateMunicipalityStructureSeries(
  series: MunicipalityStructureSeries,
  populationSeries: MunicipalityPopulationSeries,
  municipalityCodes: Iterable<string>,
) {
  if (
    series.schemaVersion !== MUNICIPALITY_STRUCTURE_SCHEMA_VERSION
    || series.firstYear !== MUNICIPALITY_STRUCTURE_FIRST_YEAR
    || series.latestYear !== MUNICIPALITY_STRUCTURE_LATEST_YEAR
  ) throw new Error("Unerwartete Version oder Zeitraum der Strukturkennzahlen.");
  const codes = Array.from(municipalityCodes);
  if (series.count !== EXPECTED_MUNICIPALITY_COUNT || codes.length !== EXPECTED_MUNICIPALITY_COUNT) {
    throw new Error("Unerwartete Anzahl an Gemeinden in den Strukturkennzahlen.");
  }
  if (Object.keys(series.years).length !== series.latestYear - series.firstYear + 1) {
    throw new Error("Unvollständige Zeitreihe der Strukturkennzahlen.");
  }
  for (let year = series.firstYear; year <= series.latestYear; year += 1) {
    if (!populationSeries.years[String(year)]) throw new Error(`Fehlende Einwohnerdaten für ${year}.`);
    const snapshot = series.years[String(year)];
    if (!snapshot || snapshot.referenceDate !== `${year}-10-31`) throw new Error(`Fehlende Strukturkennzahlen für ${year}.`);
    if (Object.keys(snapshot.values).length !== EXPECTED_MUNICIPALITY_COUNT) throw new Error(`Unvollständige Strukturkennzahlen für ${year}.`);
    for (const code of codes) {
      const value = snapshot.values[code];
      if (
        !Array.isArray(value)
        || value.length !== 2
        || !value.every((item) => Number.isSafeInteger(item) && item >= 0)
        || value[1] > value[0]
      ) throw new Error(`Ungültige Strukturkennzahlen für ${code}/${year}.`);
    }
  }
  for (const domain of Object.values(series.scales)) {
    if (!domain.every(Number.isFinite) || domain[0] > domain[1]) throw new Error("Ungültige Farbskala der Strukturkennzahlen.");
  }
  return series;
}
