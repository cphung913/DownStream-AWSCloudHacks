# watershed-frontend

React + Vite + TypeScript + MapLibre + Zustand.

## Dev

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run build
```

## Env

Optional `.env.local`:

```
VITE_APPSYNC_ENDPOINT=...    # when omitted, mock tick driver runs
VITE_ALS_MAP_NAME=...        # when omitted, OSM raster fallback
VITE_ALS_API_KEY=...
VITE_RIVER_GRAPH_CDN=...     # when omitted, /data/{region}.geojson from /public
```

## Entry points

- `src/stores/simulation.ts` — single source of truth. All map state is derived from this.
- `src/hooks/useSimulation.ts` — mock driver when AppSync isn't wired; swap for real subscription via `VITE_APPSYNC_ENDPOINT`.
- `src/hooks/useMapLayers.ts` — cinematic river lighting logic (paint-property expressions driven by the store).
