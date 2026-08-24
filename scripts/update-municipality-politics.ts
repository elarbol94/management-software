import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import * as XLSX from "xlsx";
import { importStructuredOfficialElections } from "./municipality-politics-official";
import { validateMunicipalityIndex, type MunicipalityIndex } from "../src/modules/municipalities/data";
import {
  MUNICIPALITY_POLITICS_SCHEMA_VERSION,
  canonicalPartyForList,
  validateMunicipalityCurrentPolitics,
  validateMunicipalityElectionHistory,
  type MunicipalityCurrentPoliticsDataset,
  type MunicipalityElectionEvent,
  type MunicipalityElectionHistoryDataset,
  type PoliticsSource,
} from "../src/modules/municipalities/politics";

const INDEX_PATH = resolve("public/data/municipalities-at-2026.index.json");
const CURRENT_OUTPUT = resolve("public/data/municipality-politics-current-2026.json");
const HISTORY_OUTPUT = resolve("public/data/municipality-election-history-2000-2025.json");
const QUALITY_OUTPUT = resolve("public/data/municipality-politics-quality.json");
const DEFAULT_CACHE = resolve(".cache/municipality-politics");
const RETRIEVED_AT = "2026-08-24";

export const POLITICS_SOURCE_CATALOG = [
  { state: "Burgenland", cycles: [2002, 2007, 2012, 2017, 2022], url: "https://wahl.bgld.gv.at/wahlen/gr20221023.nsf/vwHilfe/fmHilfe" },
  { state: "Kärnten", cycles: [2003, 2009, 2015, 2021], url: "https://www.ktn.gv.at/Politik-und-Verwaltung/Politik/Wahlen" },
  { state: "Niederösterreich", cycles: [2000, 2005, 2010, 2015, 2020, 2025], url: "https://www.noe.gv.at/wahlen/G20251/Download.html" },
  { state: "Oberösterreich", cycles: [2003, 2009, 2015, 2021], url: "https://www.land-oberoesterreich.gv.at/42981.htm" },
  { state: "Salzburg", cycles: [2004, 2009, 2014, 2019, 2024], url: "https://www.salzburg.gv.at/themen/statistik/folder-und-periodika/wahlen" },
  { state: "Steiermark", cycles: [2000, 2005, 2010, 2015, 2020, 2025], url: "https://www.verwaltung.steiermark.at/cms/ziel/180951870/DE/" },
  { state: "Tirol", cycles: [2004, 2010, 2016, 2022], url: "https://wahlen.tirol.gv.at/gemeinderats_und_buergermeisterwahlen_2022/index.html" },
  { state: "Vorarlberg", cycles: [2000, 2005, 2010, 2015, 2020, 2025], url: "https://vorarlberg.at/-/112_gemeindevertretungs-und-buergermeisterwahl-1" },
  { state: "Wien", cycles: [2001, 2005, 2010, 2015, 2020, 2025], url: "https://www.wien.gv.at/wahlergebnis/de/GR251/index.html" },
] as const;

function sourceDirectoryFromArguments(arguments_: string[]) {
  const index = arguments_.indexOf("--source-dir");
  if (index === -1) return null;
  if (!arguments_[index + 1]) throw new Error("Nach --source-dir fehlt ein Pfad.");
  return resolve(arguments_[index + 1]);
}
function sourceId(state: string) {
  return `state-${state.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]+/g, "-")}`;
}
async function downloadCatalog(cacheDirectory: string) {
  await mkdir(cacheDirectory, { recursive: true });
  return (await Promise.all(POLITICS_SOURCE_CATALOG.map(async (entry): Promise<PoliticsSource | null> => {
    try {
      const response = await fetch(entry.url, {
        headers: { "user-agent": "management-platform municipality politics importer" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(join(cacheDirectory, `${sourceId(entry.state)}.html`), bytes);
      return { id: sourceId(entry.state), title: `${entry.state}: amtliches Wahlarchiv (${entry.cycles.join(", ")})`, url: entry.url, retrievedAt: RETRIEVED_AT, sha256: createHash("sha256").update(bytes).digest("hex") };
    } catch (error) {
      console.warn(`${entry.state}: Quelle nicht abrufbar (${error instanceof Error ? error.message : String(error)}).`);
      return null;
    }
  }))).filter((source): source is PoliticsSource => source !== null);
}
type NormalizedFragment = { source?: PoliticsSource; events?: Array<{ municipalityCode: string; event: MunicipalityElectionEvent }>; current?: Array<{ municipalityCode: string; mayor?: MunicipalityCurrentPoliticsDataset["municipalities"][string]["mayor"]; mayorAsOf?: string; mayorSourceIds?: string[] }> };
async function readNormalizedFragments(directory: string) {
  const fragments: NormalizedFragment[] = [];
  for (const name of (await readdir(directory)).toSorted()) {
    const path = join(directory, name);
    const extension = extname(name).toLowerCase();
    if (extension === ".json") {
      fragments.push(JSON.parse(await readFile(path, "utf8")) as NormalizedFragment);
      continue;
    }
    if (![".xls", ".xlsx", ".ods", ".csv"].includes(extension)) continue;
    const workbook = XLSX.read(await readFile(path), { type: "buffer", cellDates: false });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: null });
    const grouped = new Map<string, MunicipalityElectionEvent>();
    for (const row of rows) {
      const municipalityCode = String(row.municipalityCode ?? "").padStart(5, "0");
      const date = String(row.date ?? "");
      const listName = String(row.listName ?? "");
      if (!/^\d{5}$/.test(municipalityCode) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !listName) throw new Error(`Ungültige Standardzeile in ${name}.`);
      const key = `${municipalityCode}|${date}`;
      const event = grouped.get(key) ?? {
        id: `${municipalityCode}-${date}`, date,
        eligibleVoters: Number(row.eligibleVoters), ballotsCast: Number(row.ballotsCast), validVotes: Number(row.validVotes), invalidVotes: Number(row.invalidVotes),
        councilSize: row.councilSize === null ? null : Number(row.councilSize), lists: [], mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: [municipalityCode],
        sourceIds: [sourceId(name)], missingReasons: row.councilSize === null ? { councilSize: "not-structured-in-source", mayorCandidates: "not-structured-in-source" } : { mayorCandidates: "not-structured-in-source" },
      } satisfies MunicipalityElectionEvent;
      event.lists.push({ name: listName, party: canonicalPartyForList(String(row.party ?? listName)), votes: Number(row.votes), mandates: row.mandates === null ? null : Number(row.mandates) });
      grouped.set(key, event);
    }
    fragments.push({ events: [...grouped.entries()].map(([key, event]) => ({ municipalityCode: key.slice(0, 5), event })) });
  }
  return fragments;
}

const VIENNA_2025_SOURCE: PoliticsSource = { id: "wien-gr-2025", title: "Stadt Wien – Gemeinderatswahl 2025, Endergebnis", url: "https://www.wien.gv.at/wahlergebnis/de/GR251/index.html", retrievedAt: RETRIEVED_AT, referenceDate: "2025-04-27" };
const VIENNA_2025: MunicipalityElectionEvent = {
  id: "90001-2025-04-27", date: "2025-04-27", eligibleVoters: 1_109_936, ballotsCast: 696_345, validVotes: 681_808, invalidVotes: 14_537, councilSize: 100,
  lists: [
    { name: "SPÖ – Bürgermeister Dr. Michael Ludwig", party: "spoe", votes: 268_514, mandates: 43 },
    { name: "Wiener Volkspartei – Karl Mahrer", party: "oevp", votes: 65_820, mandates: 10 },
    { name: "GRÜNE – DIE GRÜNE ALTERNATIVE WIEN", party: "gruene", votes: 98_995, mandates: 15 },
    { name: "NEOS – Ehrlich. Mutig. Tatkräftig.", party: "neos", votes: 68_152, mandates: 10 },
    { name: "Freiheitliche Partei Österreichs (FPÖ)", party: "fpoe", votes: 138_761, mandates: 22 },
    { name: "KPÖ und LINKS", party: "kpoe", votes: 27_657, mandates: 0 },
    { name: "Team HC Strache – Allianz für Österreich", party: "local-other", votes: 7_533, mandates: 0 },
    { name: "Soziales Österreich der Zukunft", party: "local-other", votes: 5_737, mandates: 0 },
    { name: "HERZ", party: "local-other", votes: 114, mandates: 0 },
    { name: "PRO – Pro 23", party: "local-other", votes: 525, mandates: 0 },
  ], mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: ["90001"], sourceIds: [VIENNA_2025_SOURCE.id], missingReasons: { mayorCandidates: "not-applicable" },
};

async function main() {
  const index = validateMunicipalityIndex(JSON.parse(await readFile(INDEX_PATH, "utf8")) as MunicipalityIndex);
  const sourceDirectory = sourceDirectoryFromArguments(process.argv.slice(2));
  const sources = sourceDirectory ? [] : await downloadCatalog(DEFAULT_CACHE);
  const official = sourceDirectory ? null : await importStructuredOfficialElections(DEFAULT_CACHE, new Set(index.municipalities.map(({ municipalityCode }) => municipalityCode)), new Map(index.municipalities.map(({ name, municipalityCode }) => [name, municipalityCode])));
  if (official) sources.push(...official.sources.filter((item) => !sources.some(({ id }) => id === item.id)));
  const viennaSource = { ...VIENNA_2025_SOURCE, sha256: sources.find(({ id }) => id === "state-wien")?.sha256 };
  const fragments = sourceDirectory ? await readNormalizedFragments(sourceDirectory) : [{ source: viennaSource, events: [{ municipalityCode: "90001", event: VIENNA_2025 }, ...(official?.events ?? [])], current: official?.current ?? [] }];
  const historyMunicipalities: MunicipalityElectionHistoryDataset["municipalities"] = {};
  const currentMunicipalities: MunicipalityCurrentPoliticsDataset["municipalities"] = {};
  for (const municipality of index.municipalities) {
    historyMunicipalities[municipality.municipalityCode] = { events: [], coverageMissingReason: "source-unavailable" };
    currentMunicipalities[municipality.municipalityCode] = { mayor: null, mayorAsOf: null, mayorSourceIds: [], latestCouncil: null, missingReasons: { mayor: "source-unavailable", latestCouncil: "source-unavailable" } };
  }
  for (const fragment of fragments) {
    if (fragment.source && !sources.some(({ id }) => id === fragment.source!.id)) sources.push(fragment.source);
    for (const item of fragment.events ?? []) {
      const history = historyMunicipalities[item.municipalityCode];
      if (!history) throw new Error(`Unbekannter Zielcode ${item.municipalityCode}.`);
      history.events.push(item.event); history.coverageMissingReason = null;
      const current = currentMunicipalities[item.municipalityCode];
      if (!current.latestCouncil || current.latestCouncil.date < item.event.date) { current.latestCouncil = item.event; delete current.missingReasons.latestCouncil; }
    }
    for (const item of fragment.current ?? []) {
      const current = currentMunicipalities[item.municipalityCode];
      if (!current) throw new Error(`Unbekannter Zielcode ${item.municipalityCode}.`);
      if (item.mayor) { current.mayor = item.mayor; current.mayorAsOf = item.mayorAsOf ?? null; current.mayorSourceIds = item.mayorSourceIds ?? []; delete current.missingReasons.mayor; if (item.mayor.party === null) current.missingReasons.mayorParty = "not-published"; }
    }
  }
  const nameParts = (name: string) => new Set(name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z]+/).filter(Boolean));
  for (const current of Object.values(currentMunicipalities)) {
    if (!current.mayor || current.mayor.party !== null || !current.latestCouncil) continue;
    const mayorParts = nameParts(current.mayor.name);
    const candidate = current.latestCouncil.mayorCandidates.find(({ name }) => {
      const candidateParts = [...nameParts(name)];
      return candidateParts.length > 0 && candidateParts.every((part) => mayorParts.has(part));
    });
    if (!candidate) continue;
    current.mayor.party = candidate.party;
    current.mayor.listName = candidate.listName;
    current.mayorSourceIds = [...new Set([...current.mayorSourceIds, ...current.latestCouncil.sourceIds])];
    delete current.missingReasons.mayorParty;
  }
  for (const history of Object.values(historyMunicipalities)) history.events.sort((a, b) => a.date.localeCompare(b.date));
  const history: MunicipalityElectionHistoryDataset = { schemaVersion: MUNICIPALITY_POLITICS_SCHEMA_VERSION, territorialReferenceDate: "2026-01-01", firstYear: 2000, latestElectionYear: 2025, count: index.count, sources, municipalities: historyMunicipalities };
  const current: MunicipalityCurrentPoliticsDataset = { schemaVersion: MUNICIPALITY_POLITICS_SCHEMA_VERSION, referenceDate: RETRIEVED_AT, count: index.count, sources, municipalities: currentMunicipalities };
  validateMunicipalityElectionHistory(history, index.municipalities.map(({ municipalityCode }) => municipalityCode));
  validateMunicipalityCurrentPolitics(current, index.municipalities.map(({ municipalityCode }) => municipalityCode));
  await writeFile(HISTORY_OUTPUT, JSON.stringify(history)); await writeFile(CURRENT_OUTPUT, JSON.stringify(current));
  const byState = Object.fromEntries(POLITICS_SOURCE_CATALOG.map(({ state, cycles }) => {
    const codes = index.municipalities.filter((item) => item.state === state).map((item) => item.municipalityCode);
    const covered = codes.filter((code) => historyMunicipalities[code].events.length > 0).length;
    const fieldCoverage = {
      currentMayor: codes.filter((code) => currentMunicipalities[code].mayor).length,
      currentMayorParty: codes.filter((code) => currentMunicipalities[code].mayor?.party).length,
      latestCouncil: codes.filter((code) => currentMunicipalities[code].latestCouncil).length,
    };
    const cycleCoverage = Object.fromEntries(cycles.map((cycle) => [cycle, codes.filter((code) => historyMunicipalities[code].events.some(({ date }) => date.startsWith(`${cycle}-`))).length]));
    return [state, { targetMunicipalities: codes.length, coveredMunicipalities: covered, coverage: codes.length ? covered / codes.length : 0, targetCycles: cycles, cycleCoverage, fieldCoverage }];
  }));
  await writeFile(QUALITY_OUTPUT, JSON.stringify({ generatedAt: RETRIEVED_AT, targetMunicipalities: index.count, currentMayorCovered: Object.values(currentMunicipalities).filter((item) => item.mayor).length, currentMayorPartyCovered: Object.values(currentMunicipalities).filter((item) => item.mayor?.party).length, latestCouncilCovered: Object.values(currentMunicipalities).filter((item) => item.latestCouncil).length, historyMunicipalitiesCovered: Object.values(historyMunicipalities).filter((item) => item.events.length).length, byState }, null, 2) + "\n");
  console.log(`Politikdaten: ${index.count} Zielgemeinden, ${Object.values(historyMunicipalities).filter((item) => item.events.length).length} mit Wahlhistorie.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
