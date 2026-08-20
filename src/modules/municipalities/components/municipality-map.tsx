"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { MapLayerMouseEvent, MapSourceDataEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MunicipalityBounds, MunicipalityIndexItem, MunicipalityProperties } from "../data";

const SOURCE_ID = "austrian-municipalities";
const FILL_LAYER_ID = "municipality-fills";
maplibregl.setWorkerUrl("/vendor/maplibre-gl/maplibre-gl-worker.mjs");

const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "basemap-at": {
      type: "raster",
      tiles: ["https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© basemap.at",
    },
  },
  layers: [
    { id: "map-background", type: "background", paint: { "background-color": "#e8ece9" } },
    { id: "basemap-at", type: "raster", source: "basemap-at", paint: { "raster-opacity": 0.72, "raster-saturation": -0.7 } },
  ],
};

function asMapBounds(bounds: MunicipalityBounds): [[number, number], [number, number]] {
  return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
}

function featureProperties(event: MapLayerMouseEvent): MunicipalityProperties | null {
  const properties = event.features?.[0]?.properties;
  if (!properties || typeof properties.municipalityCode !== "string" || typeof properties.name !== "string" || typeof properties.state !== "string") return null;
  return properties as MunicipalityProperties;
}

export function MunicipalityMap({
  austriaBounds,
  selected,
  onSelect,
  onReset,
  mapLabel,
  zoomInLabel,
  zoomOutLabel,
  resetLabel,
  municipalityCodeLabel,
}: {
  austriaBounds: MunicipalityBounds;
  selected: MunicipalityIndexItem | null;
  onSelect: (municipalityCode: string) => void;
  onReset: () => void;
  mapLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  resetLabel: string;
  municipalityCodeLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hoveredIdRef = useRef<string | number | null>(null);
  const selectedIdRef = useRef<string | number | null>(null);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      bounds: asMapBounds(austriaBounds),
      fitBoundsOptions: { padding: 38 },
      maxBounds: [[8.2, 45.4], [18.4, 50.1]],
      minZoom: 5,
      maxZoom: 14,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    mapRef.current = map;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "municipality-hover-popup" });
    popupRef.current = popup;

    map.on("load", () => {
      const markReady = (event: MapSourceDataEvent) => {
        if (event.sourceId !== SOURCE_ID) return;
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
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0f766e", ["boolean", ["feature-state", "hover"], false], "#14b8a6", "#68a9a1"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.62, ["boolean", ["feature-state", "hover"], false], 0.5, 0.3],
          "fill-outline-color": "#f8faf9",
        },
      });
      map.addLayer({
        id: "municipality-lines",
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#083f3a", "#ffffff"],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.4, 0.65],
          "line-opacity": 0.95,
        },
      });

      const current = selectedRef.current;
      if (current) {
        selectedIdRef.current = current.municipalityCode;
        map.setFeatureState({ source: SOURCE_ID, id: current.municipalityCode }, { selected: true });
        map.fitBounds(asMapBounds(current.bounds), { padding: 64, maxZoom: 11, duration: 0 });
      }
    });

    map.on("mousemove", FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
      const properties = featureProperties(event);
      const featureId = event.features?.[0]?.id;
      if (!properties || featureId === undefined) return;
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== featureId) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
      }
      hoveredIdRef.current = featureId;
      map.setFeatureState({ source: SOURCE_ID, id: featureId }, { hover: true });
      map.getCanvas().style.cursor = "pointer";

      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = properties.name;
      const detail = document.createElement("span");
      detail.textContent = `${properties.state} · ${municipalityCodeLabel} ${properties.municipalityCode}`;
      content.append(title, detail);
      popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map);
    });

    map.on("mouseleave", FILL_LAYER_ID, () => {
      if (hoveredIdRef.current !== null) map.setFeatureState({ source: SOURCE_ID, id: hoveredIdRef.current }, { hover: false });
      hoveredIdRef.current = null;
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    map.on("click", FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
      const properties = featureProperties(event);
      if (properties) onSelectRef.current(properties.municipalityCode);
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      popup.remove();
      map.remove();
      popupRef.current = null;
      mapRef.current = null;
    };
  }, [austriaBounds, municipalityCodeLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(SOURCE_ID)) return;
    if (selectedIdRef.current !== null) map.setFeatureState({ source: SOURCE_ID, id: selectedIdRef.current }, { selected: false });
    if (selected) {
      selectedIdRef.current = selected.municipalityCode;
      map.setFeatureState({ source: SOURCE_ID, id: selected.municipalityCode }, { selected: true });
      map.fitBounds(asMapBounds(selected.bounds), { padding: 64, maxZoom: 11, duration: 500 });
    } else {
      selectedIdRef.current = null;
      map.fitBounds(asMapBounds(austriaBounds), { padding: 38, duration: 500 });
    }
  }, [austriaBounds, selected]);

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden rounded-2xl bg-[#e8ece9]"
      data-testid="municipality-map"
      data-map-ready={ready}
    >
      <div ref={containerRef} className="h-full w-full" aria-label={mapLabel} />
      <div className="absolute top-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur">
        <button type="button" className="grid size-9 place-items-center text-lg hover:bg-accent" aria-label={zoomInLabel} onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button type="button" className="grid size-9 place-items-center border-t text-lg hover:bg-accent" aria-label={zoomOutLabel} onClick={() => mapRef.current?.zoomOut()}>−</button>
        <button
          type="button"
          className="border-t px-2 py-2 text-[10px] font-semibold whitespace-nowrap hover:bg-accent"
          aria-label={resetLabel}
          onClick={() => {
            mapRef.current?.fitBounds(asMapBounds(austriaBounds), { padding: 38, duration: 500 });
            onReset();
          }}
        >
          {resetLabel}
        </button>
      </div>
    </div>
  );
}
