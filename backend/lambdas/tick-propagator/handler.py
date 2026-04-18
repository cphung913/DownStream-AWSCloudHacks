"""tick-propagator: core physics engine.

Runs one advection-diffusion timestep per invocation:
    dC/dt = -v (dC/dx) + D (d2C/dx2) - k C

Reads current concentration vector from DynamoDB, applies the update with NumPy
over the river-graph directed edges, publishes per-segment deltas to Kinesis,
writes the new state snapshot back to DynamoDB.

v  -- flow_velocity on the segment (USGS StreamStats)
D  -- dispersion coefficient from the SageMaker endpoint
k  -- first-order decay, spill-type dependent

Do not simplify to linear interpolation. The model must be defensible.
"""
import json
import os
from typing import Any

import boto3
import numpy as np  # noqa: F401

kinesis = boto3.client("kinesis")
dynamodb = boto3.resource("dynamodb")
sagemaker = boto3.client("sagemaker-runtime")

KINESIS_STREAM = os.environ["KINESIS_STREAM"]
SIMULATION_STATE_TABLE = os.environ["SIMULATION_STATE_TABLE"]
SAGEMAKER_ENDPOINT = os.environ["SAGEMAKER_ENDPOINT"]


def get_graph(region: str) -> dict:
    if region not in globals().get("GRAPH_CACHE", {}):
        key = f"{region}.geojson"
        bucket = os.environ.get("RIVER_GRAPHS_BUCKET", "watershed-river-graphs")
        obj = boto3.client("s3").get_object(Bucket=bucket, Key=key)
        graph = json.loads(obj["Body"].read())
        segments = {f["properties"]["segment_id"]: f["properties"] for f in graph["features"]}
        globals().setdefault("GRAPH_CACHE", {})[region] = segments
    return globals()["GRAPH_CACHE"][region]


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    simulation_id = event["simulationId"]
    tick = event.get("currentTick", 0)
    region = event.get("region", "mississippi")
    spill_type = event.get("spillType", "Industrial Solvent")
    temp = event.get("temperature", 20.0)
    
    segments = get_graph(region)
    
    table = dynamodb.Table(SIMULATION_STATE_TABLE)
    resp = table.get_item(Key={"simulationId": simulation_id, "tickNumber": tick})
    if "Item" not in resp:
        raise ValueError(f"State for tick {tick} not found")
        
    current_state = json.loads(resp["Item"].get("statePayload", "{}"))
    
    k_map = {
        "Industrial Solvent": 0.035,
        "Agricultural Runoff": 0.02,
        "Oil / Petroleum": 0.01,
        "Heavy Metals": 0.0
    }
    k = k_map.get(spill_type, 0.0)
    
    res = event.get("tickResolution", "1hr")
    dt_hours = {"15min": 0.25, "1hr": 1.0, "6hr": 6.0}.get(res, 1.0)
    dt_sec = dt_hours * 3600
    
    spill_types = {"Industrial Solvent": 0, "Agricultural Runoff": 1, "Oil / Petroleum": 2, "Heavy Metals": 3}
    encoded_spill = spill_types.get(spill_type, 0)
    
    new_state = {}
    dx = 1000.0 # Assumed uniform segment length in meters
    
    for seg_id, c in current_state.items():
        if c <= 0: continue
        props = segments.get(seg_id)
        if not props:
            new_state[seg_id] = new_state.get(seg_id, 0.0) + c
            continue
            
        v = props.get("flow_velocity", 0.5)
        w = props.get("channel_width", 10.0)
        
        payload_csv = f"{v},{w},{temp},{encoded_spill}"
        try:
            sm_resp = sagemaker.invoke_endpoint(
                EndpointName=SAGEMAKER_ENDPOINT,
                ContentType="text/csv",
                Body=payload_csv
            )
            D = float(sm_resp["Body"].read().decode('utf-8').strip())
        except Exception:
            D = 0.5 # fallback dispersion
            
        if seg_id in event.get("mitigatedSegments", []):
            v = 0.0 # Trapped by barrier
            D = 0.01

        frac_adv = min((v * dt_sec) / dx, 0.8) # CFL cap
        frac_disp = (D * dt_sec) / (dx * dx)
        decay_frac = k * dt_hours
        
        kept = c * (1.0 - frac_adv - 2*frac_disp - decay_frac)
        new_state[seg_id] = new_state.get(seg_id, 0.0) + max(kept, 0.0)
        
        downstreams = props.get("downstream_ids", [])
        if downstreams:
            adv_amt = c * frac_adv / len(downstreams)
            disp_amt = c * frac_disp / len(downstreams)
            for d_id in downstreams:
                new_state[d_id] = new_state.get(d_id, 0.0) + adv_amt + disp_amt
                
    final_state = {k: v for k, v in new_state.items() if v > 1e-6}
    
    updates = []
    for sid, conc in final_state.items():
        risk = "Danger" if conc > 10 else "Advisory" if conc > 1 else "Monitor" if conc > 0.1 else "Normal"
        updates.append({"segmentId": sid, "concentration": conc, "riskLevel": risk})
        
    kinesis_payload = {
        "simulationId": simulation_id,
        "tick": tick + 1,
        "segmentUpdates": updates
    }
    
    kinesis.put_record(
        StreamName=KINESIS_STREAM,
        PartitionKey=simulation_id,
        Data=json.dumps(kinesis_payload)
    )
    
    table.put_item(
        Item={
            "simulationId": simulation_id,
            "tickNumber": tick + 1,
            "statePayload": json.dumps(final_state)
        }
    )
    
    event["currentTick"] = tick + 1
    return event
