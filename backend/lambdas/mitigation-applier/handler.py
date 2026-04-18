"""mitigation-applier: re-weights river-graph edges when user places a barrier.

Enforces the budget cap here (not in the UI). When cumulative mitigation
cost exceeds budgetCapUsd, return 409 and leave state untouched.
"""
import json
import os
from typing import Any
import boto3

dynamodb = boto3.resource("dynamodb")
stepfunctions = boto3.client("stepfunctions")

SIMULATION_STATE_TABLE = os.environ.get("SIMULATION_STATE_TABLE", "SimulationState")
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    simulation_id = event["simulationId"]
    budget_cap = float(event.get("budgetCapUsd", 100000))
    current_cost = float(event.get("cumulativeCostUsd", 0))
    new_cost = float(event.get("mitigationCostUsd", 0))
    
    if current_cost + new_cost > budget_cap:
        return {
            "statusCode": 409,
            "body": "Budget cap exceeded"
        }
        
    mitigated = event.get("mitigatedSegments", [])
    if "segmentId" in event:
        mitigated.append(event["segmentId"])
        
    execution_payload = {
        "simulationId": simulation_id,
        "region": event.get("region", "mississippi"),
        "spillType": event.get("spillType", "Industrial Solvent"),
        "budgetCapUsd": budget_cap,
        "cumulativeCostUsd": current_cost + new_cost,
        "currentTick": event.get("currentTick", 0),
        "tickResolution": event.get("tickResolution", "1hr"),
        "temperature": event.get("temperature", 20.0),
        "mitigatedSegments": mitigated,
        "action": "resume" # skips initialization if Step Functions maps this
    }
    
    try:
        stepfunctions.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps(execution_payload)
        )
    except Exception as e:
        return {
            "statusCode": 500,
            "body": f"Failed to restart state machine: {e}"
        }
        
    return {
        "statusCode": 200,
        "body": "Mitigation applied",
        "cumulativeCostUsd": current_cost + new_cost,
        "mitigatedSegments": mitigated
    }
