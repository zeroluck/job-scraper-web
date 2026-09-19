"use client";

import { useMemo, useState } from "react";
import {
  Map,
  NavigationControl,
  Popup,
  ScaleControl,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import { Flame, MapPin, Radar } from "lucide-react";
import * as maplibregl from "maplibre-gl";

import type { LocationInsight } from "@/types";
import {
  bubbleRadius,
  contentionCoverage,
  mapMetric,
  mapWeight,
  mappedLocations,
  opportunityLocation,
  smallestBubble,
  type LocationMapMode,
} from "./locationMapMetrics";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors &copy; <a href=\"https://carto.com/attributions\">CARTO</a>",
    },
  },
  layers: [
    {
      id: "carto-positron",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
      paint: { "raster-opacity": 0.9 },
    },
  ],
};

type MapFeatureProperties = {
  label: string;
  count: number;
  metric: number;
  bubbleRadius: number;
  bubbleVisible: boolean;
  densityVisible: boolean;
  contentionVisible: boolean;
  densityWeight: number;
  contentionWeight: number;
  rate: number;
  coverage: number;
  initialApplicants: number;
  observationLag: number;
  observedJobs: number;
};

type HeatmapVisibility = {
  density: boolean;
  contention: boolean;
};

const DENSITY_HEAT_COLORS: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(186,230,253,0)",
  0.16, "rgba(125,211,252,0.72)",
  0.38, "rgba(56,189,248,0.82)",
  0.68, "rgba(2,132,199,0.9)",
  1, "rgba(12,74,110,0.96)",
];

const CONTENTION_HEAT_COLORS: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["heatmap-density"],
  0, "rgba(254,240,138,0)",
  0.16, "rgba(253,224,71,0.72)",
  0.38, "rgba(251,146,60,0.82)",
  0.68, "rgba(234,88,12,0.9)",
  1, "rgba(153,27,27,0.96)",
];

type HoveredFeature = MapFeatureProperties & {
  longitude: number;
  latitude: number;
};

function formatMetric(value: number, mode: LocationMapMode, perCapita: boolean): string {
  if (mode === "contention") return `${value.toFixed(1)} applicants/hour`;
  if (perCapita) return `${value.toFixed(1)} jobs per 100k`;
  return `${Math.round(value).toLocaleString("en-CA")} active jobs`;
}

export default function LocationMapClient({
  locations,
  selectedKeyword,
  perCapita,
  stabilized,
  onLocationClick,
}: {
  locations: LocationInsight[];
  selectedKeyword?: string;
  perCapita: boolean;
  stabilized: boolean;
  onLocationClick: (keyword: string, category: string) => void;
}) {
  const availableLocations = useMemo(() => mappedLocations(locations), [locations]);
  const hasContention = locations.some((location) => location.applicants_per_hour != null);
  const [mode, setMode] = useState<LocationMapMode>("density");
  const [heatmaps, setHeatmaps] = useState<HeatmapVisibility>({
    density: true,
    contention: false,
  });
  const [hovered, setHovered] = useState<HoveredFeature | null>(null);
  const activeMode = mode === "contention" && !hasContention ? "density" : mode;
  const showDensityHeat = heatmaps.density;
  const showContentionHeat = heatmaps.contention && hasContention;
  const bothHeatmaps = showDensityHeat && showContentionHeat;

  const featureCollection = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: availableLocations.flatMap((location) => {
      const densityMetric = mapMetric(location, "density", perCapita, stabilized);
      const contentionMetric = mapMetric(location, "contention", perCapita, stabilized);
      const metric = activeMode === "contention" ? contentionMetric : densityMetric;
      if (location.longitude == null || location.latitude == null) return [];
      return [{
        type: "Feature" as const,
        id: location.bucket,
        geometry: {
          type: "Point" as const,
          coordinates: [location.longitude, location.latitude],
        },
        properties: {
          label: location.keyword,
          count: location.count,
          metric: metric ?? -1,
          bubbleRadius: metric == null ? 0 : bubbleRadius(metric, activeMode, perCapita),
          bubbleVisible: metric != null,
          densityVisible: densityMetric != null,
          contentionVisible: contentionMetric != null,
          densityWeight: densityMetric == null ? 0 : mapWeight(densityMetric, "density", perCapita),
          contentionWeight: contentionMetric == null ? 0 : mapWeight(contentionMetric, "contention", false),
          rate: location.applicants_per_hour ?? -1,
          coverage: contentionCoverage(location),
          initialApplicants: location.initial_applicants_median ?? -1,
          observationLag: location.first_observation_lag_hours ?? -1,
          observedJobs: location.observed_contention_jobs,
        },
      }];
    }),
  }), [activeMode, availableLocations, perCapita, stabilized]);

  const bounds = useMemo(() => {
    if (!availableLocations.length) return undefined;
    const longitudes = availableLocations.map((location) => location.longitude!);
    const latitudes = availableLocations.map((location) => location.latitude!);
    let west = Math.min(...longitudes);
    let east = Math.max(...longitudes);
    let south = Math.min(...latitudes);
    let north = Math.max(...latitudes);
    if (west === east) {
      west -= 0.75;
      east += 0.75;
    }
    if (south === north) {
      south -= 0.5;
      north += 0.5;
    }
    return [[west, south], [east, north]] as [[number, number], [number, number]];
  }, [availableLocations]);

  const strongest = useMemo(() => availableLocations.reduce<LocationInsight | null>(
    (best, location) => {
      const value = mapMetric(location, "density", perCapita, stabilized) ?? -1;
      const bestValue = best ? mapMetric(best, "density", perCapita, stabilized) ?? -1 : -1;
      return value > bestValue ? location : best;
    },
    null,
  ), [availableLocations, perCapita, stabilized]);
  const opportunity = useMemo(() => opportunityLocation(availableLocations), [availableLocations]);
  const mappedJobs = availableLocations.reduce((sum, location) => sum + location.count, 0);
  const totalJobs = locations.reduce((sum, location) => sum + location.count, 0);
  const mappedShare = totalJobs ? mappedJobs / totalJobs : 0;

  const onMouseMove = (event: MapLayerMouseEvent) => {
    const feature = smallestBubble(
      event.features ?? [],
      (candidate) => Number(candidate.properties?.bubbleRadius ?? Number.POSITIVE_INFINITY),
    );
    if (!feature || feature.geometry.type !== "Point") {
      setHovered(null);
      return;
    }
    const properties = feature.properties as MapFeatureProperties;
    setHovered({
      ...properties,
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1],
    });
  };

  const onClick = (event: MapLayerMouseEvent) => {
    const feature = smallestBubble(
      event.features ?? [],
      (candidate) => Number(candidate.properties?.bubbleRadius ?? Number.POSITIVE_INFINITY),
    );
    const label = feature?.properties?.label;
    if (typeof label === "string") onLocationClick(label, "location");
  };

  const mapStyle = useMemo<maplibregl.StyleSpecification>(() => ({
    ...MAP_STYLE,
    sources: {
      ...MAP_STYLE.sources,
      "job-areas": { type: "geojson", data: featureCollection },
    },
    layers: [
      ...MAP_STYLE.layers,
      ...(showDensityHeat ? [{
        id: "job-area-density-heat",
        type: "heatmap",
        source: "job-areas",
        maxzoom: 11,
        filter: ["==", ["get", "densityVisible"], true],
        paint: {
          "heatmap-weight": ["get", "densityWeight"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 9, 1.75],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 30, 9, 74],
          "heatmap-color": DENSITY_HEAT_COLORS,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 1, bothHeatmaps ? 0.44 : 0.62, 9, bothHeatmaps ? 0.4 : 0.56, 11, 0.12],
        },
      }] : []),
      ...(showContentionHeat ? [{
        id: "job-area-contention-heat",
        type: "heatmap",
        source: "job-areas",
        maxzoom: 11,
        filter: ["==", ["get", "contentionVisible"], true],
        paint: {
          "heatmap-weight": ["get", "contentionWeight"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.68, 9, 1.65],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 34, 9, 80],
          "heatmap-color": CONTENTION_HEAT_COLORS,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 1, bothHeatmaps ? 0.42 : 0.6, 9, bothHeatmaps ? 0.38 : 0.54, 11, 0.12],
        },
      }] : []),
      {
        id: "job-area-points",
        type: "circle",
        source: "job-areas",
        filter: ["==", ["get", "bubbleVisible"], true],
        layout: {
          "circle-sort-key": ["*", -1, ["get", "bubbleRadius"]],
        },
        paint: {
          "circle-radius": ["get", "bubbleRadius"],
          "circle-color": activeMode === "contention" ? "#9f1239" : "#334155",
          "circle-opacity": 0.62,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
          "circle-stroke-opacity": 0.9,
        },
      },
      {
        id: "selected-job-area",
        type: "circle",
        source: "job-areas",
        filter: ["all", ["==", ["get", "bubbleVisible"], true], ["==", ["get", "label"], selectedKeyword ?? ""]],
        paint: {
          "circle-radius": ["+", ["get", "bubbleRadius"], 5],
          "circle-color": "rgba(255,255,255,0)",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 3,
        },
      },
    ],
  }) as maplibregl.StyleSpecification, [activeMode, bothHeatmaps, featureCollection, selectedKeyword, showContentionHeat, showDensityHeat]);

  const toggleHeatmap = (heatmap: keyof HeatmapVisibility) => {
    setHeatmaps((current) => ({ ...current, [heatmap]: !current[heatmap] }));
  };

  return (
    <section aria-labelledby="location-map-title" className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-teal-50 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
              <Radar className="h-3.5 w-3.5" aria-hidden="true" /> Geographic signal
            </p>
            <h2 id="location-map-title" className="text-lg font-semibold text-slate-900">Where opportunity is concentrated</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">Click an area to inspect its jobs. Density and applicant activity use the same committed filters as every other insight.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Bubbles</p>
              <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm" role="radiogroup" aria-label="Bubble metric">
                <button
                  type="button"
                  role="radio"
                  aria-checked={activeMode === "density"}
                  onClick={() => setMode("density")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeMode === "density" ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  Density
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={activeMode === "contention"}
                  disabled={!hasContention}
                  title={hasContention ? "Size bubbles by reported applicant activity" : "No applicant observations under these filters"}
                  onClick={() => setMode("contention")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeMode === "contention" ? "bg-rose-800 text-white" : "text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"}`}
                >
                  Contention
                </button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Heatmaps</p>
              <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Heatmap visibility">
                <button
                  type="button"
                  role="switch"
                  aria-checked={showDensityHeat}
                  onClick={() => toggleHeatmap("density")}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${showDensityHeat ? "bg-sky-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${showDensityHeat ? "bg-sky-200" : "bg-sky-500"}`} aria-hidden="true" />
                  Density
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showContentionHeat}
                  disabled={!hasContention}
                  title={hasContention ? "Toggle applicant contention heat" : "No applicant observations under these filters"}
                  onClick={() => toggleHeatmap("contention")}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${showContentionHeat ? "bg-orange-700 text-white" : "text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${showContentionHeat ? "bg-amber-200" : "bg-orange-500"}`} aria-hidden="true" />
                  Contention
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 border-b border-slate-200 bg-slate-50 sm:grid-cols-3">
        <div className="border-b border-slate-200 px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Strongest availability</p>
          <p className="mt-1 truncate font-semibold text-slate-900">{strongest?.keyword ?? "Unavailable"}</p>
          <p className="text-xs text-slate-500">{strongest ? formatMetric(mapMetric(strongest, "density", perCapita, stabilized) ?? 0, "density", perCapita) : "No mapped locations"}</p>
        </div>
        <div className="border-b border-slate-200 px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Availability vs contention</p>
          <p className="mt-1 truncate font-semibold text-slate-900">{opportunity?.keyword ?? "Collecting observations"}</p>
          <p className="text-xs text-slate-500">{opportunity ? `${opportunity.applicants_per_hour?.toFixed(1)} applicants/hour median` : "Needs at least 25% applicant coverage"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Map coverage</p>
          <p className="mt-1 font-semibold text-slate-900">{(mappedShare * 100).toFixed(0)}% of filtered jobs</p>
          <p className="text-xs text-slate-500">{availableLocations.length} of {locations.length} location buckets mapped</p>
        </div>
      </div>

      {availableLocations.length && featureCollection.features.length ? (
        <div className="relative h-[430px] w-full sm:h-[520px]">
          <Map
            initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 55, maxZoom: 9 } } : { longitude: -96, latitude: 56, zoom: 2.5 }}
            mapLib={maplibregl}
            mapStyle={mapStyle}
            cooperativeGestures
            dragRotate={false}
            pitchWithRotate={false}
            maxPitch={0}
            reuseMaps
            interactiveLayerIds={["job-area-points"]}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHovered(null)}
            onClick={onClick}
            cursor={hovered ? "pointer" : "grab"}
            attributionControl={{ compact: true }}
          >
            <NavigationControl position="top-right" showCompass={false} />
            <ScaleControl position="bottom-left" unit="metric" />
            {hovered && (
              <Popup longitude={hovered.longitude} latitude={hovered.latitude} closeButton={false} closeOnClick={false} offset={14} anchor="bottom">
                <div className="min-w-48 p-1 text-slate-800">
                  <p className="font-semibold">{hovered.label}</p>
                  <p className="mt-1 text-sm">{hovered.count.toLocaleString("en-CA")} active jobs</p>
                  {hovered.rate >= 0 && (
                    <p className="text-sm">{hovered.rate.toFixed(1)} applicants/hour</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">Applicant coverage {(hovered.coverage * 100).toFixed(0)}%</p>
                  {hovered.initialApplicants >= 0 && (
                    <p className="text-xs text-slate-500">Median first seen: {hovered.initialApplicants.toFixed(0)} applicants{hovered.observationLag >= 0 ? ` after ${hovered.observationLag.toFixed(1)}h` : ""}</p>
                  )}
                </div>
              </Popup>
            )}
          </Map>
          <div className="pointer-events-none absolute bottom-7 right-2 rounded-lg border border-white/70 bg-white/90 px-3 py-2 shadow-md backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
              {activeMode === "contention" ? <Flame className="h-3.5 w-3.5 text-rose-800" /> : <MapPin className="h-3.5 w-3.5 text-slate-700" />}
              <span>Bubbles</span>
              <span className={`h-2 w-2 rounded-full ${activeMode === "contention" ? "bg-rose-800" : "bg-slate-700"}`} />
              <span className={`h-3 w-3 rounded-full ${activeMode === "contention" ? "bg-rose-800" : "bg-slate-700"}`} />
              <span className={`h-4 w-4 rounded-full ${activeMode === "contention" ? "bg-rose-800" : "bg-slate-700"}`} />
            </div>
            {showDensityHeat && <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600"><span className="w-20">Density heat</span><span className="h-2 w-20 rounded-full bg-gradient-to-r from-sky-100 via-sky-400 to-sky-900" /></div>}
            {showContentionHeat && <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600"><span className="w-20">Contention heat</span><span className="h-2 w-20 rounded-full bg-gradient-to-r from-yellow-200 via-orange-400 to-red-800" /></div>}
          </div>
        </div>
      ) : (
        <div className="flex h-72 items-center justify-center px-6 text-center text-sm text-slate-500">
          {availableLocations.length ? "No applicant activity is available for mapped locations under these filters." : "No map-ready coordinates match this filter selection. Unspecified and country-wide listings remain in the ranked list."}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
        <span>Contention is median reported applicant growth, falling back to first-seen applicants per posting-hour. Unknown counts are excluded.</span>
        <span>Place centroids: GeoNames, CC BY 4.0</span>
      </div>
    </section>
  );
}
