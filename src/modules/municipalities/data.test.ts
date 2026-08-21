import { readFileSync } from "node:fs";
import { aggregateStructure } from "../../../scripts/update-municipality-structure";
import { resolve } from "node:path";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_MUNICIPALITY_COUNT,
  geometryBounds,
  municipalityStateFromCode,
  normalizeMunicipalitySearch,
  searchMunicipalities,
  validateMunicipalityIndex,
  type MunicipalityIndex,
  type MunicipalityIndexItem,
  type MunicipalityProperties,
} from "./data";
import type { MunicipalityPopulationSeries } from "./population";
import { populationViewValue, validateMunicipalityStructureSeries, type MunicipalityStructureSeries } from "./structure";

const sampleMunicipalities: MunicipalityIndexItem[] = [
  { municipalityCode: "30201", name: "St. Pölten", state: "Niederösterreich", areaSquareKilometers: 108.4, bounds: [15.5, 48.1, 15.8, 48.3] },
  { municipalityCode: "40601", name: "Leonding", state: "Oberösterreich", areaSquareKilometers: 24.1, bounds: [14.2, 48.2, 14.3, 48.3] },
  { municipalityCode: "60101", name: "Graz", state: "Steiermark", areaSquareKilometers: 127.6, bounds: [15.3, 47, 15.6, 47.2] },
];

describe("municipality data helpers", () => {
  it("maps every Austrian code prefix to its state", () => {
    expect(municipalityStateFromCode("10101")).toBe("Burgenland");
    expect(municipalityStateFromCode("60101")).toBe("Steiermark");
    expect(municipalityStateFromCode("90001")).toBe("Wien");
    expect(() => municipalityStateFromCode("00000")).toThrow("Ungültiger Gemeindecode");
  });

  it("normalizes German names and ranks exact, prefix, substring and code matches", () => {
    expect(normalizeMunicipalitySearch("  GRÖSSEN  ")).toBe("grossen");
    expect(searchMunicipalities(sampleMunicipalities, "601").map((item) => item.name)).toEqual(["Graz"]);
    expect(searchMunicipalities(sampleMunicipalities, "PÖLTEN").map((item) => item.name)).toEqual(["St. Pölten"]);
    expect(searchMunicipalities(sampleMunicipalities, "oberosterreich").map((item) => item.name)).toEqual(["Leonding"]);
  });

  it("calculates bounds for polygon and multipolygon geometries", () => {
    expect(geometryBounds({ type: "Polygon", coordinates: [[[10, 47], [12, 47], [12, 49], [10, 47]]] })).toEqual([10, 47, 12, 49]);
    expect(geometryBounds({ type: "MultiPolygon", coordinates: [[[[9, 46], [10, 46], [9, 47], [9, 46]]], [[[15, 48], [17, 48], [15, 49], [15, 48]]]] })).toEqual([9, 46, 17, 49]);
  });
});

describe("municipality structure importer", () => {
  it("aggregates Vienna districts and historic Fürstenfeld codes", () => {
    const csv = [
      "JAHR;GCD;BEV_ABSOLUT;AUSL_STAATSB",
      "2024;90101;100;10,0",
      "2024;90201;200;20,0",
      "2024;62252;100;10,0",
      "2024;62267;50;20,0",
    ].join("\n");
    const values = aggregateStructure(csv, 2024);
    expect(values.get("90001")).toEqual([300, 50]);
    expect(values.get("62280")).toEqual([150, 20]);
  });
});

describe("generated municipality assets", () => {
  const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
  const geoJson = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.geojson"), "utf8")) as FeatureCollection<Polygon | MultiPolygon, MunicipalityProperties>;
  const population = JSON.parse(readFileSync(resolve("public/data/municipality-population-2002-2025.json"), "utf8")) as MunicipalityPopulationSeries;
  const structure = JSON.parse(readFileSync(resolve("public/data/municipality-structure-2022-2024.json"), "utf8")) as MunicipalityStructureSeries;

  it("contains one valid indexed feature for every current municipality", () => {
    expect(validateMunicipalityIndex(index)).toBe(index);
    expect(index.count).toBe(EXPECTED_MUNICIPALITY_COUNT);
    expect(geoJson.features).toHaveLength(EXPECTED_MUNICIPALITY_COUNT);
    expect(new Set(geoJson.features.map((feature) => feature.properties.municipalityCode)).size).toBe(EXPECTED_MUNICIPALITY_COUNT);
    expect(geoJson.features.every((feature) => feature.id === feature.properties.municipalityCode)).toBe(true);
  });

  it("contains representative cities, one aggregated Vienna and multipart municipalities", () => {
    expect(index.municipalities).toEqual(expect.arrayContaining([
      expect.objectContaining({ municipalityCode: "10101", name: "Eisenstadt" }),
      expect.objectContaining({ municipalityCode: "60101", name: "Graz" }),
      expect.objectContaining({ municipalityCode: "90001", name: "Wien" }),
    ]));
    expect(index.municipalities.filter((municipality) => municipality.state === "Wien")).toHaveLength(1);
    expect(geoJson.features.some((feature) => feature.geometry.type === "MultiPolygon")).toBe(true);
    expect(geoJson.features.every((feature) => geometryBounds(feature.geometry).every(Number.isFinite))).toBe(true);
    expect(index.municipalities.reduce((sum, municipality) => sum + municipality.areaSquareKilometers, 0)).toBeCloseTo(83_879.2, 0);
  });

  it("contains complete citizenship data and derives population density", () => {
    const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode);
    expect(validateMunicipalityStructureSeries(structure, population, codes)).toBe(structure);
    expect(Object.keys(structure.years)).toHaveLength(3);
    expect(Object.keys(structure.years["2024"].values)).toHaveLength(EXPECTED_MUNICIPALITY_COUNT);
    expect(structure.years["2024"].values["20622"]).toEqual([820, 36]);
    const moertschach = index.municipalities.find(({ municipalityCode }) => municipalityCode === "20622")!;
    expect(populationViewValue("density", population.years["2024"].values["20622"], moertschach, null)).toBeCloseTo(11, 1);
  });
});
