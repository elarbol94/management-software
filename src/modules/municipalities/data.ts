import type { Geometry, Position } from "geojson";

export const MUNICIPALITY_DATASET_DATE = "2026-01-01";
export const EXPECTED_MUNICIPALITY_COUNT = 2_092;

export type MunicipalityBounds = [west: number, south: number, east: number, north: number];
export const AUSTRIA_BOUNDS: MunicipalityBounds = [9.45, 46.3, 17.2, 49.08];

const STATE_BY_CODE_PREFIX = {
  "1": "Burgenland", "2": "Kärnten", "3": "Niederösterreich", "4": "Oberösterreich", "5": "Salzburg",
  "6": "Steiermark", "7": "Tirol", "8": "Vorarlberg", "9": "Wien",
} as const;

export type MunicipalityState = (typeof STATE_BY_CODE_PREFIX)[keyof typeof STATE_BY_CODE_PREFIX];
export type MunicipalityProperties = { municipalityCode: string; name: string; state: MunicipalityState };
export type MunicipalityIndexItem = MunicipalityProperties & {
  bounds: MunicipalityBounds;
  areaSquareKilometers: number;
};
export type MunicipalityIndex = {
  datasetDate: typeof MUNICIPALITY_DATASET_DATE;
  count: number;
  bounds: MunicipalityBounds;
  municipalities: MunicipalityIndexItem[];
};

export function municipalityStateFromCode(code: string): MunicipalityState {
  const state = STATE_BY_CODE_PREFIX[code[0] as keyof typeof STATE_BY_CODE_PREFIX];
  if (!/^\d{5}$/.test(code) || !state) throw new Error(`Ungültiger Gemeindecode: ${code}`);
  return state;
}

export function normalizeMunicipalitySearch(value: string) {
  return value.trim().toLocaleLowerCase("de-AT").replaceAll("ß", "ss").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export function searchMunicipalities(municipalities: MunicipalityIndexItem[], query: string, limit = 8) {
  const normalizedQuery = normalizeMunicipalitySearch(query);
  if (!normalizedQuery) return [];
  return municipalities.flatMap((municipality) => {
    const normalizedName = normalizeMunicipalitySearch(municipality.name);
    const normalizedState = normalizeMunicipalitySearch(municipality.state);
    let score = Number.POSITIVE_INFINITY;
    if (municipality.municipalityCode === normalizedQuery || normalizedName === normalizedQuery) score = 0;
    else if (municipality.municipalityCode.startsWith(normalizedQuery) || normalizedName.startsWith(normalizedQuery)) score = 1;
    else if (normalizedName.includes(normalizedQuery)) score = 2;
    else if (`${normalizedName} ${normalizedState}`.includes(normalizedQuery)) score = 3;
    return Number.isFinite(score) ? [{ municipality, score }] : [];
  }).sort((left, right) => left.score - right.score
    || left.municipality.name.localeCompare(right.municipality.name, "de-AT")
    || left.municipality.municipalityCode.localeCompare(right.municipality.municipalityCode))
    .slice(0, Math.max(0, limit)).map(({ municipality }) => municipality);
}

function visitPositions(value: Position | Position[] | Position[][] | Position[][][], visit: (position: Position) => void) {
  if (typeof value[0] === "number") { visit(value as Position); return; }
  for (const child of value as Position[] | Position[][] | Position[][][]) visitPositions(child, visit);
}

export function geometryBounds(geometry: Geometry): MunicipalityBounds {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    throw new Error(`Nicht unterstützte Gemeindegeometrie: ${geometry.type}`);
  }
  const bounds: MunicipalityBounds = [Infinity, Infinity, -Infinity, -Infinity];
  visitPositions(geometry.coordinates, ([longitude, latitude]) => {
    bounds[0] = Math.min(bounds[0], longitude); bounds[1] = Math.min(bounds[1], latitude);
    bounds[2] = Math.max(bounds[2], longitude); bounds[3] = Math.max(bounds[3], latitude);
  });
  if (!bounds.every(Number.isFinite) || bounds[0] > bounds[2] || bounds[1] > bounds[3]) throw new Error("Gemeindegeometrie enthält keine gültigen Koordinaten.");
  return bounds;
}

export function mergeBounds(items: MunicipalityBounds[]): MunicipalityBounds {
  if (!items.length) throw new Error("Mindestens ein Kartenausschnitt ist erforderlich.");
  return items.reduce<MunicipalityBounds>((result, bounds) => [
    Math.min(result[0], bounds[0]), Math.min(result[1], bounds[1]),
    Math.max(result[2], bounds[2]), Math.max(result[3], bounds[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

export function validateMunicipalityIndex(index: MunicipalityIndex) {
  if (index.datasetDate !== MUNICIPALITY_DATASET_DATE) throw new Error("Unerwarteter Gemeindestand.");
  if (index.count !== EXPECTED_MUNICIPALITY_COUNT || index.municipalities.length !== EXPECTED_MUNICIPALITY_COUNT) throw new Error(`Erwartet: ${EXPECTED_MUNICIPALITY_COUNT} Gemeinden, erhalten: ${index.municipalities.length}.`);
  const codes = new Set<string>();
  for (const municipality of index.municipalities) {
    if (codes.has(municipality.municipalityCode)) throw new Error(`Doppelter Gemeindecode: ${municipality.municipalityCode}`);
    codes.add(municipality.municipalityCode);
    if (!municipality.name.trim()) throw new Error(`Gemeinde ${municipality.municipalityCode} hat keinen Namen.`);
    if (municipality.state !== municipalityStateFromCode(municipality.municipalityCode)) throw new Error(`Bundesland stimmt für ${municipality.municipalityCode} nicht.`);
    if (!municipality.bounds.every(Number.isFinite)) throw new Error(`Ungültiger Kartenausschnitt für ${municipality.municipalityCode}.`);
    if (!Number.isFinite(municipality.areaSquareKilometers) || municipality.areaSquareKilometers <= 0) throw new Error(`Ungültige Fläche für ${municipality.municipalityCode}.`);
  }
  return index;
}
