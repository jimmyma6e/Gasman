"""GASMAN Public API (v1) — API-key-authenticated, rate-limited, versioned.

Mounted as an isolated FastAPI sub-app at /api/v1 so it gets its own
OpenAPI schema and Swagger docs (/api/v1/docs) separate from the internal
routes the frontend uses. Mint keys with backend/manage_api_keys.py.
"""

import hashlib
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import database
import gasbuddy_client as gb

RATE_LIMIT_REQUESTS = 60     # requests
RATE_LIMIT_WINDOW_S = 60.0   # per this many seconds, per key

# Force-refresh launches a real headless browser session per call, much
# heavier than every other endpoint here — cooldown to avoid hammering
# GasBuddy (and our own server) if a client retries rapidly.
REFRESH_COOLDOWN_S = 300  # 5 minutes per station

FUEL_TYPES = ("regular_gas", "midgrade_gas", "premium_gas", "diesel", "e85")

_request_log: dict[str, deque] = defaultdict(deque)
_last_manual_refresh: dict[str, float] = {}


def _check_rate_limit(key_hash: str) -> None:
    now = time.monotonic()
    log = _request_log[key_hash]
    while log and now - log[0] > RATE_LIMIT_WINDOW_S:
        log.popleft()
    if len(log) >= RATE_LIMIT_REQUESTS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — try again shortly.")
    log.append(now)


async def require_api_key(authorization: str = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing API key. Use: Authorization: Bearer <key>")
    raw_key = authorization.removeprefix("Bearer ").strip()
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    _check_rate_limit(key_hash)
    if not database.verify_and_touch_api_key(key_hash):
        raise HTTPException(status_code=401, detail="Invalid or revoked API key.")
    return key_hash


def _station_city(s: dict) -> str:
    return s.get("city") or "Other"


def _matches_filters(s: dict, city: Optional[str], brand: Optional[str]) -> bool:
    if city and _station_city(s).lower() != city.lower():
        return False
    if brand and gb.normalize_brand(s["name"]).lower() != brand.lower():
        return False
    return True


def _validate_fuel_type(fuel_type: str) -> None:
    if fuel_type not in FUEL_TYPES:
        raise HTTPException(status_code=400, detail=f"fuel_type must be one of {', '.join(FUEL_TYPES)}")


v1_app = FastAPI(
    title="GASMAN Public API",
    version="1.0.0",
    description=(
        "Look up current BC gas prices by station ID. "
        "Requires an API key: `Authorization: Bearer <key>`. "
        f"Rate limit: {RATE_LIMIT_REQUESTS} requests / {int(RATE_LIMIT_WINDOW_S)}s per key."
    ),
    docs_url="/docs",
)
v1_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@v1_app.get(
    "/stations", tags=["stations"],
    summary="List stations, optionally filtered by city and/or brand",
)
async def list_stations(
    city: Optional[str]  = Query(default=None, description="Reverse-geocoded municipality, e.g. Richmond, Vancouver, Burnaby, Delta, Surrey"),
    brand: Optional[str] = Query(default=None, description="e.g. Shell, Esso, Chevron, Petro-Canada"),
    _: str = Depends(require_api_key),
):
    stations, _trend = gb.get_cache_snapshot()
    result = []
    for s in stations:
        if not _matches_filters(s, city, brand):
            continue
        result.append({
            "station_id": s["station_id"],
            "name":       s["name"],
            "brand":      gb.normalize_brand(s["name"]),
            "address":    s.get("address"),
            "city":       _station_city(s),
            "latitude":   s.get("latitude"),
            "longitude":  s.get("longitude"),
        })
    return {
        "count":    len(result),
        "filters":  {"city": city, "brand": brand},
        "stations": result,
    }


@v1_app.get(
    "/stations/cheapest", tags=["stations"],
    summary="Find the cheapest station for a fuel type, optionally filtered by city/brand",
)
async def cheapest_station(
    city: Optional[str]  = Query(default=None),
    brand: Optional[str] = Query(default=None),
    fuel_type: str        = Query(default="regular_gas", description=f"One of {', '.join(FUEL_TYPES)}"),
    _: str = Depends(require_api_key),
):
    _validate_fuel_type(fuel_type)
    stations, _trend = gb.get_cache_snapshot()
    best = None
    for s in stations:
        if not _matches_filters(s, city, brand):
            continue
        price = (s.get(fuel_type) or {}).get("price")
        if price is None:
            continue
        if best is None or price < best[0]:
            best = (price, s)

    if best is None:
        raise HTTPException(status_code=404, detail="No station matched those filters with a price for that fuel type.")

    price, s = best
    return {
        "station_id": s["station_id"],
        "name":       s["name"],
        "brand":      gb.normalize_brand(s["name"]),
        "address":    s.get("address"),
        "city":       _station_city(s),
        "latitude":   s.get("latitude"),
        "longitude":  s.get("longitude"),
        "fuel_type":  fuel_type,
        "price":      price,
    }


@v1_app.get(
    "/stations/average", tags=["stations"],
    summary="Average price over the last N days, by station, city, and/or brand",
)
async def average_price(
    station_id: Optional[str] = Query(default=None, description="Average for one specific station"),
    city: Optional[str]       = Query(default=None),
    brand: Optional[str]      = Query(default=None),
    fuel_type: str             = Query(default="regular_gas", description=f"One of {', '.join(FUEL_TYPES)}"),
    days: int                  = Query(default=7, ge=1, le=90),
    _: str = Depends(require_api_key),
):
    _validate_fuel_type(fuel_type)

    if station_id:
        station_ids = [station_id]
    else:
        stations, _trend = gb.get_cache_snapshot()
        station_ids = [s["station_id"] for s in stations if _matches_filters(s, city, brand)]
        if not station_ids:
            raise HTTPException(status_code=404, detail="No stations matched those filters.")

    result = database.get_average_price(station_ids, fuel_type, days)
    return {
        "filters": {"station_id": station_id, "city": city, "brand": brand, "fuel_type": fuel_type, "days": days},
        "station_count": len(station_ids),
        **result,
    }


@v1_app.get("/stations/{station_id}", tags=["stations"], summary="Get current prices for a station")
async def get_station(station_id: str, _: str = Depends(require_api_key)):
    station = gb.get_station_by_id(station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="station not found")
    delta = database.get_price_deltas().get(station_id)
    if delta:
        station = {**station, "price_delta": delta}
    return station


@v1_app.get("/stations/{station_id}/history", tags=["stations"], summary="Get price history for a station")
async def get_station_history(station_id: str, hours: int = 24, _: str = Depends(require_api_key)):
    return {"station_id": station_id, "history": database.get_station_history(station_id, hours)}


@v1_app.post(
    "/stations/{station_id}/refresh", tags=["stations"],
    summary="Force an immediate price refresh for one station, all fuel types",
)
async def refresh_station(station_id: str, _: str = Depends(require_api_key)):
    station = gb.get_station_by_id(station_id)
    if station is None:
        raise HTTPException(status_code=404, detail="station not found")

    now = time.monotonic()
    last = _last_manual_refresh.get(station_id)
    if last is not None and now - last < REFRESH_COOLDOWN_S:
        wait = int(REFRESH_COOLDOWN_S - (now - last))
        raise HTTPException(status_code=429, detail=f"This station was just refreshed — try again in {wait}s.")

    if gb.is_scan_running():
        raise HTTPException(status_code=503, detail="A scheduled scan is in progress — try again shortly.")

    _last_manual_refresh[station_id] = now

    results = await gb.refresh_single_station(station["latitude"], station["longitude"])
    if not results:
        raise HTTPException(status_code=502, detail="Refresh failed — GasBuddy didn't return data. Try again shortly.")

    database.upsert_stations(results)
    database.insert_prices(results)
    gb.merge_into_cache(results)

    updated = gb.get_station_by_id(station_id)
    if updated is None:
        raise HTTPException(status_code=502, detail="Station wasn't found in the refreshed results.")
    return updated
