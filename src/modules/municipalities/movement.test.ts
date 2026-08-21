import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateMovementComponent } from "../../../scripts/update-municipality-movement";
import type { MunicipalityIndex } from "./data";
import {
  movementMetricValue,
  movementStatisticalCorrection,
  validateMunicipalityMovementSeries,
  type MunicipalityMovementSeries,
} from "./movement";
import type { MunicipalityPopulationSeries } from "./population";

describe("municipality population movement", () => {
  const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
  const population = JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries;
  const series = JSON.parse(readFileSync(resolve("public/data/municipality-movement-2002-2025.json"), "utf8")) as MunicipalityMovementSeries;
  const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode);

  it("contains all 24 years and every municipality", () => {
    expect(validateMunicipalityMovementSeries(series, population, codes)).toBe(series);
    expect(Object.keys(series.years)).toHaveLength(24);
    expect(Object.keys(series.years["2025"].values)).toHaveLength(2_092);
  });

  it("matches the representative Mörtschach 2013 values", () => {
    expect(series.years["2013"].values["20622"]).toEqual([2, 8, 6, 23, 23]);
  });

  it("derives balances per 1,000 and the statistical correction", () => {
    const counts: [number, number, number, number, number] = [12, 20, 14, 80, 75];
    expect(movementMetricValue(counts, 1_000, "birth-balance-rate")).toBe(6);
    expect(movementMetricValue(counts, 1_000, "migration-balance-rate")).toBe(5);
    expect(movementStatisticalCorrection(counts)).toBe(1);
  });

  it("aggregates Vienna districts and rejects invalid values", () => {
    const source = (summe: number) => JSON.stringify({ features: [
      { properties: { geo_id: 90101, name: "Wien 1", summe, bev: 10 } },
      { properties: { geo_id: 90201, name: "Wien 2", summe: 3, bev: 20 } },
    ] });
    expect(aggregateMovementComponent(source(2), 2025, "lebendgeborene").get("90001")).toEqual({ value: 5, population: 30 });
    expect(() => aggregateMovementComponent(source(-2), 2025, "lebendgeborene")).toThrow("Ungültiger Wert");
  });
});
