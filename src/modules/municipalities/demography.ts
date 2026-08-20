import { EXPECTED_MUNICIPALITY_COUNT } from "./data";
import { municipalityPopulationYears, type MunicipalityPopulationSeries } from "./population";

export const MUNICIPALITY_DEMOGRAPHY_SCHEMA_VERSION = 1;

export const AGE_GROUPS = [
  { id: "0-5", minimum: 0, maximum: 5 },
  { id: "6-14", minimum: 6, maximum: 14 },
  { id: "15-24", minimum: 15, maximum: 24 },
  { id: "25-44", minimum: 25, maximum: 44 },
  { id: "45-64", minimum: 45, maximum: 64 },
  { id: "65-79", minimum: 65, maximum: 79 },
  { id: "80-plus", minimum: 80, maximum: null },
] as const;

export type AgeGroupId = (typeof AGE_GROUPS)[number]["id"];
export type SexFilter = "all" | "female" | "male";
export type AgeMeasure = "share" | "persons";
export type MapMetric = "population" | "age";
export type AgeCounts = [number, number, number, number, number, number, number];
export type MunicipalitySexAgeCounts = { m: AgeCounts; f: AgeCounts };
export type DemographyScale = Record<AgeGroupId, [number, number]>;

export type MunicipalityDemographySeries = {
  schemaVersion: typeof MUNICIPALITY_DEMOGRAPHY_SCHEMA_VERSION;
  firstYear: 2002;
  latestYear: 2025;
  count: number;
  unit: "persons";
  groups: readonly AgeGroupId[];
  source: { title: string; urlTemplate: string; license: string };
  scales: Record<AgeMeasure, Record<SexFilter, DemographyScale>>;
  years: Record<string, { referenceDate: string; values: Record<string, MunicipalitySexAgeCounts> }>;
};

export function ageGroupIndex(id: AgeGroupId) {
  return AGE_GROUPS.findIndex((group) => group.id === id);
}

export function ageGroupIndexForSourceCode(code: string) {
  let age: number;
  if (code === "GALT5J100-21") age = 100;
  else {
    const match = /^GALTEJ112-(\d+)$/.exec(code);
    if (!match) throw new Error(`Unbekannter Alterscode: ${code}`);
    age = Number(match[1]) - 1;
    if (!Number.isInteger(age) || age < 0 || age > 99) throw new Error(`Ungültiger Alterscode: ${code}`);
  }
  return AGE_GROUPS.findIndex(({ minimum, maximum }) => age >= minimum && (maximum === null || age <= maximum));
}

export function demographyValue(counts: MunicipalitySexAgeCounts, sex: SexFilter, group: AgeGroupId) {
  const index = ageGroupIndex(group);
  if (sex === "male") return counts.m[index];
  if (sex === "female") return counts.f[index];
  return counts.m[index] + counts.f[index];
}

export function demographyPopulation(counts: MunicipalitySexAgeCounts, sex: SexFilter) {
  if (sex === "male") return counts.m.reduce((sum, value) => sum + value, 0);
  if (sex === "female") return counts.f.reduce((sum, value) => sum + value, 0);
  return counts.m.reduce((sum, value) => sum + value, 0) + counts.f.reduce((sum, value) => sum + value, 0);
}

export function demographyMetricValue(counts: MunicipalitySexAgeCounts, sex: SexFilter, group: AgeGroupId, measure: AgeMeasure) {
  const persons = demographyValue(counts, sex, group);
  if (measure === "persons") return persons;
  const population = demographyPopulation(counts, sex);
  return population > 0 ? persons / population : null;
}

function validTuple(value: unknown): value is AgeCounts {
  return Array.isArray(value) && value.length === 7 && value.every((item) => Number.isSafeInteger(item) && item >= 0);
}

export function validateMunicipalityDemographySeries(
  series: MunicipalityDemographySeries,
  populationSeries: MunicipalityPopulationSeries,
  municipalityCodes: Iterable<string>,
) {
  if (series.schemaVersion !== MUNICIPALITY_DEMOGRAPHY_SCHEMA_VERSION || series.firstYear !== 2002 || series.latestYear !== 2025) {
    throw new Error("Unerwartete Version oder Zeitraum der Demografiedaten.");
  }
  if (series.count !== EXPECTED_MUNICIPALITY_COUNT || series.unit !== "persons" || series.groups.join("|") !== AGE_GROUPS.map(({ id }) => id).join("|")) {
    throw new Error("Unerwartete Demografiedaten.");
  }
  const codes = Array.from(municipalityCodes);
  if (codes.length !== EXPECTED_MUNICIPALITY_COUNT || Object.keys(series.years).length !== 24) throw new Error("Unvollständige Demografiezeitreihe.");
  for (const year of municipalityPopulationYears()) {
    const snapshot = series.years[String(year)];
    if (!snapshot || snapshot.referenceDate !== `${year}-01-01`) throw new Error(`Fehlende Demografiedaten für ${year}.`);
    if (Object.keys(snapshot.values).length !== EXPECTED_MUNICIPALITY_COUNT) throw new Error(`Unvollständige Demografiedaten für ${year}.`);
    for (const code of codes) {
      const counts = snapshot.values[code];
      if (!counts || !validTuple(counts.m) || !validTuple(counts.f)) throw new Error(`Ungültige Demografiedaten für ${code}/${year}.`);
      if (demographyPopulation(counts, "all") !== populationSeries.years[String(year)].values[code]) {
        throw new Error(`Demografiesumme stimmt für ${code}/${year} nicht mit der Einwohnerzahl überein.`);
      }
    }
  }
  return series;
}
