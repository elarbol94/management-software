import { EXPECTED_MUNICIPALITY_COUNT } from "./data";

export const MUNICIPALITY_POPULATION_REFERENCE_DATE = "2025-01-01";
export const MUNICIPALITY_POPULATION_SCHEMA_VERSION = 1;

export const POPULATION_CLASSES = [
  { minimum: 0, maximum: 999, color: "#e2f2ee" },
  { minimum: 1_000, maximum: 2_499, color: "#b9ddd6" },
  { minimum: 2_500, maximum: 4_999, color: "#7fc2b7" },
  { minimum: 5_000, maximum: 9_999, color: "#42a394" },
  { minimum: 10_000, maximum: 49_999, color: "#177b70" },
  { minimum: 50_000, maximum: null, color: "#0a4d47" },
] as const;

export type MunicipalityPopulationSnapshot = {
  schemaVersion: typeof MUNICIPALITY_POPULATION_SCHEMA_VERSION;
  referenceDate: typeof MUNICIPALITY_POPULATION_REFERENCE_DATE;
  count: number;
  nationalTotal: number;
  unit: "persons";
  source: { title: string; url: string; license: string };
  values: Record<string, number>;
};

export function validateMunicipalityPopulation(
  snapshot: MunicipalityPopulationSnapshot,
  municipalityCodes: Iterable<string>,
) {
  if (snapshot.schemaVersion !== MUNICIPALITY_POPULATION_SCHEMA_VERSION) throw new Error("Unerwartete Version der Einwohnerdaten.");
  if (snapshot.referenceDate !== MUNICIPALITY_POPULATION_REFERENCE_DATE) throw new Error("Unerwarteter Stichtag der Einwohnerdaten.");
  if (snapshot.unit !== "persons") throw new Error("Unerwartete Einheit der Einwohnerdaten.");

  const expectedCodes = new Set(municipalityCodes);
  const actualCodes = Object.keys(snapshot.values);
  if (snapshot.count !== EXPECTED_MUNICIPALITY_COUNT || expectedCodes.size !== EXPECTED_MUNICIPALITY_COUNT || actualCodes.length !== EXPECTED_MUNICIPALITY_COUNT) {
    throw new Error(`Erwartet: ${EXPECTED_MUNICIPALITY_COUNT} Einwohnerwerte, erhalten: ${actualCodes.length}.`);
  }

  let total = 0;
  for (const [code, population] of Object.entries(snapshot.values)) {
    if (!expectedCodes.has(code)) throw new Error(`Unbekannter Gemeindecode in den Einwohnerdaten: ${code}`);
    if (!Number.isSafeInteger(population) || population <= 0) throw new Error(`Ungültige Einwohnerzahl für ${code}: ${population}`);
    total += population;
  }
  if (!Number.isSafeInteger(snapshot.nationalTotal) || snapshot.nationalTotal !== total) {
    throw new Error(`Nationale Einwohnerzahl stimmt nicht: ${snapshot.nationalTotal} statt ${total}.`);
  }
  if (!snapshot.source.title.trim() || !URL.canParse(snapshot.source.url) || !snapshot.source.license.trim()) throw new Error("Unvollständige Quellenangabe der Einwohnerdaten.");
  return snapshot;
}
