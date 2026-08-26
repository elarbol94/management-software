"use server";

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, sqlite } from "@/db";
import {
  contextLinks,
  evidenceLinks,
  user,
  wikiCommentThreads,
  wikiComments,
  wikiFavorites,
  wikiNotifications,
  wikiPageRevisions,
  wikiPages,
  wikiCitationStyles,
  wikiPdfAnnotations,
  wikiPdfDocuments,
  wikiPageSources,
  wikiPageTags,
  wikiSourceContributors,
  wikiSourceRevisions,
  wikiSources,
  wikiSourceTags,
  wikiTags,
} from "@/db/schema";
import { requireAdmin, requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor, UPLOADS_PATH } from "@/lib/files";
import { pdfSourcePurgeBlocker } from "./lib/pdf-evidence";
import { sourceInputSchema } from "./lib/source-input";
import { normalizeDoi, normalizeIsbn, normalizeUrl } from "./lib/citations";
import type { CommentAnchor } from "./lib/comment-anchors";
import { buildFtsQuery, extractText, parseStoredDocument, slugify } from "./lib/tiptap";
import { fuseRankings } from "./lib/search-ranking";
import { getPageComments } from "./research-queries";
import { searchPdfPageText } from "./pdf-queries";

function revalidateWiki() {
  revalidatePath("/wiki", "layout");
}

function pageSnapshotHash(page: Pick<typeof wikiPages.$inferSelect, "contentJson" | "documentMode" | "documentSettingsJson">) {
  return createHash("sha256")
    .update(page.contentJson)
    .update("\0")
    .update(page.documentMode ? "1" : "0")
    .update("\0")
    .update(page.documentSettingsJson)
    .digest("hex");
}

export async function createPageCheckpoint(pageId: string, label?: string) {
  const currentUser = await requireUserOrThrow();
  const page = db.select().from(wikiPages).where(and(eq(wikiPages.id, pageId), isNull(wikiPages.deletedAt))).get();
  if (!page) throw new Error("Page not found");
  const contentHash = pageSnapshotHash(page);
  const existing = db.select({ id: wikiPageRevisions.id }).from(wikiPageRevisions)
    .where(and(eq(wikiPageRevisions.pageId, pageId), eq(wikiPageRevisions.contentHash, contentHash)))
    .get();
  if (existing) return { id: existing.id, created: false as const };
  const revision = db.insert(wikiPageRevisions).values({
    pageId,
    version: page.version,
    contentVersion: page.contentVersion,
    contentHash,
    label: z.string().trim().max(120).optional().parse(label) || null,
    title: page.title,
    contentJson: page.contentJson,
    status: page.status,
    citationLocale: page.citationLocale,
    citationStyle: page.citationStyle,
    documentMode: page.documentMode,
    documentSettingsJson: page.documentSettingsJson,
    documentTemplateId: page.documentTemplateId,
    kind: "manual",
    createdBy: currentUser.id,
  }).returning({ id: wikiPageRevisions.id }).get();
  revalidateWiki();
  return { id: revision.id, created: true as const };
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
    proofingLanguage: locale === "de" ? "de-DE" : "en-US",
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
  citationStyle: z.enum(wikiCitationStyles).optional(),
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

/** Confirms a page is still accurate for a period; 0 months clears the confirmation. */
export async function verifyPage(input: { pageId: string; months: number }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ pageId: z.string().min(1), months: z.number().int().min(0).max(24) }).parse(input);
  const page = db.select().from(wikiPages).where(and(eq(wikiPages.id, data.pageId), isNull(wikiPages.deletedAt))).get();
  if (!page) throw new Error("Page not found");
  if (data.months === 0) {
    db.update(wikiPages).set({ verifiedAt: null, verifiedUntil: null, verifiedBy: null }).where(eq(wikiPages.id, page.id)).run();
    revalidateWiki();
    return { verifiedUntil: null };
  }
  const verifiedAt = new Date();
  const verifiedUntil = new Date(verifiedAt);
  verifiedUntil.setMonth(verifiedUntil.getMonth() + data.months);
  db.update(wikiPages).set({ verifiedAt, verifiedUntil, verifiedBy: currentUser.id }).where(eq(wikiPages.id, page.id)).run();
  revalidateWiki();
  return { verifiedUntil: verifiedUntil.toISOString() };
}

export async function updatePageResearchMeta(input: z.input<typeof pageMetaSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = pageMetaSchema.parse(input);
  const page = db.select().from(wikiPages).where(and(eq(wikiPages.id, data.pageId), isNull(wikiPages.deletedAt))).get();
  if (!page) throw new Error("Page not found");
  const tags = ensureTags(data.tagNames, currentUser.id);
  db.transaction(() => {
    db.update(wikiPages).set({ status: data.status, citationLocale: data.citationLocale, ...(data.citationStyle ? { citationStyle: data.citationStyle } : {}), updatedBy: currentUser.id, updatedAt: new Date(), version: page.version + 1 }).where(eq(wikiPages.id, page.id)).run();
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
  const documentIds = db
    .select({ id: wikiPdfDocuments.id })
    .from(wikiPdfDocuments)
    .where(eq(wikiPdfDocuments.sourceId, id))
    .all()
    .map((document) => document.id);
  db.transaction((tx) => {
    tx.delete(contextLinks)
      .where(
        and(
          eq(contextLinks.targetType, "wikiSource"),
          eq(contextLinks.targetId, id),
        ),
      )
      .run();
    if (documentIds.length) {
      tx.delete(contextLinks)
        .where(
          and(
            eq(contextLinks.targetType, "pdf"),
            inArray(contextLinks.targetId, documentIds),
          ),
        )
        .run();
    }
    tx.update(wikiSources).set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: currentUser.id }).where(eq(wikiSources.id, id)).run();
  });
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
    const evidenceReferences = db.select({ id: evidenceLinks.id }).from(evidenceLinks)
      .innerJoin(wikiPdfAnnotations, eq(evidenceLinks.annotationId, wikiPdfAnnotations.id))
      .where(eq(wikiPdfAnnotations.sourceId, id)).all();
    const purgeBlocker = pdfSourcePurgeBlocker({ activePageReferences: references.length, evidenceReferences: evidenceReferences.length });
    if (purgeBlocker === "active-pages") throw new Error("Source is still referenced by active pages");
    if (purgeBlocker === "evidence") throw new Error("Source PDF evidence is still referenced");
    const documents = db.select({ id: wikiPdfDocuments.id }).from(wikiPdfDocuments)
      .where(eq(wikiPdfDocuments.sourceId, id)).all();
    for (const document of documents) {
      sqlite.prepare("DELETE FROM wiki_pdf_pages_fts WHERE document_id = ?").run(document.id);
      fs.rmSync(path.join(UPLOADS_PATH, "derived", document.id), { recursive: true, force: true });
    }
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

const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine((rect) => rect.x + rect.width <= 1.000_001 && rect.y + rect.height <= 1.000_001);

const commentAnchorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page") }),
  z.object({ type: z.literal("text"), quote: z.string().trim().min(1).max(2_000) }),
  z.object({
    type: z.literal("image"),
    nodeId: z.string().min(1).max(200),
    mode: z.enum(["whole", "region"]),
    rect: normalizedRectSchema.optional(),
    label: z.string().max(500).default(""),
  }).refine((anchor) => anchor.mode === "whole" || anchor.rect !== undefined),
]);

const commentSchema = z.object({
  pageId: z.string(),
  threadId: z.string().optional(),
  body: z.string().trim().min(1).max(10_000),
  anchor: commentAnchorSchema.optional(),
  anchorQuote: z.string().max(2_000).optional(),
  assigneeId: z.string().nullable().optional(),
});
export async function addComment(input: z.infer<typeof commentSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = commentSchema.parse(input);
  let threadId = data.threadId;
  db.transaction(() => {
    if (!threadId) {
      const anchor: CommentAnchor = data.anchor ?? (data.anchorQuote ? { type: "text", quote: data.anchorQuote } : { type: "page" });
      threadId = db.insert(wikiCommentThreads).values({
        pageId: data.pageId,
        anchorQuote: anchor.type === "text" ? anchor.quote : anchor.type === "image" ? anchor.label : "",
        anchorType: anchor.type,
        anchorNodeId: anchor.type === "image" ? anchor.nodeId : null,
        anchorData: anchor.type === "image" ? { mode: anchor.mode, rect: anchor.rect, label: anchor.label } : {},
        assigneeId: data.assigneeId ?? null,
        createdBy: currentUser.id,
      }).returning({ id: wikiCommentThreads.id }).get().id;
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
  const thread = getPageComments(data.pageId).find((item) => item.id === threadId);
  if (!thread) throw new Error("Created comment thread could not be loaded");
  return { threadId: threadId!, thread };
}

const commentIdSchema = z.string().min(1);
const commentUpdateSchema = z.object({
  commentId: commentIdSchema,
  body: z.string().trim().min(1).max(10_000),
});

async function requireCommentAuthor(commentId: string, includeDeleted = false) {
  const currentUser = await requireUserOrThrow();
  const comment = db.select({ id: wikiComments.id, createdBy: wikiComments.createdBy, deletedAt: wikiComments.deletedAt })
    .from(wikiComments)
    .where(and(eq(wikiComments.id, commentId), ...(includeDeleted ? [] : [isNull(wikiComments.deletedAt)])))
    .get();
  if (!comment) throw new Error("Comment not found");
  if (comment.createdBy !== currentUser.id) throw new Error("You can only change your own comments");
  return comment;
}

export async function updateComment(input: z.infer<typeof commentUpdateSchema>) {
  const data = commentUpdateSchema.parse(input);
  await requireCommentAuthor(data.commentId);
  db.update(wikiComments).set({ body: data.body }).where(eq(wikiComments.id, data.commentId)).run();
  revalidateWiki();
}

export async function deleteComment(commentId: string) {
  const id = commentIdSchema.parse(commentId);
  await requireCommentAuthor(id);
  db.update(wikiComments).set({ deletedAt: new Date() }).where(eq(wikiComments.id, id)).run();
  revalidateWiki();
}

export async function restoreComment(commentId: string) {
  const id = commentIdSchema.parse(commentId);
  await requireCommentAuthor(id, true);
  db.update(wikiComments).set({ deletedAt: null }).where(eq(wikiComments.id, id)).run();
  revalidateWiki();
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
  const restoredDocument = parseStoredDocument(revision.contentJson);
  const restoredContentJson = JSON.stringify(restoredDocument);
  const contentText = extractText(restoredDocument);
  db.transaction(() => {
    db.insert(wikiPageRevisions).values({ pageId: page.id, version: page.version, contentVersion: page.contentVersion, contentHash: pageSnapshotHash(page), title: page.title, contentJson: page.contentJson, status: page.status, citationLocale: page.citationLocale, citationStyle: page.citationStyle, documentMode: page.documentMode, documentSettingsJson: page.documentSettingsJson, documentTemplateId: page.documentTemplateId, kind: "restore", createdBy: currentUser.id }).run();
    db.update(wikiPages).set({ title: revision.title, contentJson: restoredContentJson, contentText, status: revision.status, citationLocale: revision.citationLocale, citationStyle: revision.citationStyle, documentMode: revision.documentMode, documentSettingsJson: revision.documentSettingsJson, documentTemplateId: revision.documentTemplateId, version: page.version + 1, contentVersion: page.contentVersion + 1, updatedBy: currentUser.id, updatedAt: new Date() }).where(eq(wikiPages.id, page.id)).run();
    sqlite.prepare("DELETE FROM wiki_pages_fts WHERE page_id = ?").run(page.id);
    sqlite.prepare("INSERT INTO wiki_pages_fts (page_id, title, content_text) VALUES (?, ?, ?)").run(page.id, revision.title, contentText);
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

export type SearchHit =
  | { kind: "page"; key: string; title: string; snippet: string; href: string; status: string }
  | { kind: "source"; key: string; title: string; snippet: string; href: string; sourceType: string; issuedDate: string }
  | { kind: "pdfPage"; key: string; title: string; snippet: string; href: string; pageNumber: number }
  | { kind: "annotation"; key: string; title: string; snippet: string; href: string; pageNumber: number };

export async function searchResearch(query: string, options: { limit?: number; tagId?: string } = {}) {
  await requireUserOrThrow();
  const clean = z.string().max(200).parse(query);
  const { limit = 40, tagId } = z.object({
    limit: z.number().int().min(1).max(500).optional(),
    tagId: z.string().min(1).optional(),
  }).parse(options);
  const fts = buildFtsQuery(clean);
  if (!fts) return { results: [] as SearchHit[] };

  // A tag narrows pages and sources directly, and PDF pages and annotations through
  // the source they belong to, so one chip filters every kind consistently.
  const pageTagClause = tagId ? "AND EXISTS (SELECT 1 FROM wiki_page_tags pt WHERE pt.page_id = p.id AND pt.tag_id = ?)" : "";
  const sourceTagClause = tagId ? "AND EXISTS (SELECT 1 FROM wiki_source_tags st WHERE st.source_id = s.id AND st.tag_id = ?)" : "";
  const tagParams = tagId ? [tagId] : [];

  const pages = sqlite.prepare(`SELECT p.id, p.title, p.slug, p.status,
    snippet(wiki_pages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet
    FROM wiki_pages_fts f JOIN wiki_pages p ON p.id = f.page_id
    WHERE wiki_pages_fts MATCH ? AND p.deleted_at IS NULL ${pageTagClause} ORDER BY rank LIMIT 20`).all(fts, ...tagParams) as Array<{ id: string; title: string; slug: string; status: string; snippet: string }>;

  const sources = sqlite.prepare(`SELECT s.id, s.title, s.type, s.issued_date AS issuedDate,
    snippet(wiki_sources_fts, 4, '<mark>', '</mark>', '…', 12) AS snippet,
    (SELECT d.id FROM wiki_pdf_documents d
     WHERE d.source_id = s.id AND d.status = 'ready'
     ORDER BY CASE WHEN d.role = 'primary' THEN 0 ELSE 1 END, d.created_at ASC
     LIMIT 1) AS documentId
    FROM wiki_sources_fts f JOIN wiki_sources s ON s.id = f.source_id
    WHERE wiki_sources_fts MATCH ? AND s.deleted_at IS NULL ${sourceTagClause} ORDER BY rank LIMIT 20`).all(fts, ...tagParams) as Array<{ id: string; title: string; type: string; issuedDate: string; snippet: string; documentId: string | null }>;

  const pdfPages = searchPdfPageText(clean, 20, tagId);

  // Annotations were only reachable from inside the evidence picker, so your own
  // highlights could not be found from the search bar at all. No FTS index covers
  // them yet, so this stays a LIKE scan, bounded and ranked by recency.
  const like = `%${clean.trim()}%`;
  const annotations = sqlite.prepare(`SELECT a.id, a.source_id AS sourceId, a.document_id AS documentId,
    a.page_number AS pageNumber, a.selected_text AS selectedText, a.note, a.label, s.title AS sourceTitle
    FROM wiki_pdf_annotations a JOIN wiki_sources s ON s.id = a.source_id
    WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL
      AND (a.selected_text LIKE ? OR a.note LIKE ? OR a.label LIKE ?) ${sourceTagClause}
    ORDER BY a.updated_at DESC LIMIT 20`).all(like, like, like, ...tagParams) as Array<{ id: string; sourceId: string; documentId: string; pageNumber: number; selectedText: string; note: string; label: string; sourceTitle: string }>;

  const pageHits: SearchHit[] = pages.map((row) => ({
    kind: "page", key: `page:${row.id}`, title: row.title, snippet: row.snippet,
    href: `/wiki/pages/${row.slug}`, status: row.status,
  }));
  const sourceHits: SearchHit[] = sources.map((row) => ({
    kind: "source", key: `source:${row.id}`, title: row.title, snippet: row.snippet,
    href: `/wiki/sources/${row.id}`, sourceType: row.type, issuedDate: row.issuedDate,
  }));
  const pdfHits: SearchHit[] = pdfPages.map((row) => ({
    kind: "pdfPage", key: `pdf:${row.documentId}:${row.pageNumber}`, title: row.sourceTitle, snippet: row.snippet,
    href: `/wiki/sources/${row.sourceId}/read/${row.documentId}?page=${row.pageNumber}`, pageNumber: row.pageNumber,
  }));
  const annotationHits: SearchHit[] = annotations.map((row) => ({
    kind: "annotation", key: `annotation:${row.id}`, title: row.label || row.sourceTitle,
    snippet: row.selectedText || row.note,
    href: `/wiki/sources/${row.sourceId}/read/${row.documentId}?page=${row.pageNumber}&annotation=${row.id}`,
    pageNumber: row.pageNumber,
  }));

  // One ranked list rather than four capped sections: a page hit ranked eleventh used
  // to be invisible even when it beat every PDF hit.
  const results = fuseRankings<SearchHit>(
    [pageHits, sourceHits, pdfHits, annotationHits],
    (hit) => hit.key,
  ).slice(0, limit);
  return { results };
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
