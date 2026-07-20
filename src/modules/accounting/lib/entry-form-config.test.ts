import { describe, expect, it } from "vitest";
import { categoryTemplates } from "../schema";
import { ENTRY_FORM_CONFIG } from "./entry-form-config";

describe("ENTRY_FORM_CONFIG", () => {
  it("defines a field set for every booking template", () => {
    expect(Object.keys(ENTRY_FORM_CONFIG).sort()).toEqual([...categoryTemplates].sort());
  });

  it("does not expose VAT inputs for tax-free booking templates", () => {
    for (const template of ["grant_income", "personnel", "svs", "tax_levy"] as const) {
      expect(ENTRY_FORM_CONFIG[template].amountMode).not.toBe("vat");
    }
  });

  it("uses travel dates instead of duplicate document and service dates", () => {
    expect(ENTRY_FORM_CONFIG.travel.baseFields).not.toContain("documentDate");
    expect(ENTRY_FORM_CONFIG.travel.baseFields).not.toContain("servicePeriod");
  });

  it("uses the vehicle business share instead of a duplicate deduction field", () => {
    expect(ENTRY_FORM_CONFIG.vehicle.deductibility).toBe("vehicleBusinessUse");
  });
});
