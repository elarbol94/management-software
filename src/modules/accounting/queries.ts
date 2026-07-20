import { and, asc, desc, eq, like, ne, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, budgetPlans, categories, employees, entries, entryAuditLog, entryPaymentLines, entryTaxLines, user } from "@/db/schema";
import type { EntryKind } from "./schema";

export type EntryFilters = {
  year: number;
  month?: number; // 1-12
  kind?: EntryKind;
  categoryId?: string;
  includePersonnelDetails?: boolean;
};

function periodPrefix(year: number, month?: number) {
  return month ? `${year}-${String(month).padStart(2, "0")}-%` : `${year}-%`;
}

export type EntryRow = Awaited<ReturnType<typeof listEntries>>[number];

export type ReceiptDocumentRow = ReturnType<typeof listReceiptDocuments>[number];

/** Receipt files attached to ledger entries, with the context needed for a document inbox. */
export function listReceiptDocuments() {
  return db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      uploadedAt: attachments.createdAt,
      entryId: entries.id,
      entryKind: entries.kind,
      entryDate: entries.date,
      description: entries.description,
      counterparty: entries.counterparty,
      categoryName: categories.name,
      grossAmountCents: entries.grossAmountCents,
    })
    .from(attachments)
    .innerJoin(entries, eq(attachments.entityId, entries.id))
    .innerJoin(categories, eq(entries.categoryId, categories.id))
    .where(eq(attachments.entityType, "entry"))
    .orderBy(desc(entries.date), desc(attachments.createdAt))
    .all();
}

export function listEntries(filters: EntryFilters) {
  const conditions = [
    like(entries.date, periodPrefix(filters.year, filters.month)),
    ne(entries.status, "voided"),
  ];
  if (filters.kind) conditions.push(eq(entries.kind, filters.kind));
  if (filters.categoryId) conditions.push(eq(entries.categoryId, filters.categoryId));

  const rows = db
    .select({
      id: entries.id,
      kind: entries.kind,
      date: entries.date,
      documentDate: entries.documentDate,
      documentNumber: entries.documentNumber,
      servicePeriodStart: entries.servicePeriodStart,
      servicePeriodEnd: entries.servicePeriodEnd,
      status: entries.status,
      description: entries.description,
      counterparty: entries.counterparty,
      categoryId: entries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryTemplate: categories.template,
      grossAmountCents: entries.grossAmountCents,
      vatRate: entries.vatRate,
      vatAmountCents: entries.vatAmountCents,
      netAmountCents: entries.netAmountCents,
      paymentMethod: entries.paymentMethod,
      notes: entries.notes,
      deductiblePercent: entries.deductiblePercent,
      warningOverrideReason: entries.warningOverrideReason,
      specialFields: entries.specialFields,
    })
    .from(entries)
    .innerJoin(categories, eq(entries.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(desc(entries.date), desc(entries.createdAt))
    .all();

  if (rows.length === 0) {
    return rows.map((row) => ({
      ...row,
      attachmentCount: 0,
      taxLines: [],
      paymentLines: [],
      auditHistory: [],
    }));
  }

  const counts = db
    .select({
      entityId: attachments.entityId,
      count: sql<number>`count(*)`,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, "entry"),
        inArray(
          attachments.entityId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .groupBy(attachments.entityId)
    .all();

  const countMap = new Map(counts.map((c) => [c.entityId, c.count]));
  const taxRows = db
    .select()
    .from(entryTaxLines)
    .where(inArray(entryTaxLines.entryId, rows.map((row) => row.id)))
    .orderBy(asc(entryTaxLines.sortOrder))
    .all();
  const taxMap = new Map<string, typeof taxRows>();
  for (const line of taxRows) {
    taxMap.set(line.entryId, [...(taxMap.get(line.entryId) ?? []), line]);
  }
  const paymentRows = db
    .select()
    .from(entryPaymentLines)
    .where(inArray(entryPaymentLines.entryId, rows.map((row) => row.id)))
    .orderBy(asc(entryPaymentLines.sortOrder))
    .all();
  const paymentMap = new Map<string, typeof paymentRows>();
  for (const line of paymentRows) {
    paymentMap.set(line.entryId, [...(paymentMap.get(line.entryId) ?? []), line]);
  }
  const auditRows = db
    .select({
      id: entryAuditLog.id,
      entryId: entryAuditLog.entryId,
      action: entryAuditLog.action,
      reason: entryAuditLog.reason,
      changedAt: entryAuditLog.changedAt,
      changedByName: user.name,
    })
    .from(entryAuditLog)
    .innerJoin(user, eq(entryAuditLog.changedBy, user.id))
    .where(inArray(entryAuditLog.entryId, rows.map((row) => row.id)))
    .orderBy(desc(entryAuditLog.changedAt))
    .all();
  const auditMap = new Map<string, typeof auditRows>();
  for (const item of auditRows) {
    auditMap.set(item.entryId, [...(auditMap.get(item.entryId) ?? []), item]);
  }
  return rows.map((row) => ({
    ...row,
    description:
      row.categoryTemplate === "personnel" && !filters.includePersonnelDetails
        ? "Personalkosten"
        : row.description,
    counterparty:
      row.categoryTemplate === "personnel" && !filters.includePersonnelDetails
        ? ""
        : row.counterparty,
    specialFields:
      row.categoryTemplate === "personnel" && !filters.includePersonnelDetails
        ? {}
        : row.specialFields,
    attachmentCount: countMap.get(row.id) ?? 0,
    taxLines: taxMap.get(row.id) ?? [],
    paymentLines:
      row.categoryTemplate === "personnel" && !filters.includePersonnelDetails
        ? []
        : paymentMap.get(row.id) ?? [],
    auditHistory:
      row.categoryTemplate === "personnel" && !filters.includePersonnelDetails
        ? []
        : auditMap.get(row.id) ?? [],
  }));
}

export function entryTotals(filters: EntryFilters) {
  const rows = listEntries(filters);
  let incomeGross = 0;
  let expenseGross = 0;
  for (const row of rows.filter((entry) => entry.status === "finalized")) {
    if (row.kind === "income") incomeGross += row.grossAmountCents;
    else expenseGross += row.grossAmountCents;
  }
  return { incomeGross, expenseGross, balance: incomeGross - expenseGross };
}

export function listCategories(options?: { includeArchived?: boolean }) {
  const where = options?.includeArchived ? undefined : eq(categories.archived, false);
  return db
    .select()
    .from(categories)
    .where(where)
    .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name))
    .all();
}

export function categoryUsageCount(categoryId: string): number {
  const entryCount =
    db
      .select({ value: sql<number>`count(*)` })
      .from(entries)
      .where(eq(entries.categoryId, categoryId))
      .get()?.value ?? 0;
  const planCount =
    db
      .select({ value: sql<number>`count(*)` })
      .from(budgetPlans)
      .where(eq(budgetPlans.categoryId, categoryId))
      .get()?.value ?? 0;
  return entryCount + planCount;
}

export function yearsWithEntries(): number[] {
  const rows = db
    .select({ year: sql<string>`distinct substr(${entries.date}, 1, 4)` })
    .from(entries)
    .all();
  return rows
    .map((row) => Number(row.year))
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => b - a);
}

export function yearsWithPlans(): number[] {
  return db
    .select({ year: budgetPlans.year })
    .from(budgetPlans)
    .groupBy(budgetPlans.year)
    .orderBy(desc(budgetPlans.year))
    .all()
    .map((row) => row.year);
}

export type PlanningRow = {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  kind: EntryKind;
  archived: boolean;
  plannedByMonth: number[];
  actualByMonth: number[];
};

/** Monthly gross targets and journal actuals for the annual planning view. */
export function planningOverview(year: number): PlanningRow[] {
  const categoryRows = listCategories({ includeArchived: true });
  const planRows = db
    .select({
      categoryId: budgetPlans.categoryId,
      month: budgetPlans.month,
      amountCents: budgetPlans.amountCents,
    })
    .from(budgetPlans)
    .where(eq(budgetPlans.year, year))
    .all();
  const actualRows = db
    .select({
      categoryId: entries.categoryId,
      month: sql<string>`substr(${entries.date}, 6, 2)`,
      amountCents: sql<number>`sum(${entries.grossAmountCents})`,
    })
    .from(entries)
    .where(and(like(entries.date, `${year}-%`), eq(entries.status, "finalized")))
    .groupBy(entries.categoryId, sql`substr(${entries.date}, 6, 2)`)
    .all();

  return categoryRows
    .map((category) => {
      const plannedByMonth = Array<number>(12).fill(0);
      const actualByMonth = Array<number>(12).fill(0);
      for (const plan of planRows) {
        if (plan.categoryId === category.id && plan.month >= 1 && plan.month <= 12) {
          plannedByMonth[plan.month - 1] = plan.amountCents;
        }
      }
      for (const actual of actualRows) {
        const month = Number(actual.month);
        if (actual.categoryId === category.id && month >= 1 && month <= 12) {
          actualByMonth[month - 1] = actual.amountCents;
        }
      }
      return {
        categoryId: category.id,
        categoryName: category.name,
        categoryColor: category.color,
        kind: category.kind,
        archived: category.archived,
        plannedByMonth,
        actualByMonth,
      };
    })
    .filter(
      (row) =>
        !row.archived ||
        row.plannedByMonth.some((amount) => amount !== 0) ||
        row.actualByMonth.some((amount) => amount !== 0),
    );
}

// --- Auswertung (report) queries ---

export type MonthlySummary = {
  month: number;
  incomeGross: number;
  expenseGross: number;
};

export function monthlySummary(year: number): MonthlySummary[] {
  const rows = db
    .select({
      month: sql<string>`substr(${entries.date}, 6, 2)`,
      kind: entries.kind,
      gross: sql<number>`sum(${entries.grossAmountCents})`,
    })
    .from(entries)
    .where(and(like(entries.date, `${year}-%`), eq(entries.status, "finalized")))
    .groupBy(sql`substr(${entries.date}, 6, 2)`, entries.kind)
    .all();

  const months: MonthlySummary[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    incomeGross: 0,
    expenseGross: 0,
  }));
  for (const row of rows) {
    const idx = Number(row.month) - 1;
    if (idx < 0 || idx > 11) continue;
    if (row.kind === "income") months[idx].incomeGross = row.gross;
    else months[idx].expenseGross = row.gross;
  }
  return months;
}

export type CategorySummary = {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  kind: EntryKind;
  gross: number;
  net: number;
  vat: number;
  deductible: number;
};

export function categorySummary(year: number): CategorySummary[] {
  return db
    .select({
      categoryId: entries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      kind: entries.kind,
      gross: sql<number>`sum(${entryTaxLines.grossAmountCents})`,
      net: sql<number>`sum(${entryTaxLines.netAmountCents})`,
      vat: sql<number>`sum(${entryTaxLines.vatAmountCents})`,
      deductible: sql<number>`sum(round((${entryTaxLines.netAmountCents} + ${entryTaxLines.vatAmountCents} - round(${entryTaxLines.vatAmountCents} * ${entryTaxLines.inputVatDeductiblePercent} / 100.0)) * ${entries.deductiblePercent} / 100.0))`,
    })
    .from(entries)
    .innerJoin(categories, eq(entries.categoryId, categories.id))
    .innerJoin(entryTaxLines, eq(entryTaxLines.entryId, entries.id))
    .where(and(like(entries.date, `${year}-%`), eq(entries.status, "finalized")))
    .groupBy(entries.categoryId, entries.kind)
    .orderBy(desc(entries.kind), desc(sql`sum(${entryTaxLines.grossAmountCents})`))
    .all();
}

export type VatSummary = {
  vatRate: number;
  kind: EntryKind;
  net: number;
  vat: number;
};

/** VAT collected (income = Umsatzsteuer) vs. paid (expense = Vorsteuer) per rate. */
export function vatSummary(year: number): VatSummary[] {
  return db
    .select({
      vatRate: entryTaxLines.vatRate,
      kind: entries.kind,
      net: sql<number>`sum(${entryTaxLines.netAmountCents})`,
      vat: sql<number>`sum(case when ${entries.kind} = 'expense' then round(${entryTaxLines.vatAmountCents} * ${entryTaxLines.inputVatDeductiblePercent} / 100.0) else ${entryTaxLines.vatAmountCents} end)`,
    })
    .from(entries)
    .innerJoin(entryTaxLines, eq(entryTaxLines.entryId, entries.id))
    .where(and(like(entries.date, `${year}-%`), eq(entries.status, "finalized")))
    .groupBy(entryTaxLines.vatRate, entries.kind)
    .orderBy(desc(entryTaxLines.vatRate))
    .all();
}

/** Call only after a page has checked the personnel permission. */
export function listPersonnelEmployees() {
  return db
    .select()
    .from(employees)
    .where(eq(employees.active, true))
    .orderBy(asc(employees.name))
    .all();
}
