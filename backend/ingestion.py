"""
Sentinel — ingestion.py

Async HTTP fetches for Cloudflare Radar, AbuseIPDB, and SANS ISC / DShield.
Each source has an independent TTL cache so rapid poll jitter never
burns API quota.

Data sources:
  Cloudflare Radar — L3/L4 DDoS timeseries spike signal. 1h TTL.
  AbuseIPDB        — Community-reported blacklist (75+ confidence). 24h TTL
                     (free tier is capped at 5 req/day on /blacklist).
  SANS ISC/DShield — Real distributed honeypot network. Top attacking IPs
                     observed across volunteer sensors globally. 1h TTL.
                     No auth, no rate limit. Best source for genuine live data.
"""

import asyncio
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

CLOUDFLARE_TOKEN: str = os.getenv("CLOUDFLARE_TOKEN", "")
ABUSEIPDB_KEY: str    = os.getenv("ABUSEIPDB_KEY", "")

CF_TTL    = 3600   # 1h  — Cloudflare hourly buckets don't change faster
ABUSE_TTL = 86400  # 24h — AbuseIPDB free tier: 5 req/day on /blacklist
ISC_TTL   = 3600   # 1h  — DShield data is updated every few hours; 1h is plenty

_cf_cache:    dict = {"data": None, "expires_at": 0.0}
_abuse_cache: dict = {"data": None, "expires_at": 0.0}
_isc_cache:   dict = {"data": None, "expires_at": 0.0}


# ── Helpers ────────────────────────────────────────────────────────────────────

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


# ── Cloudflare Radar ───────────────────────────────────────────────────────────

async def fetch_cloudflare_spike() -> bool:
    """
    Query Cloudflare Radar L3 and L4 timeseries for the last 24h.
    Returns True if either layer's most recent hourly bucket is >15% above
    its rolling average.  Each layer is evaluated independently.
    """
    now = time.monotonic()
    if _cf_cache["data"] is not None and now < _cf_cache["expires_at"]:
        return _cf_cache["data"]

    if not CLOUDFLARE_TOKEN:
        logger.warning("CLOUDFLARE_TOKEN not set — spike signal defaults to False")
        return False

    headers = {"Authorization": f"Bearer {CLOUDFLARE_TOKEN}"}
    params  = {"dateRange": "1d", "aggInterval": "1h"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r3, r4 = await asyncio.gather(
                client.get(
                    "https://api.cloudflare.com/client/v4/radar/attacks/layer3/timeseries",
                    headers=headers, params=params,
                ),
                client.get(
                    "https://api.cloudflare.com/client/v4/radar/attacks/layer4/timeseries",
                    headers=headers, params=params,
                ),
            )

        spike3, lat3, mean3 = False, 0.0, 0.0
        spike4, lat4, mean4 = False, 0.0, 0.0

        try:
            r3.raise_for_status()
            v3 = r3.json().get("result", {}).get("serie_0", {}).get("values", [])
            spike3, lat3, mean3 = _is_spike(v3)
        except Exception as exc3:
            logger.warning("Cloudflare Radar L3 unavailable: %s", exc3)

        try:
            r4.raise_for_status()
            v4 = r4.json().get("result", {}).get("serie_0", {}).get("values", [])
            spike4, lat4, mean4 = _is_spike(v4)
        except Exception as exc4:
            logger.warning("Cloudflare Radar L4 unavailable: %s", exc4)

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
        return _cf_cache["data"] if _cf_cache["data"] is not None else False


# ── AbuseIPDB ──────────────────────────────────────────────────────────────────

# Server-side category filter — AbuseIPDB filters which IPs are returned but
# does NOT include a `categories` field in the response body.
_ATTACK_CATEGORY_PARAM = "4,6,9,14,15,18,20,22,23"


async def fetch_abuseipdb_ips() -> list[dict]:
    """
    Fetch the top-100 blacklisted IPs from AbuseIPDB (confidence ≥ 75),
    filtered server-side to attack categories via `onlyCategories`.

    Records are normalized to the shared pipeline schema:
      ipAddress, abuseConfidenceScore, totalReports, numDistinctUsers,
      categories, lastReportedAt, source="abuseipdb"
    """
    now = time.monotonic()
    if _abuse_cache["data"] is not None and now < _abuse_cache["expires_at"]:
        return _abuse_cache["data"]

    if not ABUSEIPDB_KEY:
        logger.warning("ABUSEIPDB_KEY not set — skipping AbuseIPDB")
        return []

    headers = {"Key": ABUSEIPDB_KEY, "Accept": "application/json"}
    params  = {"confidenceMinimum": 75, "limit": 100,
               "onlyCategories": _ATTACK_CATEGORY_PARAM}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.abuseipdb.com/api/v2/blacklist",
                headers=headers, params=params,
            )
            resp.raise_for_status()
            records = resp.json().get("data", [])

        # AbuseIPDB /blacklist does NOT return a categories field in the response
        # body even though we filter with onlyCategories — we genuinely don't know
        # which specific category triggered each IP's inclusion.
        # Default to [] (empty) so the frontend renders them as "other" (slate gray)
        # rather than mislabelling every IP as DDoS red.  IPs that also appear in
        # SANS ISC will have accurate categories injected by the merge step in main.py.
        for r in records:
            r.setdefault("categories", [])
            r["source"] = "abuseipdb"

        logger.info("AbuseIPDB: %d records fetched", len(records))
        _abuse_cache["data"] = records
        _abuse_cache["expires_at"] = now + ABUSE_TTL
        return records

    except Exception as exc:
        logger.error("AbuseIPDB fetch failed: %s", exc)
        return _abuse_cache["data"] if _abuse_cache["data"] is not None else []


# ── SANS ISC / DShield ─────────────────────────────────────────────────────────

def _isc_confidence(attacks: int, targets: int) -> int:
    """
    Derive an AbuseIPDB-style confidence score (0–100) from DShield metrics.
    IPs appearing across many targets are strong indicators of active scanning/attack.
    """
    # Targets hit is the strongest signal (similar to numDistinctUsers in AbuseIPDB)
    target_score = min(60, targets * 3)       # up to 60 points for 20+ distinct targets
    attack_score = min(35, attacks // 50)     # up to 35 points for heavy volume
    return min(100, 50 + target_score + attack_score)  # floor at 50 (already filtered)


async def fetch_sans_isc_ips() -> list[dict]:
    """
    Fetch the top 200 attacking IPs from the SANS Internet Storm Center / DShield
    honeypot sensor network.  No auth required.  Data reflects real scanning and
    exploit attempts observed globally across volunteer sensors.

    Records are normalized to the shared pipeline schema so _build_events() in
    main.py needs no changes.

    DShield schema → pipeline schema mapping:
      ip          → ipAddress
      attacks     → totalReports    (number of attack packets/records)
      count       → numDistinctUsers (number of distinct targets hit)
      maxdate     → lastReportedAt
      (derived)   → abuseConfidenceScore via _isc_confidence()
      [14, 18]    → categories  (Port Scan + Brute-Force — best fit for honeypot data)
    """
    now = time.monotonic()
    if _isc_cache["data"] is not None and now < _isc_cache["expires_at"]:
        return _isc_cache["data"]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://isc.sans.edu/api/topips/sources/200/json",
            )
            resp.raise_for_status()
            raw = resp.json()

        entries = raw.get("topips", [])
        records: list[dict] = []

        for entry in entries:
            ip = (entry.get("ip") or entry.get("ipaddr") or "").strip()
            if not ip:
                continue

            attacks = int(entry.get("attacks") or entry.get("count") or 0)
            targets = int(entry.get("count") or entry.get("targets") or 1)
            maxdate = entry.get("maxdate") or entry.get("updated") or ""

            # Convert YYYY-MM-DD → ISO 8601 with time
            last_reported = f"{maxdate}T00:00:00+00:00" if maxdate else ""

            records.append({
                "ipAddress":            ip,
                "abuseConfidenceScore": _isc_confidence(attacks, targets),
                "totalReports":         attacks,
                "numDistinctUsers":     targets,
                "categories":           [14, 18],   # Port Scan + Brute-Force
                "lastReportedAt":       last_reported,
                "source":               "sans_isc",
            })

        logger.info("SANS ISC: %d attacking IPs fetched", len(records))
        _isc_cache["data"] = records
        _isc_cache["expires_at"] = now + ISC_TTL
        return records

    except Exception as exc:
        logger.error("SANS ISC fetch failed: %s", exc)
        return _isc_cache["data"] if _isc_cache["data"] is not None else []


# ── Spike shortcut ─────────────────────────────────────────────────────────────

def last_known_spike() -> bool:
    """Return the most recent cached Cloudflare spike value without a network call."""
    return _cf_cache["data"] if _cf_cache["data"] is not None else False


# ── Cloudflare historical (on-demand, uncached) ────────────────────────────────

async def fetch_cloudflare_historical(endpoint: str, date_range: str) -> dict:
    """
    Fetch a Cloudflare Radar Layer 3 historical endpoint on demand.
    Not cached — called once per /api/history request, not on a poll cycle.

    endpoint:   one of 'timeseries', 'top/locations/origin',
                'top/locations/target', 'summary/protocol',
                'summary/vector', 'summary/bitrate'
    date_range: '24h' or '7d'

    Raises on HTTP or network error — callers use asyncio.gather(return_exceptions=True)
    so individual failures don't abort the full analytics run.
    """
    if not CLOUDFLARE_TOKEN:
        raise ValueError("CLOUDFLARE_TOKEN not set")

    # Map internal range names → Cloudflare-accepted dateRange values.
    # Cloudflare does NOT accept "24h"; it uses "1d" for a 1-day window.
    _CF_RANGE = {"24h": "1d", "12h": "12h", "7d": "7d"}
    _CF_AGG   = {"24h": "1h", "12h": "1h",  "7d": "1h"}
    cf_range = _CF_RANGE.get(date_range, date_range)
    agg      = _CF_AGG.get(date_range, "1h")

    url = f"https://api.cloudflare.com/client/v4/radar/attacks/layer3/{endpoint}"
    params = {"dateRange": cf_range, "aggInterval": agg}

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {CLOUDFLARE_TOKEN}"},
        )
        resp.raise_for_status()
        return resp.json()
