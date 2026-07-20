export const PAYROLL_RULE_VERSION = "AT-2026" as const;

export const payrollEmploymentTypes = [
  "worker",
  "employee",
  "marginal",
  "apprentice",
  "freelance",
  "managing_director_asvg",
  "shareholder_managing_director_gsvg",
] as const;

export const payrollStates = [
  "Burgenland",
  "Kärnten",
  "Niederösterreich",
  "Oberösterreich",
  "Salzburg",
  "Steiermark",
  "Tirol",
  "Vorarlberg",
  "Wien",
] as const;

export type PayrollEmploymentType = (typeof payrollEmploymentTypes)[number];
export type PayrollCalculationMode = "auto" | "manual";

export type PayrollComponentKey =
  | "employeeSv"
  | "wageTax"
  | "employerSv"
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

export type PayrollWarning =
  | "allowances_not_included"
  | "freelance_tax_not_calculated"
  | "gsvg_personal_svs_excluded"
  | "marginal_threshold_exceeded"
  | "vienna_levy_assumptions"
  | "unsupported_year";

export type PayrollInput = {
  grossCents: number;
  employmentType: PayrollEmploymentType;
  payrollMonth: string;
  location: { state: string; municipality: string };
  monthlyPayrollTotalCents?: number;
  monthlyMarginalPayrollTotalCents?: number;
  levyBasisCents?: number;
  otherPersonnelCostCents?: number;
};

export type PayrollResult = {
  ruleVersion: typeof PAYROLL_RULE_VERSION;
  grossCents: number;
  netCents: number;
  employerTotalCents: number;
  components: Record<PayrollComponentKey, PayrollComponent>;
  employeeSvTier: string;
  taxableAnnualIncomeCents: number;
  marginalTaxRatePercent: number;
  warnings: PayrollWarning[];
};

export const PAYROLL_2026 = {
  marginalLimitCents: 55_110,
  marginalEmployerThresholdCents: 82_665,
  socialInsuranceCapCents: 693_000,
  freelanceSocialInsuranceCapCents: 808_500,
  payrollLevyThresholdCents: 146_000,
  payrollLevyDeductionCents: 109_500,
  dbRateBasisPoints: 370,
  municipalTaxRateBasisPoints: 300,
  bvRateBasisPoints: 153,
  advertisingExpenseAllowanceCents: 13_200,
  transportTaxCreditCents: 49_600,
} as const;

const DZ_RATES: Record<string, number> = {
  burgenland: 40,
  kärnten: 37,
  kaernten: 37,
  niederösterreich: 33,
  niederoesterreich: 33,
  oberösterreich: 31,
  oberoesterreich: 31,
  salzburg: 35,
  steiermark: 34,
  tirol: 39,
  vorarlberg: 33,
  wien: 36,
};

const TAX_BRACKETS = [
  { upperCents: 1_353_900, ratePercent: 0 },
  { upperCents: 2_199_200, ratePercent: 20 },
  { upperCents: 3_645_800, ratePercent: 30 },
  { upperCents: 7_036_500, ratePercent: 40 },
  { upperCents: 10_485_900, ratePercent: 48 },
  { upperCents: 100_000_000, ratePercent: 50 },
  { upperCents: Number.POSITIVE_INFINITY, ratePercent: 55 },
] as const;

function roundRate(basisCents: number, rateBasisPoints: number) {
  return Math.round((basisCents * rateBasisPoints) / 10_000);
}

function component(
  key: PayrollComponentKey,
  basisCents: number,
  rateBasisPoints: number | null,
  amountCents = rateBasisPoints === null ? 0 : roundRate(basisCents, rateBasisPoints),
): PayrollComponent {
  return { key, basisCents, rateBasisPoints, amountCents };
}

function normalizeState(state: string) {
  return state.trim().toLocaleLowerCase("de-AT");
}

function isVienna(state: string, municipality: string) {
  return normalizeState(state) === "wien" || municipality.trim().toLocaleLowerCase("de-AT") === "wien";
}

function employeeSvRate(type: PayrollEmploymentType, grossCents: number, vienna: boolean) {
  if (type === "marginal" || type === "shareholder_managing_director_gsvg") {
    return { rate: 0, tier: "none" };
  }
  if (type === "apprentice") {
    if (grossCents <= 222_500) return { rate: 1_192, tier: "apprentice-0-av" };
    if (grossCents <= 242_700) return { rate: 1_292, tier: "apprentice-1-av" };
    return { rate: 1_307, tier: "apprentice-1.15-av" };
  }
  if (type === "freelance") {
    if (grossCents <= 222_500) return { rate: 1_462, tier: "freelance-0-av" };
    if (grossCents <= 242_700) return { rate: 1_562, tier: "freelance-1-av" };
    if (grossCents <= 263_000) return { rate: 1_662, tier: "freelance-2-av" };
    return { rate: 1_757, tier: "freelance-2.95-av" };
  }
  const viennaWbfDelta = vienna ? 25 : 0;
  if (grossCents <= 222_500) return { rate: 1_512 + viennaWbfDelta, tier: "0-av" };
  if (grossCents <= 242_700) return { rate: 1_612 + viennaWbfDelta, tier: "1-av" };
  if (grossCents <= 263_000) return { rate: 1_712 + viennaWbfDelta, tier: "2-av" };
  return {
    rate: 1_807 + viennaWbfDelta,
    tier: "2.95-av",
  };
}

function incomeTax(annualIncomeCents: number) {
  let lower = 0;
  let taxCents = 0;
  let marginalTaxRatePercent = 0;
  for (const bracket of TAX_BRACKETS) {
    if (annualIncomeCents <= lower) break;
    const taxable = Math.min(annualIncomeCents, bracket.upperCents) - lower;
    taxCents += (taxable * bracket.ratePercent) / 100;
    marginalTaxRatePercent = bracket.ratePercent;
    lower = bracket.upperCents;
  }
  return {
    annualTaxCents: Math.max(0, taxCents - PAYROLL_2026.transportTaxCreditCents),
    marginalTaxRatePercent,
  };
}

export function calculatePayrollLevyBasis(totalPayrollCents: number) {
  if (totalPayrollCents > PAYROLL_2026.payrollLevyThresholdCents) return totalPayrollCents;
  return Math.max(0, totalPayrollCents - PAYROLL_2026.payrollLevyDeductionCents);
}

/**
 * Allocates an exact shared levy basis across internal automatic bookings.
 * Rows must have stable IDs; ties and remaining cents are resolved by ID.
 */
export function allocatePayrollLevyBases(
  rows: Array<{ id: string; grossCents: number }>,
  combinedPayrollCents: number,
) {
  const result = new Map<string, number>();
  if (combinedPayrollCents <= 0 || rows.length === 0) return result;
  const sharedBasis = calculatePayrollLevyBasis(combinedPayrollCents);
  const internalGross = rows.reduce((sum, row) => sum + row.grossCents, 0);
  const internalTarget = Math.round((sharedBasis * internalGross) / combinedPayrollCents);
  const shares = rows.map((row) => {
    const exact = (sharedBasis * row.grossCents) / combinedPayrollCents;
    const floor = Math.floor(exact);
    return { ...row, floor, fraction: exact - floor };
  });
  let remainder = internalTarget - shares.reduce((sum, row) => sum + row.floor, 0);
  shares.sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  for (const row of shares) {
    result.set(row.id, row.floor + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return result;
}

export function calculatePayrollAt2026(input: PayrollInput): PayrollResult {
  const grossCents = Math.max(0, Math.round(input.grossCents));
  const otherPersonnelCostCents = Math.max(0, Math.round(input.otherPersonnelCostCents ?? 0));
  const warnings: PayrollWarning[] = [];
  const supportedYear = /^2026-(0[1-9]|1[0-2])$/.test(input.payrollMonth);
  if (!supportedYear) warnings.push("unsupported_year");

  const vienna = isVienna(input.location.state, input.location.municipality);
  const gsvg = input.employmentType === "shareholder_managing_director_gsvg";
  const svCap = input.employmentType === "freelance"
    ? PAYROLL_2026.freelanceSocialInsuranceCapCents
    : PAYROLL_2026.socialInsuranceCapCents;
  const svBasisCents = gsvg ? 0 : Math.min(grossCents, svCap);
  const sv = employeeSvRate(input.employmentType, grossCents, vienna);
  const employeeSv = component("employeeSv", svBasisCents, sv.rate);

  let employerSvRate = 2_098;
  if (input.employmentType === "apprentice") employerSvRate = 1_538;
  if (input.employmentType === "freelance") employerSvRate = 2_048;
  if (input.employmentType === "marginal") {
    const marginalTotal = input.monthlyMarginalPayrollTotalCents ?? grossCents;
    employerSvRate = marginalTotal > PAYROLL_2026.marginalEmployerThresholdCents ? 2_050 : 110;
    if (employerSvRate === 2_050) warnings.push("marginal_threshold_exceeded");
  }
  if (vienna && !gsvg && input.employmentType !== "apprentice" && input.employmentType !== "marginal" && input.employmentType !== "freelance") {
    employerSvRate += 25;
  }
  const employerSv = component("employerSv", svBasisCents, gsvg ? 0 : employerSvRate);

  const wageTaxAutomatic = !gsvg && input.employmentType !== "freelance" && input.employmentType !== "marginal";
  const taxableAnnualIncomeCents = wageTaxAutomatic
    ? Math.max(0, (grossCents - employeeSv.amountCents) * 12 - PAYROLL_2026.advertisingExpenseAllowanceCents)
    : 0;
  const tax = incomeTax(taxableAnnualIncomeCents);
  const wageTax = component(
    "wageTax",
    taxableAnnualIncomeCents,
    tax.marginalTaxRatePercent * 100,
    wageTaxAutomatic ? Math.round(tax.annualTaxCents / 12) : 0,
  );

  const monthlyPayrollTotalCents = Math.max(grossCents, input.monthlyPayrollTotalCents ?? grossCents);
  const levyBasisCents = input.levyBasisCents ?? Math.round(
    (calculatePayrollLevyBasis(monthlyPayrollTotalCents) * grossCents) / monthlyPayrollTotalCents,
  );
  const dzRate = DZ_RATES[normalizeState(input.location.state)] ?? DZ_RATES.steiermark;
  const db = component("db", levyBasisCents, PAYROLL_2026.dbRateBasisPoints);
  const dz = component("dz", levyBasisCents, dzRate);
  const municipalTax = component("municipalTax", levyBasisCents, PAYROLL_2026.municipalTaxRateBasisPoints);
  const bvContribution = component("bvContribution", grossCents, gsvg ? 0 : PAYROLL_2026.bvRateBasisPoints);

  const viennaLevyApplies = vienna && !gsvg && input.employmentType !== "apprentice";
  const monthMatch = /^2026-(0[1-9]|1[0-2])$/.exec(input.payrollMonth);
  let commencedWeeks = 0;
  if (monthMatch) {
    const year = 2026;
    const monthIndex = Number(monthMatch[1]) - 1;
    const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const mondayOffset = firstDay === 0 ? 6 : firstDay - 1;
    commencedWeeks = Math.ceil((mondayOffset + days) / 7);
  }
  const viennaLevy = component("viennaLevy", commencedWeeks, null, viennaLevyApplies ? commencedWeeks * 200 : 0);
  const otherPersonnelCost = component("otherPersonnelCost", otherPersonnelCostCents, null, otherPersonnelCostCents);

  if (input.employmentType === "freelance") warnings.push("freelance_tax_not_calculated");
  if (gsvg) warnings.push("gsvg_personal_svs_excluded");
  if (viennaLevyApplies) warnings.push("vienna_levy_assumptions");
  warnings.push("allowances_not_included");

  const components = {
    employeeSv,
    wageTax,
    employerSv,
    db,
    dz,
    municipalTax,
    bvContribution,
    viennaLevy,
    otherPersonnelCost,
  };
  const netCents = grossCents - employeeSv.amountCents - wageTax.amountCents;
  const employerTotalCents = grossCents + employerSv.amountCents + db.amountCents + dz.amountCents
    + municipalTax.amountCents + bvContribution.amountCents + viennaLevy.amountCents + otherPersonnelCost.amountCents;

  return {
    ruleVersion: PAYROLL_RULE_VERSION,
    grossCents,
    netCents,
    employerTotalCents,
    components,
    employeeSvTier: sv.tier,
    taxableAnnualIncomeCents,
    marginalTaxRatePercent: tax.marginalTaxRatePercent,
    warnings,
  };
}
