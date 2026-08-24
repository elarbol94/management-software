import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { canonicalPartyForList, type CanonicalPartyId, type MunicipalityElectionEvent, type PoliticsSource } from "../src/modules/municipalities/politics";

const RETRIEVED_AT = "2026-08-24";
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
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\async function importVorarlberg2025");
  const match = new RegExp(`(?:<strong>)?${escaped}(?:<\\/strong>)?<\\/td>\\s*<td class="number">([\\d.]+)`, "i").exec(html);
  return match ? publishedInteger(match[1]) : null;
}
function parseTirol2022Page(html: string, sourceId: string, targetCodes: Set<string>): ImportedEvent | null {
  const tableMatch = /id="werbertable_(\d{5})_GEMEINDE">([\s\S]*?)<\/table>/.exec(html);
  if (!tableMatch || !targetCodes.has(tableMatch[1])) return null;
  const code = tableMatch[1];
  const hasCouplingColumn = /<th>K<\/th>/.test(tableMatch[2]);
  const lists = [...tableMatch[2].matchAll(/<tr class="[^"]*werber-aktuell[^"]*">([\s\S]*?)<\/tr>/g)].flatMap((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeHtml(cell[1]));
    const mandates = publishedInteger(cells[hasCouplingColumn ? 3 : 2] ?? "");
    const votes = publishedInteger(cells[hasCouplingColumn ? 4 : 3] ?? "");
    if (!cells[1] || mandates === null || votes === null) return [];
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
  if (!lists.length) return null;
  const missingReasons: MunicipalityElectionEvent["missingReasons"] = {};
  if (eligibleVoters === null) missingReasons.eligibleVoters = "not-structured-in-source";
  if (ballotsCast === null) missingReasons.ballotsCast = "not-structured-in-source";
  if (validVotes === null) missingReasons.validVotes = "not-structured-in-source";
  if (invalidVotes === null) missingReasons.invalidVotes = "not-structured-in-source";
  if (councilSize === null) missingReasons.councilSize = "not-structured-in-source";
  if (!mayorCandidates.length) missingReasons.mayorCandidates = "not-structured-in-source";
  return { municipalityCode: code, event: { id: `${code}-2022-02-27`, date: "2022-02-27", eligibleVoters, ballotsCast, validVotes, invalidVotes, councilSize, lists, mayorCandidates, aggregationStatus: "direct", predecessorCodes: [code], sourceIds: [sourceId], missingReasons } };
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
    const event = parseTirol2022Page(new TextDecoder().decode(bytes), id, targetCodes);
    return event ? [event] : [];
  });
  return { sources: [source(id, "Land Tirol – Gemeinderats- und Bürgermeisterwahlen 2022", indexUrl, Buffer.concat([indexBytes, ...pages.map(({ bytes }) => bytes)]), "2022-02-27")], events };
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
  const imports = await Promise.all([importGemeindebundMayors(cache, targetCodes), importBurgenland2022(cache, targetCodes), importNoe(cache, targetCodes), importOoe(cache, targetCodes), importStyria(cache, targetCodes), importSalzburg(cache, targetCodes), importTirol2022(cache, targetCodes), importVorarlberg2025(cache, targetCodeByName)]);
  return { sources: imports.flatMap((item) => item.sources), events: imports.flatMap((item) => item.events), current: imports.flatMap((item) => item.current ?? []) } satisfies OfficialPoliticsImport;
}
