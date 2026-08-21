import { z } from "zod";

export const municipalityMinuteTopics = [
  "budget_finance",
  "spatial_planning_housing",
  "transport_public_space",
  "water_sewer_waste",
  "education_childcare",
  "social_health",
  "climate_environment_energy",
  "economy_location",
  "leisure_culture_tourism",
  "fire_safety",
  "administration_personnel",
  "participation_transparency",
] as const;

export const municipalityMinuteActivityTypes = [
  "decision",
  "procurement",
  "financing",
  "funding",
  "contract",
  "regulation",
  "planning",
  "report",
  "motion",
  "personnel",
  "election",
  "discussion",
] as const;

export const municipalityMinuteDecisionStatuses = [
  "approved",
  "rejected",
  "postponed",
  "acknowledged",
  "open",
  "not_applicable",
  "unclear",
] as const;

const evidenceSchema = z.object({
  page: z.number().int().positive(),
  quote: z.string().trim().min(1).max(400),
});

const financialAmountSchema = z.object({
  amountEur: z.number().nonnegative(),
  purpose: z.string().trim().min(1).max(300),
});

export const municipalityMinuteAgendaItemSchema = z.object({
  itemNumber: z.string().trim().max(40),
  title: z.string().trim().min(1).max(300),
  topics: z.array(z.enum(municipalityMinuteTopics)).min(1),
  activityType: z.enum(municipalityMinuteActivityTypes),
  summary: z.string().trim().min(1).max(1_500),
  decisionStatus: z.enum(municipalityMinuteDecisionStatuses),
  vote: z.string().trim().max(300),
  financialAmounts: z.array(financialAmountSchema),
  locations: z.array(z.string().trim().min(1).max(200)),
  projectNames: z.array(z.string().trim().min(1).max(300)),
  evidence: z.array(evidenceSchema).min(1),
  containsPersonalData: z.boolean(),
});

export const municipalityMinuteAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  municipalityCode: z.string().regex(/^\d{5}$/),
  documentId: z.string().min(1),
  meetingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  meetingType: z.enum(["municipal_council", "constituent_council", "unknown"]),
  shortSummary: z.string().trim().min(1).max(2_000),
  agendaItems: z.array(municipalityMinuteAgendaItemSchema),
  warnings: z.array(z.string().trim().min(1).max(500)),
});

export type MunicipalityMinuteAnalysis = z.infer<typeof municipalityMinuteAnalysisSchema>;

export type MinuteTextPage = {
  page: number;
  text: string;
  extractionMethod: "native" | "ocr" | "empty";
};

export function dateFromMinutePath(relativePath: string) {
  const yearMatch = relativePath.match(/(?:^|\/)(20\d{2})(?:\/|$)/);
  const year = yearMatch?.[1];
  const leaf = relativePath.split("/").at(-1) ?? relativePath;
  const dayFirstMatches = [...leaf.matchAll(/(?:^|\D)([0-3]?\d)[._-]([01]?\d)[._-]+(20\d{2})(?=\D|$)/g)];
  for (const match of dayFirstMatches.reverse()) {
    const [, day, month, candidateYear] = match;
    const value = `${candidateYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (validIsoDate(value)) return value;
  }
  const yearFirst = leaf.match(/(?:^|\D)(20\d{2})[._-]([01]?\d)[._-]([0-3]?\d)(?=\D|$)/);
  if (yearFirst) {
    const [, candidateYear, month, day] = yearFirst;
    const value = `${candidateYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return validIsoDate(value) ? value : null;
  }
  if (!year) return null;
  const withoutYear = leaf.match(/(?:^|\D)([0-3]?\d)[._-]([01]?\d)(?:\D|$)/);
  if (!withoutYear) return null;
  const value = `${year}-${withoutYear[2].padStart(2, "0")}-${withoutYear[1].padStart(2, "0")}`;
  return validIsoDate(value) ? value : null;
}

const germanMonths: Record<string, string> = {
  januar: "01", jänner: "01", februar: "02", märz: "03", april: "04",
  mai: "05", juni: "06", juli: "07", august: "08", september: "09",
  oktober: "10", november: "11", dezember: "12",
};

export function dateFromMinuteText(text: string) {
  const numeric = text.match(/(?:^|\D)([0-3]?\d)[.\/-]([01]?\d)[.\/-](20\d{2})(?:\D|$)/);
  if (numeric) {
    const value = `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
    if (validIsoDate(value)) return value;
  }
  const written = text.toLocaleLowerCase("de-AT").match(
    /(?:^|\D)([0-3]?\d)\.\s*(januar|jänner|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(20\d{2})(?:\D|$)/,
  );
  if (!written) return null;
  const value = `${written[3]}-${germanMonths[written[2]]}-${written[1].padStart(2, "0")}`;
  return validIsoDate(value) ? value : null;
}

function validIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizedEvidenceText(value: string) {
  return value.toLocaleLowerCase("de-AT")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function analysisHasValidEvidence(analysis: MunicipalityMinuteAnalysis, pages: MinuteTextPage[]) {
  const byPage = new Map(pages.map((page) => [page.page, normalizedEvidenceText(page.text)]));
  return analysis.agendaItems.every((item) => item.evidence.every((evidence) => {
    const pageText = byPage.get(evidence.page);
    return Boolean(pageText?.includes(normalizedEvidenceText(evidence.quote)));
  }));
}
