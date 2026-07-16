import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "@/db/core-schema";

export const wikiPages = sqliteTable(
  "wiki_pages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    parentId: text("parent_id").references((): AnySQLiteColumn => wikiPages.id),
    sortOrder: integer("sort_order").notNull().default(0),
    contentJson: text("content_json").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    icon: text("icon"),
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
  (table) => [index("wiki_pages_parent_idx").on(table.parentId)],
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
