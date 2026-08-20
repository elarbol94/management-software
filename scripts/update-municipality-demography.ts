import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MunicipalityIndex } from "../src/modules/municipalities/data";
import { validateMunicipalityIndex } from "../src/modules/municipalities/data";
import {
  AGE_GROUPS,
  MUNICIPALITY_DEMOGRAPHY_SCHEMA_VERSION,
  ageGroupIndexForSourceCode,
  demographyMetricValue,
  validateMunicipalityDemographySeries,
  type AgeCounts,
  type AgeMeasure,
  type DemographyScale,
  type MunicipalityDemographySeries,
  type MunicipalitySexAgeCounts,
  type SexFilter,
} from "../src/modules/municipalities/demography";
import { municipalityPopulationYears, type MunicipalityPopulationSeries } from "../src/modules/municipalities/population";

const SOURCE_URL_TEMPLATE = "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_{year}.csv";
const outputPath = resolve("public/data/municipality-demography-2002-2025.json");
const emptyCounts = (): AgeCounts => [0, 0, 0, 0, 0, 0, 0];

function sourceDirectoryFromArguments(arguments_: string[]) {
  const sourceIndex = arguments_.indexOf("--source-dir");
  if (sourceIndex === -1) return null;
  const path = arguments_[sourceIndex + 1];
  if (!path) throw new Error("Nach --source-dir fehlt der Pfad zum CSV-Verzeichnis.");
  return resolve(path);
}

async function loadSource(year: number, sourceDirectory: string | null) {
  if (sourceDirectory) return readFile(join(sourceDirectory, `OGD_bevstandjbab2002_BevStand_${year}.csv`), "utf8");
  const response = await fetch(SOURCE_URL_TEMPLATE.replace("{year}", String(year)), { headers: { "user-agent": "management-platform municipality demography importer" } });
  if (!response.ok) throw new Error(`Statistik Austria antwortete für ${year} mit HTTP ${response.status}.`);
  return response.text();
}

export function aggregateDemography(csv: string, year: number) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(";");
  if (!header) throw new Error("Die Demografie-CSV ist leer.");
  const indices = {
    year: header.indexOf("C-A10-0"), sex: header.indexOf("C-C11-0"), municipality: header.indexOf("C-GRGEMAKT-0"), age: header.indexOf("C-GALTEJ112-0"), value: header.indexOf("F-ISIS-1"),
  };
  if (Object.values(indices).some((index) => index === -1)) throw new Error("Die Demografie-CSV enthält nicht die erwarteten Spalten.");
  const values = new Map<string, MunicipalitySexAgeCounts>();
  for (const [lineIndex, line] of lines.entries()) {
    if (!line) continue;
    const columns = line.split(";");
    if (columns[indices.year] !== `A10-${year}`) throw new Error(`Unerwartetes Jahr in CSV-Zeile ${lineIndex + 2}.`);
    const sourceCode = columns[indices.municipality]?.replace("GRGEMAKT-", "") ?? "";
    if (!/^\d{5}$/.test(sourceCode)) throw new Error(`Ungültiger Gemeindecode in CSV-Zeile ${lineIndex + 2}.`);
    const municipalityCode = sourceCode.startsWith("9") ? "90001" : sourceCode;
    const sexCode = columns[indices.sex];
    if (sexCode !== "C11-1" && sexCode !== "C11-2") throw new Error(`Unbekannter Geschlechtscode in CSV-Zeile ${lineIndex + 2}.`);
    const groupIndex = ageGroupIndexForSourceCode(columns[indices.age] ?? "");
    const count = Number(columns[indices.value]);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Ungültiger Wert in CSV-Zeile ${lineIndex + 2}.`);
    const counts = values.get(municipalityCode) ?? { m: emptyCounts(), f: emptyCounts() };
    counts[sexCode === "C11-1" ? "m" : "f"][groupIndex] += count;
    values.set(municipalityCode, counts);
  }
  return values;
}

function percentile(values: number[], fraction: number) {
  const sorted = values.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower] + (sorted[lower + 1] === undefined ? 0 : remainder * (sorted[lower + 1] - sorted[lower]));
}

function calculateScales(years: MunicipalityDemographySeries["years"]) {
  const result = {} as MunicipalityDemographySeries["scales"];
  for (const measure of ["share", "persons"] satisfies AgeMeasure[]) {
    result[measure] = {} as Record<SexFilter, DemographyScale>;
    for (const sex of ["all", "female", "male"] satisfies SexFilter[]) {
      result[measure][sex] = {} as DemographyScale;
      for (const { id } of AGE_GROUPS) {
        const values = Object.values(years).flatMap((year) => Object.values(year.values).map((counts) => demographyMetricValue(counts, sex, id, measure))).filter((value): value is number => value !== null);
        result[measure][sex][id] = [percentile(values, 0.05), percentile(values, 0.95)];
      }
    }
  }
  return result;
}

async function main() {
  const sourceDirectory = sourceDirectoryFromArguments(process.argv.slice(2));
  const index = validateMunicipalityIndex(JSON.parse(await readFile(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex);
  const population = JSON.parse(await readFile(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries;
  const municipalityCodes = index.municipalities.map(({ municipalityCode }) => municipalityCode).sort();
  const expectedCodes = new Set(municipalityCodes);
  const years: MunicipalityDemographySeries["years"] = {};
  for (const year of municipalityPopulationYears()) {
    const aggregated = aggregateDemography(await loadSource(year, sourceDirectory), year);
    for (const code of aggregated.keys()) if (!expectedCodes.has(code)) throw new Error(`Die Quelle für ${year} enthält den unbekannten Gemeindecode ${code}.`);
    years[String(year)] = { referenceDate: `${year}-01-01`, values: Object.fromEntries(municipalityCodes.map((code) => {
      const value = aggregated.get(code);
      if (!value) throw new Error(`Die Quelle für ${year} enthält keine Demografiedaten für ${code}.`);
      return [code, value];
    })) };
  }
  const series: MunicipalityDemographySeries = {
    schemaVersion: MUNICIPALITY_DEMOGRAPHY_SCHEMA_VERSION,
    firstYear: 2002,
    latestYear: 2025,
    count: municipalityCodes.length,
    unit: "persons",
    groups: AGE_GROUPS.map(({ id }) => id),
    source: { title: "Bevölkerungsstand zu Jahresbeginn ab 2002 nach Alter und Geschlecht", urlTemplate: SOURCE_URL_TEMPLATE, license: "CC BY 4.0" },
    scales: calculateScales(years),
    years,
  };
  validateMunicipalityDemographySeries(series, population, municipalityCodes);
  await writeFile(outputPath, `${JSON.stringify(series)}\n`);
  process.stdout.write(`Demografiezeitreihe 2002–2025: ${series.count} Gemeinden je Jahr erzeugt und mit der Einwohnerzeitreihe abgeglichen.\n`);
}

if (process.env.NODE_ENV !== "test") void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
