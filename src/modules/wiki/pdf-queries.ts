import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import {
  attachments,
  evidenceLinks,
  user,
  wikiPdfAnnotationComments,
  wikiPdfAnnotations,
  wikiPdfDocuments,
  wikiPdfPages,
  wikiSources,
} from "@/db/schema";
import type { EvidenceTargetType } from "./lib/pdf-evidence";

export function listPdfDocumentsForSource(sourceId: string) {
  return db.select({
    id: wikiPdfDocuments.id,
    attachmentId: wikiPdfDocuments.attachmentId,
    role: wikiPdfDocuments.role,
    version: wikiPdfDocuments.version,
    status: wikiPdfDocuments.status,
    pageCount: wikiPdfDocuments.pageCount,
    progressPage: wikiPdfDocuments.progressPage,
    metadataJson: wikiPdfDocuments.metadataJson,
    error: wikiPdfDocuments.error,
    fileName: attachments.fileName,
    sizeBytes: attachments.sizeBytes,
    createdAt: wikiPdfDocuments.createdAt,
  }).from(wikiPdfDocuments)
    .innerJoin(attachments, eq(wikiPdfDocuments.attachmentId, attachments.id))
    .where(eq(wikiPdfDocuments.sourceId, sourceId))
    .orderBy(asc(wikiPdfDocuments.version)).all();
}

export function getPdfReaderData(sourceId: string, documentId: string) {
  const document = db.select({
    id: wikiPdfDocuments.id,
    sourceId: wikiPdfDocuments.sourceId,
    attachmentId: wikiPdfDocuments.attachmentId,
    role: wikiPdfDocuments.role,
    version: wikiPdfDocuments.version,
    status: wikiPdfDocuments.status,
    pageCount: wikiPdfDocuments.pageCount,
    progressPage: wikiPdfDocuments.progressPage,
    metadataJson: wikiPdfDocuments.metadataJson,
    error: wikiPdfDocuments.error,
    fileName: attachments.fileName,
    sourceTitle: wikiSources.title,
  }).from(wikiPdfDocuments)
    .innerJoin(attachments, eq(wikiPdfDocuments.attachmentId, attachments.id))
    .innerJoin(wikiSources, eq(wikiPdfDocuments.sourceId, wikiSources.id))
    .where(and(eq(wikiPdfDocuments.id, documentId), eq(wikiPdfDocuments.sourceId, sourceId), isNull(wikiSources.deletedAt))).get();
  if (!document) return null;

  const pages = db.select({
    pageNumber: wikiPdfPages.pageNumber,
    width: wikiPdfPages.width,
    height: wikiPdfPages.height,
    text: wikiPdfPages.text,
    textLayerJson: wikiPdfPages.textLayerJson,
    extractionMethod: wikiPdfPages.extractionMethod,
    hasThumbnail: wikiPdfPages.thumbnailStoredName,
  }).from(wikiPdfPages).where(eq(wikiPdfPages.documentId, documentId))
    .orderBy(asc(wikiPdfPages.pageNumber)).all()
    .map((page) => ({ ...page, hasThumbnail: Boolean(page.hasThumbnail) }));

  const annotations = db.select({
    id: wikiPdfAnnotations.id,
    pageNumber: wikiPdfAnnotations.pageNumber,
    kind: wikiPdfAnnotations.kind,
    selectedText: wikiPdfAnnotations.selectedText,
    note: wikiPdfAnnotations.note,
    label: wikiPdfAnnotations.label,
    color: wikiPdfAnnotations.color,
    geometryJson: wikiPdfAnnotations.geometryJson,
    hasPreview: wikiPdfAnnotations.previewStoredName,
    createdBy: wikiPdfAnnotations.createdBy,
    createdByName: user.name,
    createdAt: wikiPdfAnnotations.createdAt,
    updatedAt: wikiPdfAnnotations.updatedAt,
  }).from(wikiPdfAnnotations).innerJoin(user, eq(wikiPdfAnnotations.createdBy, user.id))
    .where(and(eq(wikiPdfAnnotations.documentId, documentId), isNull(wikiPdfAnnotations.deletedAt)))
    .orderBy(asc(wikiPdfAnnotations.pageNumber), asc(wikiPdfAnnotations.createdAt)).all()
    .map((annotation) => ({ ...annotation, hasPreview: Boolean(annotation.hasPreview) }));
  const annotationIds = annotations.map((annotation) => annotation.id);
  const comments = annotationIds.length ? db.select({
    id: wikiPdfAnnotationComments.id,
    annotationId: wikiPdfAnnotationComments.annotationId,
    body: wikiPdfAnnotationComments.body,
    createdBy: wikiPdfAnnotationComments.createdBy,
    createdByName: user.name,
    createdAt: wikiPdfAnnotationComments.createdAt,
  }).from(wikiPdfAnnotationComments).innerJoin(user, eq(wikiPdfAnnotationComments.createdBy, user.id))
    .where(inArray(wikiPdfAnnotationComments.annotationId, annotationIds)).orderBy(asc(wikiPdfAnnotationComments.createdAt)).all() : [];
  const commentsByAnnotation = new Map<string, typeof comments>();
  for (const comment of comments) commentsByAnnotation.set(comment.annotationId, [...(commentsByAnnotation.get(comment.annotationId) ?? []), comment]);
  return { document, pages, annotations: annotations.map((annotation) => ({ ...annotation, comments: commentsByAnnotation.get(annotation.id) ?? [] })) };
}

export function listEvidenceForTarget(targetType: EvidenceTargetType, targetId: string) {
  return db.select({
    linkId: evidenceLinks.id,
    annotationId: wikiPdfAnnotations.id,
    sourceId: wikiPdfAnnotations.sourceId,
    documentId: wikiPdfAnnotations.documentId,
    pageNumber: wikiPdfAnnotations.pageNumber,
    kind: wikiPdfAnnotations.kind,
    selectedText: wikiPdfAnnotations.selectedText,
    note: wikiPdfAnnotations.note,
    label: wikiPdfAnnotations.label,
    color: wikiPdfAnnotations.color,
    deletedAt: wikiPdfAnnotations.deletedAt,
    sourceTitle: wikiSources.title,
  }).from(evidenceLinks)
    .innerJoin(wikiPdfAnnotations, eq(evidenceLinks.annotationId, wikiPdfAnnotations.id))
    .innerJoin(wikiSources, eq(wikiPdfAnnotations.sourceId, wikiSources.id))
    .where(and(eq(evidenceLinks.targetType, targetType), eq(evidenceLinks.targetId, targetId)))
    .orderBy(desc(evidenceLinks.createdAt)).all();
}

export function searchEvidenceAnnotations(query = "", limit = 100) {
  const like = `%${query.trim()}%`;
  return sqlite.prepare(`
    SELECT a.id, a.source_id AS sourceId, a.document_id AS documentId,
           a.page_number AS pageNumber, a.kind, a.selected_text AS selectedText,
           a.note, a.label, a.color, s.title AS sourceTitle
    FROM wiki_pdf_annotations a
    JOIN wiki_sources s ON s.id = a.source_id
    WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL
      AND (? = '%%' OR s.title LIKE ? OR a.selected_text LIKE ? OR a.note LIKE ? OR a.label LIKE ?)
    ORDER BY a.updated_at DESC LIMIT ?
  `).all(like, like, like, like, like, limit) as Array<{
    id: string; sourceId: string; documentId: string; pageNumber: number; kind: string;
    selectedText: string; note: string; label: string; color: string; sourceTitle: string;
  }>;
}

export function searchPdfPageText(query: string, limit = 20) {
  const words = query.trim().replace(/["'*]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return [];
  const fts = words.map((word) => `"${word}"*`).join(" AND ");
  return sqlite.prepare(`
    SELECT f.document_id AS documentId, f.source_id AS sourceId,
           CAST(f.page_number AS integer) AS pageNumber, s.title AS sourceTitle,
           snippet(wiki_pdf_pages_fts, 3, '<mark>', '</mark>', ' … ', 18) AS snippet
    FROM wiki_pdf_pages_fts f
    JOIN wiki_sources s ON s.id = f.source_id
    WHERE wiki_pdf_pages_fts MATCH ? AND s.deleted_at IS NULL
    ORDER BY bm25(wiki_pdf_pages_fts) LIMIT ?
  `).all(fts, limit) as Array<{ documentId: string; sourceId: string; pageNumber: number; sourceTitle: string; snippet: string }>;
}
