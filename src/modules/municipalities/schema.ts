import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "@/db/core-schema";

export const municipalityAnalyses = sqliteTable(
  "municipality_analyses",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    graphJson: text("graph_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("municipality_analyses_owner_updated_idx").on(table.ownerId, table.updatedAt)],
);
