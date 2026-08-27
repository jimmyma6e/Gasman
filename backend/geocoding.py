"""Reverse geocoding — resolves a station's city from its lat/lng via
Nominatim (OpenStreetMap), the same geocoder the frontend already uses
for map search. Deterministic and free, unlike guessing from nearest
centroid or asking an LLM.

Nominatim's usage policy caps public API use at ~1 request/second and
requires a real identifying User-Agent — callers here are responsible for
pacing (see backfill_cities.py and main.py's discovery_job) since this
module makes a single request per call with no built-in throttling.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "GASMAN/1.0 (BC gas price tracker; https://gasman.sportsup.ca)"

# Preference order for which address field best represents "city" in
# Nominatim's response for BC municipalities.
_CITY_FIELDS = ("city", "town", "municipality", "city_district", "suburb")


async def reverse_geocode_city(lat: float, lng: float) -> str | None:
    if lat is None or lng is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 12, "addressdetails": 1},
                headers={"User-Agent": USER_AGENT},
            )
            resp.raise_for_status()
            address = resp.json().get("address") or {}
    except Exception as e:
        logger.warning("reverse_geocode_city(%s, %s) failed: %s", lat, lng, e)
        return None

    for field in _CITY_FIELDS:
        if address.get(field):
            return address[field]
    return None
