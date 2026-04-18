"""Threshold-checker Lambda.

After each tick, inspects ``segmentUpdates`` for segments that carry a town,
compares the new risk level against the prior tick, and emits EventBridge
``ThresholdCrossed`` events plus ``TownRiskLog`` rows for crossings.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_ddb = boto3.resource("dynamodb")
_events = boto3.client("events")
_s3 = boto3.client("s3")

SIMULATIONS_BUCKET = os.environ["SIMULATIONS_BUCKET"]
TOWN_RISK_LOG_TABLE = os.environ["TOWN_RISK_LOG_TABLE"]
RISK_EVENT_BUS_NAME = os.environ["RISK_EVENT_BUS_NAME"]

_RISK_ORDER = {"none": 0, "monitor": 1, "advisory": 2, "danger": 3}


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    simulation_id: str = event["simulationId"]
    tick: int = int(event["tick"])
    propagation: dict[str, Any] = event.get("propagation", {}) or {}
    segment_updates: list[dict[str, Any]] = propagation.get("segmentUpdates", []) or []

    town_map = _load_town_map(simulation_id)
    if not town_map:
        return {"crossings": 0}

    prior_risk = _load_prior_town_risk(simulation_id, tick - 1, town_map.keys())

    crossings: list[dict[str, Any]] = []
    table = _ddb.Table(TOWN_RISK_LOG_TABLE)
    entries: list[dict[str, Any]] = []

    for update in segment_updates:
        seg_id = update["segmentId"]
        town = town_map.get(seg_id)
        if not town:
            continue
        new_risk = (update.get("riskLevel") or "none").lower()
        prior = prior_risk.get(seg_id, "none")
        if _RISK_ORDER[new_risk] <= _RISK_ORDER[prior]:
            continue

        detail = {
            "simulationId": simulation_id,
            "tick": tick,
            "townId": town.get("fips") or seg_id,
            "townName": town.get("name", "Unknown"),
            "population": int(town.get("population", 0)),
            "priorRiskLevel": prior,
            "newRiskLevel": new_risk,
            "concentration": float(update.get("concentration", 0.0)),
        }
        crossings.append(detail)
        entries.append(
            {
                "simulationId": simulation_id,
                "townIdTickNumber": f"{detail['townId']}#{tick}",
                "townId": detail["townId"],
                "townName": detail["townName"],
                "population": detail["population"],
                "riskLevel": new_risk,
                "concentration": Decimal(f"{detail['concentration']:.10g}"),
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )

    if entries:
        with table.batch_writer() as batch:
            for item in entries:
                batch.put_item(Item=item)

    if crossings:
        _events.put_events(
            Entries=[
                {
                    "Source": "watershed.simulation",
                    "DetailType": "ThresholdCrossed",
                    "EventBusName": RISK_EVENT_BUS_NAME,
                    "Detail": json.dumps(c),
                }
                for c in crossings
            ]
        )

    return {"crossings": len(crossings)}


def _load_town_map(simulation_id: str) -> dict[str, dict[str, Any]]:
    """Load the cached normalized graph from the simulations bucket and build
    a ``segment_id -> town`` map (only segments that carry a town)."""
    key = f"{simulation_id}/graph.json"
    try:
        obj = _s3.get_object(Bucket=SIMULATIONS_BUCKET, Key=key)
    except ClientError:
        logger.warning("Graph not found at s3://%s/%s", SIMULATIONS_BUCKET, key)
        return {}
    graph = json.loads(obj["Body"].read())
    result: dict[str, dict[str, Any]] = {}
    for node in graph.get("nodes", []):
        town = node.get("town")
        if town:
            result[node["segment_id"]] = town
    return result


def _load_prior_town_risk(
    simulation_id: str, prev_tick: int, town_segment_ids: Any
) -> dict[str, str]:
    if prev_tick < 0:
        return {}
    table = _ddb.Table(os.environ["SIMULATION_STATE_TABLE"])
    try:
        resp = table.get_item(Key={"simulationId": simulation_id, "tickNumber": prev_tick})
    except ClientError:
        return {}
    item = resp.get("Item") or {}
    risk_vec = item.get("riskLevelVector", {}) or {}
    return {sid: (risk_vec.get(sid) or "none").lower() for sid in town_segment_ids}
