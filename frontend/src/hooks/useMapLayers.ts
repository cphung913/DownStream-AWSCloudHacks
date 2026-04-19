import { useEffect } from "react";
import type {
  Map as MapLibreMap,
  ExpressionSpecification,
  GeoJSONSource,
} from "maplibre-gl";
import { useSimulationStore } from "@/stores/simulation";
import type { RiskLevel } from "@/types/simulation";

const RIVER_SOURCE = "river-graph";
const RIVER_LINE_LAYER = "river-line";
const RIVER_GLOW_LAYER = "river-glow";
const TOWN_SOURCE = "towns";
const TOWN_CIRCLE_LAYER = "town-circle";
const SOURCE_PIN_SOURCE = "source-pin";
const SOURCE_PIN_LAYER = "source-pin-layer";
const BARRIER_SOURCE = "barriers";
const BARRIER_LAYER = "barriers-layer";

const RISK_COLORS: Record<RiskLevel, string> = {
  CLEAR: "#38bdf8",
  MONITOR: "#eab308",
  ADVISORY: "#f97316",
  DANGER: "#ef4444",
};

/**
 * Drives MapLibre paint properties from the simulation store.
 * The cinematic "river lights up downstream" effect lives here.
 */
export function useMapLayers(map: MapLibreMap | null, ready: boolean, riverGeojson: GeoJSON.FeatureCollection | null) {
  useEffect(() => {
    if (!map || !ready) return;
    ensureSources(map, riverGeojson);
    ensureLayers(map);
  }, [map, ready, riverGeojson]);

  const segmentMap = useSimulationStore((s) => s.segmentMap);
  const townRiskMap = useSimulationStore((s) => s.townRiskMap);
  const sourceSegmentId = useSimulationStore((s) => s.config.sourceSegmentId);
  const sourceLngLat = useSimulationStore((s) => s.config.sourceLngLat);
  const barriers = useSimulationStore((s) => s.barriers);

  useEffect(() => {
    if (!map || !ready) return;
    const matchExpr = [
      "match",
      ["get", "segment_id"],
      ...flattenSegmentColors(segmentMap),
      RISK_COLORS.CLEAR,
    ] as unknown as ExpressionSpecification;
    const opacityExpr = [
      "match",
      ["get", "segment_id"],
      ...flattenSegmentGlowOpacity(segmentMap),
      0,
    ] as unknown as ExpressionSpecification;

    if (map.getLayer(RIVER_LINE_LAYER)) {
      map.setPaintProperty(RIVER_LINE_LAYER, "line-color", matchExpr);
    }
    if (map.getLayer(RIVER_GLOW_LAYER)) {
      map.setPaintProperty(RIVER_GLOW_LAYER, "line-color", matchExpr);
      map.setPaintProperty(RIVER_GLOW_LAYER, "line-opacity", opacityExpr);
    }
  }, [map, ready, segmentMap]);

  useEffect(() => {
    if (!map || !ready) return;
    const src = map.getSource(TOWN_SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = [];
    for (const town of townRiskMap.values()) {
      if (!town.lngLat) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: town.lngLat },
        properties: {
          townId: town.townId,
          name: town.name,
          population: town.population,
          riskLevel: town.riskLevel,
        },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [map, ready, townRiskMap]);

  useEffect(() => {
    if (!map || !ready) return;
    const src = map.getSource(SOURCE_PIN_SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features:
        sourceSegmentId && sourceLngLat
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: sourceLngLat },
                properties: { segmentId: sourceSegmentId },
              },
            ]
          : [],
    });
  }, [map, ready, sourceSegmentId, sourceLngLat]);

  useEffect(() => {
    if (!map || !ready) return;
    const src = map.getSource(BARRIER_SOURCE) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: barriers.map((b) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: b.lngLat },
        properties: { barrierId: b.id, kind: b.kind, radius: b.radiusMeters },
      })),
    });
  }, [map, ready, barriers]);
}

function ensureSources(map: MapLibreMap, riverGeojson: GeoJSON.FeatureCollection | null) {
  if (!map.getSource(RIVER_SOURCE)) {
    map.addSource(RIVER_SOURCE, {
      type: "geojson",
      data: riverGeojson ?? { type: "FeatureCollection", features: [] },
    });
  } else if (riverGeojson) {
    const src = map.getSource(RIVER_SOURCE) as GeoJSONSource | undefined;
    if (src) src.setData(riverGeojson);
  }
  for (const id of [TOWN_SOURCE, SOURCE_PIN_SOURCE, BARRIER_SOURCE]) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
  }
}

function ensureLayers(map: MapLibreMap) {
  if (!map.getLayer(RIVER_GLOW_LAYER)) {
    map.addLayer({
      id: RIVER_GLOW_LAYER,
      type: "line",
      source: RIVER_SOURCE,
      paint: {
        "line-color": RISK_COLORS.CLEAR,
        "line-width": 8,
        "line-opacity": 0,
        "line-blur": 6,
      },
    });
  }
  if (!map.getLayer(RIVER_LINE_LAYER)) {
    map.addLayer({
      id: RIVER_LINE_LAYER,
      type: "line",
      source: RIVER_SOURCE,
      paint: {
        "line-color": RISK_COLORS.CLEAR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 10, 2.4],
        "line-opacity": 0.85,
      },
    });
  }
  if (!map.getLayer(TOWN_CIRCLE_LAYER)) {
    map.addLayer({
      id: TOWN_CIRCLE_LAYER,
      type: "circle",
      source: TOWN_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 8],
        "circle-color": [
          "match",
          ["get", "riskLevel"],
          "DANGER", RISK_COLORS.DANGER,
          "ADVISORY", RISK_COLORS.ADVISORY,
          "MONITOR", RISK_COLORS.MONITOR,
          RISK_COLORS.CLEAR,
        ],
        "circle-stroke-color": "#0a0e14",
        "circle-stroke-width": 1.5,
      },
    });
  }
  if (!map.getLayer(BARRIER_LAYER)) {
    map.addLayer({
      id: BARRIER_LAYER,
      type: "circle",
      source: BARRIER_SOURCE,
      paint: {
        "circle-radius": 10,
        "circle-color": "#38bdf8",
        "circle-stroke-color": "#0a0e14",
        "circle-stroke-width": 2,
        "circle-opacity": 0.8,
      },
    });
  }
  if (!map.getLayer(SOURCE_PIN_LAYER)) {
    map.addLayer({
      id: SOURCE_PIN_LAYER,
      type: "circle",
      source: SOURCE_PIN_SOURCE,
      paint: {
        "circle-radius": 9,
        "circle-color": "#ef4444",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
}

function flattenSegmentColors(segmentMap: ReadonlyMap<string, { riskLevel: RiskLevel }>) {
  const pairs: (string | string)[] = [];
  for (const [segmentId, state] of segmentMap) {
    pairs.push(segmentId, RISK_COLORS[state.riskLevel]);
  }
  return pairs.length ? pairs : ["__none__", RISK_COLORS.CLEAR];
}

function flattenSegmentGlowOpacity(segmentMap: ReadonlyMap<string, { concentration: number; riskLevel: RiskLevel }>) {
  const pairs: (string | number)[] = [];
  for (const [segmentId, state] of segmentMap) {
    const intensity = state.riskLevel === "CLEAR" ? 0 : Math.min(0.9, 0.3 + state.concentration * 0.6);
    pairs.push(segmentId, intensity);
  }
  return pairs.length ? pairs : ["__none__", 0];
}
