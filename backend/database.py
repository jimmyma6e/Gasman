import os
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from gasbuddy_client import premium_octane_for

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
            cur.execute("""
                CREATE TABLE IF NOT EXISTS api_keys (
                    key_hash      TEXT PRIMARY KEY,
                    label         TEXT NOT NULL,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    revoked       BOOLEAN NOT NULL DEFAULT FALSE,
                    request_count BIGINT NOT NULL DEFAULT 0,
                    last_used_at  TIMESTAMPTZ
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS price_alerts (
                    id              SERIAL PRIMARY KEY,
                    email           TEXT NOT NULL,
                    scope_type      TEXT NOT NULL,              -- 'stations' | 'cities' | 'any'
                    scope_values    JSONB NOT NULL DEFAULT '[]', -- station_ids or city names
                    fuel_types      JSONB NOT NULL DEFAULT '[]', -- e.g. ["regular_gas","diesel"]
                    trigger_type    TEXT NOT NULL,               -- 'fixed_price' | 'lowest_over_days' | 'below_baseline'
                    trigger_config  JSONB NOT NULL DEFAULT '{}',
                    suppress_hours  INTEGER NOT NULL DEFAULT 24,
                    active          BOOLEAN NOT NULL DEFAULT TRUE,
                    last_triggered_at TIMESTAMPTZ,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
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


def get_stations_missing_city() -> list:
    """Stations that haven't been reverse-geocoded yet."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT station_id, latitude, longitude FROM stations
                WHERE city IS NULL OR city = ''
            """)
            return [dict(r) for r in cur.fetchall()]


def update_station_city(station_id: str, city: str) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE stations SET city = %s WHERE station_id = %s",
                (city, station_id),
            )


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


# Virtual fuel-type keys for octane-split premium tiers — GasBuddy only
# gives one blended "premium_gas" field per station; the real octane (91,
# 93, or Petro-Canada's 94) is inferred per-brand and only matters once
# you're averaging across many stations/brands (a single station's own
# premium price is always one specific octane already).
PREMIUM_OCTANE_TIERS = {
    "premium_91": {91, 94},  # everyone except Esso/Shell, plus Petro-Canada's 94
    "premium_93": {93},      # Esso, Shell
}


def _resolve_fuel_type(fuel_type: str):
    """Returns (real fuel_type column value, octane set to filter to, or None)."""
    if fuel_type in PREMIUM_OCTANE_TIERS:
        return "premium_gas", PREMIUM_OCTANE_TIERS[fuel_type]
    return fuel_type, None


def _filter_by_octane(rows: list, octane_filter) -> list:
    if not octane_filter:
        return rows
    return [r for r in rows if premium_octane_for(r["name"]) in octane_filter]


def get_area_averages(fuel_type: str = "regular_gas") -> dict:
    sql_fuel, octane_filter = _resolve_fuel_type(fuel_type)
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT name, latitude, longitude, AVG(price) as avg_price
                FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= NOW() - INTERVAL '24 hours'
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                GROUP BY station_id, name, latitude, longitude
            """, (sql_fuel,))
            today_rows = _filter_by_octane(cur.fetchall(), octane_filter)

            cur.execute("""
                SELECT name, latitude, longitude, AVG(price) as avg_price
                FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= date_trunc('year', NOW())
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                GROUP BY station_id, name, latitude, longitude
            """, (sql_fuel,))
            ytd_rows = _filter_by_octane(cur.fetchall(), octane_filter)

    return {"today": today_rows, "ytd": ytd_rows}


def get_area_price_series(fuel_type: str, days: int) -> list:
    """Per-station daily averages over the last `days` days, with lat/lng so
    the caller can bucket by area (nearest-centroid classification lives in
    main.py, same as get_area_averages's today/ytd split above).
    """
    sql_fuel, octane_filter = _resolve_fuel_type(fuel_type)
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT name, latitude, longitude, DATE(recorded_at) AS day, AVG(price) AS avg_price
                FROM price_history
                WHERE fuel_type = %s
                  AND recorded_at >= NOW() - make_interval(days => %s)
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                GROUP BY station_id, name, latitude, longitude, DATE(recorded_at)
                ORDER BY day ASC
            """, (sql_fuel, days))
            return _filter_by_octane([dict(r) for r in cur.fetchall()], octane_filter)


def _avg_price_since(cur, sql_fuel: str, since_clause: str, octane_filter) -> float | None:
    """AVG(price) since a fixed time clause — when octane_filter is set
    (a virtual premium_91/premium_93 tier), SQL can't filter by brand, so
    fetch the raw rows and filter+average in Python instead.
    """
    if octane_filter:
        cur.execute(f"""
            SELECT name, price FROM price_history
            WHERE fuel_type = %s AND {since_clause}
              AND price IS NOT NULL AND price >= 80 AND price <= 350
        """, (sql_fuel,))
        prices = [p for (name, p) in cur.fetchall() if premium_octane_for(name) in octane_filter]
        return (sum(prices) / len(prices)) if prices else None

    cur.execute(f"""
        SELECT AVG(price) FROM price_history
        WHERE fuel_type = %s AND {since_clause}
          AND price IS NOT NULL AND price >= 80 AND price <= 350
    """, (sql_fuel,))
    return cur.fetchone()[0]


def get_ytd_vs_today(fuel_type: str = "regular_gas") -> dict:
    sql_fuel, octane_filter = _resolve_fuel_type(fuel_type)
    with _conn() as conn:
        with conn.cursor() as cur:
            today_avg     = _avg_price_since(cur, sql_fuel, "recorded_at >= NOW() - INTERVAL '24 hours'", octane_filter)
            ytd_avg       = _avg_price_since(cur, sql_fuel, "recorded_at >= date_trunc('year', NOW())", octane_filter)
            seven_day_avg = _avg_price_since(cur, sql_fuel, "recorded_at >= NOW() - INTERVAL '7 days'", octane_filter)

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


def insert_api_key(key_hash: str, label: str) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO api_keys (key_hash, label) VALUES (%s, %s)",
                (key_hash, label),
            )


def verify_and_touch_api_key(key_hash: str) -> bool:
    """Return True and bump usage stats if key_hash is a valid, non-revoked key."""
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE api_keys
                SET request_count = request_count + 1, last_used_at = NOW()
                WHERE key_hash = %s AND revoked = FALSE
                RETURNING key_hash
            """, (key_hash,))
            return cur.fetchone() is not None


def list_api_keys() -> list:
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT key_hash, label, created_at, revoked, request_count, last_used_at
                FROM api_keys ORDER BY created_at DESC
            """)
            return [dict(r) for r in cur.fetchall()]


def revoke_api_key(label: str) -> int:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE api_keys SET revoked = TRUE WHERE label = %s", (label,))
            return cur.rowcount


def get_average_price(station_ids: list, fuel_type: str, days: int) -> dict:
    """Average price for one fuel type across the given stations over the
    last `days` days. Same sane-price bounds used elsewhere (80-350) to
    exclude bad/placeholder scrapes.
    """
    if not station_ids:
        return {"avg_price": None, "sample_count": 0, "latest_recorded_at": None}
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT AVG(price), COUNT(*), MAX(recorded_at) FROM price_history
                WHERE station_id = ANY(%s) AND fuel_type = %s
                  AND recorded_at >= NOW() - make_interval(days => %s)
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
            """, (station_ids, fuel_type, days))
            avg_price, count, latest = cur.fetchone()
    return {
        "avg_price":          round(avg_price, 1) if avg_price is not None else None,
        "sample_count":       count,
        "latest_recorded_at": latest.isoformat() if latest else None,
    }


def get_station_history(station_id: str, hours: int = 24) -> list:
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT fuel_type, price, currency, unit, recorded_at
                FROM price_history
                WHERE station_id = %s
                  AND recorded_at >= NOW() - make_interval(hours => %s)
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                ORDER BY recorded_at ASC
            """, (station_id, hours))
            return [dict(r) for r in cur.fetchall()]


# ── Price alerts ──────────────────────────────────────────────────────────

def get_distinct_cities() -> list:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT city FROM stations WHERE city IS NOT NULL ORDER BY city")
            return [r[0] for r in cur.fetchall()]


def get_station_ids_for_cities(cities: list) -> list:
    if not cities:
        return []
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT station_id FROM stations WHERE city = ANY(%s)", (cities,))
            return [r[0] for r in cur.fetchall()]


def create_alert(email: str, scope_type: str, scope_values: list, fuel_types: list,
                  trigger_type: str, trigger_config: dict, suppress_hours: int) -> dict:
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO price_alerts
                    (email, scope_type, scope_values, fuel_types, trigger_type, trigger_config, suppress_hours)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                email, scope_type, psycopg2.extras.Json(scope_values), psycopg2.extras.Json(fuel_types),
                trigger_type, psycopg2.extras.Json(trigger_config), suppress_hours,
            ))
            return dict(cur.fetchone())


def list_alerts(email: str) -> list:
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM price_alerts WHERE email = %s ORDER BY created_at DESC", (email,))
            return [dict(r) for r in cur.fetchall()]


def delete_alert(alert_id: int, email: str) -> bool:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM price_alerts WHERE id = %s AND email = %s", (alert_id, email))
            return cur.rowcount > 0


def set_alert_active(alert_id: int, email: str, active: bool) -> bool:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE price_alerts SET active = %s WHERE id = %s AND email = %s",
                (active, alert_id, email),
            )
            return cur.rowcount > 0


def get_evaluable_alerts() -> list:
    """Active alerts that aren't currently suppressed by their own cooldown."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM price_alerts
                WHERE active = TRUE
                  AND (last_triggered_at IS NULL
                       OR last_triggered_at <= NOW() - (suppress_hours * INTERVAL '1 hour'))
            """)
            return [dict(r) for r in cur.fetchall()]


def mark_alert_triggered(alert_id: int) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE price_alerts SET last_triggered_at = NOW() WHERE id = %s", (alert_id,))


# station_ids=None means "no scope filter" (alert scope = 'any').
_STATION_FILTER_SQL = "(%(station_ids)s::text[] IS NULL OR station_id = ANY(%(station_ids)s))"


def find_fixed_price_hits(station_ids: list | None, fuel_type: str, threshold: float) -> list:
    """Stations whose latest price (within the last 2h) is at or below `threshold`."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT DISTINCT ON (station_id) station_id, name, price, recorded_at
                FROM price_history
                WHERE fuel_type = %(fuel_type)s
                  AND {_STATION_FILTER_SQL}
                  AND price IS NOT NULL AND price >= 80 AND price <= 350
                  AND recorded_at >= NOW() - INTERVAL '2 hours'
                  AND price <= %(threshold)s
                ORDER BY station_id, recorded_at DESC
            """, {"fuel_type": fuel_type, "station_ids": station_ids, "threshold": threshold})
            return [dict(r) for r in cur.fetchall()]


def find_new_low_hits(station_ids: list | None, fuel_type: str, days: int) -> list:
    """Stations whose latest price ties or beats their own min over the last `days` days."""
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                WITH latest AS (
                    SELECT DISTINCT ON (station_id) station_id, name, price, recorded_at
                    FROM price_history
                    WHERE fuel_type = %(fuel_type)s
                      AND {_STATION_FILTER_SQL}
                      AND price IS NOT NULL AND price >= 80 AND price <= 350
                      AND recorded_at >= NOW() - INTERVAL '2 hours'
                    ORDER BY station_id, recorded_at DESC
                ),
                mins AS (
                    SELECT station_id, MIN(price) AS min_price
                    FROM price_history
                    WHERE fuel_type = %(fuel_type)s
                      AND {_STATION_FILTER_SQL}
                      AND recorded_at >= NOW() - make_interval(days => %(days)s)
                      AND price IS NOT NULL AND price >= 80 AND price <= 350
                    GROUP BY station_id
                )
                SELECT latest.station_id, latest.name, latest.price, latest.recorded_at, mins.min_price
                FROM latest JOIN mins USING (station_id)
                WHERE latest.price <= mins.min_price
            """, {"fuel_type": fuel_type, "station_ids": station_ids, "days": days})
            return [dict(r) for r in cur.fetchall()]


# Fixed SQL fragments (not user input) selecting the comparison window for
# the "below baseline" trigger — mirrors the ytd/2d/3d framing already used
# elsewhere (get_ytd_vs_today, PriceChart's vs-avg row).
_BASELINE_SINCE = {
    "ytd": "date_trunc('year', NOW())",
    "2d":  "NOW() - INTERVAL '2 days'",
    "3d":  "NOW() - INTERVAL '3 days'",
}


def find_below_baseline_hits(station_ids: list | None, fuel_type: str, baseline: str) -> list:
    """Stations whose latest price is below their own ytd/2-day/3-day average."""
    since_expr = _BASELINE_SINCE.get(baseline, _BASELINE_SINCE["3d"])
    with _conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                WITH latest AS (
                    SELECT DISTINCT ON (station_id) station_id, name, price, recorded_at
                    FROM price_history
                    WHERE fuel_type = %(fuel_type)s
                      AND {_STATION_FILTER_SQL}
                      AND price IS NOT NULL AND price >= 80 AND price <= 350
                      AND recorded_at >= NOW() - INTERVAL '2 hours'
                    ORDER BY station_id, recorded_at DESC
                ),
                baselines AS (
                    SELECT station_id, AVG(price) AS baseline_avg
                    FROM price_history
                    WHERE fuel_type = %(fuel_type)s
                      AND {_STATION_FILTER_SQL}
                      AND recorded_at >= {since_expr}
                      AND price IS NOT NULL AND price >= 80 AND price <= 350
                    GROUP BY station_id
                )
                SELECT latest.station_id, latest.name, latest.price, latest.recorded_at, baselines.baseline_avg
                FROM latest JOIN baselines USING (station_id)
                WHERE latest.price < baselines.baseline_avg
            """, {"fuel_type": fuel_type, "station_ids": station_ids})
            return [dict(r) for r in cur.fetchall()]
