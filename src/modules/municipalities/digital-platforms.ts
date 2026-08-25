import { EXPECTED_MUNICIPALITY_COUNT } from "./data";

export const DIGITAL_PLATFORM_KINDS = [
  "appointment-booking",
  "citizen-app",
  "digital-notice-board",
  "issue-reporting",
  "messaging",
  "official-website",
  "open-data",
  "other",
  "participation",
  "service-portal",
  "social-media",
  "waste-platform",
  "website-cms",
] as const;

export type DigitalPlatformKind = (typeof DIGITAL_PLATFORM_KINDS)[number];
export type DigitalPlatformViewId =
  | "overview"
  | "citizen-app"
  | "service-portal"
  | "digital-notice-board"
  | "website-cms"
  | "waste-platform"
  | "appointment-booking"
  | "participation"
  | "communication"
  | "open-data"
  | "other";

export const DIGITAL_PLATFORM_VIEWS: ReadonlyArray<{
  id: DigitalPlatformViewId;
  kinds: readonly DigitalPlatformKind[];
}> = [
  { id: "overview", kinds: DIGITAL_PLATFORM_KINDS.filter((kind) => kind !== "official-website") },
  { id: "citizen-app", kinds: ["citizen-app"] },
  { id: "service-portal", kinds: ["service-portal"] },
  { id: "digital-notice-board", kinds: ["digital-notice-board"] },
  { id: "website-cms", kinds: ["website-cms"] },
  { id: "waste-platform", kinds: ["waste-platform"] },
  { id: "appointment-booking", kinds: ["appointment-booking"] },
  { id: "participation", kinds: ["participation", "issue-reporting"] },
  { id: "communication", kinds: ["social-media", "messaging"] },
  { id: "open-data", kinds: ["open-data"] },
  { id: "other", kinds: ["other"] },
];

export type MunicipalityDigitalPlatform = {
  id: string;
  name: string;
  provider: string | null;
  kind: DigitalPlatformKind;
  channels: string[];
  relationship: "official" | "officially-linked" | "provider-claimed";
  status: "active" | "unclear";
  url: string;
  sourceIds: string[];
  evidenceNote: string;
  confidence: "high" | "medium" | "low";
  lastVerifiedAt: string;
};

export type MunicipalityDigitalPlatformProfile = {
  name: string;
  state: string;
  researchStatus: "complete" | "partial";
  result: "platforms-found" | "none-found-beyond-official-website";
  checkedAt: string;
  officialWebsite: string | null;
  platforms: MunicipalityDigitalPlatform[];
  missingReason: string | null;
  blockers: string[];
  notes: string[];
};

export type MunicipalityDigitalPlatformDataset = {
  schemaVersion: 1;
  territorialReferenceDate: string;
  referenceDate: string;
  generatedAt: string;
  count: number;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    publisher: string | null;
    sourceType: string;
    retrievedAt: string;
  }>;
  municipalities: Record<string, MunicipalityDigitalPlatformProfile>;
};

export function isDigitalPlatformViewId(value: string): value is DigitalPlatformViewId {
  return DIGITAL_PLATFORM_VIEWS.some(({ id }) => id === value);
}

export function digitalPlatformsForView(
  profile: MunicipalityDigitalPlatformProfile,
  view: DigitalPlatformViewId,
) {
  const kinds = DIGITAL_PLATFORM_VIEWS.find(({ id }) => id === view)!.kinds;
  return profile.platforms.filter(
    (platform) => platform.status === "active" && kinds.includes(platform.kind),
  );
}

/**
 * Returns a map value without turning incomplete research into a negative finding.
 * The overview counts distinct platform areas; focused views count concrete services.
 */
export function digitalPlatformMetricValue(
  profile: MunicipalityDigitalPlatformProfile | undefined,
  view: DigitalPlatformViewId,
): number | null {
  if (!profile) return null;
  const matches = digitalPlatformsForView(profile, view);
  if (!matches.length) return profile.researchStatus === "complete" ? 0 : null;
  return view === "overview"
    ? new Set(matches.map(({ kind }) => kind)).size
    : matches.length;
}

export function validateMunicipalityDigitalPlatformDataset(
  dataset: MunicipalityDigitalPlatformDataset,
  municipalityCodes: readonly string[],
) {
  if (dataset.schemaVersion !== 1) throw new Error("Ungültige Plattform-Schemaversion.");
  if (dataset.count !== EXPECTED_MUNICIPALITY_COUNT || municipalityCodes.length !== EXPECTED_MUNICIPALITY_COUNT)
    throw new Error("Unerwartete Gemeindeanzahl in den Plattformdaten.");
  const codes = Object.keys(dataset.municipalities);
  if (codes.length !== municipalityCodes.length || municipalityCodes.some((code) => !dataset.municipalities[code]))
    throw new Error("Die Plattformdaten decken den aktuellen Gemeindestand nicht vollständig ab.");
  const sourceIds = new Set(dataset.sources.map(({ id }) => id));
  if (sourceIds.size !== dataset.sources.length) throw new Error("Doppelte Plattform-Quellen-ID.");
  const platformIds = new Set<string>();
  for (const code of municipalityCodes) {
    const profile = dataset.municipalities[code];
    if (!profile.name || !profile.state || !Array.isArray(profile.platforms))
      throw new Error(`Ungültiges Plattformprofil für ${code}.`);
    for (const platform of profile.platforms) {
      if (platformIds.has(platform.id)) throw new Error(`Doppelte Plattform-ID ${platform.id}.`);
      platformIds.add(platform.id);
      if (!DIGITAL_PLATFORM_KINDS.includes(platform.kind))
        throw new Error(`Ungültige Plattformkategorie für ${code}.`);
      if (!platform.name || !platform.url || !platform.sourceIds.length || platform.sourceIds.some((id) => !sourceIds.has(id)))
        throw new Error(`Ungültiger Plattformbeleg für ${code}.`);
    }
  }
  return dataset;
}
