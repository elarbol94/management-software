import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { attachments, user } from "@/db/core-schema";
import { wikiPages, wikiSources } from "./schema";

export const wikiFigureSources = sqliteTable("wiki_figure_sources", {
  id: text("id").primaryKey().$defaultFn(createId),
  pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["laptop", "server"] }).notNull(),
  name: text("name").notNull(),
  rootKey: text("root_key").notNull().default(""),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("wiki_figure_sources_page_idx").on(table.pageId)]);

export const wikiFigureAssets = sqliteTable("wiki_figure_assets", {
  id: text("id").primaryKey().$defaultFn(createId),
  pageId: text("page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => wikiFigureSources.id),
  relativePath: text("relative_path").notNull().default(""),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
  version: integer("version").notNull().default(1),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("ready"),
  caption: text("caption").notNull().default(""),
  literatureSourceId: text("literature_source_id").references(() => wikiSources.id, { onDelete: "set null" }),
  sidecarHash: text("sidecar_hash").notNull().default(""),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("wiki_figure_assets_source_path_unique").on(table.sourceId, table.relativePath), index("wiki_figure_assets_page_idx").on(table.pageId)]);

export const wikiFigureRevisions = sqliteTable("wiki_figure_revisions", {
  id: text("id").primaryKey().$defaultFn(createId),
  assetId: text("asset_id").notNull().references(() => wikiFigureAssets.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  attachmentId: text("attachment_id").notNull().references(() => attachments.id),
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("wiki_figure_revisions_version_unique").on(table.assetId, table.version)]);
