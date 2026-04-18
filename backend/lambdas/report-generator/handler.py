"""Report-generator Lambda.

Aggregates the simulation outcome (town risk log + final tick state), asks
Bedrock Claude for an EPA-style incident briefing, validates the JSON, and
saves the result to ``SIMULATIONS_BUCKET/{simulationId}/report.json``.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel, Field, ValidationError

from prompts import SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_ddb = boto3.resource("dynamodb")
_s3 = boto3.client("s3")
_bedrock = boto3.client("bedrock-runtime")

SIMULATIONS_BUCKET = os.environ["SIMULATIONS_BUCKET"]
SIMULATION_STATE_TABLE = os.environ["SIMULATION_STATE_TABLE"]
TOWN_RISK_LOG_TABLE = os.environ["TOWN_RISK_LOG_TABLE"]
BEDROCK_MODEL_ID = os.environ["BEDROCK_MODEL_ID"]

_RISK_ORDER = {"none": 0, "monitor": 1, "advisory": 2, "danger": 3}


class IncidentReport(BaseModel):
    executiveSummary: str = Field(max_length=8000)
    populationAtRisk: int = Field(ge=0)
    estimatedCleanupCost: float = Field(ge=0.0)
    regulatoryObligations: list[str]
    mitigationPriorityList: list[str]


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    simulation_id: str = event["simulationId"]
    sim_input: dict[str, Any] = event["input"]

    affected_towns = _aggregate_towns(simulation_id)

    user_prompt = build_user_prompt(
        spill_type=sim_input["spillType"],
        volume_gallons=float(sim_input["volumeGallons"]),
        temperature_c=float(sim_input["temperatureCelsius"]),
        response_delay_hours=int(sim_input["responseDelayHours"]),
        affected_towns=affected_towns,
        mitigation_delta=None,
    )

    report = _invoke_bedrock(user_prompt)
    if report is None:
        # Retry once with a stricter instruction, then degrade gracefully.
        strict_prompt = user_prompt + "\n\nReturn ONLY the JSON object. No preface. No code fences."
        report = _invoke_bedrock(strict_prompt)

    if report is None:
        logger.warning("Bedrock failed twice; returning degraded stub report.")
        report = {
            "executiveSummary": (
                "Report generation unavailable. Review raw simulation state in DynamoDB."
            ),
            "populationAtRisk": sum(int(t.get("population", 0)) for t in affected_towns),
            "estimatedCleanupCost": 0.0,
            "regulatoryObligations": [
                "40 CFR § 300.125 — notify the National Response Center (NRC).",
            ],
            "mitigationPriorityList": [
                "Deploy containment at nearest upstream crossing.",
            ],
            "reportQuality": "degraded",
        }

    _s3.put_object(
        Bucket=SIMULATIONS_BUCKET,
        Key=f"{simulation_id}/report.json",
        Body=json.dumps(report).encode("utf-8"),
        ContentType="application/json",
    )
    return report


def _aggregate_towns(simulation_id: str) -> list[dict[str, Any]]:
    table = _ddb.Table(TOWN_RISK_LOG_TABLE)
    try:
        resp = table.query(
            KeyConditionExpression="simulationId = :s",
            ExpressionAttributeValues={":s": simulation_id},
        )
    except ClientError:
        logger.exception("TownRiskLog query failed")
        return []
    items = resp.get("Items", []) or []
    by_town: dict[str, dict[str, Any]] = {}
    for item in items:
        town_id = item.get("townId")
        if not town_id:
            continue
        tick = int(item.get("townIdTickNumber", "#0").split("#")[-1])
        risk = (item.get("riskLevel") or "none").lower()
        existing = by_town.get(town_id)
        if existing is None:
            by_town[town_id] = {
                "name": item.get("townName", "Unknown"),
                "population": int(item.get("population", 0)),
                "firstThresholdTick": tick,
                "peakRiskLevel": risk,
            }
        else:
            if tick < existing["firstThresholdTick"]:
                existing["firstThresholdTick"] = tick
            if _RISK_ORDER.get(risk, 0) > _RISK_ORDER.get(existing["peakRiskLevel"], 0):
                existing["peakRiskLevel"] = risk
    return list(by_town.values())


def _invoke_bedrock(user_prompt: str) -> dict[str, Any] | None:
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    try:
        resp = _bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body).encode("utf-8"),
        )
    except ClientError:
        logger.exception("Bedrock InvokeModel failed")
        return None

    payload = json.loads(resp["body"].read())
    text_parts = [
        block.get("text", "")
        for block in payload.get("content", [])
        if block.get("type") == "text"
    ]
    raw = "".join(text_parts).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        data = json.loads(raw)
        IncidentReport.model_validate(data)
        return data
    except (json.JSONDecodeError, ValidationError):
        logger.warning("Bedrock returned non-conforming JSON: %s", raw[:500])
        return None
