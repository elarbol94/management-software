import { EXPECTED_MUNICIPALITY_COUNT } from "./data";
import { municipalityPopulationYears, type MunicipalityPopulationSeries } from "./population";

export const MUNICIPALITY_MOVEMENT_SCHEMA_VERSION = 2;

export const MOVEMENT_METRICS = [
  { id: "population-change", unit: "persons", palette: "diverging" },
  { id: "births", unit: "persons", palette: "sequential" },
  { id: "deaths", unit: "persons", palette: "sequential" },
  { id: "birth-rate", unit: "per-1000", palette: "sequential" },
  { id: "death-rate", unit: "per-1000", palette: "sequential" },
  { id: "birth-balance-rate", unit: "per-1000", palette: "diverging" },
  { id: "arrivals", unit: "persons", palette: "sequential" },
  { id: "departures", unit: "persons", palette: "sequential" },
  { id: "migration-balance-rate", unit: "per-1000", palette: "diverging" },
  { id: "international-migration-balance", unit: "persons", palette: "diverging" },
  { id: "international-migration-balance-rate", unit: "per-1000", palette: "diverging" },
  { id: "internal-migration-balance", unit: "persons", palette: "diverging" },
  { id: "internal-migration-balance-rate", unit: "per-1000", palette: "diverging" },
  { id: "statistical-correction", unit: "persons", palette: "diverging" },
] as const;

// `MOVEMENT_METRICS` is compared against the data file's colour scales during validation,
// so it cannot grow. These are the raw tuple components the balances are built from.
export const MOVEMENT_RAW_TARGETS = [
  "international-arrivals", "international-departures", "internal-arrivals", "internal-departures",
] as const;
export const MOVEMENT_TARGETS = [...MOVEMENT_METRICS.map(({ id }) => id), ...MOVEMENT_RAW_TARGETS] as const;
export type MovementRawTargetId = (typeof MOVEMENT_RAW_TARGETS)[number];
export type MovementTargetId = (typeof MOVEMENT_TARGETS)[number];

export type MovementMetricId = (typeof MOVEMENT_METRICS)[number]["id"];
export type MovementUnit = (typeof MOVEMENT_METRICS)[number]["unit"];
export type MovementPalette = (typeof MOVEMENT_METRICS)[number]["palette"];
export type MovementCounts = [
  populationChange: number, births: number, deaths: number, arrivals: number, departures: number,
  internationalArrivals: number, internationalDepartures: number, internalArrivals: number, internalDepartures: number,
];

export type MunicipalityMovementSeries = {
  schemaVersion: typeof MUNICIPALITY_MOVEMENT_SCHEMA_VERSION;
  firstYear: 2002;
  latestYear: 2025;
  count: number;
  source: {
    title: string;
    url: string;
    license: string;
    territorialStatus: "2026-01-01";
    generatedAt: "2026-06-29";
  };
  scales: Record<MovementMetricId, [number, number]>;
  years: Record<string, { periodStart: string; periodEnd: string; values: Record<string, MovementCounts> }>;
};

export function isMovementMetricId(value: string): value is MovementMetricId {
  return MOVEMENT_METRICS.some(({ id }) => id === value);
}

export function movementMetricUnit(id: MovementMetricId): MovementUnit {
  return MOVEMENT_METRICS.find((metric) => metric.id === id)!.unit;
}

export function movementMetricPalette(id: MovementMetricId): MovementPalette {
  return MOVEMENT_METRICS.find((metric) => metric.id === id)!.palette;
}

export function isMovementTargetId(value: string): value is MovementTargetId {
  return (MOVEMENT_TARGETS as readonly string[]).includes(value);
}

const RAW_TARGET_INDEX: Record<MovementRawTargetId, 5 | 6 | 7 | 8> = {
  "international-arrivals": 5, "international-departures": 6,
  "internal-arrivals": 7, "internal-departures": 8,
};

function isRawTarget(target: MovementTargetId): target is MovementRawTargetId {
  return target in RAW_TARGET_INDEX;
}

export function movementTargetValue(counts: MovementCounts, population: number, target: MovementTargetId) {
  return isRawTarget(target) ? counts[RAW_TARGET_INDEX[target]] : movementMetricValue(counts, population, target);
}

export function movementTargetUnit(target: MovementTargetId) {
  return isRawTarget(target) ? "persons" as const : movementMetricUnit(target);
}

export function movementTargetPalette(target: MovementTargetId) {
  return isRawTarget(target) ? "sequential" as const : movementMetricPalette(target);
}

export function movementMetricValue(counts: MovementCounts, population: number, metric: MovementMetricId) {
  if (metric === "population-change") return counts[0];
  if (metric === "births") return counts[1];
  if (metric === "deaths") return counts[2];
  if (metric === "arrivals") return counts[3];
  if (metric === "departures") return counts[4];
  if (metric === "international-migration-balance") return counts[5] - counts[6];
  if (metric === "internal-migration-balance") return counts[7] - counts[8];
  if (metric === "statistical-correction") return movementStatisticalCorrection(counts);
  if (population <= 0) return null;
  if (metric === "birth-rate") return (counts[1] / population) * 1_000;
  if (metric === "death-rate") return (counts[2] / population) * 1_000;
  if (metric === "birth-balance-rate") return ((counts[1] - counts[2]) / population) * 1_000;
  if (metric === "migration-balance-rate") return ((counts[3] - counts[4]) / population) * 1_000;
  if (metric === "international-migration-balance-rate") return ((counts[5] - counts[6]) / population) * 1_000;
  return ((counts[7] - counts[8]) / population) * 1_000;
}

export function movementStatisticalCorrection(counts: MovementCounts) {
  return counts[0] - (counts[1] - counts[2]) - (counts[3] - counts[4]);
}

function validCounts(value: unknown): value is MovementCounts {
  return Array.isArray(value)
    && value.length === 9
    && value.every((item, index) => Number.isSafeInteger(item) && (index === 0 || item >= 0));
}

export function validateMunicipalityMovementSeries(
  series: MunicipalityMovementSeries,
  populationSeries: MunicipalityPopulationSeries,
  municipalityCodes: Iterable<string>,
) {
  if (series.schemaVersion !== MUNICIPALITY_MOVEMENT_SCHEMA_VERSION || series.firstYear !== 2002 || series.latestYear !== 2025) {
    throw new Error("Unerwartete Version oder Zeitraum der Bevölkerungsbewegungsdaten.");
  }
  if (series.count !== EXPECTED_MUNICIPALITY_COUNT || Object.keys(series.years).length !== 24) {
    throw new Error("Unvollständige Bevölkerungsbewegungszeitreihe.");
  }
  if (series.source.territorialStatus !== "2026-01-01" || series.source.generatedAt !== "2026-06-29") {
    throw new Error("Unerwarteter Gebietsstand der Bevölkerungsbewegungsdaten.");
  }
  const codes = Array.from(municipalityCodes);
  if (codes.length !== EXPECTED_MUNICIPALITY_COUNT) throw new Error("Unerwartete Anzahl an Gemeindecodes.");
  for (const year of municipalityPopulationYears()) {
    const snapshot = series.years[String(year)];
    if (!snapshot || snapshot.periodStart !== `${year}-01-01` || snapshot.periodEnd !== `${year + 1}-01-01`) {
      throw new Error(`Fehlende Bevölkerungsbewegungsdaten für ${year}.`);
    }
    if (Object.keys(snapshot.values).length !== EXPECTED_MUNICIPALITY_COUNT) {
      throw new Error(`Unvollständige Bevölkerungsbewegungsdaten für ${year}.`);
    }
    for (const code of codes) {
      const counts = snapshot.values[code];
      if (!validCounts(counts)) throw new Error(`Ungültige Bevölkerungsbewegungsdaten für ${code}/${year}.`);
      if (year < series.latestYear) {
        const expectedChange = populationSeries.years[String(year + 1)].values[code] - populationSeries.years[String(year)].values[code];
        if (counts[0] !== expectedChange) throw new Error(`Gesamtveränderung stimmt für ${code}/${year} nicht mit der Einwohnerzeitreihe überein.`);
      }
    }
  }
  for (const metric of MOVEMENT_METRICS) {
    const domain = series.scales[metric.id];
    if (!domain || !domain.every(Number.isFinite) || domain[0] > domain[1]) throw new Error(`Ungültige Farbskala für ${metric.id}.`);
    if (metric.palette === "diverging" && domain[0] !== -domain[1]) throw new Error(`Nicht symmetrische Farbskala für ${metric.id}.`);
  }
  return series;
}
