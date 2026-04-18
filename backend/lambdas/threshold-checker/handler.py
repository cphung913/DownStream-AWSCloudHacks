"""threshold-checker: evaluates town nodes against Monitor/Advisory/Danger thresholds.

Publishes ThresholdCrossed events to EventBridge custom bus watershed-risk-events.
"""
import json
import os
from typing import Any
import boto3

events = boto3.client("events")
dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")

EVENT_BUS = os.environ["EVENT_BUS"]
TOWN_RISK_LOG_TABLE = os.environ["TOWN_RISK_LOG_TABLE"]
SIMULATION_STATE_TABLE = os.environ.get("SIMULATION_STATE_TABLE", "SimulationState")

def get_graph(region: str) -> dict:
    if region not in globals().get("GRAPH_CACHE", {}):
        key = f"{region}.geojson"
        bucket = os.environ.get("RIVER_GRAPHS_BUCKET", "watershed-river-graphs")
        obj = s3.get_object(Bucket=bucket, Key=key)
        graph = json.loads(obj["Body"].read())
        segments = {f["properties"]["segment_id"]: f["properties"] for f in graph["features"]}
        globals().setdefault("GRAPH_CACHE", {})[region] = segments
    return globals()["GRAPH_CACHE"][region]


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    simulation_id = event["simulationId"]
    tick = event["currentTick"]
    region = event.get("region", "mississippi")
    
    segments = get_graph(region)
    
    state_table = dynamodb.Table(SIMULATION_STATE_TABLE)
    resp = state_table.get_item(Key={"simulationId": simulation_id, "tickNumber": tick})
    if "Item" not in resp:
        return event
        
    current_state = json.loads(resp["Item"].get("statePayload", "{}"))
    
    prev_state = {}
    if tick > 0:
        p_resp = state_table.get_item(Key={"simulationId": simulation_id, "tickNumber": tick - 1})
        if "Item" in p_resp:
            prev_state = json.loads(p_resp["Item"].get("statePayload", "{}"))
            
    log_table = dynamodb.Table(TOWN_RISK_LOG_TABLE)
    
    thresholds = {"Danger": 10.0, "Advisory": 1.0, "Monitor": 0.1}
    
    bus_entries = []
    for seg_id, conc in current_state.items():
        if conc < 0.1 and prev_state.get(seg_id, 0.0) < 0.1:
            continue
            
        props = segments.get(seg_id)
        if not props or not props.get("town"):
            continue
            
        town = props["town"]
        town_id = f"{town['name']}-{town.get('fips', '')}"
        
        risk = "Monitor"
        if conc >= thresholds["Danger"]: risk = "Danger"
        elif conc >= thresholds["Advisory"]: risk = "Advisory"
        
        prev_conc = prev_state.get(seg_id, 0.0)
        prev_risk = "Normal"
        if prev_conc >= thresholds["Danger"]: prev_risk = "Danger"
        elif prev_conc >= thresholds["Advisory"]: prev_risk = "Advisory"
        elif prev_conc >= thresholds["Monitor"]: prev_risk = "Monitor"
        
        if risk != prev_risk:
            # Threshold crossed
            item_id = f"{town_id}#{tick}"
            log_table.put_item(
                Item={
                    "simulationId": simulation_id,
                    "townId#tickNumber": item_id,
                    "town": town,
                    "riskLevel": risk,
                    "prevRiskLevel": prev_risk,
                    "concentration": conc,
                    "tick": tick
                }
            )
            
            bus_entries.append({
                "Source": "watershed.simulation",
                "DetailType": "ThresholdCrossed",
                "Detail": json.dumps({
                    "simulationId": simulation_id,
                    "town": town,
                    "riskLevel": risk,
                    "prevRiskLevel": prev_risk,
                    "concentration": conc,
                    "tick": tick
                }),
                "EventBusName": EVENT_BUS
            })
            
    if bus_entries:
        # PutEvents accepts max 10 entries per API call
        for i in range(0, len(bus_entries), 10):
            events.put_events(Entries=bus_entries[i:i+10])
            
    return event
