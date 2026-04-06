import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "prices.db"
FUEL_TYPES = ["regular_gas", "midgrade_gas", "premium_gas", "diesel", "e85"]

AREA_CENTROIDS = [
    # Greater Vancouver
    ("Downtown Vancouver", 49.2827, -123.1207),
    ("East Vancouver",     49.2622, -123.0680),
    ("Vancouver",          49.2300, -123.1200),
    ("North Vancouver",    49.3163, -123.0724),
    ("West Vancouver",     49.3500, -123.2000),
    ("Burnaby",            49.2488, -122.9805),
    ("New Westminster",    49.2060, -122.9110),
    ("Richmond",           49.1666, -123.1336),
    ("Delta",              49.1000, -123.0500),
    ("Surrey",             49.1044, -122.8000),
    ("White Rock",         49.0225, -122.8025),
    ("Langley",            49.1044, -122.6500),
    ("Coquitlam",          49.2840, -122.7932),
    ("Port Coquitlam",     49.2625, -122.7811),
    ("Port Moody",         49.2840, -122.8320),
    ("Maple Ridge",        49.2190, -122.5980),
    ("Pitt Meadows",       49.2290, -122.6890),
    # Fraser Valley
    ("Abbotsford",         49.0504, -122.3045),
    ("Chilliwack",         49.1579, -121.9514),
    # Vancouver Island
    ("Victoria",           48.4284, -123.3656),
    ("Nanaimo",            49.1659, -123.9401),
    # Interior
    ("Kelowna",            49.8880, -119.4960),
    ("Kamloops",           50.6745, -120.3273),
    ("Kootenays",          49.4926, -117.2948),
    # Northern BC
    ("Prince George",      53.9166, -122.7497),
    ("Northern BC",        56.2518, -120.8476),
]

def _assign_area(lat, lng):
    if lat is None or lng is None:
        return "Other"
    best, min_d = AREA_CENTROIDS[0][0], float("inf")
    for name, clat, clng in AREA_CENTROIDS:
        d = (lat - clat) ** 2 + (lng - clng) ** 2
        if d < min_d:
            min_d = d
            best = name
    return best


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
    """
    Compare the two most recent poll snapshots.
    Returns {station_id: {fuel_type: delta}} — only entries where price changed.
    """
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


def get_area_averages(fuel_type: str = "regular_gas") -> list:
    """Average price per area for today (last 24h) and YTD."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        today_rows = conn.execute("""
            SELECT latitude, longitude, AVG(price) as avg_price
            FROM price_history
            WHERE fuel_type = ?
              AND recorded_at >= datetime('now', '-24 hours')
              AND price IS NOT NULL AND price >= 80 AND price <= 350
            GROUP BY station_id
        """, (fuel_type,)).fetchall()

        ytd_rows = conn.execute("""
            SELECT latitude, longitude, AVG(price) as avg_price
            FROM price_history
            WHERE fuel_type = ?
              AND recorded_at >= strftime('%Y-01-01', 'now')
              AND price IS NOT NULL AND price >= 80 AND price <= 350
            GROUP BY station_id
        """, (fuel_type,)).fetchall()

    def group_by_area(rows):
        buckets: dict = {}
        for r in rows:
            area = _assign_area(r["latitude"], r["longitude"])
            buckets.setdefault(area, []).append(r["avg_price"])
        return {a: round(sum(p) / len(p), 1) for a, p in buckets.items()}

    today_map = group_by_area(today_rows)
    ytd_map   = group_by_area(ytd_rows)

    result = []
    for name, _, _ in AREA_CENTROIDS:
        avg_today = today_map.get(name)
        avg_ytd   = ytd_map.get(name)
        change    = round(avg_today - avg_ytd, 1) if avg_today and avg_ytd else None
        result.append({"area": name, "avg_today": avg_today, "avg_ytd": avg_ytd, "change": change})
    return result


def get_ytd_vs_today(fuel_type: str = "regular_gas") -> dict:
    """Overall average: today (last 24h) vs year-to-date."""
    with sqlite3.connect(DB_PATH) as conn:
        r_today = conn.execute("""
            SELECT AVG(price) FROM price_history
            WHERE fuel_type = ? AND recorded_at >= datetime('now', '-24 hours')
              AND price IS NOT NULL AND price >= 80 AND price <= 350
        """, (fuel_type,)).fetchone()
        r_ytd = conn.execute("""
            SELECT AVG(price) FROM price_history
            WHERE fuel_type = ? AND recorded_at >= strftime('%Y-01-01', 'now')
              AND price IS NOT NULL AND price >= 80 AND price <= 350
        """, (fuel_type,)).fetchone()

    today_avg = round(r_today[0], 1) if r_today and r_today[0] else None
    ytd_avg   = round(r_ytd[0],   1) if r_ytd   and r_ytd[0]   else None
    change_pct = None
    if today_avg and ytd_avg and ytd_avg > 0:
        change_pct = round((today_avg - ytd_avg) / ytd_avg * 100, 1)
    return {"today_avg": today_avg, "ytd_avg": ytd_avg, "change_pct": change_pct}


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
