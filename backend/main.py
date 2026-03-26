import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import database
import gasbuddy_client as gb

# Coverage points across Greater Vancouver
SEARCH_COORDS = [
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver
    (49.3163, -123.0724),  # North Vancouver
    (49.2045, -123.1116),  # Richmond / South Van
    (49.2488, -122.9805),  # Burnaby
]


async def fetch_all_vancouver() -> tuple[list, list]:
    """Query all coverage zones and merge results (deduplicated by station_id)."""
    tasks = [gb.search_nearby(lat, lon) for lat, lon in SEARCH_COORDS]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_stations: dict[str, dict] = {}
    trend: list = []

    for r in results:
        if isinstance(r, Exception):
            print(f"  Zone error: {r}")
            continue
        stations, trends = r
        for s in stations:
            sid = s["station_id"]
            if sid and sid not in all_stations:
                all_stations[sid] = s
        if not trend and trends:
            trend = trends

    stations_list = list(all_stations.values())

    # Sort cheapest regular gas first; stations with no regular price go last
    stations_list.sort(key=lambda x: (
        x.get("regular_gas") is None or x["regular_gas"].get("price") is None,
        (x.get("regular_gas") or {}).get("price") or float("inf"),
    ))

    return stations_list, trend


async def poll_and_store() -> None:
    print(f"[{datetime.now().strftime('%H:%M')}] Polling gas prices …")
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
    await poll_and_store()
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
