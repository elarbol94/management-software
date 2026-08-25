import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateMunicipalityIndex, type MunicipalityIndex } from "./data";
import {
  digitalPlatformCostEstimate,
  digitalPlatformMetricValue,
  digitalPlatformProviderClassification,
  DIGITAL_PLATFORM_PROVIDER_CODES,
  validateMunicipalityDigitalPlatformDataset,
  type MunicipalityDigitalPlatform,
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

  const citizenApp = (
    id: string,
    name: string,
    provider: string | null = null,
    status: MunicipalityDigitalPlatform["status"] = "active",
  ) => ({
    id,
    name,
    provider,
    kind: "citizen-app",
    status,
  }) as MunicipalityDigitalPlatform;
  const profile = (
    platforms: MunicipalityDigitalPlatform[],
    researchStatus: MunicipalityDigitalPlatformProfile["researchStatus"] = "complete",
  ) => ({ researchStatus, platforms }) as MunicipalityDigitalPlatformProfile;

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

  it.each([
    ["GEM2GO", null, "gem2go"],
    ["Gemeinde News", "RiS GmbH / GEM2GO Partnernetzwerk", "gem2go"],
    ["CITIES", null, "cities"],
    ["Gemeinde News", "citiesapps S&R GmbH", "cities"],
    ["Gemeinde24", null, "gemeinde24"],
    ["GemeindeApp", "gemeindeapp.at", "gemeindeapp"],
    ["Daheim App", null, "daheim-app"],
    ["Zeillern App", null, "local-app"],
  ] as const)("normalizes %s (%s) to %s", (name, provider, expected) => {
    expect(
      digitalPlatformProviderClassification(profile([citizenApp("1", name, provider)])),
    ).toEqual({ category: expected, providers: [expected] });
  });

  it("deduplicates repeated evidence for the same provider family", () => {
    expect(
      digitalPlatformProviderClassification(profile([
        citizenApp("1", "GEM2GO"),
        citizenApp("2", "Gemeinde-App", "GEM2GO"),
      ])),
    ).toEqual({ category: "gem2go", providers: ["gem2go"] });
  });

  it("uses a dedicated category for municipalities with multiple app families", () => {
    const classified = digitalPlatformProviderClassification(profile([
      citizenApp("1", "GEM2GO"),
      citizenApp("2", "CITIES"),
    ]));
    expect(classified).toEqual({
      category: "multiple",
      providers: ["gem2go", "cities"],
    });
    expect(digitalPlatformMetricValue(profile([
      citizenApp("1", "GEM2GO"),
      citizenApp("2", "CITIES"),
    ]), "providers")).toBe(DIGITAL_PLATFORM_PROVIDER_CODES.multiple);
  });

  it("ignores inactive apps and distinguishes confirmed absence from incomplete research", () => {
    const inactive = [citizenApp("1", "GEM2GO", null, "unclear")];
    expect(digitalPlatformProviderClassification(profile(inactive))).toEqual({
      category: "none",
      providers: [],
    });
    expect(digitalPlatformProviderClassification(profile(inactive, "partial"))).toBeNull();
    expect(digitalPlatformMetricValue(profile(inactive), "providers")).toBe(
      DIGITAL_PLATFORM_PROVIDER_CODES.none,
    );
    expect(digitalPlatformMetricValue(profile(inactive, "partial"), "providers")).toBeNull();
  });

  it("estimates annual and setup corridors by provider and municipality size", () => {
    expect(digitalPlatformCostEstimate(profile([citizenApp("1", "GEM2GO")]), 1_500)).toMatchObject({
      annualEuros: [2_000, 3_500],
      setupEuros: [4_000, 6_500],
      confidence: "medium",
    });
    expect(digitalPlatformCostEstimate(profile([citizenApp("1", "CITIES")]), 25_000)).toMatchObject({
      annualEuros: [5_000, 12_000],
      setupEuros: [0, 10_800],
    });
  });

  it("deduplicates cost families and adds genuinely different active apps", () => {
    const duplicatedGem2go = digitalPlatformCostEstimate(profile([
      citizenApp("1", "GEM2GO"),
      citizenApp("2", "Gemeinde-App", "GEM2GO"),
    ]), 3_000);
    expect(duplicatedGem2go?.annualEuros).toEqual([2_500, 5_000]);

    const multiple = digitalPlatformCostEstimate(profile([
      citizenApp("1", "GEM2GO"),
      citizenApp("2", "CITIES"),
    ]), 3_000);
    expect(multiple?.annualEuros).toEqual([5_500, 12_000]);
    expect(multiple?.setupEuros).toEqual([5_000, 16_000]);
  });

  it("shows zero only for completed research without an active comparable app", () => {
    expect(digitalPlatformCostEstimate(profile([]), 1_500)?.annualEuros).toEqual([0, 0]);
    expect(digitalPlatformCostEstimate(profile([], "partial"), 1_500)).toBeNull();
    expect(digitalPlatformCostEstimate(profile([citizenApp("1", "GEM2GO", null, "unclear")]), 1_500)?.annualEuros).toEqual([0, 0]);
  });

  it("produces a corridor for every municipality with a conclusive app finding", () => {
    const population = readJson<{ years: Record<string, { values: Record<string, number> }> }>(
      "public/data/municipality-population-2002-2025.json",
    ).years["2025"].values;
    const estimates = Object.entries(dataset.municipalities).map(([code, municipality]) =>
      digitalPlatformCostEstimate(municipality, population[code]),
    );

    expect(estimates.filter(Boolean)).toHaveLength(2_062);
    expect(estimates.filter((estimate) => estimate === null)).toHaveLength(30);
    expect(Object.entries(dataset.municipalities).every(([code, municipality]) =>
      municipality.researchStatus === "partial" || digitalPlatformCostEstimate(municipality, population[code]) !== null,
    )).toBe(true);
  });
});
