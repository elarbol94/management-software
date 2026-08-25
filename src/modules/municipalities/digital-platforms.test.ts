import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateMunicipalityIndex, type MunicipalityIndex } from "./data";
import {
  digitalPlatformMetricValue,
  validateMunicipalityDigitalPlatformDataset,
  type MunicipalityDigitalPlatformDataset,
  type MunicipalityDigitalPlatformProfile,
} from "./digital-platforms";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

describe("municipality digital platforms", () => {
  const index = readJson<MunicipalityIndex>("public/data/municipalities-at-2026.index.json");
  const codes = validateMunicipalityIndex(index).municipalities.map(({ municipalityCode }) => municipalityCode);
  const dataset = readJson<MunicipalityDigitalPlatformDataset>("public/data/municipality-digital-platforms.json");

  it("validates complete coverage and source references", () => {
    expect(validateMunicipalityDigitalPlatformDataset(dataset, codes)).toBe(dataset);
    expect(Object.keys(dataset.municipalities)).toHaveLength(2_092);
    expect(Object.values(dataset.municipalities).every(({ researchStatus }) => researchStatus === "complete" || researchStatus === "partial")).toBe(true);
  });

  it("counts distinct areas in the overview and concrete services in focused views", () => {
    const profile = {
      researchStatus: "complete",
      platforms: [
        { id: "1", kind: "citizen-app", status: "active" },
        { id: "2", kind: "citizen-app", status: "active" },
        { id: "3", kind: "service-portal", status: "active" },
        { id: "4", kind: "official-website", status: "active" },
      ],
    } as MunicipalityDigitalPlatformProfile;
    expect(digitalPlatformMetricValue(profile, "overview")).toBe(2);
    expect(digitalPlatformMetricValue(profile, "citizen-app")).toBe(2);
    expect(digitalPlatformMetricValue(profile, "open-data")).toBe(0);
  });

  it("does not present an incomplete zero result as a confirmed absence", () => {
    const profile = { researchStatus: "partial", platforms: [] } as unknown as MunicipalityDigitalPlatformProfile;
    expect(digitalPlatformMetricValue(profile, "overview")).toBeNull();
  });
});
