"use server";

import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  businessLocations,
  categories,
  employees,
  employmentContractPeriods,
  entries,
  entryAuditLog,
  entryPaymentLines,
  entryTaxLines,
  fundingCostProfiles,
  fundingProjects,
  personnelFundingProjectLinks,
  personnelMonthSnapshots,
  personnelPostings,
  personnelScenarios,
  personnelTaxProfiles,
  projectHourAllocations,
  projects,
  user,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { payrollEmploymentTypes, type PayrollEmploymentType } from "@/modules/accounting/lib/payroll-at-2026";
import {
  calculatePayroll,
  calculatePayrollLevyBasis,
  solveGrossForNet,
  type PayrollInput,
} from "./lib/engine";
import { getPayrollRuleSet } from "./lib/rules";

function refreshPersonnel() {
  revalidatePath("/personnel");
  revalidatePath("/accounting");
  revalidatePath("/accounting/bookings");
}

async function requirePersonnelManager() {
  const current = await requireUserOrThrow();
  if (current.role !== "admin" && current.role !== "personnel") throw new Error("Forbidden: personnel only");
  return current;
}

const cents = z.number().int().min(0).max(1_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const employeePlanSchema = z.object({
  employeeId: z.string().optional(),
  name: z.string().trim().min(1).max(200),
  personnelNumber: z.string().trim().max(100).default(""),
  userId: z.string().nullable().default(null),
  birthDate: isoDate.nullable().default(null),
  collectiveAgreement: z.string().trim().max(200).default(""),
  locationId: z.string().min(1),
  joinedOn: isoDate.nullable().default(null),
  leftOn: isoDate.nullable().default(null),
  validFrom: isoDate,
  employmentType: z.enum(payrollEmploymentTypes),
  inputMode: z.enum(["gross", "net"]),
  monthlyAmountCents: cents,
  weeklyMinutes: z.number().int().min(60).max(7 * 24 * 60),
  workdaysPerWeek: z.number().int().min(1).max(5).default(5),
  specialPaymentsEnabled: z.boolean().default(true),
  holidayPayMonth: z.number().int().min(1).max(12).default(6),
  christmasPayMonth: z.number().int().min(1).max(12).default(11),
  vacationWeeksHundredths: z.number().int().min(0).max(1_000).default(500),
  expectedSickHoursHundredths: z.number().int().min(0).default(0),
  trainingHoursHundredths: z.number().int().min(0).default(0),
  internalHoursHundredths: z.number().int().min(0).default(0),
  overheadRateBasisPoints: z.number().int().min(0).max(100_000).default(0),
  salesMarkupBasisPoints: z.number().int().min(0).max(100_000).default(0),
  taxableBenefitsCents: cents.default(0),
  commuterAllowanceCents: cents.default(0),
  commuterEuroCents: cents.default(0),
  familyBonusCents: cents.default(0),
  soleEarnerCreditCents: cents.default(0),
  singleParentCreditCents: cents.default(0),
});

export type EmployeePlanInput = z.infer<typeof employeePlanSchema>;

export async function upsertEmployeePlan(input: EmployeePlanInput) {
  const current = await requirePersonnelManager();
  const data = employeePlanSchema.parse(input);
  const location = db.select().from(businessLocations).where(and(eq(businessLocations.id, data.locationId), eq(businessLocations.active, true))).get();
  if (!location) throw new Error("Active location required");
  if (data.userId && !db.select({ id: user.id }).from(user).where(eq(user.id, data.userId)).get()) throw new Error("User not found");
  if (data.joinedOn && data.leftOn && data.joinedOn > data.leftOn) throw new Error("Invalid employment period");
  let employeeId = data.employeeId;
  db.transaction((tx) => {
    const values = {
      name: data.name,
      personnelNumber: data.personnelNumber,
      userId: data.userId,
      birthDate: data.birthDate,
      collectiveAgreement: data.collectiveAgreement,
      employmentType: data.employmentType,
      locationId: data.locationId,
      joinedOn: data.joinedOn,
      leftOn: data.leftOn,
      active: true,
    };
    if (employeeId) {
      if (!tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).get()) throw new Error("Employee not found");
      tx.update(employees).set(values).where(eq(employees.id, employeeId)).run();
    } else {
      employeeId = tx.insert(employees).values(values).returning({ id: employees.id }).get().id;
    }
    const previous = tx.select().from(employmentContractPeriods)
      .where(eq(employmentContractPeriods.employeeId, employeeId!))
      .orderBy(desc(employmentContractPeriods.validFrom)).get();
    if (previous && !previous.validTo && previous.validFrom < data.validFrom) {
      const dayBefore = new Date(`${data.validFrom}T00:00:00Z`);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      tx.update(employmentContractPeriods).set({ validTo: dayBefore.toISOString().slice(0, 10), updatedAt: new Date() })
        .where(eq(employmentContractPeriods.id, previous.id)).run();
    }
    const contractValues = {
      employeeId: employeeId!,
      validFrom: data.validFrom,
      employmentType: data.employmentType,
      inputMode: data.inputMode,
      monthlyAmountCents: data.monthlyAmountCents,
      weeklyMinutes: data.weeklyMinutes,
      workdaysPerWeek: data.workdaysPerWeek,
      specialPaymentsEnabled: data.specialPaymentsEnabled,
      holidayPayMonth: data.holidayPayMonth,
      christmasPayMonth: data.christmasPayMonth,
      vacationWeeksHundredths: data.vacationWeeksHundredths,
      expectedSickHoursHundredths: data.expectedSickHoursHundredths,
      trainingHoursHundredths: data.trainingHoursHundredths,
      internalHoursHundredths: data.internalHoursHundredths,
      overheadRateBasisPoints: data.overheadRateBasisPoints,
      salesMarkupBasisPoints: data.salesMarkupBasisPoints,
      collectiveAgreement: data.collectiveAgreement,
      createdBy: current.id,
      updatedAt: new Date(),
    };
    if (previous?.validFrom === data.validFrom) {
      tx.update(employmentContractPeriods).set(contractValues).where(eq(employmentContractPeriods.id, previous.id)).run();
    } else {
      tx.insert(employmentContractPeriods).values(contractValues).run();
    }
    const previousTax = tx.select().from(personnelTaxProfiles)
      .where(eq(personnelTaxProfiles.employeeId, employeeId!))
      .orderBy(desc(personnelTaxProfiles.validFrom)).get();
    const taxValues = {
      employeeId: employeeId!,
      validFrom: data.validFrom,
      taxableBenefitsCents: data.taxableBenefitsCents,
      commuterAllowanceCents: data.commuterAllowanceCents,
      commuterEuroCents: data.commuterEuroCents,
      familyBonusCents: data.familyBonusCents,
      soleEarnerCreditCents: data.soleEarnerCreditCents,
      singleParentCreditCents: data.singleParentCreditCents,
      updatedAt: new Date(),
    };
    if (previousTax?.validFrom === data.validFrom) {
      tx.update(personnelTaxProfiles).set(taxValues).where(eq(personnelTaxProfiles.id, previousTax.id)).run();
    } else {
      tx.insert(personnelTaxProfiles).values(taxValues).run();
    }
  });
  refreshPersonnel();
  return { employeeId };
}

const scenarioSchema = z.object({
  employeeId: z.string().nullable().default(null),
  name: z.string().trim().min(1).max(200),
  planningYear: z.number().int().min(2025).max(2027),
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  ruleVersion: z.string().min(1),
});

const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function savePersonnelScenario(input: z.input<typeof scenarioSchema>) {
  const current = await requirePersonnelManager();
  const data = scenarioSchema.parse(input);
  const payload = { input: data.input, result: data.result, ruleVersion: data.ruleVersion };
  const row = db.insert(personnelScenarios).values({
    employeeId: data.employeeId,
    name: data.name,
    planningYear: data.planningYear,
    inputJson: data.input,
    resultJson: data.result,
    ruleVersion: data.ruleVersion,
    checksum: checksum(payload),
    createdBy: current.id,
  }).returning().get();
  refreshPersonnel();
  return row;
}

export async function activatePersonnelScenario(id: string) {
  const current = await requirePersonnelManager();
  const scenario = db.select().from(personnelScenarios).where(eq(personnelScenarios.id, id)).get();
  if (!scenario || !scenario.employeeId) throw new Error("Scenario cannot be activated");
  const employee = db.select().from(employees).where(eq(employees.id, scenario.employeeId)).get();
  if (!employee) throw new Error("Employee not found");
  const parsed = employeePlanSchema.parse({
    ...scenario.inputJson,
    employeeId: scenario.employeeId,
    name: employee.name,
    personnelNumber: employee.personnelNumber,
    userId: employee.userId,
    birthDate: employee.birthDate,
    collectiveAgreement: employee.collectiveAgreement,
    locationId: employee.locationId,
    joinedOn: employee.joinedOn,
    leftOn: employee.leftOn,
  });
  await upsertEmployeePlan(parsed);
  db.update(personnelScenarios).set({ status: "active", kind: "baseline" }).where(eq(personnelScenarios.id, id)).run();
  refreshPersonnel();
  return { id, activatedBy: current.id };
}

const allocationSchema = z.object({
  employeeId: z.string().min(1),
  projectId: z.string().min(1),
  payrollMonth: month,
  plannedMinutes: z.number().int().min(1).max(60 * 24 * 31),
  costRateCents: cents,
});

export async function upsertProjectHourAllocation(input: z.input<typeof allocationSchema>) {
  const current = await requireUserOrThrow();
  const data = allocationSchema.parse(input);
  const project = db.select().from(projects).where(eq(projects.id, data.projectId)).get();
  if (!project) throw new Error("Project not found");
  const canManage = current.role === "admin" || current.role === "personnel" || project.managerId === current.id;
  if (!canManage) throw new Error("Forbidden: project planning");
  if (!db.select({ id: employees.id }).from(employees).where(eq(employees.id, data.employeeId)).get()) throw new Error("Employee not found");
  db.insert(projectHourAllocations).values({ ...data, createdBy: current.id })
    .onConflictDoUpdate({
      target: [projectHourAllocations.employeeId, projectHourAllocations.projectId, projectHourAllocations.payrollMonth],
      set: { plannedMinutes: data.plannedMinutes, costRateCents: data.costRateCents, updatedAt: new Date() },
    }).run();
  refreshPersonnel();
}

const fundingProfileSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().min(1).max(100),
  validFrom: isoDate,
  validTo: isoDate.nullable().default(null),
  divisorMode: z.enum(["productive_hours", "fixed"]),
  fixedAnnualDivisor: z.number().int().min(1).nullable().default(null),
  eligibleComponents: z.array(z.string()).default(["gross", "employerSocial", "statutoryLevies"]),
  hourlyCapCents: cents.nullable().default(null),
  maxAnnualHoursHundredths: z.number().int().min(1).nullable().default(null),
  overheadRateBasisPoints: z.number().int().min(0).max(100_000).default(0),
  roundingMode: z.enum(["cent", "euro"]).default("cent"),
});

export type FundingProfileInput = z.infer<typeof fundingProfileSchema>;

export async function upsertFundingCostProfile(input: FundingProfileInput) {
  const current = await requirePersonnelManager();
  const data = fundingProfileSchema.parse(input);
  if (data.divisorMode === "fixed" && !data.fixedAnnualDivisor) throw new Error("Fixed divisor required");
  const stored = {
    name: data.name,
    version: data.version,
    validFrom: data.validFrom,
    validTo: data.validTo,
    divisorMode: data.divisorMode,
    fixedAnnualDivisor: data.fixedAnnualDivisor,
    eligibleComponentsJson: data.eligibleComponents,
    hourlyCapCents: data.hourlyCapCents,
    maxAnnualHoursHundredths: data.maxAnnualHoursHundredths,
    overheadRateBasisPoints: data.overheadRateBasisPoints,
    roundingMode: data.roundingMode,
    createdBy: current.id,
  };
  if (data.id) db.update(fundingCostProfiles).set(stored).where(eq(fundingCostProfiles.id, data.id)).run();
  else db.insert(fundingCostProfiles).values(stored).run();
  refreshPersonnel();
}

export async function linkPersonnelFundingProject(input: { projectId: string; fundingProjectId: string; fundingProfileId?: string | null }) {
  await requirePersonnelManager();
  const data = z.object({ projectId: z.string(), fundingProjectId: z.string(), fundingProfileId: z.string().nullable().optional() }).parse(input);
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, data.projectId)).get()) throw new Error("Project not found");
  if (!db.select({ id: fundingProjects.id }).from(fundingProjects).where(eq(fundingProjects.id, data.fundingProjectId)).get()) throw new Error("Funding project not found");
  db.insert(personnelFundingProjectLinks).values(data).onConflictDoUpdate({
    target: [personnelFundingProjectLinks.projectId, personnelFundingProjectLinks.fundingProjectId],
    set: { fundingProfileId: data.fundingProfileId ?? null },
  }).run();
  refreshPersonnel();
}

function monthEnd(payrollMonth: string) {
  const [year, monthNumber] = payrollMonth.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

export async function closePersonnelMonth(payrollMonthInput: string) {
  const current = await requirePersonnelManager();
  const payrollMonth = month.parse(payrollMonthInput);
  const year = Number(payrollMonth.slice(0, 4));
  const rules = getPayrollRuleSet(year);
  if (rules.status !== "verified") throw new Error("Forecast rule sets cannot create accounting entries");
  const endDate = monthEnd(payrollMonth);
  const people = db.select({
    employee: employees,
    location: businessLocations,
  }).from(employees).innerJoin(businessLocations, eq(employees.locationId, businessLocations.id))
    .where(eq(employees.active, true)).all();
  const contracts = db.select().from(employmentContractPeriods).all()
    .filter((row) => row.validFrom <= endDate && (!row.validTo || row.validTo >= `${payrollMonth}-01`));
  const taxes = db.select().from(personnelTaxProfiles).all()
    .filter((row) => row.validFrom <= endDate && (!row.validTo || row.validTo >= `${payrollMonth}-01`));
  const active = people.map((row) => ({ ...row, contract: contracts.filter((contract) => contract.employeeId === row.employee.id).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] }))
    .filter((row): row is typeof row & { contract: NonNullable<typeof row.contract> } => Boolean(row.contract));
  if (!active.length) throw new Error("No complete personnel plans for this month");
  const grossInputs = active.map((row) => {
    const tax = taxes.filter((profile) => profile.employeeId === row.employee.id).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    const special = row.contract.specialPaymentsEnabled && [row.contract.holidayPayMonth, row.contract.christmasPayMonth].includes(Number(payrollMonth.slice(5, 7)))
      ? row.contract.monthlyAmountCents : 0;
    const base: Omit<PayrollInput, "grossCents"> = {
      year,
      payrollMonth,
      employmentType: row.contract.employmentType as PayrollEmploymentType,
      location: { state: row.location.state, municipality: row.location.municipality },
      specialPaymentCents: special,
      taxableBenefitsCents: tax?.taxableBenefitsCents ?? 0,
      commuterAllowanceCents: tax?.commuterAllowanceCents ?? 0,
      commuterEuroCents: tax?.commuterEuroCents ?? 0,
      familyBonusCents: tax?.familyBonusCents ?? 0,
      soleEarnerCreditCents: tax?.soleEarnerCreditCents ?? 0,
      singleParentCreditCents: tax?.singleParentCreditCents ?? 0,
    };
    const grossCents = row.contract.inputMode === "net"
      ? solveGrossForNet({ ...base, targetNetCents: row.contract.monthlyAmountCents }).grossCents
      : row.contract.monthlyAmountCents;
    return { row, base, grossCents };
  });
  const totalPayroll = grossInputs.reduce((sum, item) => sum + item.grossCents + (item.base.specialPaymentCents ?? 0), 0);
  const marginalTotal = grossInputs.filter((item) => item.base.employmentType === "marginal")
    .reduce((sum, item) => sum + item.grossCents + (item.base.specialPaymentCents ?? 0), 0);
  const levyTotal = calculatePayrollLevyBasis(totalPayroll, rules);
  const results = grossInputs.map((item) => {
    const share = item.grossCents + (item.base.specialPaymentCents ?? 0);
    return {
      employee: item.row.employee,
      location: item.row.location,
      result: calculatePayroll({
        ...item.base,
        grossCents: item.grossCents,
        monthlyPayrollTotalCents: totalPayroll,
        monthlyMarginalPayrollTotalCents: marginalTotal,
        levyBasisCents: Math.round(levyTotal * share / Math.max(1, totalPayroll)),
      }),
    };
  });
  const snapshotPayload = { payrollMonth, people: results, totalPayroll };
  const digest = checksum(snapshotPayload);
  const totalCost = results.reduce((sum, row) => sum + row.result.employerTotalCents, 0);
  const category = db.select().from(categories).where(eq(categories.template, "personnel")).get();
  if (!category) throw new Error("Personnel category missing");
  let entryId = "";
  db.transaction((tx) => {
    let snapshot = tx.select().from(personnelMonthSnapshots).where(eq(personnelMonthSnapshots.checksum, digest)).get();
    if (!snapshot) {
      snapshot = tx.insert(personnelMonthSnapshots).values({
        payrollMonth,
        ruleVersion: rules.version,
        ruleStatus: rules.status,
        inputJson: { payrollMonth, totalPayroll },
        resultJson: snapshotPayload,
        checksum: digest,
        createdBy: current.id,
      }).returning().get();
    }
    const previousPosting = tx.select().from(personnelPostings).where(eq(personnelPostings.payrollMonth, payrollMonth))
      .orderBy(desc(personnelPostings.createdAt)).get();
    const previousEntry = previousPosting ? tx.select().from(entries).where(eq(entries.id, previousPosting.entryId)).get() : null;
    if (previousPosting?.snapshotId === snapshot.id && previousEntry) {
      entryId = previousEntry.id;
      return;
    }
    const values = {
      kind: "expense" as const,
      date: endDate,
      documentDate: endDate,
      servicePeriodStart: `${payrollMonth}-01`,
      servicePeriodEnd: endDate,
      status: "draft" as const,
      description: `Personalkosten ${payrollMonth}`,
      counterparty: "Personal / Abgabenbehörden",
      categoryId: category.id,
      grossAmountCents: totalCost,
      vatRate: 0,
      vatAmountCents: 0,
      netAmountCents: totalCost,
      paymentMethod: "bank" as const,
      deductiblePercent: 100,
      specialFields: { calculationMode: "manual", overrideReason: "Personal-Engine Sammelbuchung", personnelAggregate: true, snapshotId: snapshot.id, payrollMonth },
      updatedAt: new Date(),
    };
    const correction = Boolean(previousEntry && previousEntry.status === "finalized");
    if (previousEntry?.status === "draft") {
      entryId = previousEntry.id;
      tx.update(entries).set(values).where(eq(entries.id, entryId)).run();
      tx.delete(entryTaxLines).where(eq(entryTaxLines.entryId, entryId)).run();
      tx.delete(entryPaymentLines).where(eq(entryPaymentLines.entryId, entryId)).run();
      tx.delete(personnelPostings).where(eq(personnelPostings.id, previousPosting!.id)).run();
    } else {
      entryId = tx.insert(entries).values({ ...values, description: correction ? `${values.description} · Korrektur` : values.description, createdBy: current.id }).returning({ id: entries.id }).get().id;
    }
    tx.insert(entryTaxLines).values({ entryId, description: "Gesamte Arbeitgeberkosten", netAmountCents: totalCost, vatRate: 0, vatAmountCents: 0, grossAmountCents: totalCost, inputVatDeductiblePercent: 0, sortOrder: 0 }).run();
    const lines: Array<{ date: string; description: string; recipient: string; amountCents: number; paymentMethod: "bank"; sortOrder: number }> = [];
    let order = 0;
    for (const row of results) {
      lines.push({ date: endDate, description: `Nettoentgelt · ${row.employee.name}`, recipient: row.employee.name, amountCents: row.result.netCents, paymentMethod: "bank", sortOrder: order++ });
    }
    const grouped = new Map<string, { description: string; recipient: string; amountCents: number }>();
    const add = (key: string, description: string, recipient: string, amount: number) => {
      const currentLine = grouped.get(key) ?? { description, recipient, amountCents: 0 };
      currentLine.amountCents += amount;
      grouped.set(key, currentLine);
    };
    for (const row of results) {
      const c = row.result.components;
      add("social", "Sozialversicherung", "ÖGK", c.employeeSv.amountCents + row.result.employerSocialCents);
      add("tax", "Lohnabgaben", "Finanzamt", c.wageTax.amountCents + c.db.amountCents + c.dz.amountCents);
      add(`municipal:${row.location.municipality}`, "Gemeindeabgaben", row.location.municipality, c.municipalTax.amountCents + c.viennaLevy.amountCents);
      add("provision", "Betriebliche Vorsorge", "Vorsorgekasse", c.bvContribution.amountCents);
      add("other", "Weitere Personalkosten", "", c.otherPersonnelCost.amountCents);
    }
    for (const line of grouped.values()) if (line.amountCents > 0) lines.push({ date: endDate, ...line, paymentMethod: "bank", sortOrder: order++ });
    tx.insert(entryPaymentLines).values(lines.map((line) => ({ ...line, entryId }))).run();
    tx.insert(entryAuditLog).values({ entryId, action: correction ? "personnel_correction_draft" : "personnel_month_draft", snapshot: { snapshotId: snapshot.id, checksum: digest }, reason: "Erstellt durch Personal-Engine", changedBy: current.id }).run();
    tx.insert(personnelPostings).values({ payrollMonth, snapshotId: snapshot.id, entryId, kind: correction ? "correction" : "regular", createdBy: current.id }).run();
  });
  refreshPersonnel();
  return { entryId, checksum: digest, totalCostCents: totalCost };
}
