import { awsExports } from "../aws-exports";

export function getMapStyleUrl(): string {
  const { aws_location_map_name, aws_region, aws_location_api_key } = awsExports;
  const base = `https://maps.geo.${aws_region}.amazonaws.com/maps/v0/maps/${aws_location_map_name}/style-descriptor`;
  if (aws_location_api_key) {
    return `${base}?key=${encodeURIComponent(aws_location_api_key)}`;
  }
  return base;
}

export function alsStyleUrl(): string | null {
  const { aws_location_map_name, aws_region, aws_location_api_key } = awsExports;
  if (!aws_location_map_name || !aws_region) return null;
  const base = `https://maps.geo.${aws_region}.amazonaws.com/maps/v0/maps/${aws_location_map_name}/style-descriptor`;
  if (aws_location_api_key) {
    return `${base}?key=${encodeURIComponent(aws_location_api_key)}`;
  }
  return base;
}

export function getBasinGeoJSONUrl(basin: "mississippi" | "ohio" | "colorado"): string {
  const cdn = awsExports.aws_river_graphs_cdn;
  if (!cdn) return `/${basin}.geojson`;
  return `${cdn.replace(/\/$/, "")}/${basin}.geojson`;
}
