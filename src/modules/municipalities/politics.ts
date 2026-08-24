import { EXPECTED_MUNICIPALITY_COUNT } from "./data";

export const MUNICIPALITY_POLITICS_SCHEMA_VERSION = 1;
export const POLITICS_FIRST_YEAR = 2000;
export const POLITICS_LATEST_YEAR = 2026;
export const CANONICAL_PARTIES = ["oevp", "spoe", "fpoe", "gruene", "neos", "kpoe", "mfg", "local-other"] as const;

export type CanonicalPartyId = (typeof CANONICAL_PARTIES)[number];
export type PoliticsView = "leading-list" | "party-share" | "turnout";
export type MissingReason = "not-published" | "source-unavailable" | "not-applicable" | "territorial-split" | "unquantifiable-boundary-change" | "not-structured-in-source";
export type AggregationStatus = "direct" | "aggregated-predecessors" | "unavailable-territorial-change";
export type PoliticsSource = { id: string; title: string; url: string; retrievedAt: string; referenceDate?: string; sha256?: string };
export type ElectionListResult = { name: string; party: CanonicalPartyId; votes: number; mandates: number | null };
export type MayorCandidateResult = { name: string; party: CanonicalPartyId; listName: string | null; round: 1 | 2; votes: number; elected: boolean };
export type MunicipalityElectionEvent = {
  id: string;
  date: string;
  eligibleVoters: number | null;
  ballotsCast: number | null;
  validVotes: number | null;
  invalidVotes: number | null;
  councilSize: number | null;
  lists: ElectionListResult[];
  mayorCandidates: MayorCandidateResult[];
  aggregationStatus: AggregationStatus;
  predecessorCodes: string[];
  sourceIds: string[];
  missingReasons: Partial<Record<"eligibleVoters" | "ballotsCast" | "validVotes" | "invalidVotes" | "councilSize" | "lists" | "mayorCandidates", MissingReason>>;
};
export type MunicipalityElectionHistoryDataset = {
  schemaVersion: typeof MUNICIPALITY_POLITICS_SCHEMA_VERSION;
  territorialReferenceDate: "2026-01-01";
  firstYear: 2000;
  latestElectionYear: 2026;
  count: number;
  sources: PoliticsSource[];
  municipalities: Record<string, { events: MunicipalityElectionEvent[]; coverageMissingReason: MissingReason | null }>;
};
export type MunicipalityCurrentPolitics = {
  mayor: { name: string; party: CanonicalPartyId | null; listName: string | null } | null;
  mayorAsOf: string | null;
  mayorSourceIds: string[];
  latestCouncil: MunicipalityElectionEvent | null;
  missingReasons: Partial<Record<"mayor" | "mayorParty" | "latestCouncil", MissingReason>>;
};
export type MunicipalityCurrentPoliticsDataset = {
  schemaVersion: typeof MUNICIPALITY_POLITICS_SCHEMA_VERSION;
  referenceDate: string;
  count: number;
  sources: PoliticsSource[];
  municipalities: Record<string, MunicipalityCurrentPolitics>;
};

export function isCanonicalPartyId(value: string): value is CanonicalPartyId {
  return CANONICAL_PARTIES.includes(value as CanonicalPartyId);
}
export function isPoliticsView(value: string): value is PoliticsView {
  return value === "leading-list" || value === "party-share" || value === "turnout";
}
export function canonicalPartyForList(name: string): CanonicalPartyId {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/(^|\W)(OVP|OEVP|VOLKSPARTEI)(\W|$)/.test(normalized)) return "oevp";
  if (/(^|\W)(SPO|SPOE|SOZIALDEMOKRAT)(\W|$)/.test(normalized)) return "spoe";
  if (/(^|\W)(FPO|FPOE|FREIHEITLICH)(\W|$)/.test(normalized)) return "fpoe";
  if (/(^|\W)(GRUN|GRUNE|GRUENE)(\W|$)/.test(normalized)) return "gruene";
  if (/(^|\W)NEOS(\W|$)/.test(normalized)) return "neos";
  if (/(^|\W)(KPO|KPOE|KOMMUNIST)(\W|$)/.test(normalized)) return "kpoe";
  if (/(^|\W)MFG(\W|$)/.test(normalized)) return "mfg";
  return "local-other";
}
export function electionAsOf(events: MunicipalityElectionEvent[], year: number) {
  const cutoff = `${year}-12-31`;
  return events.filter((event) => event.date <= cutoff).toSorted((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}
export function electionTurnout(event: MunicipalityElectionEvent) {
  return event.eligibleVoters && event.ballotsCast !== null ? event.ballotsCast / event.eligibleVoters : null;
}
export function electionPartyShare(event: MunicipalityElectionEvent, party: CanonicalPartyId) {
  if (!event.validVotes) return null;
  return event.lists.filter((list) => list.party === party).reduce((sum, list) => sum + list.votes, 0) / event.validVotes;
}
export function leadingElectionList(event: MunicipalityElectionEvent) {
  if (!event.lists.length) return { kind: "missing" as const, lists: [] as ElectionListResult[] };
  const maximum = Math.max(...event.lists.map((list) => list.votes));
  const lists = event.lists.filter((list) => list.votes === maximum);
  return lists.length === 1 ? { kind: "leader" as const, list: lists[0] } : { kind: "tie" as const, lists };
}
function assertInteger(value: number | null, field: keyof MunicipalityElectionEvent["missingReasons"], event: MunicipalityElectionEvent) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`Ungültiges Feld ${field} in ${event.id}.`);
  if (value === null && !event.missingReasons[field]) throw new Error(`Fehlender Grund für ${field} in ${event.id}.`);
}
export function validateElectionEvent(event: MunicipalityElectionEvent) {
  for (const field of ["eligibleVoters", "ballotsCast", "validVotes", "invalidVotes", "councilSize"] as const) assertInteger(event[field], field, event);
  if (event.ballotsCast !== null && event.validVotes !== null && event.invalidVotes !== null && event.ballotsCast !== event.validVotes + event.invalidVotes) throw new Error(`Stimmensumme stimmt in ${event.id} nicht.`);
  if (event.validVotes !== null && event.lists.length && event.lists.reduce((sum, list) => sum + list.votes, 0) !== event.validVotes) throw new Error(`Listenstimmen stimmen in ${event.id} nicht.`);
  if (!event.lists.length && !event.missingReasons.lists) throw new Error(`Fehlender Grund für Listen in ${event.id}.`);
  if (event.councilSize !== null && event.lists.every((list) => list.mandates !== null) && event.lists.reduce((sum, list) => sum + (list.mandates ?? 0), 0) !== event.councilSize) throw new Error(`Mandatssumme stimmt in ${event.id} nicht.`);
  return event;
}
export function validateMunicipalityElectionHistory(dataset: MunicipalityElectionHistoryDataset, municipalityCodes: Iterable<string>) {
  const codes = Array.from(municipalityCodes);
  if (dataset.schemaVersion !== MUNICIPALITY_POLITICS_SCHEMA_VERSION || dataset.firstYear !== 2000 || dataset.latestElectionYear !== 2026 || dataset.territorialReferenceDate !== "2026-01-01") throw new Error("Unerwartete Version der Wahlhistorie.");
  if (dataset.count !== EXPECTED_MUNICIPALITY_COUNT || codes.length !== EXPECTED_MUNICIPALITY_COUNT || Object.keys(dataset.municipalities).length !== EXPECTED_MUNICIPALITY_COUNT) throw new Error("Unvollständige Wahlhistorie.");
  const known = new Set(codes);
  const ids = new Set<string>();
  for (const [code, history] of Object.entries(dataset.municipalities)) {
    if (!known.has(code)) throw new Error(`Unbekannter Zielcode ${code}.`);
    if (!history.events.length && !history.coverageMissingReason) throw new Error(`Fehlender Abdeckungsgrund für ${code}.`);
    for (const event of history.events) {
      if (ids.has(`${code}|${event.id}`)) throw new Error(`Doppeltes Wahlereignis ${event.id}.`);
      ids.add(`${code}|${event.id}`);
      validateElectionEvent(event);
    }
  }
  return dataset;
}
export function validateMunicipalityCurrentPolitics(dataset: MunicipalityCurrentPoliticsDataset, municipalityCodes: Iterable<string>) {
  const codes = Array.from(municipalityCodes);
  if (dataset.schemaVersion !== MUNICIPALITY_POLITICS_SCHEMA_VERSION || dataset.count !== EXPECTED_MUNICIPALITY_COUNT || codes.length !== EXPECTED_MUNICIPALITY_COUNT || Object.keys(dataset.municipalities).length !== EXPECTED_MUNICIPALITY_COUNT) throw new Error("Unvollständige aktuelle Politikdaten.");
  for (const code of codes) {
    const item = dataset.municipalities[code];
    if (!item) throw new Error(`Fehlende aktuelle Politikdaten für ${code}.`);
    if (!item.mayor && !item.missingReasons.mayor) throw new Error(`Fehlender Grund für Bürgermeisterdaten ${code}.`);
    if (item.mayor && item.mayor.party === null && !item.missingReasons.mayorParty) throw new Error(`Fehlender Grund für Bürgermeisterpartei ${code}.`);
    if (!item.latestCouncil && !item.missingReasons.latestCouncil) throw new Error(`Fehlender Grund für Gemeinderatsdaten ${code}.`);
    if (item.latestCouncil) validateElectionEvent(item.latestCouncil);
  }
  return dataset;
}
export function mergePredecessorElectionEvents(targetCode: string, events: MunicipalityElectionEvent[]): MunicipalityElectionEvent {
  if (!events.length) throw new Error(`Keine Vorgängerereignisse für ${targetCode}.`);
  if (new Set(events.map((event) => event.date)).size !== 1) throw new Error(`Vorgängerereignisse für ${targetCode} haben unterschiedliche Wahltermine.`);
  const total = (field: "eligibleVoters" | "ballotsCast" | "validVotes" | "invalidVotes") => events.every((event) => event[field] !== null) ? events.reduce((sum, event) => sum + (event[field] ?? 0), 0) : null;
  const lists = new Map<string, ElectionListResult>();
  for (const event of events) for (const list of event.lists) {
    const key = `${list.party}|${list.name}`;
    const previous = lists.get(key);
    lists.set(key, { ...list, votes: (previous?.votes ?? 0) + list.votes, mandates: null });
  }
  return {
    id: `${targetCode}-${events[0].date}-aggregated`, date: events[0].date,
    eligibleVoters: total("eligibleVoters"), ballotsCast: total("ballotsCast"), validVotes: total("validVotes"), invalidVotes: total("invalidVotes"), councilSize: null,
    lists: [...lists.values()], mayorCandidates: [], aggregationStatus: "aggregated-predecessors",
    predecessorCodes: events.flatMap((event) => event.predecessorCodes), sourceIds: [...new Set(events.flatMap((event) => event.sourceIds))],
    missingReasons: { councilSize: "not-applicable", mayorCandidates: "not-applicable" },
  };
}
export function politicsMapValue(event: MunicipalityElectionEvent | null, view: PoliticsView, party: CanonicalPartyId) {
  if (!event) return null;
  if (view === "turnout") return electionTurnout(event);
  if (view === "party-share") return electionPartyShare(event, party);
  const leading = leadingElectionList(event);
  if (leading.kind === "missing") return null;
  if (leading.kind === "tie") return 8;
  return CANONICAL_PARTIES.indexOf(leading.list.party);
}
