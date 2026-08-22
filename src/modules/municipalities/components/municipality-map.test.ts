import { describe, expect, it } from "vitest";
import { divergingColorStops, metricColorExpression } from "./municipality-map";
import { MUNICIPALITY_DIVERGING_COLORS, MUNICIPALITY_DIVERGING_STOPS } from "../palette";

describe("divergingColorStops", () => {
  it("returns stops in the ascending order MapLibre's interpolate requires", () => {
    const values = divergingColorStops(89).map(({ value }) => value);

    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  it("keeps the neutral colour on zero and the poles on the domain edges", () => {
    const stops = divergingColorStops(89);
    const middle = (MUNICIPALITY_DIVERGING_COLORS.length - 1) / 2;

    expect(stops.at(0)).toMatchObject({ value: -89, color: MUNICIPALITY_DIVERGING_COLORS[0] });
    expect(stops.at(-1)).toMatchObject({ value: 89, color: MUNICIPALITY_DIVERGING_COLORS.at(-1) });
    expect(stops.find(({ value }) => value === 0)?.color).toBe(MUNICIPALITY_DIVERGING_COLORS[middle]);
  });

  it("spends colour where the values are instead of spacing stops evenly", () => {
    const stops = divergingColorStops(1).filter(({ value }) => value > 0);

    // The inner half of the domain holds ~85 % of all municipality-years, so three of
    // the four positive stops sit inside it; even spacing would have given it one.
    expect(stops.filter(({ value }) => value <= 0.5)).toHaveLength(3);
    expect(stops.map(({ value }) => value)).toEqual([...MUNICIPALITY_DIVERGING_STOPS]);
  });

  it("maps every stop to a gradient offset between the ends", () => {
    for (const { offset } of divergingColorStops(89)) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(1);
    }
    expect(divergingColorStops(89).find(({ value }) => value === 0)?.offset).toBe(0.5);
  });
});

describe("metricColorExpression", () => {
  const base = {
    usePopulationClasses: false,
    scaleDomain: [-89, 89] as [number, number],
    metric: "movement" as const,
    movementPalette: "diverging" as const,
    costMeasure: "share" as const,
  };
  // A "step" expression is the population class ramp; "case" wraps the continuous ones.
  const kind = (expression: unknown) => (expression as unknown[])[0];

  it("keeps the population ramp for the population views", () => {
    expect(kind(metricColorExpression({ ...base, usePopulationClasses: true }))).toBe("step");
  });

  it("falls back to the population ramp only while a scale is still missing", () => {
    expect(kind(metricColorExpression({ ...base, scaleDomain: null }))).toBe("step");
  });

  it("never paints another metric with population class breaks once its scale is known", () => {
    for (const inputs of [
      base,
      { ...base, movementPalette: "sequential" as const },
      { ...base, metric: "costs" as const, scaleDomain: [0, 1600] as [number, number] },
      { ...base, metric: "costs" as const, costMeasure: "peer-deviation" as const },
      { ...base, metric: "age" as const, scaleDomain: [0.12, 0.26] as [number, number] },
    ]) {
      expect(kind(metricColorExpression(inputs))).toBe("case");
    }
  });

  it("uses the diverging stops only where the metric has a sign", () => {
    const diverging = metricColorExpression(base) as unknown[];
    const sequential = metricColorExpression({ ...base, movementPalette: "sequential" }) as unknown[];
    const stopCount = (expression: unknown[]) => ((expression[2] as unknown[]).length - 3) / 2;

    expect(stopCount(diverging)).toBe(divergingColorStops(89).length);
    expect(stopCount(sequential)).toBe(6);
  });
});
