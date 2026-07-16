import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
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

export function listInvoices() {
  const rows = db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      customerId: invoices.customerId,
      customerName: customers.name,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      status: invoices.status,
    })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .orderBy(desc(invoices.numberYear), desc(invoices.numberSeq))
    .all();

  if (rows.length === 0) return rows.map((row) => ({ ...row, grossCents: 0 }));

  const items = db.select().from(invoiceItems).all();
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
