import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

type LanguageToolMatch = {
  offset?: number;
  length?: number;
  message?: string;
  replacements?: Array<{ value?: string }>;
};

const MAX_PARAGRAPHS = 80;
const MAX_CHARACTERS = 24_000;
const CHECK_CONCURRENCY = 2;

export async function POST(request: Request) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let paragraphs: unknown;
  try { ({ paragraphs } = await request.json()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(paragraphs) || paragraphs.length > MAX_PARAGRAPHS || paragraphs.some((item) => typeof item !== "string")) {
    return NextResponse.json({ error: "Invalid paragraphs" }, { status: 400 });
  }
  const validParagraphs = paragraphs as string[];
  if (validParagraphs.reduce((size, item) => size + item.length, 0) > MAX_CHARACTERS) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const baseUrl = process.env.LANGUAGETOOL_URL ?? "http://languagetool:8010";
  const endpoint = new URL("/v2/check", baseUrl);
  try {
    const checkParagraph = async (text: string, paragraph: number) => {
      const body = new URLSearchParams({ text, language: "auto", enabledOnly: "false" });
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`LanguageTool returned ${response.status}`);
      const payload = await response.json() as { matches?: LanguageToolMatch[] };
      return (payload.matches ?? []).flatMap((match) => {
        if (!Number.isInteger(match.offset) || !Number.isInteger(match.length) || !match.message) return [];
        return [{
          paragraph,
          offset: match.offset,
          length: match.length,
          message: match.message,
          replacements: (match.replacements ?? []).map((replacement) => replacement.value ?? "").filter(Boolean).slice(0, 5),
        }];
      });
    };
    const results: Array<Awaited<ReturnType<typeof checkParagraph>>> = [];
    let nextParagraph = 0;
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, validParagraphs.length) }, async () => {
      while (nextParagraph < validParagraphs.length) {
        const paragraph = nextParagraph++;
        results.push(await checkParagraph(validParagraphs[paragraph], paragraph));
      }
    }));
    return NextResponse.json({ matches: results.flat() });
  } catch {
    return NextResponse.json({ error: "Rechtschreibprüfung ist momentan nicht erreichbar." }, { status: 503 });
  }
}
