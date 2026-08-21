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
  isAssetCompatibleWithInvestmentType,
  isInvestmentAssetMvagCode,
  isInvestmentTaskAreaId,
  isInvestmentTypeId,
  municipalityInvestmentTotal,
  normalizeInvestmentDescription,
  validateMunicipalityInvestmentData,
  type InvestmentAssetMatchMethod,
  type InvestmentAssetMvagCode,
  type InvestmentDetailLevel,
  type InvestmentTaskAreaId,
  type InvestmentTypeId,
  type MunicipalityInvestmentAsset,
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

const FILE_PATTERN = /^(\d{5})_(201\d|202[0-4])_ra_(fhh|vhh)_(statistik_at|gemeinde)\.csv$/;
const REQUIRED_COLUMNS = [
  "Jahr", "Voranschlag/Rechnungsabschluss", "Datenquelle", "Gemeindekennziffer", "Haushalt",
  "Ansatz-Uab", "Ansatz-Ugl", "Konto-Grp", "Konto-Ugl", "Vorhabencode", "Mvag",
  "Ansatz-Text", "Konto-Text", "Wert",
] as const;

type SourceKind = "statistik_at" | "gemeinde";
type SourcePair = { statistics?: string; municipality?: string };
type SourceSet = { fhh: SourcePair; vhh: SourcePair };
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
      assetIds: [],
      assetMatchStatus: "unmatched" as const,
      assetMatchMethod: null,
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


const REQUIRED_ASSET_COLUMNS = [
  "Jahr", "Voranschlag/Rechnungsabschluss", "Datenquelle", "Gemeindekennziffer", "Haushalt",
  "Ansatz-Uab", "Ansatz-Ugl", "Konto-Grp", "Konto-Ugl", "Vorhabencode", "Id-Vhh", "Mvag",
  "Ansatz-Text", "Konto-Text", "Endstand-Vj", "Zugang", "Abgang", "Aenderung", "Endstand-Rj",
] as const;

type AssetClassTotal = { openingBalanceCents: number; closingBalanceCents: number };
type ParsedAssetCsv = {
  assets: MunicipalityInvestmentAsset[];
  classTotals: Map<InvestmentAssetMvagCode, AssetClassTotal>;
};

function parseOptionalEuroCents(value: string) {
  return value.trim() ? parseEuroCents(value) : 0;
}

function assetIdentity(asset: Omit<MunicipalityInvestmentAsset, "id" | "openingBalanceCents" | "additionsCents"
  | "disposalsCents" | "changesCents" | "closingBalanceCents">) {
  return [asset.year, asset.sourceAssetId, asset.mvagCode, asset.approachCode, asset.approachText,
    asset.accountCode, asset.accountText, asset.projectCode, asset.sourceFile].join("\u001f");
}

export function parseMunicipalityAssetCsv(
  source: string,
  expectedCode: string,
  expectedYear: number,
  sourceKind: SourceKind,
  sourceFile = "asset-source.csv",
): ParsedAssetCsv {
  const rows = parseSemicolonCsv(source);
  const header = rows.shift();
  if (!header) throw new Error("Leere Vermögensdatei.");
  const columns = new Map(header.map((name, index) => [name, index]));
  for (const name of REQUIRED_ASSET_COLUMNS) if (!columns.has(name)) throw new Error(`Fehlende VHH-Spalte: ${name}`);
  const valueAt = (row: string[], name: (typeof REQUIRED_ASSET_COLUMNS)[number]) => row[columns.get(name)!] ?? "";
  const expectedSource = sourceKind === "gemeinde" ? "Gemeinde" : "Statistik Austria";
  const grouped = new Map<string, {
    asset: Omit<MunicipalityInvestmentAsset, "id" | "openingBalanceCents" | "additionsCents"
      | "disposalsCents" | "changesCents" | "closingBalanceCents">;
    openingBalanceCents: number;
    additionsCents: number;
    disposalsCents: number;
    changesCents: number;
    closingBalanceCents: number;
  }>();
  const classTotals = new Map<InvestmentAssetMvagCode, AssetClassTotal>();
  for (const row of rows) {
    if (
      valueAt(row, "Jahr") !== String(expectedYear)
      || valueAt(row, "Gemeindekennziffer") !== expectedCode
      || valueAt(row, "Voranschlag/Rechnungsabschluss") !== "Rechnungsabschluss"
      || valueAt(row, "Datenquelle").replaceAll('"', "") !== expectedSource
      || valueAt(row, "Haushalt") !== "Vermögenshaushalt"
    ) throw new Error(`Unerwartete VHH-Metadaten in ${expectedCode}/${expectedYear}/${sourceKind}.`);
    const mvagCode = valueAt(row, "Mvag").trim();
    if (!isInvestmentAssetMvagCode(mvagCode)) continue;
    const openingBalanceCents = parseOptionalEuroCents(valueAt(row, "Endstand-Vj"));
    const additionsCents = parseOptionalEuroCents(valueAt(row, "Zugang"));
    const disposalsCents = parseOptionalEuroCents(valueAt(row, "Abgang"));
    const changesCents = parseOptionalEuroCents(valueAt(row, "Aenderung"));
    const closingBalanceCents = parseOptionalEuroCents(valueAt(row, "Endstand-Rj"));
    const previous = classTotals.get(mvagCode) ?? { openingBalanceCents: 0, closingBalanceCents: 0 };
    classTotals.set(mvagCode, {
      openingBalanceCents: previous.openingBalanceCents + openingBalanceCents,
      closingBalanceCents: previous.closingBalanceCents + closingBalanceCents,
    });
    if (sourceKind !== "gemeinde" || additionsCents === 0) continue;
    const approachText = valueAt(row, "Ansatz-Text").trim();
    const accountText = valueAt(row, "Konto-Text").trim();
    if (/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/i.test(`${approachText} ${accountText}`)) {
      throw new Error(`IBAN in freigegebener VHH-Klasse ${mvagCode}.`);
    }
    const approachUab = valueAt(row, "Ansatz-Uab").padStart(3, "0");
    const approachUgl = valueAt(row, "Ansatz-Ugl").padStart(3, "0");
    const sourceAssetId = valueAt(row, "Id-Vhh").trim() || "ohne-anlagen-id";
    const asset = {
      sourceAssetId,
      year: expectedYear,
      mvagCode,
      approachCode: `${approachUab}.${approachUgl}`,
      approachText,
      accountCode: `${valueAt(row, "Konto-Grp").padStart(3, "0")}.${valueAt(row, "Konto-Ugl").padStart(3, "0")}`,
      accountText,
      projectCode: valueAt(row, "Vorhabencode").trim() || "0000000",
      normalizedDescription: normalizeInvestmentDescription(`${approachText} ${accountText}`),
      sourceFile,
    };
    const identity = assetIdentity(asset);
    const existing = grouped.get(identity);
    grouped.set(identity, {
      asset,
      openingBalanceCents: (existing?.openingBalanceCents ?? 0) + openingBalanceCents,
      additionsCents: (existing?.additionsCents ?? 0) + additionsCents,
      disposalsCents: (existing?.disposalsCents ?? 0) + disposalsCents,
      changesCents: (existing?.changesCents ?? 0) + changesCents,
      closingBalanceCents: (existing?.closingBalanceCents ?? 0) + closingBalanceCents,
    });
  }
  const assets = [...grouped.entries()].map(([identity, values]) => ({
    id: createHash("sha256").update(`${expectedCode}\u001fasset\u001f${identity}`).digest("hex").slice(0, 20),
    ...values.asset,
    openingBalanceCents: values.openingBalanceCents,
    additionsCents: values.additionsCents,
    disposalsCents: values.disposalsCents,
    changesCents: values.changesCents,
    closingBalanceCents: values.closingBalanceCents,
  })).sort((left, right) => left.mvagCode.localeCompare(right.mvagCode)
    || left.approachCode.localeCompare(right.approachCode)
    || left.sourceAssetId.localeCompare(right.sourceAssetId));
  return { assets, classTotals };
}

export function reconcileMunicipalityAssetSources(
  statistics: ParsedAssetCsv,
  municipality: ParsedAssetCsv | null,
) {
  if (municipality) {
    const codes = new Set([...statistics.classTotals.keys(), ...municipality.classTotals.keys()]);
    const matched = [...codes].every((code) => {
      const statisticsTotal = statistics.classTotals.get(code) ?? { openingBalanceCents: 0, closingBalanceCents: 0 };
      const municipalityTotal = municipality.classTotals.get(code) ?? { openingBalanceCents: 0, closingBalanceCents: 0 };
      return statisticsTotal.openingBalanceCents === municipalityTotal.openingBalanceCents
        && statisticsTotal.closingBalanceCents === municipalityTotal.closingBalanceCents;
    });
    if (matched) return { assets: municipality.assets, reconciliation: "matched" as const };
    return { assets: [], reconciliation: "mismatch-fallback" as const };
  }
  return { assets: [], reconciliation: "statistics-only" as const };
}

function meaningfulTokens(value: string) {
  return new Set(value.split(" ").filter((token) => token.length >= 4 && !/^\d+$/.test(token)));
}

function descriptionsRelated(position: MunicipalityInvestmentPosition, asset: MunicipalityInvestmentAsset) {
  if (position.projectCode !== "0000000" && position.projectCode === asset.projectCode) return true;
  const left = meaningfulTokens(position.normalizedDescription);
  const right = meaningfulTokens(asset.normalizedDescription);
  const shared = [...left].filter((token) => right.has(token));
  return shared.length >= 2 || shared.some((token) => token.length >= 8);
}

function uniqueCombination<T>(
  values: T[],
  targetCents: number,
  amountCents: (value: T) => number,
  minimum = 2,
  maximum = 4,
) {
  // A very broad candidate set cannot be resolved confidently and makes an
  // exhaustive subset search disproportionately expensive. Leave it ambiguous
  // instead of guessing or blocking the complete municipal import.
  if (values.length > 32) return { match: null as T[] | null, ambiguous: true };

  let match: T[] | null = null;
  let ambiguous = false;
  function visit(start: number, chosen: T[], sumCents: number) {
    if (ambiguous) return;
    if (chosen.length >= minimum && sumCents === targetCents) {
      if (match) {
        ambiguous = true;
        return;
      }
      match = [...chosen];
    }
    if (chosen.length === maximum) return;
    for (let index = start; index < values.length; index += 1) {
      chosen.push(values[index]);
      visit(index + 1, chosen, sumCents + amountCents(values[index]));
      chosen.pop();
      if (ambiguous) return;
    }
  }
  visit(0, [], 0);
  return { match: ambiguous ? null : match, ambiguous };
}

export function matchInvestmentAssets(
  positions: MunicipalityInvestmentPosition[],
  assets: MunicipalityInvestmentAsset[],
) {
  const result = positions.map((position) => ({
    ...position,
    assetIds: [] as string[],
    assetMatchStatus: "unmatched" as "unmatched" | "matched" | "ambiguous",
    assetMatchMethod: null as InvestmentAssetMatchMethod | null,
  }));
  const usedPositions = new Set<string>();
  const usedAssets = new Set<string>();

  function link(positionGroup: MunicipalityInvestmentPosition[], assetGroup: MunicipalityInvestmentAsset[], method: InvestmentAssetMatchMethod) {
    const positionTotal = positionGroup.reduce((sum, position) => sum + position.amountCents, 0);
    const assetTotal = assetGroup.reduce((sum, asset) => sum + asset.additionsCents, 0);
    if (positionTotal !== assetTotal) throw new Error("Nicht centgenauer Vermögensabgleich.");
    for (const position of positionGroup) {
      const target = result.find((entry) => entry.id === position.id)!;
      target.assetIds = assetGroup.map((asset) => asset.id);
      target.assetMatchStatus = "matched";
      target.assetMatchMethod = method;
      usedPositions.add(position.id);
    }
    for (const asset of assetGroup) usedAssets.add(asset.id);
  }

  const oneToOneMethods: InvestmentAssetMatchMethod[] = ["project-code", "exact-description"];
  for (const method of oneToOneMethods) {
    for (const position of result.filter((entry) => !usedPositions.has(entry.id))) {
      const candidates = assets.filter((asset) => !usedAssets.has(asset.id)
        && asset.year === position.year
        && asset.additionsCents === position.amountCents
        && (method !== "project-code" || isAssetCompatibleWithInvestmentType(asset.mvagCode, position.investmentType))
        && (method === "project-code"
          ? position.projectCode !== "0000000" && position.projectCode === asset.projectCode
          : descriptionsRelated(position, asset)));
      if (candidates.length === 1) link([position], candidates, method);
      else if (candidates.length > 1) position.assetMatchStatus = "ambiguous";
    }
  }

  for (const position of result.filter((entry) => !usedPositions.has(entry.id))) {
    const candidates = assets.filter((asset) => !usedAssets.has(asset.id)
      && asset.year === position.year
      && descriptionsRelated(position, asset));
    const matchingGroup = uniqueCombination(
      candidates,
      position.amountCents,
      (asset) => asset.additionsCents,
    );
    if (matchingGroup.match) link([position], matchingGroup.match, "group-sum");
    else if (matchingGroup.ambiguous) position.assetMatchStatus = "ambiguous";
  }

  for (const asset of assets.filter((entry) => !usedAssets.has(entry.id))) {
    const candidates = result.filter((position) => !usedPositions.has(position.id)
      && position.year === asset.year
      && descriptionsRelated(position, asset));
    const matchingGroup = uniqueCombination(
      candidates,
      asset.additionsCents,
      (position) => position.amountCents,
    );
    if (matchingGroup.match) link(matchingGroup.match, [asset], "group-sum");
    else if (matchingGroup.ambiguous) {
      for (const position of candidates) position.assetMatchStatus = "ambiguous";
    }
  }

  for (const position of result.filter((entry) => !usedPositions.has(entry.id))) {
    const candidates = assets.filter((asset) => !usedAssets.has(asset.id)
      && asset.year === position.year
      && asset.additionsCents === position.amountCents
      && isAssetCompatibleWithInvestmentType(asset.mvagCode, position.investmentType));
    const reciprocal = candidates.filter((asset) => result.filter((other) => !usedPositions.has(other.id)
      && other.year === asset.year
      && other.amountCents === asset.additionsCents
      && isAssetCompatibleWithInvestmentType(asset.mvagCode, other.investmentType)).length === 1);
    if (reciprocal.length === 1) link([position], reciprocal, "exact-amount");
    else if (candidates.length > 1) position.assetMatchStatus = "ambiguous";
  }
  return result;
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
  const files = new Map<string, SourceSet>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = FILE_PATTERN.exec(entry.name);
    if (!match) continue;
    const [, code, year, household, kind] = match;
    const key = `${code}/${year}`;
    const set = files.get(key) ?? { fhh: {}, vhh: {} };
    const pair = household === "fhh" ? set.fhh : set.vhh;
    const path = resolve(entry.parentPath, entry.name);
    const property = kind === "gemeinde" ? "municipality" : "statistics";
    if (pair[property]) throw new Error(`Doppelte ${household}/${kind}-Datei für ${key}: ${pair[property]} und ${path}`);
    pair[property] = path;
    files.set(key, set);
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
  const groupedByCode = new Map<string, Array<{ year: number; sources: SourceSet }>>();
  const ignoredSourcePairs: Array<{
    code: string;
    year: number;
    reason: "missing-statistics-file" | "municipality-code-not-in-current-index";
    statisticsFile: string | null;
    municipalityFile: string | null;
  }> = [];
  for (const [key, sources] of files) {
    const [code, year] = key.split("/");
    const reason = !sources.fhh.statistics ? "missing-statistics-file"
      : !municipalitiesByCode.has(code) ? "municipality-code-not-in-current-index"
        : null;
    if (reason) {
      ignoredSourcePairs.push({
        code,
        year: Number(year),
        reason,
        statisticsFile: sources.fhh.statistics ? basename(sources.fhh.statistics) : null,
        municipalityFile: sources.fhh.municipality ? basename(sources.fhh.municipality) : null,
      });
      continue;
    }
    groupedByCode.set(code, [...(groupedByCode.get(code) ?? []), { year: Number(year), sources }]);
  }
  const generatedAt = new Date().toISOString();
  const entries: MunicipalityInvestmentIndexEntry[] = [];
  const unavailableEntries: MunicipalityInvestmentUnavailableEntry[] = [];
  const warnings: Array<{ code: string; year: number; reason: string }> = [];
  const assetWarnings: Array<{ code: string; year: number; reason: string }> = [];
  const allYears = Array.from(
    { length: MUNICIPALITY_INVESTMENTS_LATEST_YEAR - MUNICIPALITY_INVESTMENTS_FIRST_YEAR + 1 },
    (_, index_) => MUNICIPALITY_INVESTMENTS_FIRST_YEAR + index_,
  );
  let processedYears = 0;
  let matchedAssetPositions = 0;
  let ambiguousAssetPositions = 0;
  for (const [code, sourceYears] of [...groupedByCode.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const municipality = municipalitiesByCode.get(code)!;
    const years: MunicipalityInvestmentData["years"] = [];
    const positions: MunicipalityInvestmentPosition[] = [];
    const assets: MunicipalityInvestmentAsset[] = [];
    for (const { year, sources } of sourceYears.sort((left, right) => left.year - right.year)) {
      const pair = sources.fhh;
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
      let selectedAssets: MunicipalityInvestmentAsset[] = [];
      let assetReconciliation: MunicipalityInvestmentData["years"][number]["assetReconciliation"] = "unavailable";
      if (sources.vhh.statistics) {
        try {
          const assetStatistics = parseMunicipalityAssetCsv(
            await readFile(sources.vhh.statistics, "utf8"), code, year, "statistik_at", basename(sources.vhh.statistics),
          );
          let assetMunicipality: ParsedAssetCsv | null = null;
          if (sources.vhh.municipality) {
            assetMunicipality = parseMunicipalityAssetCsv(
              await readFile(sources.vhh.municipality, "utf8"), code, year, "gemeinde", basename(sources.vhh.municipality),
            );
          }
          ({ assets: selectedAssets, reconciliation: assetReconciliation } =
            reconcileMunicipalityAssetSources(assetStatistics, assetMunicipality));
          if (assetReconciliation === "mismatch-fallback") {
            assetWarnings.push({ code, year, reason: "VHH-Endstände stimmen nicht centgenau überein" });
          }
        } catch (error) {
          assetReconciliation = "mismatch-fallback";
          assetWarnings.push({ code, year, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      const matchedPositions = selectedAssets.length ? matchInvestmentAssets(selected.positions, selectedAssets) : selected.positions;
      matchedAssetPositions += matchedPositions.filter(({ assetMatchStatus }) => assetMatchStatus === "matched").length;
      ambiguousAssetPositions += matchedPositions.filter(({ assetMatchStatus }) => assetMatchStatus === "ambiguous").length;
      positions.push(...matchedPositions);
      assets.push(...selectedAssets);
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
        assetDetailLevel: assetReconciliation === "matched" ? "municipality" : "unavailable",
        assetStatisticsFile: sources.vhh.statistics ? basename(sources.vhh.statistics) : null,
        assetMunicipalityFile: sources.vhh.municipality ? basename(sources.vhh.municipality) : null,
        assetReconciliation,
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
      assets,
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
      yearTotals: years.map(({ year, directInvestmentCents, positionCount }) => ({ year, directInvestmentCents, positionCount })),
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
      assetWarnings,
      matchedAssetPositions,
      ambiguousAssetPositions,
    }, null, 2)}\n`),
  ]);
  process.stdout.write(`Fertig: ${entries.length} Gemeindeseiten, ${processedYears} Gemeindejahre, ${warnings.length} Statistik-Fallbacks, ${assetWarnings.length} VHH-Warnungen.\n`);
}

if (process.env.NODE_ENV !== "test") void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
