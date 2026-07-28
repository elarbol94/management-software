import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type ProofingLanguage = "de-DE" | "en-US";
type LanguageToolMatch = {
  offset?: number;
  length?: number;
  message?: string;
  replacements?: Array<{ value?: string }>;
  rule?: {
    id?: string;
    issueType?: string;
    category?: { id?: string; name?: string };
  };
};
type NormalizedMatch = {
  paragraph: number;
  offset: number;
  length: number;
  message: string;
  kind: "spelling" | "writing";
  category: string;
  ruleId: string;
  replacements: string[];
};

const MAX_PARAGRAPHS = 80;
const MAX_CHARACTERS = 24_000;
const PARAGRAPH_SEPARATOR = "\n\n";
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const resultCache = new Map<string, { expiresAt: number; matches: LanguageToolMatch[] }>();
const inFlightChecks = new Map<string, Promise<LanguageToolMatch[]>>();

function cacheKey(text: string, language: ProofingLanguage) {
  return `${language}\u0000${text}`;
}

function trimCache() {
  while (resultCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    if (typeof oldestKey !== "string") return;
    resultCache.delete(oldestKey);
  }
}

async function checkWithLanguageTool(text: string, language: ProofingLanguage) {
  const key = cacheKey(text, language);
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;
  if (cached) resultCache.delete(key);
  const running = inFlightChecks.get(key);
  if (running) return running;

  const promise = (async () => {
    const baseUrl = process.env.LANGUAGETOOL_URL ?? "http://languagetool:8010";
    const endpoint = new URL("/v2/check", baseUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      body: new URLSearchParams({ text, language, enabledOnly: "false" }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`LanguageTool returned ${response.status}`);
    const payload = await response.json() as { matches?: LanguageToolMatch[] };
    const matches = payload.matches ?? [];
    resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, matches });
    trimCache();
    return matches;
  })();
  inFlightChecks.set(key, promise);
  try { return await promise; } finally { inFlightChecks.delete(key); }
}

function normalizeMatches(rawMatches: LanguageToolMatch[], text: string, paragraphRanges: Array<{ paragraph: number; from: number; to: number }>, dictionary: Set<string>, language: ProofingLanguage) {
  const candidates = rawMatches.flatMap((match): NormalizedMatch[] => {
    if (typeof match.offset !== "number" || !Number.isInteger(match.offset) || typeof match.length !== "number" || !Number.isInteger(match.length) || !match.message) return [];
    const matchOffset = match.offset;
    const matchLength = match.length;
    const matchEnd = matchOffset + matchLength;
    const range = paragraphRanges.find(({ from, to }) => matchOffset >= from && matchEnd <= to);
    if (!range) return [];
    const matchedText = text.slice(matchOffset, matchEnd);
    if (dictionary.has(matchedText.normalize("NFKC").toLocaleLowerCase(language))) return [];
    return [{
      paragraph: range.paragraph,
      offset: matchOffset - range.from,
      length: matchLength,
      message: match.message,
      kind: match.rule?.issueType === "misspelling" ? "spelling" : "writing",
      category: match.rule?.category?.name ?? match.rule?.category?.id ?? "",
      ruleId: match.rule?.id ?? "",
      replacements: [...new Set((match.replacements ?? []).map((replacement) => replacement.value ?? "").filter(Boolean))],
    }];
  });

  const selected: NormalizedMatch[] = [];
  for (const candidate of candidates.sort((left, right) => left.paragraph - right.paragraph || left.offset - right.offset || (left.kind === right.kind ? 0 : left.kind === "spelling" ? -1 : 1) || left.length - right.length)) {
    const overlaps = selected.some((item) => item.paragraph === candidate.paragraph && item.offset < candidate.offset + candidate.length && candidate.offset < item.offset + item.length);
    if (!overlaps) selected.push(candidate);
  }
  return selected.sort((left, right) => left.paragraph - right.paragraph || left.offset - right.offset);
}

export async function POST(request: Request) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let paragraphs: unknown;
  let language: unknown;
  let dictionary: unknown;
  try { ({ paragraphs, language, dictionary } = await request.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(paragraphs) || paragraphs.length > MAX_PARAGRAPHS || paragraphs.some((item) => typeof item !== "string")) return NextResponse.json({ error: "Invalid paragraphs" }, { status: 400 });
  if (language !== "de-DE" && language !== "en-US") return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  if (dictionary !== undefined && (!Array.isArray(dictionary) || dictionary.length > 500 || dictionary.some((item) => typeof item !== "string" || item.length > 100))) return NextResponse.json({ error: "Invalid dictionary" }, { status: 400 });
  const validParagraphs = paragraphs as string[];
  if (validParagraphs.reduce((size, item) => size + item.length, 0) > MAX_CHARACTERS) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  if (!validParagraphs.length) return NextResponse.json({ matches: [] });

  const paragraphRanges: Array<{ paragraph: number; from: number; to: number }> = [];
  let combinedLength = 0;
  for (const [paragraph, text] of validParagraphs.entries()) {
    paragraphRanges.push({ paragraph, from: combinedLength, to: combinedLength + text.length });
    combinedLength += text.length + (paragraph < validParagraphs.length - 1 ? PARAGRAPH_SEPARATOR.length : 0);
  }
  const combinedText = validParagraphs.join(PARAGRAPH_SEPARATOR);
  const normalizedDictionary = new Set(((dictionary as string[] | undefined) ?? []).map((word) => word.normalize("NFKC").toLocaleLowerCase(language)));
  try {
    const rawMatches = await checkWithLanguageTool(combinedText, language);
    return NextResponse.json({ matches: normalizeMatches(rawMatches, combinedText, paragraphRanges, normalizedDictionary, language) });
  } catch {
    return NextResponse.json({ error: "Rechtschreibprüfung ist momentan nicht erreichbar." }, { status: 503 });
  }
}
