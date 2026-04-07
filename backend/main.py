import asyncio
import math
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import database
import gasbuddy_client as gb

STATIC_DIR = Path(__file__).parent / "static"


async def poll_and_store() -> None:
    print(f"[{datetime.now().strftime('%H:%M')}] Polling gas prices ...")
    try:
        stations, _ = await gb.get_all_vancouver()
        database.insert_prices(stations)
        print(f"  Stored {len(stations)} stations.")
    except Exception as e:
        print(f"  Poll failed: {e}")


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    # Warm cache from DB so the app responds instantly after redeploy
    cached = database.get_latest_stations()
    if cached:
        gb.warm_cache_from_db(cached)
        print(f"[startup] Warmed cache with {len(cached)} stations from DB.")
    asyncio.create_task(poll_and_store())  # refresh in background
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
    stations, trend = await gb.get_all_vancouver()
    deltas = database.get_price_deltas()
    for s in stations:
        d = deltas.get(s["station_id"])
        if d:
            s["price_delta"] = d
    return {
        "stations":   stations,
        "trend":      trend,
        "count":      len(stations),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/history/{station_id}")
async def get_history(station_id: str, hours: int = 24):
    history = database.get_station_history(station_id, hours)
    return {"station_id": station_id, "history": history}


def _nearest_area(lat, lng):
    best, best_d = "Other", float("inf")
    for name, clat, clng in database.AREA_CENTROIDS:
        d = math.hypot(lat - clat, lng - clng)
        if d < best_d:
            best_d, best = d, name
    return best


@app.get("/api/insights")
async def get_insights(fuel_type: str = "regular_gas"):
    raw          = database.get_area_averages(fuel_type)
    ytd_vs_today = database.get_ytd_vs_today(fuel_type)

    today_by_area: dict = {}
    for row in raw["today"]:
        if row["latitude"] and row["longitude"]:
            area = _nearest_area(row["latitude"], row["longitude"])
            today_by_area.setdefault(area, []).append(row["avg_price"])

    ytd_by_area: dict = {}
    for row in raw["ytd"]:
        if row["latitude"] and row["longitude"]:
            area = _nearest_area(row["latitude"], row["longitude"])
            ytd_by_area.setdefault(area, []).append(row["avg_price"])

    area_averages = []
    for name, _, _ in database.AREA_CENTROIDS:
        today_prices = today_by_area.get(name, [])
        if not today_prices:
            continue
        avg_today = round(sum(today_prices) / len(today_prices), 1)
        ytd_prices = ytd_by_area.get(name, [])
        avg_ytd   = round(sum(ytd_prices) / len(ytd_prices), 1) if ytd_prices else None
        change    = round(avg_today - avg_ytd, 1) if avg_ytd is not None else None
        area_averages.append({
            "area":      name,
            "avg_today": avg_today,
            "avg_ytd":   avg_ytd,
            "change":    change,
        })

    return {"area_averages": area_averages, "ytd_vs_today": ytd_vs_today}


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# Serve the built React SPA - must be mounted AFTER all /api routes
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
