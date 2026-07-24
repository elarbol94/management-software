import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { customers, invoiceItems, invoices } from "@/db/schema";
import { computeInvoiceTotals, type InvoiceItemInput } from "./lib/invoice";

export function listCustomers() {
  const rows = db.select().from(customers).orderBy(asc(customers.name)).all();
  if (rows.length === 0) return rows.map((row) => ({ ...row, invoiceCount: 0 }));

  const counts = db
    .select({ customerId: invoices.customerId, count: sql<number>`count(*)` })
    .from(invoices)
    .groupBy(invoices.customerId)
    .all();
  const countMap = new Map(counts.map((c) => [c.customerId, c.count]));
  return rows.map((row) => ({
    ...row,
    invoiceCount: countMap.get(row.id) ?? 0,
  }));
}

export function getCustomer(id: string) {
  return db.select().from(customers).where(eq(customers.id, id)).get();
}

export type InvoiceListRow = ReturnType<typeof listInvoices>[number];

function decodeInvoiceCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const [year, sequence, id] = Buffer.from(cursor, "base64url")
      .toString("utf8")
      .split("|");
    const numberYear = Number(year);
    const numberSeq = Number(sequence);
    if (!Number.isInteger(numberYear) || !Number.isInteger(numberSeq) || !id) {
      return null;
    }
    return { numberYear, numberSeq, id };
  } catch {
    return null;
  }
}

function encodeInvoiceCursor(invoice: {
  numberYear: number;
  numberSeq: number;
  id: string;
}) {
  return Buffer.from(
    `${invoice.numberYear}|${invoice.numberSeq}|${invoice.id}`,
  ).toString("base64url");
}

export function listInvoices(paging?: { cursor?: string; limit?: number }) {
  const cursor = decodeInvoiceCursor(paging?.cursor);
  const cursorCondition = cursor
    ? or(
        lt(invoices.numberYear, cursor.numberYear),
        and(
          eq(invoices.numberYear, cursor.numberYear),
          or(
            lt(invoices.numberSeq, cursor.numberSeq),
            and(
              eq(invoices.numberSeq, cursor.numberSeq),
              lt(invoices.id, cursor.id),
            ),
          ),
        ),
      )
    : undefined;
  const rows = db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      customerId: invoices.customerId,
      customerName: customers.name,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      status: invoices.status,
      numberYear: invoices.numberYear,
      numberSeq: invoices.numberSeq,
    })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(cursorCondition)
    .orderBy(
      desc(invoices.numberYear),
      desc(invoices.numberSeq),
      desc(invoices.id),
    )
    .limit(paging?.limit ? Math.min(101, Math.max(1, paging.limit)) : -1)
    .all();

  if (rows.length === 0) return rows.map((row) => ({ ...row, grossCents: 0 }));

  const items = db
    .select()
    .from(invoiceItems)
    .where(
      inArray(
        invoiceItems.invoiceId,
        rows.map((row) => row.id),
      ),
    )
    .all();
  const itemsByInvoice = new Map<string, InvoiceItemInput[]>();
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoiceId) ?? [];
    list.push(item);
    itemsByInvoice.set(item.invoiceId, list);
  }

  return rows.map((row) => ({
    ...row,
    grossCents: computeInvoiceTotals(itemsByInvoice.get(row.id) ?? []).grossCents,
  }));
}

export function listInvoicesPage(
  paging: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(100, Math.max(1, paging.limit ?? 50));
  const rows = listInvoices({ ...paging, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore
      ? encodeInvoiceCursor(items[items.length - 1])
      : null,
  };
}

export function invoiceStatusSummary(today: string) {
  return sqlite
    .prepare(
      `
      WITH rate_net AS (
        SELECT invoice_id, vat_rate,
               sum(round(quantity_thousandths * unit_price_cents / 1000.0)) AS net
        FROM invoice_items
        GROUP BY invoice_id, vat_rate
      ),
      totals AS (
        SELECT invoice_id,
               sum(net + round(net * vat_rate / 100.0)) AS gross
        FROM rate_net
        GROUP BY invoice_id
      )
      SELECT
        coalesce(sum(CASE WHEN i.status = 'draft' THEN 1 ELSE 0 END), 0) AS draftCount,
        coalesce(sum(CASE WHEN i.status = 'sent' THEN 1 ELSE 0 END), 0) AS openCount,
        coalesce(sum(CASE WHEN i.status = 'sent' AND i.due_date < ? THEN 1 ELSE 0 END), 0) AS overdueCount,
        coalesce(sum(CASE WHEN i.status = 'sent' THEN coalesce(t.gross, 0) ELSE 0 END), 0) AS outstandingCents
      FROM invoices i
      LEFT JOIN totals t ON t.invoice_id = i.id
    `,
    )
    .get(today) as {
    draftCount: number;
    openCount: number;
    overdueCount: number;
    outstandingCents: number;
  };
}

export function getInvoiceWithItems(id: string) {
  const invoice = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!invoice) return null;

  const customer = getCustomer(invoice.customerId);
  const items = db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id))
    .orderBy(asc(invoiceItems.sortOrder))
    .all();

  return { invoice, customer, items, totals: computeInvoiceTotals(items) };
}
