import { describe, expect, it } from "vitest";
import {
  allocatePayrollLevyBases,
  calculatePayrollAt2026,
  calculatePayrollLevyBasis,
  type PayrollEmploymentType,
} from "./payroll-at-2026";

const graz = { state: "Steiermark", municipality: "Graz" };

function calculate(grossCents: number, employmentType: PayrollEmploymentType = "employee") {
  return calculatePayrollAt2026({
    grossCents,
    employmentType,
    payrollMonth: "2026-07",
    location: graz,
  });
}

describe("calculatePayrollAt2026", () => {
  it("matches the Graz ASVG reference case", () => {
    const result = calculate(270_000);
    expect(result.components.employeeSv.amountCents).toBe(48_789);
    expect(result.components.wageTax.amountCents).toBe(21_008);
    expect(result.netCents).toBe(200_203);
    expect(result.components.employerSv.amountCents).toBe(56_646);
    expect(result.components.bvContribution.amountCents).toBe(4_131);
    expect(result.components.db.amountCents).toBe(9_990);
    expect(result.components.dz.amountCents).toBe(918);
    expect(result.components.municipalTax.amountCents).toBe(8_100);
    expect(result.employerTotalCents).toBe(349_785);
  });

  it.each([
    [222_500, 1_512],
    [222_501, 1_612],
    [242_700, 1_612],
    [242_701, 1_712],
    [263_000, 1_712],
    [263_001, 1_807],
  ])("applies the employee SV tier at %i cents", (grossCents, rate) => {
    expect(calculate(grossCents).components.employeeSv.rateBasisPoints).toBe(rate);
  });

  it.each([
    [222_500, 1_192],
    [222_501, 1_292],
    [242_700, 1_292],
    [242_701, 1_307],
  ])("applies the apprentice SV tier at %i cents", (grossCents, rate) => {
    expect(calculate(grossCents, "apprentice").components.employeeSv.rateBasisPoints).toBe(rate);
  });

  it("caps regular social insurance but not occupational provision", () => {
    const result = calculate(900_000);
    expect(result.components.employeeSv.basisCents).toBe(693_000);
    expect(result.components.employerSv.basisCents).toBe(693_000);
    expect(result.components.bvContribution.basisCents).toBe(900_000);
  });

  it("uses the higher Vienna WBF shares and Vienna employer levy", () => {
    const result = calculatePayrollAt2026({
      grossCents: 270_000,
      employmentType: "employee",
      payrollMonth: "2026-03",
      location: { state: "Wien", municipality: "Wien" },
    });
    expect(result.components.employeeSv.rateBasisPoints).toBe(1_832);
    expect(result.components.employerSv.rateBasisPoints).toBe(2_123);
    expect(result.components.dz.rateBasisPoints).toBe(36);
    expect(result.components.viennaLevy.amountCents).toBe(1_200);
  });

  it("handles marginal employment above and below the company-wide threshold", () => {
    expect(calculatePayrollAt2026({ grossCents: 50_000, employmentType: "marginal", payrollMonth: "2026-01", location: graz, monthlyMarginalPayrollTotalCents: 80_000 }).components.employerSv.rateBasisPoints).toBe(110);
    expect(calculatePayrollAt2026({ grossCents: 50_000, employmentType: "marginal", payrollMonth: "2026-01", location: graz, monthlyMarginalPayrollTotalCents: 90_000 }).components.employerSv.rateBasisPoints).toBe(2_050);
  });

  it("keeps freelance payroll tax and GSVG social insurance outside automation", () => {
    const freelance = calculate(300_000, "freelance");
    expect(freelance.components.employeeSv.rateBasisPoints).toBe(1_757);
    expect(freelance.components.employerSv.rateBasisPoints).toBe(2_048);
    expect(freelance.components.wageTax.amountCents).toBe(0);
    const gsvg = calculate(300_000, "shareholder_managing_director_gsvg");
    expect(gsvg.components.employeeSv.amountCents).toBe(0);
    expect(gsvg.components.employerSv.amountCents).toBe(0);
    expect(gsvg.components.bvContribution.amountCents).toBe(0);
    expect(gsvg.components.db.amountCents).toBeGreaterThan(0);
  });

  it.each([
    [222_500, 1_462],
    [222_501, 1_562],
    [242_701, 1_662],
    [263_001, 1_757],
  ])("reduces freelance employee unemployment insurance at %i cents", (grossCents, rate) => {
    expect(calculate(grossCents, "freelance").components.employeeSv.rateBasisPoints).toBe(rate);
  });

  it("applies and deterministically allocates the shared payroll allowance", () => {
    expect(calculatePayrollLevyBasis(146_000)).toBe(36_500);
    expect(calculatePayrollLevyBasis(146_001)).toBe(146_001);
    const allocation = allocatePayrollLevyBases([
      { id: "b", grossCents: 55_000 },
      { id: "a", grossCents: 55_000 },
    ], 110_000);
    expect([...allocation.entries()].sort()).toEqual([["a", 250], ["b", 250]]);
  });

  it("warns and does not silently apply 2026 rules to another year", () => {
    expect(calculatePayrollAt2026({ grossCents: 270_000, employmentType: "employee", payrollMonth: "2027-01", location: graz }).warnings).toContain("unsupported_year");
  });
});
