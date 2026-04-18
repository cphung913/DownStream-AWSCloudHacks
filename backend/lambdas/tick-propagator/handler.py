"""Tick-propagator Lambda.

Runs one advection-diffusion timestep per invocation. Orchestrated by the
Step Functions Map state: each iteration passes ``{ simulationId, input,
graphS3Key, tick }`` and expects ``{ segmentUpdates: [...] }`` back.
"""

from __future__ import annotations

import json
import logging
import os
import time
from decimal import Decimal
from typing import Any

import boto3
import numpy as np
from botocore.exceptions import ClientError

from graph_io import build_digraph, load_graph_from_s3, tick_resolution_hours, to_arrays
from physics import DECAY_K, advection_diffusion_step, classify_risk_vector

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_ddb = boto3.resource("dynamodb")
_kinesis = boto3.client("kinesis")
_sagemaker = boto3.client("sagemaker-runtime")
_ssm = boto3.client("ssm")

SIMULATIONS_BUCKET = os.environ["SIMULATIONS_BUCKET"]
SIMULATION_STATE_TABLE = os.environ["SIMULATION_STATE_TABLE"]
TICK_STREAM_NAME = os.environ["TICK_STREAM_NAME"]
SAGEMAKER_ENDPOINT_PARAM = os.environ["SAGEMAKER_ENDPOINT_PARAM"]

TTL_SECONDS = 24 * 60 * 60
KINESIS_CHUNK = 500


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    simulation_id: str = event["simulationId"]
    tick: int = int(event["tick"])
    sim_input: dict[str, Any] = event["input"]
    graph_s3_key: str = event["graphS3Key"]
    spill_type: str = sim_input["spillType"]
    temperature: float = float(sim_input["temperatureCelsius"])
    tick_resolution_minutes = int(sim_input.get("tickResolutionMinutes", 60))
    dt_hours = tick_resolution_minutes / 60.0 or tick_resolution_hours()

    # Load graph (cached in /tmp across warm invocations).
    graph = load_graph_from_s3(SIMULATIONS_BUCKET, graph_s3_key)
    g = build_digraph(graph)
    segment_ids, v, widths, dx, down = to_arrays(g)
    seg_to_idx = {s: i for i, s in enumerate(segment_ids)}
    n = len(segment_ids)

    # Load previous state from DynamoDB.
    c_prev = _load_prev_state(simulation_id, tick - 1, seg_to_idx, n)

    # SageMaker D prediction (fallback on any failure).
    D = _predict_dispersion(v, widths, temperature, spill_type, n)

    k = DECAY_K.get(spill_type, 0.0)
    c_next = advection_diffusion_step(c_prev, v, D, dx, k, dt_hours, down)

    risk_labels = classify_risk_vector(c_next, spill_type)

    # Persist to DynamoDB.
    _write_state(simulation_id, tick, segment_ids, c_next, risk_labels)

    # Build segment updates (skip zero-concentration segments to shrink payload).
    segment_updates: list[dict[str, Any]] = []
    nonzero = np.flatnonzero(c_next > 1e-9)
    for i in nonzero:
        segment_updates.append(
            {
                "segmentId": segment_ids[i],
                "concentration": float(c_next[i]),
                "riskLevel": risk_labels[i],
            }
        )

    _publish_to_kinesis(simulation_id, tick, segment_updates)

    return {"tick": tick, "segmentUpdates": segment_updates}


def _load_prev_state(
    simulation_id: str, prev_tick: int, seg_to_idx: dict[str, int], n: int
) -> np.ndarray:
    table = _ddb.Table(SIMULATION_STATE_TABLE)
    resp = table.get_item(Key={"simulationId": simulation_id, "tickNumber": prev_tick})
    item = resp.get("Item") or {}
    conc_map = item.get("concentrationVector") or {}
    c = np.zeros(n, dtype=np.float64)
    for seg_id, value in conc_map.items():
        idx = seg_to_idx.get(seg_id)
        if idx is not None:
            c[idx] = float(value)
    return c


def _write_state(
    simulation_id: str,
    tick: int,
    segment_ids: list[str],
    c_next: np.ndarray,
    risk_labels: list[str],
) -> None:
    table = _ddb.Table(SIMULATION_STATE_TABLE)
    # Only persist nonzero to keep row size in check.
    conc_vec: dict[str, Decimal] = {}
    risk_vec: dict[str, str] = {}
    for i, seg_id in enumerate(segment_ids):
        val = float(c_next[i])
        if val <= 1e-12:
            continue
        conc_vec[seg_id] = Decimal(f"{val:.10g}")
        risk_vec[seg_id] = risk_labels[i]
    table.put_item(
        Item={
            "simulationId": simulation_id,
            "tickNumber": tick,
            "concentrationVector": conc_vec,
            "riskLevelVector": risk_vec,
            "ttl": int(time.time()) + TTL_SECONDS,
        }
    )


def _predict_dispersion(
    v: np.ndarray,
    widths: np.ndarray,
    temperature: float,
    spill_type: str,
    n: int,
) -> np.ndarray:
    endpoint_name = _resolve_endpoint_name()
    if not endpoint_name:
        logger.warning("SageMaker endpoint unresolved; using fallback D.")
        return widths / 10.0

    spill_encoded = {
        "INDUSTRIAL_SOLVENT": 0,
        "AGRICULTURAL_RUNOFF": 1,
        "OIL_PETROLEUM": 2,
        "HEAVY_METALS": 3,
    }.get(spill_type, 0)

    features = np.column_stack(
        [v, widths, np.full(n, temperature, dtype=np.float64), np.full(n, spill_encoded)]
    )
    payload = "\n".join(",".join(f"{x:.6g}" for x in row) for row in features)
    try:
        resp = _sagemaker.invoke_endpoint(
            EndpointName=endpoint_name,
            ContentType="text/csv",
            Accept="text/csv",
            Body=payload.encode("utf-8"),
        )
        body = resp["Body"].read().decode("utf-8").strip()
        values = np.array([float(x) for x in body.splitlines()], dtype=np.float64)
        if values.shape[0] != n:
            logger.warning("SageMaker returned %d values for %d segments", values.shape[0], n)
            return widths / 10.0
        return values
    except ClientError:
        logger.warning("SageMaker InvokeEndpoint failed; falling back to channel_width/10.")
        return widths / 10.0


def _resolve_endpoint_name() -> str | None:
    try:
        resp = _ssm.get_parameter(Name=SAGEMAKER_ENDPOINT_PARAM)
        value = resp["Parameter"]["Value"]
        if value and value != "PENDING-DEPLOY":
            return value
    except ClientError:
        logger.warning("SSM parameter %s unavailable", SAGEMAKER_ENDPOINT_PARAM)
    return None


def _publish_to_kinesis(
    simulation_id: str, tick: int, segment_updates: list[dict[str, Any]]
) -> None:
    if not segment_updates:
        return
    records: list[dict[str, Any]] = []
    for chunk_start in range(0, len(segment_updates), KINESIS_CHUNK):
        chunk = segment_updates[chunk_start : chunk_start + KINESIS_CHUNK]
        payload = {
            "simulationId": simulation_id,
            "tick": tick,
            "segmentUpdates": chunk,
        }
        records.append(
            {
                "Data": json.dumps(payload).encode("utf-8"),
                "PartitionKey": simulation_id,
            }
        )

    # Kinesis put_records caps at 500 records / 5MB.
    for batch_start in range(0, len(records), 500):
        batch = records[batch_start : batch_start + 500]
        _kinesis.put_records(StreamName=TICK_STREAM_NAME, Records=batch)
