import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  fundingBookingAllocations,
  fundingBudgetItems,
  fundingDisbursements,
  fundingEvidenceItems,
  fundingFinancingSources,
  fundingProgramTemplates,
  fundingProjects,
} from "@/db/schema";
import {
  calculateFinancing,
  calculateMaximumGrant,
  calculateWarningCodes,
} from "./lib/calculations";

export function listFundingProgramTemplates() {
  return db
    .select()
    .from(fundingProgramTemplates)
    .where(eq(fundingProgramTemplates.archived, false))
    .orderBy(asc(fundingProgramTemplates.name))
    .all();
}

export function listFundingProjects() {
  const projects = db
    .select({
      id: fundingProjects.id,
      name: fundingProjects.name,
      programName: fundingProjects.programName,
      fundingBody: fundingProjects.fundingBody,
      status: fundingProjects.status,
      projectStart: fundingProjects.projectStart,
      projectEnd: fundingProjects.projectEnd,
      approvedFundingCents: fundingProjects.approvedFundingCents,
      templateName: fundingProgramTemplates.name,
      updatedAt: fundingProjects.updatedAt,
    })
    .from(fundingProjects)
    .leftJoin(
      fundingProgramTemplates,
      eq(fundingProjects.templateId, fundingProgramTemplates.id),
    )
    .orderBy(desc(fundingProjects.updatedAt))
    .all();

  const budgets = db
    .select({ projectId: fundingBudgetItems.projectId, totalCents: fundingBudgetItems.totalCents })
    .from(fundingBudgetItems)
    .all();
  const sources = db
    .select({
      projectId: fundingFinancingSources.projectId,
      sourceType: fundingFinancingSources.sourceType,
      amountCents: fundingFinancingSources.amountCents,
    })
    .from(fundingFinancingSources)
    .all();

  return projects.map((project) => {
    const totalProjectCostCents = budgets
      .filter((item) => item.projectId === project.id)
      .reduce((total, item) => total + item.totalCents, 0);
    const financing = calculateFinancing(
      totalProjectCostCents,
      sources.filter((source) => source.projectId === project.id),
    );
    return { ...project, totalProjectCostCents, ...financing };
  });
}

export type FundingProjectListRow = ReturnType<typeof listFundingProjects>[number];

export function getFundingProjectControl(projectId: string) {
  const project = db
    .select({
      id: fundingProjects.id,
      templateId: fundingProjects.templateId,
      templateName: fundingProgramTemplates.name,
      templateDescription: fundingProgramTemplates.description,
      programName: fundingProjects.programName,
      fundingBody: fundingProjects.fundingBody,
      name: fundingProjects.name,
      submissionDeadline: fundingProjects.submissionDeadline,
      plannedSubmissionDate: fundingProjects.plannedSubmissionDate,
      projectStart: fundingProjects.projectStart,
      projectEnd: fundingProjects.projectEnd,
      status: fundingProjects.status,
      fundingRateBasisPoints: fundingProjects.fundingRateBasisPoints,
      fundingCapCents: fundingProjects.fundingCapCents,
      approvedFundingCents: fundingProjects.approvedFundingCents,
      contactName: fundingProjects.contactName,
      contactEmail: fundingProjects.contactEmail,
      fundingNumber: fundingProjects.fundingNumber,
      vatDeductible: fundingProjects.vatDeductible,
      deMinimisRelevant: fundingProjects.deMinimisRelevant,
      otherAidCents: fundingProjects.otherAidCents,
      notes: fundingProjects.notes,
    })
    .from(fundingProjects)
    .leftJoin(
      fundingProgramTemplates,
      eq(fundingProjects.templateId, fundingProgramTemplates.id),
    )
    .where(eq(fundingProjects.id, projectId))
    .get();
  if (!project) return null;

  const budgetItems = db
    .select()
    .from(fundingBudgetItems)
    .where(eq(fundingBudgetItems.projectId, projectId))
    .orderBy(asc(fundingBudgetItems.sortOrder))
    .all();
  const financingSources = db
    .select()
    .from(fundingFinancingSources)
    .where(eq(fundingFinancingSources.projectId, projectId))
    .orderBy(asc(fundingFinancingSources.sortOrder))
    .all();
  const disbursements = db
    .select()
    .from(fundingDisbursements)
    .where(eq(fundingDisbursements.projectId, projectId))
    .orderBy(asc(fundingDisbursements.sortOrder))
    .all();
  const allocations = db
    .select()
    .from(fundingBookingAllocations)
    .where(eq(fundingBookingAllocations.projectId, projectId))
    .orderBy(desc(fundingBookingAllocations.bookingDate))
    .all();
  const evidenceItems = db
    .select()
    .from(fundingEvidenceItems)
    .where(eq(fundingEvidenceItems.projectId, projectId))
    .orderBy(asc(fundingEvidenceItems.dueDate))
    .all();

  const budgetControl = budgetItems.map((item) => {
    const itemAllocations = allocations.filter(
      (allocation) => allocation.budgetItemId === item.id,
    );
    const actualCents = itemAllocations.reduce(
      (total, allocation) => total + allocation.actualAmountCents,
      0,
    );
    const evidenceComplete = itemAllocations.filter(
      (allocation) => allocation.evidenceStatus === "complete",
    ).length;
    return {
      ...item,
      actualCents,
      varianceCents: item.totalCents - actualCents,
      evidenceComplete,
      evidenceTotal: itemAllocations.length,
    };
  });
  const totalProjectCostCents = budgetItems.reduce(
    (total, item) => total + item.totalCents,
    0,
  );
  const totalEligibleCostCents = budgetItems.reduce(
    (total, item) => total + item.eligibleAmountCents,
    0,
  );
  const totalActualCents = allocations.reduce(
    (total, item) => total + item.actualAmountCents,
    0,
  );
  const financing = calculateFinancing(totalProjectCostCents, financingSources);
  const warningCodes = calculateWarningCodes({
    projectStart: project.projectStart,
    projectEnd: project.projectEnd,
    projectStatus: project.status,
    financingGapCents: financing.financingGapCents,
    budgetActuals: budgetControl.map((item) => ({
      plannedCents: item.totalCents,
      actualCents: item.actualCents,
    })),
    bookings: allocations.map((allocation) => ({
      bookingDate: allocation.bookingDate,
      evidenceStatus: allocation.evidenceStatus,
    })),
  });

  return {
    project,
    budgetItems: budgetControl,
    financingSources,
    disbursements,
    allocations,
    evidenceItems,
    metrics: {
      totalProjectCostCents,
      totalEligibleCostCents,
      totalActualCents,
      maximumGrantCents: calculateMaximumGrant(
        totalEligibleCostCents,
        project.fundingRateBasisPoints,
        project.fundingCapCents,
      ),
      evidenceComplete: allocations.filter(
        (allocation) => allocation.evidenceStatus === "complete",
      ).length,
      evidenceTotal: allocations.length,
      ...financing,
    },
    warningCodes,
  };
}

export type FundingProjectControl = NonNullable<
  ReturnType<typeof getFundingProjectControl>
>;
