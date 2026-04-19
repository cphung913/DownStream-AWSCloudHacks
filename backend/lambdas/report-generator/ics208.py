"""ICS-208 Safety Message PDF generator.

Asks Bedrock to populate the ICS Form 208 fields from simulation data,
then renders a faithful reproduction of the form as a PDF using reportlab.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bedrock prompt
# ---------------------------------------------------------------------------

ICS208_SYSTEM_PROMPT = """You are an Incident Command System (ICS) documentation specialist.
You produce completed ICS Form 208 (Safety Message/Plan) entries for hazmat spill incidents.
Your output must be a single JSON object with exactly these keys — no prose, no code fences:
{
  "incidentName": "string, ≤80 chars",
  "operationalPeriod": "string, e.g. 'Day 1 / 0600–1800'",
  "safetyMessage": "string, ≤600 words — plain English safety narrative covering hazard description, exposure risks, PPE requirements, and evacuation zones",
  "siteHazards": ["string", ...],
  "requiredPPE": ["string", ...],
  "evacuationAssemblyPoint": "string",
  "preparedBy": "string, role title only",
  "reviewedBy": "string, role title only"
}"""


def build_ics208_prompt(
    spill_type: str,
    volume_gallons: float,
    response_delay_hours: int,
    affected_towns: list[dict[str, Any]],
    executive_summary: str,
    mitigation_priority_list: list[str],
    estimated_cleanup_cost: float,
) -> str:
    town_lines = "\n".join(
        f"  - {t.get('name', 'Unknown')} (pop {t.get('population', 0):,},"
        f" peak risk: {t.get('peakRiskLevel', 'NONE').upper()})"
        for t in affected_towns
    ) or "  - None crossed a risk threshold."

    mitigation_lines = "\n".join(f"  {i+1}. {m}" for i, m in enumerate(mitigation_priority_list))

    return f"""Incident facts for ICS 208 completion:
- Spill type: {spill_type}
- Volume: {volume_gallons:,.0f} gallons
- Response delay: {response_delay_hours} hours before containment
- Estimated cleanup cost: ${estimated_cleanup_cost:,.0f}

Affected downstream communities:
{town_lines}

Incident summary (from EPA coordinator briefing):
{executive_summary[:800]}

Mitigation priorities:
{mitigation_lines}

Complete the ICS Form 208 JSON now."""


# ---------------------------------------------------------------------------
# PDF renderer
# ---------------------------------------------------------------------------

_FEMA_BLUE = colors.HexColor("#003366")
_LIGHT_GRAY = colors.HexColor("#f0f0f0")
_MID_GRAY = colors.HexColor("#cccccc")

_styles = getSampleStyleSheet()
_body = ParagraphStyle(
    "ics_body",
    parent=_styles["Normal"],
    fontSize=9,
    leading=13,
    spaceAfter=4,
)
_label = ParagraphStyle(
    "ics_label",
    parent=_styles["Normal"],
    fontSize=7.5,
    leading=10,
    textColor=colors.HexColor("#555555"),
    spaceAfter=1,
)
_heading = ParagraphStyle(
    "ics_heading",
    parent=_styles["Normal"],
    fontSize=10,
    leading=13,
    fontName="Helvetica-Bold",
    textColor=_FEMA_BLUE,
    spaceAfter=4,
)
_title = ParagraphStyle(
    "ics_title",
    parent=_styles["Normal"],
    fontSize=14,
    leading=18,
    fontName="Helvetica-Bold",
    textColor=_FEMA_BLUE,
    alignment=1,  # center
)
_subtitle = ParagraphStyle(
    "ics_subtitle",
    parent=_styles["Normal"],
    fontSize=9,
    leading=12,
    alignment=1,
    textColor=colors.HexColor("#555555"),
)


def _field_block(label: str, value: str, width: float) -> Table:
    """Single labeled field cell."""
    tbl = Table(
        [[Paragraph(label, _label)], [Paragraph(value or "—", _body)]],
        colWidths=[width],
    )
    tbl.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, _MID_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), _LIGHT_GRAY),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return tbl


def _bullet_block(label: str, items: list[str], width: float) -> Table:
    bullet_text = "<br/>".join(f"• {item}" for item in items) if items else "—"
    tbl = Table(
        [[Paragraph(label, _label)], [Paragraph(bullet_text, _body)]],
        colWidths=[width],
    )
    tbl.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, _MID_GRAY),
                ("BACKGROUND", (0, 0), (-1, 0), _LIGHT_GRAY),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return tbl


def render_ics208_pdf(fields: dict[str, Any], simulation_id: str) -> bytes:
    """Render a completed ICS Form 208 as PDF bytes."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    W = letter[0] - 1.5 * inch  # usable width
    half = W / 2 - 3
    third = W / 3 - 2

    story = []

    # ---- Header ----
    story.append(Paragraph("ICS 208", _title))
    story.append(Paragraph("Safety Message / Plan", _subtitle))
    story.append(Spacer(1, 6))

    # FEMA form number line
    header_tbl = Table(
        [[Paragraph("FEMA ICS Form 208 (08/07)", _label), Paragraph("DownStream Watershed Simulator — AI-Assisted Incident Documentation", _label)]],
        colWidths=[W * 0.4, W * 0.6],
    )
    header_tbl.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, _MID_GRAY),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(header_tbl)
    story.append(Spacer(1, 8))

    # ---- Section 1: Incident / Period ----
    story.append(Paragraph("1. Incident Identification", _heading))
    row1 = Table(
        [[_field_block("Incident Name", fields.get("incidentName", ""), half),
          _field_block("Operational Period", fields.get("operationalPeriod", ""), half)]],
        colWidths=[half, half],
        hAlign="LEFT",
    )
    row1.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    story.append(row1)
    story.append(Spacer(1, 8))

    # ---- Section 2: Safety Message ----
    story.append(Paragraph("2. Safety Message / Hazard Summary", _heading))
    story.append(_field_block("Safety Message", fields.get("safetyMessage", ""), W))
    story.append(Spacer(1, 8))

    # ---- Section 3: Site Hazards & PPE ----
    story.append(Paragraph("3. Site Hazards and Required PPE", _heading))
    row3 = Table(
        [[_bullet_block("Site Hazards", fields.get("siteHazards", []), half),
          _bullet_block("Required PPE", fields.get("requiredPPE", []), half)]],
        colWidths=[half, half],
        hAlign="LEFT",
    )
    row3.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    story.append(row3)
    story.append(Spacer(1, 8))

    # ---- Section 4: Evacuation ----
    story.append(Paragraph("4. Evacuation Assembly Point", _heading))
    story.append(_field_block("Assembly Point / Muster Location", fields.get("evacuationAssemblyPoint", ""), W))
    story.append(Spacer(1, 8))

    # ---- Section 5: Signatures ----
    story.append(Paragraph("5. Prepared / Reviewed By", _heading))
    row5 = Table(
        [[_field_block("Prepared By (Role)", fields.get("preparedBy", ""), third),
          _field_block("Reviewed By (Role)", fields.get("reviewedBy", ""), third),
          _field_block("Date/Time Prepared", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%MZ"), third)]],
        colWidths=[third, third, third],
        hAlign="LEFT",
    )
    row5.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    story.append(row5)
    story.append(Spacer(1, 12))

    # ---- Footer ----
    footer_tbl = Table(
        [[Paragraph(f"Simulation ID: {simulation_id}", _label),
          Paragraph("Generated by DownStream AI — for exercise/planning use only", _label)]],
        colWidths=[W * 0.5, W * 0.5],
    )
    footer_tbl.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, -1), 0.5, _MID_GRAY),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))
    story.append(footer_tbl)

    doc.build(story)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Orchestrator called from handler.py
# ---------------------------------------------------------------------------

def generate_and_upload_ics208(
    bedrock_client: Any,
    s3_client: Any,
    model_id: str,
    simulations_bucket: str,
    simulation_id: str,
    spill_type: str,
    volume_gallons: float,
    response_delay_hours: int,
    affected_towns: list[dict[str, Any]],
    report: dict[str, Any],
) -> str | None:
    """Call Bedrock for ICS-208 fields, render PDF, upload to S3.

    Returns the S3 key on success, None on failure.
    """
    prompt = build_ics208_prompt(
        spill_type=spill_type,
        volume_gallons=volume_gallons,
        response_delay_hours=response_delay_hours,
        affected_towns=affected_towns,
        executive_summary=report.get("executiveSummary", ""),
        mitigation_priority_list=report.get("mitigationPriorityList", []),
        estimated_cleanup_cost=float(report.get("estimatedCleanupCost", 0)),
    )

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "system": ICS208_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }

    try:
        resp = bedrock_client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body).encode("utf-8"),
        )
    except Exception:
        logger.exception("Bedrock ICS-208 call failed")
        return None

    payload = json.loads(resp["body"].read())
    raw = "".join(
        b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"
    ).strip()

    # Strip code fences if present
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        fields = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("ICS-208 Bedrock response was not valid JSON: %s", raw[:300])
        return None

    try:
        pdf_bytes = render_ics208_pdf(fields, simulation_id)
    except Exception:
        logger.exception("ICS-208 PDF render failed")
        return None

    key = f"{simulation_id}/ics208.pdf"
    try:
        s3_client.put_object(
            Bucket=simulations_bucket,
            Key=key,
            Body=pdf_bytes,
            ContentType="application/pdf",
            ContentDisposition=f'attachment; filename="ICS208-{simulation_id[:8]}.pdf"',
        )
    except Exception:
        logger.exception("ICS-208 S3 upload failed")
        return None

    logger.info("ICS-208 PDF uploaded to s3://%s/%s (%d bytes)", simulations_bucket, key, len(pdf_bytes))
    return key
