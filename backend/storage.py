"""
Sentinel — storage.py

SQLite persistence layer for AbuseIPDB + SANS ISC poll snapshots.
Each poll cycle writes one row per IP to sentinel.db, enabling historical
IP-level analysis without requiring external infrastructure.

Why SQLite: zero dependencies, zero config, one file. Adequate for
a hackathon — ~19 MB/day at 100 IPs × 960 polls.
"""

import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "sentinel.db"


def init_db() -> None:
    """Create sentinel.db and snapshots table if they don't exist."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                polled_at      TEXT    NOT NULL,
                ip             TEXT    NOT NULL,
                abuse_score    INTEGER,
                distinct_users INTEGER,
                categories     TEXT,
                last_reported  TEXT,
                country_code   TEXT,
                isp            TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_polled_at ON snapshots (polled_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ip ON snapshots (ip)")
        conn.commit()


def save_snapshot(records: list[dict]) -> None:
    """
    Persist raw IP records from a live poll cycle to SQLite.

    Accepts records from both AbuseIPDB (ipAddress key) and SANS ISC
    (ipAddress key, same normalisation). Only called on live data —
    fallback cycles must never write to the DB so historical analysis
    is never contaminated with synthetic data.
    """
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    for r in records:
        ip = r.get("ipAddress") or r.get("ip", "")
        if not ip:
            continue
        rows.append((
            ts,
            ip,
            r.get("abuseConfidenceScore"),
            r.get("numDistinctUsers"),
            json.dumps(r.get("categories") or []),
            r.get("lastReportedAt") or r.get("last_reported"),
            r.get("countryCode") or r.get("country_code"),
            r.get("isp"),
        ))

    if not rows:
        return

    with sqlite3.connect(DB_PATH) as conn:
        conn.executemany(
            """INSERT INTO snapshots
               (polled_at, ip, abuse_score, distinct_users, categories,
                last_reported, country_code, isp)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        conn.commit()


def query_snapshots(since_hours: int) -> list[dict]:
    """
    Return all snapshot rows within the last since_hours hours.
    Categories is parsed back from JSON string to list[int].
    """
    cutoff = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() - since_hours * 3600),
    )
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM snapshots WHERE polled_at >= ? ORDER BY polled_at ASC",
            (cutoff,),
        ).fetchall()

    result = []
    for row in rows:
        d = dict(row)
        try:
            d["categories"] = json.loads(d["categories"] or "[]")
        except (json.JSONDecodeError, TypeError):
            d["categories"] = []
        result.append(d)
    return result


def get_snapshot_count() -> int:
    """Total row count in sentinel.db — used by /health for depth check."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            return conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
    except Exception:
        return 0
