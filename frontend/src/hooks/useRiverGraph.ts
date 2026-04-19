import { useEffect, useMemo, useState } from "react";
import type { LngLat, Region } from "@/types/simulation";
import { generateSyntheticRiver } from "@/lib/syntheticRiver";

/**
 * Loads the basin GeoJSON for the chosen region.
 *
 * In production the file is fetched from CloudFront in front of the
 * watershed-river-graphs S3 bucket. For local dev it is expected at
 * /data/{region}.geojson served from Vite's /public.
 *
 * If the real basin is missing we fall back to a synthetic river rooted at
 * the user-pinned source so the demo still has something to colour. The
 * synthetic generator is pure, so the simulation hook calls it too and both
 * sides paint the same segment ids.
 */
export function useRiverGraph(region: Region, sourceLngLat: LngLat | null) {
  const [realGraph, setRealGraph] = useState<GeoJSON.FeatureCollection | null>(null);
  const [fetchError, setFetchError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRealGraph(null);
    setFetchError(null);
    const url = riverGraphUrl(region);
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} ${r.status}`))))
      .then((data: GeoJSON.FeatureCollection) => {
        if (!cancelled) setRealGraph(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setFetchError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  const synthetic = useMemo(() => {
    if (realGraph || !sourceLngLat) return null;
    return generateSyntheticRiver(sourceLngLat, region);
  }, [realGraph, sourceLngLat, region]);

  const graph = realGraph ?? synthetic?.featureCollection ?? null;
  return { graph, synthetic, error: fetchError, usingSynthetic: !realGraph && !!synthetic };
}

function riverGraphUrl(region: Region): string {
  const cdn = import.meta.env.VITE_RIVER_GRAPH_CDN as string | undefined;
  if (cdn) return `${cdn}/${region}.geojson`;
  return `/data/${region}.geojson`;
}
