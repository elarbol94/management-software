import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MunicipalityIndex } from "./data";
import {
  ageGroupIndexForSourceCode,
  demographicIndicatorValue,
  demographyPopulation,
  validateMunicipalityDemographySeries,
  type MunicipalityDemographySeries,
} from "./demography";
import type { MunicipalityPopulationSeries } from "./population";
import { aggregateDemography } from "../../../scripts/update-municipality-demography";

describe("municipality demography", () => {
  const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
  const population = JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries;
  const series = JSON.parse(readFileSync(resolve("public/data/municipality-demography-2002-2025.json"), "utf8")) as MunicipalityDemographySeries;
  const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode);

  it("contains 24 complete years, two sexes and seven age groups for every municipality", () => {
    expect(validateMunicipalityDemographySeries(series, population, codes)).toBe(series);
    expect(Object.keys(series.years)).toHaveLength(24);
    expect(Object.keys(series.years["2025"].values)).toHaveLength(2_092);
    expect(series.years["2025"].values["10101"].m).toHaveLength(7);
    expect(series.years["2025"].values["10101"].f).toHaveLength(7);
  });

  it("matches the representative Mörtschach 2013 values", () => {
    const counts = series.years["2013"].values["20622"];
    expect(counts.m.map((value, index) => value + counts.f[index])).toEqual([40, 81, 128, 195, 231, 87, 34]);
    expect(demographyPopulation(counts, "all")).toBe(796);
  });

  it("derives the four indicators from the same representative values", () => {
    const counts = series.years["2013"].values["20622"];
    expect(demographicIndicatorValue(counts, "youth-share")).toBeCloseTo(121 / 796);
    expect(demographicIndicatorValue(counts, "senior-share")).toBeCloseTo(121 / 796);
    expect(demographicIndicatorValue(counts, "old-age-dependency")).toBeCloseTo((121 / 554) * 100);
    expect(demographicIndicatorValue(counts, "aging-index")).toBe(100);
  });

  it("maps single ages and the 100+ special class", () => {
    expect(ageGroupIndexForSourceCode("GALTEJ112-1")).toBe(0);
    expect(ageGroupIndexForSourceCode("GALTEJ112-100")).toBe(6);
    expect(ageGroupIndexForSourceCode("GALT5J100-21")).toBe(6);
    expect(() => ageGroupIndexForSourceCode("UNKNOWN-1")).toThrow("Unbekannter Alterscode");
  });

  it("aggregates Vienna districts and rejects unknown sex codes", () => {
    const header = "C-A10-0;C-C11-0;C-GRGEMAKT-0;C-GALTEJ112-0;F-ISIS-1";
    const aggregate = aggregateDemography(`${header}\nA10-2025;C11-1;GRGEMAKT-90101;GALTEJ112-1;2\nA10-2025;C11-2;GRGEMAKT-90201;GALTEJ112-1;3`, 2025);
    expect(aggregate.get("90001")?.m[0]).toBe(2);
    expect(aggregate.get("90001")?.f[0]).toBe(3);
    expect(() => aggregateDemography(`${header}\nA10-2025;C11-9;GRGEMAKT-10101;GALTEJ112-1;1`, 2025)).toThrow("Geschlechtscode");
  });
});
