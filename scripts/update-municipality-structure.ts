import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateMunicipalityIndex, type MunicipalityIndex } from "../src/modules/municipalities/data";
import { type MunicipalityPopulationSeries } from "../src/modules/municipalities/population";
import {
  MUNICIPALITY_STRUCTURE_FIRST_YEAR,
  MUNICIPALITY_STRUCTURE_LATEST_YEAR,
  MUNICIPALITY_STRUCTURE_SCHEMA_VERSION,
  validateMunicipalityStructureSeries,
  type CitizenshipCounts,
  type MunicipalityStructureSeries,
} from "../src/modules/municipalities/structure";

const SOURCE_URL = "https://data.statistik.gv.at/data/OGDEXT_AEST_GEMTAB_1.csv";
const OUTPUT_PATH = resolve("public/data/municipality-structure-2022-2024.json");

function sourceFileFromArguments(arguments_: string[]) {
  const sourceIndex = arguments_.indexOf("--source-file");
  if (sourceIndex === -1) return null;
  const path = arguments_[sourceIndex + 1];
  if (!path) throw new Error("Nach --source-file fehlt der Pfad zur CSV-Datei.");
  return resolve(path);
}

async function loadSource(sourceFile: string | null) {
  if (sourceFile) return readFile(sourceFile, "utf8");
  const response = await fetch(SOURCE_URL, {
    headers: { "user-agent": "management-platform municipality structure importer" },
  });
  if (!response.ok) throw new Error(`Statistik Austria antwortete mit HTTP ${response.status}.`);
  return response.text();
}

function currentMunicipalityCode(sourceCode: string) {
  if (sourceCode.startsWith("9")) return "90001";
  if (sourceCode === "62252" || sourceCode === "62267") return "62280";
  return sourceCode;
}

function decimal(value: string) {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`Ungültiger Dezimalwert: ${value}`);
  return parsed;
}

export function aggregateStructure(csv: string, year: number) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(";");
  if (!header) throw new Error("Die Struktur-CSV ist leer.");
  const indices = {
    year: header.indexOf("JAHR"),
    municipality: header.indexOf("GCD"),
    population: header.indexOf("BEV_ABSOLUT"),
    foreignShare: header.indexOf("AUSL_STAATSB"),
  };
  if (Object.values(indices).some((index) => index === -1)) throw new Error("Die Struktur-CSV enthält nicht die erwarteten Spalten.");
  const values = new Map<string, CitizenshipCounts>();
  for (const [lineIndex, line] of lines.entries()) {
    if (!line) continue;
    const columns = line.split(";");
    if (columns[indices.year] !== String(year)) continue;
    const sourceCode = columns[indices.municipality] ?? "";
    if (!/^\d{5}$/.test(sourceCode)) throw new Error(`Ungültiger Gemeindecode in CSV-Zeile ${lineIndex + 2}.`);
    const population = Number(columns[indices.population]);
    const foreignSharePercent = decimal(columns[indices.foreignShare] ?? "");
    if (!Number.isSafeInteger(population) || population < 0 || foreignSharePercent < 0 || foreignSharePercent > 100) {
      throw new Error(`Ungültige Strukturkennzahlen in CSV-Zeile ${lineIndex + 2}.`);
    }
    const code = currentMunicipalityCode(sourceCode);
    const existing = values.get(code) ?? [0, 0];
    existing[0] += population;
    existing[1] += Math.round((population * foreignSharePercent) / 100);
    values.set(code, existing);
  }
  return values;
}

function percentile(values: number[], fraction: number) {
  const sorted = values.toSorted((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower] + (sorted[lower + 1] === undefined ? 0 : remainder * (sorted[lower + 1] - sorted[lower]));
}

function calculateScales(years: MunicipalityStructureSeries["years"]) {
  const counts = Object.values(years).flatMap(({ values }) => Object.values(values));
  const shares = counts.filter(([population]) => population > 0).map(([population, foreign]) => foreign / population);
  const persons = counts.map(([, foreign]) => foreign);
  return {
    "foreign-share": [percentile(shares, 0.05), percentile(shares, 0.95)],
    "foreign-persons": [percentile(persons, 0.05), percentile(persons, 0.95)],
  } satisfies MunicipalityStructureSeries["scales"];
}

async function main() {
  const index = validateMunicipalityIndex(JSON.parse(await readFile(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex);
  const population = JSON.parse(await readFile(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries;
  const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode).sort();
  const expectedCodes = new Set(codes);
  const csv = await loadSource(sourceFileFromArguments(process.argv.slice(2)));
  const years: MunicipalityStructureSeries["years"] = {};
  for (let year = MUNICIPALITY_STRUCTURE_FIRST_YEAR; year <= MUNICIPALITY_STRUCTURE_LATEST_YEAR; year += 1) {
    const aggregated = aggregateStructure(csv, year);
    for (const code of aggregated.keys()) if (!expectedCodes.has(code)) throw new Error(`Die Quelle für ${year} enthält den unbekannten Gemeindecode ${code}.`);
    years[String(year)] = {
      referenceDate: `${year}-10-31`,
      values: Object.fromEntries(codes.map((code) => {
        const value = aggregated.get(code);
        if (!value) throw new Error(`Die Quelle für ${year} enthält keine Strukturkennzahlen für ${code}.`);
        return [code, value];
      })),
    };
  }
  const series: MunicipalityStructureSeries = {
    schemaVersion: MUNICIPALITY_STRUCTURE_SCHEMA_VERSION,
    firstYear: MUNICIPALITY_STRUCTURE_FIRST_YEAR,
    latestYear: MUNICIPALITY_STRUCTURE_LATEST_YEAR,
    count: codes.length,
    source: {
      title: "Gemeindeergebnisse der Abgestimmten Erwerbsstatistik",
      url: SOURCE_URL,
      license: "CC BY 4.0",
      referenceDate: "October 31",
    },
    scales: calculateScales(years),
    years,
  };
  validateMunicipalityStructureSeries(series, population, codes);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(series)}\n`);
  process.stdout.write(`Strukturkennzahlen ${series.firstYear}–${series.latestYear}: ${series.count} Gemeinden je Jahr erzeugt.\n`);
}

if (process.env.NODE_ENV !== "test") void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
