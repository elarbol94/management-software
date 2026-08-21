import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { MunicipalityIndex } from "../src/modules/municipalities/data";
import { validateMunicipalityIndex } from "../src/modules/municipalities/data";
import {
  COST_CATEGORIES,
  MUNICIPALITY_COSTS_FIRST_YEAR,
  MUNICIPALITY_COSTS_LATEST_YEAR,
  MUNICIPALITY_COSTS_SCHEMA_VERSION,
  municipalityCostShare,
  validateMunicipalityCostSeries,
  type CostCategoryId,
  type MunicipalityCostSeries,
  type MunicipalityCostTuple,
} from "../src/modules/municipalities/costs";

const OUTPUT_PATH = resolve("public/data/municipality-cost-shares-2010-2024.json");
const FILE_PATTERN = /^(\d{5})_(201\d|202[0-4])_ra_fhh_statistik_at\.csv$/;
const REQUIRED_COLUMNS = [
  "Jahr", "Voranschlag/Rechnungsabschluss", "Datenquelle", "Gemeindekennziffer",
  "Haushalt", "Ansatz-Uab", "Mvag", "Wert",
] as const;

export function parseSemicolonCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ";") { row.push(field); field = ""; }
    else if (character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = []; field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Nicht geschlossenes Anführungszeichen in CSV-Datei.");
  if (field.length || row.length) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

export function parseEuroCents(value: string) {
  const normalized = value.trim().replaceAll(" ", "").replaceAll(".", "");
  const match = /^([+-]?)(\d+)(?:,(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error(`Ungültiger Eurobetrag: ${value}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  const signed = match[1] === "-" ? -cents : cents;
  if (!Number.isSafeInteger(signed)) throw new Error(`Eurobetrag außerhalb des sicheren Bereichs: ${value}`);
  return signed;
}

export function aggregateMunicipalityCostCsv(source: string, expectedCode: string, expectedYear: number): MunicipalityCostTuple {
  const rows = parseSemicolonCsv(source);
  const header = rows.shift();
  if (!header) throw new Error("Leere Kostenübersichtsdatei.");
  const columns = new Map(header.map((name, index) => [name, index]));
  for (const name of REQUIRED_COLUMNS) if (!columns.has(name)) throw new Error(`Fehlende CSV-Spalte: ${name}`);
  const valueAt = (row: string[], name: (typeof REQUIRED_COLUMNS)[number]) => row[columns.get(name)!] ?? "";
  const categories = Array.from({ length: 10 }, () => 0);
  for (const row of rows) {
    if (
      valueAt(row, "Jahr") !== String(expectedYear)
      || valueAt(row, "Gemeindekennziffer") !== expectedCode
      || valueAt(row, "Voranschlag/Rechnungsabschluss") !== "Rechnungsabschluss"
      || valueAt(row, "Datenquelle") !== "Statistik Austria"
      || valueAt(row, "Haushalt") !== "Finanzierungshaushalt"
    ) throw new Error(`Unerwartete Metadaten in ${expectedCode}/${expectedYear}.`);
    const mvag = valueAt(row, "Mvag");
    if (!/^(32|34|36)/.test(mvag)) continue;
    const category = valueAt(row, "Ansatz-Uab")[0];
    if (!category || !/^[0-9]$/.test(category)) {
      throw new Error(`Ungültiger Ansatz für eine Auszahlung in ${expectedCode}/${expectedYear}.`);
    }
    categories[Number(category)] += parseEuroCents(valueAt(row, "Wert"));
  }
  if (!categories.every(Number.isSafeInteger)) throw new Error(`Kostensumme außerhalb des sicheren Bereichs für ${expectedCode}/${expectedYear}.`);
  const total = categories.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error(`Nicht positive Gesamtauszahlungen für ${expectedCode}/${expectedYear}.`);
  return [total, ...categories] as MunicipalityCostTuple;
}

function sourceRootFromArguments(arguments_: string[]) {
  const index = arguments_.indexOf("--source-root");
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || arguments_.some((argument, position) => argument.startsWith("--") && position !== index)) {
    throw new Error('Aufruf: npm run data:municipality-costs -- --source-root "/pfad/zu/Daten"');
  }
  return resolve(value);
}

function percentile(values: number[], fraction: number) {
  const sorted = values.toSorted((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower] + (sorted[lower + 1] === undefined ? 0 : remainder * (sorted[lower + 1] - sorted[lower]));
}

function calculateScales(years: MunicipalityCostSeries["years"]) {
  return Object.fromEntries(COST_CATEGORIES.map(({ id }) => {
    const values = Object.values(years).flatMap(({ values: snapshotValues }) =>
      Object.values(snapshotValues).map((value) => municipalityCostShare(value, id)!),
    );
    let minimum = percentile(values, 0.05);
    let maximum = percentile(values, 0.95);
    if (minimum === maximum) { minimum -= 0.005; maximum += 0.005; }
    return [id, [minimum, maximum]];
  })) as Record<CostCategoryId, [number, number]>;
}

async function main() {
  const sourceRoot = sourceRootFromArguments(process.argv.slice(2));
  const index = validateMunicipalityIndex(JSON.parse(
    await readFile(resolve("public/data/municipalities-at-2026.index.json"), "utf8"),
  ) as MunicipalityIndex);
  const knownCodes = new Set(index.municipalities.map(({ municipalityCode }) => municipalityCode));
  const sourceFiles = (await readdir(sourceRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
  const years: MunicipalityCostSeries["years"] = Object.fromEntries(
    Array.from({ length: MUNICIPALITY_COSTS_LATEST_YEAR - MUNICIPALITY_COSTS_FIRST_YEAR + 1 }, (_, offset) => [
      String(MUNICIPALITY_COSTS_FIRST_YEAR + offset),
      { referenceType: "Rechnungsabschluss" as const, coverage: 0, values: {} },
    ]),
  );
  const seen = new Set<string>();
  for (let position = 0; position < sourceFiles.length; position += 1) {
    const path = sourceFiles[position];
    const match = FILE_PATTERN.exec(basename(path))!;
    const [, code, year] = match;
    if (!knownCodes.has(code)) throw new Error(`Unbekannter Gemeindecode in Quelldatei: ${code}`);
    const key = `${code}/${year}`;
    if (seen.has(key)) throw new Error(`Doppelte Kostenübersichtsdatei für ${key}.`);
    seen.add(key);
    years[year].values[code] = aggregateMunicipalityCostCsv(await readFile(path, "utf8"), code, Number(year));
    if ((position + 1) % 1_000 === 0) process.stdout.write(`${position + 1}/${sourceFiles.length} `);
  }
  for (const snapshot of Object.values(years)) snapshot.coverage = Object.keys(snapshot.values).length;
  const series: MunicipalityCostSeries = {
    schemaVersion: MUNICIPALITY_COSTS_SCHEMA_VERSION,
    firstYear: MUNICIPALITY_COSTS_FIRST_YEAR,
    latestYear: MUNICIPALITY_COSTS_LATEST_YEAR,
    unit: "cents",
    categories: COST_CATEGORIES.map(({ id }) => id),
    source: {
      title: "Statistik Austria via OffenerHaushalt.at",
      url: "https://www.offenerhaushalt.at/",
      origin: "Statistik Austria",
    },
    scales: calculateScales(years),
    years,
  };
  validateMunicipalityCostSeries(series, knownCodes);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(series)}\n`);
  process.stdout.write(`\nKostenübersicht 2010–2024: ${sourceFiles.length} Gemeinderechnungsabschlüsse erzeugt.\n`);
}

if (process.env.NODE_ENV !== "test") void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
