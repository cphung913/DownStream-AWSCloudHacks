"""Build per-basin GeoJSON river graphs for the simulator.

1. Pull NHD Plus HR flowlines + NHDPlusFlow connectivity for the basin.
2. Hit USGS StreamStats batch API per segment for flow_velocity / channel_width /
   mean_depth / flow_rate.  This is the slow path -- run once, cache to disk.
3. Join Census TIGER/Line municipal boundaries onto segment geometry.
4. Emit single FeatureCollection matching the CONTEXT.md data contract.

Run at project setup, NOT during the hackathon. StreamStats rate limits will kill you.
"""
import json
import sys
from pathlib import Path


def main(basin: str, out_path: Path) -> None:
    raise NotImplementedError("implement NHD + StreamStats + TIGER pipeline")


if __name__ == "__main__":
    basin = sys.argv[1] if len(sys.argv) > 1 else "mississippi"
    main(basin, Path(f"data/{basin}.geojson"))
