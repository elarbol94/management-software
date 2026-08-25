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
  | "providers"
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
  { id: "providers", kinds: ["citizen-app"] },
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

export const DIGITAL_PLATFORM_PROVIDER_FAMILIES = [
  "gem2go",
  "cities",
  "gemeinde24",
  "gemeindeapp",
  "daheim-app",
  "local-app",
] as const;

export type DigitalPlatformProviderFamily = (typeof DIGITAL_PLATFORM_PROVIDER_FAMILIES)[number];
export type DigitalPlatformProviderCategory =
  | "none"
  | DigitalPlatformProviderFamily
  | "multiple";

export const DIGITAL_PLATFORM_PROVIDER_CATEGORIES = [
  "none",
  ...DIGITAL_PLATFORM_PROVIDER_FAMILIES,
  "multiple",
] as const satisfies readonly DigitalPlatformProviderCategory[];

export const DIGITAL_PLATFORM_PROVIDER_CODES: Record<DigitalPlatformProviderCategory, number> = {
  none: 0,
  gem2go: 1,
  cities: 2,
  gemeinde24: 3,
  gemeindeapp: 4,
  "daheim-app": 5,
  "local-app": 6,
  multiple: 7,
};

export type DigitalPlatformProviderClassification = {
  category: DigitalPlatformProviderCategory;
  providers: DigitalPlatformProviderFamily[];
};

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

function providerFamilyFor(platform: MunicipalityDigitalPlatform): DigitalPlatformProviderFamily {
  const identity = `${platform.name} ${platform.provider ?? ""}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-AT");
  if (identity.includes("gem2go")) return "gem2go";
  if (identity.includes("citiesapps") || /\bcities\b/.test(identity)) return "cities";
  if (identity.includes("gemeinde24")) return "gemeinde24";
  if (identity.includes("gemeindeapp") || identity.includes("gemeinde app")) return "gemeindeapp";
  if (identity.includes("daheim app") || identity.includes("daheim-app")) return "daheim-app";
  return "local-app";
}

/** Classifies active citizen apps without changing or duplicating the source dataset. */
export function digitalPlatformProviderClassification(
  profile: MunicipalityDigitalPlatformProfile,
): DigitalPlatformProviderClassification | null {
  const providers = new Set(
    profile.platforms
      .filter(({ kind, status }) => kind === "citizen-app" && status === "active")
      .map(providerFamilyFor),
  );
  if (!providers.size) {
    return profile.researchStatus === "complete" ? { category: "none", providers: [] } : null;
  }
  const orderedProviders = DIGITAL_PLATFORM_PROVIDER_FAMILIES.filter((provider) => providers.has(provider));
  return {
    category: orderedProviders.length > 1 ? "multiple" : orderedProviders[0],
    providers: orderedProviders,
  };
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
  if (view === "providers") {
    const classification = digitalPlatformProviderClassification(profile);
    return classification ? DIGITAL_PLATFORM_PROVIDER_CODES[classification.category] : null;
  }
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
