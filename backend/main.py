import asyncio
import logging
import math
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

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"


async def discovery_job() -> None:
    """Full grid scan — discovers new stations across BC. Runs daily."""
    logger.info("discovery_job: starting full BC grid scan …")
    try:
        def on_flush(stations):
            database.upsert_stations(stations)
            database.insert_prices(stations)

        stations, _ = await gb.discover_stations(on_flush=on_flush)
        database.upsert_stations(stations)
        database.insert_prices(stations)
        logger.info("discovery_job: done — %d stations", len(stations))
    except Exception:
        logger.exception("discovery_job failed")


async def price_refresh_job() -> None:
    """Fast refresh using known station cluster centers. Runs every 30 min."""
    known = database.get_known_stations()
    if not known:
        logger.info("price_refresh_job: no known stations — running discovery first")
        await discovery_job()
        return

    logger.info("price_refresh_job: refreshing prices for %d known stations …", len(known))
    try:
        def on_flush(stations):
            database.insert_prices(stations)

        stations, _ = await gb.refresh_prices(known, on_flush=on_flush)
        database.insert_prices(stations)
        logger.info("price_refresh_job: done — %d stations updated", len(stations))
    except Exception:
        logger.exception("price_refresh_job failed")


scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()

    # Warm the in-memory cache instantly from DB (so /api/stations responds immediately)
    cached = database.get_latest_stations()
    if cached:
        gb.warm_cache_from_db(cached)
        logger.info("Warmed cache with %d stations from DB", len(cached))

    # Schedule recurring jobs
    scheduler.add_job(price_refresh_job, "interval", minutes=30, id="price_refresh")
    scheduler.add_job(discovery_job,     "interval", days=1,     id="discovery")
    scheduler.start()

    # Kick off the right job immediately in the background (non-blocking)
    asyncio.create_task(price_refresh_job())

    yield
    scheduler.shutdown()


app = FastAPI(title="BC Gas Prices API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/stations")
async def get_stations():
    stations, trend = await gb.get_all_bc()
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


# Trigger a manual discovery scan (useful after deploy or to force refresh)
@app.post("/api/admin/discover")
async def trigger_discovery():
    asyncio.create_task(discovery_job())
    return {"status": "discovery job started"}


# Serve the built React SPA — must be mounted AFTER all /api routes
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
