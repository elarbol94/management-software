import type { PayrollEmploymentType } from "@/modules/accounting/lib/payroll-at-2026";

export type PayrollRuleStatus = "verified" | "forecast";

export type PayrollRuleSet = {
  version: "AT-2025" | "AT-2026" | "AT-2027-FORECAST";
  year: number;
  status: PayrollRuleStatus;
  label: string;
  assumptions: string[];
  references: ReadonlyArray<{ label: string; url: string }>;
  marginalLimitCents: number;
  marginalEmployerThresholdCents: number;
  socialInsuranceCapCents: number;
  freelanceSocialInsuranceCapCents: number;
  payrollLevyThresholdCents: number;
  payrollLevyDeductionCents: number;
  dbRateBasisPoints: number;
  municipalTaxRateBasisPoints: number;
  bvRateBasisPoints: number;
  advertisingExpenseAllowanceCents: number;
  transportTaxCreditCents: number;
  taxBrackets: ReadonlyArray<{ upperCents: number; ratePercent: number }>;
  dzRates: Record<string, number>;
};

const DZ_RATES = {
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
} satisfies Record<string, number>;

export const PAYROLL_RULE_SETS: Record<number, PayrollRuleSet> = {
  2025: {
    version: "AT-2025",
    year: 2025,
    status: "verified",
    label: "Österreich 2025",
    assumptions: ["Planungsrechnung auf Basis der gesetzlichen Jahreswerte 2025."],
    references: [
      { label: "BMF · Steuertarif 2025", url: "https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html" },
      { label: "Sozialversicherung · Beitragswerte 2025", url: "https://www.sozialversicherung.at/cdscontent/load?contentid=10008.797715&version=1755603703" },
      { label: "WKO · DZ nach Bundesland", url: "https://www.wko.at/lohnverrechnung/zuschlag-dienstgeberbeitrag" },
    ],
    marginalLimitCents: 55_110,
    marginalEmployerThresholdCents: 82_665,
    socialInsuranceCapCents: 645_000,
    freelanceSocialInsuranceCapCents: 752_500,
    payrollLevyThresholdCents: 146_000,
    payrollLevyDeductionCents: 109_500,
    dbRateBasisPoints: 370,
    municipalTaxRateBasisPoints: 300,
    bvRateBasisPoints: 153,
    advertisingExpenseAllowanceCents: 13_200,
    transportTaxCreditCents: 48_700,
    taxBrackets: [
      { upperCents: 1_330_800, ratePercent: 0 },
      { upperCents: 2_161_700, ratePercent: 20 },
      { upperCents: 3_583_600, ratePercent: 30 },
      { upperCents: 6_916_600, ratePercent: 40 },
      { upperCents: 10_307_200, ratePercent: 48 },
      { upperCents: 100_000_000, ratePercent: 50 },
      { upperCents: Number.POSITIVE_INFINITY, ratePercent: 55 },
    ],
    dzRates: DZ_RATES,
  },
  2026: {
    version: "AT-2026",
    year: 2026,
    status: "verified",
    label: "Österreich 2026",
    assumptions: ["Planungsrechnung; seltene lohnsteuerliche Sonderfälle bleiben manuell."],
    references: [
      { label: "BMF · Steuertarif 2026", url: "https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html" },
      { label: "Sozialversicherung · Beitragswerte 2026", url: "https://www.sozialversicherung.at/cdscontent/load?contentid=10008.803216" },
      { label: "WKO · DZ nach Bundesland", url: "https://www.wko.at/lohnverrechnung/zuschlag-dienstgeberbeitrag" },
    ],
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
    taxBrackets: [
      { upperCents: 1_353_900, ratePercent: 0 },
      { upperCents: 2_199_200, ratePercent: 20 },
      { upperCents: 3_645_800, ratePercent: 30 },
      { upperCents: 7_036_500, ratePercent: 40 },
      { upperCents: 10_485_900, ratePercent: 48 },
      { upperCents: 100_000_000, ratePercent: 50 },
      { upperCents: Number.POSITIVE_INFINITY, ratePercent: 55 },
    ],
    dzRates: DZ_RATES,
  },
  2027: {
    version: "AT-2027-FORECAST",
    year: 2027,
    status: "forecast",
    label: "Österreich 2027 · Prognose",
    assumptions: [
      "Verwendet bis zur fachlichen Freigabe die 2026er Beitrags- und Tarifwerte.",
      "Darf keine Buchungsübergabe erzeugen.",
    ],
    references: [
      { label: "Prognosebasis · BMF 2026", url: "https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html" },
      { label: "Prognosebasis · Sozialversicherung 2026", url: "https://www.sozialversicherung.at/cdscontent/load?contentid=10008.803216" },
    ],
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
    taxBrackets: [
      { upperCents: 1_353_900, ratePercent: 0 },
      { upperCents: 2_199_200, ratePercent: 20 },
      { upperCents: 3_645_800, ratePercent: 30 },
      { upperCents: 7_036_500, ratePercent: 40 },
      { upperCents: 10_485_900, ratePercent: 48 },
      { upperCents: 100_000_000, ratePercent: 50 },
      { upperCents: Number.POSITIVE_INFINITY, ratePercent: 55 },
    ],
    dzRates: DZ_RATES,
  },
};

export function getPayrollRuleSet(year: number): PayrollRuleSet {
  const rules = PAYROLL_RULE_SETS[year];
  if (!rules) throw new Error(`No payroll rule set for ${year}`);
  return rules;
}

export function defaultSpecialPayments(employmentType: PayrollEmploymentType) {
  return employmentType !== "freelance" && employmentType !== "shareholder_managing_director_gsvg";
}
