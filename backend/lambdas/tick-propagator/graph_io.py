"""S3 graph loading + conversion helpers for tick-propagator.

Caches the parsed graph in ``/tmp`` so warm-starts reuse it across ticks.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import boto3
import networkx as nx
import numpy as np
import scipy.sparse as sp

_s3 = boto3.client("s3")
_CACHE_DIR = Path("/tmp")


def load_graph_from_s3(bucket: str, key: str) -> dict:
    cache_file = _CACHE_DIR / key.replace("/", "_")
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    obj = _s3.get_object(Bucket=bucket, Key=key)
    data = json.loads(obj["Body"].read())
    try:
        cache_file.write_text(json.dumps(data))
    except OSError:
        pass
    return data


def build_digraph(graph: dict) -> nx.DiGraph:
    g = nx.DiGraph()
    for node in graph["nodes"]:
        g.add_node(node["segment_id"], **node)
    for src, dst in graph["edges"]:
        g.add_edge(src, dst)
    return g


def to_arrays(g: nx.DiGraph) -> tuple[list[str], np.ndarray, np.ndarray, np.ndarray, sp.csr_matrix]:
    """Convert a graph to vectorized arrays consumed by ``physics.advection_diffusion_step``.

    Returns
    -------
    (segment_ids, v, channel_width, dx, downstream_matrix)
    """
    segment_ids = list(g.nodes)
    idx = {sid: i for i, sid in enumerate(segment_ids)}
    n = len(segment_ids)

    v = np.zeros(n, dtype=np.float64)
    widths = np.zeros(n, dtype=np.float64)
    dx = np.zeros(n, dtype=np.float64)

    for sid in segment_ids:
        attrs = g.nodes[sid]
        i = idx[sid]
        v[i] = float(attrs.get("flow_velocity", 0.0))
        widths[i] = float(attrs.get("channel_width", 0.0))
        flow_rate = float(attrs.get("flow_rate", 0.0))
        mean_depth = float(attrs.get("mean_depth", 1.0)) or 1.0
        # Characteristic segment length ~ flow_rate / (v * width * depth) fallback to 1km.
        area = max(widths[i] * mean_depth, 1e-3)
        denom = max(v[i] * area, 1e-6)
        dx[i] = max(flow_rate / denom, 100.0) if flow_rate > 0 else 1000.0

    rows: list[int] = []
    cols: list[int] = []
    for src, dst in g.edges:
        if src in idx and dst in idx:
            rows.append(idx[src])
            cols.append(idx[dst])
    data = np.ones(len(rows), dtype=np.float64)
    downstream_matrix = sp.csr_matrix((data, (rows, cols)), shape=(n, n))

    return segment_ids, v, widths, dx, downstream_matrix


def tick_resolution_hours() -> float:
    return float(os.environ.get("DEFAULT_TICK_HOURS", "1.0"))
