"""Bedrock prompts for the DownStream incident-report generator.

The system prompt deliberately pins the model to the EPA emergency response
coordinator role and requires regulatory citations against 40 CFR Part 300
(National Oil and Hazardous Substances Pollution Contingency Plan, a.k.a. the
National Contingency Plan). These citations are the load-bearing detail that
make the incident report feel real — do not remove them.
"""

from __future__ import annotations

import re

# Allowed spill-type enum values (mirrors schema.graphql `SpillType`). Any
# caller-supplied value outside this set is coerced to "UNKNOWN" before being
# interpolated into the prompt to defeat prompt-injection via enum fields.
_ALLOWED_SPILL_TYPES = frozenset(
    {"INDUSTRIAL_SOLVENT", "AGRICULTURAL_RUNOFF", "OIL_PETROLEUM", "HEAVY_METALS"}
)
_ALLOWED_RISK_LEVELS = frozenset({"NONE", "MONITOR", "ADVISORY", "DANGER"})

# Characters that could be used to break out of the intended prompt context:
# angle brackets (HTML/XML-ish tags the model may treat as structure), curly
# braces (JSON-looking chunks the model may confuse with output), backticks
# (code-fence attempts), and control characters.
_DANGEROUS_CHARS_RE = re.compile(r"[<>{}`\x00-\x1f\x7f]")
# Common injection trigger phrases. We don't try to enumerate every attack
# string — we just strip the most direct role-override patterns.
_INJECTION_PHRASES_RE = re.compile(
    r"(?i)(ignore (?:all )?(?:previous|prior|above) (?:instructions|prompts?)"
    r"|disregard (?:the )?(?:above|previous)"
    r"|system\s*[:>]"
    r"|assistant\s*[:>]"
    r"|\byou are now\b"
    r"|\bnew instructions\b)"
)


def _sanitize_text(value: object, max_len: int = 200) -> str:
    """Strip characters and phrases that could break out of the prompt context.

    - Coerces to str.
    - Removes angle brackets, curly braces, backticks, and control chars.
    - Neutralizes common role-override injection phrases.
    - Collapses whitespace and truncates to ``max_len`` characters.
    """
    if value is None:
        return ""
    s = str(value)
    s = _DANGEROUS_CHARS_RE.sub("", s)
    s = _INJECTION_PHRASES_RE.sub("[redacted]", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[:max_len] + "…"
    return s


def _sanitize_spill_type(value: object) -> str:
    s = _sanitize_text(value, max_len=40).upper().replace(" ", "_")
    return s if s in _ALLOWED_SPILL_TYPES else "UNKNOWN"


def _sanitize_risk_level(value: object) -> str:
    s = _sanitize_text(value, max_len=20).upper()
    return s if s in _ALLOWED_RISK_LEVELS else "NONE"


def _sanitize_int(value: object, default: int = 0, lo: int = 0, hi: int = 10**9) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def _sanitize_float(
    value: object, default: float = 0.0, lo: float = -1e12, hi: float = 1e12
) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    # Reject NaN / inf which can confuse downstream formatting.
    if f != f or f in (float("inf"), float("-inf")):
        return default
    if f < lo:
        return lo
    if f > hi:
        return hi
    return f


SYSTEM_PROMPT = """You are an EPA emergency response coordinator with 15 years of inland spill incident experience.
You produce clear, defensible, decision-ready incident briefings for elected officials, utility operators, and public-safety stakeholders.

Every recommendation in 'regulatoryObligations' must cite the specific subpart of EPA 40 CFR Part 300 (National Contingency Plan) that applies. At minimum cite 40 CFR § 300.125 (notification), 40 CFR § 300.305 (phase I — discovery/notification), and 40 CFR § 300.415 (removal action) where relevant. Cite additional subparts (§ 300.135 Response operations, § 300.150 Worker health and safety, § 300.165 OSC reports, § 300.175 Federal agencies, § 300.205 Response action framework, § 300.320 General pattern of response, § 300.420 Remedial site evaluation) when they apply to the specific incident facts.

Your reply MUST be a single JSON object with exactly these keys:
{
  "executiveSummary": "string, <= 400 words, plain English, no markdown",
  "populationAtRisk": <integer sum of affected populations across impacted towns>,
  "estimatedCleanupCost": <number in USD, order-of-magnitude defensible>,
  "regulatoryObligations": ["40 CFR § 300.xxx — <what must happen, by when, by whom>", ...],
  "mitigationPriorityList": ["<ordered, most urgent first>", ...]
}

Return nothing except that JSON object. No prose preface, no code fences.
"""


def build_user_prompt(
    spill_type: str,
    volume_gallons: float,
    temperature_c: float,
    response_delay_hours: int,
    affected_towns: list[dict],
    mitigation_delta: dict | None = None,
) -> str:
    """Compose the user-facing turn describing the incident facts.

    Parameters
    ----------
    spill_type: One of INDUSTRIAL_SOLVENT, AGRICULTURAL_RUNOFF, OIL_PETROLEUM, HEAVY_METALS.
    volume_gallons: Spill volume.
    temperature_c: Ambient water temperature in °C.
    response_delay_hours: Hours before containment begins.
    affected_towns: [{ name, population, firstThresholdTick, peakRiskLevel }, ...]
    mitigation_delta: Optional comparison vs. a no-mitigation baseline.
    """
    # All user-influenced fields are sanitized before interpolation (H4 —
    # defense against prompt injection via spill metadata, town names, etc.).
    safe_spill_type = _sanitize_spill_type(spill_type)
    safe_volume = _sanitize_float(volume_gallons, default=0.0, lo=0.0, hi=1e10)
    safe_temp = _sanitize_float(temperature_c, default=0.0, lo=-50.0, hi=100.0)
    safe_delay = _sanitize_int(response_delay_hours, default=0, lo=0, hi=24 * 365)

    lines: list[str] = []
    lines.append("Incident facts:")
    lines.append(f"- Spill type: {safe_spill_type}")
    lines.append(f"- Volume: {safe_volume:,.0f} gallons")
    lines.append(f"- Water temperature: {safe_temp:.1f} °C")
    lines.append(f"- Response delay: {safe_delay} hours")
    lines.append("")
    lines.append("Affected downstream communities:")
    if affected_towns:
        for t in affected_towns:
            safe_name = _sanitize_text(t.get("name", "Unknown"), max_len=120) or "Unknown"
            safe_pop = _sanitize_int(t.get("population", 0), default=0, lo=0, hi=10**9)
            safe_tick = _sanitize_int(
                t.get("firstThresholdTick", 0), default=0, lo=0, hi=10**7
            )
            safe_risk = _sanitize_risk_level(t.get("peakRiskLevel", "NONE"))
            lines.append(
                f"- {safe_name} "
                f"(pop {safe_pop:,}): "
                f"first crossed threshold at tick {safe_tick}, "
                f"peak risk {safe_risk}"
            )
    else:
        lines.append("- None crossed a risk threshold in this simulation.")

    if mitigation_delta:
        safe_pop_delta = _sanitize_int(
            mitigation_delta.get("populationDelta", 0), default=0, lo=-(10**9), hi=10**9
        )
        safe_cost_avoided = _sanitize_float(
            mitigation_delta.get("costAvoided", 0), default=0.0, lo=-1e12, hi=1e12
        )
        lines.append("")
        lines.append("Mitigation delta vs. no-response baseline:")
        lines.append(f"- Population-at-risk reduced by {safe_pop_delta:,}")
        lines.append(f"- Estimated cleanup cost avoided: ${safe_cost_avoided:,.0f}")

    lines.append("")
    lines.append(
        "Produce the incident report JSON now. Cite 40 CFR Part 300 subparts by section number."
    )
    return "\n".join(lines)
