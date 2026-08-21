import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  validateMunicipalityIndex,
  type MunicipalityIndex,
} from "../src/modules/municipalities/data";
import {
  MOVEMENT_METRICS,
  MUNICIPALITY_MOVEMENT_SCHEMA_VERSION,
  movementMetricPalette,
  movementMetricValue,
  validateMunicipalityMovementSeries,
  type MovementCounts,
  type MovementMetricId,
  type MunicipalityMovementSeries,
} from "../src/modules/municipalities/movement";
import {
  municipalityPopulationYears,
  type MunicipalityPopulationSeries,
} from "../src/modules/municipalities/population";

const SOURCE_PAGE = "https://www.statistik.at/atlas/demographie/";
const WFS_ENDPOINT = "https://www.statistik.at/gs-atlas/ATLAS_WANDERUNGEN/ows";
const OUTPUT_PATH = resolve("public/data/municipality-movement-2002-2025.json");
const SOURCE_COMPONENTS = [
  "bev_bilanz",
  "lebendgeborene",
  "gestorbene",
  "zuzug_gesamt",
  "wegzug_gesamt",
] as const;
type SourceComponent = (typeof SOURCE_COMPONENTS)[number];
type WfsFeature = {
  properties?: { geo_id?: number; name?: string; summe?: number; bev?: number };
};
type WfsResponse = { features?: WfsFeature[] };

function sourceDirectoryFromArguments(arguments_: string[]) {
  const sourceIndex = arguments_.indexOf("--source-dir");
  if (sourceIndex === -1) return null;
  const path = arguments_[sourceIndex + 1];
  if (!path)
    throw new Error(
      "Nach --source-dir fehlt der Pfad zum WFS-JSON-Verzeichnis.",
    );
  return resolve(path);
}

function sourceFileName(year: number, component: SourceComponent) {
  return `${year}-${component}.json`;
}

function sourceUrl(year: number, component: SourceComponent) {
  const parameters = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: "ATLAS_WANDERUNGEN:ATLAS_DEMOGRAPHIE_REL_TABLE",
    viewparams: `KOMPONENTE:${component};GEOMDEF:gem;GEOMDEF_ABR:gem;REGTYP:5;YEAR_MIN:${year};YEAR_MAX:${year};GEOMDATE:2026-01-01`,
    outputFormat: "application/json",
  });
  return `${WFS_ENDPOINT}?${parameters}`;
}

async function loadSource(
  year: number,
  component: SourceComponent,
  sourceDirectory: string | null,
) {
  if (sourceDirectory)
    return readFile(
      join(sourceDirectory, sourceFileName(year, component)),
      "utf8",
    );
  const response = await fetch(sourceUrl(year, component), {
    headers: {
      "user-agent": "management-platform municipality movement importer",
    },
  });
  if (!response.ok)
    throw new Error(
      `Statistik Austria antwortete für ${year}/${component} mit HTTP ${response.status}.`,
    );
  return response.text();
}

export function aggregateMovementComponent(
  json: string,
  year: number,
  component: SourceComponent,
) {
  const parsed = JSON.parse(json) as WfsResponse;
  if (!Array.isArray(parsed.features))
    throw new Error(`Ungültige WFS-Antwort für ${year}/${component}.`);
  const values = new Map<string, { value: number; population: number }>();
  for (const [index, feature] of parsed.features.entries()) {
    const sourceCode = String(feature.properties?.geo_id ?? "").padStart(
      5,
      "0",
    );
    if (!/^\d{5}$/.test(sourceCode))
      throw new Error(`Ungültiger Gemeindecode in WFS-Datensatz ${index + 1}.`);
    const municipalityCode = sourceCode.startsWith("9") ? "90001" : sourceCode;
    const value = feature.properties?.summe;
    const population = feature.properties?.bev;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      (component !== "bev_bilanz" && value < 0) ||
      typeof population !== "number" ||
      !Number.isSafeInteger(population) ||
      population < 0
    ) {
      throw new Error(`Ungültiger Wert in WFS-Datensatz ${index + 1}.`);
    }
    const existing = values.get(municipalityCode) ?? {
      value: 0,
      population: 0,
    };
    existing.value += value;
    existing.population += population;
    values.set(municipalityCode, existing);
  }
  return values;
}

function percentile(values: number[], fraction: number) {
  const sorted = values.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return (
    sorted[lower] +
    (sorted[lower + 1] === undefined
      ? 0
      : remainder * (sorted[lower + 1] - sorted[lower]))
  );
}

function calculateScales(
  years: MunicipalityMovementSeries["years"],
  population: MunicipalityPopulationSeries,
) {
  return Object.fromEntries(
    MOVEMENT_METRICS.map(({ id }) => {
      const values = Object.entries(years).flatMap(([year, snapshot]) =>
        Object.entries(snapshot.values)
          .map(([code, counts]) =>
            movementMetricValue(
              counts,
              population.years[year].values[code],
              id,
            ),
          )
          .filter((value): value is number => value !== null),
      );
      if (movementMetricPalette(id) === "diverging") {
        const maximum = percentile(values.map(Math.abs), 0.95);
        return [id, [-maximum, maximum]];
      }
      return [id, [percentile(values, 0.05), percentile(values, 0.95)]];
    }),
  ) as Record<MovementMetricId, [number, number]>;
}

async function loadYear(
  year: number,
  sourceDirectory: string | null,
  expectedCodes: Set<string>,
  population: MunicipalityPopulationSeries,
) {
  const components = await Promise.all(
    SOURCE_COMPONENTS.map(
      async (component) =>
        [
          component,
          aggregateMovementComponent(
            await loadSource(year, component, sourceDirectory),
            year,
            component,
          ),
        ] as const,
    ),
  );
  const byComponent = Object.fromEntries(components) as Record<
    SourceComponent,
    Map<string, { value: number; population: number }>
  >;
  for (const component of SOURCE_COMPONENTS) {
    for (const code of byComponent[component].keys())
      if (!expectedCodes.has(code))
        throw new Error(
          `Die Quelle für ${year}/${component} enthält den unbekannten Gemeindecode ${code}.`,
        );
  }
  return Object.fromEntries(
    Array.from(expectedCodes).map((code) => {
      const records = SOURCE_COMPONENTS.map((component) =>
        byComponent[component].get(code),
      );
      if (records.some((record) => !record))
        throw new Error(
          `Die Quelle für ${year} enthält keine vollständigen Bewegungsdaten für ${code}.`,
        );
      const sourcePopulation = records[0]!.population;
      if (records.some((record) => record!.population !== sourcePopulation))
        throw new Error(
          `Die Nenner der Bewegungskomponenten stimmen für ${code}/${year} nicht überein.`,
        );
      if (sourcePopulation !== population.years[String(year)].values[code])
        throw new Error(
          `Der WFS-Bevölkerungsstand stimmt für ${code}/${year} nicht mit der Einwohnerzeitreihe überein.`,
        );
      return [code, records.map((record) => record!.value) as MovementCounts];
    }),
  );
}

async function main() {
  const sourceDirectory = sourceDirectoryFromArguments(process.argv.slice(2));
  const index = validateMunicipalityIndex(
    JSON.parse(
      await readFile(
        resolve("public/data/municipalities-at-2026.index.json"),
        "utf8",
      ),
    ) as MunicipalityIndex,
  );
  const population = JSON.parse(
    await readFile(
      resolve("public/data/municipality-population-2002-2025.json"),
      "utf8",
    ),
  ) as MunicipalityPopulationSeries;
  const municipalityCodes = index.municipalities
    .map(({ municipalityCode }) => municipalityCode)
    .sort();
  const expectedCodes = new Set(municipalityCodes);
  const years: MunicipalityMovementSeries["years"] = {};
  for (const year of municipalityPopulationYears()) {
    years[String(year)] = {
      periodStart: `${year}-01-01`,
      periodEnd: `${year + 1}-01-01`,
      values: await loadYear(year, sourceDirectory, expectedCodes, population),
    };
    process.stdout.write(`${year} `);
  }
  const series: MunicipalityMovementSeries = {
    schemaVersion: MUNICIPALITY_MOVEMENT_SCHEMA_VERSION,
    firstYear: 2002,
    latestYear: 2025,
    count: municipalityCodes.length,
    source: {
      title: "Atlas der Demographie – Komponenten der Bevölkerungsveränderung",
      url: SOURCE_PAGE,
      license: "CC BY 4.0",
      territorialStatus: "2026-01-01",
      generatedAt: "2026-06-29",
    },
    scales: calculateScales(years, population),
    years,
  };
  validateMunicipalityMovementSeries(series, population, municipalityCodes);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(series)}\n`);
  process.stdout.write(
    `\nBevölkerungsbewegung 2002–2025: ${series.count} Gemeinden je Jahr erzeugt.\n`,
  );
}

if (process.env.NODE_ENV !== "test")
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
