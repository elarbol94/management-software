import "server-only";

import { sqlite } from "@/db";
import { resolveStoredUserMarkColor } from "@/lib/user-mark-colors.server";
import { buildPageTree } from "./lib/page-tree";

export type CategoryRow = {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
  evidenceCount: number;
};

export type CategoryEvidence = {
  linkId: string;
  annotationId: string;
  sourceId: string;
  sourceTitle: string;
  documentId: string;
  pageNumber: number;
  kind: string;
  selectedText: string;
  note: string;
  label: string;
  createdByMarkColor: string;
};

/**
 * The whole outline, depth-first, with the number of passages filed under each entry.
 * Counts come from evidence_links, the same table the rest of the app links evidence
 * through, so a category needs no linking model of its own.
 */
export function listCategories(): Array<CategoryRow & { depth: number }> {
  const rows = sqlite.prepare(`
    SELECT c.id, c.name, c.description, c.parent_id AS parentId, c.sort_order AS sortOrder,
           c.created_at AS createdAt,
           (SELECT count(*) FROM evidence_links l
            WHERE l.target_type = 'wikiCategory' AND l.target_id = c.id) AS evidenceCount
    FROM wiki_categories c
  `).all() as CategoryRow[];
  return buildPageTree(rows);
}

/** Every passage filed under one category, newest first. */
export function listCategoryEvidence(categoryId: string): CategoryEvidence[] {
  const rows = sqlite.prepare(`
    SELECT l.id AS linkId, a.id AS annotationId, a.source_id AS sourceId, s.title AS sourceTitle,
           a.document_id AS documentId, a.page_number AS pageNumber, a.kind,
           a.selected_text AS selectedText, a.note, a.label,
           COALESCE(p.mark_color, 'amber') AS createdByMarkColor
    FROM evidence_links l
    JOIN wiki_pdf_annotations a ON a.id = l.annotation_id
    JOIN wiki_sources s ON s.id = a.source_id
    LEFT JOIN user_profile_preferences p ON p.user_id = a.created_by
    WHERE l.target_type = 'wikiCategory' AND l.target_id = ?
      AND a.deleted_at IS NULL AND s.deleted_at IS NULL
    ORDER BY l.created_at DESC
  `).all(categoryId) as CategoryEvidence[];
  return rows.map((row) => ({
    ...row,
    createdByMarkColor: resolveStoredUserMarkColor(row.createdByMarkColor),
  }));
}

export function getCategory(id: string) {
  return sqlite.prepare(
    "SELECT id, name, description, parent_id AS parentId FROM wiki_categories WHERE id = ?",
  ).get(id) as { id: string; name: string; description: string; parentId: string | null } | undefined;
}
