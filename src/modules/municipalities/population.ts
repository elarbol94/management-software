import { EXPECTED_MUNICIPALITY_COUNT } from "./data";

export const MUNICIPALITY_POPULATION_FIRST_YEAR = 2002;
export const MUNICIPALITY_POPULATION_LATEST_YEAR = 2025;
export const MUNICIPALITY_POPULATION_REFERENCE_DATE = "2025-01-01";
export const MUNICIPALITY_POPULATION_SCHEMA_VERSION = 1;
export const MUNICIPALITY_POPULATION_SERIES_SCHEMA_VERSION = 1;

export const POPULATION_CLASSES = [
  { minimum: 0, maximum: 999, color: "#e2f2ee" },
  { minimum: 1_000, maximum: 2_499, color: "#b9ddd6" },
  { minimum: 2_500, maximum: 4_999, color: "#7fc2b7" },
  { minimum: 5_000, maximum: 9_999, color: "#42a394" },
  { minimum: 10_000, maximum: 49_999, color: "#177b70" },
  { minimum: 50_000, maximum: null, color: "#0a4d47" },
] as const;

export type MunicipalityPopulationValues = Record<string, number>;
export type MunicipalityPopulationYear = {
  referenceDate: string;
  nationalTotal: number;
  values: MunicipalityPopulationValues;
};

export type MunicipalityPopulationSnapshot = MunicipalityPopulationYear & {
  schemaVersion: typeof MUNICIPALITY_POPULATION_SCHEMA_VERSION;
  count: number;
  unit: "persons";
  source: { title: string; url: string; license: string };
};

export type MunicipalityPopulationSeries = {
  schemaVersion: typeof MUNICIPALITY_POPULATION_SERIES_SCHEMA_VERSION;
  firstYear: typeof MUNICIPALITY_POPULATION_FIRST_YEAR;
  latestYear: typeof MUNICIPALITY_POPULATION_LATEST_YEAR;
  count: number;
  unit: "persons";
  source: { title: string; urlTemplate: string; license: string };
  years: Record<string, MunicipalityPopulationYear>;
};

export function municipalityPopulationReferenceDate(year: number) {
  return `${year}-01-01`;
}

export function municipalityPopulationYears() {
  return Array.from(
    { length: MUNICIPALITY_POPULATION_LATEST_YEAR - MUNICIPALITY_POPULATION_FIRST_YEAR + 1 },
    (_, index) => MUNICIPALITY_POPULATION_FIRST_YEAR + index,
  );
}

function validatePopulationValues(
  values: MunicipalityPopulationValues,
  nationalTotal: number,
  municipalityCodes: Iterable<string>,
) {
  const expectedCodes = new Set(municipalityCodes);
  const actualCodes = Object.keys(values);
  if (expectedCodes.size !== EXPECTED_MUNICIPALITY_COUNT || actualCodes.length !== EXPECTED_MUNICIPALITY_COUNT) {
    throw new Error(`Erwartet: ${EXPECTED_MUNICIPALITY_COUNT} Einwohnerwerte, erhalten: ${actualCodes.length}.`);
  }

  let total = 0;
  for (const [code, population] of Object.entries(values)) {
    if (!expectedCodes.has(code)) throw new Error(`Unbekannter Gemeindecode in den Einwohnerdaten: ${code}`);
    if (!Number.isSafeInteger(population) || population <= 0) throw new Error(`Ungültige Einwohnerzahl für ${code}: ${population}`);
    total += population;
  }
  if (!Number.isSafeInteger(nationalTotal) || nationalTotal !== total) {
    throw new Error(`Nationale Einwohnerzahl stimmt nicht: ${nationalTotal} statt ${total}.`);
  }
}

function validateSource(title: string, url: string, license: string) {
  if (!title.trim() || !URL.canParse(url) || !license.trim()) throw new Error("Unvollständige Quellenangabe der Einwohnerdaten.");
}

export function validateMunicipalityPopulation(
  snapshot: MunicipalityPopulationSnapshot,
  municipalityCodes: Iterable<string>,
) {
  if (snapshot.schemaVersion !== MUNICIPALITY_POPULATION_SCHEMA_VERSION) throw new Error("Unerwartete Version der Einwohnerdaten.");
  if (snapshot.referenceDate !== MUNICIPALITY_POPULATION_REFERENCE_DATE) throw new Error("Unerwarteter Stichtag der Einwohnerdaten.");
  if (snapshot.count !== EXPECTED_MUNICIPALITY_COUNT || snapshot.unit !== "persons") throw new Error("Unerwartete Einwohnerdaten.");
  validatePopulationValues(snapshot.values, snapshot.nationalTotal, municipalityCodes);
  validateSource(snapshot.source.title, snapshot.source.url, snapshot.source.license);
  return snapshot;
}

export function validateMunicipalityPopulationSeries(
  series: MunicipalityPopulationSeries,
  municipalityCodes: Iterable<string>,
) {
  if (series.schemaVersion !== MUNICIPALITY_POPULATION_SERIES_SCHEMA_VERSION) throw new Error("Unerwartete Version der Einwohnerzeitreihe.");
  if (series.firstYear !== MUNICIPALITY_POPULATION_FIRST_YEAR || series.latestYear !== MUNICIPALITY_POPULATION_LATEST_YEAR) {
    throw new Error("Unerwarteter Zeitraum der Einwohnerdaten.");
  }
  if (series.count !== EXPECTED_MUNICIPALITY_COUNT || series.unit !== "persons") throw new Error("Unerwartete Einwohnerzeitreihe.");
  validateSource(series.source.title, series.source.urlTemplate.replace("{year}", String(series.latestYear)), series.source.license);

  const expectedMunicipalityCodes = Array.from(municipalityCodes);
  const years = municipalityPopulationYears();
  if (Object.keys(series.years).length !== years.length) throw new Error("Unvollständige Einwohnerzeitreihe.");
  for (const year of years) {
    const snapshot = series.years[String(year)];
    if (!snapshot || snapshot.referenceDate !== municipalityPopulationReferenceDate(year)) {
      throw new Error(`Fehlender oder ungültiger Einwohnerstand für ${year}.`);
    }
    validatePopulationValues(snapshot.values, snapshot.nationalTotal, expectedMunicipalityCodes);
  }
  return series;
}
