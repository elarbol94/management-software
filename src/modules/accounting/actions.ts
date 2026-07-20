"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { budgetPlans, categories, entries } from "@/db/schema";
import { requireAdmin, requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor } from "@/lib/files";
import { breakdownFromGross, isVatRate } from "./lib/vat";
import { categoryUsageCount } from "./queries";

const entrySchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["income", "expense"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  counterparty: z.string().max(200).default(""),
  categoryId: z.string().min(1),
  grossAmountCents: z.number().int().positive(),
  vatRate: z.number().int(),
  paymentMethod: z.enum(["bank", "cash", "card"]),
  notes: z.string().max(2000).default(""),
});

export type EntryInput = z.infer<typeof entrySchema>;

export async function upsertEntry(input: EntryInput): Promise<{ id: string }> {
  const user = await requireUserOrThrow();
  const data = entrySchema.parse(input);
  if (!isVatRate(data.vatRate)) throw new Error("Invalid VAT rate");

  const category = db
    .select()
    .from(categories)
    .where(eq(categories.id, data.categoryId))
    .get();
  if (!category) throw new Error("Unknown category");
  if (category.kind !== data.kind) {
    throw new Error("Category kind does not match entry kind");
  }

  const { netCents, vatCents } = breakdownFromGross(
    data.grossAmountCents,
    data.vatRate,
  );

  const values = {
    kind: data.kind,
    date: data.date,
    description: data.description,
    counterparty: data.counterparty,
    categoryId: data.categoryId,
    grossAmountCents: data.grossAmountCents,
    vatRate: data.vatRate,
    vatAmountCents: vatCents,
    netAmountCents: netCents,
    paymentMethod: data.paymentMethod,
    notes: data.notes,
    updatedAt: new Date(),
  };

  let id = data.id;
  if (id) {
    db.update(entries).set(values).where(eq(entries.id, id)).run();
  } else {
    const row = db
      .insert(entries)
      .values({ ...values, createdBy: user.id })
      .returning({ id: entries.id })
      .get();
    id = row.id;
  }

  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/accounting/report");
  revalidatePath("/accounting/planning");
  revalidatePath("/accounting/funding");
  revalidatePath("/documents");
  return { id };
}

export async function deleteEntry(id: string) {
  await requireUserOrThrow();
  deleteAttachmentsFor("entry", id);
  db.delete(entries).where(eq(entries.id, id)).run();
  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/accounting/report");
  revalidatePath("/accounting/planning");
  revalidatePath("/accounting/funding");
  revalidatePath("/documents");
}

// --- Categories (admin only) ---

const categorySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  kind: z.enum(["income", "expense"]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#64748b"),
});

export type CategoryInput = z.infer<typeof categorySchema>;

export async function upsertCategory(input: CategoryInput) {
  await requireAdmin();
  const data = categorySchema.parse(input);

  if (data.id) {
    db.update(categories)
      .set({ name: data.name, color: data.color })
      .where(eq(categories.id, data.id))
      .run();
  } else {
    db.insert(categories)
      .values({ name: data.name, kind: data.kind, color: data.color })
      .run();
  }
  revalidatePath("/settings/categories");
  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/documents");
  revalidatePath("/accounting/planning");
}

export async function setCategoryArchived(id: string, archived: boolean) {
  await requireAdmin();
  db.update(categories).set({ archived }).where(eq(categories.id, id)).run();
  revalidatePath("/settings/categories");
  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/documents");
  revalidatePath("/accounting/planning");
}

/** Deletes a category only when no entries reference it; archive otherwise. */
export async function deleteCategory(id: string): Promise<{ deleted: boolean }> {
  await requireAdmin();
  if (categoryUsageCount(id) > 0) return { deleted: false };
  db.delete(categories).where(eq(categories.id, id)).run();
  revalidatePath("/settings/categories");
  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/accounting/planning");
  revalidatePath("/documents");
  return { deleted: true };
}

const planningSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  amounts: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        month: z.number().int().min(1).max(12),
        amountCents: z.number().int().min(0).max(100_000_000_000),
      }),
    )
    .max(12_000),
});

export type PlanningInput = z.infer<typeof planningSchema>;

/** Saves the supplied planning cells without disturbing categories not shown in the UI. */
export async function savePlanning(input: PlanningInput) {
  await requireUserOrThrow();
  const data = planningSchema.parse(input);
  const categoryIds = [...new Set(data.amounts.map((amount) => amount.categoryId))];
  const existingIds =
    categoryIds.length === 0
      ? []
      : db
          .select({ id: categories.id })
          .from(categories)
          .where(inArray(categories.id, categoryIds))
          .all()
          .map((row) => row.id);
  if (existingIds.length !== categoryIds.length) throw new Error("Unknown category");

  db.transaction((tx) => {
    for (const amount of data.amounts) {
      if (amount.amountCents === 0) {
        tx.delete(budgetPlans)
          .where(
            and(
              eq(budgetPlans.categoryId, amount.categoryId),
              eq(budgetPlans.year, data.year),
              eq(budgetPlans.month, amount.month),
            ),
          )
          .run();
        continue;
      }
      tx.insert(budgetPlans)
        .values({
          categoryId: amount.categoryId,
          year: data.year,
          month: amount.month,
          amountCents: amount.amountCents,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [budgetPlans.categoryId, budgetPlans.year, budgetPlans.month],
          set: { amountCents: amount.amountCents, updatedAt: new Date() },
        })
        .run();
    }
  });

  revalidatePath("/accounting/planning");
}
