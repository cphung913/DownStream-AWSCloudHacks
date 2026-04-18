"""Mitigation-applier Lambda.

Applies a user-placed mitigation (containment barrier, boom, bioremediation,
diversion) to the cached graph overlay in S3, enforces the budget cap
(returning 409 on exceed), and triggers a new Step Functions execution
starting from ``fromTick`` forward.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_s3 = boto3.client("s3")
_sfn = boto3.client("stepfunctions")

SIMULATIONS_BUCKET = os.environ["SIMULATIONS_BUCKET"]
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]

ALLOWED_KINDS = {"containment_barrier", "boom", "bioremediation", "diversion"}
MAX_RADIUS_M = 50_000.0
MAX_COST_USD = 1e10
MAX_BUDGET_USD = 1e12


def _validate_mitigation(m: dict[str, Any]) -> None:
    kind = m.get("kind")
    if kind not in ALLOWED_KINDS:
        raise ValueError(f"Invalid mitigation kind: {kind!r}")
    seg = m.get("segmentId")
    if not isinstance(seg, str) or not seg or len(seg) > 128:
        raise ValueError("Invalid segmentId")
    cost = float(m.get("costUsd", 0.0))
    if not (0.0 <= cost <= MAX_COST_USD) or cost != cost:  # noqa: PLR0124
        raise ValueError(f"costUsd out of range: {cost}")
    radius = m.get("radiusMeters")
    if radius is not None:
        r = float(radius)
        if not (0.0 <= r <= MAX_RADIUS_M) or r != r:  # noqa: PLR0124
            raise ValueError(f"radiusMeters out of range: {r}")


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    # Unwrap AppSync resolver context if present.
    if isinstance(event.get("arguments"), dict):
        args = event["arguments"]
        simulation_id = args["simulationId"]
        mitigation = args["mitigation"]
        from_tick = int(args.get("fromTick", 0))
        original_input = args.get("input", {})
    else:
        simulation_id = event["simulationId"]
        mitigation = event["mitigation"]
        from_tick = int(event.get("fromTick", 0))
        original_input = event.get("input", {})

    _validate_mitigation(mitigation)

    budget_usd = float(original_input.get("budgetUsd", 0.0))
    if not (0.0 <= budget_usd <= MAX_BUDGET_USD) or budget_usd != budget_usd:  # noqa: PLR0124
        raise ValueError(f"budgetUsd out of range: {budget_usd}")
    cost_usd = float(mitigation["costUsd"])

    spend = _load_spend(simulation_id)
    total_spent = float(spend.get("totalSpent", 0.0))
    if budget_usd > 0 and total_spent + cost_usd > budget_usd:
        over = (total_spent + cost_usd) - budget_usd
        logger.info("Budget exceeded by $%.2f for %s", over, simulation_id)
        return {
            "statusCode": 409,
            "body": {
                "error": "BUDGET_EXCEEDED",
                "over": over,
                "totalSpent": total_spent,
                "budgetUsd": budget_usd,
            },
        }

    overlay = _load_overlay(simulation_id)
    overlay = _apply_mitigation(overlay, mitigation)
    _save_overlay(simulation_id, overlay)

    # Append to spend manifest.
    spend.setdefault("mitigations", []).append(mitigation)
    spend["totalSpent"] = total_spent + cost_usd
    _save_spend(simulation_id, spend)

    # Kick off a re-simulation.
    exec_input = {
        **original_input,
        "_resumeFromTick": from_tick,
        "_parentSimulationId": simulation_id,
    }
    resp = _sfn.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        input=json.dumps(exec_input),
    )

    return {
        "statusCode": 202,
        "body": {
            "newExecutionArn": resp["executionArn"],
            "totalSpent": spend["totalSpent"],
            "budgetUsd": budget_usd,
        },
    }


def _apply_mitigation(overlay: dict[str, Any], m: dict[str, Any]) -> dict[str, Any]:
    kind = m["kind"]
    segment_id = str(m["segmentId"])
    radius = float(m.get("radiusMeters") or 0.0)

    overlay.setdefault("downstreamMultiplier", {})
    overlay.setdefault("dispersionMultiplier", {})
    overlay.setdefault("decayAdd", {})
    overlay.setdefault("diversions", {})

    if kind == "containment_barrier":
        overlay["downstreamMultiplier"][segment_id] = 0.0
    elif kind == "boom":
        overlay["dispersionMultiplier"][segment_id] = 0.5
        overlay.setdefault("boomRadii", {})[segment_id] = radius
    elif kind == "bioremediation":
        overlay["decayAdd"][segment_id] = 0.05
        overlay.setdefault("bioRadii", {})[segment_id] = radius
    elif kind == "diversion":
        overlay["diversions"][segment_id] = m.get("divertTo", [])
    else:
        raise ValueError(f"Unknown mitigation kind: {kind}")
    return overlay


def _load_spend(simulation_id: str) -> dict[str, Any]:
    return _load_json(f"{simulation_id}/spend.json", default={"totalSpent": 0.0, "mitigations": []})


def _save_spend(simulation_id: str, spend: dict[str, Any]) -> None:
    _save_json(f"{simulation_id}/spend.json", spend)


def _load_overlay(simulation_id: str) -> dict[str, Any]:
    return _load_json(f"{simulation_id}/graph-overlay.json", default={})


def _save_overlay(simulation_id: str, overlay: dict[str, Any]) -> None:
    _save_json(f"{simulation_id}/graph-overlay.json", overlay)


def _load_json(key: str, default: dict[str, Any]) -> dict[str, Any]:
    try:
        obj = _s3.get_object(Bucket=SIMULATIONS_BUCKET, Key=key)
        return json.loads(obj["Body"].read())
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
            return dict(default)
        raise


def _save_json(key: str, data: dict[str, Any]) -> None:
    _s3.put_object(
        Bucket=SIMULATIONS_BUCKET,
        Key=key,
        Body=json.dumps(data).encode("utf-8"),
        ContentType="application/json",
    )
