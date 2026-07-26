import { describe, expect, it } from "vitest";
import {
  allocatePlannedProjectCosts,
  applyFundingProfile,
  austrianPublicHolidays,
  calculateAnnualPersonnelCost,
  calculatePayroll,
  calculateProductiveHours,
  solveGrossForNet,
  type EmploymentContractPeriod,
} from "./engine";

const graz = { state: "Steiermark", municipality: "Graz" };
const contract: EmploymentContractPeriod = {
  validFrom: "2026-01-01",
  employmentType: "employee",
  inputMode: "gross",
  monthlyAmountCents: 450_000,
  weeklyMinutes: 2_400,
  workdaysPerWeek: 5,
  specialPaymentsEnabled: true,
  holidayPayMonth: 6,
  christmasPayMonth: 11,
  vacationWeeksHundredths: 500,
  expectedSickHoursHundredths: 0,
  trainingHoursHundredths: 0,
  internalHoursHundredths: 0,
  overheadRateBasisPoints: 1_500,
  salesMarkupBasisPoints: 2_000,
};

describe("personnel engine", () => {
  it("calculates verified and forecast rule sets with a posting status", () => {
    const current = calculatePayroll({ year: 2026, payrollMonth: "2026-07", grossCents: 270_000, employmentType: "employee", location: graz });
    const forecast = calculatePayroll({ year: 2027, payrollMonth: "2027-07", grossCents: 270_000, employmentType: "employee", location: graz });
    expect(current.ruleVersion).toBe("AT-2026");
    expect(current.ruleStatus).toBe("verified");
    expect(forecast.ruleStatus).toBe("forecast");
    expect(forecast.warnings).toContain("forecast_rules");
  });

  it("splits employer social insurance and preserves the aggregate", () => {
    const result = calculatePayroll({ year: 2026, payrollMonth: "2026-07", grossCents: 270_000, employmentType: "employee", location: graz });
    const split = ["employerHealth", "employerPension", "employerUnemployment", "employerAccident", "employerIesg", "employerHousing", "employerOtherSocial"]
      .reduce((sum, key) => sum + result.components[key as keyof typeof result.components].amountCents, 0);
    expect(split).toBe(result.employerSocialCents);
    expect(result.employerSocialCents).toBe(56_646);
  });

  it("round-trips common gross/net cases to the smallest satisfying gross", () => {
    const expected = calculatePayroll({ year: 2026, payrollMonth: "2026-07", grossCents: 450_000, employmentType: "employee", location: graz, familyBonusCents: 16_668 });
    const solved = solveGrossForNet({ year: 2026, payrollMonth: "2026-07", targetNetCents: expected.netCents, employmentType: "employee", location: graz, familyBonusCents: 16_668 });
    expect(solved.grossCents).toBe(450_000);
    expect(solved.deltaCents).toBe(0);
  });

  it("builds fourteen planned payments without double-counting leave", () => {
    const result = calculateAnnualPersonnelCost({ year: 2026, contract, location: graz });
    expect(result.months.filter((row) => row.specialPaymentCents > 0).map((row) => row.month)).toEqual([6, 11]);
    expect(result.annualGrossCents).toBe(6_300_000);
    expect(result.annualEmployerCostCents).toBeGreaterThan(result.annualGrossCents);
    expect(result.productiveHoursHundredths).toBeLessThan(calculateProductiveHours({ ...contract, vacationWeeksHundredths: 0 }, 2026).productiveHoursHundredths);
    expect(result.fullHourlyRateCents).toBeGreaterThan(result.directHourlyRateCents);
    expect(result.salesHourlyRateCents).toBeGreaterThan(result.fullHourlyRateCents);
  });

  it("uses Austrian public holidays in capacity", () => {
    const holidays = austrianPublicHolidays(2026);
    expect(holidays.has("2026-01-01")).toBe(true);
    expect(holidays.size).toBe(13);
  });

  it("detects project overbooking and calculates project cost", () => {
    const result = allocatePlannedProjectCosts([
      { projectId: "a", plannedMinutes: 6_000, costRateCents: 5_000 },
      { projectId: "b", plannedMinutes: 4_000, costRateCents: 5_000 },
    ], 9_000);
    expect(result.overbooked).toBe(true);
    expect(result.remainingMinutes).toBe(-1_000);
    expect(result.rows[0].plannedCostCents).toBe(500_000);
  });

  it("applies eligible components, caps, maximum hours, overhead, and rounding", () => {
    const result = applyFundingProfile({
      annualEmployerCostCents: 10_000_000,
      componentTotals: { gross: 6_000_000, employerSocial: 2_000_000, excluded: 2_000_000 },
      productiveHoursHundredths: 160_000,
      plannedHoursHundredths: 180_000,
      profile: {
        divisorMode: "fixed",
        fixedAnnualDivisor: 1_600,
        eligibleComponents: ["gross", "employerSocial"],
        hourlyCapCents: 4_000,
        maxAnnualHoursHundredths: 172_000,
        overheadRateBasisPoints: 2_500,
        roundingMode: "euro",
      },
    });
    expect(result.eligibleHourlyRateCents).toBe(4_000);
    expect(result.eligibleHoursHundredths).toBe(172_000);
    expect(result.personnelCostCents).toBe(6_880_000);
    expect(result.overheadCents).toBe(1_720_000);
  });
});
