import { validateMunicipalityIndex, type MunicipalityIndex } from "./data";
import { validateMunicipalityCostSeries, type MunicipalityCostSeries } from "./costs";
import { validateMunicipalityDemographySeries, type MunicipalityDemographySeries } from "./demography";
import { validateMunicipalityMovementSeries, type MunicipalityMovementSeries } from "./movement";
import { validateMunicipalityPopulationSeries, type MunicipalityPopulationSeries } from "./population";
import { validateMunicipalityStructureSeries, type MunicipalityStructureSeries } from "./structure";
import type { MunicipalityAnalysisData, MunicipalityAnalysisGraph } from "./analysis";

const cache = new Map<string, Promise<unknown>>();
/**
 * One request and one validation pass per file for the life of the page. The checks walk
 * every municipality of every year, and the graph is reloaded whenever its datasets change
 * — including when a constant is retyped, which is a keystroke away from a stall.
 */
function fetchJson<T>(url: string, validate: (raw: T) => T = (raw) => raw) {
  const existing = cache.get(url);
  if (existing) return existing as Promise<T>;
  const request = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }).then(validate);
  cache.set(url, request);
  return request;
}

/** Just the municipality list, sharing the same request as a full analysis load. */
export function loadMunicipalityIndex() {
  return fetchJson<MunicipalityIndex>("/data/municipalities-at-2026.index.json", validateMunicipalityIndex);
}

function loadMunicipalityPopulation(codes: string[]) {
  return fetchJson<MunicipalityPopulationSeries>(
    "/data/municipality-population-2002-2025.json",
    (raw) => validateMunicipalityPopulationSeries(raw, codes),
  );
}

export async function loadMunicipalityAnalysisData(graph: MunicipalityAnalysisGraph): Promise<MunicipalityAnalysisData> {
  const index = await loadMunicipalityIndex();
  const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode);
  const population = await loadMunicipalityPopulation(codes);
  const datasets = graph.nodes.flatMap((node) => node.type === "dataset" ? [node.data.dataset] : []);
  const needsDemography = datasets.some(({ kind }) => kind === "age-group" || kind === "age-indicator");
  const needsMovement = datasets.some(({ kind }) => kind === "movement");
  const needsCosts = datasets.some(({ kind }) => kind === "cost-share");
  const needsStructure = datasets.some((dataset) => dataset.kind === "population"
    && (dataset.view === "foreign-share" || dataset.view === "foreign-persons" || dataset.view === "structure-population"));
  const [demography, movement, structure, costs] = await Promise.all([
    needsDemography ? fetchJson<MunicipalityDemographySeries>("/data/municipality-demography-2002-2025.json", (raw) => validateMunicipalityDemographySeries(raw, population, codes)) : null,
    needsMovement ? fetchJson<MunicipalityMovementSeries>("/data/municipality-movement-2002-2025.json", (raw) => validateMunicipalityMovementSeries(raw, population, codes)) : null,
    needsStructure ? fetchJson<MunicipalityStructureSeries>("/data/municipality-structure-2022-2024.json", (raw) => validateMunicipalityStructureSeries(raw, population, codes)) : null,
    needsCosts ? fetchJson<MunicipalityCostSeries>("/data/municipality-cost-shares-2010-2024.json", (raw) => validateMunicipalityCostSeries(raw, codes)) : null,
  ]);
  return { index, population, demography, movement, structure, costs };
}
