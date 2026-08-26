import { createId } from "@paralleldrive/cuid2";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { attachments, user } from "@/db/core-schema";
import { wikiSources } from "./schema";
import { evidenceTargetTypes } from "./lib/pdf-evidence";

export const pdfDocumentRoles = ["primary", "supplementary"] as const;
export const pdfProcessingStatuses = ["queued", "extracting", "ocr", "ready", "failed"] as const;
export const pdfExtractionMethods = ["native", "ocr", "empty"] as const;
export const pdfAnnotationKinds = ["text", "region", "bookmark"] as const;

export const wikiPdfDocuments = sqliteTable(
  "wiki_pdf_documents",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    sourceId: text("source_id").notNull().references(() => wikiSources.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
    role: text("role", { enum: pdfDocumentRoles }).notNull().default("primary"),
    version: integer("version").notNull().default(1),
    status: text("status", { enum: pdfProcessingStatuses }).notNull().default("queued"),
    pageCount: integer("page_count").notNull().default(0),
    progressPage: integer("progress_page").notNull().default(0),
    metadataJson: text("metadata_json").notNull().default("{}"),
    error: text("error").notNull().default(""),
    attempts: integer("attempts").notNull().default(0),
    lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("wiki_pdf_documents_attachment_unique").on(table.attachmentId),
    index("wiki_pdf_documents_source_idx").on(table.sourceId, table.createdAt),
    index("wiki_pdf_documents_queue_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const wikiPdfPages = sqliteTable(
  "wiki_pdf_pages",
  {
    documentId: text("document_id").notNull().references(() => wikiPdfDocuments.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    width: real("width").notNull().default(0),
    height: real("height").notNull().default(0),
    text: text("text").notNull().default(""),
    textLayerJson: text("text_layer_json").notNull().default("[]"),
    extractionMethod: text("extraction_method", { enum: pdfExtractionMethods }).notNull().default("empty"),
    thumbnailStoredName: text("thumbnail_stored_name").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.pageNumber] }),
    index("wiki_pdf_pages_document_idx").on(table.documentId, table.pageNumber),
  ],
);

export const wikiPdfAnnotations = sqliteTable(
  "wiki_pdf_annotations",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    sourceId: text("source_id").notNull().references(() => wikiSources.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => wikiPdfDocuments.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    kind: text("kind", { enum: pdfAnnotationKinds }).notNull(),
    selectedText: text("selected_text").notNull().default(""),
    note: text("note").notNull().default(""),
    label: text("label").notNull().default(""),
    geometryJson: text("geometry_json").notNull().default("[]"),
    previewStoredName: text("preview_stored_name").notNull().default(""),
    createdBy: text("created_by").notNull().references(() => user.id),
    updatedBy: text("updated_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("wiki_pdf_annotations_document_idx").on(table.documentId, table.pageNumber, table.deletedAt),
    index("wiki_pdf_annotations_source_idx").on(table.sourceId, table.deletedAt),
  ],
);

export const wikiPdfAnnotationComments = sqliteTable(
  "wiki_pdf_annotation_comments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    annotationId: text("annotation_id").notNull().references(() => wikiPdfAnnotations.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_pdf_annotation_comments_annotation_idx").on(table.annotationId, table.createdAt)],
);

export const evidenceLinks = sqliteTable(
  "evidence_links",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    annotationId: text("annotation_id").notNull().references(() => wikiPdfAnnotations.id),
    targetType: text("target_type", { enum: evidenceTargetTypes }).notNull(),
    targetId: text("target_id").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("evidence_links_unique").on(table.annotationId, table.targetType, table.targetId),
    index("evidence_links_target_idx").on(table.targetType, table.targetId),
  ],
);
