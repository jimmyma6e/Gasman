"""Reverse geocoding — resolves a station's city from its lat/lng via
Nominatim (OpenStreetMap), the same geocoder the frontend already uses
for map search. Deterministic and free, unlike guessing from nearest
centroid or asking an LLM.

Nominatim's usage policy caps public API use at ~1 request/second and
requires a real identifying User-Agent — callers here are responsible for
pacing between calls (see backfill_cities.py and main.py's discovery_job).
This module additionally retries on 429 with backoff, since in practice
the public instance rate-limits well below the 1 req/sec written policy.
"""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "GASMAN/1.0 (BC gas price tracker; https://gasman.sportsup.ca)"

# Preference order for which address field best represents "city" in
# Nominatim's response for BC municipalities.
_CITY_FIELDS = ("city", "town", "municipality", "city_district", "suburb")

MAX_RETRIES = 4
DEFAULT_RETRY_AFTER_S = 5.0


async def reverse_geocode_city(lat: float, lng: float) -> str | None:
    if lat is None or lng is None:
        return None

    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = await client.get(
                    NOMINATIM_URL,
                    params={"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 12, "addressdetails": 1},
                    headers={"User-Agent": USER_AGENT},
                )
            except Exception as e:
                logger.warning("reverse_geocode_city(%s, %s) request error: %s", lat, lng, e)
                return None

            if resp.status_code == 429:
                if attempt == MAX_RETRIES:
                    logger.warning("reverse_geocode_city(%s, %s) still rate-limited after %d retries — giving up",
                                    lat, lng, MAX_RETRIES)
                    return None
                retry_after = float(resp.headers.get("Retry-After", DEFAULT_RETRY_AFTER_S))
                logger.info("reverse_geocode_city(%s, %s) rate-limited — retrying in %.1fs (attempt %d/%d)",
                            lat, lng, retry_after, attempt + 1, MAX_RETRIES)
                await asyncio.sleep(retry_after)
                continue

            try:
                resp.raise_for_status()
                address = resp.json().get("address") or {}
            except Exception as e:
                logger.warning("reverse_geocode_city(%s, %s) failed: %s", lat, lng, e)
                return None
            break

    for field in _CITY_FIELDS:
        if address.get(field):
            return address[field]
    return None
