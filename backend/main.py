import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import py_gasbuddy
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import database

# Set FLARESOLVERR_URL env var to use FlareSolverr (bypasses Cloudflare).
# Default: http://localhost:8191/v1
FLARESOLVERR_URL = os.getenv("FLARESOLVERR_URL", "http://localhost:8191/v1")

# Coverage points across Greater Vancouver
SEARCH_COORDS = [
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver
    (49.3163, -123.0724),  # North Vancouver
    (49.2045, -123.1116),  # Richmond / South Van
    (49.2488, -122.9805),  # Burnaby
]


async def _fetch_station_info(gb, lat: float, lon: float) -> dict:
    try:
        result = await gb.location_search(lat=lat, lon=lon)
        return {
            s["id"]: {"name": s["name"], "address": s["address"]["line1"]}
            for s in result["data"]["locationBySearchTerm"]["stations"]["results"]
        }
    except Exception:
        return {}


async def _fetch_prices(gb, lat: float, lon: float, limit: int = 20):
    try:
        return await gb.price_lookup_service(lat=lat, lon=lon, limit=limit)
    except Exception:
        return None


async def fetch_all_vancouver() -> tuple[list, list]:
    gb = py_gasbuddy.GasBuddy(solver_url=FLARESOLVERR_URL)
    info_results, price_results = await asyncio.gather(
        asyncio.gather(*[_fetch_station_info(gb, lat, lon) for lat, lon in SEARCH_COORDS]),
        asyncio.gather(*[_fetch_prices(gb, lat, lon) for lat, lon in SEARCH_COORDS]),
    )

    all_info: dict = {}
    for info in info_results:
        all_info.update(info)

    all_prices: dict = {}
    trend: list = []
    for result in price_results:
        if not result:
            continue
        for station in result.get("results", []):
            sid = station["station_id"]
            if sid not in all_prices:
                all_prices[sid] = station
        if not trend:
            trend = result.get("trend", [])

    stations = []
    for sid, price_data in all_prices.items():
        info = all_info.get(sid, {})
        stations.append({
            **price_data,
            "name": info.get("name", f"Station #{sid}"),
            "address": info.get("address", "Vancouver, BC"),
        })

    stations.sort(key=lambda x: (
        not x.get("regular_gas") or x["regular_gas"].get("price") is None,
        (x.get("regular_gas") or {}).get("price") or float("inf"),
    ))

    return stations, trend


async def poll_and_store():
    print(f"[{datetime.now().strftime('%H:%M')}] Polling gas prices...")
    try:
        stations, _ = await fetch_all_vancouver()
        database.insert_prices(stations)
        print(f"  Stored {len(stations)} stations.")
    except Exception as e:
        print(f"  Poll failed: {e}")


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    await poll_and_store()                                    # seed on startup
    scheduler.add_job(poll_and_store, "interval", minutes=30)
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="Vancouver Gas Prices API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/stations")
async def get_stations():
    stations, trend = await fetch_all_vancouver()
    return {
        "stations": stations,
        "trend": trend,
        "count": len(stations),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/history/{station_id}")
async def get_history(station_id: str, hours: int = 24):
    history = database.get_station_history(station_id, hours)
    return {"station_id": station_id, "history": history}


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}
