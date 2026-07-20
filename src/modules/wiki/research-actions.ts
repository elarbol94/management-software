"use server";

import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, sqlite } from "@/db";
import {
  user,
  wikiCommentThreads,
  wikiComments,
  wikiFavorites,
  wikiNotifications,
  wikiPageRevisions,
  wikiPages,
  wikiPageSources,
  wikiPageTags,
  wikiSourceContributors,
  wikiSourceRevisions,
  wikiSources,
  wikiSourceTags,
  wikiTags,
} from "@/db/schema";
import { requireAdmin, requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor } from "@/lib/files";
import { normalizeDoi, normalizeIsbn, normalizeUrl } from "./lib/citations";
import { slugify } from "./lib/tiptap";
import { buildFtsQuery } from "./lib/tiptap";

function revalidateWiki() {
  revalidatePath("/wiki", "layout");
}

function uniquePageSlug(title: string) {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (db.select({ id: wikiPages.id }).from(wikiPages).where(eq(wikiPages.slug, slug)).get()) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

export async function createQuickNote(locale: "de" | "en" = "de") {
  const currentUser = await requireUserOrThrow();
  const title = locale === "de" ? "Unbenannte Notiz" : "Untitled note";
  const row = db.insert(wikiPages).values({
    title,
    slug: uniquePageSlug(title),
    status: "inbox",
    citationLocale: locale === "de" ? "de-DE" : "en-US",
    createdBy: currentUser.id,
    updatedBy: currentUser.id,
  }).returning({ id: wikiPages.id, slug: wikiPages.slug }).get();
  sqlite.prepare("INSERT INTO wiki_pages_fts (page_id, title, content_text) VALUES (?, ?, '')").run(row.id, title);
  revalidateWiki();
  return row;
}

const pageMetaSchema = z.object({
  pageId: z.string().min(1),
  status: z.enum(["inbox", "working", "evergreen"]),
  citationLocale: z.enum(["de-DE", "en-US"]),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(20),
});

function ensureTags(names: string[], userId: string) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].map((name) => {
    const normalizedName = name.toLocaleLowerCase();
    const existing = db.select().from(wikiTags).where(eq(wikiTags.normalizedName, normalizedName)).get();
    if (existing) return existing;
    return db.insert(wikiTags).values({ name, normalizedName, createdBy: userId }).returning().get();
  });
}

export async function updatePageResearchMeta(input: z.infer<typeof pageMetaSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = pageMetaSchema.parse(input);
  const page = db.select().from(wikiPages).where(and(eq(wikiPages.id, data.pageId), isNull(wikiPages.deletedAt))).get();
  if (!page) throw new Error("Page not found");
  const tags = ensureTags(data.tagNames, currentUser.id);
  db.transaction(() => {
    db.insert(wikiPageRevisions).values({ pageId: page.id, version: page.version, title: page.title, contentJson: page.contentJson, status: page.status, citationLocale: page.citationLocale, kind: "autosave", createdBy: currentUser.id }).run();
    db.update(wikiPages).set({ status: data.status, citationLocale: data.citationLocale, updatedBy: currentUser.id, updatedAt: new Date(), version: page.version + 1 }).where(eq(wikiPages.id, page.id)).run();
    db.delete(wikiPageTags).where(eq(wikiPageTags.pageId, page.id)).run();
    if (tags.length) db.insert(wikiPageTags).values(tags.map((tag) => ({ pageId: page.id, tagId: tag.id }))).run();
  });
  revalidateWiki();
}

export async function toggleFavorite(entityType: "page" | "source", entityId: string) {
  const currentUser = await requireUserOrThrow();
  const where = and(eq(wikiFavorites.userId, currentUser.id), eq(wikiFavorites.entityType, entityType), eq(wikiFavorites.entityId, entityId));
  const existing = db.select().from(wikiFavorites).where(where).get();
  if (existing) db.delete(wikiFavorites).where(where).run();
  else db.insert(wikiFavorites).values({ userId: currentUser.id, entityType, entityId }).run();
  revalidateWiki();
  return { favorite: !existing };
}

const contributorSchema = z.object({ role: z.enum(["author", "editor"]), given: z.string().max(120), family: z.string().max(120), literal: z.string().max(240) });
export const sourceInputSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["journalArticle", "book", "bookChapter", "report", "webPage", "document"]),
  title: z.string().trim().min(1).max(500), subtitle: z.string().max(500).default(""),
  issuedDate: z.string().max(20).default(""), containerTitle: z.string().max(500).default(""),
  publisher: z.string().max(300).default(""), institution: z.string().max(300).default(""),
  edition: z.string().max(80).default(""), volume: z.string().max(80).default(""), issue: z.string().max(80).default(""), pages: z.string().max(80).default(""),
  doi: z.string().max(300).default(""), isbn: z.string().max(40).default(""), url: z.string().max(2000).default(""),
  accessedAt: z.string().max(20).default(""), language: z.string().max(40).default(""),
  abstract: z.string().max(20_000).default(""), notes: z.string().max(20_000).default(""),
  readingStatus: z.enum(["toRead", "reading", "read"]).default("toRead"),
  contributors: z.array(contributorSchema).max(100).default([]),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});

function sourceFtsText(source: z.infer<typeof sourceInputSchema>) {
  const contributors = source.contributors.map((person) => person.literal || `${person.given} ${person.family}`).join(" ");
  const metadata = [source.type, source.issuedDate, source.containerTitle, source.publisher, source.institution, source.doi, source.isbn, source.url, ...source.tagNames].join(" ");
  return { contributors, metadata };
}

function syncSourceFts(id: string, source: z.infer<typeof sourceInputSchema>) {
  const fts = sourceFtsText(source);
  sqlite.prepare("DELETE FROM wiki_sources_fts WHERE source_id = ?").run(id);
  sqlite.prepare("INSERT INTO wiki_sources_fts (source_id, title, contributors, metadata, abstract, notes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, source.title, fts.contributors, fts.metadata, source.abstract, source.notes);
}

export async function saveSource(input: z.infer<typeof sourceInputSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = sourceInputSchema.parse(input);
  data.doi = normalizeDoi(data.doi);
  data.isbn = normalizeIsbn(data.isbn);
  data.url = normalizeUrl(data.url);
  const duplicate = sqlite.prepare(`SELECT id, title FROM wiki_sources WHERE deleted_at IS NULL AND id != coalesce(?, '') AND ((? != '' AND doi = ?) OR (? != '' AND isbn = ?) OR (? != '' AND url = ?)) LIMIT 1`)
    .get(data.id ?? "", data.doi, data.doi, data.isbn, data.isbn, data.url, data.url) as { id: string; title: string } | undefined;
  if (duplicate) return { ok: false as const, duplicate };
  const tags = ensureTags(data.tagNames, currentUser.id);
  const sourceValues = {
    type: data.type, title: data.title, subtitle: data.subtitle, issuedDate: data.issuedDate,
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
  revalidateWiki();
  return { ok: true as const, id: id! };
}

export async function linkSupportingSource(pageId: string, sourceId: string) {
  await requireUserOrThrow();
  db.insert(wikiPageSources).values({ pageId, sourceId, relation: "supporting" }).onConflictDoNothing().run();
  revalidateWiki();
}

export async function unlinkSupportingSource(pageId: string, sourceId: string) {
  await requireUserOrThrow();
  db.delete(wikiPageSources).where(and(eq(wikiPageSources.pageId, pageId), eq(wikiPageSources.sourceId, sourceId), eq(wikiPageSources.relation, "supporting"))).run();
  revalidateWiki();
}

export async function deleteSource(id: string) {
  const currentUser = await requireUserOrThrow();
  db.update(wikiSources).set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: currentUser.id }).where(eq(wikiSources.id, id)).run();
  sqlite.prepare("DELETE FROM wiki_sources_fts WHERE source_id = ?").run(id);
  revalidateWiki();
}

export async function restoreFromTrash(entityType: "page" | "source", id: string) {
  const currentUser = await requireUserOrThrow();
  if (entityType === "page") {
    const page = db.select().from(wikiPages).where(eq(wikiPages.id, id)).get();
    if (!page) throw new Error("Page not found");
    const all = db.select().from(wikiPages).all();
    const restoreIds = new Set<string>([id]);
    let changed = true;
    while (changed) { changed = false; for (const candidate of all) if (candidate.parentId && restoreIds.has(candidate.parentId) && !restoreIds.has(candidate.id)) { restoreIds.add(candidate.id); changed = true; } }
    const originalParentExists = page.parentId ? all.some((candidate) => candidate.id === page.parentId && !candidate.deletedAt) : true;
    db.transaction(() => {
      for (const candidate of all.filter((item) => restoreIds.has(item.id))) {
        db.update(wikiPages).set({ deletedAt: null, ...(candidate.id === id && !originalParentExists ? { parentId: null } : {}), updatedBy: currentUser.id }).where(eq(wikiPages.id, candidate.id)).run();
        sqlite.prepare("DELETE FROM wiki_pages_fts WHERE page_id = ?").run(candidate.id);
        sqlite.prepare("INSERT INTO wiki_pages_fts (page_id, title, content_text) VALUES (?, ?, ?)").run(candidate.id, candidate.title, candidate.contentText);
      }
    });
  } else {
    const source = db.select().from(wikiSources).where(eq(wikiSources.id, id)).get();
    if (!source) throw new Error("Source not found");
    db.update(wikiSources).set({ deletedAt: null, updatedBy: currentUser.id }).where(eq(wikiSources.id, id)).run();
    const contributors = db.select().from(wikiSourceContributors).where(eq(wikiSourceContributors.sourceId, id)).all();
    const tagNames = db.select({ name: wikiTags.name }).from(wikiSourceTags).innerJoin(wikiTags, eq(wikiSourceTags.tagId, wikiTags.id)).where(eq(wikiSourceTags.sourceId, id)).all().map((tag) => tag.name);
    syncSourceFts(id, { ...source, contributors, tagNames });
  }
  revalidateWiki();
}

export async function purgeFromTrash(entityType: "page" | "source", id: string) {
  await requireAdmin();
  if (entityType === "source") {
    const references = db.select({ pageId: wikiPageSources.pageId }).from(wikiPageSources).innerJoin(wikiPages, eq(wikiPageSources.pageId, wikiPages.id))
      .where(and(eq(wikiPageSources.sourceId, id), isNull(wikiPages.deletedAt))).all();
    if (references.length) throw new Error("Source is still referenced by active pages");
    deleteAttachmentsFor("wikiSource", id);
    db.delete(wikiSources).where(eq(wikiSources.id, id)).run();
  } else {
    const all = db.select({ id: wikiPages.id, parentId: wikiPages.parentId }).from(wikiPages).all();
    const purgeIds = new Set<string>([id]);
    let changed = true;
    while (changed) { changed = false; for (const candidate of all) if (candidate.parentId && purgeIds.has(candidate.parentId) && !purgeIds.has(candidate.id)) { purgeIds.add(candidate.id); changed = true; } }
    const byId = new Map(all.map((item) => [item.id, item]));
    const depth = (item: { id: string; parentId: string | null }) => { let value = 0; let current = item; while (current.parentId && byId.has(current.parentId)) { value += 1; current = byId.get(current.parentId)!; } return value; };
    const ordered = all.filter((item) => purgeIds.has(item.id)).sort((a, b) => depth(b) - depth(a));
    db.transaction(() => { for (const item of ordered) { deleteAttachmentsFor("wikiPage", item.id); db.delete(wikiPages).where(eq(wikiPages.id, item.id)).run(); } });
  }
  revalidateWiki();
}

const commentSchema = z.object({ pageId: z.string(), threadId: z.string().optional(), body: z.string().trim().min(1).max(10_000), anchorQuote: z.string().max(2_000).default(""), assigneeId: z.string().nullable().optional() });
export async function addComment(input: z.infer<typeof commentSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = commentSchema.parse(input);
  let threadId = data.threadId;
  db.transaction(() => {
    if (!threadId) {
      threadId = db.insert(wikiCommentThreads).values({ pageId: data.pageId, anchorQuote: data.anchorQuote, assigneeId: data.assigneeId ?? null, createdBy: currentUser.id }).returning({ id: wikiCommentThreads.id }).get().id;
      if (data.assigneeId && data.assigneeId !== currentUser.id) db.insert(wikiNotifications).values({ userId: data.assigneeId, actorId: currentUser.id, type: "assignment", pageId: data.pageId, threadId }).run();
    } else {
      const thread = db.select().from(wikiCommentThreads).where(eq(wikiCommentThreads.id, threadId)).get();
      if (thread && thread.createdBy !== currentUser.id) db.insert(wikiNotifications).values({ userId: thread.createdBy, actorId: currentUser.id, type: "reply", pageId: data.pageId, threadId }).run();
    }
    db.insert(wikiComments).values({ threadId: threadId!, body: data.body, createdBy: currentUser.id }).run();
    const mentioned = db.select({ id: user.id, name: user.name }).from(user).all().filter((person) => data.body.toLocaleLowerCase().includes(`@${person.name.toLocaleLowerCase()}`) && person.id !== currentUser.id);
    for (const person of mentioned) db.insert(wikiNotifications).values({ userId: person.id, actorId: currentUser.id, type: "mention", pageId: data.pageId, threadId }).run();
  });
  revalidateWiki();
  return { threadId: threadId! };
}

export async function setCommentResolved(threadId: string, resolved: boolean) {
  const currentUser = await requireUserOrThrow();
  const thread = db.select().from(wikiCommentThreads).where(eq(wikiCommentThreads.id, threadId)).get();
  if (!thread) throw new Error("Thread not found");
  db.update(wikiCommentThreads).set({ resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? currentUser.id : null }).where(eq(wikiCommentThreads.id, threadId)).run();
  if (resolved && thread.createdBy !== currentUser.id) db.insert(wikiNotifications).values({ userId: thread.createdBy, actorId: currentUser.id, type: "resolved", pageId: thread.pageId, threadId }).run();
  revalidateWiki();
}

export async function markNotificationsRead(ids?: string[]) {
  const currentUser = await requireUserOrThrow();
  const where = ids?.length ? and(eq(wikiNotifications.userId, currentUser.id), inArray(wikiNotifications.id, ids)) : eq(wikiNotifications.userId, currentUser.id);
  db.update(wikiNotifications).set({ readAt: new Date() }).where(where).run();
  revalidateWiki();
}

export async function restorePageRevision(revisionId: string) {
  const currentUser = await requireUserOrThrow();
  const revision = db.select().from(wikiPageRevisions).where(eq(wikiPageRevisions.id, revisionId)).get();
  if (!revision) throw new Error("Revision not found");
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, revision.pageId)).get();
  if (!page) throw new Error("Page not found");
  db.transaction(() => {
    db.insert(wikiPageRevisions).values({ pageId: page.id, version: page.version, title: page.title, contentJson: page.contentJson, status: page.status, citationLocale: page.citationLocale, kind: "restore", createdBy: currentUser.id }).run();
    db.update(wikiPages).set({ title: revision.title, contentJson: revision.contentJson, status: revision.status, citationLocale: revision.citationLocale, version: page.version + 1, updatedBy: currentUser.id, updatedAt: new Date() }).where(eq(wikiPages.id, page.id)).run();
  });
  revalidateWiki();
}

export async function restoreSourceRevision(revisionId: string) {
  const currentUser = await requireUserOrThrow();
  const revision = db.select().from(wikiSourceRevisions).where(eq(wikiSourceRevisions.id, revisionId)).get();
  if (!revision) throw new Error("Revision not found");
  const current = db.select().from(wikiSources).where(eq(wikiSources.id, revision.sourceId)).get();
  if (!current) throw new Error("Source not found");
  const snapshot = JSON.parse(revision.snapshotJson) as typeof current & { contributors?: Array<{ role: "author" | "editor"; given: string; family: string; literal: string }> };
  const values = { type: snapshot.type, title: snapshot.title, subtitle: snapshot.subtitle, issuedDate: snapshot.issuedDate, containerTitle: snapshot.containerTitle, publisher: snapshot.publisher, institution: snapshot.institution, edition: snapshot.edition, volume: snapshot.volume, issue: snapshot.issue, pages: snapshot.pages, doi: snapshot.doi, isbn: snapshot.isbn, url: snapshot.url, accessedAt: snapshot.accessedAt, language: snapshot.language, abstract: snapshot.abstract, notes: snapshot.notes, readingStatus: snapshot.readingStatus };
  db.transaction(() => {
    const contributors = db.select().from(wikiSourceContributors).where(eq(wikiSourceContributors.sourceId, current.id)).all();
    db.insert(wikiSourceRevisions).values({ sourceId: current.id, version: current.version, snapshotJson: JSON.stringify({ ...current, contributors }), createdBy: currentUser.id }).run();
    db.update(wikiSources).set({ ...values, version: current.version + 1, updatedBy: currentUser.id, updatedAt: new Date() }).where(eq(wikiSources.id, current.id)).run();
    db.delete(wikiSourceContributors).where(eq(wikiSourceContributors.sourceId, current.id)).run();
    if (snapshot.contributors?.length) db.insert(wikiSourceContributors).values(snapshot.contributors.map((person, index) => ({ ...person, sourceId: current.id, sortOrder: index }))).run();
  });
  const tagNames = db.select({ name: wikiTags.name }).from(wikiSourceTags).innerJoin(wikiTags, eq(wikiSourceTags.tagId, wikiTags.id)).where(eq(wikiSourceTags.sourceId, current.id)).all().map((tag) => tag.name);
  syncSourceFts(current.id, { ...snapshot, ...values, contributors: snapshot.contributors ?? [], tagNames });
  revalidateWiki();
}

export async function searchResearch(query: string) {
  await requireUserOrThrow();
  const clean = z.string().max(200).parse(query);
  const fts = buildFtsQuery(clean);
  if (!fts) return { pages: [], sources: [] };
  const pages = sqlite.prepare(`SELECT p.id, p.title, p.slug, p.status,
    snippet(wiki_pages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet
    FROM wiki_pages_fts f JOIN wiki_pages p ON p.id = f.page_id
    WHERE wiki_pages_fts MATCH ? AND p.deleted_at IS NULL ORDER BY rank LIMIT 10`).all(fts);
  const sources = sqlite.prepare(`SELECT s.id, s.title, s.type, s.issued_date AS issuedDate,
    snippet(wiki_sources_fts, 4, '<mark>', '</mark>', '…', 12) AS snippet
    FROM wiki_sources_fts f JOIN wiki_sources s ON s.id = f.source_id
    WHERE wiki_sources_fts MATCH ? AND s.deleted_at IS NULL ORDER BY rank LIMIT 10`).all(fts);
  return { pages, sources } as {
    pages: Array<{ id: string; title: string; slug: string; status: string; snippet: string }>;
    sources: Array<{ id: string; title: string; type: string; issuedDate: string; snippet: string }>;
  };
}

export async function importSourceRecords(records: unknown[]) {
  await requireUserOrThrow();
  const parsed = z.array(sourceInputSchema).max(1000).parse(records);
  const results = [];
  for (const record of parsed) results.push(await saveSource(record));
  return { imported: results.filter((result) => result.ok).length, duplicates: results.filter((result) => !result.ok).length };
}

export async function renameTag(tagId: string, name: string) {
  await requireAdmin();
  const clean = z.string().trim().min(1).max(40).parse(name);
  const normalizedName = clean.toLocaleLowerCase();
  const duplicate = db.select().from(wikiTags).where(eq(wikiTags.normalizedName, normalizedName)).get();
  if (duplicate && duplicate.id !== tagId) throw new Error("A tag with this name already exists");
  db.update(wikiTags).set({ name: clean, normalizedName }).where(eq(wikiTags.id, tagId)).run();
  revalidateWiki();
}

export async function mergeTags(sourceTagId: string, targetTagId: string) {
  await requireAdmin();
  if (sourceTagId === targetTagId) return;
  const pageLinks = db.select().from(wikiPageTags).where(eq(wikiPageTags.tagId, sourceTagId)).all();
  const sourceLinks = db.select().from(wikiSourceTags).where(eq(wikiSourceTags.tagId, sourceTagId)).all();
  db.transaction(() => {
    if (pageLinks.length) db.insert(wikiPageTags).values(pageLinks.map((link) => ({ pageId: link.pageId, tagId: targetTagId }))).onConflictDoNothing().run();
    if (sourceLinks.length) db.insert(wikiSourceTags).values(sourceLinks.map((link) => ({ sourceId: link.sourceId, tagId: targetTagId }))).onConflictDoNothing().run();
    db.delete(wikiTags).where(eq(wikiTags.id, sourceTagId)).run();
  });
  revalidateWiki();
}
