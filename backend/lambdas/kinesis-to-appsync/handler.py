"""Kinesis → AppSync bridge Lambda.

Consumes tick records from the Kinesis stream and fans them out to AppSync
subscribers by issuing a SigV4-signed ``publishTickUpdate`` GraphQL mutation.
The field is gated with ``@aws_iam`` so only this function can invoke it.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any
from urllib.parse import urlparse

import boto3
import urllib3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

logger = logging.getLogger()
logger.setLevel(logging.INFO)

APPSYNC_API_URL = os.environ["APPSYNC_API_URL"]
AWS_REGION = os.environ["AWS_REGION"]  # always injected by the Lambda runtime

_session = boto3.Session()
_http = urllib3.PoolManager()

MUTATION = """
mutation Publish($update: TickUpdateInput!) {
  publishTickUpdate(update: $update) {
    simulationId
    tick
    segmentUpdates { segmentId concentration riskLevel }
  }
}
""".strip()


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    records = event.get("Records", [])
    published = 0
    for record in records:
        try:
            payload_b64 = record["kinesis"]["data"]
            payload = json.loads(base64.b64decode(payload_b64).decode("utf-8"))
            _publish_update(payload)
            published += 1
        except Exception:  # noqa: BLE001 — we never want to poison-pill the batch
            logger.exception("Failed to publish a Kinesis record")
    return {"published": published, "total": len(records)}


def _publish_update(payload: dict[str, Any]) -> None:
    body = json.dumps(
        {
            "query": MUTATION,
            "variables": {"update": payload},
        }
    ).encode("utf-8")

    parsed = urlparse(APPSYNC_API_URL)
    request = AWSRequest(
        method="POST",
        url=APPSYNC_API_URL,
        data=body,
        headers={"content-type": "application/json", "host": parsed.netloc},
    )
    SigV4Auth(_session.get_credentials(), "appsync", AWS_REGION).add_auth(request)

    resp = _http.request(
        "POST",
        APPSYNC_API_URL,
        body=body,
        headers=dict(request.headers.items()),
        timeout=urllib3.Timeout(connect=2.0, read=5.0),
    )
    if resp.status >= 300:
        logger.warning("AppSync publish returned %d: %s", resp.status, resp.data[:500])
