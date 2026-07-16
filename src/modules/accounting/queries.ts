import { and, asc, desc, eq, like, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachments, categories, entries } from "@/db/schema";
import type { EntryKind } from "./schema";

export type EntryFilters = {
  year: number;
  month?: number; // 1-12
  kind?: EntryKind;
  categoryId?: string;
};

function periodPrefix(year: number, month?: number) {
  return month ? `${year}-${String(month).padStart(2, "0")}-%` : `${year}-%`;
}

export type EntryRow = Awaited<ReturnType<typeof listEntries>>[number];

export function listEntries(filters: EntryFilters) {
  const conditions = [like(entries.date, periodPrefix(filters.year, filters.month))];
  if (filters.kind) conditions.push(eq(entries.kind, filters.kind));
  if (filters.categoryId) conditions.push(eq(entries.categoryId, filters.categoryId));

  const rows = db
    .select({
      id: entries.id,
      kind: entries.kind,
      date: entries.date,
      description: entries.description,
      counterparty: entries.counterparty,
      categoryId: entries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      grossAmountCents: entries.grossAmountCents,
      vatRate: entries.vatRate,
      vatAmountCents: entries.vatAmountCents,
      netAmountCents: entries.netAmountCents,
      paymentMethod: entries.paymentMethod,
      notes: entries.notes,
    })
    .from(entries)
    .innerJoin(categories, eq(entries.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(desc(entries.date), desc(entries.createdAt))
    .all();

  if (rows.length === 0) return rows.map((row) => ({ ...row, attachmentCount: 0 }));

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
  return rows.map((row) => ({
    ...row,
    attachmentCount: countMap.get(row.id) ?? 0,
  }));
}

export function entryTotals(filters: EntryFilters) {
  const rows = listEntries(filters);
  let incomeGross = 0;
  let expenseGross = 0;
  for (const row of rows) {
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
  return (
    db
      .select({ value: sql<number>`count(*)` })
      .from(entries)
      .where(eq(entries.categoryId, categoryId))
      .get()?.value ?? 0
  );
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
    .where(like(entries.date, `${year}-%`))
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
};

export function categorySummary(year: number): CategorySummary[] {
  return db
    .select({
      categoryId: entries.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      kind: entries.kind,
      gross: sql<number>`sum(${entries.grossAmountCents})`,
      net: sql<number>`sum(${entries.netAmountCents})`,
      vat: sql<number>`sum(${entries.vatAmountCents})`,
    })
    .from(entries)
    .innerJoin(categories, eq(entries.categoryId, categories.id))
    .where(like(entries.date, `${year}-%`))
    .groupBy(entries.categoryId, entries.kind)
    .orderBy(desc(entries.kind), desc(sql`sum(${entries.grossAmountCents})`))
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
      vatRate: entries.vatRate,
      kind: entries.kind,
      net: sql<number>`sum(${entries.netAmountCents})`,
      vat: sql<number>`sum(${entries.vatAmountCents})`,
    })
    .from(entries)
    .where(like(entries.date, `${year}-%`))
    .groupBy(entries.vatRate, entries.kind)
    .orderBy(desc(entries.vatRate))
    .all();
}
