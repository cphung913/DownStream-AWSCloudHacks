"""Spill initializer Lambda.

Two phases controlled by ``event["phase"]``:

- ``load``: Downloads the basin GeoJSON from ``RIVER_GRAPHS_BUCKET``, normalizes
  it into ``{ nodes, edges, sourceNodeIndex }`` and caches the raw GeoJSON back
  into ``SIMULATIONS_BUCKET`` under ``{simulationId}/graph.json``. Returns a
  reference (``graphS3Key``) rather than the inline graph to keep Step Functions
  state payloads under 256KB.
- ``init``: Seeds the initial ``SimulationState`` row for ``tick=0`` with the
  initial concentration at ``sourceSegmentId`` and produces the
  ``tickSequence`` consumed by the Map state.

Also serves as a simple Lambda resolver for the ``getSimulation`` /
``getTickSnapshot`` AppSync queries (routed through the same function).
"""

from __future__ import annotations

import json
import logging
import os
import time
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3 = boto3.client("s3")
_ddb = boto3.resource("dynamodb")

RIVER_GRAPHS_BUCKET = os.environ["RIVER_GRAPHS_BUCKET"]
SIMULATIONS_BUCKET = os.environ["SIMULATIONS_BUCKET"]
SIMULATION_STATE_TABLE = os.environ["SIMULATION_STATE_TABLE"]
TOWN_RISK_LOG_TABLE = os.environ["TOWN_RISK_LOG_TABLE"]

TTL_SECONDS = 24 * 60 * 60

ALLOWED_BASINS = {"mississippi", "ohio", "colorado"}
ALLOWED_SPILL_TYPES = {
    "INDUSTRIAL_SOLVENT",
    "AGRICULTURAL_RUNOFF",
    "OIL_PETROLEUM",
    "HEAVY_METALS",
}
MAX_VOLUME_GALLONS = 1_000_000_000.0  # 1B gal — larger than any recorded spill
MAX_TEMP_C = 60.0
MIN_TEMP_C = -5.0
MAX_RESPONSE_DELAY_HOURS = 7 * 24
MAX_TOTAL_TICKS = 2_000
MAX_BUDGET_USD = 1e12


def _validate_input(input_: dict[str, Any]) -> None:
    spill_type = str(input_.get("spillType", ""))
    if spill_type not in ALLOWED_SPILL_TYPES:
        raise ValueError(f"Invalid spillType: {spill_type!r}")
    volume = float(input_.get("volumeGallons", 0.0))
    if not (0.0 < volume <= MAX_VOLUME_GALLONS) or volume != volume:  # noqa: PLR0124 NaN check
        raise ValueError(f"volumeGallons out of range: {volume}")
    temp = float(input_.get("temperatureCelsius", 0.0))
    if not (MIN_TEMP_C <= temp <= MAX_TEMP_C) or temp != temp:  # noqa: PLR0124
        raise ValueError(f"temperatureCelsius out of range: {temp}")
    delay = int(input_.get("responseDelayHours", 0))
    if not (0 <= delay <= MAX_RESPONSE_DELAY_HOURS):
        raise ValueError(f"responseDelayHours out of range: {delay}")
    total_ticks = int(input_.get("totalTicks", 0))
    if not (1 <= total_ticks <= MAX_TOTAL_TICKS):
        raise ValueError(f"totalTicks out of range: {total_ticks}")
    budget = float(input_.get("budgetUsd", 0.0))
    if not (0.0 <= budget <= MAX_BUDGET_USD) or budget != budget:  # noqa: PLR0124
        raise ValueError(f"budgetUsd out of range: {budget}")


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    # AppSync resolver routing
    info = event.get("info") if isinstance(event, dict) else None
    if info and isinstance(info, dict):
        field = info.get("fieldName")
        args = event.get("arguments", {})
        if field == "getSimulation":
            return _get_simulation(args["simulationId"])
        if field == "getTickSnapshot":
            return _get_tick_snapshot(args["simulationId"], int(args["tick"]))

    phase = event.get("phase")
    if phase == "load":
        _validate_input(event["input"])
        basin = str(event["input"]["basin"]).lower()
        if basin not in ALLOWED_BASINS:
            raise ValueError(f"Invalid basin: {basin!r}")
        simulation_id = event["simulationId"]
        return load_graph(basin, simulation_id)
    if phase == "init":
        _validate_input(event["input"])
        return seed_initial_state(
            simulation_id=event["simulationId"],
            graph=event["graph"],
            input_=event["input"],
        )
    raise ValueError(f"Unknown phase: {phase!r}")


def load_graph(basin: str, simulation_id: str) -> dict[str, Any]:
    key = f"{basin}.geojson"
    logger.info("Loading graph s3://%s/%s", RIVER_GRAPHS_BUCKET, key)
    obj = _s3.get_object(Bucket=RIVER_GRAPHS_BUCKET, Key=key)
    geojson = json.loads(obj["Body"].read())

    features = geojson.get("features", [])
    nodes: list[dict[str, Any]] = []
    edges: list[tuple[str, str]] = []

    for feat in features:
        props = feat.get("properties", {})
        segment_id = str(props["segment_id"])
        nodes.append(
            {
                "segment_id": segment_id,
                "flow_velocity": float(props["flow_velocity"]),
                "channel_width": float(props["channel_width"]),
                "mean_depth": float(props["mean_depth"]),
                "flow_rate": float(props["flow_rate"]),
                "huc8": props.get("huc8"),
                "town": props.get("town"),
            }
        )
        for downstream_id in props.get("downstream_ids", []) or []:
            edges.append((segment_id, str(downstream_id)))

    # Cache the raw GeoJSON + normalized graph to the sim bucket, keyed by sim id.
    graph_key = f"{simulation_id}/graph.json"
    _s3.put_object(
        Bucket=SIMULATIONS_BUCKET,
        Key=graph_key,
        Body=json.dumps({"nodes": nodes, "edges": edges}).encode("utf-8"),
        ContentType="application/json",
    )

    return {
        "graphS3Key": graph_key,
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
    }


def seed_initial_state(
    simulation_id: str, graph: dict[str, Any], input_: dict[str, Any]
) -> dict[str, Any]:
    source_segment_id = str(input_["sourceSegmentId"])
    total_ticks = int(input_["totalTicks"])
    volume_gallons = float(input_["volumeGallons"])

    # Initial concentration scaled very loosely from volume (kg/m^3 placeholder).
    initial_concentration = max(0.0, volume_gallons / 1_000_000.0)

    table = _ddb.Table(SIMULATION_STATE_TABLE)
    table.put_item(
        Item={
            "simulationId": simulation_id,
            "tickNumber": 0,
            "concentrationVector": {source_segment_id: Decimal(str(initial_concentration))},
            "riskLevelVector": {source_segment_id: "danger"},
            "ttl": int(time.time()) + TTL_SECONDS,
        }
    )

    return {
        "tickSequence": list(range(1, total_ticks + 1)),
        "graphS3Key": graph.get("graphS3Key"),
        "sourceSegmentId": source_segment_id,
        "initialConcentration": initial_concentration,
    }


def _get_simulation(simulation_id: str) -> dict[str, Any] | None:
    try:
        table = _ddb.Table(SIMULATION_STATE_TABLE)
        resp = table.query(
            KeyConditionExpression="simulationId = :s",
            ExpressionAttributeValues={":s": simulation_id},
            Limit=1,
            ScanIndexForward=False,
        )
    except ClientError:
        logger.exception("getSimulation query failed")
        return None

    items = resp.get("Items", [])
    if not items:
        return None
    item = items[0]
    return {
        "simulationId": simulation_id,
        "executionArn": simulation_id,
        "currentTick": int(item.get("tickNumber", 0)),
        "basin": "MISSISSIPPI",
        "sourceSegmentId": "",
        "spillType": "OIL_PETROLEUM",
        "volumeGallons": 0.0,
        "temperatureCelsius": 0.0,
        "responseDelayHours": 0,
        "budgetUsd": 0.0,
        "tickResolutionMinutes": 60,
        "totalTicks": 72,
        "townRisks": [],
        "report": None,
    }


def _get_tick_snapshot(simulation_id: str, tick: int) -> dict[str, Any] | None:
    table = _ddb.Table(SIMULATION_STATE_TABLE)
    resp = table.get_item(Key={"simulationId": simulation_id, "tickNumber": tick})
    item = resp.get("Item")
    if not item:
        return None
    conc = item.get("concentrationVector", {}) or {}
    risk = item.get("riskLevelVector", {}) or {}
    updates = [
        {
            "segmentId": seg_id,
            "concentration": float(conc[seg_id]),
            "riskLevel": (risk.get(seg_id) or "NONE").upper(),
        }
        for seg_id in conc
    ]
    return {"simulationId": simulation_id, "tick": tick, "segmentUpdates": updates}
