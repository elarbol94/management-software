import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "@/db/core-schema";

export const entryKinds = ["income", "expense"] as const;
export type EntryKind = (typeof entryKinds)[number];

export const paymentMethods = ["bank", "cash", "card"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const categories = sqliteTable("categories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  kind: text("kind", { enum: entryKinds }).notNull(),
  color: text("color").notNull().default("#64748b"),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const customers = sqliteTable("customers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  uid: text("uid").notNull().default(""),
  email: text("email").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const invoiceStatuses = ["draft", "sent", "paid", "canceled"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

// § 11 UStG requires gapless sequential numbering: numbers are allocated
// per year inside a transaction; invoices are never hard-deleted.
export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    invoiceNumber: text("invoice_number").notNull().unique(),
    numberYear: integer("number_year").notNull(),
    numberSeq: integer("number_seq").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    issueDate: text("issue_date").notNull(), // ISO YYYY-MM-DD
    dueDate: text("due_date"),
    status: text("status", { enum: invoiceStatuses }).notNull().default("draft"),
    notes: text("notes").notNull().default(""),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("invoices_year_seq_idx").on(table.numberYear, table.numberSeq),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantityThousandths: integer("quantity_thousandths").notNull().default(1000),
    unitPriceCents: integer("unit_price_cents").notNull(), // net
    vatRate: integer("vat_rate").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("invoice_items_invoice_idx").on(table.invoiceId)],
);

// The E/A ledger. Cash basis: `date` is the payment date (Zahlungsdatum).
// Gross, net and VAT are all stored explicitly — computed once on save —
// so exports and reports always sum exactly.
export const entries = sqliteTable(
  "entries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    kind: text("kind", { enum: entryKinds }).notNull(),
    date: text("date").notNull(), // ISO YYYY-MM-DD
    description: text("description").notNull(),
    counterparty: text("counterparty").notNull().default(""),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    grossAmountCents: integer("gross_amount_cents").notNull(),
    vatRate: integer("vat_rate").notNull(),
    vatAmountCents: integer("vat_amount_cents").notNull(),
    netAmountCents: integer("net_amount_cents").notNull(),
    paymentMethod: text("payment_method", { enum: paymentMethods })
      .notNull()
      .default("bank"),
    invoiceId: text("invoice_id").references(() => invoices.id),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("entries_date_idx").on(table.date),
    index("entries_category_idx").on(table.categoryId),
  ],
);

// Gross monthly targets by category. A missing row is equivalent to a zero
// target, keeping future planning years sparse while preserving exact cents.
export const budgetPlans = sqliteTable(
  "budget_plans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    amountCents: integer("amount_cents").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("budget_plans_category_year_month_idx").on(
      table.categoryId,
      table.year,
      table.month,
    ),
    index("budget_plans_year_idx").on(table.year),
  ],
);
