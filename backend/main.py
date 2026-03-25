import asyncio
from datetime import datetime, timezone

import py_gasbuddy
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Vancouver Gas Prices API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Coverage points across Greater Vancouver
SEARCH_COORDS = [
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver
    (49.3163, -123.0724),  # North Vancouver
    (49.2045, -123.1116),  # South Vancouver / Richmond
    (49.2488, -122.9805),  # Burnaby
]


async def fetch_station_info(gb: py_gasbuddy.GasBuddy, lat: float, lon: float) -> dict:
    try:
        result = await gb.location_search(lat=lat, lon=lon)
        stations = {}
        for s in result["data"]["locationBySearchTerm"]["stations"]["results"]:
            stations[s["id"]] = {
                "name": s["name"],
                "address": s["address"]["line1"],
            }
        return stations
    except Exception:
        return {}


async def fetch_prices(gb: py_gasbuddy.GasBuddy, lat: float, lon: float, limit: int = 20):
    try:
        return await gb.price_lookup_service(lat=lat, lon=lon, limit=limit)
    except Exception:
        return None


@app.get("/api/stations")
async def get_stations():
    gb = py_gasbuddy.GasBuddy()

    # Run all fetches concurrently
    info_tasks = [fetch_station_info(gb, lat, lon) for lat, lon in SEARCH_COORDS]
    price_tasks = [fetch_prices(gb, lat, lon, limit=20) for lat, lon in SEARCH_COORDS]

    info_results, price_results = await asyncio.gather(
        asyncio.gather(*info_tasks),
        asyncio.gather(*price_tasks),
    )

    # Merge all station info
    all_station_info: dict = {}
    for info in info_results:
        all_station_info.update(info)

    # Merge all prices (deduplicate by station_id)
    all_prices: dict = {}
    trend = []
    for result in price_results:
        if not result:
            continue
        for station in result.get("results", []):
            sid = station["station_id"]
            if sid not in all_prices:
                all_prices[sid] = station
        if not trend:
            trend = result.get("trend", [])

    # Build merged station list
    stations = []
    for sid, price_data in all_prices.items():
        info = all_station_info.get(sid, {})
        stations.append(
            {
                **price_data,
                "name": info.get("name", f"Station #{sid}"),
                "address": info.get("address", "Vancouver, BC"),
            }
        )

    # Sort by regular gas price (cheapest first, None prices last)
    stations.sort(
        key=lambda x: (
            x.get("regular_gas", {}) is None or x.get("regular_gas", {}).get("price") is None,
            x.get("regular_gas", {}).get("price") if x.get("regular_gas") else float("inf"),
        )
    )

    return {
        "stations": stations,
        "trend": trend,
        "count": len(stations),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}
