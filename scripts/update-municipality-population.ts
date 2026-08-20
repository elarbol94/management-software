import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MunicipalityIndex } from "../src/modules/municipalities/data";
import { validateMunicipalityIndex } from "../src/modules/municipalities/data";
import {
  MUNICIPALITY_POPULATION_REFERENCE_DATE,
  MUNICIPALITY_POPULATION_SCHEMA_VERSION,
  validateMunicipalityPopulation,
  type MunicipalityPopulationSnapshot,
} from "../src/modules/municipalities/population";

const SOURCE_URL = "https://data.statistik.gv.at/data/OGD_bevstandjbab2002_BevStand_2025.csv";
const indexPath = resolve("public/data/municipalities-at-2026.index.json");
const outputPath = resolve("public/data/municipality-population-2025.json");

function sourcePathFromArguments(arguments_: string[]) {
  const sourceIndex = arguments_.indexOf("--source");
  if (sourceIndex === -1) return null;
  const path = arguments_[sourceIndex + 1];
  if (!path) throw new Error("Nach --source fehlt der Pfad zur CSV-Datei.");
  return resolve(path);
}

async function loadSource(path: string | null) {
  if (path) return readFile(path, "utf8");
  const response = await fetch(SOURCE_URL, {
    headers: { "user-agent": "management-platform municipality population importer" },
  });
  if (!response.ok) throw new Error(`Statistik Austria antwortete mit HTTP ${response.status}.`);
  return response.text();
}

function aggregatePopulation(csv: string) {
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
    if (columns[yearIndex] !== "A10-2025") throw new Error(`Unerwartetes Jahr in CSV-Zeile ${lineIndex + 2}.`);
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
  const sourcePath = sourcePathFromArguments(process.argv.slice(2));
  const index = validateMunicipalityIndex(JSON.parse(await readFile(indexPath, "utf8")) as MunicipalityIndex);
  const aggregated = aggregatePopulation(await loadSource(sourcePath));
  const municipalityCodes = index.municipalities.map(({ municipalityCode }) => municipalityCode);
  const expectedCodes = new Set(municipalityCodes);
  for (const code of aggregated.keys()) {
    if (!expectedCodes.has(code)) throw new Error(`Die Quelle enthält den unbekannten Gemeindecode ${code}.`);
  }
  const values = Object.fromEntries(municipalityCodes.sort().map((code) => [code, aggregated.get(code)])) as Record<string, number>;
  const nationalTotal = Object.values(values).reduce((sum, population) => sum + (population ?? 0), 0);
  const snapshot: MunicipalityPopulationSnapshot = validateMunicipalityPopulation({
    schemaVersion: MUNICIPALITY_POPULATION_SCHEMA_VERSION,
    referenceDate: MUNICIPALITY_POPULATION_REFERENCE_DATE,
    count: municipalityCodes.length,
    nationalTotal,
    unit: "persons",
    source: {
      title: "Bevölkerungsstand zu Jahresbeginn ab 2002",
      url: SOURCE_URL,
      license: "CC BY 4.0",
    },
    values,
  }, municipalityCodes);

  await writeFile(outputPath, `${JSON.stringify(snapshot)}\n`);
  process.stdout.write(`Einwohnerdaten ${snapshot.referenceDate}: ${snapshot.count} Gemeinden, ${snapshot.nationalTotal} Personen erzeugt.\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
