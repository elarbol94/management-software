import type { CategoryTemplate } from "../schema";

export type EntryBaseField =
  | "paymentDate"
  | "documentDate"
  | "documentNumber"
  | "paymentMethod"
  | "description"
  | "counterparty"
  | "servicePeriod";

export type EntryAmountMode = "vat" | "gross" | "personnel";
export type EntryDeductibilityMode = "general" | "vehicleBusinessUse" | "none";

export type EntryFormConfig = {
  baseFields: readonly EntryBaseField[];
  amountMode: EntryAmountMode;
  deductibility: EntryDeductibilityMode;
};

const paymentCore = ["paymentDate", "paymentMethod", "description"] as const;
const invoiceCore = [
  "paymentDate",
  "documentDate",
  "documentNumber",
  "paymentMethod",
  "description",
  "counterparty",
] as const;

/**
 * The booking dialog is deliberately driven by this matrix. A template only
 * receives fields that describe or calculate that booking case.
 */
export const ENTRY_FORM_CONFIG = {
  standard_income: {
    baseFields: [...invoiceCore, "servicePeriod"],
    amountMode: "vat",
    deductibility: "none",
  },
  grant_income: {
    baseFields: [...paymentCore, "counterparty"],
    amountMode: "gross",
    deductibility: "none",
  },
  standard_expense: {
    baseFields: [...invoiceCore, "servicePeriod"],
    amountMode: "vat",
    deductibility: "general",
  },
  hospitality: {
    baseFields: invoiceCore,
    amountMode: "vat",
    deductibility: "general",
  },
  travel: {
    baseFields: paymentCore,
    amountMode: "vat",
    deductibility: "general",
  },
  vehicle: {
    baseFields: invoiceCore,
    amountMode: "vat",
    deductibility: "vehicleBusinessUse",
  },
  asset: {
    baseFields: invoiceCore,
    amountMode: "vat",
    deductibility: "general",
  },
  personnel: {
    baseFields: paymentCore,
    amountMode: "personnel",
    deductibility: "none",
  },
  svs: {
    baseFields: ["paymentDate", "documentNumber", "paymentMethod", "description"],
    amountMode: "gross",
    deductibility: "none",
  },
  tax_levy: {
    baseFields: ["paymentDate", "documentNumber", "paymentMethod", "description"],
    amountMode: "gross",
    deductibility: "general",
  },
} satisfies Record<CategoryTemplate, EntryFormConfig>;
