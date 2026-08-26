import { validateMunicipalityIndex, type MunicipalityIndex } from "./data";
import { validateMunicipalityCostSeries, type MunicipalityCostSeries } from "./costs";
import { validateMunicipalityDemographySeries, type MunicipalityDemographySeries } from "./demography";
import { validateMunicipalityMovementSeries, type MunicipalityMovementSeries } from "./movement";
import { validateMunicipalityPopulationSeries, type MunicipalityPopulationSeries } from "./population";
import { validateMunicipalityStructureSeries, type MunicipalityStructureSeries } from "./structure";
import type { MunicipalityAnalysisData, MunicipalityAnalysisGraph } from "./analysis";

const cache = new Map<string, Promise<unknown>>();
function fetchJson<T>(url: string) {
  const existing = cache.get(url);
  if (existing) return existing as Promise<T>;
  const request = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  });
  cache.set(url, request);
  return request;
}

/** Just the municipality list, sharing the same request as a full analysis load. */
export async function loadMunicipalityIndex() {
  return validateMunicipalityIndex(await fetchJson<MunicipalityIndex>("/data/municipalities-at-2026.index.json"));
}

export async function loadMunicipalityAnalysisData(graph: MunicipalityAnalysisGraph): Promise<MunicipalityAnalysisData> {
  const [index, rawPopulation] = await Promise.all([
    loadMunicipalityIndex(),
    fetchJson<MunicipalityPopulationSeries>("/data/municipality-population-2002-2025.json"),
  ]);
  const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode);
  const population = validateMunicipalityPopulationSeries(rawPopulation, codes);
  const datasets = graph.nodes.flatMap((node) => node.type === "dataset" ? [node.data.dataset] : []);
  const needsDemography = datasets.some(({ kind }) => kind === "age-group" || kind === "age-indicator");
  const needsMovement = datasets.some(({ kind }) => kind === "movement");
  const needsCosts = datasets.some(({ kind }) => kind === "cost-share");
  const needsStructure = datasets.some((dataset) => dataset.kind === "population"
    && (dataset.view === "foreign-share" || dataset.view === "foreign-persons" || dataset.view === "structure-population"));
  const [rawDemography, rawMovement, rawStructure, rawCosts] = await Promise.all([
    needsDemography ? fetchJson<MunicipalityDemographySeries>("/data/municipality-demography-2002-2025.json") : null,
    needsMovement ? fetchJson<MunicipalityMovementSeries>("/data/municipality-movement-2002-2025.json") : null,
    needsStructure ? fetchJson<MunicipalityStructureSeries>("/data/municipality-structure-2022-2024.json") : null,
    needsCosts ? fetchJson<MunicipalityCostSeries>("/data/municipality-cost-shares-2010-2024.json") : null,
  ]);
  return {
    index,
    population,
    demography: rawDemography ? validateMunicipalityDemographySeries(rawDemography, population, codes) : null,
    movement: rawMovement ? validateMunicipalityMovementSeries(rawMovement, population, codes) : null,
    structure: rawStructure ? validateMunicipalityStructureSeries(rawStructure, population, codes) : null,
    costs: rawCosts ? validateMunicipalityCostSeries(rawCosts, codes) : null,
  };
}
