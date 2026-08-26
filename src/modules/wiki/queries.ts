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

// Renaming a page moves its slug; the old one stays listed so links keep working.
export function getPageByPreviousSlug(slug: string) {
  // Slugs only ever contain [a-z0-9-]; anything else would smuggle LIKE wildcards into the lookup.
  if (!/^[a-z0-9-]+$/.test(slug)) return undefined;
  return sqlite
    .prepare(
      "SELECT id, slug FROM wiki_pages WHERE deleted_at IS NULL AND (',' || previous_slugs || ',') LIKE ? LIMIT 1",
    )
    .get(`%,${slug},%`) as { id: string; slug: string } | undefined;
}

export function getFirstPage() {
  return db
    .select()
    .from(wikiPages)
    .where(isNull(wikiPages.deletedAt))
    .orderBy(asc(wikiPages.sortOrder), asc(wikiPages.createdAt))
    .get();
}

/**
 * Pages that mention this page's title in their text but never linked to it. Explicit
 * links need the author to remember; this surfaces what they forgot.
 */
export function getUnlinkedMentions(pageId: string, title: string, limit = 20) {
  const needle = title.trim();
  // A very short title matches almost everything, so it is not worth offering.
  if (needle.length < 4) return [];
  return sqlite.prepare(`
    SELECT p.id, p.title, p.slug
    FROM wiki_pages p
    WHERE p.deleted_at IS NULL
      AND p.id != ?
      AND p.content_text LIKE ? COLLATE NOCASE
      AND NOT EXISTS (
        SELECT 1 FROM wiki_links l
        WHERE l.source_page_id = p.id AND l.target_page_id = ?
      )
    ORDER BY p.updated_at DESC
    LIMIT ?
  `).all(pageId, `%${needle}%`, pageId, limit) as Array<{ id: string; title: string; slug: string }>;
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
