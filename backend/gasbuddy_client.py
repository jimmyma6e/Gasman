"""
GasBuddy client — Playwright + page.evaluate() strategy.

How it works:
  1. Launch headless Chromium with stealth headers (hides HeadlessChrome in
     Sec-CH-UA so GasBuddy's CDN routes to the real Next.js app).
  2. Navigate to https://www.gasbuddy.com and intercept GasBuddy's own first
     /graphql request — this lets us capture the per-session `gbcsrf` CSRF
     token that GasBuddy requires on every GraphQL POST.
  3. Use page.evaluate() to call fetch('/graphql', ...) from inside the browser
     (same-origin request — Cloudflare WAF treats it as legitimate JS), passing
     the captured CSRF token + other required headers.
  4. Query lat/lng zones covering BC, deduplicate, cache 4 hours.

Schema notes (discovered by inspection):
  - `fuels`  is an array of fuel-type strings: ["regular_gas", "midgrade_gas", ...]
  - `prices` is a parallel array:              [{"credit":{"price":203.9}}, ...]
  - prices[i] corresponds to fuels[i]
"""

import asyncio
import logging
import math
from datetime import datetime, timezone, timedelta

from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)


# (lat_min, lat_max, lng_min, lng_max) rectangle covering the 5 scanned
# cities. Used both to build the scan grid and to decide whether a station
# falls inside our coverage area at all (for city classification).
SCAN_BOUNDS = (49.02, 49.32, -123.27, -122.68)


def _build_search_coords() -> list:
    coords = []

    def grid(lat_min, lat_max, lng_min, lng_max, km):
        """Generate a lat/lng grid with given spacing in km."""
        lat_step = km / 111.0
        lng_step = km / (111.0 * math.cos(math.radians((lat_min + lat_max) / 2)))
        lat = lat_min
        while lat <= lat_max + lat_step * 0.5:
            lng = lng_min
            while lng <= lng_max + lng_step * 0.5:
                coords.append((round(lat, 4), round(lng, 4)))
                lng += lng_step
            lat += lat_step

    # Vancouver, Burnaby, Richmond, Delta, Surrey — 2.5 km grid (~100 zones)
    grid(*SCAN_BOUNDS, 2.5)

    # Deduplicate (grid edges can overlap)
    seen = set()
    result = []
    for c in coords:
        key = (round(c[0], 3), round(c[1], 3))
        if key not in seen:
            seen.add(key)
            result.append(c)
    return result


SEARCH_COORDS = _build_search_coords()
print(f"[config] {len(SEARCH_COORDS)} search zones loaded.")

# Named anchor points always included in every refresh scan, even before those
# areas have any known stations (ensures Sea-to-Sky, Island, Interior, North
# always get checked on every 30-min cycle — not just after discovery).
ANCHOR_COORDS = [
    (49.2827, -123.1207),  # Vancouver downtown
    (49.2488, -122.9805),  # Burnaby centre
    (49.1666, -123.1336),  # Richmond centre
    (49.0847, -123.0588),  # Delta / Ladner
    (49.1890, -122.8490),  # Surrey centre
]


# Normalize raw GasBuddy brand names to canonical versions — mirrors
# frontend/src/App.jsx's BRAND_ALIASES so city/brand filtering agrees
# with what the UI shows.
BRAND_ALIASES = {
    "CENTEX": "Centex", "Centex Gas": "Centex",
    "CO-OP": "Co-op", "CO-OP Cardlock": "Co-op", "Co-op Cardlock": "Co-op", "Co-Op": "Co-op",
    "Yellow Stores": "Yellow",
    "Husky Go!": "Husky", "HUSKY": "Husky",
    "ESSO": "Esso",
    "SHELL": "Shell",
    "CHEVRON": "Chevron",
    "Petro-Can": "Petro-Canada",
}


def normalize_brand(name: str) -> str:
    return BRAND_ALIASES.get(name, name) if name else name


CACHE_TTL = timedelta(hours=4)

_cache: dict = {"stations": None, "trends": None, "fetched_at": None}

# Prevents concurrent discovery + refresh scans (two Playwright sessions = rate-limit cascade)
_scan_lock = asyncio.Lock()

_lock = asyncio.Lock()

_scan_status: dict = {
    "running":        False,
    "mode":           None,   # "discovery" | "refresh"
    "zones_done":     0,
    "zones_total":    0,
    "stations_found": 0,
    "session":        0,
    "started_at":     None,
}


def get_scan_status() -> dict:
    return dict(_scan_status)


def warm_cache_from_db(stations: list):
    """Pre-populate the in-memory cache with DB data so startup is instant."""
    if stations:
        _cache["stations"]   = stations
        _cache["trends"]     = []
        _cache["fetched_at"] = datetime.now(timezone.utc) - timedelta(minutes=29)


_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_STEALTH_HEADERS = {
    "Sec-CH-UA":          '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="24"',
    "Sec-CH-UA-Mobile":   "?0",
    "Sec-CH-UA-Platform": '"macOS"',
}

_GQL = """
query locationBySearchTerm($lat: Float, $lng: Float) {
  locationBySearchTerm(lat: $lat, lng: $lng) {
    stations {
      results {
        id
        name
        address { line1 }
        latitude
        longitude
        fuels
        prices {
          credit { nickname postedTime price }
          cash   { price }
        }
      }
    }
    trends { areaName country today todayLow trend }
  }
}
"""

_JS_FETCH = """
async ({ query, operationName, lat, lng, gbcsrf }) => {
    try {
        const resp = await fetch('/graphql', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type':             'application/json',
                'Accept':                   '*/*',
                'apollo-require-preflight': 'true',
                'gbcsrf':                   gbcsrf,
            },
            body: JSON.stringify({
                operationName,
                query,
                variables: { lat, lng },
            }),
        });
        if (!resp.ok) {
            let body = '';
            try { body = await resp.text(); } catch (_) {}
            return { error: `HTTP ${resp.status}`, body: body.slice(0, 400) };
        }
        return await resp.json();
    } catch (e) {
        return { error: String(e) };
    }
}
"""


def _is_bc_station(lat, lng) -> bool:
    if lat is None or lng is None:
        return False
    if lat > 60.0 or lat < 48.2:
        return False
    if lng < -139.1 or lng > -114.0:
        return False
    if lat < 49.0 and lng > -123.3:
        return False
    return True


def _parse_station(raw: dict) -> dict:
    fuels  = raw.get("fuels") or []
    prices = raw.get("prices") or []

    addr = raw.get("address") or {}
    station: dict = {
        "station_id":      str(raw.get("id", "")),
        "name":            raw.get("name", f"Station #{raw.get('id','')}"),
        "address":         addr.get("line1", ""),
        "city":            addr.get("city", ""),
        "latitude":        raw.get("latitude"),
        "longitude":       raw.get("longitude"),
        "currency":        "CAD",
        "unit_of_measure": "cents_per_litre",
        "regular_gas":     None,
        "midgrade_gas":    None,
        "premium_gas":     None,
        "diesel":          None,
        "e85":             None,
    }

    for i, fuel_type in enumerate(fuels):
        if fuel_type not in station:
            continue
        price_block = prices[i] if i < len(prices) else {}
        credit = price_block.get("credit") or {}
        cash   = price_block.get("cash")   or {}
        if credit.get("price") is not None:
            station[fuel_type] = {
                "price":        credit["price"],
                "cash_price":   cash.get("price"),
                "credit":       credit.get("nickname"),
                "last_updated": credit.get("postedTime"),
            }

    return station


def _parse_trend(raw: dict) -> dict:
    return {
        "areaName": raw.get("areaName", ""),
        "country":  raw.get("country", ""),
        "today":    raw.get("today"),
        "todayLow": raw.get("todayLow"),
        "trend":    raw.get("trend", 0),
    }


# ── Poll constants ────────────────────────────────────────────────────────────
BATCH_SIZE     = 200   # zones per browser session before restarting
SESSION_BREAK  = 90    # seconds between browser sessions (discovery)
ZONE_SLEEP     = 6     # seconds between zone requests (discovery)
FLUSH_EVERY    = 10    # flush cache + DB every N zones (fast first-data delivery)

# Refresh mode — fewer total queries so sessions can be shorter
REFRESH_SESSION_BREAK = 60
REFRESH_ZONE_SLEEP    = 5


# ── Clustering for price refresh ──────────────────────────────────────────────

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km between two lat/lng points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def build_query_centers(stations: list[dict], radius_km: float = 2.0) -> list[tuple[float, float]]:
    """Greedy clustering: pick centers so every station is within radius_km of some center.

    For ~991 stations at 2 km radius this produces ~66–150 centers,
    reducing price refresh from 2189 zones to ~100 queries.
    """
    coords = [(s["latitude"], s["longitude"]) for s in stations
              if s.get("latitude") is not None and s.get("longitude") is not None]
    uncovered = list(range(len(coords)))
    centers: list[tuple[float, float]] = []

    while uncovered:
        seed_idx = uncovered[0]
        slat, slng = coords[seed_idx]
        cluster = [i for i in uncovered if _haversine_km(slat, slng, *coords[i]) <= radius_km]
        lats = [coords[i][0] for i in cluster]
        lngs = [coords[i][1] for i in cluster]
        centers.append((sum(lats) / len(lats), sum(lngs) / len(lngs)))
        covered = set(cluster)
        uncovered = [i for i in uncovered if i not in covered]

    return centers


# ── Core Playwright scanner ───────────────────────────────────────────────────

async def _start_browser_session(pw):
    """Launch browser, navigate to GasBuddy, return (browser, page, token)."""
    browser = await pw.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )
    context = await browser.new_context(
        user_agent=_UA,
        viewport={"width": 1280, "height": 800},
        locale="en-CA",
        extra_http_headers=_STEALTH_HEADERS,
    )
    await context.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
    )
    page = await context.new_page()
    gbcsrf_token = ""

    def on_request(req):
        nonlocal gbcsrf_token
        if "/graphql" in req.url and not gbcsrf_token:
            gbcsrf_token = req.headers.get("gbcsrf", "")

    page.on("request", on_request)

    try:
        await page.goto("https://www.gasbuddy.com", wait_until="networkidle", timeout=60_000)
    except Exception as e:
        logger.warning("Homepage load warning: %s", e)

    if not gbcsrf_token:
        cookies = await context.cookies("https://www.gasbuddy.com")
        for c in cookies:
            if c.get("name", "").lower() == "gbcsrf":
                gbcsrf_token = c["value"]
                break

    if not gbcsrf_token:
        try:
            await page.goto(
                "https://www.gasbuddy.com/gas-prices/canada/british-columbia",
                wait_until="networkidle", timeout=60_000,
            )
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("BC page load warning: %s", e)

    logger.info("Session ready — gbcsrf: %s", gbcsrf_token[:8] + "…" if gbcsrf_token else "(none)")
    return browser, page, gbcsrf_token


async def _fetch_via_playwright(
    coords: list[tuple[float, float]],
    on_flush=None,
    *,
    zone_sleep: float = ZONE_SLEEP,
    session_break: float = SESSION_BREAK,
    mode: str = "scan",
) -> tuple[list[dict], list[dict]]:
    stations_map: dict[str, dict] = {}
    trends: list[dict] = []
    total = len(coords)

    _scan_status.update({
        "running": True, "mode": mode,
        "zones_done": 0, "zones_total": total,
        "stations_found": 0, "session": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    })
    print(f"[{mode}] starting — {total} zones", flush=True)

    try:
        async with async_playwright() as pw:
            i = 0
            session_num = 0

            while i < total:
                batch_end = min(i + BATCH_SIZE, total)
                session_num += 1
                _scan_status["session"] = session_num
                logger.info("[%s] session %d — zones %d–%d of %d",
                            mode, session_num, i + 1, batch_end, total)

                browser, page, gbcsrf_token = await _start_browser_session(pw)
                print(f"[{mode}] session {session_num} ready — gbcsrf: {'ok' if gbcsrf_token else 'MISSING'}", flush=True)
                consecutive_errors = 0

                for j in range(i, batch_end):
                    if j > i:
                        await asyncio.sleep(zone_sleep)

                    lat, lng = coords[j]
                    try:
                        result = await page.evaluate(
                            _JS_FETCH, {
                                "query": _GQL,
                                "operationName": "locationBySearchTerm",
                                "lat": lat, "lng": lng,
                                "gbcsrf": gbcsrf_token,
                            }
                        )
                    except Exception as e:
                        logger.warning("[%s] evaluate error at zone %d: %s", mode, j + 1, e)
                        consecutive_errors += 1
                        continue

                    if not isinstance(result, dict) or "error" in result:
                        err = (result or {}).get("error", "") if isinstance(result, dict) else str(result)
                        if "429" in str(err):
                            consecutive_errors += 1
                            backoff = min(120, 30 * consecutive_errors)
                            logger.warning("[%s] 429 rate-limited at zone %d — backoff %ds",
                                          mode, j + 1, backoff)
                            await asyncio.sleep(backoff)
                        elif "403" in str(err):
                            logger.warning("[%s] 403 session blocked at zone %d — restarting session",
                                          mode, j + 1)
                            batch_end = j  # end this batch here, restart session
                            break
                        else:
                            # Log every unhandled error so we can see what GasBuddy is returning
                            body = result.get("body", "") if isinstance(result, dict) else ""
                            logger.warning("[%s] zone %d error (consecutive=%d): %r body=%s",
                                          mode, j + 1, consecutive_errors + 1, err, body or "(empty)")
                            consecutive_errors += 1
                        _scan_status["zones_done"] = j + 1
                        continue

                    consecutive_errors = 0
                    loc          = (result.get("data") or {}).get("locationBySearchTerm") or {}
                    raw_stations = (loc.get("stations") or {}).get("results") or []
                    raw_trends   = loc.get("trends") or []

                    before = len(stations_map)
                    for s in raw_stations:
                        sid = str(s.get("id", ""))
                        if sid and sid not in stations_map:
                            parsed = _parse_station(s)
                            country = parsed.get("country", "")
                            if country and country.upper() not in ("CA", "CAN", "CANADA"):
                                continue
                            if not country and not _is_bc_station(parsed["latitude"], parsed["longitude"]):
                                continue
                            stations_map[sid] = parsed

                    if not trends and raw_trends:
                        trends.extend(_parse_trend(t) for t in raw_trends)

                    added = len(stations_map) - before
                    pct   = (j + 1) / total * 100
                    _scan_status["zones_done"]     = j + 1
                    _scan_status["stations_found"] = len(stations_map)
                    if added > 0 or (j + 1) % 50 == 0:
                        logger.info("[%s] %5.1f%% — zone %d/%d: +%d new → %d total stations",
                                    mode, pct, j + 1, total, added, len(stations_map))

                    # Progressive flush every FLUSH_EVERY zones
                    if (j + 1) % FLUSH_EVERY == 0 or (j + 1) == total:
                        snapshot = list(stations_map.values())
                        existing = {s["station_id"]: s for s in (_cache.get("stations") or [])}
                        for s in snapshot:
                            existing[s["station_id"]] = _merge_station(existing.get(s["station_id"]), s)
                        merged = list(existing.values())
                        _cache["stations"]   = merged
                        _cache["trends"]     = trends or []
                        _cache["fetched_at"] = datetime.now(timezone.utc)
                        if on_flush:
                            on_flush(snapshot)
                        logger.info("[%s] flush — %d scanned / %d total in cache",
                                    mode, len(snapshot), len(merged))

                await browser.close()
                i = batch_end

                if i < total:
                    logger.info("[%s] session break — %ds before next session", mode, session_break)
                    await asyncio.sleep(session_break)

    finally:
        _scan_status["running"] = False

    logger.info("[%s] done — %d stations, %d trends", mode, len(stations_map), len(trends))
    return list(stations_map.values()), trends


# ── Public API ────────────────────────────────────────────────────────────────

async def discover_stations(on_flush=None) -> tuple[list[dict], list[dict]]:
    """Full grid scan across all of BC — finds new/unknown stations.
    Runs daily. Returns (stations, trends).
    """
    if _scan_lock.locked():
        logger.warning("discover_stations: scan already in progress — skipping")
        return _cache.get("stations") or [], _cache.get("trends") or []

    async with _scan_lock:
        logger.info("discover_stations: scanning %d zones …", len(SEARCH_COORDS))
        stations, trends = await _fetch_via_playwright(
            SEARCH_COORDS, on_flush,
            zone_sleep=ZONE_SLEEP,
            session_break=SESSION_BREAK,
            mode="discovery",
        )
        _cache["stations"]   = stations
        _cache["trends"]     = trends
        _cache["fetched_at"] = datetime.now(timezone.utc)
        return stations, trends


async def refresh_prices(known_stations: list[dict], on_flush=None) -> tuple[list[dict], list[dict]]:
    """Fast price refresh using cluster centers derived from known station locations.
    Runs every 30 min. Much fewer queries than full discovery.
    """
    if _scan_lock.locked():
        logger.warning("refresh_prices: scan already in progress — skipping this cycle")
        return _cache.get("stations") or [], _cache.get("trends") or []

    async with _scan_lock:
        cluster_centers = build_query_centers(known_stations)
        # Always include named anchors so areas without known stations
        # (e.g. Squamish, Whistler, Northern BC) are still refreshed.
        anchor_set = {(round(c[0], 3), round(c[1], 3)) for c in cluster_centers}
        extra_anchors = [c for c in ANCHOR_COORDS
                         if (round(c[0], 3), round(c[1], 3)) not in anchor_set]
        centers = cluster_centers + extra_anchors
        logger.info(
            "refresh_prices: %d known stations → %d cluster centers + %d anchors = %d total",
            len(known_stations), len(cluster_centers), len(extra_anchors), len(centers),
        )
        stations, trends = await _fetch_via_playwright(
            centers, on_flush,
            zone_sleep=REFRESH_ZONE_SLEEP,
            session_break=REFRESH_SESSION_BREAK,
            mode="refresh",
        )
        # Merge refreshed stations into the existing cache rather than replacing.
        # A refresh scan covers fewer zones than discovery so we must not discard
        # stations that weren't in the refresh radius.
        existing = {s["station_id"]: s for s in (_cache.get("stations") or [])}
        for s in stations:
            existing[s["station_id"]] = _merge_station(existing.get(s["station_id"]), s)
        merged = list(existing.values())
        if merged:
            _cache["stations"]   = merged
            _cache["trends"]     = trends or _cache.get("trends") or []
            _cache["fetched_at"] = datetime.now(timezone.utc)
        return merged, _cache.get("trends") or []


def get_cache_snapshot() -> tuple[list[dict], list[dict]]:
    """Return whatever is currently cached (may be empty list). Never blocks."""
    return _cache.get("stations") or [], _cache.get("trends") or []


def get_station_by_id(station_id: str) -> dict | None:
    stations, _ = get_cache_snapshot()
    return next((s for s in stations if s["station_id"] == station_id), None)


def _merge_station(old: dict | None, new: dict) -> dict:
    """Merge a freshly-scanned station into the cache, preserving fields the
    live GraphQL response never carries (e.g. the reverse-geocoded city) so
    a price refresh doesn't wipe out data we backfilled separately.
    """
    if old and old.get("city") and not new.get("city"):
        return {**new, "city": old["city"]}
    return new
