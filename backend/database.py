import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "prices.db"
FUEL_TYPES = ["regular_gas", "midgrade_gas", "premium_gas", "diesel", "e85"]


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id  TEXT NOT NULL,
            name        TEXT,
            address     TEXT,
            latitude    REAL,
            longitude   REAL,
            fuel_type   TEXT NOT NULL,
            price       REAL,
            currency    TEXT,
            unit        TEXT,
            recorded_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_station_fuel_time
        ON price_history (station_id, fuel_type, recorded_at)
    """)
    conn.commit()
    conn.close()


def insert_prices(stations: list):
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for station in stations:
        for fuel_type in FUEL_TYPES:
            fuel_data = station.get(fuel_type)
            if fuel_data and fuel_data.get("price") is not None:
                rows.append((
                    station["station_id"],
                    station.get("name"),
                    station.get("address"),
                    station.get("latitude"),
                    station.get("longitude"),
                    fuel_type,
                    fuel_data["price"],
                    station.get("currency"),
                    station.get("unit_of_measure"),
                    now,
                ))
    if rows:
        conn = sqlite3.connect(DB_PATH)
        conn.executemany("""
            INSERT INTO price_history
            (station_id, name, address, latitude, longitude,
             fuel_type, price, currency, unit, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)
        conn.commit()
        conn.close()


def get_price_deltas() -> dict:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        times = conn.execute(
            "SELECT DISTINCT recorded_at FROM price_history ORDER BY recorded_at DESC LIMIT 2"
        ).fetchall()
        if len(times) < 2:
            return {}
        t_now, t_prev = times[0]["recorded_at"], times[1]["recorded_at"]
        rows = conn.execute(
            "SELECT station_id, fuel_type, price, recorded_at FROM price_history WHERE recorded_at IN (?, ?)",
            (t_now, t_prev),
        ).fetchall()

    current, previous = {}, {}
    for r in rows:
        k = (r["station_id"], r["fuel_type"])
        if r["recorded_at"] == t_now:
            current[k] = r["price"]
        else:
            previous[k] = r["price"]

    result: dict = {}
    for (sid, fuel), price in current.items():
        if (sid, fuel) in previous:
            delta = round(price - previous[(sid, fuel)], 1)
            if delta != 0:
                result.setdefault(sid, {})[fuel] = delta
    return result


def get_station_history(station_id: str, hours: int = 24) -> list:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT fuel_type, price, currency, unit, recorded_at
        FROM price_history
        WHERE station_id = ?
          AND recorded_at >= datetime('now', ?)
        ORDER BY recorded_at ASC
    """, (station_id, f"-{hours} hours")).fetchall()
    conn.close()
    return [dict(r) for r in rows]
