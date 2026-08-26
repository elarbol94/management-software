"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, sqlite } from "@/db";
import {
  contextLinks,
  evidenceLinks,
  wikiCommentThreads,
  wikiLinks,
  wikiPageRevisions,
  wikiPageEditLeases,
  wikiPageSources,
  wikiPages,
  wikiPdfAnnotations,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { isCommentAnchorOrphaned, type CommentAnchor } from "./lib/comment-anchors";
import {
  extractCitations,
  extractCommentAnchors,
  extractCommentNodeIds,
  extractEvidenceAnnotationIds,
  extractInternalSlugs,
  extractText,
  slugify,
} from "./lib/tiptap";
import type { TiptapNode } from "./lib/tiptap";
import { normalizeDocumentSettings, serializeDocumentSettings } from "./lib/document-settings";

function uniqueSlug(title: string, excludePageId?: string): string {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const exists = db
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(eq(wikiPages.slug, slug))
      .get();
    if (!exists || exists.id === excludePageId) return slug;
    slug = `${base}-${i}`;
  }
  throw new Error("Could not allocate a unique slug");
}

function syncFts(pageId: string, title: string, contentText: string) {
  sqlite
    .prepare("DELETE FROM wiki_pages_fts WHERE page_id = ?")
    .run(pageId);
  sqlite
    .prepare(
      "INSERT INTO wiki_pages_fts (page_id, title, content_text) VALUES (?, ?, ?)",
    )
    .run(pageId, title, contentText);
}

function contentSnapshotHash(contentJson: string, documentMode: boolean, documentSettingsJson: string) {
  return createHash("sha256")
    .update(contentJson)
    .update("\0")
    .update(documentMode ? "1" : "0")
    .update("\0")
    .update(documentSettingsJson)
    .digest("hex");
}

const leaseSchema = z.object({
  pageId: z.string().min(1),
  sessionId: z.string().min(8).max(200),
  takeover: z.boolean().optional(),
});

const LEASE_TIMEOUT_MS = 60_000;

export async function acquirePageEditLease(input: z.infer<typeof leaseSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = leaseSchema.parse(input);
  const now = new Date();
  const lease = db.select().from(wikiPageEditLeases).where(eq(wikiPageEditLeases.pageId, data.pageId)).get();
  const expired = !lease || now.getTime() - lease.heartbeatAt.getTime() > LEASE_TIMEOUT_MS;
  if (lease && !expired && lease.sessionId !== data.sessionId && !data.takeover) {
    return { editable: false as const, expiresAt: lease.heartbeatAt.getTime() + LEASE_TIMEOUT_MS };
  }
  db.insert(wikiPageEditLeases)
    .values({ pageId: data.pageId, sessionId: data.sessionId, userId: currentUser.id, acquiredAt: now, heartbeatAt: now })
    .onConflictDoUpdate({
      target: wikiPageEditLeases.pageId,
      set: { sessionId: data.sessionId, userId: currentUser.id, acquiredAt: now, heartbeatAt: now },
    })
    .run();
  return { editable: true as const, expiresAt: now.getTime() + LEASE_TIMEOUT_MS };
}

export async function heartbeatPageEditLease(input: Omit<z.infer<typeof leaseSchema>, "takeover">) {
  const currentUser = await requireUserOrThrow();
  const data = leaseSchema.omit({ takeover: true }).parse(input);
  const updated = db.update(wikiPageEditLeases)
    .set({ heartbeatAt: new Date() })
    .where(and(
      eq(wikiPageEditLeases.pageId, data.pageId),
      eq(wikiPageEditLeases.sessionId, data.sessionId),
      eq(wikiPageEditLeases.userId, currentUser.id),
    ))
    .returning({ pageId: wikiPageEditLeases.pageId })
    .get();
  return { editable: Boolean(updated) };
}

export async function releasePageEditLease(input: Omit<z.infer<typeof leaseSchema>, "takeover">) {
  const currentUser = await requireUserOrThrow();
  const data = leaseSchema.omit({ takeover: true }).parse(input);
  db.delete(wikiPageEditLeases).where(and(
    eq(wikiPageEditLeases.pageId, data.pageId),
    eq(wikiPageEditLeases.sessionId, data.sessionId),
    eq(wikiPageEditLeases.userId, currentUser.id),
  )).run();
  return { released: true as const };
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  parentId: z.string().nullable().default(null),
  proofingLanguage: z.enum(["de-DE", "en-US"]).default("de-DE"),
});

export async function createPage(
  input: z.infer<typeof createSchema>,
): Promise<{ slug: string }> {
  const user = await requireUserOrThrow();
  const data = createSchema.parse(input);

  const slug = uniqueSlug(data.title);
  const row = db
    .insert(wikiPages)
    .values({
      title: data.title,
      slug,
      parentId: data.parentId,
      proofingLanguage: data.proofingLanguage,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: wikiPages.id })
    .get();

  syncFts(row.id, data.title, "");
  revalidatePath("/wiki", "layout");
  return { slug };
}

const proofingLanguageSchema = z.object({
  pageId: z.string().min(1),
  language: z.enum(["de-DE", "en-US"]),
});

export async function updatePageProofingLanguage(input: z.infer<typeof proofingLanguageSchema>) {
  await requireUserOrThrow();
  const data = proofingLanguageSchema.parse(input);
  const result = db.update(wikiPages)
    .set({ proofingLanguage: data.language })
    .where(and(eq(wikiPages.id, data.pageId), isNull(wikiPages.deletedAt)))
    .returning({ proofingLanguage: wikiPages.proofingLanguage })
    .get();
  if (!result) throw new Error("Page not found");
  revalidatePath("/wiki", "layout");
  return result;
}

export async function renamePage(id: string, title: string) {
  const user = await requireUserOrThrow();
  const cleanTitle = z.string().min(1).max(200).parse(title);

  const page = db.select().from(wikiPages).where(eq(wikiPages.id, id)).get();
  if (!page) throw new Error("Page not found");

  // Keep the URL in step with the title, but remember the old slug so existing links
  // (in other pages' content, bookmarks, chat messages) still resolve.
  const nextSlug = uniqueSlug(cleanTitle, id);
  const slugChanged = nextSlug !== page.slug;
  const previousSlugs = slugChanged
    ? [...page.previousSlugs.split(",").filter((slug) => slug && slug !== nextSlug), page.slug].join(",")
    : page.previousSlugs;

  db.transaction(() => {
    db.update(wikiPages)
      .set({ title: cleanTitle, slug: nextSlug, previousSlugs, updatedBy: user.id, updatedAt: new Date(), version: page.version + 1 })
      .where(eq(wikiPages.id, id))
      .run();
  });
  syncFts(id, cleanTitle, page.contentText);
  revalidatePath("/wiki", "layout");
  return { slug: nextSlug };
}

const saveSchema = z.object({
  id: z.string().min(1),
  contentJson: z.string().max(2_000_000),
  baseContentJson: z.string().max(2_000_000).optional(),
  documentMode: z.boolean().optional(),
  documentSettingsJson: z.string().max(200_000).optional(),
  baseDocumentMode: z.boolean().optional(),
  baseDocumentSettingsJson: z.string().max(200_000).optional(),
  expectedContentVersion: z.number().int().positive(),
  editorSessionId: z.string().min(8).max(200),
});

export async function savePageContent(input: z.infer<typeof saveSchema>) {
  const user = await requireUserOrThrow();
  const data = saveSchema.parse(input);

  const page = db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.id, data.id), isNull(wikiPages.deletedAt)))
    .get();
  // Autosaves can arrive after another request deleted the page. Treat that
  // normal race as a no-op instead of surfacing a server error.
  if (!page) return { saved: false };

  const lease = db.select().from(wikiPageEditLeases).where(eq(wikiPageEditLeases.pageId, data.id)).get();
  if (lease && lease.sessionId !== data.editorSessionId && Date.now() - lease.heartbeatAt.getTime() <= LEASE_TIMEOUT_MS) {
    return { saved: false as const, locked: true as const, contentVersion: page.contentVersion };
  }

  let doc: TiptapNode | null = null;
  try {
    doc = JSON.parse(data.contentJson) as TiptapNode;
  } catch {
    throw new Error("Invalid document");
  }

  const contentText = extractText(doc);
  const inferredTitle = /^(Unbenannte Notiz|Untitled note)$/.test(page.title)
    ? contentText.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 200)
    : undefined;
  const effectiveTitle = inferredTitle || page.title;
  const slugs = extractInternalSlugs(doc);
  const citations = extractCitations(doc);
  const citationSourceIds = [...new Set(citations.map((item) => item.sourceId))];
  const commentAnchors = new Set(extractCommentAnchors(doc));
  const commentNodeIds = new Set(extractCommentNodeIds(doc));
  const evidenceAnnotationIds = extractEvidenceAnnotationIds(doc);
  const nextDocumentMode = data.documentMode ?? page.documentMode;
  let nextDocumentSettingsJson = page.documentSettingsJson;
  if (data.documentSettingsJson !== undefined) {
    try {
      nextDocumentSettingsJson = serializeDocumentSettings(normalizeDocumentSettings(JSON.parse(data.documentSettingsJson)));
    } catch {
      throw new Error("Invalid document settings");
    }
  }

  const incomingHash = contentSnapshotHash(data.contentJson, nextDocumentMode, nextDocumentSettingsJson);
  if (data.expectedContentVersion !== page.contentVersion) {
    const existingConflict = db.select({ id: wikiPageRevisions.id }).from(wikiPageRevisions)
      .where(and(
        eq(wikiPageRevisions.pageId, page.id),
        eq(wikiPageRevisions.kind, "conflict"),
        eq(wikiPageRevisions.contentHash, incomingHash),
      ))
      .get();
    const revision = existingConflict ?? db
      .insert(wikiPageRevisions)
      .values({
        pageId: page.id,
        version: page.version,
        contentVersion: data.expectedContentVersion,
        contentHash: incomingHash,
        title: page.title,
        contentJson: data.contentJson,
        status: page.status,
        citationLocale: page.citationLocale,
        citationStyle: page.citationStyle,
        documentMode: nextDocumentMode,
        documentSettingsJson: nextDocumentSettingsJson,
        documentTemplateId: page.documentTemplateId,
        kind: "conflict",
        createdBy: user.id,
      })
      .returning({ id: wikiPageRevisions.id })
      .get();
    return {
      saved: false as const,
      conflict: true as const,
      contentVersion: page.contentVersion,
      revisionId: revision.id,
      contentJson: page.contentJson,
      documentMode: page.documentMode,
      documentSettingsJson: page.documentSettingsJson,
    };
  }

  const nextVersion = page.version + 1;
  const nextContentVersion = page.contentVersion + 1;

  const applied = db.transaction(() => {
    const updated = db.update(wikiPages)
      .set({
        contentJson: data.contentJson,
        contentText,
        documentMode: nextDocumentMode,
        documentSettingsJson: nextDocumentSettingsJson,
        updatedBy: user.id,
        updatedAt: new Date(),
        version: nextVersion,
        contentVersion: nextContentVersion,
        ...(inferredTitle ? { title: inferredTitle } : {}),
      })
      .where(and(eq(wikiPages.id, data.id), eq(wikiPages.contentVersion, data.expectedContentVersion)))
      .returning({ contentVersion: wikiPages.contentVersion })
      .get();
    if (!updated) return false;

    // Rebuild outgoing links.
    db.delete(wikiLinks).where(eq(wikiLinks.sourcePageId, data.id)).run();
    if (slugs.length > 0) {
      const targets = db
        .select({ id: wikiPages.id })
        .from(wikiPages)
        .where(inArray(wikiPages.slug, slugs))
        .all();
      if (targets.length > 0) {
        db.insert(wikiLinks)
          .values(
            targets
              .filter((target) => target.id !== data.id)
              .map((target) => ({
                sourcePageId: data.id,
                targetPageId: target.id,
              })),
          )
          .onConflictDoNothing()
          .run();
      }
    }

    db.delete(wikiPageSources)
      .where(and(eq(wikiPageSources.pageId, data.id), eq(wikiPageSources.relation, "citation")))
      .run();
    if (citationSourceIds.length > 0) {
      db.insert(wikiPageSources)
        .values(citationSourceIds.map((sourceId) => ({ pageId: data.id, sourceId, relation: "citation" as const })))
        .onConflictDoNothing()
        .run();
    }

    db.delete(evidenceLinks)
      .where(and(eq(evidenceLinks.targetType, "wikiPage"), eq(evidenceLinks.targetId, data.id)))
      .run();
    if (evidenceAnnotationIds.length > 0) {
      const annotations = db.select({ id: wikiPdfAnnotations.id }).from(wikiPdfAnnotations)
        .where(inArray(wikiPdfAnnotations.id, evidenceAnnotationIds)).all();
      if (annotations.length > 0) {
        db.insert(evidenceLinks).values(annotations.map((annotation) => ({
          annotationId: annotation.id, targetType: "wikiPage" as const, targetId: data.id, createdBy: user.id,
        }))).onConflictDoNothing().run();
      }
    }

    const threads = db
      .select({
        id: wikiCommentThreads.id,
        anchorQuote: wikiCommentThreads.anchorQuote,
        anchorType: wikiCommentThreads.anchorType,
        anchorNodeId: wikiCommentThreads.anchorNodeId,
      })
      .from(wikiCommentThreads)
      .where(eq(wikiCommentThreads.pageId, data.id))
      .all();
    for (const thread of threads) {
      const anchor: CommentAnchor = thread.anchorType === "image"
        ? { type: "image", nodeId: thread.anchorNodeId ?? "", mode: "whole", label: thread.anchorQuote }
        : thread.anchorType === "text"
          ? { type: "text", quote: thread.anchorQuote }
          : { type: "page" };
      const orphaned = isCommentAnchorOrphaned(thread.id, anchor, { threadIds: commentAnchors, nodeIds: commentNodeIds, text: contentText });
      db.update(wikiCommentThreads)
        .set({ orphaned })
        .where(eq(wikiCommentThreads.id, thread.id))
        .run();
    }

    const recentRevision = sqlite
      .prepare("SELECT id FROM wiki_page_revisions WHERE page_id = ? AND created_by = ? AND kind = 'autosave' AND created_at > ? LIMIT 1")
      .get(data.id, user.id, Date.now() - 5 * 60_000);
    if (!recentRevision) {
      db.insert(wikiPageRevisions)
        .values({
          pageId: page.id,
          version: page.version,
          contentVersion: page.contentVersion,
          contentHash: contentSnapshotHash(page.contentJson, page.documentMode, page.documentSettingsJson),
          title: page.title,
          contentJson: page.contentJson,
          status: page.status,
          citationLocale: page.citationLocale,
          citationStyle: page.citationStyle,
          documentMode: page.documentMode,
          documentSettingsJson: page.documentSettingsJson,
          documentTemplateId: page.documentTemplateId,
          kind: "autosave",
          createdBy: user.id,
        })
        .run();
    }

    syncFts(data.id, effectiveTitle, contentText);
    return true;
  });
  if (!applied) {
    return {
      saved: false as const,
      conflict: true as const,
      contentVersion: db.select({ contentVersion: wikiPages.contentVersion }).from(wikiPages).where(eq(wikiPages.id, data.id)).get()?.contentVersion ?? page.contentVersion,
      revisionId: "",
      contentJson: page.contentJson,
      documentMode: page.documentMode,
      documentSettingsJson: page.documentSettingsJson,
    };
  }
  // No revalidatePath here: autosave must not re-render the open editor.
  return { saved: true as const, conflict: false as const, contentVersion: nextContentVersion };
}

export async function searchWiki(query: string) {
  await requireUserOrThrow();
  const { searchPages } = await import("./queries");
  return searchPages(z.string().max(200).parse(query));
}

/** Soft-deletes a page and all of its descendants. */
export async function deletePage(id: string) {
  const user = await requireUserOrThrow();

  const all = db
    .select({ id: wikiPages.id, parentId: wikiPages.parentId })
    .from(wikiPages)
    .where(isNull(wikiPages.deletedAt))
    .all();

  const childrenOf = new Map<string | null, string[]>();
  for (const page of all) {
    const list = childrenOf.get(page.parentId) ?? [];
    list.push(page.id);
    childrenOf.set(page.parentId, list);
  }

  const toDelete: string[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    toDelete.push(current);
    queue.push(...(childrenOf.get(current) ?? []));
  }

  db.transaction(() => {
    db.delete(contextLinks)
      .where(
        and(
          eq(contextLinks.targetType, "wikiPage"),
          inArray(contextLinks.targetId, toDelete),
        ),
      )
      .run();
    db.update(wikiPages)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(wikiPages.id, toDelete))
      .run();
    for (const pageId of toDelete) {
      sqlite.prepare("DELETE FROM wiki_pages_fts WHERE page_id = ?").run(pageId);
    }
  });

  revalidatePath("/wiki", "layout");
}
