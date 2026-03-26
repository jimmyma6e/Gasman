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
    print(f"[{datetime.now().strftime('%H:%M')}] Polling gas prices …")
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


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# Serve the built React SPA — must be mounted AFTER all /api routes
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(STATIC_DIR / "index.html")
