"""
Sentinel — geolocation.py

Wraps geoip2.database.Reader for local MaxMind GeoLite2-City lookups.
Per-IP session cache: the same IP is never looked up twice in one run.
Degrades gracefully when GeoLite2-City.mmdb is not yet present (e.g., during
development before the MaxMind download completes).
"""

import logging
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent / "GeoLite2-City.mmdb"

_reader = None          # geoip2.database.Reader, opened lazily
_geo_cache: dict[str, dict] = {}


def _get_reader():
    global _reader
    if _reader is not None:
        return _reader
    if not DB_PATH.exists():
        logger.warning(
            "GeoLite2-City.mmdb not found at %s - geo resolution unavailable. "
            "Download from maxmind.com and place in /backend.",
            DB_PATH,
        )
        return None
    try:
        import geoip2.database
        _reader = geoip2.database.Reader(str(DB_PATH))
        logger.info("GeoLite2 database opened: %s", DB_PATH)
        return _reader
    except Exception as exc:
        logger.error("Failed to open GeoLite2 database: %s", exc)
        return None


def resolve_ip(ip: str) -> dict:
    """
    Resolve an IP address to geographic metadata.
    Returns cached result if the IP was already resolved this session.
    Falls back to zeroed placeholder if the database is unavailable.
    """
    if ip in _geo_cache:
        return _geo_cache[ip]

    reader = _get_reader()
    if reader is None:
        result = _placeholder()
        _geo_cache[ip] = result
        return result

    try:
        import geoip2.errors
        response = reader.city(ip)
        result = {
            "lat": float(response.location.latitude or 0.0),
            "lng": float(response.location.longitude or 0.0),
            "city": response.city.name or "Unknown",
            "country": response.country.name or "Unknown",
            "country_code": response.country.iso_code or "XX",
            "isp": (
                response.traits.autonomous_system_organization
                or response.traits.isp
                or "Unknown"
            ),
            "geo_available": True,
        }
    except Exception as exc:
        # AddressNotFoundError is the common case for private/invalid IPs
        logger.debug("Geo lookup failed for %s: %s", ip, exc)
        result = _placeholder()

    _geo_cache[ip] = result
    return result


def cache_size() -> int:
    return len(_geo_cache)


def db_available() -> bool:
    return _get_reader() is not None


def _placeholder() -> dict:
    return {
        "lat": 0.0,
        "lng": 0.0,
        "city": "Unknown",
        "country": "Unknown",
        "country_code": "XX",
        "isp": "Unknown",
        "geo_available": False,
    }


# ── Cloudflare PoP destinations ────────────────────────────────────────────────

POPS: list[dict] = [
    {"pop": "SJC", "name": "San Jose, CA",  "lat": 37.3382,  "lng": -121.8863},
    {"pop": "LHR", "name": "London, UK",    "lat": 51.5074,  "lng": -0.1278},
    {"pop": "FRA", "name": "Frankfurt, DE", "lat": 50.1109,  "lng": 8.6821},
    {"pop": "SIN", "name": "Singapore, SG", "lat": 1.3521,   "lng": 103.8198},
    {"pop": "SYD", "name": "Sydney, AU",    "lat": -33.8688, "lng": 151.2093},
]


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def nearest_pop(lat: float, lng: float) -> dict:
    """Return the geographically nearest Cloudflare PoP to the given coordinates."""
    return min(POPS, key=lambda p: _haversine(lat, lng, p["lat"], p["lng"]))


# ── Country centroids ───────────────────────────────────────────────────────────
# ISO 3166-1 alpha-2 → (lat, lng) geographic centroid.
# Used by analytics.py to place country-level arcs on the historical globe.
# Covers the top ~40 most common DDoS attack origins and targets.

COUNTRY_CENTROIDS: dict[str, tuple[float, float]] = {
    "CN": (35.8617,  104.1954),
    "US": (37.0902,  -95.7129),
    "RU": (61.5240,  105.3188),
    "BR": (-14.2350, -51.9253),
    "IN": (20.5937,   78.9629),
    "DE": (51.1657,   10.4515),
    "FR": (46.2276,    2.2137),
    "GB": (55.3781,   -3.4360),
    "KR": (35.9078,  127.7669),
    "NL": (52.1326,    5.2913),
    "JP": (36.2048,  138.2529),
    "UA": (48.3794,   31.1656),
    "VN": (14.0583,  108.2772),
    "ID": (-0.7893,  113.9213),
    "TR": (38.9637,   35.2433),
    "TW": (23.6978,  120.9605),
    "AR": (-38.4161, -63.6167),
    "MX": (23.6345, -102.5528),
    "ZA": (-30.5595,  22.9375),
    "PK": (30.3753,   69.3451),
    "BD": (23.6850,   90.3563),
    "IT": (41.8719,   12.5674),
    "ES": (40.4637,   -3.7492),
    "PL": (51.9194,   19.1451),
    "RO": (45.9432,   24.9668),
    "IR": (32.4279,   53.6880),
    "TH": (15.8700,  100.9925),
    "EG": (26.8206,   30.8025),
    "HK": (22.3193,  114.1694),
    "SG": ( 1.3521,  103.8198),
    "CA": (56.1304,  -106.347),
    "AU": (-25.2744,  133.775),
    "NG": ( 9.0820,    8.6753),
    "MY": ( 4.2105,  101.9758),
    "PH": (12.8797,  121.7740),
    "CZ": (49.8175,   15.4730),
    "HU": (47.1625,   19.5033),
    "BG": (42.7339,   25.4858),
    "SK": (48.6690,   19.6990),
    "AT": (47.5162,   14.5501),
}
