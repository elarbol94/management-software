"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  assets,
  appSettings,
  budgetPlans,
  businessLocations,
  categories,
  entries,
  entryAuditLog,
  entryPaymentLines,
  entryTaxLines,
  employees,
  employmentTypes,
  payrollMonthContexts,
} from "@/db/schema";
import { requireAdmin, requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor } from "@/lib/files";
import { breakdownFromGross, isVatRate } from "./lib/vat";
import { categoryUsageCount } from "./queries";
import { syncFundingIncomeLink } from "@/modules/funding/accounting-integration";
import {
  calculateFromSpecialFields,
  normalizeEmploymentType,
  payrollPaymentLines,
  payrollResultToSpecialFields,
  storedAmountCents,
  validatePayrollMode,
  type SpecialFields,
} from "./lib/payroll-special-fields";
import { allocatePayrollLevyBases } from "./lib/payroll-at-2026";

const specialValueSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
]);

const taxLineSchema = z.object({
  description: z.string().max(200).default(""),
  netAmountCents: z.number().int().min(0),
  vatRate: z.number().int(),
  vatAmountCents: z.number().int().min(0),
  grossAmountCents: z.number().int().min(0),
  inputVatDeductiblePercent: z.number().int().min(0).max(100).default(100),
});

const paymentLineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(200),
  recipient: z.string().max(200),
  amountCents: z.number().int().positive(),
  paymentMethod: z.enum(["bank", "cash", "card"]),
});

const entrySchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["income", "expense"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  documentNumber: z.string().max(100).default(""),
  servicePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  servicePeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  status: z.enum(["draft", "finalized"]).default("finalized"),
  description: z.string().max(500),
  counterparty: z.string().max(200).default(""),
  categoryId: z.string().min(1),
  grossAmountCents: z.number().int().min(0),
  vatRate: z.number().int(),
  paymentMethod: z.enum(["bank", "cash", "card"]),
  notes: z.string().max(2000).default(""),
  deductiblePercent: z.number().int().min(0).max(100).default(100),
  warningOverrideReason: z.string().max(1000).default(""),
  specialFields: z.record(z.string(), specialValueSchema).default({}),
  taxLines: z.array(taxLineSchema).max(50).optional(),
  paymentLines: z.array(paymentLineSchema).max(50).optional(),
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
  const settings = db.select().from(appSettings).where(eq(appSettings.id, "default")).get();

  if (category.template === "personnel" && user.role !== "admin" && user.role !== "personnel") {
    throw new Error("Forbidden: personnel data");
  }
  const existingTarget = data.id
    ? db
        .select({ id: entries.id, categoryTemplate: categories.template })
        .from(entries)
        .innerJoin(categories, eq(entries.categoryId, categories.id))
        .where(eq(entries.id, data.id))
        .get()
    : null;
  if (data.id && !existingTarget) throw new Error("Entry not found");
  if (
    existingTarget?.categoryTemplate === "personnel" &&
    user.role !== "admin" &&
    user.role !== "personnel"
  ) {
    throw new Error("Forbidden: personnel data");
  }

  let effectiveSpecialFields: SpecialFields = { ...data.specialFields };
  let payrollContextUpdate: {
    payrollMonth: string;
    internalPayrollCents: number;
    externalPayrollCents: number;
    externalMarginalPayrollCents: number;
    marginalPayrollCents: number;
  } | null = null;

  if (category.template === "personnel") {
    const employeeId = typeof effectiveSpecialFields.employeeId === "string" ? effectiveSpecialFields.employeeId : "";
    const employee = employeeId ? db.select().from(employees).where(eq(employees.id, employeeId)).get() : null;
    if (employeeId && !employee) throw new Error("Employee not found");
    if (employee) {
      effectiveSpecialFields = {
        ...effectiveSpecialFields,
        employeeName: employee.name,
        personnelNumber: employee.personnelNumber,
        employmentType: normalizeEmploymentType(employee.employmentType) ?? "employee",
        locationId: employee.locationId,
      };
    }

    const calculationMode = validatePayrollMode(effectiveSpecialFields);
    effectiveSpecialFields.calculationMode = calculationMode;
    if (calculationMode === "manual") {
      const overrideReason = String(effectiveSpecialFields.overrideReason ?? "").trim();
      effectiveSpecialFields.overrideReason = overrideReason;
    } else {
      const payrollMonth = String(effectiveSpecialFields.payrollMonth ?? "");
      const employmentType = normalizeEmploymentType(effectiveSpecialFields.employmentType);
      if (!employmentType) throw new Error("Invalid employment type");
      effectiveSpecialFields.employmentType = employmentType;

      const defaultLocation = db.select().from(businessLocations).where(eq(businessLocations.name, "Graz / Steiermark")).get()
        ?? db.select().from(businessLocations).where(eq(businessLocations.active, true)).get();
      const locationId = String(effectiveSpecialFields.locationId ?? employee?.locationId ?? defaultLocation?.id ?? "");
      const location = locationId ? db.select().from(businessLocations).where(eq(businessLocations.id, locationId)).get() : null;
      if (!location || !location.active) throw new Error("An active business location is required");
      effectiveSpecialFields.locationId = location.id;
      effectiveSpecialFields.municipality = location.municipality;

      const previousContext = db.select().from(payrollMonthContexts).where(eq(payrollMonthContexts.payrollMonth, payrollMonth)).get();
      const externalPayrollCents = effectiveSpecialFields.externalPayroll === null || effectiveSpecialFields.externalPayroll === undefined
        ? (previousContext?.externalPayrollCents ?? 0)
        : storedAmountCents(effectiveSpecialFields.externalPayroll);
      const externalMarginalPayrollCents = effectiveSpecialFields.externalMarginalPayroll === null || effectiveSpecialFields.externalMarginalPayroll === undefined
        ? (previousContext?.externalMarginalPayrollCents ?? 0)
        : storedAmountCents(effectiveSpecialFields.externalMarginalPayroll);
      if (externalPayrollCents < 0 || externalMarginalPayrollCents < 0) throw new Error("Payroll context cannot be negative");
      effectiveSpecialFields.externalPayroll = (externalPayrollCents / 100).toFixed(2);
      effectiveSpecialFields.externalMarginalPayroll = (externalMarginalPayrollCents / 100).toFixed(2);

      const otherRows = db
        .select({ id: entries.id, status: entries.status, specialFields: entries.specialFields })
        .from(entries)
        .innerJoin(categories, eq(entries.categoryId, categories.id))
        .where(eq(categories.template, "personnel"))
        .all()
        .filter((row) => row.id !== data.id && row.status === "finalized")
        .filter((row) => row.specialFields.calculationMode === "auto" && row.specialFields.payrollMonth === payrollMonth);
      const otherInternalPayrollCents = otherRows.reduce((sum, row) => sum + storedAmountCents(row.specialFields.grossSalary), 0);
      const otherMarginalPayrollCents = otherRows
        .filter((row) => normalizeEmploymentType(row.specialFields.employmentType) === "marginal")
        .reduce((sum, row) => sum + storedAmountCents(row.specialFields.grossSalary), 0);
      const currentGrossCents = storedAmountCents(effectiveSpecialFields.grossSalary);
      const currentBookedGrossCents = data.status === "finalized" ? currentGrossCents : 0;
      const internalPayrollCents = otherInternalPayrollCents + currentBookedGrossCents;
      const marginalPayrollCents = otherMarginalPayrollCents
        + (data.status === "finalized" && employmentType === "marginal" ? currentGrossCents : 0)
        + externalMarginalPayrollCents;
      const result = calculateFromSpecialFields(effectiveSpecialFields, {
        employmentType,
        location: { state: location.state, municipality: location.municipality },
        monthlyPayrollTotalCents: internalPayrollCents + externalPayrollCents,
        monthlyMarginalPayrollTotalCents: marginalPayrollCents,
      });
      effectiveSpecialFields = payrollResultToSpecialFields(effectiveSpecialFields, result);
      payrollContextUpdate = { payrollMonth, internalPayrollCents, externalPayrollCents, externalMarginalPayrollCents, marginalPayrollCents };
    }
  }

  const fallbackBreakdown = breakdownFromGross(data.grossAmountCents, data.vatRate);
  let lines =
    data.taxLines && data.taxLines.length > 0
      ? data.taxLines
      : [
          {
            description: "",
            netAmountCents: fallbackBreakdown.netCents,
            vatRate: data.vatRate,
            vatAmountCents: fallbackBreakdown.vatCents,
            grossAmountCents: fallbackBreakdown.grossCents,
            inputVatDeductiblePercent: 100,
          },
        ];
  if (category.template === "personnel" && effectiveSpecialFields.calculationMode === "auto") {
    const totalCents = storedAmountCents(effectiveSpecialFields.employerTotal);
    lines = [{
      description: "Gesamte Arbeitgeberkosten",
      netAmountCents: totalCents,
      vatRate: 0,
      vatAmountCents: 0,
      grossAmountCents: totalCents,
      inputVatDeductiblePercent: 0,
    }];
  }

  for (const line of lines) {
    if (!isVatRate(line.vatRate)) throw new Error("Invalid VAT rate");
    if (line.netAmountCents + line.vatAmountCents !== line.grossAmountCents) {
      throw new Error("Tax line total does not match");
    }
    if (settings?.kleinunternehmer && data.kind === "income" && line.vatRate !== 0) {
      throw new Error("Small-business income must not contain VAT");
    }
    if (settings?.kleinunternehmer && data.kind === "expense" && line.inputVatDeductiblePercent !== 0) {
      throw new Error("Small businesses cannot deduct input VAT");
    }
  }

  const totals = lines.reduce(
    (sum, line) => ({
      gross: sum.gross + line.grossAmountCents,
      net: sum.net + line.netAmountCents,
      vat: sum.vat + line.vatAmountCents,
    }),
    { gross: 0, net: 0, vat: 0 },
  );
  let paymentLines = data.paymentLines?.length
    ? data.paymentLines
    : totals.gross > 0
      ? [{
          date: data.date,
          description: data.description,
          recipient: data.counterparty,
          amountCents: totals.gross,
          paymentMethod: data.paymentMethod,
        }]
      : [];
  if (category.template === "personnel" && effectiveSpecialFields.calculationMode === "auto") {
    paymentLines = payrollPaymentLines(effectiveSpecialFields, data.date, data.paymentMethod, {
      net: "Nettoentgelt",
      social: "Sozialversicherung",
      taxOffice: "Lohnabgaben",
      municipality: "Gemeindeabgaben",
      provision: "Betriebliche Vorsorge",
      other: "Weitere Personalkosten",
    });
  }
  const paymentTotal = paymentLines.reduce((sum, line) => sum + line.amountCents, 0);
  if (data.status === "finalized" && totals.gross <= 0) {
    throw new Error("Finalized entries require a positive amount");
  }
  if (data.status === "finalized" && !data.description.trim()) {
    throw new Error("Finalized entries require a description");
  }
  if (data.status === "finalized" && paymentTotal !== totals.gross && !data.warningOverrideReason.trim()) {
    throw new Error("Payment lines must reconcile with the booking total");
  }
  if (
    data.servicePeriodStart &&
    data.servicePeriodEnd &&
    data.servicePeriodStart > data.servicePeriodEnd
  ) {
    throw new Error("Invalid service period");
  }

  const values = {
    kind: data.kind,
    date: data.date,
    documentDate: data.documentDate,
    documentNumber: data.documentNumber,
    servicePeriodStart: data.servicePeriodStart,
    servicePeriodEnd: data.servicePeriodEnd,
    status: data.status,
    description: data.description,
    counterparty: data.counterparty,
    categoryId: data.categoryId,
    grossAmountCents: totals.gross,
    vatRate: lines.length === 1 ? lines[0].vatRate : 0,
    vatAmountCents: totals.vat,
    netAmountCents: totals.net,
    paymentMethod: data.paymentMethod,
    notes: data.notes,
    deductiblePercent: data.deductiblePercent,
    warningOverrideReason: data.warningOverrideReason,
    specialFields: effectiveSpecialFields,
    updatedAt: new Date(),
  };

  let id = data.id;
  db.transaction((tx) => {
    if (payrollContextUpdate) {
      tx.insert(payrollMonthContexts)
        .values({ ...payrollContextUpdate, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: payrollMonthContexts.payrollMonth,
          set: { ...payrollContextUpdate, updatedAt: new Date() },
        })
        .run();
    }
    if (category.template === "personnel") {
      const employeeId = typeof values.specialFields.employeeId === "string"
        ? values.specialFields.employeeId
        : "";
      if (employeeId) {
        const employee = tx.select().from(employees).where(eq(employees.id, employeeId)).get();
        if (!employee) throw new Error("Employee not found");
      } else {
        const employeeName = String(values.specialFields.employeeName ?? "").trim();
        const employmentType = String(values.specialFields.employmentType ?? "employee") as (typeof employmentTypes)[number];
        if (!employmentTypes.includes(employmentType)) throw new Error("Invalid employment type");
        if (data.status === "finalized" && !employeeName) throw new Error("Employee is required");
        if (employeeName) {
          const employee = tx.insert(employees).values({
            name: employeeName,
            personnelNumber: String(values.specialFields.personnelNumber ?? ""),
            employmentType,
            locationId: typeof values.specialFields.locationId === "string" ? values.specialFields.locationId : null,
          }).returning({ id: employees.id }).get();
          values.specialFields.employeeId = employee.id;
        }
      }
    }
    let action = "created";
    if (id) {
      const existing = tx.select().from(entries).where(eq(entries.id, id)).get();
      if (!existing) throw new Error("Entry not found");
      if (existing.status === "voided") throw new Error("Voided entries cannot be edited");
      const existingTaxLines = tx.select().from(entryTaxLines).where(eq(entryTaxLines.entryId, id)).all();
      const existingPaymentLines = tx.select().from(entryPaymentLines).where(eq(entryPaymentLines.entryId, id)).all();
      tx.insert(entryAuditLog).values({
        entryId: id,
        action: "updated",
        snapshot: { entry: existing, taxLines: existingTaxLines, paymentLines: existingPaymentLines },
        reason: data.warningOverrideReason,
        changedBy: user.id,
      }).run();
      tx.update(entries).set(values).where(eq(entries.id, id)).run();
      tx.delete(entryTaxLines).where(eq(entryTaxLines.entryId, id)).run();
      tx.delete(entryPaymentLines).where(eq(entryPaymentLines.entryId, id)).run();
      action = "updated";
    } else {
      const row = tx
        .insert(entries)
        .values({ ...values, createdBy: user.id })
        .returning({ id: entries.id })
        .get();
      id = row.id;
    }

    tx.insert(entryTaxLines)
      .values(
        lines.map((line, index) => ({
          entryId: id!,
          description: line.description,
          netAmountCents: line.netAmountCents,
          vatRate: line.vatRate,
          vatAmountCents: line.vatAmountCents,
          grossAmountCents: line.grossAmountCents,
          inputVatDeductiblePercent: line.inputVatDeductiblePercent,
          sortOrder: index * 10,
        })),
      )
      .run();
    if (paymentLines.length) {
      tx.insert(entryPaymentLines).values(paymentLines.map((line, index) => ({
        entryId: id!,
        date: line.date,
        description: line.description,
        recipient: line.recipient,
        amountCents: line.amountCents,
        paymentMethod: line.paymentMethod,
        sortOrder: index * 10,
      }))).run();
    }

    tx.delete(assets).where(eq(assets.entryId, id!)).run();
    if (category.template === "asset" && data.status === "finalized") {
      const name = String(data.specialFields.assetName ?? data.description);
      const placedInServiceOn = String(data.specialFields.placedInServiceOn ?? data.date);
      const usefulLifeYears = Number(data.specialFields.usefulLifeYears ?? 1);
      if (!Number.isInteger(usefulLifeYears) || usefulLifeYears < 1 || usefulLifeYears > 100) {
        throw new Error("Invalid useful life");
      }
      tx.insert(assets)
        .values({
          entryId: id!,
          name,
          placedInServiceOn,
          acquisitionCostCents: totals.net,
          usefulLifeYears,
        })
        .onConflictDoUpdate({
          target: assets.entryId,
          set: { name, placedInServiceOn, acquisitionCostCents: totals.net, usefulLifeYears },
        })
        .run();
    }

    syncFundingIncomeLink(
      tx,
      id!,
      category.template === "grant_income" && typeof data.specialFields.fundingProjectId === "string"
        ? data.specialFields.fundingProjectId
        : null,
    );

    if (action === "created") {
      tx.insert(entryAuditLog).values({
        entryId: id!,
        action,
        snapshot: { ...values, taxLines: lines },
        reason: data.warningOverrideReason,
        changedBy: user.id,
      }).run();
    }

    if (payrollContextUpdate) {
      const context = tx.select().from(payrollMonthContexts)
        .where(eq(payrollMonthContexts.payrollMonth, payrollContextUpdate.payrollMonth)).get();
      const automaticRows = tx
        .select({ entry: entries })
        .from(entries)
        .innerJoin(categories, eq(entries.categoryId, categories.id))
        .where(and(eq(categories.template, "personnel"), eq(entries.status, "finalized")))
        .all()
        .map((row) => row.entry)
        .filter((row) => row.specialFields.calculationMode === "auto" && row.specialFields.payrollMonth === payrollContextUpdate.payrollMonth)
        .sort((a, b) => a.id.localeCompare(b.id));
      const internalPayrollCents = automaticRows.reduce((sum, row) => sum + storedAmountCents(row.specialFields.grossSalary), 0);
      const internalMarginalPayrollCents = automaticRows
        .filter((row) => normalizeEmploymentType(row.specialFields.employmentType) === "marginal")
        .reduce((sum, row) => sum + storedAmountCents(row.specialFields.grossSalary), 0);
      const externalMarginalPayrollCents = context?.externalMarginalPayrollCents ?? storedAmountCents(effectiveSpecialFields.externalMarginalPayroll);
      const marginalPayrollCents = internalMarginalPayrollCents + externalMarginalPayrollCents;
      const combinedPayrollCents = internalPayrollCents + (context?.externalPayrollCents ?? 0);
      const levyBases = allocatePayrollLevyBases(
        automaticRows.map((row) => ({ id: row.id, grossCents: storedAmountCents(row.specialFields.grossSalary) })),
        combinedPayrollCents,
      );

      tx.insert(payrollMonthContexts)
        .values({
          payrollMonth: payrollContextUpdate.payrollMonth,
          internalPayrollCents,
          externalPayrollCents: context?.externalPayrollCents ?? 0,
          externalMarginalPayrollCents,
          marginalPayrollCents,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: payrollMonthContexts.payrollMonth,
          set: { internalPayrollCents, externalMarginalPayrollCents, marginalPayrollCents, updatedAt: new Date() },
        })
        .run();

      for (const row of automaticRows) {
        const locationId = String(row.specialFields.locationId ?? "");
        const location = tx.select().from(businessLocations).where(eq(businessLocations.id, locationId)).get();
        if (!location) throw new Error("Payroll location not found during monthly recalculation");
        const result = calculateFromSpecialFields(row.specialFields, {
          location: { state: location.state, municipality: location.municipality },
          monthlyPayrollTotalCents: combinedPayrollCents,
          monthlyMarginalPayrollTotalCents: marginalPayrollCents,
          levyBasisCents: levyBases.get(row.id) ?? 0,
        });
        const recalculatedFields = payrollResultToSpecialFields({
          ...row.specialFields,
          externalPayroll: ((context?.externalPayrollCents ?? 0) / 100).toFixed(2),
          externalMarginalPayroll: (externalMarginalPayrollCents / 100).toFixed(2),
        }, result);
        const totalCents = result.employerTotalCents;
        const recalculatedPayments = payrollPaymentLines(recalculatedFields, row.date, row.paymentMethod, {
          net: "Nettoentgelt",
          social: "Sozialversicherung",
          taxOffice: "Lohnabgaben",
          municipality: "Gemeindeabgaben",
          provision: "Betriebliche Vorsorge",
          other: "Weitere Personalkosten",
        });
        if (row.id !== id) {
          tx.insert(entryAuditLog).values({
            entryId: row.id,
            action: "monthly_payroll_recalculation",
            snapshot: { entry: row },
            reason: `Monatskontext ${payrollContextUpdate.payrollMonth} geändert`,
            changedBy: user.id,
          }).run();
        }
        tx.update(entries).set({
          grossAmountCents: totalCents,
          netAmountCents: totalCents,
          vatAmountCents: 0,
          vatRate: 0,
          specialFields: recalculatedFields,
          updatedAt: new Date(),
        }).where(eq(entries.id, row.id)).run();
        tx.delete(entryTaxLines).where(eq(entryTaxLines.entryId, row.id)).run();
        tx.insert(entryTaxLines).values({
          entryId: row.id,
          description: "Gesamte Arbeitgeberkosten",
          netAmountCents: totalCents,
          vatRate: 0,
          vatAmountCents: 0,
          grossAmountCents: totalCents,
          inputVatDeductiblePercent: 0,
          sortOrder: 0,
        }).run();
        tx.delete(entryPaymentLines).where(eq(entryPaymentLines.entryId, row.id)).run();
        if (recalculatedPayments.length) {
          tx.insert(entryPaymentLines).values(recalculatedPayments.map((line, index) => ({
            entryId: row.id,
            ...line,
            sortOrder: index * 10,
          }))).run();
        }
      }
    }
  });

  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
  revalidatePath("/accounting/report");
  revalidatePath("/accounting/planning");
  revalidatePath("/accounting/funding");
  revalidatePath("/documents");
  return { id: id! };
}

export async function deleteEntry(id: string) {
  const user = await requireUserOrThrow();
  const existingRow = db
    .select({ entry: entries, categoryTemplate: categories.template })
    .from(entries)
    .innerJoin(categories, eq(entries.categoryId, categories.id))
    .where(eq(entries.id, id))
    .get();
  if (!existingRow) return;
  if (
    existingRow.categoryTemplate === "personnel" &&
    user.role !== "admin" &&
    user.role !== "personnel"
  ) {
    throw new Error("Forbidden: personnel data");
  }
  const existing = existingRow.entry;
  if (existing.status === "draft") {
    deleteAttachmentsFor("entry", id);
    db.delete(entries).where(eq(entries.id, id)).run();
  } else {
    db.transaction((tx) => {
      const taxLines = tx.select().from(entryTaxLines).where(eq(entryTaxLines.entryId, id)).all();
      const paymentLines = tx.select().from(entryPaymentLines).where(eq(entryPaymentLines.entryId, id)).all();
      tx.insert(entryAuditLog).values({
        entryId: id,
        action: "voided",
        snapshot: { entry: existing, taxLines, paymentLines },
        reason: "Storno über Buchungsdialog",
        changedBy: user.id,
      }).run();
      tx.update(entries)
        .set({ status: "voided", voidedAt: new Date(), voidedBy: user.id, updatedAt: new Date() })
        .where(eq(entries.id, id))
        .run();
    });
  }
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
  template: z.enum([
    "standard_income",
    "grant_income",
    "standard_expense",
    "hospitality",
    "travel",
    "vehicle",
    "asset",
    "personnel",
    "svs",
    "tax_levy",
  ]).optional(),
});

export type CategoryInput = z.infer<typeof categorySchema>;

export async function upsertCategory(input: CategoryInput) {
  await requireAdmin();
  const data = categorySchema.parse(input);

  if (data.id) {
    db.update(categories)
      .set({
        name: data.name,
        color: data.color,
        ...(data.template ? { template: data.template } : {}),
      })
      .where(eq(categories.id, data.id))
      .run();
  } else {
    db.insert(categories)
      .values({
        name: data.name,
        kind: data.kind,
        color: data.color,
        template:
          data.template ??
          (data.kind === "income" ? "standard_income" : "standard_expense"),
      })
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
