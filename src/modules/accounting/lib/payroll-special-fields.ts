import { parseAmountToCents } from "@/lib/money";
import {
  PAYROLL_RULE_VERSION,
  calculatePayrollAt2026,
  payrollEmploymentTypes,
  type PayrollEmploymentType,
  type PayrollInput,
  type PayrollResult,
} from "./payroll-at-2026";

export type SpecialFields = Record<string, string | number | boolean | null>;

export const PAYROLL_AMOUNT_FIELDS = [
  "grossSalary",
  "netSalary",
  "employeeSv",
  "wageTax",
  "employerSv",
  "db",
  "dz",
  "municipalTax",
  "bvContribution",
  "viennaLevy",
  "otherPersonnelCost",
] as const;

export function storedAmountCents(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  return parseAmountToCents(String(value ?? "")) ?? 0;
}

export function centsToStoredAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

export function normalizeEmploymentType(value: unknown): PayrollEmploymentType | null {
  const migrated = value === "managing_director" ? "managing_director_asvg" : value;
  return payrollEmploymentTypes.includes(migrated as PayrollEmploymentType)
    ? migrated as PayrollEmploymentType
    : null;
}

export function validatePayrollMode(fields: SpecialFields): "auto" | "manual" {
  const mode = fields.calculationMode === "manual" ? "manual" : "auto";
  if (mode === "manual" && !String(fields.overrideReason ?? "").trim()) {
    throw new Error("Manual payroll values require an override reason");
  }
  if (mode === "auto" && !/^2026-(0[1-9]|1[0-2])$/.test(String(fields.payrollMonth ?? ""))) {
    throw new Error("Automatic payroll calculation is only available for 2026");
  }
  return mode;
}

export function payrollResultToSpecialFields(fields: SpecialFields, result: PayrollResult): SpecialFields {
  const next: SpecialFields = {
    ...fields,
    calculationMode: "auto",
    payrollRuleVersion: PAYROLL_RULE_VERSION,
    grossSalary: centsToStoredAmount(result.grossCents),
    netSalary: centsToStoredAmount(result.netCents),
    taxableAnnualIncome: centsToStoredAmount(result.taxableAnnualIncomeCents),
    marginalTaxRatePercent: result.marginalTaxRatePercent,
    employeeSvTier: result.employeeSvTier,
    payrollWarnings: JSON.stringify(result.warnings),
    employerTotal: centsToStoredAmount(result.employerTotalCents),
  };
  for (const [key, line] of Object.entries(result.components)) {
    next[key] = centsToStoredAmount(line.amountCents);
    next[`${key}BasisCents`] = line.basisCents;
    next[`${key}RateBasisPoints`] = line.rateBasisPoints;
  }
  return next;
}

export function calculateFromSpecialFields(
  fields: SpecialFields,
  input: Omit<PayrollInput, "grossCents" | "employmentType" | "payrollMonth" | "otherPersonnelCostCents"> & {
    employmentType?: PayrollEmploymentType;
  },
) {
  const employmentType = input.employmentType ?? normalizeEmploymentType(fields.employmentType);
  if (!employmentType) throw new Error("Invalid employment type");
  const payrollMonth = String(fields.payrollMonth ?? "");
  return calculatePayrollAt2026({
    ...input,
    employmentType,
    payrollMonth,
    grossCents: storedAmountCents(fields.grossSalary),
    otherPersonnelCostCents: storedAmountCents(fields.otherPersonnelCost),
  });
}

export function payrollPaymentLines(
  fields: SpecialFields,
  fallbackDate: string,
  paymentMethod: "bank" | "cash" | "card",
  descriptions: {
    net: string;
    social: string;
    taxOffice: string;
    municipality: string;
    provision: string;
    other: string;
  },
) {
  const amount = (key: string) => storedAmountCents(fields[key]);
  return [
    { date: String(fields.employeePaymentDate || fallbackDate), description: descriptions.net, recipient: String(fields.employeeName ?? ""), amountCents: amount("netSalary"), paymentMethod },
    { date: String(fields.socialPaymentDate || fallbackDate), description: descriptions.social, recipient: "ÖGK", amountCents: amount("employeeSv") + amount("employerSv"), paymentMethod },
    { date: String(fields.taxPaymentDate || fallbackDate), description: descriptions.taxOffice, recipient: "Finanzamt", amountCents: amount("wageTax") + amount("db") + amount("dz"), paymentMethod },
    { date: String(fields.municipalPaymentDate || fallbackDate), description: descriptions.municipality, recipient: String(fields.municipality ?? "Gemeinde"), amountCents: amount("municipalTax") + amount("viennaLevy"), paymentMethod },
    { date: String(fields.provisionPaymentDate || fallbackDate), description: descriptions.provision, recipient: String(fields.provisionFund ?? "Vorsorgekasse"), amountCents: amount("bvContribution"), paymentMethod },
    { date: fallbackDate, description: descriptions.other, recipient: "", amountCents: amount("otherPersonnelCost"), paymentMethod },
  ].filter((line) => line.amountCents > 0);
}
