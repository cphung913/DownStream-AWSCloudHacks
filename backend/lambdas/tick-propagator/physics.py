"""1D advection-diffusion physics for the DownStream simulator.

Solves :math:`\\partial C/\\partial t = -v\\,\\partial C/\\partial x +
D\\,\\partial^2 C/\\partial x^2 - kC` over a directed river graph using an
explicit Euler finite-difference scheme. Vectorized over all segments via a
sparse upstream-to-downstream adjacency matrix.
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp

SPILL_TYPE_THRESHOLDS: dict[str, dict[str, float]] = {
    "INDUSTRIAL_SOLVENT": {"monitor": 0.001, "advisory": 0.01, "danger": 0.1},
    "AGRICULTURAL_RUNOFF": {"monitor": 0.005, "advisory": 0.05, "danger": 0.5},
    "OIL_PETROLEUM": {"monitor": 0.0005, "advisory": 0.005, "danger": 0.05},
    "HEAVY_METALS": {"monitor": 0.0001, "advisory": 0.001, "danger": 0.01},
}

DECAY_K: dict[str, float] = {
    "INDUSTRIAL_SOLVENT": 0.035,
    "AGRICULTURAL_RUNOFF": 0.02,
    "OIL_PETROLEUM": 0.01,
    "HEAVY_METALS": 0.0,
}


def advection_diffusion_step(
    c_prev: np.ndarray,
    v: np.ndarray,
    D: np.ndarray,
    dx: np.ndarray,
    k: float,
    dt: float,
    downstream_matrix: sp.csr_matrix,
) -> np.ndarray:
    """Advance concentration by one explicit Euler timestep.

    Parameters
    ----------
    c_prev:
        Concentration at tick ``N-1``. Shape ``(num_segments,)``.
    v:
        Flow velocity per segment (m/s).
    D:
        Longitudinal dispersion coefficient per segment (m^2/s).
    dx:
        Per-segment characteristic length (m).
    k:
        First-order decay rate (hr^-1). Converted internally to per-second.
    dt:
        Timestep length in hours.
    downstream_matrix:
        Sparse ``(num_segments, num_segments)`` adjacency where
        ``M[i, j] == 1`` iff segment ``i`` drains into segment ``j``. Columns
        are normalized so each downstream segment receives mass proportional
        to the number of upstream contributors.

    Returns
    -------
    np.ndarray
        New concentration vector ``c_next``, clipped at zero.
    """
    dt_s = dt * 3600.0
    k_s = k / 3600.0

    safe_dx = np.where(dx > 0, dx, 1.0)

    # Advective contribution from upstream: mass transported downstream per second.
    # Sum over upstream contributors of v_i * C_i / dx_i, received by downstream j.
    upstream_flux_density = (v * c_prev) / safe_dx
    advect_in = downstream_matrix.T.dot(upstream_flux_density)

    # Advective loss from current segment.
    advect_out = (v * c_prev) / safe_dx

    # Diffusion: approximated with a discrete graph-Laplacian-like term.
    # Each segment exchanges with its downstream neighbors via D / dx^2.
    diff_coeff = D / (safe_dx**2)
    diff_in = downstream_matrix.T.dot(diff_coeff * c_prev)
    neighbor_count = np.asarray(downstream_matrix.sum(axis=1)).ravel()
    diff_out = diff_coeff * c_prev * np.maximum(neighbor_count, 1.0)

    dcdt = advect_in - advect_out + diff_in - diff_out - k_s * c_prev
    c_next = c_prev + dt_s * dcdt
    return np.clip(c_next, 0.0, None)


def classify_risk(concentration: float, spill_type: str) -> str:
    """Return one of ``none`` / ``monitor`` / ``advisory`` / ``danger``."""
    thresholds = SPILL_TYPE_THRESHOLDS.get(spill_type)
    if thresholds is None:
        return "none"
    if concentration >= thresholds["danger"]:
        return "danger"
    if concentration >= thresholds["advisory"]:
        return "advisory"
    if concentration >= thresholds["monitor"]:
        return "monitor"
    return "none"


def classify_risk_vector(c: np.ndarray, spill_type: str) -> list[str]:
    thresholds = SPILL_TYPE_THRESHOLDS.get(spill_type)
    if thresholds is None:
        return ["none"] * int(c.shape[0])
    labels = np.full(c.shape, "none", dtype=object)
    labels[c >= thresholds["monitor"]] = "monitor"
    labels[c >= thresholds["advisory"]] = "advisory"
    labels[c >= thresholds["danger"]] = "danger"
    return labels.tolist()
