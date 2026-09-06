import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { wikiSources, wikiSourceContributors, wikiSourceRevisions, wikiSourceTags, wikiTags } from "@/db/schema";
import { sourceInputSchema } from "./lib/source-input";
import { normalizeDoi, normalizeIsbn, normalizeUrl } from "./lib/citations";

export function ensureTags(names: string[], userId: string) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].map((name) => {
    const normalizedName = name.toLocaleLowerCase();
    const existing = db.select().from(wikiTags).where(eq(wikiTags.normalizedName, normalizedName)).get();
    if (existing) return existing;
    return db.insert(wikiTags).values({ name, normalizedName, createdBy: userId }).returning().get();
  });
}

function sourceFtsText(source: z.infer<typeof sourceInputSchema>) {
  const contributors = source.contributors.map((person) => person.literal || `${person.given} ${person.family}`).join(" ");
  const metadata = [source.type, source.issuedDate, source.containerTitle, source.publisher, source.institution, source.doi, source.isbn, source.url, ...source.tagNames].join(" ");
  return { contributors, metadata };
}

export function syncSourceFts(id: string, source: z.infer<typeof sourceInputSchema>) {
  const fts = sourceFtsText(source);
  sqlite.prepare("DELETE FROM wiki_sources_fts WHERE source_id = ?").run(id);
  sqlite.prepare("INSERT INTO wiki_sources_fts (source_id, title, contributors, metadata, abstract, notes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, source.title, fts.contributors, fts.metadata, source.abstract, source.notes);
}

export function saveSourceRecord(input: z.infer<typeof sourceInputSchema>, userId: string) {
  const currentUser = { id: userId };
  const data = sourceInputSchema.parse(input);
  data.doi = normalizeDoi(data.doi);
  data.isbn = normalizeIsbn(data.isbn);
  data.url = normalizeUrl(data.url);
  const duplicate = sqlite.prepare(`SELECT id, title FROM wiki_sources WHERE deleted_at IS NULL AND id != coalesce(?, '') AND ((? != '' AND doi = ?) OR (? != '' AND isbn = ?) OR (? != '' AND url = ?)) LIMIT 1`)
    .get(data.id ?? "", data.doi, data.doi, data.isbn, data.isbn, data.url, data.url) as { id: string; title: string } | undefined;
  if (duplicate) return { ok: false as const, duplicate };
  const tags = ensureTags(data.tagNames, currentUser.id);
  const sourceValues = {
    type: data.type, documentType: data.documentType, title: data.title, subtitle: data.subtitle, issuedDate: data.issuedDate,
    containerTitle: data.containerTitle, publisher: data.publisher, institution: data.institution,
    edition: data.edition, volume: data.volume, issue: data.issue, pages: data.pages,
    doi: data.doi, isbn: data.isbn, url: data.url, accessedAt: data.accessedAt,
    language: data.language, abstract: data.abstract, notes: data.notes, readingStatus: data.readingStatus,
  };
  let id = data.id;
  db.transaction(() => {
    if (id) {
      const existing = db.select().from(wikiSources).where(eq(wikiSources.id, id)).get();
      if (!existing) throw new Error("Source not found");
      const oldContributors = db.select().from(wikiSourceContributors).where(eq(wikiSourceContributors.sourceId, id)).all();
      db.insert(wikiSourceRevisions).values({ sourceId: id, version: existing.version, snapshotJson: JSON.stringify({ ...existing, contributors: oldContributors }), createdBy: currentUser.id }).run();
      db.update(wikiSources).set({ ...sourceValues, updatedBy: currentUser.id, updatedAt: new Date(), version: existing.version + 1 }).where(eq(wikiSources.id, id)).run();
    } else {
      const row = db.insert(wikiSources).values({ ...sourceValues, createdBy: currentUser.id, updatedBy: currentUser.id }).returning({ id: wikiSources.id }).get();
      id = row.id;
    }
    db.delete(wikiSourceContributors).where(eq(wikiSourceContributors.sourceId, id!)).run();
    if (data.contributors.length) db.insert(wikiSourceContributors).values(data.contributors.map((person, index) => ({ ...person, sourceId: id!, sortOrder: index }))).run();
    db.delete(wikiSourceTags).where(eq(wikiSourceTags.sourceId, id!)).run();
    if (tags.length) db.insert(wikiSourceTags).values(tags.map((tag) => ({ sourceId: id!, tagId: tag.id }))).run();
    syncSourceFts(id!, data);
  });
  return { ok: true as const, id: id! };
}
