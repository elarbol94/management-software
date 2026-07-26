export const WIKI_TYPOGRAPHY_VERSION = 1 as const;

export type WikiFontFamily = "system" | "serif" | "humanist";
export type WikiTypographyDensity = "compact" | "standard" | "spacious" | "custom";

export type WikiTypographySettingsV1 = {
  version: typeof WIKI_TYPOGRAPHY_VERSION;
  density: WikiTypographyDensity;
  bodyFont: WikiFontFamily;
  headingFont: WikiFontFamily;
  bodySizePt: number;
  lineHeight: number;
  paragraphSpacingEm: number;
  listItemSpacingEm: number;
  listBlockSpacingEm: number;
  listIndentEm: number;
  h1SizeEm: number;
  h2SizeEm: number;
  h3SizeEm: number;
  headingLineHeight: number;
  headingSpacingBeforeEm: number;
  headingSpacingAfterEm: number;
  textColor: string;
  accentColor: string;
  mutedColor: string;
};

export type WikiTypographyTemplate = {
  id: string;
  name: string;
  typography: WikiTypographySettingsV1;
  createdAt: number;
};

export type WikiTypographyProfile = {
  typography: WikiTypographySettingsV1;
  templates: WikiTypographyTemplate[];
};

export const MAX_WIKI_TYPOGRAPHY_TEMPLATES = 20;

type DensityValues = Pick<
  WikiTypographySettingsV1,
  "lineHeight" | "paragraphSpacingEm" | "listItemSpacingEm" | "listBlockSpacingEm" | "listIndentEm"
>;

export const WIKI_TYPOGRAPHY_DENSITY_PRESETS: Record<Exclude<WikiTypographyDensity, "custom">, DensityValues> = {
  compact: {
    lineHeight: 1.35,
    paragraphSpacingEm: 0.4,
    listItemSpacingEm: 0,
    listBlockSpacingEm: 0.45,
    listIndentEm: 1.5,
  },
  standard: {
    lineHeight: 1.5,
    paragraphSpacingEm: 0.65,
    listItemSpacingEm: 0.15,
    listBlockSpacingEm: 0.65,
    listIndentEm: 1.75,
  },
  spacious: {
    lineHeight: 1.7,
    paragraphSpacingEm: 1,
    listItemSpacingEm: 0.4,
    listBlockSpacingEm: 1,
    listIndentEm: 2,
  },
};

export const DEFAULT_WIKI_TYPOGRAPHY: WikiTypographySettingsV1 = {
  version: WIKI_TYPOGRAPHY_VERSION,
  density: "standard",
  bodyFont: "humanist",
  headingFont: "serif",
  bodySizePt: 10.5,
  ...WIKI_TYPOGRAPHY_DENSITY_PRESETS.standard,
  h1SizeEm: 2,
  h2SizeEm: 1.5,
  h3SizeEm: 1.25,
  headingLineHeight: 1.2,
  headingSpacingBeforeEm: 1.4,
  headingSpacingAfterEm: 0.45,
  textColor: "#172033",
  accentColor: "#315EFB",
  mutedColor: "#667085",
};

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function font(value: unknown, fallback: WikiFontFamily): WikiFontFamily {
  return value === "system" || value === "serif" || value === "humanist" ? value : fallback;
}

export function normalizeWikiTypography(value: unknown): WikiTypographySettingsV1 {
  const input = value && typeof value === "object" ? value as Partial<WikiTypographySettingsV1> : {};
  const density: WikiTypographyDensity = ["compact", "standard", "spacious", "custom"].includes(input.density ?? "")
    ? input.density as WikiTypographyDensity
    : DEFAULT_WIKI_TYPOGRAPHY.density;
  return {
    version: WIKI_TYPOGRAPHY_VERSION,
    density,
    bodyFont: font(input.bodyFont, DEFAULT_WIKI_TYPOGRAPHY.bodyFont),
    headingFont: font(input.headingFont, DEFAULT_WIKI_TYPOGRAPHY.headingFont),
    bodySizePt: finiteNumber(input.bodySizePt, DEFAULT_WIKI_TYPOGRAPHY.bodySizePt, 8, 16),
    lineHeight: finiteNumber(input.lineHeight, DEFAULT_WIKI_TYPOGRAPHY.lineHeight, 1.1, 2),
    paragraphSpacingEm: finiteNumber(input.paragraphSpacingEm, DEFAULT_WIKI_TYPOGRAPHY.paragraphSpacingEm, 0, 2),
    listItemSpacingEm: finiteNumber(input.listItemSpacingEm, DEFAULT_WIKI_TYPOGRAPHY.listItemSpacingEm, 0, 1.25),
    listBlockSpacingEm: finiteNumber(input.listBlockSpacingEm, DEFAULT_WIKI_TYPOGRAPHY.listBlockSpacingEm, 0, 2),
    listIndentEm: finiteNumber(input.listIndentEm, DEFAULT_WIKI_TYPOGRAPHY.listIndentEm, 1, 4),
    h1SizeEm: finiteNumber(input.h1SizeEm, DEFAULT_WIKI_TYPOGRAPHY.h1SizeEm, 1.5, 3.5),
    h2SizeEm: finiteNumber(input.h2SizeEm, DEFAULT_WIKI_TYPOGRAPHY.h2SizeEm, 1.2, 2.75),
    h3SizeEm: finiteNumber(input.h3SizeEm, DEFAULT_WIKI_TYPOGRAPHY.h3SizeEm, 1, 2),
    headingLineHeight: finiteNumber(input.headingLineHeight, DEFAULT_WIKI_TYPOGRAPHY.headingLineHeight, 1, 1.6),
    headingSpacingBeforeEm: finiteNumber(input.headingSpacingBeforeEm, DEFAULT_WIKI_TYPOGRAPHY.headingSpacingBeforeEm, 0, 3),
    headingSpacingAfterEm: finiteNumber(input.headingSpacingAfterEm, DEFAULT_WIKI_TYPOGRAPHY.headingSpacingAfterEm, 0, 2),
    textColor: color(input.textColor, DEFAULT_WIKI_TYPOGRAPHY.textColor),
    accentColor: color(input.accentColor, DEFAULT_WIKI_TYPOGRAPHY.accentColor),
    mutedColor: color(input.mutedColor, DEFAULT_WIKI_TYPOGRAPHY.mutedColor),
  };
}

export function parseWikiTypography(value: string | null | undefined) {
  return parseWikiTypographyProfile(value).typography;
}

export function serializeWikiTypography(settings: WikiTypographySettingsV1) {
  return serializeWikiTypographyProfile({ typography: settings, templates: [] });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeWikiTypographyTemplates(value: unknown): WikiTypographyTemplate[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const templates: WikiTypographyTemplate[] = [];
  for (const candidate of value) {
    if (templates.length >= MAX_WIKI_TYPOGRAPHY_TEMPLATES) break;
    const input = record(candidate);
    const id = typeof input?.id === "string" ? input.id.trim().slice(0, 120) : "";
    const name = typeof input?.name === "string" ? input.name.trim().slice(0, 80) : "";
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    templates.push({
      id,
      name,
      typography: normalizeWikiTypography(input?.typography),
      createdAt: finiteNumber(input?.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
    });
  }
  return templates;
}

export function normalizeWikiTypographyProfile(value: unknown): WikiTypographyProfile {
  const input = record(value);
  return {
    // Existing V1 values stored directly in the JSON column remain valid.
    typography: normalizeWikiTypography(input?.typography ?? input),
    templates: normalizeWikiTypographyTemplates(input?.templates),
  };
}

export function parseWikiTypographyProfile(value: string | null | undefined): WikiTypographyProfile {
  if (!value?.trim()) return normalizeWikiTypographyProfile(null);
  try {
    return normalizeWikiTypographyProfile(JSON.parse(value));
  } catch {
    return normalizeWikiTypographyProfile(null);
  }
}

export function serializeWikiTypographyProfile(profile: WikiTypographyProfile) {
  const normalized = normalizeWikiTypographyProfile(profile);
  // Keep typography at the root so prior V1 clients can still read it safely.
  return JSON.stringify({ ...normalized.typography, templates: normalized.templates });
}

export function applyWikiTypographyDensity(
  settings: WikiTypographySettingsV1,
  density: Exclude<WikiTypographyDensity, "custom">,
) {
  return normalizeWikiTypography({ ...settings, ...WIKI_TYPOGRAPHY_DENSITY_PRESETS[density], density });
}

export function wikiFontStack(value: WikiFontFamily) {
  if (value === "serif") return `Georgia, "Times New Roman", serif`;
  if (value === "humanist") return `"Segoe UI", "Aptos", Arial, sans-serif`;
  return `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

export function wikiTypographyCssVariables(settings: WikiTypographySettingsV1): Record<string, string> {
  const value = normalizeWikiTypography(settings);
  return {
    "--wiki-body-font": wikiFontStack(value.bodyFont),
    "--wiki-heading-font": wikiFontStack(value.headingFont),
    "--wiki-body-size": `${value.bodySizePt}pt`,
    "--wiki-line-height": String(value.lineHeight),
    "--wiki-paragraph-spacing": `${value.paragraphSpacingEm}em`,
    "--wiki-list-item-spacing": `${value.listItemSpacingEm}em`,
    "--wiki-list-block-spacing": `${value.listBlockSpacingEm}em`,
    "--wiki-list-indent": `${value.listIndentEm}em`,
    "--wiki-h1-size": `${value.h1SizeEm}em`,
    "--wiki-h2-size": `${value.h2SizeEm}em`,
    "--wiki-h3-size": `${value.h3SizeEm}em`,
    "--wiki-heading-line-height": String(value.headingLineHeight),
    "--wiki-heading-before": `${value.headingSpacingBeforeEm}em`,
    "--wiki-heading-after": `${value.headingSpacingAfterEm}em`,
    "--wiki-text-color": value.textColor,
    "--wiki-accent-color": value.accentColor,
    "--wiki-muted-color": value.mutedColor,
  };
}
