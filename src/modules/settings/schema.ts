import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "@/db/core-schema";

export const userInvitations = sqliteTable("user_invitations", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  role: text("role", { enum: ["member", "personnel", "admin"] }).notNull(),
  invitedBy: text("invited_by").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
}, (table) => [index("user_invitations_email_idx").on(table.email)]);
