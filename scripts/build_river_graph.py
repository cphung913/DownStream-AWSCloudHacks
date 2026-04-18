"""Build a per-basin river graph GeoJSON from NHD + StreamStats + Census.

Run once per basin at setup. The StreamStats step is rate-limited and slow;
results are cached at ``streamstats_cache`` so re-runs don't re-hit the API.
Missing-field validation is enforced at the end — the script exits 1 if any
segment is missing a required property.

Outputs a single GeoJSON FeatureCollection, with per-Feature.properties:

    segment_id, flow_velocity, channel_width, mean_depth, flow_rate,
    downstream_ids, huc8, town
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("build_river_graph")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

REQUIRED_FIELDS = (
    "segment_id",
    "flow_velocity",
    "channel_width",
    "mean_depth",
    "flow_rate",
    "downstream_ids",
    "huc8",
    "town",
)


def main(
    basin: str,
    nhd_flowline_shapefile: Path,
    nhd_plusflow_table: Path,
    census_places_shapefile: Path,
    output_path: Path,
    streamstats_cache: Path,
) -> None:
    logger.info("Building river graph for basin=%s", basin)

    # Imports are local so the script can be imported for tests without GIS deps.
    try:
        import geopandas as gpd  # type: ignore[import-not-found]
        import pandas as pd  # type: ignore[import-not-found]
    except ImportError as e:
        raise SystemExit(
            "This script needs geopandas + pandas installed. "
            "See ml/dispersion-model/requirements.txt for a starting point."
        ) from e

    flowlines = gpd.read_file(nhd_flowline_shapefile)
    plusflow = pd.read_csv(nhd_plusflow_table)
    places = gpd.read_file(census_places_shapefile).to_crs(flowlines.crs)

    streamstats_cache.parent.mkdir(parents=True, exist_ok=True)
    if streamstats_cache.exists():
        stats = json.loads(streamstats_cache.read_text())
    else:
        stats = _fetch_streamstats_batched(flowlines["ComID"].astype(str).tolist())
        streamstats_cache.write_text(json.dumps(stats))

    # Build downstream map: ComID -> [ComID].
    downstream_map: dict[str, list[str]] = {}
    for _, row in plusflow.iterrows():
        src = str(row["FromComID"])
        dst = str(row["ToComID"])
        downstream_map.setdefault(src, []).append(dst)

    # Spatial join flowlines → places (only first match kept).
    joined = gpd.sjoin(flowlines, places, how="left", predicate="intersects")

    features: list[dict[str, Any]] = []
    missing: list[str] = []

    for _, row in joined.iterrows():
        com_id = str(row["ComID"])
        stat = stats.get(com_id, {})
        town_name = row.get("NAME")
        town_pop = row.get("POP")
        fips = row.get("GEOID")
        town = (
            {
                "name": town_name,
                "population": int(town_pop) if town_pop is not None else 0,
                "fips": fips,
            }
            if isinstance(town_name, str) and town_name
            else None
        )
        props = {
            "segment_id": com_id,
            "flow_velocity": stat.get("flow_velocity"),
            "channel_width": stat.get("channel_width"),
            "mean_depth": stat.get("mean_depth"),
            "flow_rate": stat.get("flow_rate"),
            "downstream_ids": downstream_map.get(com_id, []),
            "huc8": row.get("HUC8"),
            "town": town,
        }

        for field in REQUIRED_FIELDS:
            if field == "town":
                continue  # town is legitimately nullable
            if props.get(field) in (None, ""):
                missing.append(f"{com_id}:{field}")

        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(gpd.GeoSeries([row.geometry]).to_json())["features"][0][
                    "geometry"
                ],
                "properties": props,
            }
        )

    if missing:
        logger.error(
            "Segments missing required fields (first 20): %s",
            missing[:20],
        )
        sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features})
    )
    logger.info("Wrote %d segments to %s", len(features), output_path)


def _fetch_streamstats_batched(com_ids: list[str]) -> dict[str, dict[str, float]]:
    """Placeholder for the USGS StreamStats batch API.

    The real implementation hits ``https://streamstats.usgs.gov/streamstatsservices/``
    per segment with rate limiting and retries. For the hackathon scaffold we
    emit a message and return an empty dict so callers rely on the cache.
    """
    logger.warning(
        "StreamStats fetch not implemented in scaffold; pre-populate the cache file."
    )
    return {}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--basin", required=True, choices=["mississippi", "ohio", "colorado"])
    parser.add_argument("--nhd-flowlines", required=True, type=Path)
    parser.add_argument("--nhd-plusflow", required=True, type=Path)
    parser.add_argument("--census-places", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--streamstats-cache", required=True, type=Path)
    args = parser.parse_args()
    main(
        basin=args.basin,
        nhd_flowline_shapefile=args.nhd_flowlines,
        nhd_plusflow_table=args.nhd_plusflow,
        census_places_shapefile=args.census_places,
        output_path=args.output,
        streamstats_cache=args.streamstats_cache,
    )
