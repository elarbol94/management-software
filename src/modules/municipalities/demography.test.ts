import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MunicipalityIndex } from "./data";
import {
  ageGroupIndexForSourceCode,
  datasetDomain,
  symmetricDomain,
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

  it("derives all demographic indicators from the same representative values", () => {
    const counts = series.years["2013"].values["20622"];
    expect(demographicIndicatorValue(counts, "youth-share")).toBeCloseTo(121 / 796);
    expect(demographicIndicatorValue(counts, "senior-share")).toBeCloseTo(121 / 796);
    expect(demographicIndicatorValue(counts, "old-age-dependency")).toBeCloseTo((121 / 554) * 100);
    expect(demographicIndicatorValue(counts, "child-dependency")).toBeCloseTo((121 / 554) * 100);
    expect(demographicIndicatorValue(counts, "total-dependency")).toBeCloseTo((242 / 554) * 100);
    expect(demographicIndicatorValue(counts, "aging-index")).toBe(100);
    expect(demographicIndicatorValue(counts, "average-age")).toBeCloseTo((counts.a[0] + counts.a[1]) / 796);
    expect(demographicIndicatorValue(counts, "women-share")).toBeCloseTo(397 / 796);
    expect(demographicIndicatorValue(counts, "women-per-100-men")).toBeCloseTo((397 / 399) * 100);
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
    expect(aggregate.get("90001")?.a).toEqual([0, 0]);
    expect(() => aggregateDemography(`${header}\nA10-2025;C11-9;GRGEMAKT-10101;GALTEJ112-1;1`, 2025)).toThrow("Geschlechtscode");
  });
});

describe("datasetDomain", () => {
  it("starts at the dataset's own minimum instead of clipping the lowest values away", () => {
    const values = [5, ...Array.from({ length: 99 }, (_, index) => 100 + index)];

    expect(datasetDomain(values)[0]).toBe(5);
  });

  it("ends on the 95th percentile so outliers cannot flatten the rest", () => {
    const values = [...Array.from({ length: 99 }, (_, index) => index), 100_000];

    const [, maximum] = datasetDomain(values);
    expect(maximum).toBeLessThan(100);
    expect(values.filter((value) => value > maximum)).toHaveLength(5);
  });

  it("never collapses, so the map's interpolation cannot divide by zero", () => {
    for (const values of [[7, 7, 7], [0, 0], [-3]]) {
      const [minimum, maximum] = datasetDomain(values);
      expect(minimum).toBeLessThan(maximum);
    }
  });

  it("falls back to a usable domain for an empty dataset", () => {
    const [minimum, maximum] = datasetDomain([]);
    expect(minimum).toBeLessThan(maximum);
  });
});

describe("symmetricDomain", () => {
  it("stays centred on zero so equal colour means equal magnitude", () => {
    const [minimum, maximum] = symmetricDomain([-902, -36, -2, 0, 5, 81, 40]);

    expect(minimum).toBe(-maximum);
  });

  it("takes the percentile of the magnitudes, not of the signed values", () => {
    // A single deep outlier must not stretch both arms; that is what left the
    // Bevoelkerungsentwicklung map painted almost entirely in the neutral midpoint.
    const values = [-902, ...Array.from({ length: 99 }, (_, index) => index - 40)];

    expect(symmetricDomain(values)[1]).toBeLessThan(100);
  });

  it("never collapses on an all-zero dataset", () => {
    const [minimum, maximum] = symmetricDomain([0, 0, 0]);
    expect(minimum).toBeLessThan(maximum);
  });
});
