import { and, asc, eq, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { user, wikiLinks, wikiPages } from "@/db/schema";
import { buildFtsQuery } from "./lib/tiptap";

export type WikiTreeNode = {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  icon: string | null;
  children: WikiTreeNode[];
};

export function getPageTree(): WikiTreeNode[] {
  const rows = db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      slug: wikiPages.slug,
      parentId: wikiPages.parentId,
      icon: wikiPages.icon,
    })
    .from(wikiPages)
    .where(isNull(wikiPages.deletedAt))
    .orderBy(asc(wikiPages.sortOrder), asc(wikiPages.createdAt))
    .all();

  const nodes = new Map<string, WikiTreeNode>(
    rows.map((row) => [row.id, { ...row, children: [] }]),
  );
  const roots: WikiTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function getPageBySlug(slug: string) {
  return db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.slug, slug), isNull(wikiPages.deletedAt)))
    .get();
}

export function getFirstPage() {
  return db
    .select()
    .from(wikiPages)
    .where(isNull(wikiPages.deletedAt))
    .orderBy(asc(wikiPages.sortOrder), asc(wikiPages.createdAt))
    .get();
}

export function getBacklinks(pageId: string) {
  return db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      slug: wikiPages.slug,
    })
    .from(wikiLinks)
    .innerJoin(wikiPages, eq(wikiLinks.sourcePageId, wikiPages.id))
    .where(and(eq(wikiLinks.targetPageId, pageId), isNull(wikiPages.deletedAt)))
    .all();
}

export function getPageMeta(pageId: string) {
  return db
    .select({
      updatedAt: wikiPages.updatedAt,
      updatedByName: user.name,
    })
    .from(wikiPages)
    .innerJoin(user, eq(wikiPages.updatedBy, user.id))
    .where(eq(wikiPages.id, pageId))
    .get();
}

export type WikiSearchResult = {
  pageId: string;
  title: string;
  slug: string;
  snippet: string;
};

export function searchPages(query: string, limit = 10): WikiSearchResult[] {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const rows = sqlite
    .prepare(
      `SELECT f.page_id AS pageId,
              p.title AS title,
              p.slug AS slug,
              snippet(wiki_pages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet
       FROM wiki_pages_fts f
       JOIN wiki_pages p ON p.id = f.page_id
       WHERE wiki_pages_fts MATCH ? AND p.deleted_at IS NULL
       ORDER BY rank
       LIMIT ?`,
    )
    .all(ftsQuery, limit) as WikiSearchResult[];

  return rows;
}

/** All non-deleted pages, flat — for the "insert page link" picker. */
export function listPagesFlat() {
  return db
    .select({ id: wikiPages.id, title: wikiPages.title, slug: wikiPages.slug })
    .from(wikiPages)
    .where(isNull(wikiPages.deletedAt))
    .orderBy(asc(wikiPages.title))
    .all();
}
