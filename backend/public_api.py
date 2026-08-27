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

_request_log: dict[str, deque] = defaultdict(deque)


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
    allow_methods=["GET"],
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
        station_city  = s.get("city") or "Other"
        station_brand = gb.normalize_brand(s["name"])
        if city and station_city.lower() != city.lower():
            continue
        if brand and station_brand.lower() != brand.lower():
            continue
        result.append({
            "station_id": s["station_id"],
            "name":       s["name"],
            "brand":      station_brand,
            "address":    s.get("address"),
            "city":       station_city,
            "latitude":   s.get("latitude"),
            "longitude":  s.get("longitude"),
        })
    return {
        "count":    len(result),
        "filters":  {"city": city, "brand": brand},
        "stations": result,
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
