import type { PayrollEmploymentType } from "@/modules/accounting/lib/payroll-at-2026";
import { getPayrollRuleSet, type PayrollRuleSet } from "./rules";

export type PayrollComponentKey =
  | "employeeSv"
  | "wageTax"
  | "employerHealth"
  | "employerPension"
  | "employerUnemployment"
  | "employerAccident"
  | "employerIesg"
  | "employerHousing"
  | "employerOtherSocial"
  | "db"
  | "dz"
  | "municipalTax"
  | "bvContribution"
  | "viennaLevy"
  | "otherPersonnelCost";

export type PayrollComponent = {
  key: PayrollComponentKey;
  basisCents: number;
  rateBasisPoints: number | null;
  amountCents: number;
};

export type PayrollInput = {
  year: number;
  payrollMonth: string;
  grossCents: number;
  specialPaymentCents?: number;
  employmentType: PayrollEmploymentType;
  location: { state: string; municipality: string };
  taxableBenefitsCents?: number;
  commuterAllowanceCents?: number;
  commuterEuroCents?: number;
  familyBonusCents?: number;
  soleEarnerCreditCents?: number;
  singleParentCreditCents?: number;
  monthlyPayrollTotalCents?: number;
  monthlyMarginalPayrollTotalCents?: number;
  levyBasisCents?: number;
  otherPersonnelCostCents?: number;
};

export type PayrollResult = {
  ruleVersion: PayrollRuleSet["version"];
  ruleStatus: PayrollRuleSet["status"];
  grossCents: number;
  specialPaymentCents: number;
  netCents: number;
  employerTotalCents: number;
  employerSocialCents: number;
  components: Record<PayrollComponentKey, PayrollComponent>;
  taxableAnnualIncomeCents: number;
  marginalTaxRatePercent: number;
  warnings: string[];
};

export type EmploymentContractPeriod = {
  employeeId?: string;
  validFrom: string;
  validTo?: string | null;
  employmentType: PayrollEmploymentType;
  inputMode: "gross" | "net";
  monthlyAmountCents: number;
  weeklyMinutes: number;
  workdaysPerWeek: number;
  specialPaymentsEnabled: boolean;
  holidayPayMonth: number;
  christmasPayMonth: number;
  vacationWeeksHundredths: number;
  expectedSickHoursHundredths: number;
  trainingHoursHundredths: number;
  internalHoursHundredths: number;
  overheadRateBasisPoints: number;
  salesMarkupBasisPoints: number;
  oneOffPayments?: Array<{ month: number; amountCents: number; label: string }>;
};

export type AnnualCostResult = {
  year: number;
  ruleVersion: PayrollRuleSet["version"];
  ruleStatus: PayrollRuleSet["status"];
  months: Array<PayrollResult & { month: number; activeRatio: number }>;
  annualGrossCents: number;
  annualNetCents: number;
  annualEmployerCostCents: number;
  productiveHoursHundredths: number;
  directHourlyRateCents: number;
  fullHourlyRateCents: number;
  salesHourlyRateCents: number;
  warnings: string[];
};

export type ProjectHourAllocation = {
  projectId: string;
  plannedMinutes: number;
  costRateCents: number;
};

export type FundingCostProfile = {
  divisorMode: "productive_hours" | "fixed";
  fixedAnnualDivisor?: number | null;
  hourlyCapCents?: number | null;
  maxAnnualHoursHundredths?: number | null;
  overheadRateBasisPoints: number;
  roundingMode: "cent" | "euro";
  eligibleComponents?: string[];
};

const roundRate = (basisCents: number, basisPoints: number) =>
  Math.round((basisCents * basisPoints) / 10_000);

function component(key: PayrollComponentKey, basisCents: number, rateBasisPoints: number | null, amountCents?: number) {
  return {
    key,
    basisCents,
    rateBasisPoints,
    amountCents: amountCents ?? (rateBasisPoints === null ? 0 : roundRate(basisCents, rateBasisPoints)),
  };
}

const normalize = (value: string) => value.trim().toLocaleLowerCase("de-AT");
const isVienna = (input: PayrollInput) =>
  normalize(input.location.state) === "wien" || normalize(input.location.municipality) === "wien";

function employeeSvRate(type: PayrollEmploymentType, grossCents: number, vienna: boolean) {
  if (type === "marginal" || type === "shareholder_managing_director_gsvg") return 0;
  if (type === "apprentice") {
    if (grossCents <= 222_500) return 1_192;
    if (grossCents <= 242_700) return 1_292;
    return 1_307;
  }
  if (type === "freelance") {
    if (grossCents <= 222_500) return 1_462;
    if (grossCents <= 242_700) return 1_562;
    if (grossCents <= 263_000) return 1_662;
    return 1_757;
  }
  const wbf = vienna ? 25 : 0;
  if (grossCents <= 222_500) return 1_512 + wbf;
  if (grossCents <= 242_700) return 1_612 + wbf;
  if (grossCents <= 263_000) return 1_712 + wbf;
  return 1_807 + wbf;
}

function employerSocialRates(type: PayrollEmploymentType, vienna: boolean, marginalTotal: number, rules: PayrollRuleSet) {
  if (type === "shareholder_managing_director_gsvg") {
    return { health: 0, pension: 0, unemployment: 0, accident: 0, iesg: 0, housing: 0, other: 0 };
  }
  if (type === "marginal") {
    return {
      health: 0,
      pension: 0,
      unemployment: 0,
      accident: 110,
      iesg: marginalTotal > rules.marginalEmployerThresholdCents ? 50 : 0,
      housing: 0,
      other: marginalTotal > rules.marginalEmployerThresholdCents ? 1_890 : 0,
    };
  }
  if (type === "apprentice") {
    return { health: 378, pension: 1_255, unemployment: 0, accident: 0, iesg: 0, housing: 0, other: -95 };
  }
  if (type === "freelance") {
    return { health: 378, pension: 1_255, unemployment: 295, accident: 110, iesg: 10, housing: 0, other: 0 };
  }
  return { health: 378, pension: 1_255, unemployment: 295, accident: 110, iesg: 10, housing: vienna ? 75 : 50, other: 0 };
}

function incomeTax(annualIncomeCents: number, rules: PayrollRuleSet) {
  let lower = 0;
  let tax = 0;
  let marginalTaxRatePercent = 0;
  for (const bracket of rules.taxBrackets) {
    if (annualIncomeCents <= lower) break;
    const taxable = Math.min(annualIncomeCents, bracket.upperCents) - lower;
    tax += (taxable * bracket.ratePercent) / 100;
    marginalTaxRatePercent = bracket.ratePercent;
    lower = bracket.upperCents;
  }
  return { annualTaxCents: Math.max(0, Math.round(tax)), marginalTaxRatePercent };
}

export function calculatePayrollLevyBasis(totalPayrollCents: number, rules: PayrollRuleSet) {
  return totalPayrollCents > rules.payrollLevyThresholdCents
    ? totalPayrollCents
    : Math.max(0, totalPayrollCents - rules.payrollLevyDeductionCents);
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const rules = getPayrollRuleSet(input.year);
  const gross = Math.max(0, Math.round(input.grossCents));
  const special = Math.max(0, Math.round(input.specialPaymentCents ?? 0));
  const benefits = Math.max(0, Math.round(input.taxableBenefitsCents ?? 0));
  const other = Math.max(0, Math.round(input.otherPersonnelCostCents ?? 0));
  const vienna = isVienna(input);
  const gsvg = input.employmentType === "shareholder_managing_director_gsvg";
  const svCap = input.employmentType === "freelance" ? rules.freelanceSocialInsuranceCapCents : rules.socialInsuranceCapCents;
  const svBasis = gsvg ? 0 : Math.min(gross + benefits, svCap);
  const svRate = employeeSvRate(input.employmentType, gross + benefits, vienna);
  const employeeSv = component("employeeSv", svBasis, svRate);

  const wageTaxAutomatic = !gsvg && input.employmentType !== "freelance" && input.employmentType !== "marginal";
  const taxableAnnualIncomeCents = wageTaxAutomatic
    ? Math.max(0, (gross + benefits - employeeSv.amountCents - (input.commuterAllowanceCents ?? 0)) * 12 - rules.advertisingExpenseAllowanceCents)
    : 0;
  const tax = incomeTax(taxableAnnualIncomeCents, rules);
  const annualCredits = rules.transportTaxCreditCents
    + ((input.commuterEuroCents ?? 0) + (input.familyBonusCents ?? 0)
      + (input.soleEarnerCreditCents ?? 0) + (input.singleParentCreditCents ?? 0)) * 12;
  const regularTax = wageTaxAutomatic ? Math.max(0, Math.round((tax.annualTaxCents - annualCredits) / 12)) : 0;
  const specialSv = special ? roundRate(Math.min(special, svCap), svRate) : 0;
  const specialTax = wageTaxAutomatic ? Math.max(0, Math.round((special - specialSv) * 0.06)) : 0;
  const wageTax = component("wageTax", taxableAnnualIncomeCents, tax.marginalTaxRatePercent * 100, regularTax + specialTax);

  const marginalTotal = input.monthlyMarginalPayrollTotalCents ?? gross;
  const socialRates = employerSocialRates(input.employmentType, vienna, marginalTotal, rules);
  const employerBasis = gsvg ? 0 : Math.min(gross + benefits + special, svCap + (special ? svCap : 0));
  const social = {
    employerHealth: component("employerHealth", employerBasis, socialRates.health),
    employerPension: component("employerPension", employerBasis, socialRates.pension),
    employerUnemployment: component("employerUnemployment", employerBasis, socialRates.unemployment),
    employerAccident: component("employerAccident", employerBasis, socialRates.accident),
    employerIesg: component("employerIesg", employerBasis, socialRates.iesg),
    employerHousing: component("employerHousing", employerBasis, socialRates.housing),
    employerOtherSocial: component("employerOtherSocial", employerBasis, socialRates.other),
  };
  const monthlyPayrollTotal = Math.max(gross + special, input.monthlyPayrollTotalCents ?? gross + special);
  const levyBasis = input.levyBasisCents ?? Math.round(
    calculatePayrollLevyBasis(monthlyPayrollTotal, rules) * (gross + special) / Math.max(1, monthlyPayrollTotal),
  );
  const dzRate = rules.dzRates[normalize(input.location.state)] ?? rules.dzRates.steiermark;
  const db = component("db", levyBasis, rules.dbRateBasisPoints);
  const dz = component("dz", levyBasis, dzRate);
  const municipalTax = component("municipalTax", levyBasis, rules.municipalTaxRateBasisPoints);
  const bvContribution = component("bvContribution", gross + special, gsvg ? 0 : rules.bvRateBasisPoints);
  const monthNumber = Number(input.payrollMonth.slice(5, 7));
  const monthIndex = monthNumber - 1;
  const days = new Date(Date.UTC(input.year, monthIndex + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(input.year, monthIndex, 1)).getUTCDay();
  const mondayOffset = firstDay === 0 ? 6 : firstDay - 1;
  const commencedWeeks = Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12
    ? Math.ceil((mondayOffset + days) / 7)
    : 0;
  const viennaLevy = component("viennaLevy", commencedWeeks, null, vienna && !gsvg && input.employmentType !== "apprentice" ? commencedWeeks * 200 : 0);
  const otherPersonnelCost = component("otherPersonnelCost", other, null, other);
  const employeeSvTotal = component(
    "employeeSv",
    employeeSv.basisCents + Math.min(special, svCap),
    svRate,
    employeeSv.amountCents + specialSv,
  );
  const components = { employeeSv: employeeSvTotal, wageTax, ...social, db, dz, municipalTax, bvContribution, viennaLevy, otherPersonnelCost };
  const employerSocialCents = Object.values(social).reduce((sum, line) => sum + line.amountCents, 0);
  const employerTotalCents = gross + special + employerSocialCents + db.amountCents + dz.amountCents
    + municipalTax.amountCents + bvContribution.amountCents + viennaLevy.amountCents + other;
  const warnings = [
    ...(rules.status === "forecast" ? ["forecast_rules"] : []),
    ...(special ? ["special_payment_simplified"] : []),
    ...(input.employmentType === "freelance" ? ["freelance_tax_not_calculated"] : []),
    ...(gsvg ? ["gsvg_personal_svs_excluded"] : []),
  ];
  return {
    ruleVersion: rules.version,
    ruleStatus: rules.status,
    grossCents: gross,
    specialPaymentCents: special,
    netCents: gross + special - employeeSv.amountCents - specialSv - wageTax.amountCents,
    employerTotalCents,
    employerSocialCents,
    components,
    taxableAnnualIncomeCents,
    marginalTaxRatePercent: tax.marginalTaxRatePercent,
    warnings,
  };
}

export function solveGrossForNet(input: Omit<PayrollInput, "grossCents"> & { targetNetCents: number }) {
  let low = 0;
  let high = Math.max(100_000, input.targetNetCents * 3);
  while (calculatePayroll({ ...input, grossCents: high }).netCents < input.targetNetCents && high < 100_000_000) high *= 2;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (calculatePayroll({ ...input, grossCents: mid }).netCents >= input.targetNetCents) high = mid;
    else low = mid + 1;
  }
  const result = calculatePayroll({ ...input, grossCents: low });
  return { grossCents: low, result, deltaCents: result.netCents - input.targetNetCents };
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function austrianPublicHolidays(year: number) {
  const easter = easterSunday(year);
  const offset = (days: number) => {
    const date = new Date(easter);
    date.setUTCDate(date.getUTCDate() + days);
    return iso(date);
  };
  return new Set([
    `${year}-01-01`, `${year}-01-06`, offset(1), `${year}-05-01`, offset(39), offset(50),
    offset(60), `${year}-08-15`, `${year}-10-26`, `${year}-11-01`, `${year}-12-08`,
    `${year}-12-25`, `${year}-12-26`,
  ]);
}

export function calculateProductiveHours(contract: EmploymentContractPeriod, year: number) {
  const holidays = austrianPublicHolidays(year);
  const from = new Date(`${contract.validFrom}T00:00:00Z`);
  const to = new Date(`${contract.validTo ?? `${year}-12-31`}T00:00:00Z`);
  const start = from > new Date(`${year}-01-01T00:00:00Z`) ? from : new Date(`${year}-01-01T00:00:00Z`);
  const end = to < new Date(`${year}-12-31T00:00:00Z`) ? to : new Date(`${year}-12-31T00:00:00Z`);
  const workingWeekdays = new Set(Array.from({ length: Math.min(5, contract.workdaysPerWeek) }, (_, index) => index + 1));
  let workdays = 0;
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (workingWeekdays.has(date.getUTCDay()) && !holidays.has(iso(date))) workdays += 1;
  }
  const dailyMinutes = contract.weeklyMinutes / Math.max(1, contract.workdaysPerWeek);
  const grossHoursHundredths = Math.round(workdays * dailyMinutes * 100 / 60);
  const vacationHoursHundredths = Math.round(contract.weeklyMinutes / 60 * contract.vacationWeeksHundredths);
  const productiveHoursHundredths = Math.max(0, grossHoursHundredths - vacationHoursHundredths
    - contract.expectedSickHoursHundredths - contract.trainingHoursHundredths - contract.internalHoursHundredths);
  return { workdays, grossHoursHundredths, vacationHoursHundredths, productiveHoursHundredths };
}

function activeRatio(contract: EmploymentContractPeriod, year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const start = new Date(`${contract.validFrom}T00:00:00Z`);
  const end = new Date(`${contract.validTo ?? `${year}-12-31`}T00:00:00Z`);
  const activeStart = start > first ? start : first;
  const activeEnd = end < last ? end : last;
  if (activeStart > activeEnd) return 0;
  return (Math.floor((activeEnd.getTime() - activeStart.getTime()) / 86_400_000) + 1) / last.getUTCDate();
}

export function calculateAnnualPersonnelCost(input: {
  year: number;
  contract: EmploymentContractPeriod;
  location: PayrollInput["location"];
  tax?: Partial<Pick<PayrollInput, "taxableBenefitsCents" | "commuterAllowanceCents" | "commuterEuroCents" | "familyBonusCents" | "soleEarnerCreditCents" | "singleParentCreditCents">>;
}) {
  const { year, contract, location } = input;
  let baseGross = contract.monthlyAmountCents;
  if (contract.inputMode === "net") {
    baseGross = solveGrossForNet({
      year,
      payrollMonth: `${year}-01`,
      targetNetCents: contract.monthlyAmountCents,
      employmentType: contract.employmentType,
      location,
      ...input.tax,
    }).grossCents;
  }
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const ratio = activeRatio(contract, year, month);
    const oneOff = (contract.oneOffPayments ?? []).filter((item) => item.month === month)
      .reduce((sum, item) => sum + item.amountCents, 0);
    const special = contract.specialPaymentsEnabled && (month === contract.holidayPayMonth || month === contract.christmasPayMonth)
      ? Math.round(baseGross * ratio)
      : 0;
    return {
      ...calculatePayroll({
        year,
        payrollMonth: `${year}-${String(month).padStart(2, "0")}`,
        grossCents: Math.round(baseGross * ratio) + oneOff,
        specialPaymentCents: special,
        employmentType: contract.employmentType,
        location,
        ...input.tax,
      }),
      month,
      activeRatio: ratio,
    };
  });
  const productive = calculateProductiveHours(contract, year);
  const annualEmployerCostCents = months.reduce((sum, month) => sum + month.employerTotalCents, 0);
  const directHourlyRateCents = productive.productiveHoursHundredths
    ? Math.round(annualEmployerCostCents * 100 / productive.productiveHoursHundredths)
    : 0;
  const fullHourlyRateCents = roundRate(directHourlyRateCents, 10_000 + contract.overheadRateBasisPoints);
  const salesHourlyRateCents = roundRate(fullHourlyRateCents, 10_000 + contract.salesMarkupBasisPoints);
  const rules = getPayrollRuleSet(year);
  const result: AnnualCostResult = {
    year,
    ruleVersion: rules.version,
    ruleStatus: rules.status,
    months,
    annualGrossCents: months.reduce((sum, month) => sum + month.grossCents + month.specialPaymentCents, 0),
    annualNetCents: months.reduce((sum, month) => sum + month.netCents, 0),
    annualEmployerCostCents,
    productiveHoursHundredths: productive.productiveHoursHundredths,
    directHourlyRateCents,
    fullHourlyRateCents,
    salesHourlyRateCents,
    warnings: [...new Set(months.flatMap((month) => month.warnings))],
  };
  return result;
}

export function allocatePlannedProjectCosts(allocations: ProjectHourAllocation[], capacityMinutes: number) {
  const totalMinutes = allocations.reduce((sum, row) => sum + row.plannedMinutes, 0);
  return {
    totalMinutes,
    capacityMinutes,
    remainingMinutes: capacityMinutes - totalMinutes,
    overbooked: totalMinutes > capacityMinutes,
    rows: allocations.map((row) => ({
      ...row,
      shareBasisPoints: capacityMinutes ? Math.round(row.plannedMinutes * 10_000 / capacityMinutes) : 0,
      plannedCostCents: Math.round(row.plannedMinutes * row.costRateCents / 60),
    })),
  };
}

export function applyFundingProfile(input: {
  annualEmployerCostCents: number;
  componentTotals?: Record<string, number>;
  productiveHoursHundredths: number;
  plannedHoursHundredths: number;
  profile: FundingCostProfile;
}) {
  const eligibleAnnualCostCents = input.componentTotals && input.profile.eligibleComponents?.length
    ? input.profile.eligibleComponents.reduce((sum, key) => sum + (input.componentTotals?.[key] ?? 0), 0)
    : input.annualEmployerCostCents;
  const divisor = input.profile.divisorMode === "fixed"
    ? Math.max(1, input.profile.fixedAnnualDivisor ?? 1)
    : Math.max(1, input.productiveHoursHundredths / 100);
  const rawHourlyRate = Math.round(eligibleAnnualCostCents / divisor);
  const eligibleHourlyRateCents = input.profile.hourlyCapCents
    ? Math.min(rawHourlyRate, input.profile.hourlyCapCents)
    : rawHourlyRate;
  const hours = input.profile.maxAnnualHoursHundredths
    ? Math.min(input.plannedHoursHundredths, input.profile.maxAnnualHoursHundredths)
    : input.plannedHoursHundredths;
  let personnelCostCents = Math.round(eligibleHourlyRateCents * hours / 100);
  let overheadCents = roundRate(personnelCostCents, input.profile.overheadRateBasisPoints);
  if (input.profile.roundingMode === "euro") {
    personnelCostCents = Math.round(personnelCostCents / 100) * 100;
    overheadCents = Math.round(overheadCents / 100) * 100;
  }
  return { eligibleHourlyRateCents, eligibleHoursHundredths: hours, personnelCostCents, overheadCents, totalEligibleCents: personnelCostCents + overheadCents };
}
