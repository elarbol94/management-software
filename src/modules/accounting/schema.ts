import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "@/db/core-schema";

export const entryKinds = ["income", "expense"] as const;
export type EntryKind = (typeof entryKinds)[number];

export const paymentMethods = ["bank", "cash", "card"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const categoryTemplates = [
  "standard_income",
  "grant_income",
  "standard_expense",
  "hospitality",
  "travel",
  "vehicle",
  "asset",
  "personnel",
  "svs",
  "tax_levy",
] as const;
export type CategoryTemplate = (typeof categoryTemplates)[number];

export const entryStatuses = ["draft", "finalized", "voided"] as const;
export type EntryStatus = (typeof entryStatuses)[number];

export const categories = sqliteTable("categories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  kind: text("kind", { enum: entryKinds }).notNull(),
  color: text("color").notNull().default("#64748b"),
  template: text("template", { enum: categoryTemplates })
    .notNull()
    .default("standard_expense"),
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
    documentDate: text("document_date"), // ISO YYYY-MM-DD
    documentNumber: text("document_number").notNull().default(""),
    servicePeriodStart: text("service_period_start"),
    servicePeriodEnd: text("service_period_end"),
    status: text("status", { enum: entryStatuses }).notNull().default("finalized"),
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
    deductiblePercent: integer("deductible_percent").notNull().default(100),
    warningOverrideReason: text("warning_override_reason").notNull().default(""),
    specialFields: text("special_fields", { mode: "json" })
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidedBy: text("voided_by").references(() => user.id),
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
    index("entries_status_date_created_idx").on(
      table.status,
      table.date,
      table.createdAt,
    ),
  ],
);

// A receipt may contain more than one VAT rate. Legacy entries without rows
// remain readable through their aggregate amount columns.
export const entryTaxLines = sqliteTable(
  "entry_tax_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    description: text("description").notNull().default(""),
    netAmountCents: integer("net_amount_cents").notNull(),
    vatRate: integer("vat_rate").notNull(),
    vatAmountCents: integer("vat_amount_cents").notNull(),
    grossAmountCents: integer("gross_amount_cents").notNull(),
    inputVatDeductiblePercent: integer("input_vat_deductible_percent")
      .notNull()
      .default(100),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("entry_tax_lines_entry_idx").on(table.entryId)],
);

export const entryPaymentLines = sqliteTable(
  "entry_payment_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    description: text("description").notNull().default(""),
    recipient: text("recipient").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    paymentMethod: text("payment_method", { enum: paymentMethods }).notNull().default("bank"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("entry_payment_lines_entry_idx").on(table.entryId)],
);

export const entryAuditLog = sqliteTable(
  "entry_audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    snapshot: text("snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    reason: text("reason").notNull().default(""),
    changedBy: text("changed_by")
      .notNull()
      .references(() => user.id),
    changedAt: integer("changed_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("entry_audit_entry_idx").on(table.entryId)],
);

export const businessLocations = sqliteTable("business_locations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  state: text("state").notNull().default(""),
  municipality: text("municipality").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const employmentTypes = [
  "worker",
  "employee",
  "marginal",
  "apprentice",
  "freelance",
  "managing_director_asvg",
  "shareholder_managing_director_gsvg",
] as const;

export const employees = sqliteTable("employees", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  personnelNumber: text("personnel_number").notNull().default(""),
  employmentType: text("employment_type", { enum: employmentTypes }).notNull(),
  locationId: text("location_id").references(() => businessLocations.id),
  joinedOn: text("joined_on"),
  leftOn: text("left_on"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const payrollMonthContexts = sqliteTable("payroll_month_contexts", {
  payrollMonth: text("payroll_month").primaryKey(), // YYYY-MM
  internalPayrollCents: integer("internal_payroll_cents").notNull().default(0),
  externalPayrollCents: integer("external_payroll_cents").notNull().default(0),
  externalMarginalPayrollCents: integer("external_marginal_payroll_cents").notNull().default(0),
  marginalPayrollCents: integer("marginal_payroll_cents").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const vehicles = sqliteTable("accounting_vehicles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  registration: text("registration").notNull().default(""),
  inputVatEligible: integer("input_vat_eligible", { mode: "boolean" })
    .notNull()
    .default(false),
  businessUsePercent: integer("business_use_percent").notNull().default(100),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const assets = sqliteTable(
  "accounting_assets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id),
    name: text("name").notNull(),
    placedInServiceOn: text("placed_in_service_on").notNull(),
    acquisitionCostCents: integer("acquisition_cost_cents").notNull(),
    usefulLifeYears: integer("useful_life_years").notNull(),
    ruleVersion: text("rule_version").notNull().default("AT-2026-review-required"),
  },
  (table) => [uniqueIndex("accounting_assets_entry_idx").on(table.entryId)],
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
