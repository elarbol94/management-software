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

export type DigitalPlatformCostConfidence = "medium" | "low";

export type DigitalPlatformCostEstimate = {
  annualEuros: readonly [minimum: number, maximum: number];
  setupEuros: readonly [minimum: number, maximum: number];
  confidence: DigitalPlatformCostConfidence;
  providers: DigitalPlatformProviderFamily[];
};

type DigitalPlatformCostBand = {
  annualEuros: readonly [number, number];
  setupEuros: readonly [number, number];
  confidence: DigitalPlatformCostConfidence;
};

// Rounded planning corridors derived from public municipal offers from 2023–2026.
// Providers without a public price example deliberately use wider, low-confidence
// comparable-app bands. These are planning benchmarks, never inferred contract prices.
const DIGITAL_PLATFORM_COST_BANDS: Record<
  DigitalPlatformProviderFamily,
  readonly [small: DigitalPlatformCostBand, medium: DigitalPlatformCostBand, large: DigitalPlatformCostBand]
> = {
  gem2go: [
    { annualEuros: [2_000, 3_500], setupEuros: [4_000, 6_500], confidence: "medium" },
    { annualEuros: [2_500, 5_000], setupEuros: [5_000, 9_000], confidence: "medium" },
    { annualEuros: [4_000, 8_000], setupEuros: [7_000, 11_000], confidence: "medium" },
  ],
  cities: [
    { annualEuros: [1_700, 4_400], setupEuros: [0, 3_000], confidence: "medium" },
    { annualEuros: [3_000, 7_000], setupEuros: [0, 7_000], confidence: "medium" },
    { annualEuros: [5_000, 12_000], setupEuros: [0, 10_800], confidence: "medium" },
  ],
  gemeinde24: [
    { annualEuros: [1_500, 2_500], setupEuros: [1_000, 2_000], confidence: "medium" },
    { annualEuros: [1_800, 3_500], setupEuros: [1_000, 3_000], confidence: "medium" },
    { annualEuros: [2_500, 5_000], setupEuros: [1_500, 4_000], confidence: "medium" },
  ],
  gemeindeapp: [
    { annualEuros: [1_700, 5_000], setupEuros: [1_000, 5_000], confidence: "low" },
    { annualEuros: [3_000, 7_000], setupEuros: [2_000, 8_000], confidence: "low" },
    { annualEuros: [5_000, 12_000], setupEuros: [3_000, 11_000], confidence: "low" },
  ],
  "daheim-app": [
    { annualEuros: [0, 2_500], setupEuros: [0, 1_000], confidence: "low" },
    { annualEuros: [0, 4_000], setupEuros: [0, 2_000], confidence: "low" },
    { annualEuros: [0, 6_000], setupEuros: [0, 3_000], confidence: "low" },
  ],
  "local-app": [
    { annualEuros: [1_700, 6_000], setupEuros: [0, 8_000], confidence: "low" },
    { annualEuros: [3_000, 10_000], setupEuros: [2_000, 15_000], confidence: "low" },
    { annualEuros: [5_000, 20_000], setupEuros: [5_000, 25_000], confidence: "low" },
  ],
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
 * Estimates planning corridors from active app families and the latest population.
 * A completed profile without an app has a zero corridor; incomplete negative
 * findings remain unknown. Multiple distinct families are added once each.
 */
export function digitalPlatformCostEstimate(
  profile: MunicipalityDigitalPlatformProfile,
  population: number,
): DigitalPlatformCostEstimate | null {
  if (!Number.isFinite(population) || population <= 0) return null;
  const classification = digitalPlatformProviderClassification(profile);
  if (!classification) return null;
  if (classification.category === "none") {
    return {
      annualEuros: [0, 0],
      setupEuros: [0, 0],
      confidence: "medium",
      providers: [],
    };
  }

  const sizeBand = population < 2_500 ? 0 : population < 10_000 ? 1 : 2;
  const bands = classification.providers.map(
    (provider) => DIGITAL_PLATFORM_COST_BANDS[provider][sizeBand],
  );
  const sum = (key: "annualEuros" | "setupEuros", index: 0 | 1) =>
    bands.reduce((total, band) => total + band[key][index], 0);
  return {
    annualEuros: [sum("annualEuros", 0), sum("annualEuros", 1)],
    setupEuros: [sum("setupEuros", 0), sum("setupEuros", 1)],
    confidence: bands.every(({ confidence }) => confidence === "medium") ? "medium" : "low",
    providers: classification.providers,
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
