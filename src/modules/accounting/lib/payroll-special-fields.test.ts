import { describe, expect, it } from "vitest";
import { calculatePayrollAt2026 } from "./payroll-at-2026";
import { payrollResultToSpecialFields, validatePayrollMode } from "./payroll-special-fields";

describe("payroll server field policy", () => {
  it("replaces client-provided automatic amounts with calculated values", () => {
    const submitted = {
      calculationMode: "auto",
      payrollMonth: "2026-07",
      employeeSv: "0.01",
      wageTax: "0.01",
      employerTotal: "0.01",
    };
    const result = calculatePayrollAt2026({
      grossCents: 270_000,
      employmentType: "employee",
      payrollMonth: "2026-07",
      location: { state: "Steiermark", municipality: "Graz" },
    });
    const persisted = payrollResultToSpecialFields(submitted, result);
    expect(persisted.employeeSv).toBe("487.89");
    expect(persisted.wageTax).toBe("210.08");
    expect(persisted.employerTotal).toBe("3497.85");
  });

  it("accepts manual values only with a reason", () => {
    expect(() => validatePayrollMode({ calculationMode: "manual", overrideReason: "" })).toThrow(/reason/);
    expect(validatePayrollMode({ calculationMode: "manual", overrideReason: "Abrechnung laut Steuerberatung" })).toBe("manual");
  });

  it("requires manual mode outside 2026", () => {
    expect(() => validatePayrollMode({ calculationMode: "auto", payrollMonth: "2027-01" })).toThrow(/2026/);
  });
});
