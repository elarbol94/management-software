import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "@/db/core-schema";

export const fundingProjectStatuses = [
  "planning",
  "preparing",
  "submitted",
  "approved",
  "active",
  "completed",
  "rejected",
] as const;
export type FundingProjectStatus = (typeof fundingProjectStatuses)[number];

export const fundingCostTypes = [
  "personnel",
  "external_services",
  "material",
  "investments",
  "travel",
  "rent",
  "overhead",
  "program_specific",
] as const;
export type FundingCostType = (typeof fundingCostTypes)[number];

export const fundingSourceTypes = [
  "requested_grant",
  "own_funds",
  "own_services",
  "bank",
  "shareholder",
  "other_public",
  "private_investor",
] as const;
export type FundingSourceType = (typeof fundingSourceTypes)[number];

export const fundingDisbursementStatuses = ["planned", "received"] as const;
export type FundingDisbursementStatus =
  (typeof fundingDisbursementStatuses)[number];

export const fundingEvidenceStatuses = ["missing", "partial", "complete"] as const;
export type FundingEvidenceStatus = (typeof fundingEvidenceStatuses)[number];

/**
 * Product templates provide editable structure and terminology only. Changing
 * programme rules and legal limits deliberately live in JSON configuration,
 * not immutable application logic.
 */
export const fundingProgramTemplates = sqliteTable(
  "funding_program_templates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    structureJson: text("structure_json").notNull().default("{}"),
    isCustom: integer("is_custom", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("funding_program_templates_key_idx").on(table.key)],
);

export const fundingProjects = sqliteTable(
  "funding_projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    templateId: text("template_id").references(() => fundingProgramTemplates.id, {
      onDelete: "set null",
    }),
    programName: text("program_name").notNull().default(""),
    fundingBody: text("funding_body").notNull(),
    name: text("name").notNull(),
    submissionDeadline: text("submission_deadline"),
    plannedSubmissionDate: text("planned_submission_date"),
    projectStart: text("project_start"),
    projectEnd: text("project_end"),
    status: text("status", { enum: fundingProjectStatuses })
      .notNull()
      .default("planning"),
    fundingRateBasisPoints: integer("funding_rate_basis_points")
      .notNull()
      .default(0),
    fundingCapCents: integer("funding_cap_cents"),
    approvedFundingCents: integer("approved_funding_cents").notNull().default(0),
    contactName: text("contact_name").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    fundingNumber: text("funding_number").notNull().default(""),
    vatDeductible: integer("vat_deductible", { mode: "boolean" })
      .notNull()
      .default(false),
    deMinimisRelevant: integer("de_minimis_relevant", { mode: "boolean" })
      .notNull()
      .default(false),
    otherAidCents: integer("other_aid_cents").notNull().default(0),
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
    index("funding_projects_status_idx").on(table.status),
    index("funding_projects_template_idx").on(table.templateId),
  ],
);

export const fundingBudgetItems = sqliteTable(
  "funding_budget_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => fundingProjects.id, { onDelete: "cascade" }),
    costType: text("cost_type", { enum: fundingCostTypes }).notNull(),
    customCostType: text("custom_cost_type").notNull().default(""),
    description: text("description").notNull(),
    workPackage: text("work_package").notNull().default(""),
    supplierOrPerson: text("supplier_or_person").notNull().default(""),
    quantityThousandths: integer("quantity_thousandths").notNull().default(1000),
    unitLabel: text("unit_label").notNull().default("Stk."),
    unitPriceCents: integer("unit_price_cents").notNull(),
    plannedMonth: text("planned_month"),
    totalCents: integer("total_cents").notNull(),
    eligibleAmountCents: integer("eligible_amount_cents").notNull(),
    necessityJustification: text("necessity_justification").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("funding_budget_items_project_idx").on(table.projectId)],
);

export const fundingFinancingSources = sqliteTable(
  "funding_financing_sources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => fundingProjects.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: fundingSourceTypes }).notNull(),
    label: text("label").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("funding_financing_sources_project_idx").on(table.projectId)],
);

export const fundingDisbursements = sqliteTable(
  "funding_disbursements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => fundingProjects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    plannedDate: text("planned_date"),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: fundingDisbursementStatuses })
      .notNull()
      .default("planned"),
    receivedAt: text("received_at"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("funding_disbursements_project_idx").on(table.projectId)],
);

/**
 * Adapter boundary to Accounting: accountingEntryId is intentionally a
 * nullable logical reference. The accounting slice can add a strict FK after
 * its booking schema is stable without this module owning or duplicating it.
 */
export const fundingBookingAllocations = sqliteTable(
  "funding_booking_allocations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => fundingProjects.id, { onDelete: "cascade" }),
    budgetItemId: text("budget_item_id")
      .notNull()
      .references(() => fundingBudgetItems.id, { onDelete: "cascade" }),
    accountingEntryId: text("accounting_entry_id"),
    bookingDate: text("booking_date").notNull(),
    description: text("description").notNull().default(""),
    actualAmountCents: integer("actual_amount_cents").notNull(),
    evidenceStatus: text("evidence_status", { enum: fundingEvidenceStatuses })
      .notNull()
      .default("missing"),
    evidenceNote: text("evidence_note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("funding_booking_allocations_project_idx").on(table.projectId),
    index("funding_booking_allocations_budget_idx").on(table.budgetItemId),
    index("funding_booking_allocations_entry_idx").on(table.accountingEntryId),
  ],
);

// Funding owns the relationship between received grant income and the
// accounting ledger. The entry id is a logical reference, matching the
// existing allocation boundary until the accounting schema is fully stable.
export const fundingIncomeLinks = sqliteTable(
  "funding_income_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => fundingProjects.id, { onDelete: "cascade" }),
    accountingEntryId: text("accounting_entry_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("funding_income_links_entry_idx").on(table.accountingEntryId),
    index("funding_income_links_project_idx").on(table.projectId),
  ],
);

export const fundingEvidenceItems = sqliteTable(
  "funding_evidence_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => fundingProjects.id, { onDelete: "cascade" }),
    budgetItemId: text("budget_item_id").references(() => fundingBudgetItems.id, {
      onDelete: "set null",
    }),
    bookingAllocationId: text("booking_allocation_id").references(
      () => fundingBookingAllocations.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    status: text("status", { enum: fundingEvidenceStatuses })
      .notNull()
      .default("missing"),
    dueDate: text("due_date"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [index("funding_evidence_items_project_idx").on(table.projectId)],
);
