"use server";

import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  categories,
  customers,
  entries,
  entryAuditLog,
  entryPaymentLines,
  entryTaxLines,
  invoiceItems,
  invoices,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { getAppSettings } from "@/modules/settings/queries";
import { computeInvoiceTotals, formatInvoiceNumber } from "./lib/invoice";
import { isValidIsoDate, toLocalIsoDate } from "./lib/date";

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
    revalidatePath("/documents");
    return { id };
  }

  const row = db
    .insert(customers)
    .values(data)
    .returning({ id: customers.id })
    .get();
  revalidatePath("/accounting/customers");
  revalidatePath("/documents");
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
  revalidatePath("/documents");
  return { deleted: true };
}

// --- Invoices ---

const itemSchema = z.object({
  description: z.string().min(1).max(500),
  quantityThousandths: z.number().int().positive(),
  unitPriceCents: z.number().int().min(0),
  vatRate: z.number().int(),
});

const invoiceDateSchema = z.string().refine(isValidIsoDate, {
  message: "Invalid calendar date",
});

const invoiceSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1),
  issueDate: invoiceDateSchema,
  dueDate: invoiceDateSchema.nullable().default(null),
  notes: z.string().max(2000).default(""),
  items: z.array(itemSchema).min(1).max(100),
}).superRefine((invoice, context) => {
  if (invoice.dueDate && invoice.dueDate < invoice.issueDate) {
    context.addIssue({
      code: "custom",
      message: "Due date must not be before the issue date",
      path: ["dueDate"],
    });
  }
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;

export async function upsertInvoice(
  input: InvoiceInput,
): Promise<{ id: string }> {
  const user = await requireUserOrThrow();
  const data = invoiceSchema.parse(input);
  const settings = getAppSettings();
  computeInvoiceTotals(data.items); // validates VAT rates
  if (
    settings.kleinunternehmer &&
    data.items.some((item) => item.vatRate !== 0)
  ) {
    throw new Error("Small-business invoices must not contain VAT");
  }

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
    revalidatePath("/documents");
    return { id: data.id };
  }

  // Gapless per-year numbering (§ 11 UStG): allocate inside the transaction.
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
  revalidatePath("/documents");
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

  db.transaction((tx) => {
    const invoice = tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();
    if (!invoice) throw new Error("Invoice not found");
    if (!ALLOWED_TRANSITIONS[invoice.status].includes(newStatus)) {
      throw new Error(
        `Cannot change status from ${invoice.status} to ${newStatus}`,
      );
    }

    const transition = tx
      .update(invoices)
      .set({
        status: newStatus,
        paidAt: newStatus === "paid" ? new Date() : invoice.paidAt,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, id), eq(invoices.status, invoice.status)))
      .run();
    if (transition.changes !== 1) {
      throw new Error("Invoice status changed concurrently; reload and retry");
    }

    if (newStatus === "paid") {
      const existingEntry = tx
        .select({ id: entries.id })
        .from(entries)
        .where(eq(entries.invoiceId, id))
        .get();
      if (existingEntry) {
        throw new Error("This invoice already has ledger entries");
      }
      const customer = tx
        .select()
        .from(customers)
        .where(eq(customers.id, invoice.customerId))
        .get();
      const items = tx
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, id))
        .orderBy(asc(invoiceItems.sortOrder))
        .all();
      const totals = computeInvoiceTotals(items);

      const incomeCategory = tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.kind, "income"),
            eq(categories.archived, false),
            eq(categories.template, "standard_income"),
          ),
        )
        .orderBy(asc(categories.sortOrder))
        .get();
      if (!incomeCategory) {
        throw new Error(
          "Create an active standard income category before marking an invoice as paid",
        );
      }

      const today = toLocalIsoDate();
      for (const group of totals.byRate) {
        const description = `Rechnung ${invoice.invoiceNumber}`;
        const entryValues = {
          kind: "income" as const,
          date: today,
          documentDate: invoice.issueDate,
          documentNumber: invoice.invoiceNumber,
          description,
          counterparty: customer?.name ?? "",
          categoryId: incomeCategory.id,
          grossAmountCents: group.grossCents,
          vatRate: group.vatRate,
          vatAmountCents: group.vatCents,
          netAmountCents: group.netCents,
          paymentMethod: "bank" as const,
          invoiceId: id,
          notes: invoice.notes,
          createdBy: user.id,
        };
        const entry = tx
          .insert(entries)
          .values(entryValues)
          .returning({ id: entries.id })
          .get();
        const taxLine = {
          entryId: entry.id,
          description,
          netAmountCents: group.netCents,
          vatRate: group.vatRate,
          vatAmountCents: group.vatCents,
          grossAmountCents: group.grossCents,
          inputVatDeductiblePercent: 100,
          sortOrder: 0,
        };
        tx.insert(entryTaxLines).values(taxLine).run();
        const paymentLine = {
          entryId: entry.id,
          date: today,
          description,
          recipient: customer?.name ?? "",
          amountCents: group.grossCents,
          paymentMethod: "bank" as const,
          sortOrder: 0,
        };
        tx.insert(entryPaymentLines).values(paymentLine).run();
        tx.insert(entryAuditLog)
          .values({
            entryId: entry.id,
            action: "created",
            snapshot: {
              ...entryValues,
              taxLines: [taxLine],
              paymentLines: [paymentLine],
            },
            reason: "",
            changedBy: user.id,
          })
          .run();
      }
    }
  });

  revalidatePath("/accounting/invoices");
  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/documents");
  revalidatePath("/accounting/planning");
}
