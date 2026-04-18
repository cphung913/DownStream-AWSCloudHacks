"""spill-initializer: validates input, loads river graph, seeds initial concentration.

All AWS resource ARNs come from env vars populated by CDK.
"""
import json
import os
from typing import Any

import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

RIVER_GRAPHS_BUCKET = os.environ["RIVER_GRAPHS_BUCKET"]
SIMULATION_STATE_TABLE = os.environ["SIMULATION_STATE_TABLE"]


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get("action")
    simulation_id = event.get("simulationId", "unknown-simulation")
    if action == "validate":
        return _validate(event["input"])
    if action == "loadGraph":
        return _load_graph(event["region"])
    if action == "seed":
        return _seed(event["input"], simulation_id)
    raise ValueError(f"unknown action: {action}")


def _validate(payload: dict[str, Any]) -> dict[str, Any]:
    required = {"region", "sourceSegmentId", "spillType", "volumeGallons", "responseDelayHours", "budgetCapUsd", "tickResolution"}
    missing = required - payload.keys()
    if missing:
        raise ValueError(f"missing fields: {sorted(missing)}")
    return payload


def _load_graph(region: str) -> dict[str, Any]:
    key = f"{region}.geojson"
    obj = s3.get_object(Bucket=RIVER_GRAPHS_BUCKET, Key=key)
    graph = json.loads(obj["Body"].read())
    return {"region": region, "segmentCount": len(graph["features"])}


def _seed(payload: dict[str, Any], simulation_id: str) -> dict[str, Any]:
    # Build tick schedule based on responseDelayHours and tickResolution.
    delay_hours = float(payload.get("responseDelayHours", 0))
    res = payload.get("tickResolution", "1hr")
    
    if res == "15min":
        total_ticks = int(delay_hours * 4)
    elif res == "6hr":
        total_ticks = int(delay_hours / 6)
    else:
        total_ticks = int(delay_hours) # default to 1hr
        
    source_segment = payload.get("sourceSegmentId")
    volume = float(payload.get("volumeGallons", 0))
    
    # Write initial zero-concentration vector; seed source segment.
    # We serialize it as JSON to save DynamoDB limits and allow straightforward reading.
    initial_state = {
        source_segment: volume
    }
    
    table = dynamodb.Table(SIMULATION_STATE_TABLE)
    table.put_item(
        Item={
            "simulationId": simulation_id,
            "tickNumber": 0,
            "statePayload": json.dumps(initial_state)
        }
    )
    
    return {
        "simulationId": simulation_id,
        "currentTick": 0,
        "totalTicks": total_ticks,
        "region": payload.get("region"),
        "spillType": payload.get("spillType"),
        "budgetCapUsd": payload.get("budgetCapUsd")
    }
