import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

// --- Better Auth tables (camelCase columns to match Better Auth conventions) ---

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  username: text("username").unique(),
  displayUsername: text("displayUsername"),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  // admin plugin
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }),
  banReason: text("banReason"),
  banExpires: integer("banExpires", { mode: "timestamp_ms" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const userProfilePreferences = sqliteTable("user_profile_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  markColor: text("mark_color").notNull().unique(),
  wikiTypographyJson: text("wiki_typography_json").default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // admin plugin
  impersonatedBy: text("impersonatedBy"),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

// --- App settings (single row, id = "default") ---

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey().default("default"),
  companyName: text("company_name").notNull().default(""),
  address: text("address").notNull().default(""),
  uid: text("uid").notNull().default(""), // ATU number
  iban: text("iban").notNull().default(""),
  bic: text("bic").notNull().default(""),
  // Kleinunternehmer per § 6 Abs 1 Z 27 UStG: invoices carry the exemption
  // note and 0% VAT when enabled.
  kleinunternehmer: integer("kleinunternehmer", { mode: "boolean" })
    .notNull()
    .default(false),
  invoicePrefix: text("invoice_prefix").notNull().default(""),
  defaultVatRate: integer("default_vat_rate").notNull().default(20),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// --- Attachments (polymorphic, shared by all modules) ---

export const attachmentEntityTypes = [
  "entry",
  "invoice",
  "task",
  "wikiPage",
  "wikiSource",
] as const;

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    fileName: text("file_name").notNull(),
    storedName: text("stored_name").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    entityType: text("entity_type", { enum: attachmentEntityTypes }).notNull(),
    entityId: text("entity_id").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("attachments_entity_idx").on(table.entityType, table.entityId)],
);

export const performanceEvents = sqliteTable(
  "performance_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    kind: text("kind", { enum: ["web-vital", "operation"] }).notNull(),
    name: text("name").notNull(),
    value: real("value").notNull(),
    rating: text("rating", { enum: ["good", "needs-improvement", "poor"] }),
    route: text("route").notNull(),
    navigationType: text("navigation_type"),
    buildId: text("build_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("performance_events_created_idx").on(table.createdAt),
    index("performance_events_metric_idx").on(
      table.kind,
      table.name,
      table.createdAt,
    ),
  ],
);
