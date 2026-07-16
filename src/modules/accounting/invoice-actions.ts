"use server";

import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories, customers, entries, invoiceItems, invoices } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { getAppSettings } from "@/modules/settings/queries";
import { computeInvoiceTotals, formatInvoiceNumber } from "./lib/invoice";

// --- Customers ---

const customerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  address: z.string().max(1000).default(""),
  uid: z.string().max(50).default(""),
  email: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export async function upsertCustomer(
  input: CustomerInput,
): Promise<{ id: string }> {
  await requireUserOrThrow();
  const data = customerSchema.parse(input);

  if (data.id) {
    const { id, ...values } = data;
    db.update(customers).set(values).where(eq(customers.id, id)).run();
    revalidatePath("/accounting/customers");
    return { id };
  }

  const row = db
    .insert(customers)
    .values(data)
    .returning({ id: customers.id })
    .get();
  revalidatePath("/accounting/customers");
  return { id: row.id };
}

export async function deleteCustomer(id: string): Promise<{ deleted: boolean }> {
  await requireUserOrThrow();
  const used = db
    .select({ value: sql<number>`count(*)` })
    .from(invoices)
    .where(eq(invoices.customerId, id))
    .get();
  if ((used?.value ?? 0) > 0) return { deleted: false };
  db.delete(customers).where(eq(customers.id, id)).run();
  revalidatePath("/accounting/customers");
  return { deleted: true };
}

// --- Invoices ---

const itemSchema = z.object({
  description: z.string().min(1).max(500),
  quantityThousandths: z.number().int().positive(),
  unitPriceCents: z.number().int().min(0),
  vatRate: z.number().int(),
});

const invoiceSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  notes: z.string().max(2000).default(""),
  items: z.array(itemSchema).min(1).max(100),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;

export async function upsertInvoice(
  input: InvoiceInput,
): Promise<{ id: string }> {
  const user = await requireUserOrThrow();
  const data = invoiceSchema.parse(input);
  computeInvoiceTotals(data.items); // validates VAT rates

  if (data.id) {
    const existing = db
      .select()
      .from(invoices)
      .where(eq(invoices.id, data.id))
      .get();
    if (!existing) throw new Error("Invoice not found");
    if (existing.status !== "draft") {
      throw new Error("Only draft invoices can be edited");
    }

    db.transaction(() => {
      db.update(invoices)
        .set({
          customerId: data.customerId,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          notes: data.notes,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, data.id!))
        .run();
      db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, data.id!)).run();
      db.insert(invoiceItems)
        .values(
          data.items.map((item, index) => ({
            ...item,
            invoiceId: data.id!,
            sortOrder: (index + 1) * 10,
          })),
        )
        .run();
    });
    revalidatePath("/accounting/invoices");
    return { id: data.id };
  }

  // Gapless per-year numbering (§ 11 UStG): allocate inside the transaction.
  const settings = getAppSettings();
  const year = Number(data.issueDate.slice(0, 4));

  const id = db.transaction(() => {
    const maxSeq =
      db
        .select({ value: sql<number>`coalesce(max(${invoices.numberSeq}), 0)` })
        .from(invoices)
        .where(eq(invoices.numberYear, year))
        .get()?.value ?? 0;
    const seq = maxSeq + 1;

    const row = db
      .insert(invoices)
      .values({
        invoiceNumber: formatInvoiceNumber(settings.invoicePrefix, year, seq),
        numberYear: year,
        numberSeq: seq,
        customerId: data.customerId,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        notes: data.notes,
        createdBy: user.id,
      })
      .returning({ id: invoices.id })
      .get();

    db.insert(invoiceItems)
      .values(
        data.items.map((item, index) => ({
          ...item,
          invoiceId: row.id,
          sortOrder: (index + 1) * 10,
        })),
      )
      .run();

    return row.id;
  });

  revalidatePath("/accounting/invoices");
  return { id };
}

const statusSchema = z.enum(["draft", "sent", "paid", "canceled"]);

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "canceled"],
  sent: ["paid", "canceled"],
  paid: [],
  canceled: [],
};

/**
 * Status flow: draft → sent → paid / canceled. Invoices are never deleted.
 * Marking as paid books the income into the ledger (one entry per VAT rate),
 * linked via entries.invoiceId.
 */
export async function setInvoiceStatus(
  id: string,
  status: z.infer<typeof statusSchema>,
) {
  const user = await requireUserOrThrow();
  const newStatus = statusSchema.parse(status);

  const invoice = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!invoice) throw new Error("Invoice not found");
  if (!ALLOWED_TRANSITIONS[invoice.status].includes(newStatus)) {
    throw new Error(`Cannot change status from ${invoice.status} to ${newStatus}`);
  }

  const customer = db
    .select()
    .from(customers)
    .where(eq(customers.id, invoice.customerId))
    .get();

  db.transaction(() => {
    db.update(invoices)
      .set({
        status: newStatus,
        paidAt: newStatus === "paid" ? new Date() : invoice.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id))
      .run();

    if (newStatus === "paid") {
      const items = db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, id))
        .orderBy(asc(invoiceItems.sortOrder))
        .all();
      const totals = computeInvoiceTotals(items);

      const incomeCategory = db
        .select()
        .from(categories)
        .where(and(eq(categories.kind, "income"), eq(categories.archived, false)))
        .orderBy(asc(categories.sortOrder))
        .get();
      if (!incomeCategory) throw new Error("No income category available");

      const today = new Date().toISOString().slice(0, 10);
      for (const group of totals.byRate) {
        db.insert(entries)
          .values({
            kind: "income",
            date: today,
            description: `Rechnung ${invoice.invoiceNumber}`,
            counterparty: customer?.name ?? "",
            categoryId: incomeCategory.id,
            grossAmountCents: group.grossCents,
            vatRate: group.vatRate,
            vatAmountCents: group.vatCents,
            netAmountCents: group.netCents,
            paymentMethod: "bank",
            invoiceId: id,
            notes: "",
            createdBy: user.id,
          })
          .run();
      }
    }
  });

  revalidatePath("/accounting/invoices");
  revalidatePath("/accounting");
}
