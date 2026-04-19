import type { StyleSpecification } from "maplibre-gl";

export const baseStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "basemap",
      type: "raster",
      source: "osm",
      paint: { "raster-brightness-max": 0.55, "raster-saturation": -0.4 },
    },
  ],
};

export const REGION_CENTER: Record<string, [number, number, number]> = {
  mississippi: [-90.5, 33.8, 5.1],
  ohio: [-84.0, 39.5, 6.0],
  colorado: [-111.0, 39.5, 5.6],
};
