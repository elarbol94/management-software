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

/**
 * Snapshot of a whole presentation before a save overwrote it, modelled on
 * `wikiPageRevisions`: the canvas and the path are the entire document, so a revision
 * stores both verbatim rather than a diff.
 */
export const wikiPresentationRevisions = sqliteTable(
  "wiki_presentation_revisions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    presentationId: text("presentation_id").notNull().references(() => wikiPresentations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    elementsJson: text("elements_json").notNull(),
    pathJson: text("path_json").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_presentation_revisions_presentation_idx").on(table.presentationId, table.createdAt)],
);

/**
 * One editor at a time, same lease/heartbeat pattern as `wikiPageEditLeases`: the holder
 * refreshes `heartbeatAt` while the editor is open and a stale lease simply expires, so a
 * crashed tab never locks a presentation for good.
 */
export const wikiPresentationEditLeases = sqliteTable(
  "wiki_presentation_edit_leases",
  {
    presentationId: text("presentation_id").primaryKey().references(() => wikiPresentations.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    acquiredAt: integer("acquired_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("wiki_presentation_edit_leases_heartbeat_idx").on(table.heartbeatAt)],
);
