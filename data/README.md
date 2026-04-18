# Basin GeoJSON graphs

Pre-processed NHD + StreamStats river graphs. One FeatureCollection per basin:

- `mississippi.geojson` — primary demo dataset (~8,400 segments). **Immutable.** Segment IDs (`ComID`) are stable across runs — do not regenerate.
- `ohio.geojson`
- `colorado.geojson`

Required per-Feature properties are documented in `/CLAUDE.md` → "River Graph Data Contract". Regenerate with `scripts/build_river_graph.py` (one-shot, do not run during hackathon — USGS StreamStats rate limits).

For local frontend development without a basin file checked in, the map falls back to an empty overlay and the Zustand store runs in mock-tick mode.
