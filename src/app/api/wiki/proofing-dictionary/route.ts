import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { wikiProofingWords } from "@/db/schema";
import { getSession } from "@/lib/auth";

const languageSchema = z.enum(["de-DE", "en-US"]);
const addWordSchema = z.object({
  language: languageSchema,
  word: z.string().trim().min(1).max(100),
});

function normalizeWord(word: string, language: "de-DE" | "en-US") {
  return word.normalize("NFKC").toLocaleLowerCase(language);
}

export async function GET(request: Request) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = languageSchema.safeParse(new URL(request.url).searchParams.get("language"));
  if (!parsed.success) return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  const words = db.select({ word: wikiProofingWords.word }).from(wikiProofingWords)
    .where(eq(wikiProofingWords.language, parsed.data)).orderBy(asc(wikiProofingWords.word)).all();
  return NextResponse.json({ words: words.map((item) => item.word) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = addWordSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "Invalid word" }, { status: 400 });
  const normalizedWord = normalizeWord(parsed.data.word, parsed.data.language);
  db.insert(wikiProofingWords).values({
    language: parsed.data.language,
    word: parsed.data.word,
    normalizedWord,
    createdBy: session.user.id,
  }).onConflictDoNothing().run();
  const stored = db.select({ word: wikiProofingWords.word }).from(wikiProofingWords)
    .where(and(eq(wikiProofingWords.language, parsed.data.language), eq(wikiProofingWords.normalizedWord, normalizedWord))).get();
  return NextResponse.json({ word: stored?.word ?? parsed.data.word });
}
