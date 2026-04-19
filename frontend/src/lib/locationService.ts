/**
 * Amazon Location Service helpers (geocode + map resource lookup).
 *
 * Stubbed for local dev. Populate VITE_ALS_MAP_NAME and VITE_ALS_API_KEY via
 * Amplify build env to activate. The map component falls back to the free
 * OSM tile source in baseStyle when these are absent.
 */
export const alsMapName = import.meta.env.VITE_LOCATION_MAP as string | undefined;
export const alsApiKey = import.meta.env.VITE_LOCATION_API_KEY as string | undefined;
const awsRegion = (import.meta.env.VITE_AWS_REGION as string | undefined) ?? "us-west-2";

export function alsStyleUrl(): string | null {
  if (!alsMapName || !alsApiKey) return null;
  return `https://maps.geo.${awsRegion}.amazonaws.com/maps/v0/maps/${alsMapName}/style-descriptor?key=${alsApiKey}`;
}
