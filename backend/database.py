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
    # Greater Vancouver
    ("Downtown Vancouver", 49.2827, -123.1207),
    ("East Vancouver",     49.2622, -123.0680),
    ("Vancouver",          49.2300, -123.1200),
    ("North Vancouver",    49.3163, -123.0724),
    ("West Vancouver",     49.3500, -123.2000),
    ("Burnaby",            49.2650, -122.9200),
    ("South Burnaby",      49.2200, -122.9600),
    ("New Westminster",    49.2060, -122.9110),
    ("Richmond",           49.1666, -123.1336),
    ("Delta",              49.0900, -123.0800),
    ("North Delta",        49.1300, -123.0500),
    ("Surrey",             49.1044, -122.8000),
    ("White Rock",         49.0253, -122.8027),
    ("Langley",            49.1044, -122.6500),
    ("Aldergrove",         49.0700, -122.6000),
    ("Coquitlam",          49.2840, -122.7932),
    ("Port Coquitlam",     49.2625, -122.7811),
    ("Port Moody",         49.2840, -122.8320),
    ("Maple Ridge",        49.2190, -122.5980),
    ("Squamish",           49.7016, -123.1558),
    ("Whistler",           50.1163, -122.9574),
    ("Gibsons",            49.3950, -123.5100),
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
            cur.execute("""
                CREATE TABLE IF NOT EXISTS stations (
                    station_id  TEXT PRIMARY KEY,
                    name        TEXT,
                    address     TEXT,
                    city        TEXT,
                    latitude    DOUBLE PRECISION NOT NULL,
                    longitude   DOUBLE PRECISION NOT NULL,
                    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            # Add city column to existing deployments that pre-date this column
            cur.execute("""
                ALTER TABLE stations ADD COLUMN IF NOT EXISTS city TEXT
            """)
            # Back-fill stations table from price_history on first run (idempotent)
            cur.execute("""
                INSERT INTO stations (station_id, name, address, latitude, longitude, last_seen)
                SELECT DISTINCT ON (station_id)
                    station_id, name, address, latitude, longitude, MAX(recorded_at)
                FROM price_history
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                GROUP BY station_id, name, address, latitude, longitude
                ON CONFLICT (station_id) DO NOTHING
            """)


def upsert_stations(stations: list) -> None:
    """Insert or update station registry (location metadata only, no prices)."""
    if not stations:
        return
    rows = [
        (s["station_id"], s.get("name"), s.get("address"), s.get("city") or None,
         s.get("latitude"), s.get("longitude"))
        for s in stations
        if s.get("station_id") and s.get("latitude") is not None and s.get("longitude") is not None
    ]
    if not rows:
        return
    with _conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO stations (station_id, name, address, city, latitude, longitude)
                VALUES %s
                ON CONFLICT (station_id) DO UPDATE SET
                    name=EXCLUDED.name,
                    address=EXCLUDED.address,
                    city=COALESCE(EXCLUDED.city, stations.city),
                    latitude=EXCLUDED.latitude,
                    longitude=EXCLUDED.longitude,
                    last_seen=NOW()
            """, rows)


def get_known_stations() -> list:
    """Return all stations from the registry (lat/lng for clustering)."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT station_id, name, address, city, latitude, longitude FROM stations"
            )
            return [dict(r) for r in cur.fetchall()]


def insert_prices(stations: list):
    """Insert price records, skipping rows where price hasn't changed.

    Compares each (station_id, fuel_type, price) against the most recent
    stored value.  Only changed prices are written, keeping the table small.
    """
    if not stations:
        return

    # Build candidate rows from the incoming scan data
    now = datetime.now(timezone.utc)
    candidates: list[tuple] = []
    for station in stations:
        for fuel_type in FUEL_TYPES:
            fuel_data = station.get(fuel_type)
            if fuel_data and fuel_data.get("price") is not None:
                candidates.append((
                    station["station_id"],
                    fuel_type,
                    fuel_data["price"],
                    station.get("name"),
                    station.get("address"),
                    station.get("latitude"),
                    station.get("longitude"),
                    station.get("currency"),
                    station.get("unit_of_measure"),
                ))

    if not candidates:
        return

    with _conn() as conn:
        with conn.cursor() as cur:
            # Fetch the latest stored price for every (station, fuel) pair
            # that appears in this batch — single query using ANY().
            station_ids = list({r[0] for r in candidates})
            cur.execute("""
                SELECT DISTINCT ON (station_id, fuel_type)
                    station_id, fuel_type, price
                FROM price_history
                WHERE station_id = ANY(%s)
                ORDER BY station_id, fuel_type, recorded_at DESC
            """, (station_ids,))
            last_prices = {(r[0], r[1]): r[2] for r in cur.fetchall()}

            # Only keep rows where price differs from last stored value
            rows = [
                (sid, name, addr, lat, lng, fuel, price, currency, unit, now)
                for sid, fuel, price, name, addr, lat, lng, currency, unit in candidates
                if round(price, 2) != round(last_prices.get((sid, fuel), -1), 2)
            ]

            if rows:
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


def get_area_averages(fuel_type: str = "regular_gas") -> dict:
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

            cur.execute("""
                SELECT AVG(price) FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= NOW() - INTERVAL '7 days'
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
            """, (fuel_type,))
            seven_day_avg = cur.fetchone()[0]

    today_avg     = round(today_avg,     1) if today_avg     else None
    ytd_avg       = round(ytd_avg,       1) if ytd_avg       else None
    seven_day_avg = round(seven_day_avg, 1) if seven_day_avg else None

    change_pct = None
    if today_avg and ytd_avg and ytd_avg > 0:
        change_pct = round((today_avg - ytd_avg) / ytd_avg * 100, 1)

    seven_day_change_pct = None
    if today_avg and seven_day_avg and seven_day_avg > 0:
        seven_day_change_pct = round((today_avg - seven_day_avg) / seven_day_avg * 100, 1)

    return {
        "today_avg":            today_avg,
        "ytd_avg":              ytd_avg,
        "change_pct":           change_pct,
        "seven_day_avg":        seven_day_avg,
        "seven_day_change_pct": seven_day_change_pct,
    }


def get_latest_stations() -> list:
    """Return the most recent price snapshot for every station, reconstructed
    into the same dict format that gasbuddy_client produces.

    Uses DISTINCT ON (station_id, fuel_type) ordered by recorded_at DESC so that
    a partial/interrupted scan never silently discards stations — each station's
    latest known price is always returned regardless of which batch wrote it.
    """
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Fast check: any data at all?
            cur.execute("SELECT 1 FROM price_history LIMIT 1")
            if not cur.fetchone():
                return []

            # Latest price per (station, fuel_type), within the last 7 days
            cur.execute("""
                WITH latest AS (
                    SELECT DISTINCT ON (ph.station_id, ph.fuel_type)
                        ph.station_id, ph.name, ph.address,
                        ph.latitude, ph.longitude,
                        ph.fuel_type, ph.price, ph.currency, ph.unit,
                        ph.recorded_at
                    FROM price_history ph
                    WHERE ph.recorded_at >= NOW() - INTERVAL '7 days'
                      AND ph.price IS NOT NULL
                    ORDER BY ph.station_id, ph.fuel_type, ph.recorded_at DESC
                )
                SELECT l.*, s.city
                FROM latest l
                LEFT JOIN stations s USING (station_id)
            """)
            rows = cur.fetchall()

    stations: dict = {}
    for r in rows:
        sid = r["station_id"]
        if sid not in stations:
            stations[sid] = {
                "station_id":      sid,
                "name":            r["name"],
                "address":         r["address"],
                "city":            r["city"],
                "latitude":        r["latitude"],
                "longitude":       r["longitude"],
                "unit_of_measure": r["unit"],
                "currency":        r["currency"],
            }
        stations[sid][r["fuel_type"]] = {
            "price":        r["price"],
            "last_updated": r["recorded_at"].isoformat(),
        }
    return list(stations.values())


def purge_old_prices(days: int = 30) -> int:
    """Delete price_history rows older than `days` days. Returns deleted count."""
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM price_history
                WHERE recorded_at < NOW() - make_interval(days => %s)
            """, (days,))
            return cur.rowcount


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
