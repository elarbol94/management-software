import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { MunicipalityIndex } from "../src/modules/municipalities/data";
import { validateMunicipalityIndex } from "../src/modules/municipalities/data";
import {
  MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
  MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
  MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
  isInvestmentTaskAreaId,
  isInvestmentTypeId,
  municipalityInvestmentTotal,
  normalizeInvestmentDescription,
  validateMunicipalityInvestmentData,
  type InvestmentDetailLevel,
  type InvestmentTaskAreaId,
  type InvestmentTypeId,
  type MunicipalityInvestmentData,
  type MunicipalityInvestmentIndex,
  type MunicipalityInvestmentIndexEntry,
  type MunicipalityInvestmentPosition,
  type MunicipalityInvestmentUnavailableEntry,
} from "../src/modules/municipalities/investments";
import {
  municipalityInvestmentHtmlFilename,
  renderMunicipalityInvestmentHtml,
  renderMunicipalityInvestmentIndexHtml,
  type InvestmentHtmlLocale,
} from "../src/modules/municipalities/investment-html";

const FILE_PATTERN = /^(\d{5})_(201\d|202[0-4])_ra_fhh_(statistik_at|gemeinde)\.csv$/;
const REQUIRED_COLUMNS = [
  "Jahr", "Voranschlag/Rechnungsabschluss", "Datenquelle", "Gemeindekennziffer", "Haushalt",
  "Ansatz-Uab", "Ansatz-Ugl", "Konto-Grp", "Konto-Ugl", "Vorhabencode", "Mvag",
  "Ansatz-Text", "Konto-Text", "Wert",
] as const;

type SourceKind = "statistik_at" | "gemeinde";
type SourcePair = { statistics?: string; municipality?: string };
type ParsedInvestmentCsv = {
  directInvestmentCents: number;
  investiveInflowsCents: number;
  investiveOutflowsCents: number;
  positions: MunicipalityInvestmentPosition[];
};

export function reconcileMunicipalityInvestmentSources(
  statistics: ParsedInvestmentCsv,
  municipality: ParsedInvestmentCsv | null,
) {
  if (municipality && municipality.directInvestmentCents === statistics.directInvestmentCents) {
    return { selected: municipality, detailLevel: "municipality" as const, reconciliation: "matched" as const };
  }
  return {
    selected: statistics,
    detailLevel: "statistics" as const,
    reconciliation: municipality ? "mismatch-fallback" as const : "statistics-only" as const,
  };
}

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

function positionIdentity(position: Omit<MunicipalityInvestmentPosition, "id" | "amountCents">) {
  return [position.year, position.taskArea, position.approachCode, position.approachText, position.accountCode,
    position.accountText, position.projectCode, position.investmentType, position.detailLevel].join("\u001f");
}

function positionId(code: string, identity: string) {
  return createHash("sha256").update(`${code}\u001f${identity}`).digest("hex").slice(0, 20);
}

export function parseMunicipalityInvestmentCsv(
  source: string,
  expectedCode: string,
  expectedYear: number,
  sourceKind: SourceKind,
): ParsedInvestmentCsv {
  const rows = parseSemicolonCsv(source);
  const header = rows.shift();
  if (!header) throw new Error("Leere Investitionsdatei.");
  const columns = new Map(header.map((name, index) => [name, index]));
  for (const name of REQUIRED_COLUMNS) if (!columns.has(name)) throw new Error(`Fehlende CSV-Spalte: ${name}`);
  const valueAt = (row: string[], name: (typeof REQUIRED_COLUMNS)[number]) => row[columns.get(name)!] ?? "";
  const expectedSource = sourceKind === "gemeinde" ? "Gemeinde" : "Statistik Austria";
  const detailLevel: InvestmentDetailLevel = sourceKind === "gemeinde" ? "municipality" : "statistics";
  const grouped = new Map<string, { position: Omit<MunicipalityInvestmentPosition, "id" | "amountCents">; amountCents: number }>();
  let investiveInflowsCents = 0;
  let investiveOutflowsCents = 0;
  for (const row of rows) {
    if (
      valueAt(row, "Jahr") !== String(expectedYear)
      || valueAt(row, "Gemeindekennziffer") !== expectedCode
      || valueAt(row, "Voranschlag/Rechnungsabschluss") !== "Rechnungsabschluss"
      || valueAt(row, "Datenquelle").replaceAll('"', "") !== expectedSource
      || valueAt(row, "Haushalt") !== "Finanzierungshaushalt"
    ) throw new Error(`Unerwartete Metadaten in ${expectedCode}/${expectedYear}/${sourceKind}.`);
    const mvag = valueAt(row, "Mvag");
    const amountCents = parseEuroCents(valueAt(row, "Wert"));
    if (/^33/.test(mvag)) investiveInflowsCents += amountCents;
    if (/^34/.test(mvag)) investiveOutflowsCents += amountCents;
    if (!isInvestmentTypeId(mvag)) continue;
    const approachUab = valueAt(row, "Ansatz-Uab").padStart(3, "0");
    const approachUgl = valueAt(row, "Ansatz-Ugl").padStart(3, "0");
    const taskArea = approachUab[0];
    if (!isInvestmentTaskAreaId(taskArea)) throw new Error(`Ungültiger Ansatz in ${expectedCode}/${expectedYear}.`);
    const approachText = valueAt(row, "Ansatz-Text").trim();
    const accountText = valueAt(row, "Konto-Text").trim();
    const position = {
      year: expectedYear,
      taskArea: taskArea as InvestmentTaskAreaId,
      approachCode: `${approachUab}.${approachUgl}`,
      approachText,
      accountCode: `${valueAt(row, "Konto-Grp").padStart(3, "0")}.${valueAt(row, "Konto-Ugl").padStart(3, "0")}`,
      accountText,
      projectCode: valueAt(row, "Vorhabencode").trim() || "0000000",
      investmentType: mvag as InvestmentTypeId,
      normalizedDescription: normalizeInvestmentDescription(`${approachText} ${accountText}`),
      detailLevel,
    };
    const identity = positionIdentity(position);
    const existing = grouped.get(identity);
    grouped.set(identity, { position, amountCents: (existing?.amountCents ?? 0) + amountCents });
  }
  const positions = [...grouped.entries()].flatMap(([identity, { position, amountCents }]) => amountCents === 0 ? [] : [{
    id: positionId(expectedCode, identity),
    ...position,
    amountCents,
  }]).sort((left, right) => left.taskArea.localeCompare(right.taskArea)
    || left.approachCode.localeCompare(right.approachCode)
    || left.accountCode.localeCompare(right.accountCode)
    || left.projectCode.localeCompare(right.projectCode));
  if (![investiveInflowsCents, investiveOutflowsCents, ...positions.map(({ amountCents }) => amountCents)].every(Number.isSafeInteger)) {
    throw new Error(`Investitionssumme außerhalb des sicheren Bereichs für ${expectedCode}/${expectedYear}.`);
  }
  return {
    directInvestmentCents: positions.reduce((sum, position) => sum + position.amountCents, 0),
    investiveInflowsCents,
    investiveOutflowsCents,
    positions,
  };
}

function optionValue(arguments_: string[], option: string) {
  const index = arguments_.indexOf(option);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function parseArguments(arguments_: string[]) {
  const sourceRoot = optionValue(arguments_, "--source-root");
  const output = optionValue(arguments_, "--output");
  const appOutput = optionValue(arguments_, "--app-output") ?? "public/data/municipality-investments";
  const locale = optionValue(arguments_, "--locale") ?? "de";
  const supported = new Set(["--source-root", "--output", "--app-output", "--locale"]);
  const invalid = arguments_.some((argument, index) => argument.startsWith("--")
    ? !supported.has(argument) || !arguments_[index + 1] || arguments_[index + 1].startsWith("--")
    : index === 0 || !arguments_[index - 1].startsWith("--"));
  if (!sourceRoot || !output || invalid || !["de", "en"].includes(locale)) {
    throw new Error('Aufruf: npm run data:municipality-investments -- --source-root "/pfad/zu/Daten" --output "/pfad/zur/Ausgabe" [--app-output "public/data/municipality-investments"] [--locale de|en]');
  }
  return { sourceRoot: resolve(sourceRoot), output: resolve(output), appOutput: resolve(appOutput), locale: locale as InvestmentHtmlLocale };
}

function sourceFileMap(entries: Dirent<string>[]) {
  const files = new Map<string, SourcePair>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = FILE_PATTERN.exec(entry.name);
    if (!match) continue;
    const [, code, year, kind] = match;
    const key = `${code}/${year}`;
    const pair = files.get(key) ?? {};
    const path = resolve(entry.parentPath, entry.name);
    const property = kind === "gemeinde" ? "municipality" : "statistics";
    if (pair[property]) throw new Error(`Doppelte ${kind}-Datei für ${key}: ${pair[property]} und ${path}`);
    pair[property] = path;
    files.set(key, pair);
  }
  return files;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const index = validateMunicipalityIndex(JSON.parse(
    await readFile(resolve("public/data/municipalities-at-2026.index.json"), "utf8"),
  ) as MunicipalityIndex);
  const municipalitiesByCode = new Map(index.municipalities.map((municipality) => [municipality.municipalityCode, municipality]));
  const files = sourceFileMap(await readdir(options.sourceRoot, { recursive: true, withFileTypes: true }));
  await Promise.all([
    mkdir(resolve(options.output, "gemeinden"), { recursive: true }),
    mkdir(resolve(options.output, "data"), { recursive: true }),
    mkdir(options.appOutput, { recursive: true }),
  ]);
  const groupedByCode = new Map<string, Array<{ year: number; pair: SourcePair }>>();
  const ignoredSourcePairs: Array<{
    code: string;
    year: number;
    reason: "missing-statistics-file" | "municipality-code-not-in-current-index";
    statisticsFile: string | null;
    municipalityFile: string | null;
  }> = [];
  for (const [key, pair] of files) {
    const [code, year] = key.split("/");
    const reason = !pair.statistics ? "missing-statistics-file"
      : !municipalitiesByCode.has(code) ? "municipality-code-not-in-current-index"
        : null;
    if (reason) {
      ignoredSourcePairs.push({
        code,
        year: Number(year),
        reason,
        statisticsFile: pair.statistics ? basename(pair.statistics) : null,
        municipalityFile: pair.municipality ? basename(pair.municipality) : null,
      });
      continue;
    }
    groupedByCode.set(code, [...(groupedByCode.get(code) ?? []), { year: Number(year), pair }]);
  }
  const generatedAt = new Date().toISOString();
  const entries: MunicipalityInvestmentIndexEntry[] = [];
  const unavailableEntries: MunicipalityInvestmentUnavailableEntry[] = [];
  const warnings: Array<{ code: string; year: number; reason: string }> = [];
  const allYears = Array.from(
    { length: MUNICIPALITY_INVESTMENTS_LATEST_YEAR - MUNICIPALITY_INVESTMENTS_FIRST_YEAR + 1 },
    (_, index_) => MUNICIPALITY_INVESTMENTS_FIRST_YEAR + index_,
  );
  let processedYears = 0;
  for (const [code, sourceYears] of [...groupedByCode.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const municipality = municipalitiesByCode.get(code)!;
    const years: MunicipalityInvestmentData["years"] = [];
    const positions: MunicipalityInvestmentPosition[] = [];
    for (const { year, pair } of sourceYears.sort((left, right) => left.year - right.year)) {
      const statistics = parseMunicipalityInvestmentCsv(await readFile(pair.statistics!, "utf8"), code, year, "statistik_at");
      let { selected, detailLevel, reconciliation } = reconcileMunicipalityInvestmentSources(statistics, null);
      if (pair.municipality) {
        try {
          const municipalityDetail = parseMunicipalityInvestmentCsv(await readFile(pair.municipality, "utf8"), code, year, "gemeinde");
          ({ selected, detailLevel, reconciliation } = reconcileMunicipalityInvestmentSources(statistics, municipalityDetail));
          if (reconciliation === "mismatch-fallback") {
            warnings.push({ code, year, reason: `Gemeinde ${municipalityDetail.directInvestmentCents} Cent, Statistik Austria ${statistics.directInvestmentCents} Cent` });
          }
        } catch (error) {
          reconciliation = "mismatch-fallback";
          warnings.push({ code, year, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      positions.push(...selected.positions);
      years.push({
        year,
        directInvestmentCents: statistics.directInvestmentCents,
        investiveInflowsCents: statistics.investiveInflowsCents,
        investiveOutflowsCents: statistics.investiveOutflowsCents,
        investiveBalanceCents: statistics.investiveInflowsCents - statistics.investiveOutflowsCents,
        positionCount: selected.positions.length,
        detailLevel,
        statisticsFile: basename(pair.statistics!),
        municipalityFile: pair.municipality ? basename(pair.municipality) : null,
        reconciliation,
      });
      processedYears += 1;
      if (processedYears % 1_000 === 0) process.stdout.write(`${processedYears} Gemeindejahre verarbeitet\n`);
    }
    const availableYears = years.map(({ year }) => year);
    const availableYearSet = new Set(availableYears);
    const missingYears = allYears.filter((year) => !availableYearSet.has(year));
    if (!years.some(({ directInvestmentCents }) => directInvestmentCents !== 0)) {
      unavailableEntries.push({
        code,
        name: municipality.name,
        state: municipality.state,
        availableYears,
        missingYears,
        reason: "no-nonzero-investments",
      });
      continue;
    }
    const data: MunicipalityInvestmentData = validateMunicipalityInvestmentData({
      schemaVersion: MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
      municipality: { code, name: municipality.name, state: municipality.state },
      firstYear: MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
      latestYear: MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
      availableYears,
      generatedAt,
      unit: "cents",
      source: {
        title: "Statistik Austria via OffenerHaushalt.at",
        url: "https://www.offenerhaushalt.at/",
        definitionUrl: "https://www.bmf.gv.at/themen/budget/finanzbeziehungen-laender-gemeinden/vrv-2015.html",
      },
      years,
      positions,
    });
    const htmlFile = municipalityInvestmentHtmlFilename(code, municipality.name);
    const serialized = `${JSON.stringify(data)}\n`;
    await Promise.all([
      writeFile(resolve(options.appOutput, `${code}.json`), serialized),
      writeFile(resolve(options.output, "data", `${code}.json`), serialized),
      writeFile(resolve(options.output, "gemeinden", htmlFile), renderMunicipalityInvestmentHtml(data, options.locale)),
    ]);
    const latestAvailableYear = availableYears.at(-1)!;
    entries.push({
      code,
      name: municipality.name,
      state: municipality.state,
      availableYears,
      missingYears,
      latestAvailableYear,
      directInvestmentCents: municipalityInvestmentTotal(data),
      latestYearInvestmentCents: municipalityInvestmentTotal(data, latestAvailableYear),
      positionCount: positions.length,
      htmlFile,
      dataFile: `${code}.json`,
    });
  }
  for (const municipality of index.municipalities) {
    if (groupedByCode.has(municipality.municipalityCode)) continue;
    unavailableEntries.push({
      code: municipality.municipalityCode,
      name: municipality.name,
      state: municipality.state,
      availableYears: [],
      missingYears: allYears,
      reason: "no-statistics-files",
    });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "de-AT") || left.code.localeCompare(right.code));
  unavailableEntries.sort((left, right) => left.name.localeCompare(right.name, "de-AT") || left.code.localeCompare(right.code));
  const outputIndex: MunicipalityInvestmentIndex = {
    schemaVersion: MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
    firstYear: MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
    latestYear: MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
    generatedAt,
    municipalityCount: entries.length,
    skippedMunicipalityCount: index.count - entries.length,
    mismatchFallbackCount: warnings.length,
    municipalities: entries,
    unavailableMunicipalities: unavailableEntries,
  };
  const serializedIndex = `${JSON.stringify(outputIndex)}\n`;
  await Promise.all([
    writeFile(resolve(options.appOutput, "index.json"), serializedIndex),
    writeFile(resolve(options.output, "data", "index.json"), serializedIndex),
    writeFile(resolve(options.output, "index.html"), renderMunicipalityInvestmentIndexHtml(outputIndex, options.locale)),
    writeFile(resolve(options.output, "import-report.json"), `${JSON.stringify({
      generatedAt,
      sourceRoot: options.sourceRoot,
      sourcePairs: files.size,
      processedYears,
      ignoredSourcePairs,
      generatedMunicipalities: entries.length,
      skippedMunicipalities: index.count - entries.length,
      municipalitiesWithMissingYears: entries
        .filter(({ missingYears }) => missingYears.length > 0)
        .map(({ code, name, availableYears, missingYears }) => ({ code, name, availableYears, missingYears })),
      unavailableMunicipalities: unavailableEntries,
      warnings,
    }, null, 2)}\n`),
  ]);
  process.stdout.write(`Fertig: ${entries.length} Gemeindeseiten, ${processedYears} Gemeindejahre, ${warnings.length} Statistik-Fallbacks.\n`);
}

if (process.env.NODE_ENV !== "test") void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
