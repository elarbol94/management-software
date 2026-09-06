import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { z } from "zod";

type ProofingLanguage = "de-DE" | "de-AT" | "en-US";
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

const serviceMatchSchema = z.object({
  offset: z.number().int().nonnegative(), length: z.number().int().positive(), message: z.string().min(1),
  replacements: z.array(z.object({ value: z.string() })).optional(),
  rule: z.object({ id: z.string().optional(), issueType: z.string().optional(),
    category: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  }).optional(),
});

const MAX_PARAGRAPHS = 80;
const MAX_CHARACTERS = 24_000;
const PARAGRAPH_SEPARATOR = "\n\n";
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const resultCache = new Map<string, { expiresAt: number; matches: LanguageToolMatch[] }>();
type ServiceCheck = { promise: Promise<LanguageToolMatch[]>; abort: AbortController; consumers: number };
const inFlightChecks = new Map<string, ServiceCheck>();
type ServiceTiming = { cache: "hit" | "shared" | "miss"; duration: number };

function cacheKey(text: string, language: ProofingLanguage, picky: boolean) {
  return `${language}\u0000${picky ? "picky" : "default"}\u0000${text}`;
}

function trimCache() {
  while (resultCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    if (typeof oldestKey !== "string") return;
    resultCache.delete(oldestKey);
  }
}

async function checkWithLanguageTool(text: string, language: ProofingLanguage, picky: boolean, signal: AbortSignal, timing: ServiceTiming) {
  signal.throwIfAborted();
  const started = performance.now();
  const key = cacheKey(text, language, picky);
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) { timing.cache = "hit"; return cached.matches; }
  if (cached) resultCache.delete(key);
  let running = inFlightChecks.get(key);
  timing.cache = running ? "shared" : "miss";
  if (!running) {
    const abort = new AbortController();
    const promise = (async () => {
      const baseUrl = process.env.LANGUAGETOOL_URL ?? "http://languagetool:8010";
      const endpoint = new URL("/v2/check", baseUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ text, language, enabledOnly: "false", level: picky ? "picky" : "default" }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6_000)]),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`LanguageTool returned ${response.status}`);
      const payload = await response.json() as { matches?: LanguageToolMatch[] };
      if (!payload || !Array.isArray(payload.matches)) throw new Error("Invalid LanguageTool response");
      const matches = payload.matches;
      abort.signal.throwIfAborted();
      resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, matches });
      trimCache();
      return matches;
    })();
    running = { promise, abort, consumers: 0 };
    inFlightChecks.set(key, running);
  }
  const check = running;
  check.consumers++;
  let onAbort!: () => void;
  try {
    // A departing editor must not cancel another editor's identical check.
    return await Promise.race([check.promise, new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
  } finally {
    timing.duration = performance.now() - started;
    signal.removeEventListener("abort", onAbort);
    if (--check.consumers === 0) {
      if (inFlightChecks.get(key) === check) inFlightChecks.delete(key);
      check.abort.abort();
    }
  }
}

function normalizeMatches(rawMatches: LanguageToolMatch[], text: string, paragraphRanges: Array<{ paragraph: number; from: number; to: number }>, dictionary: Set<string>, language: ProofingLanguage) {
  const candidates = rawMatches.flatMap((raw): NormalizedMatch[] => {
    const parsed = serviceMatchSchema.safeParse(raw);
    if (!parsed.success) return [];
    const match = parsed.data;
    const matchOffset = match.offset;
    const matchLength = match.length;
    const matchEnd = matchOffset + matchLength;
    const range = paragraphRanges.find(({ from, to }) => matchOffset >= from && matchEnd <= to);
    if (!range) return [];
    const matchedText = text.slice(matchOffset, matchEnd);
    if (match.rule?.issueType === "misspelling" && dictionary.has(matchedText.normalize("NFKC").toLocaleLowerCase(language))) return [];
    return [{
      paragraph: range.paragraph,
      offset: matchOffset - range.from,
      length: matchLength,
      message: match.message,
      kind: match.rule?.issueType === "misspelling" ? "spelling" : "writing",
      category: match.rule?.category?.name ?? match.rule?.category?.id ?? "",
      ruleId: match.rule?.id ?? "",
      replacements: [...new Set((match.replacements ?? []).map((replacement) => replacement.value))],
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
  const started = performance.now();
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const authMs = performance.now() - started;

  let paragraphs: unknown;
  let language: unknown;
  let dictionary: unknown;
  let picky: unknown;
  try { ({ paragraphs, language, dictionary, picky } = await request.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(paragraphs) || paragraphs.length > MAX_PARAGRAPHS || paragraphs.some((item) => typeof item !== "string")) return NextResponse.json({ error: "Invalid paragraphs" }, { status: 400 });
  if (language !== "de-DE" && language !== "de-AT" && language !== "en-US") return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  if (dictionary !== undefined && (!Array.isArray(dictionary) || dictionary.length > 500 || dictionary.some((item) => typeof item !== "string" || item.length > 100))) return NextResponse.json({ error: "Invalid dictionary" }, { status: 400 });
  if (picky !== undefined && typeof picky !== "boolean") return NextResponse.json({ error: "Invalid picky" }, { status: 400 });
  const isPicky = picky === true;
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
  const timing: ServiceTiming = { cache: "miss", duration: 0 };
  const timingHeaders = (normalizeMs = 0) => ({
    "Server-Timing": `auth;dur=${authMs.toFixed(1)}, cache;desc="${timing.cache}", ${timing.cache === "shared" ? "shared_wait" : "languagetool"};dur=${timing.duration.toFixed(1)}, normalize;dur=${normalizeMs.toFixed(1)}, total;dur=${(performance.now() - started).toFixed(1)}`,
    "Cache-Control": "no-store",
  });
  try {
    const rawMatches = await checkWithLanguageTool(combinedText, language, isPicky, request.signal, timing);
    const normalizeStarted = performance.now();
    const matches = normalizeMatches(rawMatches, combinedText, paragraphRanges, normalizedDictionary, language);
    return NextResponse.json({ matches }, { headers: timingHeaders(performance.now() - normalizeStarted) });
  } catch {
    return NextResponse.json({ error: "Rechtschreibprüfung ist momentan nicht erreichbar." }, { status: request.signal.aborted ? 499 : 503, headers: timingHeaders() });
  }
}
