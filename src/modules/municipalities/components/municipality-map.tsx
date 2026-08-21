"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import * as maplibregl from "maplibre-gl";
import type {
  ExpressionSpecification,
  MapLayerMouseEvent,
  MapSourceDataEvent,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
import type { PopulationViewId } from "../structure";
import { POPULATION_CLASSES } from "../population";
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
  "#d7ddda",
  0,
  "#e2f2ee",
  1_000,
  "#b9ddd6",
  2_500,
  "#7fc2b7",
  5_000,
  "#42a394",
  10_000,
  "#177b70",
  50_000,
  "#0a4d47",
];
const AGE_COLORS = [
  "#e2f2ee",
  "#b9ddd6",
  "#7fc2b7",
  "#42a394",
  "#177b70",
  "#0a4d47",
];
const MOVEMENT_COLORS = [
  "#f3e8ff",
  "#ddd6fe",
  "#c4b5fd",
  "#8b5cf6",
  "#6d28d9",
  "#4c1d95",
];
const DIVERGING_COLORS = [
  "#b2182b",
  "#ef8a62",
  "#f7f7f7",
  "#67a9cf",
  "#2166ac",
];

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
    "#d7ddda",
  ];
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
  return [
    "case",
    ["boolean", ["feature-state", "hasMetric"], false],
    [
      "interpolate",
      ["linear"],
      value,
      -maximum,
      DIVERGING_COLORS[0],
      -maximum / 2,
      DIVERGING_COLORS[1],
      0,
      DIVERGING_COLORS[2],
      maximum / 2,
      DIVERGING_COLORS[3],
      maximum,
      DIVERGING_COLORS[4],
    ],
    "#d7ddda",
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
  minimizeChart: string;
  expandChart: string;
  loadingAge: string;
  ageError: string;
  loadingMovement: string;
  movementError: string;
  loadingStructure: string;
  structureError: string;
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
  movementDefinition,
  showAgeFilters,
  indicatorDefinition,
  ageLoading,
  ageError,
  movementLoading,
  movementError,
  structureLoading,
  structureError,
  onYearChange,
  onMetricChange,
  onPopulationViewChange,
  onAgeViewChange,
  onAgeMeasureChange,
  onSexChange,
  onMovementViewChange,
  onSelect,
  onReset,
  labels,
  selectedMetricHistory,
  metricChartLabel,
  metricLabel,
  chartValueFormatter,
  chartUnitLabel,
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
  movementDefinition: string | null;
  showAgeFilters: boolean;
  indicatorDefinition: string | null;
  ageLoading: boolean;
  ageError: boolean;
  movementLoading: boolean;
  movementError: boolean;
  structureLoading: boolean;
  structureError: boolean;
  onYearChange: (year: number) => void;
  onMetricChange: (metric: MapMetric) => void;
  onPopulationViewChange: (view: PopulationViewId) => void;
  onAgeViewChange: (view: AgeViewId) => void;
  onAgeMeasureChange: (measure: AgeMeasure) => void;
  onSexChange: (sex: SexFilter) => void;
  onMovementViewChange: (view: MovementMetricId) => void;
  onSelect: (code: string) => void;
  onReset: () => void;
  labels: Labels;
  selectedMetricHistory: Array<{ year: number; value: number }> | null;
  metricChartLabel: string;
  metricLabel: string;
  chartValueFormatter: Intl.NumberFormat;
  chartUnitLabel: string;
}) {
  const locale = useLocale();
  const personsFormatter = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const hoveredIdRef = useRef<string | number | null>(null);
  const selectedIdRef = useRef<string | number | null>(null);
  const liveRef = useRef({
    selected,
    onSelect,
    metric,
    metricValues,
    tooltipValues,
    labels,
  });
  useEffect(() => {
    liveRef.current = {
      selected,
      onSelect,
      metric,
      metricValues,
      tooltipValues,
      labels,
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
      const color =
        usePopulationClasses || !scaleDomain
          ? POPULATION_COLOR
          : metric === "movement"
            ? movementPalette === "diverging"
              ? divergingColorExpression(scaleDomain)
              : sequentialColorExpression(scaleDomain, MOVEMENT_COLORS)
            : sequentialColorExpression(scaleDomain, AGE_COLORS);
      map.setPaintProperty(FILL_LAYER_ID, "fill-color", color);
    }
  }, [metric, metricValues, movementPalette, ready, scaleDomain, usePopulationClasses]);

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
          "fill-color": POPULATION_COLOR,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.82,
            0.7,
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
      <div className="absolute top-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur">
        <button
          type="button"
          className="grid size-9 place-items-center text-lg hover:bg-accent"
          aria-label={labels.zoomIn}
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          className="grid size-9 place-items-center border-t text-lg hover:bg-accent"
          aria-label={labels.zoomOut}
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          className="border-t px-2 py-2 text-[10px] font-semibold whitespace-nowrap hover:bg-accent"
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
      {selected && selectedMetricHistory && (
        <MunicipalityMetricChart
          metricLabel={metricLabel}
          municipalityName={selected.name}
          points={selectedMetricHistory}
          selectedYear={year}
          valueFormatter={chartValueFormatter}
          unitLabel={chartUnitLabel}
          chartLabel={metricChartLabel}
          minimizeLabel={labels.minimizeChart}
          expandLabel={labels.expandChart}
        />
      )}
      <div
        className="absolute top-16 left-3 z-10 w-[min(20rem,calc(100%-1.5rem))] rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
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
        className="absolute bottom-3 left-3 z-10 w-44 max-w-[calc(100%-1.5rem)] rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur"
        data-testid="population-legend"
      >
        <p className="text-xs font-semibold">{metricLabel}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {labels.reference}
        </p>
        {usePopulationClasses ? (
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
              <div
                className="mt-2 h-3 rounded-sm border border-black/10"
                style={{
                  background: `linear-gradient(to right, ${(metric === "movement" ? (movementPalette === "diverging" ? DIVERGING_COLORS : MOVEMENT_COLORS) : AGE_COLORS).join(",")})`,
                }}
              />
              <div className="mt-1 flex justify-between gap-2 text-[9px] tabular-nums">
                <span>{chartValueFormatter.format(scaleDomain[0])}</span>
                <span>{chartValueFormatter.format(scaleDomain[1])}</span>
              </div>
              {chartUnitLabel && (
                <p className="mt-1 text-[9px] text-muted-foreground">
                  {chartUnitLabel}
                </p>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
