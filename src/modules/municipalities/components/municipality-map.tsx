"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Info, ListFilter, MapPinned, SlidersHorizontal, X } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  MapLayerMouseEvent,
  MapSourceDataEvent,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MunicipalityDatasetRef } from "../analysis";
import type { CostCategoryId, CostMeasureId } from "../costs";
import type {
  AgeGroupId,
  AgeMeasure,
  AgeViewId,
  DemographicIndicatorId,
  MapMetric,
  SexFilter,
} from "../demography";
import type {
  MunicipalityBounds,
  MunicipalityIndexItem,
  MunicipalityProperties,
} from "../data";
import type { MovementMetricId, MovementPalette } from "../movement";
import { CANONICAL_PARTIES, type CanonicalPartyId, type PoliticsView } from "../politics";
import type { PopulationViewId } from "../structure";
import {
  MAP_FILL_OPACITY,
  MAP_HOVER_FILL_OPACITY,
  MAP_NO_DATA_COLOR,
  MAP_NO_DATA_OPACITY,
  MUNICIPALITY_COST_COLORS,
  MUNICIPALITY_DIVERGING_COLORS,
  MUNICIPALITY_DIVERGING_STOPS,
  MUNICIPALITY_MOVEMENT_COLORS,
  MUNICIPALITY_SEQUENTIAL_COLORS,
} from "../palette";
import { POPULATION_CLASSES } from "../population";
import { MobileBottomSheet } from "@/components/ui/mobile-bottom-sheet";
import { MunicipalityMetricChart } from "./municipality-metric-chart";

const SOURCE_ID = "austrian-municipalities";
const FILL_LAYER_ID = "municipality-fills";
maplibregl.setWorkerUrl("/vendor/maplibre-gl/maplibre-gl-worker.mjs");

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "basemap-at": {
      type: "raster",
      tiles: [
        "https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© basemap.at",
    },
  },
  layers: [
    {
      id: "map-background",
      type: "background",
      paint: { "background-color": "#e8ece9" },
    },
    {
      id: "basemap-at",
      type: "raster",
      source: "basemap-at",
      paint: { "raster-opacity": 0.72, "raster-saturation": -0.7 },
    },
  ],
};

const POPULATION_COLOR: ExpressionSpecification = [
  "step",
  ["coalesce", ["feature-state", "metric"], -1],
  MAP_NO_DATA_COLOR,
  ...POPULATION_CLASSES.flatMap(({ minimum, color }) => [minimum, color]),
] as ExpressionSpecification;
const AGE_COLORS = [...MUNICIPALITY_SEQUENTIAL_COLORS];
const MOVEMENT_COLORS = [...MUNICIPALITY_MOVEMENT_COLORS];
const COST_COLORS = [...MUNICIPALITY_COST_COLORS];
export const POLITICS_PARTY_COLORS: Record<CanonicalPartyId | "tie", string> = {
  oevp: "#202124", spoe: "#d71920", fpoe: "#2056a7", gruene: "#2f8f46",
  neos: "#e83e8c", kpoe: "#8f1d21", mfg: "#e58a17",
  "local-other": "#737b83", tie: "#7656a8",
};

function asMapBounds(
  bounds: MunicipalityBounds,
): [[number, number], [number, number]] {
  return [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[3]],
  ];
}
function featureProperties(
  event: MapLayerMouseEvent,
): MunicipalityProperties | null {
  const properties = event.features?.[0]?.properties;
  return properties &&
    typeof properties.municipalityCode === "string" &&
    typeof properties.name === "string" &&
    typeof properties.state === "string"
    ? (properties as MunicipalityProperties)
    : null;
}
function populationClassLabel(
  item: (typeof POPULATION_CLASSES)[number],
  formatter: Intl.NumberFormat,
) {
  if (item.maximum === null) return `≥ ${formatter.format(item.minimum)}`;
  if (item.minimum === 0) return `< ${formatter.format(item.maximum + 1)}`;
  return `${formatter.format(item.minimum)}–${formatter.format(item.maximum)}`;
}
function sequentialColorExpression(
  domain: [number, number],
  colors: string[],
): ExpressionSpecification {
  const [minimum, maximum] = domain;
  const value: ExpressionSpecification = [
    "max",
    minimum,
    ["min", maximum, ["feature-state", "metric"]],
  ];
  return [
    "case",
    ["boolean", ["feature-state", "hasMetric"], false],
    [
      "interpolate",
      ["linear"],
      value,
      minimum,
      colors[0],
      minimum + (maximum - minimum) * 0.2,
      colors[1],
      minimum + (maximum - minimum) * 0.4,
      colors[2],
      minimum + (maximum - minimum) * 0.6,
      colors[3],
      minimum + (maximum - minimum) * 0.8,
      colors[4],
      maximum,
      colors[5],
    ],
    MAP_NO_DATA_COLOR,
  ];
}
/** Ascending [value, colour] stops for a diverging scale of ±`maximum`. */
export function divergingColorStops(maximum: number) {
  const middle = (MUNICIPALITY_DIVERGING_COLORS.length - 1) / 2;
  return [
    ...MUNICIPALITY_DIVERGING_STOPS.map((fraction, index) => ({
      value: -fraction * maximum,
      color: MUNICIPALITY_DIVERGING_COLORS[middle - 1 - index],
      offset: (1 - fraction) / 2,
    })).reverse(),
    { value: 0, color: MUNICIPALITY_DIVERGING_COLORS[middle], offset: 0.5 },
    ...MUNICIPALITY_DIVERGING_STOPS.map((fraction, index) => ({
      value: fraction * maximum,
      color: MUNICIPALITY_DIVERGING_COLORS[middle + 1 + index],
      offset: (1 + fraction) / 2,
    })),
  ];
}
type ColorInputs = {
  usePopulationClasses: boolean;
  scaleDomain: [number, number] | null;
  metric: MapMetric;
  movementPalette: MovementPalette | null;
  costMeasure: CostMeasureId;
  politicsView?: PoliticsView;
};
const POLITICS_LEADING_COLOR: ExpressionSpecification = [
  "match", ["feature-state", "metric"],
  0, POLITICS_PARTY_COLORS.oevp, 1, POLITICS_PARTY_COLORS.spoe, 2, POLITICS_PARTY_COLORS.fpoe,
  3, POLITICS_PARTY_COLORS.gruene, 4, POLITICS_PARTY_COLORS.neos, 5, POLITICS_PARTY_COLORS.kpoe,
  6, POLITICS_PARTY_COLORS.mfg, 7, POLITICS_PARTY_COLORS["local-other"], 8, POLITICS_PARTY_COLORS.tie,
  MAP_NO_DATA_COLOR,
] as ExpressionSpecification;
/**
 * The fill colour for the current metric.
 *
 * Shared by the layer's initial paint and every later update: creating the layer with
 * the population ramp and fixing it in an effect left a visible window where a
 * movement or cost map was painted with population class breaks.
 */
export function metricColorExpression({
  usePopulationClasses, scaleDomain, metric, movementPalette, costMeasure, politicsView = "leading-list",
}: ColorInputs): ExpressionSpecification {
  if (metric === "politics" && politicsView === "leading-list") return POLITICS_LEADING_COLOR;
  if (usePopulationClasses || !scaleDomain) return POPULATION_COLOR;
  if (metric === "movement") {
    return movementPalette === "diverging"
      ? divergingColorExpression(scaleDomain)
      : sequentialColorExpression(scaleDomain, MOVEMENT_COLORS);
  }
  if (metric === "costs") {
    return costMeasure === "peer-deviation"
      ? divergingColorExpression(scaleDomain)
      : sequentialColorExpression(scaleDomain, COST_COLORS);
  }
  return sequentialColorExpression(scaleDomain, AGE_COLORS);
}
function divergingColorExpression(
  domain: [number, number],
): ExpressionSpecification {
  const maximum = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const value: ExpressionSpecification = [
    "max",
    -maximum,
    ["min", maximum, ["feature-state", "metric"]],
  ];
  // Stops follow the observed quantiles instead of even spacing — see
  // MUNICIPALITY_DIVERGING_STOPS for why linear spacing left most of Austria white.
  const stops = divergingColorStops(maximum);
  return [
    "case",
    ["boolean", ["feature-state", "hasMetric"], false],
    [
      "interpolate",
      ["linear"],
      value,
      ...stops.flatMap(({ value: stop, color }) => [stop, color]),
    ] as ExpressionSpecification,
    MAP_NO_DATA_COLOR,
  ];
}

type Labels = {
  map: string;
  zoomIn: string;
  zoomOut: string;
  reset: string;
  municipalityCode: string;
  population: string;
  reference: string;
  year: string;
  previousYear: string;
  nextYear: string;
  metric: string;
  populationMetric: string;
  ageMetric: string;
  movementMetric: string;
  costsMetric: string;
  politicsMetric: string;
  politicsView: string;
  politicsViews: Record<PoliticsView, string>;
  politicsParty: string;
  politicsParties: Record<CanonicalPartyId, string>;
  politicsTie: string;
  populationView: string;
  populationViews: Record<PopulationViewId, string>;
  ageView: string;
  movementView: string;
  ageGroupsHeading: string;
  indicatorsHeading: string;
  ageGroups: Record<AgeGroupId, string>;
  indicators: Record<DemographicIndicatorId, string>;
  measures: Record<AgeMeasure, string>;
  sexes: Record<SexFilter, string>;
  movements: Record<MovementMetricId, string>;
  costView: string;
  costCategories: Record<CostCategoryId, string>;
  costMeasure: string;
  costMeasures: Record<CostMeasureId, string>;
  costDefinition: string;
  minimizeChart: string;
  expandChart: string;
  restoreChart: string;
  addToAnalysis: string;
  dragToAnalysis: string;
  loadingAge: string;
  ageError: string;
  loadingMovement: string;
  movementError: string;
  loadingCosts: string;
  costsError: string;
  loadingPolitics: string;
  politicsError: string;
  loadingStructure: string;
  structureError: string;
  noData: string;
  zoomHintWindows: string;
  zoomHintMac: string;
  zoomHintMobile: string;
  display: string;
  legend: string;
  details: string;
  close: string;
  selected: string;
};

export function MunicipalityMap({
  austriaBounds,
  selected,
  metric,
  populationView,
  populationDefinition,
  usePopulationClasses,
  metricValues,
  tooltipValues,
  scaleDomain,
  movementPalette,
  year,
  firstYear,
  latestYear,
  ageView,
  ageMeasure,
  sex,
  movementView,
  costCategory,
  costMeasure,
  politicsView,
  politicsParty,
  peerMunicipalityCodes,
  peerGroupLabel,
  movementDefinition,
  showAgeFilters,
  indicatorDefinition,
  ageLoading,
  ageError,
  movementLoading,
  movementError,
  costsLoading,
  costsError,
  politicsLoading,
  politicsError,
  structureLoading,
  structureError,
  onYearChange,
  onMetricChange,
  onPopulationViewChange,
  onAgeViewChange,
  onAgeMeasureChange,
  onSexChange,
  onMovementViewChange,
  onCostCategoryChange,
  onCostMeasureChange,
  onPoliticsViewChange,
  onPoliticsPartyChange,
  onSelect,
  onReset,
  onOpenDetails,
  labels,
  selectedMetricHistory,
  metricChartLabel,
  metricLabel,
  chartValueFormatter,
  chartUnitLabel,
  chartChangeLabels,
  analysisDataset,
}: {
  austriaBounds: MunicipalityBounds;
  selected: MunicipalityIndexItem | null;
  metric: MapMetric;
  populationView: PopulationViewId;
  populationDefinition: string | null;
  usePopulationClasses: boolean;
  metricValues: Record<string, number | null>;
  tooltipValues: Record<string, string> | null;
  scaleDomain: [number, number] | null;
  movementPalette: MovementPalette | null;
  year: number;
  firstYear: number;
  latestYear: number;
  ageView: AgeViewId;
  ageMeasure: AgeMeasure;
  sex: SexFilter;
  movementView: MovementMetricId;
  costCategory: CostCategoryId;
  costMeasure: CostMeasureId;
  politicsView: PoliticsView;
  politicsParty: CanonicalPartyId;
  peerMunicipalityCodes: string[] | null;
  peerGroupLabel: string | null;
  movementDefinition: string | null;
  showAgeFilters: boolean;
  indicatorDefinition: string | null;
  ageLoading: boolean;
  ageError: boolean;
  movementLoading: boolean;
  movementError: boolean;
  costsLoading: boolean;
  costsError: boolean;
  politicsLoading: boolean;
  politicsError: boolean;
  structureLoading: boolean;
  structureError: boolean;
  onYearChange: (year: number) => void;
  onMetricChange: (metric: MapMetric) => void;
  onPopulationViewChange: (view: PopulationViewId) => void;
  onAgeViewChange: (view: AgeViewId) => void;
  onAgeMeasureChange: (measure: AgeMeasure) => void;
  onSexChange: (sex: SexFilter) => void;
  onMovementViewChange: (view: MovementMetricId) => void;
  onCostCategoryChange: (category: CostCategoryId) => void;
  onCostMeasureChange: (measure: CostMeasureId) => void;
  onPoliticsViewChange: (view: PoliticsView) => void;
  onPoliticsPartyChange: (party: CanonicalPartyId) => void;
  onSelect: (code: string) => void;
  onReset: () => void;
  onOpenDetails: () => void;
  labels: Labels;
  selectedMetricHistory: Array<{ year: number; value: number | null }> | null;
  metricChartLabel: string;
  metricLabel: string;
  chartValueFormatter: Intl.NumberFormat;
  chartUnitLabel: string;
  chartChangeLabels?: { previousYear: string; sinceFirstYear: string };
  analysisDataset: MunicipalityDatasetRef | null;
}) {
  const locale = useLocale();
  const personsFormatter = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"display" | "legend" | null>(null);
  const hoveredIdRef = useRef<string | number | null>(null);
  const selectedIdRef = useRef<string | number | null>(null);
  const peerIdsRef = useRef<Set<string>>(new Set());
  const colorInputs: ColorInputs = {
    usePopulationClasses, scaleDomain, metric, movementPalette, costMeasure, politicsView,
  };
  const liveRef = useRef({
    selected,
    onSelect,
    metric,
    metricValues,
    tooltipValues,
    labels,
    colorInputs,
  });
  useEffect(() => {
    liveRef.current = {
      selected,
      onSelect,
      metric,
      metricValues,
      tooltipValues,
      labels,
      colorInputs,
    };
  });

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE_ID)) return;
    for (const [code, value] of Object.entries(metricValues))
      map.setFeatureState(
        { source: SOURCE_ID, id: code },
        { metric: value ?? 0, hasMetric: value !== null },
      );
    if (map.getLayer(FILL_LAYER_ID)) {
      map.setPaintProperty(FILL_LAYER_ID, "fill-color", metricColorExpression({
        usePopulationClasses, scaleDomain, metric, movementPalette, costMeasure,
      }));
    }
  }, [costMeasure, metric, metricValues, movementPalette, ready, scaleDomain, usePopulationClasses]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE_ID)) return;
    const nextPeerIds = new Set(peerMunicipalityCodes ?? []);
    for (const code of peerIdsRef.current) {
      if (!nextPeerIds.has(code)) map.setFeatureState({ source: SOURCE_ID, id: code }, { peer: false });
    }
    for (const code of nextPeerIds) map.setFeatureState({ source: SOURCE_ID, id: code }, { peer: true });
    peerIdsRef.current = nextPeerIds;
    const highlightPeers = nextPeerIds.size > 0;
    // Municipalities without a value drop to MAP_NO_DATA_OPACITY so the basemap shows
    // through: no neutral grey separates from the pale end of a ramp by colour alone.
    const noData: ExpressionSpecification = ["!", ["boolean", ["feature-state", "hasMetric"], false]];
    map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", highlightPeers
      ? ["case", noData, MAP_NO_DATA_OPACITY, ["boolean", ["feature-state", "selected"], false], 0.9, ["boolean", ["feature-state", "peer"], false], 0.82, ["boolean", ["feature-state", "hover"], false], 0.56, 0.24]
      : ["case", noData, MAP_NO_DATA_OPACITY, ["boolean", ["feature-state", "hover"], false], MAP_HOVER_FILL_OPACITY, MAP_FILL_OPACITY]);
    map.setPaintProperty("municipality-lines", "line-color", highlightPeers
      ? ["case", ["boolean", ["feature-state", "selected"], false], "#000000", ["boolean", ["feature-state", "peer"], false], "#0f766e", ["boolean", ["feature-state", "hover"], false], "#0f766e", "#ffffff"]
      : ["case", ["boolean", ["feature-state", "selected"], false], "#000000", ["boolean", ["feature-state", "hover"], false], "#0f766e", "#ffffff"]);
    map.setPaintProperty("municipality-lines", "line-width", highlightPeers
      ? ["case", ["boolean", ["feature-state", "selected"], false], 3.5, ["boolean", ["feature-state", "peer"], false], 2.2, ["boolean", ["feature-state", "hover"], false], 1.4, 0.45]
      : ["case", ["boolean", ["feature-state", "selected"], false], 3.5, ["boolean", ["feature-state", "hover"], false], 1.4, 0.65]);
  }, [peerMunicipalityCodes, ready]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      bounds: asMapBounds(austriaBounds),
      fitBoundsOptions: { padding: 38 },
      maxBounds: [
        [8.2, 45.4],
        [18.4, 50.1],
      ],
      minZoom: 5,
      maxZoom: 14,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      locale: {
        "CooperativeGesturesHandler.WindowsHelpText": liveRef.current.labels.zoomHintWindows,
        "CooperativeGesturesHandler.MacHelpText": liveRef.current.labels.zoomHintMac,
        "CooperativeGesturesHandler.MobileHelpText": liveRef.current.labels.zoomHintMobile,
      },
    });
    mapRef.current = map;
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "municipality-hover-popup",
    });
    map.on("load", () => {
      const markReady = (event: MapSourceDataEvent) => {
        if (event.sourceId === SOURCE_ID)
          map.once("render", () => {
            if (map.querySourceFeatures(SOURCE_ID).length > 0) {
              setReady(true);
              map.off("sourcedata", markReady);
            }
          });
      };
      map.on("sourcedata", markReady);
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: "/data/municipalities-at-2026.geojson",
        promoteId: "municipalityCode",
        attribution: "© Statistik Austria, CC BY 4.0",
      });
      for (const [code, value] of Object.entries(liveRef.current.metricValues))
        map.setFeatureState(
          { source: SOURCE_ID, id: code },
          { metric: value ?? 0, hasMetric: value !== null },
        );
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": metricColorExpression(liveRef.current.colorInputs),
          "fill-opacity": [
            "case",
            ["!", ["boolean", ["feature-state", "hasMetric"], false]],
            MAP_NO_DATA_OPACITY,
            ["boolean", ["feature-state", "hover"], false],
            MAP_HOVER_FILL_OPACITY,
            MAP_FILL_OPACITY,
          ],
          "fill-outline-color": "#f8faf9",
        },
      });
      map.addLayer({
        id: "municipality-lines",
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#000000",
            ["boolean", ["feature-state", "hover"], false],
            "#0f766e",
            "#ffffff",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3.5,
            ["boolean", ["feature-state", "hover"], false],
            1.4,
            0.65,
          ],
          "line-opacity": 0.95,
        },
      });
      if (liveRef.current.selected) {
        selectedIdRef.current = liveRef.current.selected.municipalityCode;
        map.setFeatureState(
          { source: SOURCE_ID, id: selectedIdRef.current },
          { selected: true },
        );
      }
    });
    map.on("mousemove", FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
      const properties = featureProperties(event);
      const featureId = event.features?.[0]?.id;
      if (!properties || featureId === undefined) return;
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== featureId)
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredIdRef.current },
          { hover: false },
        );
      hoveredIdRef.current = featureId;
      map.setFeatureState(
        { source: SOURCE_ID, id: featureId },
        { hover: true },
      );
      map.getCanvas().style.cursor = "pointer";
      const live = liveRef.current;
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = properties.name;
      const value = document.createElement("span");
      value.textContent =
        live.tooltipValues
          ? (live.tooltipValues[properties.municipalityCode] ?? "—")
          : `${live.labels.population}: ${personsFormatter.format(live.metricValues[properties.municipalityCode] ?? 0)}`;
      const location = document.createElement("span");
      location.textContent = `${properties.state} · ${live.labels.municipalityCode} ${properties.municipalityCode}`;
      content.append(title, value, location);
      popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    });
    map.on("mouseleave", FILL_LAYER_ID, () => {
      if (hoveredIdRef.current !== null)
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredIdRef.current },
          { hover: false },
        );
      hoveredIdRef.current = null;
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.on("click", FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
      const properties = featureProperties(event);
      if (properties) liveRef.current.onSelect(properties.municipalityCode);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [austriaBounds, personsFormatter]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE_ID)) return;
    if (selectedIdRef.current !== null)
      map.setFeatureState(
        { source: SOURCE_ID, id: selectedIdRef.current },
        { selected: false },
      );
    if (selected) {
      selectedIdRef.current = selected.municipalityCode;
      map.setFeatureState(
        { source: SOURCE_ID, id: selected.municipalityCode },
        { selected: true },
      );
    } else selectedIdRef.current = null;
  }, [selected]);

  const controlButton =
    "rounded-md px-2 py-1 text-[10px] font-medium aria-pressed:bg-teal-700 aria-pressed:text-white hover:bg-accent";
  const isDiverging =
    (metric === "movement" && movementPalette === "diverging") ||
    (metric === "costs" && costMeasure === "peer-deviation");
  // The bar has to carry the same non-linear stops as the map, otherwise it reports a
  // value range the fills never use.
  const legendGradient = isDiverging
    ? divergingColorStops(1)
        .map(({ color, offset }) => `${color} ${(offset * 100).toFixed(1)}%`)
        .join(",")
    : (metric === "movement" ? MOVEMENT_COLORS : metric === "costs" ? COST_COLORS : AGE_COLORS).join(",");
  return (
    <div
      className="relative h-full min-h-0 overflow-hidden rounded-2xl bg-[#e8ece9]"
      data-testid="municipality-map"
      data-map-ready={ready}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label={labels.map}
      />
      <div className="absolute top-16 right-3 z-10 flex flex-col overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur lg:top-3">
        <button
          type="button"
          className="grid size-11 place-items-center text-lg hover:bg-accent lg:size-9"
          aria-label={labels.zoomIn}
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          className="grid size-11 place-items-center border-t text-lg hover:bg-accent lg:size-9"
          aria-label={labels.zoomOut}
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          className="min-h-11 border-t px-2 py-2 text-[10px] font-semibold whitespace-nowrap hover:bg-accent lg:min-h-0"
          aria-label={labels.reset}
          onClick={() => {
            mapRef.current?.fitBounds(asMapBounds(austriaBounds), {
              padding: 38,
              duration: 500,
            });
            onReset();
          }}
        >
          {labels.reset}
        </button>
      </div>
      {selected && selectedMetricHistory && analysisDataset && (
        <div className="hidden lg:block">
        <MunicipalityMetricChart
          metricLabel={metricLabel}
          municipalityName={selected.name}
          points={selectedMetricHistory}
          selectedYear={year}
          valueFormatter={chartValueFormatter}
          unitLabel={chartUnitLabel}
          changeLabels={chartChangeLabels}
          chartLabel={metricChartLabel}
          minimizeLabel={labels.minimizeChart}
          expandLabel={labels.expandChart}
          restoreLabel={labels.restoreChart}
          dataset={analysisDataset}
          addToAnalysisLabel={labels.addToAnalysis}
          dragToAnalysisLabel={labels.dragToAnalysis}
        />
        </div>
      )}
      <div
        className="absolute top-16 left-3 z-10 hidden w-[min(20rem,calc(100%-1.5rem))] rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur lg:block"
        data-testid="metric-control"
      >
        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
          <label
            htmlFor="municipality-metric"
            className="text-xs font-semibold"
          >
            {labels.metric}
          </label>
          <select
            id="municipality-metric"
            value={metric}
            className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs"
            onChange={(event) =>
              onMetricChange(event.target.value as MapMetric)
            }
          >
            <option value="population">{labels.populationMetric}</option>
            <option value="age">{labels.ageMetric}</option>
            <option value="movement">{labels.movementMetric}</option>
            <option value="costs">{labels.costsMetric}</option>
            <option value="politics">{labels.politicsMetric}</option>
          </select>
        </div>
        {metric === "population" && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label htmlFor="municipality-population-view" className="text-[10px] font-semibold">
                {labels.populationView}
              </label>
              <select
                id="municipality-population-view"
                value={populationView}
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]"
                onChange={(event) => onPopulationViewChange(event.target.value as PopulationViewId)}
              >
                {Object.entries(labels.populationViews).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
            {populationDefinition && (
              <p className="text-[10px] leading-4 text-muted-foreground" data-testid="population-definition">
                {populationDefinition}
              </p>
            )}
            {structureLoading && (
              <p className="text-[10px] text-muted-foreground">{labels.loadingStructure}</p>
            )}
            {structureError && (
              <p className="text-[10px] text-destructive" role="alert">{labels.structureError}</p>
            )}
          </div>
        )}
        {metric === "age" && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label
                htmlFor="municipality-age-view"
                className="text-[10px] font-semibold"
              >
                {labels.ageView}
              </label>
              <select
                id="municipality-age-view"
                value={ageView}
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]"
                onChange={(event) =>
                  onAgeViewChange(event.target.value as AgeViewId)
                }
              >
                <optgroup label={labels.ageGroupsHeading}>
                  {Object.entries(labels.ageGroups).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={labels.indicatorsHeading}>
                  {Object.entries(labels.indicators).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            {showAgeFilters ? (
              <div className="flex flex-wrap gap-1">
                <div className="flex rounded-lg border bg-background p-0.5">
                  {(["share", "persons"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={controlButton}
                      aria-pressed={ageMeasure === item}
                      onClick={() => onAgeMeasureChange(item)}
                    >
                      {labels.measures[item]}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-lg border bg-background p-0.5">
                  {(["all", "female", "male"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={controlButton}
                      aria-pressed={sex === item}
                      onClick={() => onSexChange(item)}
                    >
                      {labels.sexes[item]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p
                className="text-[10px] leading-4 text-muted-foreground"
                data-testid="indicator-definition"
              >
                {indicatorDefinition}
              </p>
            )}
            {ageLoading && (
              <p className="text-[10px] text-muted-foreground">
                {labels.loadingAge}
              </p>
            )}
            {ageError && (
              <p className="text-[10px] text-destructive" role="alert">
                {labels.ageError}
              </p>
            )}
          </div>
        )}
        {metric === "movement" && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label
                htmlFor="municipality-movement-view"
                className="text-[10px] font-semibold"
              >
                {labels.movementView}
              </label>
              <select
                id="municipality-movement-view"
                value={movementView}
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]"
                onChange={(event) =>
                  onMovementViewChange(event.target.value as MovementMetricId)
                }
              >
                {Object.entries(labels.movements).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {movementDefinition && (
              <p
                className="text-[10px] leading-4 text-muted-foreground"
                data-testid="movement-definition"
              >
                {movementDefinition}
              </p>
            )}
            {movementLoading && (
              <p className="text-[10px] text-muted-foreground">
                {labels.loadingMovement}
              </p>
            )}
            {movementError && (
              <p className="text-[10px] text-destructive" role="alert">
                {labels.movementError}
              </p>
            )}
          </div>
        )}
        {metric === "politics" && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label htmlFor="municipality-politics-view" className="text-[10px] font-semibold">{labels.politicsView}</label>
              <select id="municipality-politics-view" value={politicsView} className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]" onChange={(event) => onPoliticsViewChange(event.target.value as PoliticsView)}>
                {Object.entries(labels.politicsViews).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            {politicsView === "party-share" ? <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label htmlFor="municipality-politics-party" className="text-[10px] font-semibold">{labels.politicsParty}</label>
              <select id="municipality-politics-party" value={politicsParty} className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]" onChange={(event) => onPoliticsPartyChange(event.target.value as CanonicalPartyId)}>
                {Object.entries(labels.politicsParties).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div> : null}
            {politicsLoading ? <p className="text-[10px] text-muted-foreground">{labels.loadingPolitics}</p> : null}
            {politicsError ? <p className="text-[10px] text-destructive" role="alert">{labels.politicsError}</p> : null}
          </div>
        )}
        {metric === "costs" && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label htmlFor="municipality-cost-measure" className="text-[10px] font-semibold">
                {labels.costMeasure}
              </label>
              <select
                id="municipality-cost-measure"
                value={costMeasure}
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]"
                onChange={(event) => onCostMeasureChange(event.target.value as CostMeasureId)}
              >
                {Object.entries(labels.costMeasures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <label htmlFor="municipality-cost-view" className="text-[10px] font-semibold">
                {labels.costView}
              </label>
              <select
                id="municipality-cost-view"
                value={costCategory}
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-[10px]"
                onChange={(event) => onCostCategoryChange(event.target.value as CostCategoryId)}
              >
                {Object.entries(labels.costCategories).map(([id, label]) => (
                  <option key={id} value={id}>{id} · {label}</option>
                ))}
              </select>
            </div>
            {costsLoading && <p className="text-[10px] text-muted-foreground">{labels.loadingCosts}</p>}
            <p className="text-[10px] leading-4 text-muted-foreground" data-testid="cost-definition">
              {labels.costDefinition}
            </p>
            {peerGroupLabel && (
              <p className="rounded-md border border-teal-200 bg-teal-50 px-2 py-1.5 text-[10px] leading-4 text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-100" data-testid="peer-comparison-group">
                {peerGroupLabel}
              </p>
            )}
            {costsError && <p className="text-[10px] text-destructive" role="alert">{labels.costsError}</p>}
          </div>
        )}
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-2">
          <label
            htmlFor="municipality-population-year"
            className="text-xs font-semibold"
          >
            {labels.year}
          </label>
          <output
            htmlFor="municipality-population-year"
            className="text-sm font-semibold tabular-nums"
          >
            {year}
          </output>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-md border"
            aria-label={labels.previousYear}
            disabled={year === firstYear}
            onClick={() => onYearChange(year - 1)}
          >
            ‹
          </button>
          <input
            id="municipality-population-year"
            type="range"
            min={firstYear}
            max={latestYear}
            value={year}
            aria-label={labels.year}
            className="h-2 min-w-0 flex-1 accent-teal-700"
            onChange={(event) => onYearChange(Number(event.target.value))}
          />
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-md border"
            aria-label={labels.nextYear}
            disabled={year === latestYear}
            onClick={() => onYearChange(year + 1)}
          >
            ›
          </button>
        </div>
      </div>
      <div
        className="absolute bottom-3 left-3 z-10 hidden w-44 max-w-[calc(100%-1.5rem)] rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur lg:block"
        data-testid="population-legend"
      >
        <p className="text-xs font-semibold">{metricLabel}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {labels.reference}
        </p>
        {metric === "politics" && politicsView === "leading-list" ? (
          <ul className="mt-2 space-y-1" aria-label={metricLabel}>
            {[...CANONICAL_PARTIES, "tie" as const].map((party) => <li key={party} className="flex items-center gap-2 text-[10px]"><span className="size-3 rounded-[3px] border border-black/10" style={{ backgroundColor: POLITICS_PARTY_COLORS[party] }} /><span>{party === "tie" ? labels.politicsTie : labels.politicsParties[party]}</span></li>)}
          </ul>
        ) : usePopulationClasses ? (
          <ul className="mt-2 space-y-1" aria-label={metricLabel}>
            {POPULATION_CLASSES.map((item) => (
              <li
                key={item.minimum}
                className="flex items-center gap-2 text-[10px] tabular-nums"
              >
                <span
                  className="size-3 rounded-[3px] border border-black/10"
                  style={{ backgroundColor: item.color }}
                />
                <span>{populationClassLabel(item, personsFormatter)}</span>
              </li>
            ))}
          </ul>
        ) : (
          scaleDomain && (
            <>
              <div className="relative mt-2">
                <div
                  className="h-3 rounded-sm border border-black/10"
                  style={{ background: `linear-gradient(to right, ${legendGradient})` }}
                />
                {isDiverging && (
                  <span
                    className="absolute -top-0.5 h-4 w-px bg-foreground/60"
                    style={{ left: "50%" }}
                    data-testid="legend-zero-marker"
                  />
                )}
              </div>
              {/* The scale ends at the 95th percentile, so anything above shares the last
                  colour. Saying "≥" keeps the bar from claiming a range the fills exceed;
                  a diverging scale clips at both ends and gets "≤" as well. */}
              <div className="mt-1 flex justify-between gap-2 text-[9px] tabular-nums">
                <span>{isDiverging ? "≤ " : ""}{chartValueFormatter.format(scaleDomain[0])}</span>
                {isDiverging && <span className="text-muted-foreground">0</span>}
                <span>≥ {chartValueFormatter.format(scaleDomain[1])}</span>
              </div>
              {chartUnitLabel && (
                <p className="mt-1 text-[9px] text-muted-foreground">
                  {chartUnitLabel}
                </p>
              )}
            </>
          )
        )}
        <p className="mt-2 flex items-center gap-2 border-t pt-2 text-[10px] text-muted-foreground">
          <span
            className="size-3 rounded-[3px] border border-black/10"
            style={{ backgroundColor: MAP_NO_DATA_COLOR, opacity: MAP_NO_DATA_OPACITY }}
          />
          {labels.noData}
        </p>
      </div>

      {selected ? (
        <div className="absolute inset-x-3 bottom-[4.75rem] z-20 flex justify-center lg:hidden">
          <div className="flex max-w-full items-center overflow-hidden rounded-full border bg-background/95 shadow-lg backdrop-blur">
            <button
              type="button"
              className="flex min-h-11 min-w-0 items-center gap-2 px-4 text-left"
              onClick={onOpenDetails}
            >
              <MapPinned className="size-4 shrink-0 text-teal-700" />
              <span className="min-w-0 truncate text-sm font-semibold">{selected.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{labels.selected}</span>
            </button>
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center border-l hover:bg-accent"
              aria-label={labels.reset}
              onClick={onReset}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <nav
        className="absolute inset-x-3 bottom-3 z-20 grid grid-cols-3 overflow-hidden rounded-xl border bg-background/95 shadow-xl backdrop-blur lg:hidden"
        aria-label={labels.map}
      >
        <button
          type="button"
          className="flex min-h-12 items-center justify-center gap-2 px-2 text-xs font-semibold hover:bg-accent"
          onClick={() => setMobilePanel("display")}
        >
          <SlidersHorizontal className="size-4" />
          {labels.display}
        </button>
        <button
          type="button"
          className="flex min-h-12 items-center justify-center gap-2 border-x px-2 text-xs font-semibold hover:bg-accent"
          onClick={() => setMobilePanel("legend")}
        >
          <ListFilter className="size-4" />
          {labels.legend}
        </button>
        <button
          type="button"
          className="flex min-h-12 items-center justify-center gap-2 px-2 text-xs font-semibold hover:bg-accent"
          onClick={onOpenDetails}
        >
          <Info className="size-4" />
          {labels.details}
        </button>
      </nav>

      <MobileBottomSheet
        open={mobilePanel === "display"}
        onOpenChange={(open) => setMobilePanel(open ? "display" : null)}
        title={labels.display}
        description={metricLabel}
        closeLabel={labels.close}
      >
        <div className="space-y-5" data-testid="mobile-metric-control">
          <div className="space-y-2">
            <label htmlFor="municipality-metric-mobile" className="text-sm font-semibold">{labels.metric}</label>
            <select
              id="municipality-metric-mobile"
              value={metric}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              onChange={(event) => onMetricChange(event.target.value as MapMetric)}
            >
              <option value="population">{labels.populationMetric}</option>
              <option value="age">{labels.ageMetric}</option>
              <option value="movement">{labels.movementMetric}</option>
              <option value="costs">{labels.costsMetric}</option>
            <option value="politics">{labels.politicsMetric}</option>
            </select>
          </div>

          {metric === "population" ? (
            <div className="space-y-2 border-t pt-4">
              <label htmlFor="municipality-population-view-mobile" className="text-sm font-semibold">{labels.populationView}</label>
              <select
                id="municipality-population-view-mobile"
                value={populationView}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(event) => onPopulationViewChange(event.target.value as PopulationViewId)}
              >
                {Object.entries(labels.populationViews).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              {populationDefinition ? <p className="text-xs leading-5 text-muted-foreground">{populationDefinition}</p> : null}
              {structureLoading ? <p className="text-xs text-muted-foreground">{labels.loadingStructure}</p> : null}
              {structureError ? <p className="text-xs text-destructive" role="alert">{labels.structureError}</p> : null}
            </div>
          ) : null}

          {metric === "age" ? (
            <div className="space-y-3 border-t pt-4">
              <label htmlFor="municipality-age-view-mobile" className="text-sm font-semibold">{labels.ageView}</label>
              <select
                id="municipality-age-view-mobile"
                value={ageView}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(event) => onAgeViewChange(event.target.value as AgeViewId)}
              >
                <optgroup label={labels.ageGroupsHeading}>
                  {Object.entries(labels.ageGroups).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </optgroup>
                <optgroup label={labels.indicatorsHeading}>
                  {Object.entries(labels.indicators).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </optgroup>
              </select>
              {showAgeFilters ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 overflow-hidden rounded-lg border">
                    {(["share", "persons"] as const).map((item) => (
                      <button key={item} type="button" className="min-h-11 px-3 text-sm font-medium aria-pressed:bg-teal-700 aria-pressed:text-white" aria-pressed={ageMeasure === item} onClick={() => onAgeMeasureChange(item)}>{labels.measures[item]}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 overflow-hidden rounded-lg border">
                    {(["all", "female", "male"] as const).map((item) => (
                      <button key={item} type="button" className="min-h-11 px-2 text-sm font-medium aria-pressed:bg-teal-700 aria-pressed:text-white" aria-pressed={sex === item} onClick={() => onSexChange(item)}>{labels.sexes[item]}</button>
                    ))}
                  </div>
                </div>
              ) : <p className="text-xs leading-5 text-muted-foreground">{indicatorDefinition}</p>}
              {ageLoading ? <p className="text-xs text-muted-foreground">{labels.loadingAge}</p> : null}
              {ageError ? <p className="text-xs text-destructive" role="alert">{labels.ageError}</p> : null}
            </div>
          ) : null}

          {metric === "movement" ? (
            <div className="space-y-2 border-t pt-4">
              <label htmlFor="municipality-movement-view-mobile" className="text-sm font-semibold">{labels.movementView}</label>
              <select
                id="municipality-movement-view-mobile"
                value={movementView}
                className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                onChange={(event) => onMovementViewChange(event.target.value as MovementMetricId)}
              >
                {Object.entries(labels.movements).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              {movementDefinition ? <p className="text-xs leading-5 text-muted-foreground">{movementDefinition}</p> : null}
              {movementLoading ? <p className="text-xs text-muted-foreground">{labels.loadingMovement}</p> : null}
              {movementError ? <p className="text-xs text-destructive" role="alert">{labels.movementError}</p> : null}
            </div>
          ) : null}

          {metric === "politics" ? (
            <div className="space-y-3 border-t pt-4">
              <div className="space-y-2"><label htmlFor="municipality-politics-view-mobile" className="text-sm font-semibold">{labels.politicsView}</label>
                <select id="municipality-politics-view-mobile" value={politicsView} className="h-11 w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => onPoliticsViewChange(event.target.value as PoliticsView)}>
                  {Object.entries(labels.politicsViews).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select></div>
              {politicsView === "party-share" ? <div className="space-y-2"><label htmlFor="municipality-politics-party-mobile" className="text-sm font-semibold">{labels.politicsParty}</label>
                <select id="municipality-politics-party-mobile" value={politicsParty} className="h-11 w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => onPoliticsPartyChange(event.target.value as CanonicalPartyId)}>
                  {Object.entries(labels.politicsParties).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select></div> : null}
              {politicsLoading ? <p className="text-xs text-muted-foreground">{labels.loadingPolitics}</p> : null}
              {politicsError ? <p className="text-xs text-destructive" role="alert">{labels.politicsError}</p> : null}
            </div>
          ) : null}

          {metric === "costs" ? (
            <div className="space-y-3 border-t pt-4">
              <div className="space-y-2">
                <label htmlFor="municipality-cost-measure-mobile" className="text-sm font-semibold">{labels.costMeasure}</label>
                <select id="municipality-cost-measure-mobile" value={costMeasure} className="h-11 w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => onCostMeasureChange(event.target.value as CostMeasureId)}>
                  {Object.entries(labels.costMeasures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="municipality-cost-view-mobile" className="text-sm font-semibold">{labels.costView}</label>
                <select id="municipality-cost-view-mobile" value={costCategory} className="h-11 w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => onCostCategoryChange(event.target.value as CostCategoryId)}>
                  {Object.entries(labels.costCategories).map(([id, label]) => <option key={id} value={id}>{id} · {label}</option>)}
                </select>
              </div>
              {costsLoading ? <p className="text-xs text-muted-foreground">{labels.loadingCosts}</p> : null}
              <p className="text-xs leading-5 text-muted-foreground">{labels.costDefinition}</p>
              {peerGroupLabel ? <p className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-900 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-100">{peerGroupLabel}</p> : null}
              {costsError ? <p className="text-xs text-destructive" role="alert">{labels.costsError}</p> : null}
            </div>
          ) : null}

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="municipality-population-year-mobile" className="text-sm font-semibold">{labels.year}</label>
              <output htmlFor="municipality-population-year-mobile" className="text-lg font-semibold tabular-nums">{year}</output>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-md border text-xl" aria-label={labels.previousYear} disabled={year === firstYear} onClick={() => onYearChange(year - 1)}>‹</button>
              <input id="municipality-population-year-mobile" type="range" min={firstYear} max={latestYear} value={year} aria-label={labels.year} className="h-2 min-w-0 flex-1 accent-teal-700" onChange={(event) => onYearChange(Number(event.target.value))} />
              <button type="button" className="grid size-11 shrink-0 place-items-center rounded-md border text-xl" aria-label={labels.nextYear} disabled={year === latestYear} onClick={() => onYearChange(year + 1)}>›</button>
            </div>
          </div>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={mobilePanel === "legend"}
        onOpenChange={(open) => setMobilePanel(open ? "legend" : null)}
        title={labels.legend}
        description={labels.reference}
        closeLabel={labels.close}
      >
        <div data-testid="mobile-population-legend">
          <p className="text-sm font-semibold">{metricLabel}</p>
          {metric === "politics" && politicsView === "leading-list" ? (
            <ul className="mt-3 grid grid-cols-2 gap-2" aria-label={metricLabel}>
              {[...CANONICAL_PARTIES, "tie" as const].map((party) => <li key={party} className="flex items-center gap-2 text-xs"><span className="size-4 rounded-[3px] border border-black/10" style={{ backgroundColor: POLITICS_PARTY_COLORS[party] }} /><span>{party === "tie" ? labels.politicsTie : labels.politicsParties[party]}</span></li>)}
            </ul>
          ) : usePopulationClasses ? (
            <ul className="mt-3 grid grid-cols-2 gap-2" aria-label={metricLabel}>
              {POPULATION_CLASSES.map((item) => (
                <li key={item.minimum} className="flex items-center gap-2 text-xs tabular-nums">
                  <span className="size-4 rounded-[3px] border border-black/10" style={{ backgroundColor: item.color }} />
                  <span>{populationClassLabel(item, personsFormatter)}</span>
                </li>
              ))}
            </ul>
          ) : scaleDomain ? (
            <>
              <div className="relative mt-4">
                <div className="h-5 rounded-sm border border-black/10" style={{ background: `linear-gradient(to right, ${legendGradient})` }} />
                {isDiverging ? <span className="absolute -top-0.5 h-6 w-px bg-foreground/60" style={{ left: "50%" }} /> : null}
              </div>
              <div className="mt-2 flex justify-between gap-2 text-xs tabular-nums">
                <span>{isDiverging ? "≤ " : ""}{chartValueFormatter.format(scaleDomain[0])}</span>
                {isDiverging ? <span className="text-muted-foreground">0</span> : null}
                <span>≥ {chartValueFormatter.format(scaleDomain[1])}</span>
              </div>
              {chartUnitLabel ? <p className="mt-1 text-xs text-muted-foreground">{chartUnitLabel}</p> : null}
            </>
          ) : null}
          <p className="mt-4 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span className="size-4 rounded-[3px] border border-black/10" style={{ backgroundColor: MAP_NO_DATA_COLOR, opacity: MAP_NO_DATA_OPACITY }} />
            {labels.noData}
          </p>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
