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
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from geolocation import cache_size as geo_cache_size, db_available, resolve_ip
from ingestion import fetch_abuseipdb_ips, fetch_cloudflare_spike
from manager import broadcast, connect, connection_count, disconnect
from scoring import compute_score

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── In-memory state ────────────────────────────────────────────────────────────

event_deque: deque = deque(maxlen=500)

last_poll: dict = {"cloudflare": None, "abuseipdb": None}

_data_source: str = "initializing"  # "live" | "fallback" | "initializing"

current_stats: dict = {
    "threat_level": "LOW",
    "cloudflare_spike": False,
    "attacks_per_min": 0,
    "top_countries": [],
    "total_unique_ips_10min": 0,
}

FALLBACK_PATH = Path(__file__).parent / "fallback_data.json"

# ── Cloudflare PoP destinations ────────────────────────────────────────────────

POPS: list[dict] = [
    {"pop": "SJC", "name": "San Jose, CA",  "lat": 37.3382,   "lng": -121.8863},
    {"pop": "LHR", "name": "London, UK",    "lat": 51.5074,   "lng": -0.1278},
    {"pop": "FRA", "name": "Frankfurt, DE", "lat": 50.1109,   "lng": 8.6821},
    {"pop": "SIN", "name": "Singapore, SG", "lat": 1.3521,    "lng": 103.8198},
    {"pop": "SYD", "name": "Sydney, AU",    "lat": -33.8688,  "lng": 151.2093},
]


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def _nearest_pop(lat: float, lng: float) -> dict:
    return min(POPS, key=lambda p: _haversine(lat, lng, p["lat"], p["lng"]))


def _score_to_color(score: float) -> str:
    if score >= 0.95:
        return "#DC2626"   # deep red
    if score >= 0.80:
        return "#EF4444"   # red
    if score >= 0.65:
        return "#F97316"   # orange
    return "#F59E0B"       # amber


def _compute_threat_level(spike: bool, high_count: int, critical_count: int) -> str:
    if spike and critical_count >= 50:
        return "CRITICAL"
    if spike and high_count >= 30:
        return "HIGH"
    if spike or high_count >= 10:
        return "MODERATE"
    return "LOW"


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

    for record in ip_records:
        ip = record.get("ipAddress", "").strip()
        if not ip:
            continue

        geo = resolve_ip(ip)
        lat, lng = geo["lat"], geo["lng"]

        if lat == 0.0 and lng == 0.0:
            continue  # unresolvable IP — skip to keep globe clean

        score, function_tag = compute_score(
            abuse_confidence=int(record.get("abuseConfidenceScore", 0)),
            total_reports=int(record.get("totalReports", 0)),
            num_distinct_users=int(record.get("numDistinctUsers", 0)),
            has_ddos_category=4 in (record.get("categories") or []),
            last_reported_at=record.get("lastReportedAt"),
            cloudflare_spike=cloudflare_spike,
        )

        if function_tag == "discard":
            continue

        pop = _nearest_pop(lat, lng)
        color = _score_to_color(score)

        event: dict = {
            "function": function_tag,
            "object": {
                "from": f"{lat},{lng}",
                "to": f"{pop['lat']},{pop['lng']}",
            },
            "color": {
                "line": {"from": color, "to": color},
            },
            "timeout": 15000,
            "options": ["line", "multi-output", "single-output"],
            "custom": {
                "from": {
                    "ip": ip,
                    "score": score,
                    "country": geo["country"],
                    "city": geo["city"],
                    "isp": geo["isp"],
                    "reports": record.get("totalReports", 0),
                    "distinct_reporters": record.get("numDistinctUsers", 0),
                    "categories": record.get("categories", []),
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
      1. Fetch Cloudflare spike signal and AbuseIPDB blacklist
      2. Enrich + score IP records into WebSocket events
      3. Store in deque, update stats, broadcast to all clients

    Falls back to fallback_data.json if live fetches return nothing.
    """
    global current_stats, _data_source

    logger.info("Poll cycle starting")

    # Fetch signals — each failure is handled independently
    try:
        cloudflare_spike = await fetch_cloudflare_spike()
        last_poll["cloudflare"] = datetime.now(timezone.utc).isoformat()
    except Exception as exc:
        logger.error("Cloudflare fetch error: %s", exc)
        cloudflare_spike = False

    events: list[dict] = []
    fallback_active = False

    try:
        ip_records = await fetch_abuseipdb_ips()
        last_poll["abuseipdb"] = datetime.now(timezone.utc).isoformat()

        if ip_records:
            events = await _build_events(ip_records, cloudflare_spike)
        else:
            logger.warning("AbuseIPDB returned 0 DDoS records — activating fallback")
            fallback_active = True
    except Exception as exc:
        logger.error("AbuseIPDB pipeline error: %s", exc)
        fallback_active = True

    if fallback_active:
        events = load_fallback_events()

    _data_source = "fallback" if fallback_active else "live"

    # Store in deque
    for ev in events:
        event_deque.append(ev)

    # Compute stats from full deque window
    recent = list(event_deque)
    high_score = [e for e in recent if e["custom"]["from"]["score"] > 0.70]
    critical = [e for e in recent if e["custom"]["from"]["score"] > 0.85]

    country_counts: dict[str, int] = {}
    for e in high_score:
        c = e["custom"]["from"]["country"]
        country_counts[c] = country_counts.get(c, 0) + 1
    top_countries = sorted(country_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    current_stats = {
        "threat_level": _compute_threat_level(cloudflare_spike, len(high_score), len(critical)),
        "cloudflare_spike": cloudflare_spike,
        "attacks_per_min": len(events),
        "top_countries": [{"country": c, "count": n} for c, n in top_countries],
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    }


@app.get("/api/stats")
def api_stats():
    return current_stats


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
