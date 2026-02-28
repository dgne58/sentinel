"""
Sentinel — scoring.py

Six-signal composite threat scoring function.
Pure function — no I/O, no side effects. Unit-testable in isolation.
Called once per IP at ingest time; result stored in the event deque.
Never called at broadcast time.
"""

from datetime import datetime, timezone, timedelta


def compute_score(
    abuse_confidence: int,
    total_reports: int,
    num_distinct_users: int,
    has_ddos_category: bool,
    last_reported_at: str | None,
    cloudflare_spike: bool,
) -> tuple[float, str]:
    """
    Returns (score: float 0.0–1.0, function_tag: str).

    function_tag values:
        "table"   — score > 0.70 — globe arc + live feed + sidebar-eligible
        "marker"  — score 0.50–0.70 — globe arc only
        "discard" — score < 0.50 — dropped, never sent to frontend
    """
    base = abuse_confidence / 100.0

    # Reporter diversity boost: up to +15% for 50+ distinct reporters
    report_boost = min(0.15, (num_distinct_users / 50) * 0.15)

    # Recency multiplier: penalise IPs not reported in the last 24 hours
    recency_mult = 1.0
    if last_reported_at:
        try:
            last_reported = datetime.fromisoformat(
                last_reported_at.replace("Z", "+00:00")
            )
            age = datetime.now(timezone.utc) - last_reported
            recency_mult = 1.0 if age <= timedelta(hours=24) else 0.75
        except (ValueError, TypeError):
            recency_mult = 0.75
    else:
        recency_mult = 0.75

    # DDoS category multiplier: +20% for explicitly tagged DDoS IPs
    ddos_mult = 1.20 if has_ddos_category else 1.0

    # Cloudflare correlation bonus: +10% when global attack volume is spiking
    spike_boost = 0.10 if cloudflare_spike else 0.0

    score = min(1.0, (base + report_boost + spike_boost) * recency_mult * ddos_mult)
    score = round(score, 4)

    if score > 0.70:
        function_tag = "table"
    elif score >= 0.50:
        function_tag = "marker"
    else:
        function_tag = "discard"

    return score, function_tag
