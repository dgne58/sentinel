"""
Sentinel — main.py

FastAPI application entrypoint.
Startup: launches two asyncio background tasks (Cloudflare poll, AbuseIPDB poll).
Routes: /health, /api/stats, /api/feed snapshot endpoints + WS /ws/attacks stream.

Data flow:
  Ingestion → Geo resolution → Scoring → deque → Broadcast
  Everything is annotated at ingest time; the broadcaster does zero computation.
"""

import asyncio
import json
import logging
import os
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from analytics import build_history
from geolocation import cache_size as geo_cache_size, db_available, nearest_pop, resolve_ip
from ingestion import fetch_abuseipdb_ips, fetch_cloudflare_spike, fetch_isp_batch, fetch_sans_isc_ips
from manager import broadcast, connect, connection_count, disconnect
from scoring import (
    BOTNET_CATS,
    DDOS_CATS,
    arc_color,
    compute_score,
    compute_threat_level,
    compute_top_countries,
    primary_attack_type,
)
from storage import get_snapshot_count, init_db, save_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── In-memory state ────────────────────────────────────────────────────────────

event_deque: deque = deque(maxlen=500)

last_poll: dict = {"cloudflare": None, "abuseipdb": None, "sans_isc": None}

_data_source: str = "initializing"  # "live" | "fallback" | "initializing"

current_stats: dict = {
    "threat_level": "LOW",
    "cloudflare_spike": False,
    "attacks_per_min": 0,
    "top_countries": [],
    "total_unique_ips_10min": 0,
}

FALLBACK_PATH = Path(__file__).parent / "fallback_data.json"


# ── Fallback data ──────────────────────────────────────────────────────────────

def load_fallback_events() -> list[dict]:
    """Load pre-processed WebSocket events from fallback_data.json."""
    if not FALLBACK_PATH.exists():
        logger.warning("fallback_data.json not found — no fallback events available")
        return []
    try:
        with open(FALLBACK_PATH) as f:
            return json.load(f)
    except Exception as exc:
        logger.error("Failed to load fallback_data.json: %s", exc)
        return []


# ── Pipeline ───────────────────────────────────────────────────────────────────

async def _build_events(ip_records: list[dict], cloudflare_spike: bool) -> list[dict]:
    """
    Enrich raw AbuseIPDB records into fully annotated WebSocket events.
    Geo resolution and scoring happen here — once per IP.
    IPs that cannot be placed on the globe (lat/lng both 0) are dropped.
    """
    events: list[dict] = []

    # Pre-fetch ISP data for all IPs in one batch (ip-api.com free tier).
    # GeoLite2-City doesn't carry ISP/ASN — this fills the gap.
    all_ips = [r.get("ipAddress", "").strip() for r in ip_records if r.get("ipAddress")]
    isp_map = await fetch_isp_batch(all_ips)

    for record in ip_records:
        ip = record.get("ipAddress", "").strip()
        if not ip:
            continue

        geo = resolve_ip(ip)
        lat, lng = geo["lat"], geo["lng"]

        if lat == 0.0 and lng == 0.0:
            continue  # unresolvable IP — skip to keep globe clean

        categories = record.get("categories") or []
        attack_type = primary_attack_type(categories)

        score, function_tag = compute_score(
            abuse_confidence=int(record.get("abuseConfidenceScore", 0)),
            total_reports=int(record.get("totalReports", 0)),
            num_distinct_users=int(record.get("numDistinctUsers", 0)),
            has_ddos_category=bool(set(categories) & DDOS_CATS),
            has_botnet_category=bool(set(categories) & BOTNET_CATS),
            last_reported_at=record.get("lastReportedAt"),
            cloudflare_spike=cloudflare_spike,
        )

        if function_tag == "discard":
            continue

        pop = nearest_pop(lat, lng)
        color = arc_color(categories)

        event: dict = {
            "function": function_tag,
            "object": {
                "from": f"{lat},{lng}",
                "to": f"{pop['lat']},{pop['lng']}",
            },
            "color": {
                "line": {"from": color, "to": color},
            },
            "timeout": 100000,
            "options": ["line", "multi-output", "single-output"],
            "custom": {
                "from": {
                    "ip": ip,
                    "score": score,
                    "attack_type": attack_type,
                    "source": record.get("source", "abuseipdb"),
                    "country": geo["country"],
                    "country_code": geo.get("country_code", "XX"),
                    "city": geo["city"],
                    "isp": geo["isp"] if geo["isp"] != "Unknown" else isp_map.get(ip, "Unknown"),
                    "reports": record.get("totalReports", 0),
                    "distinct_reporters": record.get("numDistinctUsers", 0),
                    "categories": categories,
                    "last_reported": record.get("lastReportedAt", ""),
                },
                "to": {
                    "pop": pop["pop"],
                    "name": pop["name"],
                },
            },
        }
        events.append(event)

    return events


async def poll_and_broadcast() -> None:
    """
    One full pipeline cycle:
      1. Fetch Cloudflare spike signal
      2. Fetch AbuseIPDB + SANS ISC IP records in parallel
      3. Merge, deduplicate by IP, enrich + score into WebSocket events
      4. Store in deque, update stats, broadcast to all clients

    Falls back to fallback_data.json only if both live sources return nothing.
    """
    global current_stats, _data_source

    logger.info("Poll cycle starting")

    # Cloudflare spike — independent failure handling
    try:
        cloudflare_spike = await fetch_cloudflare_spike()
        last_poll["cloudflare"] = datetime.now(timezone.utc).isoformat()
    except Exception as exc:
        logger.error("Cloudflare fetch error: %s", exc)
        cloudflare_spike = False

    # Fetch both IP sources concurrently
    events: list[dict] = []
    fallback_active = False

    try:
        abuse_records, isc_records = await asyncio.gather(
            fetch_abuseipdb_ips(),
            fetch_sans_isc_ips(),
        )
        last_poll["abuseipdb"] = datetime.now(timezone.utc).isoformat()
        last_poll["sans_isc"]  = datetime.now(timezone.utc).isoformat()

        # Build ISC category lookup first so we can enrich overlapping AbuseIPDB records.
        # AbuseIPDB /blacklist does NOT return categories (we default to [] = "other"),
        # but SANS ISC provides *actual* observed categories [14, 18] for each IP.
        # For IPs appearing in both sources, use ISC's categories — they are more
        # accurate than leaving the AbuseIPDB record with an empty category list.
        isc_cat_map: dict[str, list[int]] = {
            r["ipAddress"]: r.get("categories", [])
            for r in isc_records
            if r.get("ipAddress")
        }

        seen: set[str] = set()
        merged: list[dict] = []
        isc_enriched = 0
        for r in abuse_records:
            ip = r.get("ipAddress", "")
            if ip and ip not in seen:
                seen.add(ip)
                rec = dict(r)
                if ip in isc_cat_map:
                    # Override the [4] placeholder with ISC's observed attack categories
                    rec["categories"] = isc_cat_map[ip]
                    isc_enriched += 1
                merged.append(rec)
        for r in isc_records:
            ip = r.get("ipAddress", "")
            if ip and ip not in seen:
                seen.add(ip)
                merged.append(r)

        logger.info(
            "Merged IP pool: %d AbuseIPDB + %d SANS ISC = %d unique (%d AbuseIPDB enriched with ISC categories)",
            len(abuse_records), len(isc_records), len(merged), isc_enriched,
        )

        if merged:
            events = await _build_events(merged, cloudflare_spike)
            # Persist raw records for historical analysis — fire-and-forget
            asyncio.create_task(asyncio.to_thread(save_snapshot, merged))
        else:
            logger.warning("Both live sources returned 0 records — activating fallback")
            fallback_active = True

    except Exception as exc:
        logger.error("IP fetch pipeline error: %s", exc)
        fallback_active = True

    if fallback_active:
        events = load_fallback_events()

    _data_source = "fallback" if fallback_active else "live"

    # Store in deque
    for ev in events:
        event_deque.append(ev)

    # Compute stats from full deque window
    recent = list(event_deque)

    current_stats = {
        "threat_level": compute_threat_level(recent, cloudflare_spike),
        "cloudflare_spike": cloudflare_spike,
        "attacks_per_min": len(events),
        "top_countries": compute_top_countries(recent),
        "total_unique_ips_10min": len(recent),
    }

    # Broadcast events batch (if any), then always broadcast stats
    if events:
        await broadcast(events)
        logger.info(
            "Broadcast %d events (%s) to %d client(s) | threat=%s",
            len(events),
            "fallback" if fallback_active else "live",
            connection_count(),
            current_stats["threat_level"],
        )

    await broadcast({"type": "stats", **current_stats})


async def _background_poller() -> None:
    """Fire-and-forget loop — polls every 90 seconds (AbuseIPDB TTL)."""
    while True:
        try:
            await poll_and_broadcast()
        except Exception as exc:
            logger.error("Unhandled error in poll cycle: %s", exc)
        await asyncio.sleep(90)


# ── App lifecycle ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Sentinel starting — GeoLite2 DB available: %s", db_available())
    task = asyncio.create_task(_background_poller())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("Sentinel shutdown")


app = FastAPI(title="Sentinel", version="2.0", lifespan=lifespan)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
_allowed_origins = [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST routes ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "connected_clients": connection_count(),
        "geo_cache_size": geo_cache_size(),
        "geo_db_available": db_available(),
        "last_poll": last_poll,
        "event_deque_size": len(event_deque),
        "data_source": _data_source,
        "db_snapshot_count": get_snapshot_count(),
    }


@app.get("/api/stats")
def api_stats():
    return current_stats


@app.get("/api/history")
async def api_history(range: str = "24h"):
    if range not in ("24h", "7d"):
        raise HTTPException(status_code=400, detail="range must be '24h' or '7d'")
    return await build_history(range)


@app.get("/api/feed")
def api_feed():
    table_events = [e for e in event_deque if e["function"] == "table"]
    return list(reversed(table_events))[:50]


# ── WebSocket route ────────────────────────────────────────────────────────────

@app.websocket("/ws/attacks")
async def websocket_endpoint(ws: WebSocket):
    await connect(ws)
    try:
        # Immediately send current state so the client isn't blank on connect
        table_events = [e for e in event_deque if e["function"] == "table"]
        if table_events:
            await ws.send_json(list(reversed(table_events))[:50])
        await ws.send_json({"type": "stats", **current_stats})

        # Keep alive — broadcast loop pushes all subsequent data
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        disconnect(ws)


# ── Entrypoint ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
