import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MunicipalityIndex } from "./data";
import {
  MUNICIPALITY_POPULATION_FIRST_YEAR,
  MUNICIPALITY_POPULATION_LATEST_YEAR,
  municipalityPopulationYears,
  validateMunicipalityPopulation,
  validateMunicipalityPopulationSeries,
  type MunicipalityPopulationSeries,
  type MunicipalityPopulationSnapshot,
} from "./population";

describe("generated municipality population assets", () => {
  const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
  const series = JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries;
  const latestSnapshot = JSON.parse(readFileSync(resolve("public/data/municipality-population-2025.json"), "utf8")) as MunicipalityPopulationSnapshot;
  const municipalityCodes = index.municipalities.map(({ municipalityCode }) => municipalityCode);

  it("contains a complete annual value for every current municipality", () => {
    expect(validateMunicipalityPopulationSeries(series, municipalityCodes)).toBe(series);
    expect(municipalityPopulationYears()).toEqual(Array.from({ length: 24 }, (_, index) => 2002 + index));
    expect(Object.keys(series.years)).toHaveLength(24);
    for (const year of municipalityPopulationYears()) {
      expect(Object.keys(series.years[String(year)].values)).toHaveLength(index.count);
    }
  });

  it("keeps representative official values across the full period", () => {
    expect(series.years["2002"].nationalTotal).toBe(8_063_640);
    expect(series.years["2015"].nationalTotal).toBe(8_584_926);
    expect(series.years["2025"].nationalTotal).toBe(9_197_213);
    expect(series.years["2002"].values["60101"]).toBe(232_930);
    expect(series.years["2015"].values["60101"]).toBe(274_207);
    expect(series.years["2025"].values["60101"]).toBe(305_314);
    expect(series.years["2002"].values["90001"]).toBe(1_571_123);
    expect(series.years["2025"].values["90001"]).toBe(2_028_289);
  });

  it("keeps the 2025 snapshot compatible with the latest series value", () => {
    expect(validateMunicipalityPopulation(latestSnapshot, municipalityCodes)).toBe(latestSnapshot);
    expect(latestSnapshot.values).toEqual(series.years[String(MUNICIPALITY_POPULATION_LATEST_YEAR)].values);
    expect(series.firstYear).toBe(MUNICIPALITY_POPULATION_FIRST_YEAR);
  });
});
