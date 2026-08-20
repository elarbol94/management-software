import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MunicipalityIndex } from "./data";
import {
  MUNICIPALITY_POPULATION_REFERENCE_DATE,
  validateMunicipalityPopulation,
  type MunicipalityPopulationSnapshot,
} from "./population";

describe("generated municipality population asset", () => {
  const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
  const snapshot = JSON.parse(readFileSync(resolve("public/data/municipality-population-2025.json"), "utf8")) as MunicipalityPopulationSnapshot;
  const municipalityCodes = index.municipalities.map(({ municipalityCode }) => municipalityCode);

  it("contains one valid population value for every current municipality", () => {
    expect(validateMunicipalityPopulation(snapshot, municipalityCodes)).toBe(snapshot);
    expect(snapshot.referenceDate).toBe(MUNICIPALITY_POPULATION_REFERENCE_DATE);
    expect(Object.keys(snapshot.values)).toHaveLength(index.count);
    expect(snapshot.nationalTotal).toBe(9_197_213);
  });

  it("contains representative official 2025 values and aggregated Vienna", () => {
    expect(snapshot.values["10101"]).toBe(16_118);
    expect(snapshot.values["60101"]).toBe(305_314);
    expect(snapshot.values["90001"]).toBe(2_028_289);
  });
});
