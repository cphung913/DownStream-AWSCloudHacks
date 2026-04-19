import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useSimulationStore } from "@/stores/simulation";
import { useUiStore } from "@/stores/ui";
import { useMapLayers } from "@/hooks/useMapLayers";
import { useRiverGraph } from "@/hooks/useRiverGraph";
import { useSimulationDriver } from "@/hooks/useSimulation";
import { baseStyle, REGION_CENTER } from "@/lib/mapStyle";
import { alsStyleUrl } from "@/lib/locationService";

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  const region = useSimulationStore((s) => s.config.region);
  const sourceLngLat = useSimulationStore((s) => s.config.sourceLngLat);
  const setSource = useSimulationStore((s) => s.setSource);
  const placeBarrier = useSimulationStore((s) => s.placeBarrier);
  const mode = useUiStore((s) => s.mode);
  const pendingKind = useUiStore((s) => s.pendingMitigationKind);
  const pendingRadius = useUiStore((s) => s.pendingMitigationRadius);
  const cancel = useUiStore((s) => s.cancel);

  const { graph } = useRiverGraph(region, sourceLngLat);
  useSimulationDriver();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const [lon, lat, zoom] = REGION_CENTER[region] ?? [-95, 39, 4];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: alsStyleUrl() ?? baseStyle,
      center: [lon, lat],
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // center changes handled by separate effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const [lon, lat, zoom] = REGION_CENTER[region] ?? [-95, 39, 4];
    map.flyTo({ center: [lon, lat], zoom, duration: 1200 });
  }, [region]);

  useMapLayers(mapRef.current, ready, graph);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = mode === "inspect" ? "grab" : "crosshair";

    const handler = (e: maplibregl.MapMouseEvent) => {
      if (mode !== "pinSource" && mode !== "placeMitigation") return;

      const riverLayer = map.getLayer("river-line") ? ["river-line"] : undefined;
      const hit = riverLayer
        ? map.queryRenderedFeatures(e.point, { layers: riverLayer })[0]
        : undefined;
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const segmentId =
        (hit?.properties?.segment_id as string | undefined) ?? synthSegmentId(lngLat);

      if (mode === "pinSource") {
        setSource(segmentId, lngLat);
        cancel();
      } else if (mode === "placeMitigation" && pendingKind) {
        const r = placeBarrier(pendingKind, segmentId, lngLat, pendingRadius);
        if (!r.ok) console.warn("[mitigation] rejected:", r.reason);
        cancel();
      }
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [ready, mode, pendingKind, pendingRadius, setSource, placeBarrier, cancel]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

// Used in demo mode when the basin GeoJSON isn't loaded, so no river-line feature
// sits under the click. Deterministic from coords so the same click always yields
// the same id; real runs overwrite this with the NHD ComID from the layer query.
function synthSegmentId([lng, lat]: [number, number]): string {
  return `synth-${lng.toFixed(4)}_${lat.toFixed(4)}`;
}
