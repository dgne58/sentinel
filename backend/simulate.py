"""
Sentinel — simulate.py

Standalone simulation server. Runs on ws://localhost:8001.
Uses the identical WebSocket schema as the live pipeline — the frontend
cannot tell the difference between this and main.py.

Reads fallback_data.json and replays events with randomized inter-event
delay (0.5–3.0 seconds) so the feed looks organic rather than batch-dumped.
Shuffles the event list on each full pass so patterns aren't repetitive.
A stats envelope is emitted after each full pass, mirroring the live server.

Usage:
    python simulate.py

Set DEMO_MODE=true in main.py's .env to point the frontend at this server
as a last resort if both live APIs are unavailable during a demo.
"""

import asyncio
import json
import logging
import random
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

FALLBACK_PATH = Path(__file__).parent / "fallback_data.json"

active_connections: set[WebSocket] = set()


def _load_events() -> list[dict]:
    if not FALLBACK_PATH.exists():
        logger.error("fallback_data.json not found — simulator has no data to replay")
        return []
    try:
        with open(FALLBACK_PATH) as f:
            return json.load(f)
    except Exception as exc:
        logger.error("Failed to load fallback_data.json: %s", exc)
        return []


def _build_stats(events: list[dict], spike: bool) -> dict:
    """
    Derive a stats envelope from the loaded event list.
    Mirrors the shape of the live server's stats broadcast exactly.
    """
    high = [e for e in events if e["custom"]["from"]["score"] > 0.70]
    critical = [e for e in events if e["custom"]["from"]["score"] > 0.85]

    country_counts: dict[str, int] = {}
    for e in high:
        c = e["custom"]["from"]["country"]
        country_counts[c] = country_counts.get(c, 0) + 1
    top_countries = sorted(country_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    if spike and len(critical) >= 50:
        threat_level = "CRITICAL"
    elif spike and len(high) >= 30:
        threat_level = "HIGH"
    elif spike or len(high) >= 10:
        threat_level = "MODERATE"
    else:
        threat_level = "LOW"

    return {
        "type": "stats",
        "threat_level": threat_level,
        "cloudflare_spike": spike,
        "attacks_per_min": len(events),
        "top_countries": [{"country": c, "count": n} for c, n in top_countries],
        "total_unique_ips_10min": len(events),
    }


async def _fan_out(payload: list | dict) -> None:
    """Send payload to all connected clients; prune dead connections."""
    if not active_connections:
        return
    connections = list(active_connections)
    tasks = [ws.send_json(payload) for ws in connections]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    dead: set[WebSocket] = set()
    for ws, result in zip(connections, results):
        if isinstance(result, Exception):
            dead.add(ws)
    if dead:
        active_connections.difference_update(dead)
        logger.debug("Pruned %d dead simulated connection(s)", len(dead))


async def _simulate_loop() -> None:
    events = _load_events()
    if not events:
        logger.warning("No events — simulation loop idle")
        return

    logger.info("Simulator ready with %d events", len(events))

    while True:
        random.shuffle(events)
        spike = random.random() < 0.35  # simulate occasional Cloudflare spike

        for event in events:
            if not active_connections:
                await asyncio.sleep(1.0)
                continue

            await _fan_out([event])
            await asyncio.sleep(random.uniform(0.5, 3.0))

        # Emit stats after each full pass — mirrors live server's per-cycle stats broadcast
        await _fan_out(_build_stats(events, spike))
        logger.info("Simulator: stats envelope sent (spike=%s)", spike)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_simulate_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Sentinel Simulator", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/attacks")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    active_connections.add(ws)
    logger.info("Simulator client connected. Active: %d", len(active_connections))
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        active_connections.discard(ws)
        logger.info("Simulator client disconnected. Active: %d", len(active_connections))


if __name__ == "__main__":
    uvicorn.run("simulate:app", host="0.0.0.0", port=8001, reload=False)
