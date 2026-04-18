import { awsExports } from "../aws-exports";

/**
 * Returns the MapLibre-compatible style URL for the Amazon Location Service
 * map resource. For an API-key–authenticated demo, the key is injected here.
 */
export function getMapStyleUrl(): string {
  const { aws_location_map_name, aws_region, aws_location_api_key } = awsExports;
  const base = `https://maps.geo.${aws_region}.amazonaws.com/maps/v0/maps/${aws_location_map_name}/style-descriptor`;
  if (aws_location_api_key) {
    // Dedicated Location Service key — scoped to geo:GetMap* on this map only.
    // Do NOT substitute the AppSync API key here; that key grants GraphQL access.
    return `${base}?key=${encodeURIComponent(aws_location_api_key)}`;
  }
  return base;
}

export function getBasinGeoJSONUrl(basin: "mississippi" | "ohio" | "colorado"): string {
  const cdn = awsExports.aws_river_graphs_cdn;
  if (!cdn) return `/${basin}.geojson`;
  return `${cdn.replace(/\/$/, "")}/${basin}.geojson`;
}
