"""
Sentinel — geolocation.py

Wraps geoip2.database.Reader for local MaxMind GeoLite2-City lookups.
Per-IP session cache: the same IP is never looked up twice in one run.
Degrades gracefully when GeoLite2-City.mmdb is not yet present (e.g., during
development before the MaxMind download completes).
"""

import logging
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
