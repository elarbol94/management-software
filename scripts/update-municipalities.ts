import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  EXPECTED_MUNICIPALITY_COUNT,
  MUNICIPALITY_DATASET_DATE,
  geometryBounds,
  mergeBounds,
  municipalityStateFromCode,
  validateMunicipalityIndex,
  type MunicipalityIndex,
  type MunicipalityProperties,
} from "../src/modules/municipalities/data";

type SourceProperties = { g_id?: unknown; g_name?: unknown };
type MunicipalityGeometry = Polygon | MultiPolygon;
type NormalizedProperties = MunicipalityProperties & { areaSquareKilometers: number };

const SOURCE_URL = new URL("https://www.statistik.gv.at/gs-open/GEODATA/ows");
SOURCE_URL.search = new URLSearchParams({
  service: "WFS",
  version: "1.1.0",
  request: "GetFeature",
  typeName: "GEODATA:STATISTIK_AUSTRIA_GEM_20260101",
  srsName: "EPSG:31287",
  outputFormat: "application/json",
}).toString();
const outputDirectory = resolve("public/data");
const SOURCE_FEATURE_COUNT = 2_114;

function normalizeFeature(feature: Feature<MunicipalityGeometry, SourceProperties>): Feature<MunicipalityGeometry, MunicipalityProperties> {
  const municipalityCode = String(feature.properties?.g_id ?? "");
  const name = String(feature.properties?.g_name ?? "").trim();
  if (!/^\d{5}$/.test(municipalityCode) || !name) throw new Error(`Ungültiges Quellobjekt: ${feature.id ?? "ohne ID"}`);
  if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) throw new Error(`Fehlende Polygongeometrie für ${municipalityCode}.`);
  const isViennaDistrict = municipalityCode.startsWith("9");
  return {
    type: "Feature",
    id: isViennaDistrict ? "90001" : municipalityCode,
    properties: {
      municipalityCode: isViennaDistrict ? "90001" : municipalityCode,
      name: isViennaDistrict ? "Wien" : name,
      state: municipalityStateFromCode(municipalityCode),
    },
    geometry: feature.geometry,
  };
}

function validateFeatures(features: Feature<MunicipalityGeometry, MunicipalityProperties>[], expectedCount: number, requireUniqueCodes = true) {
  if (features.length !== expectedCount) throw new Error(`Erwartet: ${expectedCount} Flächen, erhalten: ${features.length}.`);
  const codes = new Set<string>();
  for (const feature of features) {
    const code = feature.properties.municipalityCode;
    if (requireUniqueCodes && codes.has(code)) throw new Error(`Doppelter Gemeindecode: ${code}`);
    codes.add(code);
    geometryBounds(feature.geometry);
  }
}

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "municipalities-at-"));
  try {
    const normalizedPath = join(temporaryDirectory, "normalized.geojson");
    const simplifiedPath = join(temporaryDirectory, "simplified.geojson");
    const response = await fetch(SOURCE_URL, { headers: { "user-agent": "management-platform municipality importer" } });
    if (!response.ok) throw new Error(`Statistik-Austria-WFS antwortete mit HTTP ${response.status}.`);
    const source = JSON.parse(await response.text()) as FeatureCollection<MunicipalityGeometry, SourceProperties>;
    const normalizedFeatures = source.features.map(normalizeFeature).sort((left, right) =>
      left.properties.municipalityCode.localeCompare(right.properties.municipalityCode));
    validateFeatures(normalizedFeatures, SOURCE_FEATURE_COUNT, false);
    await writeFile(normalizedPath, JSON.stringify({ type: "FeatureCollection", features: normalizedFeatures }));

    const result = spawnSync(resolve("node_modules/.bin/mapshaper"), [
      normalizedPath,
      "-clean",
      "-each", "areaSquareKilometers=this.area/1000000",
      "-dissolve", "municipalityCode", "copy-fields=name,state", "sum-fields=areaSquareKilometers",
      "-proj", "init=EPSG:31287", "crs=wgs84",
      "-simplify", "weighted", "10%", "keep-shapes",
      "-o", "format=geojson", "precision=0.00001", simplifiedPath,
    ], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "mapshaper ist fehlgeschlagen.");

    const simplified = JSON.parse(await readFile(simplifiedPath, "utf8")) as FeatureCollection<MunicipalityGeometry, NormalizedProperties>;
    simplified.features.sort((left, right) => left.properties.municipalityCode.localeCompare(right.properties.municipalityCode));
    for (const feature of simplified.features) feature.id = feature.properties.municipalityCode;
    validateFeatures(simplified.features, EXPECTED_MUNICIPALITY_COUNT);
    const municipalities = simplified.features.map((feature) => ({ ...feature.properties, bounds: geometryBounds(feature.geometry) }));
    const index: MunicipalityIndex = validateMunicipalityIndex({
      datasetDate: MUNICIPALITY_DATASET_DATE,
      count: municipalities.length,
      bounds: mergeBounds(municipalities.map(({ bounds }) => bounds)),
      municipalities,
    });

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "municipalities-at-2026.geojson"), JSON.stringify(simplified));
    await writeFile(join(outputDirectory, "municipalities-at-2026.index.json"), JSON.stringify(index));
    process.stdout.write(`Gemeindedaten ${MUNICIPALITY_DATASET_DATE}: ${municipalities.length} Flächen erzeugt.\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
