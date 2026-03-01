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
    has_botnet_category: bool,
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

    # DDoS category multiplier: +20% for volumetric attack IPs (cats 4, 6)
    ddos_mult = 1.20 if has_ddos_category else 1.0

    # Botnet multiplier: +8% for exploited/C2 hosts (cats 20, 23)
    botnet_mult = 1.08 if has_botnet_category else 1.0

    # Cloudflare correlation bonus: +10% when global attack volume is spiking
    spike_boost = 0.10 if cloudflare_spike else 0.0

    score = min(1.0, (base + report_boost + spike_boost) * recency_mult * ddos_mult * botnet_mult)
    score = round(score, 4)

    if score > 0.70:
        function_tag = "table"
    elif score >= 0.50:
        function_tag = "marker"
    else:
        function_tag = "discard"

    return score, function_tag


# ── Attack-type classification ──────────────────────────────────────────────────

DDOS_CATS      = frozenset({4, 6})         # DDoS / Distributed DDoS
BOTNET_CATS    = frozenset({20, 23})       # Botnet C2 / IoT Botnet
INTRUSION_CATS = frozenset({15, 18, 22})  # Hacking / Brute-Force / SSH
RECON_CATS     = frozenset({14})           # Port Scan
PROXY_CATS     = frozenset({9})            # Open Proxy

_TYPE_COLORS: dict[str, str] = {
    "ddos":      "#EF4444",   # red
    "botnet":    "#F97316",   # orange
    "intrusion": "#A855F7",   # purple
    "recon":     "#F59E0B",   # amber
    "proxy":     "#06B6D4",   # cyan
    "other":     "#64748B",   # slate
}


def primary_attack_type(categories: list[int]) -> str:
    """Return the highest-priority attack type label for a category list."""
    cats = set(categories)
    if cats & DDOS_CATS:       return "ddos"
    if cats & BOTNET_CATS:     return "botnet"
    if cats & INTRUSION_CATS:  return "intrusion"
    if cats & RECON_CATS:      return "recon"
    if cats & PROXY_CATS:      return "proxy"
    return "other"


def arc_color(categories: list[int]) -> str:
    """Return the hex color for an arc based on attack type."""
    return _TYPE_COLORS[primary_attack_type(categories)]


def compute_threat_level(events: list[dict], cloudflare_spike: bool) -> str:
    """Four-tier global threat level from the current event window."""
    high_count     = sum(1 for e in events if e["custom"]["from"]["score"] > 0.70)
    critical_count = sum(1 for e in events if e["custom"]["from"]["score"] > 0.85)
    if cloudflare_spike and critical_count >= 50:
        return "CRITICAL"
    if cloudflare_spike and high_count >= 30:
        return "HIGH"
    if cloudflare_spike or high_count >= 10:
        return "MODERATE"
    return "LOW"


def compute_top_countries(events: list[dict], limit: int = 3) -> list[dict]:
    """Top N countries by count from high-confidence events (score > 0.70)."""
    counts: dict[str, int] = {}
    for e in events:
        if e["custom"]["from"]["score"] > 0.70:
            c = e["custom"]["from"]["country"]
            counts[c] = counts.get(c, 0) + 1
    top = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:limit]
    return [{"country": c, "count": cnt} for c, cnt in top]
