import os
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

# Railway injects DATABASE_URL automatically when a Postgres service is linked.
# Also try POSTGRES_URL / individual PG* vars as fallback.
_DATABASE_URL = (
    os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL")
    or os.environ.get("POSTGRESQL_URL")
    or ""
)
if not _DATABASE_URL:
    # Build from individual PG* vars that Railway also injects
    pg_host = os.environ.get("PGHOST") or os.environ.get("POSTGRES_HOST")
    pg_port = os.environ.get("PGPORT") or os.environ.get("POSTGRES_PORT", "5432")
    pg_db   = os.environ.get("PGDATABASE") or os.environ.get("POSTGRES_DB")
    pg_user = os.environ.get("PGUSER") or os.environ.get("POSTGRES_USER")
    pg_pass = os.environ.get("PGPASSWORD") or os.environ.get("POSTGRES_PASSWORD")
    if pg_host and pg_db and pg_user:
        _DATABASE_URL = f"postgresql://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}"
if _DATABASE_URL.startswith("postgres://"):
    # psycopg2 requires postgresql:// scheme
    _DATABASE_URL = _DATABASE_URL.replace("postgres://", "postgresql://", 1)

FUEL_TYPES = ["regular_gas", "midgrade_gas", "premium_gas", "diesel", "e85"]

AREA_CENTROIDS = [
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
    ("Abbotsford",         49.0504, -122.3045),
    ("Chilliwack",         49.1579, -121.9514),
    ("Victoria",           48.4284, -123.3656),
    ("Nanaimo",            49.1659, -123.9401),
    ("Kelowna",            49.8880, -119.4960),
    ("Kamloops",           50.6745, -120.3273),
    ("Kootenays",          49.4926, -117.2948),
    ("Prince George",      53.9166, -122.7497),
    ("Northern BC",        56.2518, -120.8476),
]


def _conn():
    if not _DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set.")
    return psycopg2.connect(_DATABASE_URL)


def init_db():
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS price_history (
                    id          SERIAL PRIMARY KEY,
                    station_id  TEXT NOT NULL,
                    name        TEXT,
                    address     TEXT,
                    latitude    DOUBLE PRECISION,
                    longitude   DOUBLE PRECISION,
                    fuel_type   TEXT NOT NULL,
                    price       DOUBLE PRECISION,
                    currency    TEXT,
                    unit        TEXT,
                    recorded_at TIMESTAMPTZ NOT NULL
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_station_fuel_time
                ON price_history (station_id, fuel_type, recorded_at)
            """)


def insert_prices(stations: list):
    now = datetime.now(timezone.utc)
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
        with _conn() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO price_history
                    (station_id, name, address, latitude, longitude,
                     fuel_type, price, currency, unit, recorded_at)
                    VALUES %s
                """, rows)


def get_price_deltas() -> dict:
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT DISTINCT recorded_at FROM price_history
                ORDER BY recorded_at DESC LIMIT 2
            """)
            times = cur.fetchall()
            if len(times) < 2:
                return {}
            t_now, t_prev = times[0]["recorded_at"], times[1]["recorded_at"]
            cur.execute("""
                SELECT station_id, fuel_type, price, recorded_at
                FROM price_history
                WHERE recorded_at IN (%s, %s)
            """, (t_now, t_prev))
            rows = cur.fetchall()

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
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT latitude, longitude, AVG(price) as avg_price
                FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= NOW() - INTERVAL '24 hours'
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                GROUP BY station_id, latitude, longitude
            """, (fuel_type,))
            today_rows = cur.fetchall()

            cur.execute("""
                SELECT latitude, longitude, AVG(price) as avg_price
                FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= date_trunc('year', NOW())
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                GROUP BY station_id, latitude, longitude
            """, (fuel_type,))
            ytd_rows = cur.fetchall()

    return {"today": today_rows, "ytd": ytd_rows}


def get_ytd_vs_today(fuel_type: str = "regular_gas") -> dict:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT AVG(price) FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= NOW() - INTERVAL '24 hours'
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
            """, (fuel_type,))
            today_avg = cur.fetchone()[0]

            cur.execute("""
                SELECT AVG(price) FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= date_trunc('year', NOW())
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
            """, (fuel_type,))
            ytd_avg = cur.fetchone()[0]

    today_avg = round(today_avg, 1) if today_avg else None
    ytd_avg   = round(ytd_avg,   1) if ytd_avg   else None
    change_pct = None
    if today_avg and ytd_avg and ytd_avg > 0:
        change_pct = round((today_avg - ytd_avg) / ytd_avg * 100, 1)
    return {"today_avg": today_avg, "ytd_avg": ytd_avg, "change_pct": change_pct}


def get_station_history(station_id: str, hours: int = 24) -> list:
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT fuel_type, price, currency, unit, recorded_at
                FROM price_history
                WHERE station_id = %s
                  AND recorded_at >= NOW() - make_interval(hours => %s)
                ORDER BY recorded_at ASC
            """, (station_id, hours))
            return [dict(r) for r in cur.fetchall()]
