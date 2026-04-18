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
  const setSourceSegmentId = useSimulationStore((s) => s.setSourceSegmentId);
  const placeBarrier = useSimulationStore((s) => s.placeBarrier);
  const mode = useUiStore((s) => s.mode);
  const pendingKind = useUiStore((s) => s.pendingMitigationKind);
  const pendingRadius = useUiStore((s) => s.pendingMitigationRadius);
  const cancel = useUiStore((s) => s.cancel);

  const { graph } = useRiverGraph(region);
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
      const features = map.queryRenderedFeatures(e.point, { layers: ["river-line"] });
      const segmentId = features[0]?.properties?.segment_id as string | undefined;
      if (!segmentId) return;
      if (mode === "pinSource") {
        setSourceSegmentId(segmentId);
        cancel();
      } else if (mode === "placeMitigation" && pendingKind) {
        const r = placeBarrier(pendingKind, segmentId, pendingRadius);
        if (!r.ok) console.warn("[mitigation] rejected:", r.reason);
        cancel();
      }
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [ready, mode, pendingKind, pendingRadius, setSourceSegmentId, placeBarrier, cancel]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
