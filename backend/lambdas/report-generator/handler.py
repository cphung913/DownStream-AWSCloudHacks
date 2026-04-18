"""report-generator: assembles simulation summary, calls Bedrock once per simulation.

Returns structured JSON matching the IncidentReport GraphQL type.
"""
import json
import os
from typing import Any

import boto3

from prompts import INCIDENT_REPORT_SYSTEM_PROMPT, build_user_prompt

bedrock = boto3.client("bedrock-runtime")
dynamodb = boto3.resource("dynamodb")

BEDROCK_MODEL_ID = os.environ["BEDROCK_MODEL_ID"]
SIMULATION_STATE_TABLE = os.environ["SIMULATION_STATE_TABLE"]
TOWN_RISK_LOG_TABLE = os.environ["TOWN_RISK_LOG_TABLE"]


from boto3.dynamodb.conditions import Key

def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    simulation_id = event["simulationId"]
    summary = _gather_summary(simulation_id, event)
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2000,
        "system": INCIDENT_REPORT_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": build_user_prompt(summary)}],
    }
    resp = bedrock.invoke_model(modelId=BEDROCK_MODEL_ID, body=json.dumps(body))
    payload = json.loads(resp["body"].read())
    return json.loads(payload["content"][0]["text"])


def _gather_summary(simulation_id: str, event: dict[str, Any]) -> dict[str, Any]:
    log_table = dynamodb.Table(TOWN_RISK_LOG_TABLE)
    resp = log_table.query(KeyConditionExpression=Key("simulationId").eq(simulation_id))
    
    towns = {}
    for item in resp.get("Items", []):
        t = item["town"]
        t_name = t.get("name", "Unknown Town")
        if t_name not in towns:
            towns[t_name] = {"tick": int(item["tick"]), "pop": t.get("population", 0), "risk": item["riskLevel"]}
        else:
            if int(item["tick"]) < towns[t_name]["tick"]:
                towns[t_name]["tick"] = int(item["tick"])
            if item["riskLevel"] == "Danger":
                towns[t_name]["risk"] = "Danger"
                
    towns_list = sorted(towns.items(), key=lambda x: x[1]["tick"])
    
    towns_str = ""
    for name, data in towns_list:
        towns_str += f"- {name} (Pop {data['pop']}): {data['risk']} breached at tick {data['tick']}\n"
        
    if not towns_str:
        towns_str = "No towns breached thresholds during the simulated timeframe."
        
    return {
        "region": event.get("region", "Mississippi"),
        "spillType": event.get("spillType", "Industrial Solvent"),
        "volumeGallons": event.get("volumeGallons", 10000),
        "responseDelayHours": event.get("responseDelayHours", 0),
        "tickResolution": event.get("tickResolution", "1hr"),
        "townsTable": towns_str,
        "mitigationDelta": event.get("mitigationSummary", "No mitigation actions taken.")
    }
