import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MunicipalityIndex } from "../src/modules/municipalities/data";
import { validateMunicipalityIndex } from "../src/modules/municipalities/data";
import {
  MUNICIPALITY_POPULATION_LATEST_YEAR,
  MUNICIPALITY_POPULATION_REFERENCE_DATE,
  MUNICIPALITY_POPULATION_SCHEMA_VERSION,
  MUNICIPALITY_POPULATION_SERIES_SCHEMA_VERSION,
  municipalityPopulationReferenceDate,
  municipalityPopulationYears,
  validateMunicipalityPopulation,
  validateMunicipalityPopulationSeries,
  type MunicipalityPopulationSeries,
  type MunicipalityPopulationSnapshot,
} from "../src/modules/municipalities/population";

const SOURCE_URL_TEMPLATE = "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_{year}.csv";
const indexPath = resolve("public/data/municipalities-at-2026.index.json");
const seriesOutputPath = resolve("public/data/municipality-population-2002-2025.json");
const latestOutputPath = resolve("public/data/municipality-population-2025.json");

function sourceDirectoryFromArguments(arguments_: string[]) {
  const sourceIndex = arguments_.indexOf("--source-dir");
  if (sourceIndex === -1) return null;
  const path = arguments_[sourceIndex + 1];
  if (!path) throw new Error("Nach --source-dir fehlt der Pfad zum CSV-Verzeichnis.");
  return resolve(path);
}

function sourceUrl(year: number) {
  return SOURCE_URL_TEMPLATE.replace("{year}", String(year));
}

function sourceFilename(year: number) {
  return `OGD_bevstandjbab2002_BevStand_${year}.csv`;
}

async function loadSource(year: number, sourceDirectory: string | null) {
  if (sourceDirectory) return readFile(join(sourceDirectory, sourceFilename(year)), "utf8");
  const response = await fetch(sourceUrl(year), {
    headers: { "user-agent": "management-platform municipality population importer" },
  });
  if (!response.ok) throw new Error(`Statistik Austria antwortete für ${year} mit HTTP ${response.status}.`);
  return response.text();
}

function aggregatePopulation(csv: string, year: number) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(";");
  if (!header) throw new Error("Die Bevölkerungs-CSV ist leer.");
  const yearIndex = header.indexOf("C-A10-0");
  const municipalityIndex = header.indexOf("C-GRGEMAKT-0");
  const valueIndex = header.indexOf("F-ISIS-1");
  if ([yearIndex, municipalityIndex, valueIndex].some((index) => index === -1)) {
    throw new Error("Die Bevölkerungs-CSV enthält nicht die erwarteten Spalten.");
  }

  const values = new Map<string, number>();
  for (const [lineIndex, line] of lines.entries()) {
    if (!line) continue;
    const columns = line.split(";");
    if (columns[yearIndex] !== `A10-${year}`) throw new Error(`Unerwartetes Jahr in CSV-Zeile ${lineIndex + 2}.`);
    const sourceCode = columns[municipalityIndex]?.replace("GRGEMAKT-", "") ?? "";
    if (!/^\d{5}$/.test(sourceCode)) throw new Error(`Ungültiger Gemeindecode in CSV-Zeile ${lineIndex + 2}.`);
    const municipalityCode = sourceCode.startsWith("9") ? "90001" : sourceCode;
    const population = Number(columns[valueIndex]);
    if (!Number.isSafeInteger(population) || population < 0) throw new Error(`Ungültiger Wert in CSV-Zeile ${lineIndex + 2}.`);
    values.set(municipalityCode, (values.get(municipalityCode) ?? 0) + population);
  }
  return values;
}

async function main() {
  const sourceDirectory = sourceDirectoryFromArguments(process.argv.slice(2));
  const index = validateMunicipalityIndex(JSON.parse(await readFile(indexPath, "utf8")) as MunicipalityIndex);
  const municipalityCodes = index.municipalities.map(({ municipalityCode }) => municipalityCode).sort();
  const expectedCodes = new Set(municipalityCodes);
  const years: MunicipalityPopulationSeries["years"] = {};

  for (const year of municipalityPopulationYears()) {
    const aggregated = aggregatePopulation(await loadSource(year, sourceDirectory), year);
    for (const code of aggregated.keys()) {
      if (!expectedCodes.has(code)) throw new Error(`Die Quelle für ${year} enthält den unbekannten Gemeindecode ${code}.`);
    }
    const values = Object.fromEntries(municipalityCodes.map((code) => [code, aggregated.get(code)])) as Record<string, number>;
    years[String(year)] = {
      referenceDate: municipalityPopulationReferenceDate(year),
      nationalTotal: Object.values(values).reduce((sum, population) => sum + (population ?? 0), 0),
      values,
    };
  }

  const series: MunicipalityPopulationSeries = validateMunicipalityPopulationSeries({
    schemaVersion: MUNICIPALITY_POPULATION_SERIES_SCHEMA_VERSION,
    firstYear: 2002,
    latestYear: MUNICIPALITY_POPULATION_LATEST_YEAR,
    count: municipalityCodes.length,
    unit: "persons",
    source: {
      title: "Bevölkerungsstand zu Jahresbeginn ab 2002",
      urlTemplate: SOURCE_URL_TEMPLATE,
      license: "CC BY 4.0",
    },
    years,
  }, municipalityCodes);
  const latestYear = series.years[String(MUNICIPALITY_POPULATION_LATEST_YEAR)];
  const latestSnapshot: MunicipalityPopulationSnapshot = validateMunicipalityPopulation({
    schemaVersion: MUNICIPALITY_POPULATION_SCHEMA_VERSION,
    referenceDate: MUNICIPALITY_POPULATION_REFERENCE_DATE,
    count: municipalityCodes.length,
    nationalTotal: latestYear.nationalTotal,
    unit: "persons",
    source: {
      title: series.source.title,
      url: sourceUrl(MUNICIPALITY_POPULATION_LATEST_YEAR),
      license: series.source.license,
    },
    values: latestYear.values,
  }, municipalityCodes);

  await writeFile(seriesOutputPath, `${JSON.stringify(series)}\n`);
  await writeFile(latestOutputPath, `${JSON.stringify(latestSnapshot)}\n`);
  process.stdout.write(`Einwohnerzeitreihe ${series.firstYear}–${series.latestYear}: ${series.count} Gemeinden je Jahr erzeugt.\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
