import { describe, expect, it } from "vitest";
import { chartDomain, chartTicks, domainCrossesZero } from "./municipality-metric-chart";

describe("chartDomain", () => {
  it("keeps small percentage changes legible without a fixed one-point padding", () => {
    const domain = chartDomain([0.0187, 0.024, 0.0593]);

    expect(domain.minimum).toBeCloseTo(0.0138, 4);
    expect(domain.maximum).toBeCloseTo(0.0642, 4);
  });

  it("adds proportional space around a flat low-valued series", () => {
    const domain = chartDomain([0.024, 0.024]);

    expect(domain.minimum).toBeCloseTo(0.02304, 5);
    expect(domain.maximum).toBeCloseTo(0.02496, 5);
  });

  it("identifies domains that need a zero reference line", () => {
    expect(domainCrossesZero(chartDomain([-0.04, 0.08]))).toBe(true);
    expect(domainCrossesZero(chartDomain([0.01, 0.08]))).toBe(false);
  });
});

describe("chartTicks", () => {
  it("labels population axes with round numbers instead of the padded bounds", () => {
    expect(chartTicks(chartDomain([232828, 305314]))).toEqual([300000, 275000, 250000, 225000]);
  });

  it("stays inside the padded domain", () => {
    const domain = chartDomain([232828, 305314]);

    for (const tick of chartTicks(domain)) {
      expect(tick).toBeGreaterThanOrEqual(domain.minimum);
      expect(tick).toBeLessThanOrEqual(domain.maximum);
    }
  });

  it("scales down to share values", () => {
    expect(chartTicks(chartDomain([0.0187, 0.024, 0.0593]))).toEqual([0.06, 0.04, 0.02]);
  });

  it("falls back to a single midpoint tick for a flat series", () => {
    expect(chartTicks({ minimum: 5, maximum: 5 })).toEqual([5]);
  });
});
