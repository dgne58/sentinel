"""
Sentinel — analytics.py

Historical analysis engine for /api/history.
Pure async — no module-level state, no I/O side effects outside of what
the caller provides (Cloudflare responses + SQLite rows).

Four analytical passes:
  1. Rolling baseline z-score spike detection (Cloudflare timeseries)
  2. Cross-source correlation (Cloudflare spike × AbuseIPDB IP surge)
  3. IP persistence scoring across four dimensions
  4. Attack vector shift detection (full window vs. recent 12h)
"""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone

from geolocation import COUNTRY_CENTROIDS
from ingestion import fetch_cloudflare_historical
from storage import query_snapshots

logger = logging.getLogger(__name__)


# ── Entry point ────────────────────────────────────────────────────────────────

async def build_history(date_range: str) -> dict:
    """
    Build the full historical analytics payload for /api/history.
    Fires 8 Cloudflare requests in parallel, queries SQLite, runs 4 passes.
    Returns a dict with 12 top-level keys.
    """
    since_hours = 24 if date_range == "24h" else 168

    # Fire all Cloudflare historical requests in parallel.
    # return_exceptions=True so one failed endpoint doesn't abort the rest.
    cf_results = await asyncio.gather(
        fetch_cloudflare_historical("timeseries",           date_range),
        fetch_cloudflare_historical("timeseries",           "12h"),       # vector shift baseline
        fetch_cloudflare_historical("top/locations/origin", date_range),
        fetch_cloudflare_historical("top/locations/target", date_range),
        fetch_cloudflare_historical("summary/protocol",     date_range),
        fetch_cloudflare_historical("summary/vector",       date_range),
        fetch_cloudflare_historical("summary/vector",       "12h"),       # vector shift recent
        fetch_cloudflare_historical("summary/bitrate",      date_range),
        return_exceptions=True,
    )
    (ts_raw, ts_12h_raw, origins_raw, targets_raw,
     proto_raw, vector_raw, vector_12h_raw, bitrate_raw) = cf_results

    # Log any failures without aborting
    endpoints = ["timeseries", "timeseries/12h", "origins", "targets",
                 "protocol", "vector", "vector/12h", "bitrate"]
    for name, result in zip(endpoints, cf_results):
        if isinstance(result, Exception):
            logger.warning("Cloudflare historical '%s' failed: %s", name, result)

    # SQLite query — may return [] if DB is fresh or empty
    rows = query_snapshots(since_hours)
    logger.info("Historical query: %d snapshot rows for last %dh", len(rows), since_hours)

    # ── Pass 1: Spike detection ──────────────────────────────────────────────
    timeseries = _parse_timeseries(ts_raw)
    anomalies  = detect_spikes(timeseries)

    # ── Pass 2: Cross-source correlation ────────────────────────────────────
    top_origins = _parse_top_locations(origins_raw)
    top_origin_cc = top_origins[0]["country_code"] if top_origins else None
    correlations = (
        find_correlations(anomalies, rows, top_origin_cc)
        if top_origin_cc and rows else []
    )

    # ── Pass 3: IP persistence scoring ──────────────────────────────────────
    total_cycles    = max(1, since_hours * 3600 // 90)
    spike_ts_set    = {a["timestamp"] for a in anomalies}
    persistent_ips  = score_persistence(rows, total_cycles, spike_ts_set) if rows else []

    # ── Pass 4: Vector shift detection ──────────────────────────────────────
    vector_now   = _parse_summary(vector_raw)
    vector_prior = _parse_summary(vector_12h_raw)
    vector_shift = (
        detect_vector_shift(vector_now, vector_prior)
        if vector_now and vector_prior else None
    )

    # ── Insights ─────────────────────────────────────────────────────────────
    insights = _build_insights(anomalies, correlations, vector_shift, persistent_ips)

    return {
        "range":          date_range,
        "timeseries":     timeseries,
        "anomalies":      anomalies,
        "top_origins":    top_origins,
        "top_targets":    _parse_top_locations(targets_raw),
        "protocol":       _parse_summary(proto_raw),
        "vector":         vector_now,
        "bitrate":        _parse_summary(bitrate_raw),
        "persistent_ips": persistent_ips[:20],
        "correlations":   correlations,
        "vector_shift":   vector_shift,
        "insights":       insights,
        "arcs":           _build_historical_arcs(origins_raw, targets_raw),
    }


# ── Analytical passes ──────────────────────────────────────────────────────────

def detect_spikes(timeseries: list[dict], window: int = 6) -> list[dict]:
    """
    Z-score outlier detection on a Cloudflare volume timeseries.
    Any bucket where (value - rolling_mean) / rolling_std > 2.0 is flagged.
    Requires at least `window` prior points to compute a baseline.
    """
    values    = [pt["value"] for pt in timeseries]
    anomalies = []

    for i, pt in enumerate(timeseries):
        if i < window:
            continue
        baseline = values[i - window:i]
        mean     = sum(baseline) / window
        variance = sum((v - mean) ** 2 for v in baseline) / window
        std      = variance ** 0.5

        if std > 0 and (pt["value"] - mean) / std > 2.0:
            anomalies.append({
                "timestamp":        pt["timestamp"],
                "value":            pt["value"],
                "baseline_mean":    round(mean, 4),
                "z_score":          round((pt["value"] - mean) / std, 2),
                "pct_above_baseline": round(((pt["value"] - mean) / mean) * 100, 1),
            })

    return anomalies


def find_correlations(
    anomalies: list[dict],
    rows: list[dict],
    top_origin: str,
) -> list[dict]:
    """
    For each Cloudflare volume spike, check whether AbuseIPDB/SANS IPs
    from the top origin country also surged within ±45 minutes.
    A correlated event is the primary analytical finding — something neither
    source could show alone.
    """
    correlated = []

    for spike in anomalies:
        try:
            spike_ts = datetime.fromisoformat(
                spike["timestamp"].replace("Z", "+00:00")
            )
        except (ValueError, KeyError):
            continue

        window_ips = set(
            r["ip"] for r in rows
            if r.get("country_code") == top_origin
            and _ts_within(r.get("polled_at", ""), spike_ts, seconds=2700)
        )

        if window_ips:
            correlated.append({
                "spike_timestamp":    spike["timestamp"],
                "country":            top_origin,
                "unique_ips_in_window": len(window_ips),
                "cloudflare_z_score": spike["z_score"],
            })

    return correlated


def score_persistence(
    rows: list[dict],
    total_cycles: int,
    spike_timestamps: set[str],
) -> list[dict]:
    """
    Composite persistence score per IP across four dimensions:
      frequency     (0–1): appearances / total_cycles
      consistency   (0–1): 1 - (score_std / score_mean)  — stable high scores rank higher
      spike_cooccur (0–1): fraction of appearances during Cloudflare spike windows
      asn_cluster   (0 or 1): ≥2 IPs share same ISP → coordinated campaign signal

    Weights: frequency 35%, consistency 25%, spike_cooccur 25%, asn_cluster 15%.
    Only IPs appearing ≥3 times are included.
    """
    ip_rows: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        ip_rows[row["ip"]].append(row)

    # ISP → set of IPs for ASN clustering bonus
    isp_ips: dict[str, set[str]] = defaultdict(set)
    for ip, snapshots in ip_rows.items():
        isp = (snapshots[-1].get("isp") or "Unknown").strip()
        if isp and isp != "Unknown":
            isp_ips[isp].add(ip)

    result = []
    for ip, snapshots in ip_rows.items():
        if len(snapshots) < 3:
            continue

        scores = [
            s["abuse_score"] for s in snapshots
            if s.get("abuse_score") is not None
        ]
        mean_score = sum(scores) / len(scores) if scores else 0.0
        std_score  = (
            sum((s - mean_score) ** 2 for s in scores) / len(scores)
        ) ** 0.5 if scores else 0.0

        frequency     = min(1.0, len(snapshots) / total_cycles)
        consistency   = 1.0 - (std_score / mean_score) if mean_score > 0 else 0.0
        consistency   = max(0.0, min(1.0, consistency))

        spike_hits    = sum(1 for s in snapshots if s.get("polled_at") in spike_timestamps)
        spike_cooccur = spike_hits / len(snapshots)

        isp           = (snapshots[-1].get("isp") or "Unknown").strip()
        asn_cluster   = 1.0 if len(isp_ips.get(isp, set())) >= 2 else 0.0

        persistence_score = round(
            0.35 * frequency +
            0.25 * consistency +
            0.25 * spike_cooccur +
            0.15 * asn_cluster,
            4,
        )

        result.append({
            "ip":               ip,
            "appearances":      len(snapshots),
            "country_code":     snapshots[-1].get("country_code"),
            "isp":              isp,
            "avg_score":        round(mean_score, 1),
            "last_seen":        snapshots[-1].get("polled_at"),
            "persistence_score": persistence_score,
            "_breakdown": {
                "frequency":     round(frequency, 3),
                "consistency":   round(consistency, 3),
                "spike_cooccur": round(spike_cooccur, 3),
                "asn_cluster":   asn_cluster,
            },
        })

    result.sort(key=lambda x: x["persistence_score"], reverse=True)
    return result


def detect_vector_shift(
    vector_full: dict,
    vector_recent: dict,
) -> dict | None:
    """
    Compare attack vector mix between the full window and the recent 12h.
    Returns a dict of {vector_type: delta_pct} for any type that shifted
    by more than 10 percentage points. None if no significant shift.
    A shift implies a toolchain or actor change mid-window.
    """
    shifts = {}
    for vtype in vector_full:
        delta = vector_recent.get(vtype, 0.0) - vector_full[vtype]
        if abs(delta) > 10.0:
            shifts[vtype] = round(delta, 1)
    return shifts if shifts else None


# ── Cloudflare response parsers ────────────────────────────────────────────────

def _parse_timeseries(raw) -> list[dict]:
    """
    Normalize Cloudflare layer3/timeseries response.
    Returns [{timestamp, value}, ...] sorted chronologically.
    """
    if isinstance(raw, Exception) or not isinstance(raw, dict):
        return []
    try:
        serie = raw["result"]["serie_0"]
        timestamps = serie.get("timestamps") or []
        values     = serie.get("values")     or []
        return [
            {"timestamp": ts, "value": float(v)}
            for ts, v in zip(timestamps, values)
        ]
    except (KeyError, TypeError, ValueError):
        logger.warning("Failed to parse Cloudflare timeseries: %s", raw)
        return []


def _parse_top_locations(raw) -> list[dict]:
    """
    Normalize Cloudflare top/locations/origin or top/locations/target response.
    Returns [{country_code, country_name, share}, ...] sorted by share descending.
    """
    if isinstance(raw, Exception) or not isinstance(raw, dict):
        return []
    try:
        entries = raw["result"]["top_0"]
        result  = []
        for e in entries:
            cc    = e.get("clientCountryAlpha2") or e.get("originCountryAlpha2") or e.get("targetCountryAlpha2") or ""
            name  = e.get("clientCountryName")  or e.get("originCountryName")  or e.get("targetCountryName")  or cc
            share = float(e.get("value", 0))
            if cc:
                result.append({"country_code": cc, "country_name": name, "share": round(share / 100, 4)})
        return sorted(result, key=lambda x: x["share"], reverse=True)
    except (KeyError, TypeError, ValueError):
        logger.warning("Failed to parse Cloudflare top locations")
        return []


def _parse_summary(raw) -> dict:
    """
    Normalize Cloudflare summary/protocol, summary/vector, or summary/bitrate response.
    Returns {label: float_pct} with human-readable keys.
    """
    if isinstance(raw, Exception) or not isinstance(raw, dict):
        return {}
    try:
        summary = raw["result"]["summary_0"]
        # Rename camelCase Cloudflare keys to readable labels
        _rename = {
            "tcp":       "TCP",
            "udp":       "UDP",
            "icmp":      "ICMP",
            "gre":       "GRE",
            "synFlood":  "SYN Flood",
            "udpFlood":  "UDP Flood",
            "ackFlood":  "ACK Flood",
            "rstFlood":  "RST Flood",
            "greFlood":  "GRE Flood",
            "other":     "Other",
            # bitrate keys from Cloudflare API
            "UNDER_1_GBPS":        "< 1 Gbps",
            "_1_GBPS_TO_10_GBPS":  "1–10 Gbps",
            "_10_GBPS_TO_100_GBPS":"10–100 Gbps",
            "_100_GBPS_TO_1_TBPS": "100 Gbps–1 Tbps",
            "_OVER_1_TBPS":        "> 1 Tbps",
        }
        return {
            _rename.get(k, k): round(float(v), 2)
            for k, v in summary.items()
            if v is not None
        }
    except (KeyError, TypeError, ValueError):
        logger.warning("Failed to parse Cloudflare summary")
        return {}


def _build_historical_arcs(origins_raw, targets_raw) -> list[dict]:
    """
    Cross-reference top origins × top targets to produce weighted arc pairs
    for the historical globe. Arc weight = origin's share of total attack volume.
    Only includes countries present in COUNTRY_CENTROIDS.
    """
    origins = _parse_top_locations(origins_raw)
    targets = _parse_top_locations(targets_raw)

    arcs = []
    for origin in origins[:8]:
        occ    = origin["country_code"]
        ocoord = COUNTRY_CENTROIDS.get(occ)
        if not ocoord:
            continue

        for target in targets[:4]:
            tcc    = target["country_code"]
            tcoord = COUNTRY_CENTROIDS.get(tcc)
            if not tcoord or tcc == occ:
                continue

            arcs.append({
                "origin": {"country_code": occ, "lat": ocoord[0], "lng": ocoord[1]},
                "target": {"country_code": tcc, "lat": tcoord[0], "lng": tcoord[1]},
                "weight": origin["share"],
            })

    return arcs


# ── Insights builder ───────────────────────────────────────────────────────────

def _build_insights(
    anomalies:      list[dict],
    correlations:   list[dict],
    vector_shift:   dict | None,
    persistent_ips: list[dict],
) -> list[str]:
    """
    Produce a short list of plain-English analytical findings for the
    Analyst Notes panel. Each string is one complete observation.
    """
    insights = []

    if anomalies:
        worst = max(anomalies, key=lambda a: a["z_score"])
        insights.append(
            f"Volume spike at {worst['timestamp']}: "
            f"{worst['pct_above_baseline']}% above 6-hour baseline "
            f"(z={worst['z_score']})."
        )

    if correlations:
        insights.append(
            f"Cross-source correlation: {len(correlations)} Cloudflare spike(s) "
            f"coincided with AbuseIPDB IP surges from "
            f"{correlations[0]['country']} within a 90-minute window."
        )

    if vector_shift:
        rising  = [k for k, v in vector_shift.items() if v > 0]
        falling = [k for k, v in vector_shift.items() if v < 0]
        if rising and falling:
            insights.append(
                f"Attack vector shift: {', '.join(rising)} increased while "
                f"{', '.join(falling)} decreased vs. prior window — "
                f"possible actor or toolchain change."
            )

    if persistent_ips:
        top = persistent_ips[0]
        insights.append(
            f"Highest-persistence threat: {top['ip']} "
            f"({top['country_code']}, {top['isp']}) — "
            f"{top['appearances']} appearances, "
            f"persistence score {top['persistence_score']}."
        )

    if not insights:
        insights.append("No significant anomalies detected in the selected window.")

    return insights


# ── Utilities ──────────────────────────────────────────────────────────────────

def _ts_within(ts_str: str, reference: datetime, seconds: int) -> bool:
    """Return True if ts_str parses to a datetime within ±seconds of reference."""
    try:
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return abs((ts - reference).total_seconds()) <= seconds
    except (ValueError, AttributeError):
        return False
