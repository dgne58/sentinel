"""
Sentinel — manager.py

WebSocket connection manager.
Tracks active connections in a set and broadcasts via asyncio.gather so a
slow or stalled client never blocks delivery to healthy clients.
Dead connections are pruned silently after each gather cycle.

Modeled on the broadcast pattern from qeeqbox/raven simulation.py line 117.
"""

import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)

active_connections: set[WebSocket] = set()


async def connect(ws: WebSocket) -> None:
    await ws.accept()
    active_connections.add(ws)
    logger.info("Client connected. Active: %d", len(active_connections))


def disconnect(ws: WebSocket) -> None:
    active_connections.discard(ws)
    logger.info("Client disconnected. Active: %d", len(active_connections))


async def broadcast(payload: list | dict) -> None:
    """
    Fan-out payload to all connected clients simultaneously.
    Exceptions from individual sends do not propagate — the offending
    connection is added to the dead set and removed after the gather.
    """
    if not active_connections:
        return

    connections = list(active_connections)
    tasks = [ws.send_json(payload) for ws in connections]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    dead: set[WebSocket] = set()
    for ws, result in zip(connections, results):
        if isinstance(result, Exception):
            logger.debug("Send failed for client (%s) — pruning", type(result).__name__)
            dead.add(ws)

    if dead:
        # Use difference_update (in-place) to avoid Python treating -= as a local rebind
        active_connections.difference_update(dead)
        logger.info("Pruned %d dead connection(s). Active: %d", len(dead), len(active_connections))


def connection_count() -> int:
    return len(active_connections)
