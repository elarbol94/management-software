import { describe, expect, it } from "vitest";
import {
  calculateBudgetItemTotal,
  calculateFinancing,
  calculateMaximumGrant,
  calculateWarningCodes,
} from "./calculations";

describe("funding calculations", () => {
  it("calculates quantity-based budget totals without floating-point money", () => {
    expect(calculateBudgetItemTotal(12_500, 8_000)).toBe(100_000);
    expect(calculateBudgetItemTotal(333, 1_000)).toBe(333);
  });

  it("derives required own funds and the financing gap deterministically", () => {
    expect(
      calculateFinancing(1_000_000, [
        { sourceType: "requested_grant", amountCents: 400_000 },
        { sourceType: "other_public", amountCents: 100_000 },
        { sourceType: "bank", amountCents: 350_000 },
      ]),
    ).toEqual({
      requestedGrantCents: 400_000,
      otherPublicSupportCents: 100_000,
      requiredOwnFundsCents: 500_000,
      financingTotalCents: 850_000,
      financingGapCents: 150_000,
    });
  });

  it("applies rate and optional cap without encoding programme limits", () => {
    expect(calculateMaximumGrant(1_000_000, 4_500, null)).toBe(450_000);
    expect(calculateMaximumGrant(1_000_000, 4_500, 300_000)).toBe(300_000);
  });

  it("emits the required control warnings", () => {
    expect(
      calculateWarningCodes({
        projectStart: "2026-02-01",
        projectEnd: "2026-08-20",
        projectStatus: "active",
        financingGapCents: 100,
        budgetActuals: [{ plannedCents: 1_000, actualCents: 1_200 }],
        bookings: [
          { bookingDate: "2026-01-20", evidenceStatus: "partial" },
        ],
        today: "2026-07-19",
      }),
    ).toEqual([
      "cost_before_start",
      "plan_overrun",
      "missing_evidence",
      "financing_gap",
      "project_end_near",
    ]);
  });
});
