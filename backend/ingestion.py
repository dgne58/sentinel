"""
Sentinel — ingestion.py

Async HTTP fetches for Cloudflare Radar and AbuseIPDB.
Each source has an independent TTL cache so rapid poll jitter never
burns extra API quota.

Rate limit math:
  AbuseIPDB  — 90s poll → ~960 req/day vs 1,000/day free limit
  Cloudflare — 60s poll → ~1,440 req/day, well within generous free tier
"""

import asyncio
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

CLOUDFLARE_TOKEN: str = os.getenv("CLOUDFLARE_TOKEN", "")
ABUSEIPDB_KEY: str = os.getenv("ABUSEIPDB_KEY", "")

CF_TTL = 60       # seconds between Cloudflare polls
ABUSE_TTL = 90    # seconds between AbuseIPDB polls

_cf_cache: dict = {"data": None, "expires_at": 0.0}
_abuse_cache: dict = {"data": None, "expires_at": 0.0}


def _is_spike(values: list) -> tuple[bool, float, float]:
    """
    Return (is_spike, latest, mean) for a timeseries values list.
    Spike = most recent bucket is >15% above rolling mean of prior buckets.
    """
    if len(values) < 2:
        return False, 0.0, 0.0
    floats = [float(v) for v in values]
    baseline = floats[:-1]
    mean = sum(baseline) / len(baseline)
    latest = floats[-1]
    return latest > mean * 1.15, latest, mean


async def fetch_cloudflare_spike() -> bool:
    """
    Query Cloudflare Radar layer-3 AND layer-4 timeseries for the last hour.
    Returns True if either layer's most recent 5-min bucket is >15% above
    its rolling average — i.e., a spike is occurring on either protocol layer.

    Falls back to the last cached value on error; returns False if no
    cache exists.
    """
    now = time.monotonic()
    if _cf_cache["data"] is not None and now < _cf_cache["expires_at"]:
        return _cf_cache["data"]

    if not CLOUDFLARE_TOKEN:
        logger.warning("CLOUDFLARE_TOKEN not set — Cloudflare spike signal defaults to False")
        return False

    headers = {"Authorization": f"Bearer {CLOUDFLARE_TOKEN}"}
    params = {"dateRange": "1h", "aggInterval": "5m"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r3, r4 = await asyncio.gather(
                client.get(
                    "https://api.cloudflare.com/client/v4/radar/attacks/layer3/timeseries",
                    headers=headers,
                    params=params,
                ),
                client.get(
                    "https://api.cloudflare.com/client/v4/radar/attacks/layer4/timeseries",
                    headers=headers,
                    params=params,
                ),
            )
            r3.raise_for_status()
            r4.raise_for_status()

        v3 = r3.json().get("result", {}).get("serie_0", {}).get("values", [])
        v4 = r4.json().get("result", {}).get("serie_0", {}).get("values", [])

        spike3, lat3, mean3 = _is_spike(v3)
        spike4, lat4, mean4 = _is_spike(v4)
        result = spike3 or spike4

        logger.info(
            "Cloudflare Radar: L3 spike=%s (%.1f vs %.1f avg) | L4 spike=%s (%.1f vs %.1f avg)",
            spike3, lat3, mean3, spike4, lat4, mean4,
        )

        _cf_cache["data"] = result
        _cf_cache["expires_at"] = now + CF_TTL
        return result

    except Exception as exc:
        logger.error("Cloudflare Radar fetch failed: %s", exc)
        # Return last known value so a transient error doesn't flip the spike signal
        return _cf_cache["data"] if _cf_cache["data"] is not None else False


async def fetch_abuseipdb_ips() -> list[dict]:
    """
    Fetch the top-100 blacklisted IPs from AbuseIPDB with confidenceMinimum=75.
    Filters to DDoS category (4) only — other categories (SSH brute force, spam)
    are noise for Sentinel's use case.

    Returns raw AbuseIPDB record dicts; geolocation and scoring happen downstream.
    """
    now = time.monotonic()
    if _abuse_cache["data"] is not None and now < _abuse_cache["expires_at"]:
        return _abuse_cache["data"]

    if not ABUSEIPDB_KEY:
        logger.warning("ABUSEIPDB_KEY not set — returning empty IP list")
        return []

    headers = {"Key": ABUSEIPDB_KEY, "Accept": "application/json"}
    params = {"confidenceMinimum": 75, "limit": 100}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.abuseipdb.com/api/v2/blacklist",
                headers=headers,
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()

        records = data.get("data", [])

        # AbuseIPDB doesn't support category filtering as a query param;
        # we filter client-side to keep only DDoS (category 4) events.
        ddos_records = [r for r in records if 4 in (r.get("categories") or [])]

        logger.info(
            "AbuseIPDB: %d total records, %d DDoS-category after filter",
            len(records),
            len(ddos_records),
        )

        _abuse_cache["data"] = ddos_records
        _abuse_cache["expires_at"] = now + ABUSE_TTL
        return ddos_records

    except Exception as exc:
        logger.error("AbuseIPDB fetch failed: %s", exc)
        # Return last cached value so a transient error doesn't empty the pipeline
        return _abuse_cache["data"] if _abuse_cache["data"] is not None else []


def last_known_spike() -> bool:
    """Return the most recent cached Cloudflare spike value without a network call."""
    return _cf_cache["data"] if _cf_cache["data"] is not None else False
