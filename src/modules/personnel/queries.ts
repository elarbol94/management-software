import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  businessLocations,
  employees,
  employmentContractPeriods,
  fundingCostProfiles,
  fundingProjects,
  personnelFundingProjectLinks,
  personnelPostings,
  personnelScenarios,
  personnelTaxProfiles,
  projectHourAllocations,
  projects,
  user,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { calculateAnnualPersonnelCost } from "./lib/engine";
import { PAYROLL_RULE_SETS } from "./lib/rules";
import type { PayrollEmploymentType } from "@/modules/accounting/lib/payroll-at-2026";

export function canManagePersonnel(user: SessionUser) {
  return user.role === "admin" || user.role === "personnel";
}

export function getPersonnelWorkspace(viewer: SessionUser, year = new Date().getFullYear()) {
  const fullAccess = canManagePersonnel(viewer);
  const locations = fullAccess ? db.select().from(businessLocations).where(eq(businessLocations.active, true)).orderBy(asc(businessLocations.name)).all() : [];
  const users = fullAccess ? db.select({ id: user.id, name: user.name, email: user.email }).from(user).orderBy(asc(user.name)).all() : [];
  const contractRows = fullAccess ? db.select().from(employmentContractPeriods).orderBy(desc(employmentContractPeriods.validFrom)).all() : [];
  const taxRows = fullAccess ? db.select().from(personnelTaxProfiles).orderBy(desc(personnelTaxProfiles.validFrom)).all() : [];
  const people = fullAccess
    ? db.select({
        id: employees.id,
        name: employees.name,
        personnelNumber: employees.personnelNumber,
        employmentType: employees.employmentType,
        locationId: employees.locationId,
        locationName: businessLocations.name,
        state: businessLocations.state,
        municipality: businessLocations.municipality,
        userId: employees.userId,
        birthDate: employees.birthDate,
        collectiveAgreement: employees.collectiveAgreement,
        joinedOn: employees.joinedOn,
        leftOn: employees.leftOn,
        active: employees.active,
      }).from(employees).leftJoin(businessLocations, eq(employees.locationId, businessLocations.id)).orderBy(asc(employees.name)).all()
    : [];
  const peopleWithPlanning = people.map((person) => {
    const contract = contractRows.find((row) =>
      row.employeeId === person.id && row.validFrom <= `${year}-12-31` && (!row.validTo || row.validTo >= `${year}-01-01`));
    const tax = taxRows.find((row) =>
      row.employeeId === person.id && row.validFrom <= `${year}-12-31` && (!row.validTo || row.validTo >= `${year}-01-01`));
    let annual = null;
    if (contract && person.state && person.municipality) {
      annual = calculateAnnualPersonnelCost({
        year,
        contract: {
          employeeId: person.id,
          validFrom: contract.validFrom,
          validTo: contract.validTo,
          employmentType: contract.employmentType as PayrollEmploymentType,
          inputMode: contract.inputMode,
          monthlyAmountCents: contract.monthlyAmountCents,
          weeklyMinutes: contract.weeklyMinutes,
          workdaysPerWeek: contract.workdaysPerWeek,
          specialPaymentsEnabled: contract.specialPaymentsEnabled,
          holidayPayMonth: contract.holidayPayMonth,
          christmasPayMonth: contract.christmasPayMonth,
          vacationWeeksHundredths: contract.vacationWeeksHundredths,
          expectedSickHoursHundredths: contract.expectedSickHoursHundredths,
          trainingHoursHundredths: contract.trainingHoursHundredths,
          internalHoursHundredths: contract.internalHoursHundredths,
          overheadRateBasisPoints: contract.overheadRateBasisPoints,
          salesMarkupBasisPoints: contract.salesMarkupBasisPoints,
          oneOffPayments: contract.oneOffPaymentsJson,
        },
        location: { state: person.state, municipality: person.municipality },
        tax: tax ? {
          taxableBenefitsCents: tax.taxableBenefitsCents,
          commuterAllowanceCents: tax.commuterAllowanceCents,
          commuterEuroCents: tax.commuterEuroCents,
          familyBonusCents: tax.familyBonusCents,
          soleEarnerCreditCents: tax.soleEarnerCreditCents,
          singleParentCreditCents: tax.singleParentCreditCents,
        } : undefined,
      });
    }
    return { ...person, contract: contract ?? null, tax: tax ?? null, annual };
  });

  const projectRows = db.select().from(projects).where(eq(projects.status, "active")).orderBy(asc(projects.name)).all();
  const visibleProjects = fullAccess ? projectRows : projectRows.filter((project) => project.managerId === viewer.id);
  const projectIds = new Set(visibleProjects.map((project) => project.id));
  const allAllocations = db.select({
    id: projectHourAllocations.id,
    employeeId: projectHourAllocations.employeeId,
    employeeName: employees.name,
    projectId: projectHourAllocations.projectId,
    projectName: projects.name,
    payrollMonth: projectHourAllocations.payrollMonth,
    plannedMinutes: projectHourAllocations.plannedMinutes,
    costRateCents: projectHourAllocations.costRateCents,
  }).from(projectHourAllocations)
    .innerJoin(employees, eq(projectHourAllocations.employeeId, employees.id))
    .innerJoin(projects, eq(projectHourAllocations.projectId, projects.id))
    .orderBy(desc(projectHourAllocations.payrollMonth)).all();
  const allocations = allAllocations.filter((row) => projectIds.has(row.projectId));

  return {
    fullAccess,
    year,
    rules: Object.values(PAYROLL_RULE_SETS).map((rule) => ({
      version: rule.version,
      year: rule.year,
      status: rule.status,
      label: rule.label,
      assumptions: rule.assumptions,
      references: rule.references,
    })),
    people: peopleWithPlanning,
    locations,
    users,
    projects: visibleProjects,
    allocations,
    scenarios: fullAccess ? db.select().from(personnelScenarios).orderBy(desc(personnelScenarios.createdAt)).all() : [],
    fundingProfiles: fullAccess ? db.select().from(fundingCostProfiles).orderBy(asc(fundingCostProfiles.name)).all() : [],
    fundingProjects: fullAccess ? db.select().from(fundingProjects).orderBy(asc(fundingProjects.name)).all() : [],
    fundingLinks: fullAccess ? db.select().from(personnelFundingProjectLinks).all() : [],
    postings: fullAccess ? db.select().from(personnelPostings).orderBy(desc(personnelPostings.createdAt)).all() : [],
  };
}

export type PersonnelWorkspaceData = ReturnType<typeof getPersonnelWorkspace>;
