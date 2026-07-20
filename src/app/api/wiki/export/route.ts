import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { wikiSourceContributors, wikiSources } from "@/db/schema";
import { asc, eq, isNull } from "drizzle-orm";
import { toBibTeX, toRis } from "@/modules/wiki/lib/interchange";
export async function GET(request: Request) { if (!await getSession()) return new Response("Unauthorized", { status: 401 }); const format = new URL(request.url).searchParams.get("format") === "ris" ? "ris" : "bibtex"; const sources = db.select().from(wikiSources).where(isNull(wikiSources.deletedAt)).orderBy(asc(wikiSources.title)).all(); const output = sources.map((source) => { const contributors = db.select().from(wikiSourceContributors).where(eq(wikiSourceContributors.sourceId, source.id)).orderBy(asc(wikiSourceContributors.sortOrder)).all(); return format === "ris" ? toRis({ ...source, contributors }) : toBibTeX({ ...source, contributors }); }).join("\n\n"); return new Response(output, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="research-library.${format === "ris" ? "ris" : "bib"}"` } }); }
