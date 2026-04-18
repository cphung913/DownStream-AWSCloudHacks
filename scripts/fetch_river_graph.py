#!/usr/bin/env python3
"""Fetch real NHDPlus HR flowline data for the Mississippi watershed.

Pulls stream-order >= 7 flowlines with EROM flow attributes from the USGS
NHDPlus HR ArcGIS REST service and emits a GeoJSON FeatureCollection that
satisfies the DownStream river-graph data contract (see CLAUDE.md).

Data sources:
  - NHDPlus HR flowlines + EROM attributes (USGS National Map):
      https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3
  - Hydraulic geometry (channel_width, mean_depth) derived from flow_rate
    via Leopold & Maddock (1953) downstream regressions.
  - Town coordinates + 2020 Census populations are hard-coded (18 cities
    along the main stem + major tributaries).

Usage:
  pip install requests
  python3 scripts/fetch_river_graph.py

Output: data/mississippi.geojson
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import requests

NHD_URL = (
    "https://hydro.nationalmap.gov/arcgis/rest/services/"
    "NHDPlus_HR/MapServer/3/query"
)

WHERE_CLAUSE = (
    "streamorde >= 7 AND qama > 0 AND lengthkm >= 2 AND gnis_name IN ("
    "'Mississippi River','Missouri River','Ohio River','Arkansas River',"
    "'Tennessee River','Illinois River','Cumberland River','Wabash River')"
)

OUT_FIELDS = ",".join(
    [
        "nhdplusid",
        "gnis_name",
        "reachcode",
        "qama",
        "vama",
        "slope",
        "streamorde",
        "hydroseq",
        "dnhydroseq",
        "totdasqkm",
        "lengthkm",
    ]
)

PAGE_SIZE = 2000

# Unit conversions
CFS_TO_CMS = 0.0283168
FT_PER_S_TO_M_PER_S = 0.3048

REQUIRED_NUMERIC_FIELDS = (
    "flow_velocity",
    "channel_width",
    "mean_depth",
    "flow_rate",
)

TOWNS: list[dict[str, Any]] = [
    {"name": "Minneapolis", "population": 429606, "fips": "2743000", "lat": 44.9778, "lon": -93.2650},
    {"name": "Dubuque", "population": 59667, "fips": "1921000", "lat": 42.5006, "lon": -90.6646},
    {"name": "St. Louis", "population": 301578, "fips": "2965000", "lat": 38.6270, "lon": -90.1994},
    {"name": "Cairo", "population": 1759, "fips": "1711163", "lat": 37.0050, "lon": -89.1762},
    {"name": "Memphis", "population": 633104, "fips": "4748000", "lat": 35.1495, "lon": -90.0490},
    {"name": "Vicksburg", "population": 22005, "fips": "2876600", "lat": 32.3526, "lon": -90.8779},
    {"name": "Natchez", "population": 14674, "fips": "2851220", "lat": 31.5604, "lon": -91.4032},
    {"name": "Baton Rouge", "population": 227470, "fips": "0500000US22033", "lat": 30.4515, "lon": -91.1871},
    {"name": "New Orleans", "population": 383997, "fips": "2255000", "lat": 29.9511, "lon": -90.0715},
    {"name": "Kansas City", "population": 508090, "fips": "2938000", "lat": 39.0997, "lon": -94.5786},
    {"name": "Omaha", "population": 486051, "fips": "3137000", "lat": 41.2565, "lon": -95.9345},
    {"name": "Sioux City", "population": 85797, "fips": "1973335", "lat": 42.4999, "lon": -96.4003},
    {"name": "Cincinnati", "population": 309317, "fips": "3915000", "lat": 39.1031, "lon": -84.5120},
    {"name": "Louisville", "population": 633045, "fips": "2148000", "lat": 38.2527, "lon": -85.7585},
    {"name": "Pittsburgh", "population": 302971, "fips": "4261000", "lat": 40.4406, "lon": -79.9959},
    {"name": "Little Rock", "population": 202591, "fips": "0541000", "lat": 34.7465, "lon": -92.2896},
    {"name": "Evansville", "population": 117979, "fips": "1822000", "lat": 37.9716, "lon": -87.5711},
    {"name": "Cape Girardeau", "population": 40538, "fips": "2910550", "lat": 37.3059, "lon": -89.5181},
]

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "mississippi.geojson"


def fetch_all_features() -> list[dict[str, Any]]:
    """Paginate through the ArcGIS REST service and return all raw features."""
    features: list[dict[str, Any]] = []
    offset = 0
    page = 1
    while True:
        params = {
            "where": WHERE_CLAUSE,
            "outFields": OUT_FIELDS,
            "outSR": 4326,
            "returnGeometry": "true",
            "f": "json",
            "resultRecordCount": PAGE_SIZE,
            "resultOffset": offset,
            "supportsPagination": "true",
        }
        print(f"Fetching page {page}...", end=" ", flush=True)
        r = requests.get(NHD_URL, params=params, timeout=120)
        r.raise_for_status()
        payload = r.json()
        if "error" in payload:
            raise RuntimeError(f"ArcGIS error: {payload['error']}")
        batch = payload.get("features", [])
        print(f"{len(batch)} features.")
        features.extend(batch)
        if len(batch) < PAGE_SIZE or not payload.get("exceededTransferLimit", False):
            # No more pages (ArcGIS sets exceededTransferLimit when truncated).
            if len(batch) == PAGE_SIZE and payload.get("exceededTransferLimit", False):
                offset += PAGE_SIZE
                page += 1
                continue
            break
        offset += PAGE_SIZE
        page += 1
    print(f"Done. Total: {len(features)} segments.")
    return features


def esri_paths_to_linestring(geom: dict[str, Any]) -> dict[str, Any] | None:
    """Convert ArcGIS JSON polyline geometry to GeoJSON LineString/MultiLineString."""
    paths = geom.get("paths") if geom else None
    if not paths:
        return None
    if len(paths) == 1:
        return {"type": "LineString", "coordinates": paths[0]}
    return {"type": "MultiLineString", "coordinates": paths}


def segment_midpoint(geometry: dict[str, Any]) -> tuple[float, float]:
    """Return the midpoint (lon, lat) of a (Multi)LineString geometry."""
    if geometry["type"] == "LineString":
        coords = geometry["coordinates"]
    else:
        # MultiLineString: pick the longest path
        coords = max(geometry["coordinates"], key=len)
    mid = coords[len(coords) // 2]
    return float(mid[0]), float(mid[1])


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def build_feature(
    raw: dict[str, Any], hydroseq_to_id: dict[int, str]
) -> dict[str, Any] | None:
    attrs = raw.get("attributes", {})
    geom = esri_paths_to_linestring(raw.get("geometry", {}))
    if geom is None:
        return None

    nhdplusid = attrs.get("nhdplusid")
    qama = attrs.get("qama")
    vama = attrs.get("vama")
    reachcode = attrs.get("reachcode") or ""
    dnhydroseq = attrs.get("dnhydroseq")

    if nhdplusid is None or qama is None or vama is None:
        return None

    # NHDPlus HR uses -9998/-9999 sentinels for "no data" on EROM attributes.
    # These are not valid physics inputs; skip such segments.
    if float(qama) <= 0 or float(vama) <= 0:
        return None

    flow_rate = float(qama) * CFS_TO_CMS  # m^3/s
    flow_velocity = float(vama) * FT_PER_S_TO_M_PER_S  # m/s
    # Leopold & Maddock (1953) downstream hydraulic geometry
    channel_width = 2.66 * (flow_rate**0.5)
    mean_depth = 0.294 * (flow_rate**0.36)

    downstream_ids: list[str] = []
    if dnhydroseq is not None:
        ds_id = hydroseq_to_id.get(int(dnhydroseq))
        if ds_id is not None:
            downstream_ids = [ds_id]

    properties: dict[str, Any] = {
        "segment_id": str(int(nhdplusid)),
        "gnis_name": attrs.get("gnis_name"),
        "flow_rate": flow_rate,
        "flow_velocity": flow_velocity,
        "channel_width": channel_width,
        "mean_depth": mean_depth,
        "downstream_ids": downstream_ids,
        "huc8": reachcode[:8] if reachcode else "",
        "stream_order": attrs.get("streamorde"),
        "length_km": attrs.get("lengthkm"),
        "slope": attrs.get("slope"),
        "drainage_area_sqkm": attrs.get("totdasqkm"),
        "town": None,
    }

    return {"type": "Feature", "geometry": geom, "properties": properties}


def attach_towns(features: list[dict[str, Any]]) -> int:
    """Assign each town to its nearest segment by midpoint distance. Returns count attached."""
    # Precompute segment midpoints
    midpoints: list[tuple[float, float]] = [
        segment_midpoint(f["geometry"]) for f in features
    ]
    attached = 0
    for town in TOWNS:
        best_idx = -1
        best_d = float("inf")
        for i, (lon, lat) in enumerate(midpoints):
            d = haversine_km(town["lat"], town["lon"], lat, lon)
            if d < best_d:
                best_d = d
                best_idx = i
        if best_idx >= 0:
            features[best_idx]["properties"]["town"] = {
                "name": town["name"],
                "population": town["population"],
                "fips": town["fips"],
            }
            attached += 1
    return attached


def validate(features: list[dict[str, Any]]) -> None:
    for f in features:
        p = f["properties"]
        for field in REQUIRED_NUMERIC_FIELDS:
            v = p.get(field)
            if v is None or (isinstance(v, float) and math.isnan(v)):
                print(
                    f"FATAL: segment {p.get('segment_id')} missing required field {field}",
                    file=sys.stderr,
                )
                sys.exit(1)


def main() -> None:
    raw_features = fetch_all_features()
    if not raw_features:
        print("FATAL: no features returned from NHDPlus HR.", file=sys.stderr)
        sys.exit(1)

    # Build hydroseq -> nhdplusid lookup from ALL raw features first
    hydroseq_to_id: dict[int, str] = {}
    for raw in raw_features:
        attrs = raw.get("attributes", {})
        hs = attrs.get("hydroseq")
        nid = attrs.get("nhdplusid")
        if hs is not None and nid is not None:
            hydroseq_to_id[int(hs)] = str(int(nid))

    features: list[dict[str, Any]] = []
    for raw in raw_features:
        feat = build_feature(raw, hydroseq_to_id)
        if feat is not None:
            features.append(feat)

    validate(features)
    attached = attach_towns(features)
    terminal = sum(1 for f in features if not f["properties"]["downstream_ids"])

    fc = {"type": "FeatureCollection", "features": features}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w") as fh:
        json.dump(fc, fh)

    print(f"Wrote {OUTPUT_PATH}")
    print(f"  segments: {len(features)}")
    print(f"  towns attached: {attached}")
    print(f"  terminal segments: {terminal}")


if __name__ == "__main__":
    main()
