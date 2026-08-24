import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { canonicalPartyForList, type CanonicalPartyId, type MunicipalityElectionEvent, type PoliticsSource } from "../src/modules/municipalities/politics";

const RETRIEVED_AT = "2026-08-24";
const execFileAsync = promisify(execFile);
type ImportedEvent = { municipalityCode: string; event: MunicipalityElectionEvent };
type ImportedCurrent = { municipalityCode: string; mayor: { name: string; party: CanonicalPartyId | null; listName: string | null }; mayorAsOf: string; mayorSourceIds: string[] };
export type OfficialPoliticsImport = { sources: PoliticsSource[]; events: ImportedEvent[]; current?: ImportedCurrent[] };

async function cachedDownload(cache: string, name: string, url: string) {
  await mkdir(cache, { recursive: true });
  const path = join(cache, name);
  try { return await readFile(path); } catch { /* download below */ }
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "management-platform municipality politics importer" }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(path, bytes);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}
function source(id: string, title: string, url: string, bytes: Uint8Array, referenceDate?: string): PoliticsSource {
  return { id, title, url, retrievedAt: RETRIEVED_AT, referenceDate, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function partyFromOfficialAttribution(value: unknown, fallback: string): CanonicalPartyId {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized.includes("ÖVP") || normalized === "1") return "oevp";
  if (normalized.includes("SPÖ") || normalized === "2") return "spoe";
  if (normalized.includes("FPÖ") || normalized === "3") return "fpoe";
  if (normalized.includes("GRÜN") || normalized === "12") return "gruene";
  if (normalized.includes("NEOS") || normalized === "56") return "neos";
  if (normalized.includes("KPÖ") || normalized === "4") return "kpoe";
  if (normalized.includes("MFG")) return "mfg";
  return canonicalPartyForList(fallback);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NOE_CYCLES = [
  { year: 2000, date: "2000-03-19" }, { year: 2005, date: "2005-03-06" },
  { year: 2010, date: "2010-03-14" }, { year: 2015, date: "2015-01-25" },
  { year: 2020, date: "2020-01-26" }, { year: 2025, date: "2025-01-26" },
] as const;
function decodeWindows1252(bytes: Uint8Array) { return new TextDecoder("windows-1252").decode(bytes); }
function parseNoeParties(text: string) {
  const parties = new Map<string, { name: string; attribution: string }>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.{1,12}?)\s{2,}(.+?)\s*$/.exec(line);
    if (match) parties.set(match[1].padStart(4, "0"), { attribution: match[2], name: `${match[3].trim()} – ${match[4].trim()}` });
  }
  return parties;
}
function parseNoeResults(text: string, parties: Map<string, { name: string; attribution: string }>, date: string, sourceId: string, targetCodes: Set<string>) {
  const events: ImportedEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    const code = fields[0];
    if (!targetCodes.has(code) || fields.length < 7) continue;
    const eligibleVoters = Number(fields[1]); const ballotsCast = Number(fields[2]); const validVotes = Number(fields[3]);
    if (![eligibleVoters, ballotsCast, validVotes].every(Number.isSafeInteger)) continue;
    const lists = [];
    for (let index = 4; index + 2 < fields.length; index += 3) {
      const partyNumber = fields[index]; const votes = Number(fields[index + 1]); const mandates = Number(fields[index + 2]);
      if (partyNumber === "0000" || !votes) continue;
      const metadata = parties.get(partyNumber) ?? { name: `Liste ${partyNumber}`, attribution: "0" };
      lists.push({ name: metadata.name, party: partyFromOfficialAttribution(metadata.attribution, metadata.name), votes, mandates });
    }
    const event: MunicipalityElectionEvent = {
      id: `${code}-${date}`, date, eligibleVoters, ballotsCast, validVotes, invalidVotes: ballotsCast - validVotes,
      councilSize: lists.reduce((sum, list) => sum + list.mandates, 0), lists, mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [sourceId], missingReasons: { mayorCandidates: "not-applicable" },
    };
    events.push({ municipalityCode: code, event });
  }
  return events;
}
async function importNoe(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const sources: PoliticsSource[] = []; const events: ImportedEvent[] = [];
  for (const cycle of NOE_CYCLES) {
    const suffix = String(cycle.year).slice(-2);
    const resultUrl = `https://www.noe.gv.at/wahlen/gr${suffix}.txt`;
    const partyUrl = `https://www.noe.gv.at/wahlen/part_gr${suffix}.txt`;
    const resultBytes = await cachedDownload(cache, `noe-gr${suffix}.txt`, resultUrl);
    const partyBytes = await cachedDownload(cache, `noe-part-gr${suffix}.txt`, partyUrl).catch(() => Buffer.alloc(0));
    const id = `noe-gr-${cycle.year}`;
    sources.push(source(id, `Land Niederösterreich – Gemeinderatswahl ${cycle.year}`, resultUrl, resultBytes, cycle.date));
    events.push(...parseNoeResults(decodeWindows1252(resultBytes), parseNoeParties(decodeWindows1252(partyBytes)), cycle.date, id, targetCodes));
  }
  return { sources, events };
}

type OoeResult = { gebietsname: string; wahlberechtigt: number; abgegeben: number; ungueltig: number; gueltig: number; Wahlmoeglichkeiten: Record<string, { Kurztext: string; Langtext: string }>; Mandate: Record<string, number> & { MandatGesamtanzahl: number }; [key: string]: unknown };
const OOE_CYCLES = [
  { year: 2003, date: "2003-09-28" }, { year: 2009, date: "2009-09-27" },
  { year: 2015, date: "2015-09-27" }, { year: 2021, date: "2021-09-26" },
] as const;
function parseOoeWorkbook(bytes: Uint8Array, date: string, id: string, targetCodes: Set<string>): ImportedEvent[] {
  const workbook = XLSX.read(bytes, { type: "array" });
  const voteRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Stimmen, { header: 1, defval: null });
  const mandateRows = workbook.Sheets.Mandate ? XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Mandate, { header: 1, defval: null }) : [];
  const partyNames = (voteRows[2] ?? []).slice(9).filter((_, index) => index % 2 === 0).map(String);
  const mandateByCode = new Map<string, unknown[]>();
  for (const row of mandateRows.slice(4)) mandateByCode.set(String(row[0] ?? "").padStart(5, "0"), row);
  const events: ImportedEvent[] = [];
  for (const row of voteRows.slice(4)) {
    const code = String(row[0] ?? "").padStart(5, "0"); if (!targetCodes.has(code)) continue;
    const eligibleVoters = Number(row[2]); const ballotsCast = Number(row[3]); const invalidVotes = Number(row[5]); const validVotes = Number(row[7]);
    const mandateRow = mandateByCode.get(code); const lists = partyNames.flatMap((name, index) => {
      const votes = Number(row[9 + index * 2]); if (!Number.isSafeInteger(votes) || votes === 0) return [];
      const mandates = mandateRow ? Number(mandateRow[3 + index]) : null;
      return [{ name, party: canonicalPartyForList(name), votes, mandates: Number.isSafeInteger(mandates) ? mandates : null }];
    });
    const councilSize = mandateRow && Number.isSafeInteger(Number(mandateRow[2])) ? Number(mandateRow[2]) : null;
    const missingReasons: MunicipalityElectionEvent["missingReasons"] = { mayorCandidates: "not-structured-in-source" }; if (councilSize === null) missingReasons.councilSize = "not-structured-in-source";
    events.push({ municipalityCode: code, event: { id: code + "-" + date, date, eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists, mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [id], missingReasons } });
  }
  return events;
}
async function importOoe(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const sources: PoliticsSource[] = []; const events: ImportedEvent[] = [];
  for (const cycle of OOE_CYCLES) {
    const suffix = String(cycle.year).slice(-2);
    const url = `https://www.land-oberoesterreich.gv.at/Mediendateien/Formulare/Dokumente%20PraesD%20Abt_TI/gr${suffix}.zip`;
    const bytes = await cachedDownload(cache, `ooe-gr${suffix}.zip`, url);
    const files = unzipSync(bytes); const jsonName = Object.keys(files).find((name) => /stat_download_gw\d+\.json$/i.test(name));
    const id = `ooe-gr-${cycle.year}`; sources.push(source(id, `Land Oberösterreich – Gemeinderatswahl ${cycle.year}`, url, bytes, cycle.date));
    if (!jsonName) { const workbookName = Object.keys(files).find((name) => /stat_download_gw\d+\.(xls|xlw)$/i.test(name)); if (!workbookName) throw new Error(`OÖ ${cycle.year}: Ergebnisdatei fehlt im ZIP.`); events.push(...parseOoeWorkbook(files[workbookName], cycle.date, id, targetCodes)); continue; }
    const parsed = JSON.parse(new TextDecoder().decode(files[jsonName])) as { Ergebnisdaten: Record<string, OoeResult> };
    for (const [code, result] of Object.entries(parsed.Ergebnisdaten)) {
      if (!targetCodes.has(code)) continue;
      const lists = Object.entries(result.Wahlmoeglichkeiten).flatMap(([key, metadata]) => {
        const votes = Number(result[key]); if (!Number.isSafeInteger(votes)) return [];
        const mandates = Number(result.Mandate?.[key] ?? 0);
        return [{ name: metadata.Langtext || metadata.Kurztext, party: canonicalPartyForList(metadata.Kurztext), votes, mandates }];
      });
      events.push({ municipalityCode: code, event: { id: `${code}-${cycle.date}`, date: cycle.date, eligibleVoters: result.wahlberechtigt, ballotsCast: result.abgegeben, validVotes: result.gueltig, invalidVotes: result.ungueltig, councilSize: result.Mandate.MandatGesamtanzahl, lists, mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [id], missingReasons: { mayorCandidates: "not-structured-in-source" } } });
    }
  }
  return { sources, events };
}

const STYRIA_DATES: Record<string, string> = { "GRW_2000": "2000-03-12", "GRW_2005": "2005-03-13", "GRW_2010": "2010-03-21", "GRW_2015": "2015-03-22", "GRW_2020": "2020-06-28", "GRW_2025": "2025-03-23" };
function numberField(row: Record<string, unknown>, prefix: string) { const entry = Object.entries(row).find(([key]) => key.startsWith(prefix)); const value = Number(entry?.[1]); return Number.isSafeInteger(value) ? value : null; }
async function importStyria(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const url = "https://www.verwaltung.steiermark.at/cms/dokumente/11684059_180951870/e7aca598/Stimmenprotokolle_GRW.xlsx";
  const bytes = await cachedDownload(cache, "styria-council-elections.xlsx", url); const id = "styria-gr-2000-2025";
  const workbook = XLSX.read(bytes, { type: "buffer" }); const events: ImportedEvent[] = [];
  for (const [sheetName, date] of Object.entries(STYRIA_DATES)) {
    const sheet = workbook.Sheets[sheetName]; if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) { const code = String(row.GEMNR ?? "").padStart(5, "0"); if (!targetCodes.has(code)) continue; const group = groups.get(code) ?? []; group.push(row); groups.set(code, group); }
    for (const [code, group] of groups) {
      const first = group[0]; const eligibleVoters = numberField(first, "WAHLBE_"); const ballotsCast = numberField(first, "GES_"); const validVotes = numberField(first, "GUEL_"); const publishedInvalid = numberField(first, "UNGUEL_");
      const invalidVotes = publishedInvalid ?? (ballotsCast !== null && validVotes !== null ? ballotsCast - validVotes : null);
      const lists = group.map((row) => { const name = String(row.PARTEI ?? "Liste"); return { name, party: partyFromOfficialAttribution(row.PARTEI_ZU, name), votes: numberField(row, "STIMMEN_") ?? 0, mandates: numberField(row, "MAND_") }; });
      const councilSize = lists.every((list) => list.mandates !== null) ? lists.reduce((sum, list) => sum + (list.mandates ?? 0), 0) : null;
      const missingReasons: MunicipalityElectionEvent["missingReasons"] = { mayorCandidates: "not-structured-in-source" };
      if (eligibleVoters === null) missingReasons.eligibleVoters = "not-structured-in-source"; if (ballotsCast === null) missingReasons.ballotsCast = "not-structured-in-source"; if (validVotes === null) missingReasons.validVotes = "not-structured-in-source"; if (invalidVotes === null) missingReasons.invalidVotes = "not-structured-in-source"; if (councilSize === null) missingReasons.councilSize = "not-structured-in-source";
      events.push({ municipalityCode: code, event: { id: `${code}-${date}`, date, eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists, mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [id], missingReasons } });
    }
  }
  return { sources: [source(id, "Land Steiermark – Stimmenprotokolle Gemeinderatswahlen 2000–2025", url, bytes, "2025-03-23")], events };
}

type SalzburgResult = { region_id: number; daten_akt: Array<Array<number | null>>; pdaten_akt: Array<Array<number | null>> };
type SalzburgElection = { stimmen: SalzburgResult[]; mandate: SalzburgResult[]; parteien: Array<{ region_id: number; akt: string[][] }> };
const SALZBURG_CYCLES = [{ year: 2009, date: "2009-03-01" }, { year: 2014, date: "2014-03-09" }, { year: 2019, date: "2019-03-10" }, { year: 2024, date: "2024-03-10" }] as const;
async function importSalzburg(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const configUrl = "https://www.salzburg.gv.at/stat/wahlen/ltw/tools/wahldaten.js";
  const configBytes = await cachedDownload(cache, "salzburg-wahldaten.js", configUrl); const config = new TextDecoder().decode(configBytes);
  const codeByRegion = new Map<number, string>();
  for (const match of config.matchAll(/\{\s*ID:\s*(\d+),\s*GKZ:\s*"(\d{5})",[^{}]*?typID:\s*4,/g)) codeByRegion.set(Number(match[1]), match[2]);
  const sources: PoliticsSource[] = []; const events: ImportedEvent[] = [];
  for (const cycle of SALZBURG_CYCLES) {
    const url = `https://www.salzburg.gv.at/stat/wahlen/gvw/GVW${cycle.year}.js`; const bytes = await cachedDownload(cache, `salzburg-gvw-${cycle.year}.json`, url);
    const parsed = JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, "")) as SalzburgElection; const id = `salzburg-gvw-${cycle.year}`;
    sources.push(source(id, `Land Salzburg – Gemeindevertretungswahl ${cycle.year}`, url, bytes, cycle.date));
    const mandateByRegion = new Map(parsed.mandate.map((item) => [item.region_id, item])); const partiesByRegion = new Map(parsed.parteien.map((item) => [item.region_id, item.akt[0]]));
    for (const result of parsed.stimmen) {
      const code = codeByRegion.get(result.region_id); if (!code || !targetCodes.has(code)) continue;
      const totals = result.daten_akt[0]; const partyVotes = result.pdaten_akt[0]; const names = partiesByRegion.get(result.region_id) ?? []; const mandate = mandateByRegion.get(result.region_id);
      const lists = names.flatMap((name, index) => { const votes = Number(partyVotes[index]); if (!name || !Number.isSafeInteger(votes)) return []; const seats = Number(mandate?.pdaten_akt[0]?.[index]); return [{ name, party: canonicalPartyForList(name), votes, mandates: Number.isSafeInteger(seats) ? seats : 0 }]; });
      const eligibleVoters = Number(totals[0]); const ballotsCast = Number(totals[2]); const invalidVotes = Number(totals[3]); const validVotes = Number(totals[4]); const councilSize = Number(mandate?.daten_akt[0]?.[0]);
      events.push({ municipalityCode: code, event: { id: code + "-" + cycle.date, date: cycle.date, eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists, mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [id], missingReasons: { mayorCandidates: "not-structured-in-source" } } });
    }
  }
  return { sources, events };
}

type GemeindebundMayorRow = { a2: number | string; a7: string; a8: string };
async function importGemeindebundMayors(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const url = "https://g-cdn.23degrees.io/FLiqNPPC0ctBDhHl-choro-buergermeister-innenkarte/data/id/6a730acd66c6152747eed51f.json";
  const bytes = await cachedDownload(cache, "gemeindebund-mayors-2026.json", url);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { data: GemeindebundMayorRow[] };
  const id = "gemeindebund-mayors-2026";
  const current = parsed.data.flatMap((row) => {
    const municipalityCode = String(row.a2).padStart(5, "0");
    const name = `${String(row.a7 ?? "").trim()} ${String(row.a8 ?? "").trim()}`.trim();
    if (!targetCodes.has(municipalityCode) || !name) return [];
    return [{ municipalityCode, mayor: { name, party: null, listName: null }, mayorAsOf: "2026-01", mayorSourceIds: [id] }];
  });
  if (current.length !== targetCodes.size || new Set(current.map(({ municipalityCode }) => municipalityCode)).size !== targetCodes.size) {
    throw new Error(`Gemeindebund: Erwartet wurden ${targetCodes.size} eindeutige Gemeinden, gefunden wurden ${current.length}.`);
  }
  return {
    sources: [source(id, "Österreichischer Gemeindebund – Bürgermeister:innenkarte (Jänner 2026)", url, bytes, "2026-01")],
    events: [],
    current,
  };
}

async function importBurgenland2022(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const date = "2022-10-23";
  const url = "https://wahl.bgld.gv.at/wahlen/gr20221023.nsf/vwDownloads/CCB87F32CDE219CCC12575690032C719/$FILE/gr221002_erg-20221103-162349.csv?OpenElement";
  const bytes = await cachedDownload(cache, "burgenland-gr-2022.csv", url);
  const id = "burgenland-gr-2022";
  const events: ImportedEvent[] = [];
  for (const line of decodeWindows1252(bytes).split(/\r?\n/)) {
    const fields = line.split(";").map((value) => value.trim());
    const code = fields[1] ?? "";
    if (fields[2] !== "G" || !targetCodes.has(code) || fields[5] !== "G2022") continue;
    const mayorIndex = fields.indexOf("M2022", 10);
    if (mayorIndex === -1) continue;
    const eligibleVoters = publishedInteger(fields[6] ?? "");
    const ballotsCast = publishedInteger(fields[7] ?? "");
    const validVotes = publishedInteger(fields[8] ?? "");
    const invalidVotes = publishedInteger(fields[9] ?? "");
    const lists = [];
    for (let index = 10; index + 4 < mayorIndex; index += 5) {
      const name = fields[index] ?? "";
      const votes = publishedInteger(fields[index + 2] ?? "");
      const mandates = publishedInteger(fields[index + 4] ?? "") ?? 0;
      if (!name || votes === null) continue;
      lists.push({ name, party: canonicalPartyForList(name), votes, mandates });
    }
    const mayorValidVotes = publishedInteger(fields[mayorIndex + 3] ?? "");
    const mayorCandidates = [];
    for (let index = mayorIndex + 5; index + 4 < fields.length; index += 5) {
      const listName = fields[index] ?? "";
      const name = fields[index + 2] ?? "";
      const votes = publishedInteger(fields[index + 3] ?? "");
      if (!name || votes === null) continue;
      mayorCandidates.push({ name, party: canonicalPartyForList(listName), listName: listName || null, round: 1 as const, votes, elected: mayorValidVotes !== null && votes * 2 > mayorValidVotes });
    }
    const councilSize = lists.reduce((sum, list) => sum + list.mandates, 0);
    const missingReasons: MunicipalityElectionEvent["missingReasons"] = {};
    if (eligibleVoters === null) missingReasons.eligibleVoters = "not-structured-in-source";
    if (ballotsCast === null) missingReasons.ballotsCast = "not-structured-in-source";
    if (validVotes === null) missingReasons.validVotes = "not-structured-in-source";
    if (invalidVotes === null) missingReasons.invalidVotes = "not-structured-in-source";
    if (!mayorCandidates.length) missingReasons.mayorCandidates = "not-structured-in-source";
    events.push({ municipalityCode: code, event: { id: `${code}-${date}`, date, eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists, mayorCandidates, aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [id], missingReasons } });
  }
  return { sources: [source(id, "Land Burgenland – Gemeinderats- und Bürgermeisterwahl 2022, CSV-Landesergebnis", url, bytes, date)], events };
}

function kaerntenField(block: string, label: string) {
  const match = new RegExp(`^\\s*${escapeRegExp(label)}\\s+([\\d.]+)`, "m").exec(block);
  return match ? publishedInteger(match[1]) : null;
}

export function parseKaernten2021Text(text: string, sourceId: string, targetCodes: Set<string>): ImportedEvent[] {
  const date = "2021-02-28";
  const events: ImportedEvent[] = [];
  for (const match of text.matchAll(/\f\s*Gemeinde:\s*([^\n]+)\n\s*(\d{5})\s*\n([\s\S]*?)(?=\f)/g)) {
    const code = match[2];
    if (!targetCodes.has(code) || !/GEMEINDERATSWAHL/.test(match[3])) continue;
    const councilBlock = match[3].split(/BÜRGERMEISTERWAHL/)[0];
    const eligibleVoters = kaerntenField(councilBlock, "Wahlberechtigte");
    const ballotsCast = kaerntenField(councilBlock, "abgegebene Stimmen");
    const invalidVotes = kaerntenField(councilBlock, "ungültige Stimmen");
    const validVotes = kaerntenField(councilBlock, "gültige Stimmen");
    const councilSize = kaerntenField(councilBlock, "Mandate insgesamt");
    const resultBlock = councilBlock.split(/Stimmenergebnisse/)[1] ?? "";
    const lists = resultBlock.split(/\r?\n/).flatMap((line) => {
      const row = /^ {0,3}(\S.*?\S|\S)\s{2,}([\d.]+)\s+(\d+,\d)\s+(-|\d+)(?:\s|$)/.exec(line);
      if (!row) return [];
      const votes = publishedInteger(row[2]);
      if (line.indexOf(row[2], row[1].length) > 60) return [];
      const mandates = row[4] === "-" ? 0 : Number(row[4]);
      if (votes === null || !Number.isSafeInteger(mandates)) return [];
      const name = row[1].trim();
      return [{ name, party: canonicalPartyForList(name), votes, mandates }];
    });
    if ([eligibleVoters, ballotsCast, invalidVotes, validVotes, councilSize].some((value) => value === null) || !lists.length) {
      throw new Error(`Kärnten 2021: Gemeindetabelle ${code} (${match[1].trim()}) ist unvollständig.`);
    }
    events.push({
      municipalityCode: code,
      event: {
        id: `${code}-${date}`, date, eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists,
        mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [sourceId],
        missingReasons: { mayorCandidates: "not-structured-in-source" },
      },
    });
  }
  return events;
}

async function importKaernten2021(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const date = "2021-02-28";
  const url = "https://www.ktn.gv.at/DE/repos/files/ktn.gv.at/Abteilungen/Abt1/Dateien/PDF/Statistik/Publikationen_Stat/Gemeinderatswahl_21.pdf";
  const name = "kaernten-gr-2021.pdf";
  const bytes = await cachedDownload(cache, name, url);
  const { stdout } = await execFileAsync("pdftotext", ["-layout", join(cache, name), "-"], { maxBuffer: 32 * 1024 * 1024 });
  const id = "kaernten-gr-2021";
  const events = parseKaernten2021Text(stdout, id, targetCodes);
  const expected = [...targetCodes].filter((code) => code.startsWith("2")).length;
  if (events.length !== expected) throw new Error(`Kärnten 2021: Erwartet wurden ${expected} Gemeinden, gefunden wurden ${events.length}.`);
  return { sources: [source(id, "Land Kärnten – Gemeinderats- und Bürgermeisterwahlen 2021, Endergebnisse", url, bytes, date)], events };
}

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}
function publishedInteger(value: string) {
  const number = Number(value.replace(/[^\d]/g, ""));
  return Number.isSafeInteger(number) ? number : null;
}
function tirolTotal(html: string, label: string) {
  const match = new RegExp(`(?:<strong>)?${escapeRegExp(label)}(?:<\\/strong>)?<\\/td>\\s*<td class="number">([\\d.]+)`, "i").exec(html);
  return match ? publishedInteger(match[1]) : null;
}
function allocateDhondt(votes: number[], councilSize: number) {
  const mandates = votes.map(() => 0);
  for (let seat = 0; seat < councilSize; seat += 1) {
    let winner = 0;
    for (let index = 1; index < votes.length; index += 1) {
      if (votes[index] / (mandates[index] + 1) > votes[winner] / (mandates[winner] + 1)) winner = index;
    }
    mandates[winner] += 1;
  }
  return mandates;
}

export function parseTirolPage(html: string, sourceId: string, date: string, targetCodes: Set<string>): ImportedEvent | null {
  const tableMatch = /id="werbertable_(\d{5})_GEMEINDE">([\s\S]*?)<\/table>/.exec(html);
  if (!tableMatch || !targetCodes.has(tableMatch[1])) return null;
  const code = tableMatch[1];
  const hasCouplingColumn = /<th>K<\/th>/.test(tableMatch[2]);
  const hasMandateColumn = /<th>Mandate<\/th>/.test(tableMatch[2]);
  const rawLists = [...tableMatch[2].matchAll(/<tr class="[^"]*werber-aktuell[^"]*">([\s\S]*?)<\/tr>/g)].flatMap((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeHtml(cell[1]));
    const mandates = hasMandateColumn ? publishedInteger(cells[hasCouplingColumn ? 3 : 2] ?? "") : null;
    const votes = publishedInteger(cells[hasMandateColumn ? (hasCouplingColumn ? 4 : 3) : 2] ?? "");
    if (!cells[1] || votes === null) return [];
    return [{ name: cells[1], party: canonicalPartyForList(cells[1]), votes, mandates }];
  });
  const candidateMatch = new RegExp(`id="werbertable_${code}_GEMEINDE_BGM_INKLUDIERT">([\\s\\S]*?)<\\/table>`).exec(html);
  const mayorCandidates = candidateMatch ? [...candidateMatch[1].matchAll(/<tr class="[^"]*werber-aktuell[^"]*">([\s\S]*?)<\/tr>/g)].flatMap((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeHtml(cell[1]));
    const votes = publishedInteger(cells[3] ?? "");
    if (!cells[1] || votes === null) return [];
    return [{ name: cells[1], party: "local-other" as const, listName: null, round: 1 as const, votes, elected: /^Ja$/i.test(cells[2] ?? "") }];
  }) : [];
  const eligibleVoters = tirolTotal(html, "Wahlberechtigte");
  const ballotsCast = tirolTotal(html, "Abgegebene Stimmen");
  const validVotes = tirolTotal(html, "...davon gültige");
  const invalidVotes = tirolTotal(html, "...davon ungültige");
  const councilSizeMatch = /Zu vergebende Mandate\s*<span[^>]*>(\d+)<\/span>/.exec(html);
  const councilSize = councilSizeMatch ? Number(councilSizeMatch[1]) : null;
  const derivedMandates = !hasMandateColumn && councilSize !== null ? allocateDhondt(rawLists.map((list) => list.votes), councilSize) : null;
  const lists = derivedMandates ? rawLists.map((list, index) => ({ ...list, mandates: derivedMandates[index] })) : rawLists;
  if (!lists.length) return null;
  const missingReasons: MunicipalityElectionEvent["missingReasons"] = {};
  if (eligibleVoters === null) missingReasons.eligibleVoters = "not-structured-in-source";
  if (ballotsCast === null) missingReasons.ballotsCast = "not-structured-in-source";
  if (validVotes === null) missingReasons.validVotes = "not-structured-in-source";
  if (invalidVotes === null) missingReasons.invalidVotes = "not-structured-in-source";
  if (councilSize === null) missingReasons.councilSize = "not-structured-in-source";
  if (!mayorCandidates.length) missingReasons.mayorCandidates = "not-structured-in-source";
  return { municipalityCode: code, event: { id: `${code}-${date}`, date, eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists, mayorCandidates, aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [sourceId], missingReasons } };
}
async function importTirol2022(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const indexUrl = "https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahlen_2022/index.html";
  const indexBytes = await cachedDownload(cache, "tirol-gr-2022-index.html", indexUrl);
  const indexHtml = new TextDecoder().decode(indexBytes);
  const names = [...new Set([...indexHtml.matchAll(/href="gemeinden\/([^"]+\.html)"/g)].map((match) => match[1]))];
  if (!names.length) throw new Error("Tirol 2022: Im amtlichen Index wurden keine Gemeinden gefunden.");
  const queue = [...names];
  const pages: Array<{ name: string; bytes: Uint8Array }> = [];
  await Promise.all(Array.from({ length: Math.min(6, names.length) }, async () => {
    for (;;) {
      const name = queue.shift();
      if (!name) return;
      const bytes = await cachedDownload(cache, `tirol-gr-2022-${name}`, `https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahlen_2022/gemeinden/${name}`);
      pages.push({ name, bytes });
    }
  }));
  pages.sort((left, right) => left.name.localeCompare(right.name));
  const id = "tirol-gr-2022";
  const events = pages.flatMap(({ bytes }) => {
    const event = parseTirolPage(new TextDecoder().decode(bytes), id, "2022-02-27", targetCodes);
    return event ? [event] : [];
  });
  return { sources: [source(id, "Land Tirol – Gemeinderats- und Bürgermeisterwahlen 2022", indexUrl, Buffer.concat([indexBytes, ...pages.map(({ bytes }) => bytes)]), "2022-02-27")], events };
}

const TIROL_SPECIAL_ELECTIONS = [
  { code: "70101", slug: "innsbruck-2024", date: "2024-04-14", title: "Landeshauptstadt Innsbruck 2024", url: "https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahl_der_landeshauptstadt_innsbruck_2024/gemeinden/innsbruck.html" },
  { code: "70370", slug: "matrei-am-brenner-2022", date: "2022-03-20", title: "Matrei am Brenner 2022", url: "https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahlen_2022_matrei_am_br_/gemeinden/matrei_am_brenner.html" },
  { code: "70822", slug: "musau-2024", date: "2024-02-25", title: "Musau 2024 (Mandate aus amtlichen Stimmen und Ratsgröße nach D’Hondt)", url: "https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahl_2024_gemeinde_musau/gemeinden/musau.html" },
  { code: "70835", slug: "waengle-2022", date: "2022-01-09", title: "Wängle 2022", url: "https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahlen_2022_waengle/gemeinden/waengle.html" },
] as const;

async function importTirolSpecialElections(cache: string, targetCodes: Set<string>): Promise<OfficialPoliticsImport> {
  const imported = await Promise.all(TIROL_SPECIAL_ELECTIONS.map(async (item) => {
    const id = `tirol-gr-${item.slug}`;
    const bytes = await cachedDownload(cache, `${id}.html`, item.url);
    const event = parseTirolPage(new TextDecoder().decode(bytes), id, item.date, targetCodes);
    if (!event || event.municipalityCode !== item.code) throw new Error(`Tirol: Ergebnis ${item.title} konnte nicht gelesen werden.`);
    return {
      source: source(id, `Land Tirol – Gemeinderats- und Bürgermeisterwahl ${item.title}`, item.url, bytes, item.date),
      event,
    };
  }));
  return {
    sources: imported.map((item) => item.source),
    events: imported.map((item) => item.event),
  };
}

type PublishedCityElection = { municipalityCode: string; slug: string; date: string; title: string; url: string; eligibleVoters: number; ballotsCast: number; validVotes: number; invalidVotes: number; councilSize: number; lists: MunicipalityElectionEvent["lists"] };

const PUBLISHED_CITY_ELECTIONS: PublishedCityElection[] = [
  { municipalityCode: "30101", slug: "krems-2022", date: "2022-09-04", title: "Stadt Krems – Gemeinderatswahl 2022, Endergebnis", url: "https://www.krems.at/rathaus/wahlen/allgemeine-information", eligibleVoters: 19_904, ballotsCast: 11_415, validVotes: 11_179, invalidVotes: 236, councilSize: 40, lists: [{ name: "RESCH", party: "spoe", votes: 4_574, mandates: 17 }, { name: "ÖVP", party: "oevp", votes: 2_606, mandates: 10 }, { name: "FPÖ", party: "fpoe", votes: 1_635, mandates: 6 }, { name: "KLS", party: "local-other", votes: 793, mandates: 3 }, { name: "GRÜNE", party: "gruene", votes: 409, mandates: 1 }, { name: "NIK", party: "neos", votes: 745, mandates: 2 }, { name: "GREENK", party: "local-other", votes: 83, mandates: 0 }, { name: "MFG", party: "mfg", votes: 334, mandates: 1 }] },
  { municipalityCode: "30201", slug: "st-poelten-2026", date: "2026-01-25", title: "Stadt St. Pölten – Gemeinderatswahl 2026, Endergebnis", url: "https://www.noe.gv.at/noe/Wahlen/endg._Ergebnis_GR-Wahl_St._Poelten_2026.pdf", eligibleVoters: 44_063, ballotsCast: 26_042, validVotes: 25_736, invalidVotes: 306, councilSize: 42, lists: [{ name: "Liste Bürgermeister Matthias Stadler – SPÖ", party: "spoe", votes: 10_967, mandates: 19 }, { name: "Team Krumböck – Volkspartei & Unabhängige", party: "oevp", votes: 5_496, mandates: 9 }, { name: "Freiheitliche Partei Österreichs", party: "fpoe", votes: 5_074, mandates: 8 }, { name: "Die Grünen St. Pölten", party: "gruene", votes: 2_483, mandates: 4 }, { name: "Kommunistische Partei Österreichs", party: "kpoe", votes: 983, mandates: 1 }, { name: "NEOS Das Neue Niederösterreich", party: "neos", votes: 700, mandates: 1 }, { name: "Liste Multikulturelle Gesellschaft", party: "local-other", votes: 33, mandates: 0 }] },
  { municipalityCode: "30301", slug: "waidhofen-ybbs-2022", date: "2022-01-30", title: "Stadt Waidhofen an der Ybbs – Gemeinderatswahl 2022, Endergebnis", url: "https://login.waidhofen.at/media/magistratwaidhofen/1643639427-endergebnis-pdf.pdf", eligibleVoters: 9_820, ballotsCast: 7_057, validVotes: 6_954, invalidVotes: 103, councilSize: 40, lists: [{ name: "Waidhofner Volkspartei", party: "oevp", votes: 2_871, mandates: 18 }, { name: "SPÖ", party: "spoe", votes: 1_508, mandates: 9 }, { name: "FUFU", party: "local-other", votes: 782, mandates: 4 }, { name: "FPÖ", party: "fpoe", votes: 280, mandates: 1 }, { name: "UWG", party: "local-other", votes: 111, mandates: 0 }, { name: "GRÜNE", party: "gruene", votes: 213, mandates: 1 }, { name: "MFG", party: "mfg", votes: 1_189, mandates: 7 }] },
];

async function importPublishedCityElections(cache: string): Promise<OfficialPoliticsImport> {
  const imported = await Promise.all(PUBLISHED_CITY_ELECTIONS.map(async (item) => {
    const id = `city-gr-${item.slug}`;
    const bytes = await cachedDownload(cache, `${id}${item.url.endsWith(".pdf") ? ".pdf" : ".html"}`, item.url);
    const event: MunicipalityElectionEvent = {
      id: `${item.municipalityCode}-${item.date}`, date: item.date, eligibleVoters: item.eligibleVoters, ballotsCast: item.ballotsCast,
      validVotes: item.validVotes, invalidVotes: item.invalidVotes, councilSize: item.councilSize, lists: item.lists,
      mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [item.municipalityCode], sourceIds: [id], missingReasons: { mayorCandidates: "not-applicable" },
    };
    return { source: source(id, item.title, item.url, bytes, item.date), event: { municipalityCode: item.municipalityCode, event } };
  }));
  return { sources: imported.map((item) => item.source), events: imported.map((item) => item.event) };
}

type GrazRawElection = { wahlAktuell: { wahlberechtigte: number; stimmen: { gesamt: number; ungueltig: number; gueltig: number } }; ergebnisse: Array<{ ptname: string; stimmen: number | null; mandate: number | null }> };

async function importGraz2026(cache: string): Promise<OfficialPoliticsImport> {
  const date = "2026-06-28";
  const url = "https://magistratwahlenstorage.blob.core.windows.net/results/GR2026.json";
  const bytes = await cachedDownload(cache, "graz-gr-2026.json", url);
  const result = (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, GrazRawElection>)["60101"];
  if (!result) throw new Error("Graz 2026: Gesamtwahlergebnis 60101 fehlt.");
  const lists = result.ergebnisse.flatMap(({ ptname, stimmen, mandate }) => stimmen === null || mandate === null ? [] : [{ name: ptname, party: canonicalPartyForList(ptname), votes: stimmen, mandates: mandate }]);
  const id = "graz-gr-2026";
  const totals = result.wahlAktuell;
  const event: MunicipalityElectionEvent = {
    id: `60101-${date}`, date, eligibleVoters: totals.wahlberechtigte, ballotsCast: totals.stimmen.gesamt, validVotes: totals.stimmen.gueltig,
    invalidVotes: totals.stimmen.ungueltig, councilSize: lists.reduce((sum, list) => sum + list.mandates, 0), lists, mayorCandidates: [],
    aggregationStatus: "direct", predecessorCodes: ["60101"], sourceIds: [id], missingReasons: { mayorCandidates: "not-applicable" },
  };
  return { sources: [source(id, "Stadt Graz – Gemeinderatswahl 2026, amtliche Rohdaten", url, bytes, date)], events: [{ municipalityCode: "60101", event }] };
}

async function importVorarlberg2025(cache: string, targetCodeByName: Map<string, string>): Promise<OfficialPoliticsImport> {
  const date = "2025-03-16";
  const url = "https://vorarlberg.at/documents/302033/472473/Gemeindevertretungs-+und+B%C3%BCrgermeisterwahl+16.+M%C3%A4rz+2025+-+Tabellen.ods/c1b04c40-2744-5d5f-bc52-637177dd30c6?t=1751876430768";
  const bytes = await cachedDownload(cache, "vorarlberg-gv-2025.ods", url); const id = "vorarlberg-gv-2025"; const workbook = XLSX.read(bytes, { type: "buffer" });
  const totals = new Map<string, { eligible: number; ballots: number }>();
  for (const row of XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.GV_2_2, { header: 1, defval: null })) {
    const code = targetCodeByName.get(String(row[0] ?? "")); const eligible = Number(row[1]); const ballots = Number(row[4]); if (code && Number.isSafeInteger(eligible) && Number.isSafeInteger(ballots)) totals.set(code, { eligible, ballots });
  }
  const listsByCode = new Map<string, Array<{ name: string; party: CanonicalPartyId; votes: number; mandates: number | null }>>(); let party: CanonicalPartyId = "local-other";
  for (const row of XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.GV_2_6, { header: 1, defval: null })) {
    const heading = String(row[0] ?? ""); if (/VP-Listen/.test(heading)) party = "oevp"; else if (/FPÖ-Listen/.test(heading)) party = "fpoe"; else if (/GRÜNEN-Listen/.test(heading)) party = "gruene"; else if (/SPÖ-Listen/.test(heading)) party = "spoe"; else if (/NEOS-Listen/.test(heading)) party = "neos"; else if (/ANDERER-Listen/.test(heading)) party = "local-other";
    const code = targetCodeByName.get(heading); const votes = Number(row[2]); const mandates = Number(row[3]); if (!code || !Number.isSafeInteger(votes) || !Number.isSafeInteger(mandates)) continue;
    const lists = listsByCode.get(code) ?? []; lists.push({ name: String(row[1] ?? heading), party, votes, mandates }); listsByCode.set(code, lists);
  }
  for (const row of XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.GV_2_7, { header: 1, defval: null })) {
    const code = targetCodeByName.get(String(row[0] ?? "")); const votes = Number(row[1]); const mandates = Number(row[2]); if (!code || !Number.isSafeInteger(votes) || !Number.isSafeInteger(mandates)) continue;
    listsByCode.set(code, [{ name: "Mehrheitswahl", party: "local-other", votes, mandates }]);
  }
  const events: ImportedEvent[] = [];
  for (const [code, total] of totals) { const lists = listsByCode.get(code) ?? []; const validVotes = lists.reduce((sum, list) => sum + list.votes, 0); if (!lists.length || validVotes > total.ballots) continue; events.push({ municipalityCode: code, event: { id: code + "-" + date, date, eligibleVoters: total.eligible, ballotsCast: total.ballots, validVotes, invalidVotes: total.ballots - validVotes, councilSize: lists.reduce((sum, list) => sum + (list.mandates ?? 0), 0), lists, mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [id], missingReasons: { mayorCandidates: "not-structured-in-source" } } }); }
  return { sources: [source(id, "Land Vorarlberg – Gemeindevertretungs- und Bürgermeisterwahl 2025", url, bytes, date)], events };
}

export async function importStructuredOfficialElections(cache: string, targetCodes: Set<string>, targetCodeByName: Map<string, string>) {
  const imports = await Promise.all([importGemeindebundMayors(cache, targetCodes), importBurgenland2022(cache, targetCodes), importKaernten2021(cache, targetCodes), importNoe(cache, targetCodes), importPublishedCityElections(cache), importOoe(cache, targetCodes), importStyria(cache, targetCodes), importGraz2026(cache), importSalzburg(cache, targetCodes), importTirol2022(cache, targetCodes), importTirolSpecialElections(cache, targetCodes), importVorarlberg2025(cache, targetCodeByName)]);
  return { sources: imports.flatMap((item) => item.sources), events: imports.flatMap((item) => item.events), current: imports.flatMap((item) => item.current ?? []) } satisfies OfficialPoliticsImport;
}
