import { useEffect, useState } from "react";
import type { Region } from "@/types/simulation";

/**
 * Loads the basin GeoJSON for the chosen region.
 *
 * In production the file is fetched from CloudFront in front of the
 * watershed-river-graphs S3 bucket. For local dev it is expected at
 * /data/{region}.geojson served from Vite's /public.
 *
 * Returns null if the file is missing — the map will render an empty
 * overlay, which is the correct fallback before the graph is generated.
 */
export function useRiverGraph(region: Region) {
  const [graph, setGraph] = useState<GeoJSON.FeatureCollection | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError(null);
    const url = riverGraphUrl(region);
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} ${r.status}`))))
      .then((data: GeoJSON.FeatureCollection) => {
        if (!cancelled) setGraph(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  return { graph, error };
}

function riverGraphUrl(region: Region): string {
  const cdn = import.meta.env.VITE_RIVER_GRAPH_CDN as string | undefined;
  if (cdn) return `${cdn}/${region}.geojson`;
  return `/data/${region}.geojson`;
}
