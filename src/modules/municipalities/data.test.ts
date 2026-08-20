import { readFileSync } from "node:fs";
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

const sampleMunicipalities: MunicipalityIndexItem[] = [
  { municipalityCode: "30201", name: "St. Pölten", state: "Niederösterreich", bounds: [15.5, 48.1, 15.8, 48.3] },
  { municipalityCode: "40601", name: "Leonding", state: "Oberösterreich", bounds: [14.2, 48.2, 14.3, 48.3] },
  { municipalityCode: "60101", name: "Graz", state: "Steiermark", bounds: [15.3, 47, 15.6, 47.2] },
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

describe("generated municipality assets", () => {
  const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
  const geoJson = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.geojson"), "utf8")) as FeatureCollection<Polygon | MultiPolygon, MunicipalityProperties>;

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
  });
});
