import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "@/db/core-schema";
import { employees, entries } from "@/modules/accounting/schema";
import { fundingProjects } from "@/modules/funding/schema";
import { projects } from "@/modules/projects/schema";

export const personnelScenarioKinds = ["baseline", "scenario"] as const;
export const personnelScenarioStatuses = ["draft", "active", "archived"] as const;
export const personnelRuleStatuses = ["verified", "forecast"] as const;

export const employmentContractPeriods = sqliteTable(
  "employment_contract_periods",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    employmentType: text("employment_type").notNull(),
    inputMode: text("input_mode", { enum: ["gross", "net"] }).notNull().default("gross"),
    monthlyAmountCents: integer("monthly_amount_cents").notNull(),
    weeklyMinutes: integer("weekly_minutes").notNull(),
    workdaysPerWeek: integer("workdays_per_week").notNull().default(5),
    specialPaymentsEnabled: integer("special_payments_enabled", { mode: "boolean" }).notNull().default(true),
    holidayPayMonth: integer("holiday_pay_month").notNull().default(6),
    christmasPayMonth: integer("christmas_pay_month").notNull().default(11),
    vacationWeeksHundredths: integer("vacation_weeks_hundredths").notNull().default(500),
    expectedSickHoursHundredths: integer("expected_sick_hours_hundredths").notNull().default(0),
    trainingHoursHundredths: integer("training_hours_hundredths").notNull().default(0),
    internalHoursHundredths: integer("internal_hours_hundredths").notNull().default(0),
    overheadRateBasisPoints: integer("overhead_rate_basis_points").notNull().default(0),
    salesMarkupBasisPoints: integer("sales_markup_basis_points").notNull().default(0),
    collectiveAgreement: text("collective_agreement").notNull().default(""),
    oneOffPaymentsJson: text("one_off_payments_json", { mode: "json" })
      .$type<Array<{ month: number; amountCents: number; label: string }>>()
      .notNull()
      .default([]),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("employment_contract_employee_valid_idx").on(table.employeeId, table.validFrom),
  ],
);

export const personnelTaxProfiles = sqliteTable(
  "personnel_tax_profiles",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    taxableBenefitsCents: integer("taxable_benefits_cents").notNull().default(0),
    commuterAllowanceCents: integer("commuter_allowance_cents").notNull().default(0),
    commuterEuroCents: integer("commuter_euro_cents").notNull().default(0),
    familyBonusCents: integer("family_bonus_cents").notNull().default(0),
    soleEarnerCreditCents: integer("sole_earner_credit_cents").notNull().default(0),
    singleParentCreditCents: integer("single_parent_credit_cents").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("personnel_tax_employee_valid_idx").on(table.employeeId, table.validFrom)],
);

export const personnelScenarios = sqliteTable(
  "personnel_scenarios",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    employeeId: text("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    sourceScenarioId: text("source_scenario_id"),
    name: text("name").notNull(),
    kind: text("kind", { enum: personnelScenarioKinds }).notNull().default("scenario"),
    status: text("status", { enum: personnelScenarioStatuses }).notNull().default("draft"),
    planningYear: integer("planning_year").notNull(),
    inputJson: text("input_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    resultJson: text("result_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ruleVersion: text("rule_version").notNull(),
    checksum: text("checksum").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("personnel_scenarios_employee_year_idx").on(table.employeeId, table.planningYear),
  ],
);

export const projectHourAllocations = sqliteTable(
  "project_hour_allocations",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    payrollMonth: text("payroll_month").notNull(),
    plannedMinutes: integer("planned_minutes").notNull(),
    costRateCents: integer("cost_rate_cents").notNull(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("project_hours_employee_project_month_idx").on(table.employeeId, table.projectId, table.payrollMonth),
    index("project_hours_project_month_idx").on(table.projectId, table.payrollMonth),
  ],
);

export const fundingCostProfiles = sqliteTable(
  "funding_cost_profiles",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    version: text("version").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    divisorMode: text("divisor_mode", { enum: ["productive_hours", "fixed"] }).notNull().default("productive_hours"),
    fixedAnnualDivisor: integer("fixed_annual_divisor"),
    eligibleComponentsJson: text("eligible_components_json", { mode: "json" }).$type<string[]>().notNull().default([]),
    hourlyCapCents: integer("hourly_cap_cents"),
    maxAnnualHoursHundredths: integer("max_annual_hours_hundredths"),
    overheadRateBasisPoints: integer("overhead_rate_basis_points").notNull().default(0),
    roundingMode: text("rounding_mode", { enum: ["cent", "euro"] }).notNull().default("cent"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("funding_cost_profile_name_version_idx").on(table.name, table.version)],
);

export const personnelFundingProjectLinks = sqliteTable(
  "personnel_funding_project_links",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fundingProjectId: text("funding_project_id").notNull().references(() => fundingProjects.id, { onDelete: "cascade" }),
    fundingProfileId: text("funding_profile_id").references(() => fundingCostProfiles.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("personnel_funding_project_link_idx").on(table.projectId, table.fundingProjectId),
  ],
);

export const personnelMonthSnapshots = sqliteTable(
  "personnel_month_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    payrollMonth: text("payroll_month").notNull(),
    ruleVersion: text("rule_version").notNull(),
    ruleStatus: text("rule_status", { enum: personnelRuleStatuses }).notNull(),
    inputJson: text("input_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    resultJson: text("result_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    checksum: text("checksum").notNull().unique(),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("personnel_snapshot_month_idx").on(table.payrollMonth, table.createdAt)],
);

export const personnelPostings = sqliteTable(
  "personnel_postings",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    payrollMonth: text("payroll_month").notNull(),
    snapshotId: text("snapshot_id").notNull().references(() => personnelMonthSnapshots.id),
    entryId: text("entry_id").notNull().references(() => entries.id),
    kind: text("kind", { enum: ["regular", "correction"] }).notNull().default("regular"),
    createdBy: text("created_by").notNull().references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("personnel_postings_month_idx").on(table.payrollMonth, table.createdAt),
    uniqueIndex("personnel_postings_snapshot_idx").on(table.snapshotId),
  ],
);
