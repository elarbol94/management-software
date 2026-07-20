"use server";

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  fundingBookingAllocations,
  fundingBudgetItems,
  fundingDisbursements,
  fundingEvidenceItems,
  fundingFinancingSources,
  fundingProjects,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { calculateBudgetItemTotal } from "./lib/calculations";

const nullableDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const nullableMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .nullable();
const cents = z.number().int().nonnegative().max(9_000_000_000_000);

export const fundingProjectInputSchema = z
  .object({
    id: z.string().optional(),
    templateId: z.string().nullable(),
    programName: z.string().max(200).default(""),
    fundingBody: z.string().min(1).max(200),
    name: z.string().min(1).max(250),
    submissionDeadline: nullableDate,
    plannedSubmissionDate: nullableDate,
    projectStart: nullableDate,
    projectEnd: nullableDate,
    status: z.enum([
      "planning",
      "preparing",
      "submitted",
      "approved",
      "active",
      "completed",
      "rejected",
    ]),
    fundingRateBasisPoints: z.number().int().min(0).max(10_000),
    fundingCapCents: cents.nullable(),
    approvedFundingCents: cents,
    contactName: z.string().max(200).default(""),
    contactEmail: z.union([z.literal(""), z.email()]).default(""),
    fundingNumber: z.string().max(100).default(""),
    vatDeductible: z.boolean(),
    deMinimisRelevant: z.boolean(),
    otherAidCents: cents,
    notes: z.string().max(5000).default(""),
  })
  .refine(
    (value) =>
      !value.projectStart ||
      !value.projectEnd ||
      value.projectEnd >= value.projectStart,
    { path: ["projectEnd"], message: "Project end must not precede start" },
  );

export type FundingProjectInput = z.infer<typeof fundingProjectInputSchema>;

function revalidateFunding(projectId?: string) {
  revalidatePath("/accounting/funding-projects");
  if (projectId) revalidatePath(`/accounting/funding-projects/${projectId}`);
}

export async function upsertFundingProject(input: FundingProjectInput) {
  const user = await requireUserOrThrow();
  const data = fundingProjectInputSchema.parse(input);
  const values = {
    templateId: data.templateId,
    programName: data.programName,
    fundingBody: data.fundingBody,
    name: data.name,
    submissionDeadline: data.submissionDeadline,
    plannedSubmissionDate: data.plannedSubmissionDate,
    projectStart: data.projectStart,
    projectEnd: data.projectEnd,
    status: data.status,
    fundingRateBasisPoints: data.fundingRateBasisPoints,
    fundingCapCents: data.fundingCapCents,
    approvedFundingCents: data.approvedFundingCents,
    contactName: data.contactName,
    contactEmail: data.contactEmail,
    fundingNumber: data.fundingNumber,
    vatDeductible: data.vatDeductible,
    deMinimisRelevant: data.deMinimisRelevant,
    otherAidCents: data.otherAidCents,
    notes: data.notes,
    updatedAt: new Date(),
  };

  if (data.id) {
    const existing = db
      .select({ id: fundingProjects.id })
      .from(fundingProjects)
      .where(eq(fundingProjects.id, data.id))
      .get();
    if (!existing) throw new Error("Funding project not found");
    db.update(fundingProjects).set(values).where(eq(fundingProjects.id, data.id)).run();
    revalidateFunding(data.id);
    return { id: data.id };
  }

  const row = db
    .insert(fundingProjects)
    .values({ ...values, createdBy: user.id })
    .returning({ id: fundingProjects.id })
    .get();
  revalidateFunding(row.id);
  return row;
}

export const fundingBudgetItemInputSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  costType: z.enum([
    "personnel",
    "external_services",
    "material",
    "investments",
    "travel",
    "rent",
    "overhead",
    "program_specific",
  ]),
  customCostType: z.string().max(150).default(""),
  description: z.string().min(1).max(300),
  workPackage: z.string().max(150).default(""),
  supplierOrPerson: z.string().max(200).default(""),
  quantityThousandths: z.number().int().positive().max(100_000_000),
  unitLabel: z.string().min(1).max(30),
  unitPriceCents: cents,
  plannedMonth: nullableMonth,
  eligibleAmountCents: cents,
  necessityJustification: z.string().max(2000).default(""),
});
export type FundingBudgetItemInput = z.infer<typeof fundingBudgetItemInputSchema>;

function nextBudgetOrder(projectId: string) {
  return (
    db
      .select({ value: sql<number>`coalesce(max(${fundingBudgetItems.sortOrder}), 0)` })
      .from(fundingBudgetItems)
      .where(eq(fundingBudgetItems.projectId, projectId))
      .get()?.value ?? 0
  ) + 1000;
}

function nextFinancingOrder(projectId: string) {
  return (
    db
      .select({ value: sql<number>`coalesce(max(${fundingFinancingSources.sortOrder}), 0)` })
      .from(fundingFinancingSources)
      .where(eq(fundingFinancingSources.projectId, projectId))
      .get()?.value ?? 0
  ) + 1000;
}

function nextDisbursementOrder(projectId: string) {
  return (
    db
      .select({ value: sql<number>`coalesce(max(${fundingDisbursements.sortOrder}), 0)` })
      .from(fundingDisbursements)
      .where(eq(fundingDisbursements.projectId, projectId))
      .get()?.value ?? 0
  ) + 1000;
}

export async function upsertFundingBudgetItem(input: FundingBudgetItemInput) {
  await requireUserOrThrow();
  const data = fundingBudgetItemInputSchema.parse(input);
  const totalCents = calculateBudgetItemTotal(
    data.quantityThousandths,
    data.unitPriceCents,
  );
  if (data.eligibleAmountCents > totalCents) {
    throw new Error("Eligible amount exceeds total amount");
  }
  const values = {
    costType: data.costType,
    customCostType: data.customCostType,
    description: data.description,
    workPackage: data.workPackage,
    supplierOrPerson: data.supplierOrPerson,
    quantityThousandths: data.quantityThousandths,
    unitLabel: data.unitLabel,
    unitPriceCents: data.unitPriceCents,
    plannedMonth: data.plannedMonth,
    totalCents,
    eligibleAmountCents: data.eligibleAmountCents,
    necessityJustification: data.necessityJustification,
    updatedAt: new Date(),
  };
  if (data.id) {
    const existing = db
      .select({ projectId: fundingBudgetItems.projectId })
      .from(fundingBudgetItems)
      .where(eq(fundingBudgetItems.id, data.id))
      .get();
    if (!existing || existing.projectId !== data.projectId) throw new Error("Budget item not found");
    db.update(fundingBudgetItems).set(values).where(eq(fundingBudgetItems.id, data.id)).run();
  } else {
    db.insert(fundingBudgetItems)
      .values({
        ...values,
        projectId: data.projectId,
        sortOrder: nextBudgetOrder(data.projectId),
      })
      .run();
  }
  revalidateFunding(data.projectId);
}

export async function deleteFundingBudgetItem(id: string) {
  await requireUserOrThrow();
  const existing = db
    .select({ projectId: fundingBudgetItems.projectId })
    .from(fundingBudgetItems)
    .where(eq(fundingBudgetItems.id, id))
    .get();
  if (!existing) return;
  db.delete(fundingBudgetItems).where(eq(fundingBudgetItems.id, id)).run();
  revalidateFunding(existing.projectId);
}

const financingSourceSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  sourceType: z.enum([
    "requested_grant",
    "own_funds",
    "own_services",
    "bank",
    "shareholder",
    "other_public",
    "private_investor",
  ]),
  label: z.string().max(200).default(""),
  amountCents: cents,
});
export type FundingFinancingSourceInput = z.infer<typeof financingSourceSchema>;

export async function upsertFundingFinancingSource(input: FundingFinancingSourceInput) {
  await requireUserOrThrow();
  const data = financingSourceSchema.parse(input);
  if (data.id) {
    const existing = db
      .select({ projectId: fundingFinancingSources.projectId })
      .from(fundingFinancingSources)
      .where(eq(fundingFinancingSources.id, data.id))
      .get();
    if (!existing || existing.projectId !== data.projectId) throw new Error("Financing source not found");
    db.update(fundingFinancingSources)
      .set({ sourceType: data.sourceType, label: data.label, amountCents: data.amountCents, updatedAt: new Date() })
      .where(eq(fundingFinancingSources.id, data.id))
      .run();
  } else {
    db.insert(fundingFinancingSources)
      .values({ ...data, sortOrder: nextFinancingOrder(data.projectId) })
      .run();
  }
  revalidateFunding(data.projectId);
}

export async function deleteFundingFinancingSource(id: string) {
  await requireUserOrThrow();
  const existing = db
    .select({ projectId: fundingFinancingSources.projectId })
    .from(fundingFinancingSources)
    .where(eq(fundingFinancingSources.id, id))
    .get();
  if (!existing) return;
  db.delete(fundingFinancingSources).where(eq(fundingFinancingSources.id, id)).run();
  revalidateFunding(existing.projectId);
}

const disbursementSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  label: z.string().min(1).max(200),
  plannedDate: nullableDate,
  amountCents: cents,
  status: z.enum(["planned", "received"]),
  receivedAt: nullableDate,
});
export type FundingDisbursementInput = z.infer<typeof disbursementSchema>;

export async function upsertFundingDisbursement(input: FundingDisbursementInput) {
  await requireUserOrThrow();
  const data = disbursementSchema.parse(input);
  if (data.id) {
    const existing = db
      .select({ projectId: fundingDisbursements.projectId })
      .from(fundingDisbursements)
      .where(eq(fundingDisbursements.id, data.id))
      .get();
    if (!existing || existing.projectId !== data.projectId) throw new Error("Disbursement not found");
    db.update(fundingDisbursements).set(data).where(eq(fundingDisbursements.id, data.id)).run();
  } else {
    db.insert(fundingDisbursements)
      .values({ ...data, sortOrder: nextDisbursementOrder(data.projectId) })
      .run();
  }
  revalidateFunding(data.projectId);
}

export async function deleteFundingDisbursement(id: string) {
  await requireUserOrThrow();
  const existing = db
    .select({ projectId: fundingDisbursements.projectId })
    .from(fundingDisbursements)
    .where(eq(fundingDisbursements.id, id))
    .get();
  if (!existing) return;
  db.delete(fundingDisbursements).where(eq(fundingDisbursements.id, id)).run();
  revalidateFunding(existing.projectId);
}

const bookingAllocationSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  budgetItemId: z.string().min(1),
  accountingEntryId: z.string().nullable(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(300).default(""),
  actualAmountCents: cents,
  evidenceStatus: z.enum(["missing", "partial", "complete"]),
  evidenceNote: z.string().max(1000).default(""),
});
export type FundingBookingAllocationInput = z.infer<typeof bookingAllocationSchema>;

export async function upsertFundingBookingAllocation(input: FundingBookingAllocationInput) {
  await requireUserOrThrow();
  const data = bookingAllocationSchema.parse(input);
  const budgetItem = db
    .select({ projectId: fundingBudgetItems.projectId })
    .from(fundingBudgetItems)
    .where(eq(fundingBudgetItems.id, data.budgetItemId))
    .get();
  if (!budgetItem || budgetItem.projectId !== data.projectId) throw new Error("Budget item not found");
  if (data.id) {
    const existing = db
      .select({ projectId: fundingBookingAllocations.projectId })
      .from(fundingBookingAllocations)
      .where(eq(fundingBookingAllocations.id, data.id))
      .get();
    if (!existing || existing.projectId !== data.projectId) throw new Error("Allocation not found");
    db.update(fundingBookingAllocations).set(data).where(eq(fundingBookingAllocations.id, data.id)).run();
  } else {
    db.insert(fundingBookingAllocations).values(data).run();
  }
  revalidateFunding(data.projectId);
}

export async function deleteFundingBookingAllocation(id: string) {
  await requireUserOrThrow();
  const existing = db
    .select({ projectId: fundingBookingAllocations.projectId })
    .from(fundingBookingAllocations)
    .where(eq(fundingBookingAllocations.id, id))
    .get();
  if (!existing) return;
  db.delete(fundingBookingAllocations).where(eq(fundingBookingAllocations.id, id)).run();
  revalidateFunding(existing.projectId);
}

const evidenceItemSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  budgetItemId: z.string().nullable(),
  bookingAllocationId: z.string().nullable(),
  name: z.string().min(1).max(250),
  status: z.enum(["missing", "partial", "complete"]),
  dueDate: nullableDate,
  notes: z.string().max(1000).default(""),
});

export async function upsertFundingEvidenceItem(input: z.infer<typeof evidenceItemSchema>) {
  await requireUserOrThrow();
  const data = evidenceItemSchema.parse(input);
  if (data.id) {
    const existing = db
      .select({ projectId: fundingEvidenceItems.projectId })
      .from(fundingEvidenceItems)
      .where(eq(fundingEvidenceItems.id, data.id))
      .get();
    if (!existing || existing.projectId !== data.projectId) throw new Error("Evidence item not found");
    db.update(fundingEvidenceItems).set(data).where(eq(fundingEvidenceItems.id, data.id)).run();
  } else {
    db.insert(fundingEvidenceItems).values(data).run();
  }
  revalidateFunding(data.projectId);
}

export async function deleteFundingEvidenceItem(id: string) {
  await requireUserOrThrow();
  const existing = db
    .select({ projectId: fundingEvidenceItems.projectId })
    .from(fundingEvidenceItems)
    .where(eq(fundingEvidenceItems.id, id))
    .get();
  if (!existing) return;
  db.delete(fundingEvidenceItems).where(eq(fundingEvidenceItems.id, id)).run();
  revalidateFunding(existing.projectId);
}
