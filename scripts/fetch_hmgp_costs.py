"""Fetch FEMA Hazard Mitigation Grant Program (HMGP) project costs.

Populates `data/hmgp_costs.json` with real-dollar aggregates (count, mean,
median, p90, min, max) per project category. The watershed spill simulator's
incident-report generator feeds these into its `estimatedCleanupCost` anchor
so the Bedrock-drafted dollar figures map to real federal response benchmarks
instead of made-up numbers.

Source: OpenFEMA v1 (public, no auth).
    https://www.fema.gov/openfema-data-page/hazard-mitigation-assistance-projects-v3

One-shot. Run once at project setup; commit the output to `data/` so the
simulator doesn't need a live network call at demo time:

    python scripts/fetch_hmgp_costs.py
    python scripts/fetch_hmgp_costs.py --limit 50000 --out data/hmgp_costs.json

Optional state filter (comma-separated FIPS codes or USPS abbreviations) so
you can constrain to basin states:

    python scripts/fetch_hmgp_costs.py --states MO,IL,TN,AR,MS,LA
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OPENFEMA_URL = (
    "https://www.fema.gov/api/open/v4/HazardMitigationAssistanceProjects"
)
PAGE_SIZE = 1000
POLITE_DELAY_S = 0.25

# Substrings in the FEMA projectType field → our internal buckets.
# Narrow list: water-and-flood-related categories only, since that's what the
# watershed spill sim's incident report needs to anchor. Extend with care —
# FEMA's projectType values are free-text-ish.
CATEGORY_MAP: dict[str, str] = {
    "flood": "flood_control",
    "levee": "levee_reinforcement",
    "dam": "dam_rehabilitation",
    "drainage": "drainage_infrastructure",
    "water supply": "water_supply_protection",
    "sewer": "sewer_pollution_control",
    "watershed": "watershed_management",
    "erosion": "bank_erosion_control",
    "stormwater": "stormwater_management",
}

# Mississippi basin states. OpenFEMA stores `state` as the full name, not the
# USPS code, so the default is spelled out. Pass --states '' for nationwide.
BASIN_STATES_DEFAULT = (
    "Missouri,Illinois,Tennessee,Arkansas,Mississippi,Louisiana,"
    "Kentucky,Iowa,Wisconsin,Minnesota"
)


def fetch_page(skip: int, top: int, state_filter: str | None) -> list[dict[str, Any]]:
    """Fetch one page from OpenFEMA. Raises on HTTP/URL error (caller decides)."""
    filters = ["programArea eq 'HMGP'"]
    if state_filter:
        states = ",".join(f"'{s.strip()}'" for s in state_filter.split(",") if s.strip())
        filters.append(f"state in ({states})")

    params = {
        "$skip": skip,
        "$top": top,
        "$select": "projectType,federalShareObligated,state,subrecipient,programArea",
        "$filter": " and ".join(filters),
    }
    url = f"{OPENFEMA_URL}?{urlencode(params)}"
    req = Request(url, headers={"User-Agent": "watershed-spill-sim/0.1"})
    with urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    # OpenFEMA wraps results in a key named after the dataset.
    return payload.get("HazardMitigationAssistanceProjects", [])


def fetch_all(limit: int, state_filter: str | None) -> Iterator[dict[str, Any]]:
    """Yield up to `limit` records across paginated calls."""
    skip = 0
    fetched = 0
    while fetched < limit:
        want = min(PAGE_SIZE, limit - fetched)
        try:
            page = fetch_page(skip, want, state_filter)
        except (HTTPError, URLError) as exc:
            print(f"fetch failed at skip={skip}: {exc}", file=sys.stderr)
            return
        if not page:
            return
        yield from page
        fetched += len(page)
        skip += len(page)
        if len(page) < want:
            return  # last page
        time.sleep(POLITE_DELAY_S)


def categorize(project: dict[str, Any]) -> str | None:
    kind = (project.get("projectType") or "").lower()
    for needle, bucket in CATEGORY_MAP.items():
        if needle in kind:
            return bucket
    return None


def aggregate(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, float | int]]:
    """Group by category, return summary stats per bucket."""
    buckets: dict[str, list[float]] = {}
    for row in rows:
        bucket = categorize(row)
        if bucket is None:
            continue
        amount = row.get("federalShareObligated")
        if not isinstance(amount, (int, float)) or amount <= 0:
            continue
        buckets.setdefault(bucket, []).append(float(amount))

    out: dict[str, dict[str, float | int]] = {}
    for bucket, amounts in buckets.items():
        amounts.sort()
        n = len(amounts)
        p90_idx = min(n - 1, int(n * 0.9))
        out[bucket] = {
            "count": n,
            "mean_usd": round(statistics.mean(amounts), 2),
            "median_usd": round(statistics.median(amounts), 2),
            "p90_usd": round(amounts[p90_idx], 2),
            "min_usd": round(amounts[0], 2),
            "max_usd": round(amounts[-1], 2),
        }
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/hmgp_costs.json"),
        help="Output JSON path (default: data/hmgp_costs.json)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20_000,
        help="Max records to fetch (default: 20000)",
    )
    parser.add_argument(
        "--states",
        default=BASIN_STATES_DEFAULT,
        help=(
            "Comma-separated USPS state codes to filter. Default: Mississippi "
            "basin states. Pass empty string ('') for nationwide."
        ),
    )
    args = parser.parse_args()

    state_filter = args.states.strip() or None
    args.out.parent.mkdir(parents=True, exist_ok=True)

    rows = list(fetch_all(args.limit, state_filter))
    if not rows:
        print("no rows fetched — check network or OpenFEMA endpoint", file=sys.stderr)
        return 1

    aggregates = aggregate(rows)
    payload = {
        "source": "FEMA OpenFEMA HazardMitigationAssistanceProjects (HMGP)",
        "source_url": OPENFEMA_URL,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "state_filter": state_filter,
        "rows_processed": len(rows),
        "rows_categorized": sum(v["count"] for v in aggregates.values()),
        "categories": aggregates,
    }
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(
        f"wrote {len(aggregates)} categories across "
        f"{payload['rows_categorized']}/{len(rows)} projects → {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
