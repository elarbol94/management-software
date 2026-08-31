import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "@/db/core-schema";

/**
 * One row is one whole presentation: the canvas elements and the ordered path across
 * them. Both are JSON because nothing outside the editor queries individual elements,
 * and a step is meaningless without the canvas it points at.
 */
export const wikiPresentations = sqliteTable(
  "wiki_presentations",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    title: text("title").notNull(),
    elementsJson: text("elements_json").notNull().default("[]"),
    pathJson: text("path_json").notNull().default("[]"),
    createdBy: text("created_by").notNull().references(() => user.id),
    updatedBy: text("updated_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_presentations_updated_idx").on(table.updatedAt)],
);
