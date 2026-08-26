import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { attachments, user } from "@/db/core-schema";
import type { StoredCommentAnchorData } from "./lib/comment-anchors";

export const wikiPageStatuses = ["inbox", "working", "evergreen"] as const;
export const wikiSourceTypes = [
  "journalArticle",
  "book",
  "bookChapter",
  "report",
  "webPage",
  "document",
] as const;
export const wikiReadingStatuses = ["toRead", "reading", "read"] as const;
// "ieee" keeps the hand-rolled renderer every existing page was written against;
// the rest are rendered by citation-js from real CSL styles.
export const wikiCitationStyles = ["ieee", "apa", "vancouver", "harvard1"] as const;

export const wikiDocumentTemplates = sqliteTable(
  "wiki_document_templates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    settingsJson: text("settings_json").notNull(),
    contentJson: text("content_json").notNull().default(""),
    constraintsJson: text("constraints_json").notNull().default("[]"),
    createdBy: text("created_by").notNull().references(() => user.id),
    updatedBy: text("updated_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_document_templates_name_idx").on(table.name)],
);

/**
 * An outline of the argument, kept separate from the page tree on purpose.
 *
 * Pages organise documents; categories organise what the sources actually say. Evidence
 * attaches to a category through evidenceLinks, so a passage can support a point in the
 * report without first belonging to a page — which is how research is read (by claim)
 * rather than how it is filed (by document).
 */
export const wikiEmbeddingKinds = ["page", "pdfPage"] as const;

/**
 * Metadata for one embedded chunk. The vectors live in a sqlite-vec virtual table keyed
 * by this row's integer id, because vec0 only accepts integer rowids and cannot hold the
 * cuid2 strings the rest of the schema uses.
 *
 * contentHash lets a re-index skip text that has not changed, which matters because
 * embedding is the slow part of saving.
 */
export const wikiEmbeddings = sqliteTable(
  "wiki_embeddings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: wikiEmbeddingKinds }).notNull(),
    /** Page id, or PDF document id. */
    refId: text("ref_id").notNull(),
    pageNumber: integer("page_number").notNull().default(0),
    chunkIndex: integer("chunk_index").notNull().default(0),
    contentHash: text("content_hash").notNull(),
    text: text("text").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("wiki_embeddings_chunk_unique").on(table.kind, table.refId, table.pageNumber, table.chunkIndex),
    index("wiki_embeddings_ref_idx").on(table.kind, table.refId),
  ],
);

export const wikiCategories = sqliteTable(
  "wiki_categories",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    parentId: text("parent_id").references((): AnySQLiteColumn => wikiCategories.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("wiki_categories_parent_idx").on(table.parentId, table.sortOrder),
  ],
);

export const wikiPages = sqliteTable(
  "wiki_pages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    // Comma-separated slugs this page used to live at, so old links keep resolving.
    previousSlugs: text("previous_slugs").notNull().default(""),
    parentId: text("parent_id").references((): AnySQLiteColumn => wikiPages.id),
    sortOrder: integer("sort_order").notNull().default(0),
    contentJson: text("content_json").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    icon: text("icon"),
    status: text("status", { enum: wikiPageStatuses }).notNull().default("inbox"),
    citationLocale: text("citation_locale").notNull().default("de-DE"),
    citationStyle: text("citation_style", { enum: wikiCitationStyles }).notNull().default("ieee"),
    proofingLanguage: text("proofing_language", { enum: ["de-DE", "en-US"] }).notNull().default("de-DE"),
    documentMode: integer("document_mode", { mode: "boolean" }).notNull().default(false),
    documentSettingsJson: text("document_settings_json").notNull().default(""),
    documentTemplateId: text("document_template_id").references(() => wikiDocumentTemplates.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    contentVersion: integer("content_version").notNull().default(1),
    /** Who last confirmed this page is still accurate, and until when. */
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    verifiedUntil: integer("verified_until", { mode: "timestamp_ms" }),
    verifiedBy: text("verified_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("wiki_pages_parent_idx").on(table.parentId),
    index("wiki_pages_deleted_status_updated_idx").on(
      table.deletedAt,
      table.status,
      table.updatedAt,
    ),
    index("wiki_pages_verified_until_idx").on(table.deletedAt, table.verifiedUntil),
  ],
);

export const wikiProofingWords = sqliteTable(
  "wiki_proofing_words",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    language: text("language", { enum: ["de-DE", "en-US"] }).notNull(),
    word: text("word").notNull(),
    normalizedWord: text("normalized_word").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("wiki_proofing_words_language_word_unique").on(table.language, table.normalizedWord),
  ],
);


export const wikiSources = sqliteTable(
  "wiki_sources",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    type: text("type", { enum: wikiSourceTypes }).notNull().default("document"),
    documentType: text("document_type").notNull().default(""),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    issuedDate: text("issued_date").notNull().default(""),
    containerTitle: text("container_title").notNull().default(""),
    publisher: text("publisher").notNull().default(""),
    institution: text("institution").notNull().default(""),
    edition: text("edition").notNull().default(""),
    volume: text("volume").notNull().default(""),
    issue: text("issue").notNull().default(""),
    pages: text("pages").notNull().default(""),
    doi: text("doi").notNull().default(""),
    isbn: text("isbn").notNull().default(""),
    url: text("url").notNull().default(""),
    accessedAt: text("accessed_at").notNull().default(""),
    language: text("language").notNull().default(""),
    abstract: text("abstract").notNull().default(""),
    notes: text("notes").notNull().default(""),
    readingStatus: text("reading_status", { enum: wikiReadingStatuses })
      .notNull()
      .default("toRead"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").notNull().references(() => user.id),
    updatedBy: text("updated_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("wiki_sources_title_idx").on(table.title),
    index("wiki_sources_status_idx").on(table.readingStatus),
    index("wiki_sources_doi_idx").on(table.doi),
    index("wiki_sources_isbn_idx").on(table.isbn),
    index("wiki_sources_deleted_updated_idx").on(
      table.deletedAt,
      table.updatedAt,
    ),
  ],
);

export const wikiSourceContributors = sqliteTable(
  "wiki_source_contributors",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    sourceId: text("source_id").notNull().references(() => wikiSources.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["author", "editor"] }).notNull().default("author"),
    given: text("given").notNull().default(""),
    family: text("family").notNull().default(""),
    literal: text("literal").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("wiki_contributors_source_idx").on(table.sourceId)],
);

export const wikiTags = sqliteTable(
  "wiki_tags",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    color: text("color").notNull().default("indigo"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("wiki_tags_normalized_unique").on(table.normalizedName)],
);

export const wikiPageTags = sqliteTable(
  "wiki_page_tags",
  {
    pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => wikiTags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.pageId, table.tagId] })],
);

export const wikiSourceTags = sqliteTable(
  "wiki_source_tags",
  {
    sourceId: text("source_id").notNull().references(() => wikiSources.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => wikiTags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.tagId] })],
);

export const wikiPageSources = sqliteTable(
  "wiki_page_sources",
  {
    pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull().references(() => wikiSources.id, { onDelete: "cascade" }),
    relation: text("relation", { enum: ["supporting", "citation"] }).notNull().default("supporting"),
  },
  (table) => [
    primaryKey({ columns: [table.pageId, table.sourceId, table.relation] }),
    index("wiki_page_sources_source_idx").on(table.sourceId),
  ],
);

export const wikiFavorites = sqliteTable(
  "wiki_favorites",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["page", "source"] }).notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.entityType, table.entityId] })],
);

export const wikiPageRevisions = sqliteTable(
  "wiki_page_revisions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentVersion: integer("content_version").notNull().default(1),
    contentHash: text("content_hash").notNull().default(""),
    label: text("label"),
    title: text("title").notNull(),
    contentJson: text("content_json").notNull(),
    status: text("status", { enum: wikiPageStatuses }).notNull(),
    citationLocale: text("citation_locale").notNull(),
    citationStyle: text("citation_style", { enum: wikiCitationStyles }).notNull().default("ieee"),
    documentMode: integer("document_mode", { mode: "boolean" }).notNull().default(false),
    documentSettingsJson: text("document_settings_json").notNull().default(""),
    documentTemplateId: text("document_template_id").references(() => wikiDocumentTemplates.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["autosave", "manual", "conflict", "restore"] }).notNull().default("autosave"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_page_revisions_page_idx").on(table.pageId, table.createdAt)],
);

export const wikiPageEditLeases = sqliteTable(
  "wiki_page_edit_leases",
  {
    pageId: text("page_id").primaryKey().references(() => wikiPages.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    acquiredAt: integer("acquired_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("wiki_page_edit_leases_heartbeat_idx").on(table.heartbeatAt),
    index("wiki_page_edit_leases_user_idx").on(table.userId),
  ],
);

export const wikiSvgAssets = sqliteTable(
  "wiki_svg_assets",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
    currentSvg: text("current_svg").notNull(),
    bindingsJson: text("bindings_json").notNull().default("{}"),
    version: integer("version").notNull().default(1),
    /** Folder-relative path of the imported file, used to re-match it on the next folder sync. */
    sourcePath: text("source_path"),
    /** Hash of the last imported source bytes, so an unchanged file is not re-versioned. */
    sourceSha256: text("source_sha256"),
    /** Overrides the document's diagram scale for this one graphic. */
    sizeScale: real("size_scale"),
    /** Literaturstelle imported from the graphic's sidecar file. */
    sourceId: text("source_id").references(() => wikiSources.id, { onDelete: "set null" }),
    /** Ready-made figure caption from the sidecar, used when inserting. */
    caption: text("caption"),
    /** Hash of the last imported sidecar, so an unchanged one is not re-saved. */
    sidecarSha256: text("sidecar_sha256"),
    updatedBy: text("updated_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("wiki_svg_assets_attachment_unique").on(table.attachmentId),
    // NULL source paths repeat freely in SQLite, so hand-added assets stay unaffected.
    uniqueIndex("wiki_svg_assets_page_source_unique").on(table.pageId, table.sourcePath),
    index("wiki_svg_assets_page_idx").on(table.pageId, table.updatedAt),
  ],
);

export const wikiSvgRevisions = sqliteTable(
  "wiki_svg_revisions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    assetId: text("asset_id").notNull().references(() => wikiSvgAssets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    svg: text("svg").notNull(),
    bindingsJson: text("bindings_json").notNull().default("{}"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("wiki_svg_revisions_asset_version_unique").on(table.assetId, table.version),
    index("wiki_svg_revisions_asset_created_idx").on(table.assetId, table.createdAt),
  ],
);

export const wikiSourceRevisions = sqliteTable(
  "wiki_source_revisions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    sourceId: text("source_id").notNull().references(() => wikiSources.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_source_revisions_source_idx").on(table.sourceId, table.createdAt)],
);

export const wikiCommentThreads = sqliteTable(
  "wiki_comment_threads",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    anchorQuote: text("anchor_quote").notNull().default(""),
    anchorType: text("anchor_type", { enum: ["page", "text", "image"] }).notNull().default("text"),
    anchorNodeId: text("anchor_node_id"),
    anchorData: text("anchor_data", { mode: "json" }).$type<StoredCommentAnchorData>().notNull().default({}),
    orphaned: integer("orphaned", { mode: "boolean" }).notNull().default(false),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedBy: text("resolved_by").references(() => user.id),
    assigneeId: text("assignee_id").references(() => user.id),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("wiki_comment_threads_page_idx").on(table.pageId),
    index("wiki_comment_threads_page_created_idx").on(
      table.pageId,
      table.createdAt,
    ),
  ],
);

export const wikiComments = sqliteTable(
  "wiki_comments",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    threadId: text("thread_id").notNull().references(() => wikiCommentThreads.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("wiki_comments_thread_idx").on(table.threadId),
    index("wiki_comments_thread_deleted_created_idx").on(
      table.threadId,
      table.deletedAt,
      table.createdAt,
    ),
  ],
);

export const wikiNotifications = sqliteTable(
  "wiki_notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["mention", "reply", "assignment", "resolved"] }).notNull(),
    pageId: text("page_id").references(() => wikiPages.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => wikiCommentThreads.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_notifications_user_idx").on(table.userId, table.readAt, table.createdAt)],
);

// Rebuilt on every save by walking the Tiptap document for internal links.
export const wikiLinks = sqliteTable(
  "wiki_links",
  {
    sourcePageId: text("source_page_id")
      .notNull()
      .references(() => wikiPages.id, { onDelete: "cascade" }),
    targetPageId: text("target_page_id")
      .notNull()
      .references(() => wikiPages.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.sourcePageId, table.targetPageId] }),
    index("wiki_links_target_idx").on(table.targetPageId),
  ],
);
