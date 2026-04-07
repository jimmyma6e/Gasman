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
  4. Query 5 lat/lng zones covering Greater Vancouver, deduplicate, cache 30 min.

Schema notes (discovered by inspection):
  - `fuels`  is an array of fuel-type strings: ["regular_gas", "midgrade_gas", ...]
  - `prices` is a parallel array:              [{"credit":{"price":203.9}}, ...]
  - prices[i] corresponds to fuels[i]
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)

def _build_search_coords() -> list:
    coords = []

    def grid(lat_min, lat_max, lng_min, lng_max, km):
        """Generate a lat/lng grid with given spacing in km."""
        lat_step = km / 111.0
        lng_step = km / (111.0 * __import__("math").cos(__import__("math").radians((lat_min + lat_max) / 2)))
        lat = lat_min
        while lat <= lat_max + lat_step * 0.5:
            lng = lng_min
            while lng <= lng_max + lng_step * 0.5:
                coords.append((round(lat, 4), round(lng, 4)))
                lng += lng_step
            lat += lat_step

    # Metro Vancouver — 1.5 km grid (~1440 points, comprehensive)
    grid(49.00, 49.42, -123.35, -122.45, 1.5)

    # Fraser Valley — 5 km grid (~130 points)
    grid(49.00, 49.45, -122.45, -121.00, 5.0)

    # Sea to Sky corridor — targeted
    coords += [
        (49.4400, -123.2800),  # Gibsons
        (49.7016, -123.1558),  # Squamish
        (50.1163, -122.9574),  # Whistler
    ]

    # Vancouver Island — 8 km grid
    grid(48.30, 49.00, -124.50, -123.25, 8.0)
    coords += [
        (49.1659, -123.9401),  # Nanaimo
        (49.3000, -124.3100),  # Parksville / Qualicum
        (49.6870, -124.9901),  # Courtenay / Comox
        (50.0163, -125.2445),  # Campbell River
    ]

    # Okanagan — 5 km grid (~80 points)
    grid(49.00, 50.40, -119.80, -119.10, 5.0)
    coords += [
        (49.1783, -119.5919),  # Oliver / Osoyoos
    ]

    # Thompson / Kamloops — targeted
    coords += [
        (50.6745, -120.3273),  # Kamloops
        (50.7500, -120.3800),  # Kamloops North
        (50.9250, -118.7717),  # Salmon Arm
    ]

    # Kootenays — targeted
    coords += [
        (49.4926, -117.2948),  # Nelson
        (49.0956, -117.7097),  # Trail / Castlegar
        (49.5198, -115.7697),  # Cranbrook
        (49.5100, -114.9700),  # Fernie
    ]

    # Northern BC — targeted
    coords += [
        (53.9166, -122.7497),  # Prince George
        (54.0133, -124.2484),  # Vanderhoof / Burns Lake
        (54.7700, -127.1800),  # Smithers
        (54.5168, -128.5975),  # Terrace
        (54.3150, -130.3208),  # Prince Rupert
        (56.2518, -120.8476),  # Fort St. John
        (55.7596, -120.2388),  # Dawson Creek
        (58.8050, -122.6978),  # Fort Nelson
    ]

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

CACHE_TTL = timedelta(hours=4)

_cache: dict = {"stations": None, "trends": None, "fetched_at": None}


def warm_cache_from_db(stations: list):
    """Pre-populate the in-memory cache with DB data so startup is instant."""
    if stations:
        _cache["stations"]   = stations
        _cache["trends"]     = []
        _cache["fetched_at"] = datetime.now(timezone.utc) - timedelta(minutes=29)
_lock = asyncio.Lock()

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
async ({ query, lat, lng, gbcsrf }) => {
    try {
        const resp = await fetch('/graphql', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type':           'application/json',
                'Accept':                 '*/*',
                'apollo-require-preflight': 'true',
                'gbcsrf':                 gbcsrf,
                'referer':                'https://www.gasbuddy.com/',
            },
            body: JSON.stringify({
                query,
                variables: { lat, lng },
            }),
        });
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        return await resp.json();
    } catch (e) {
        return { error: String(e) };
    }
}
"""


def _is_bc_station(lat, lng) -> bool:
    """Return True only if coordinates fall within British Columbia.

    BC mainland border with Washington State is at 49°N.
    Vancouver Island/Gulf Islands extend south to ~48.2°N but are west of -123.3°W.
    """
    if lat is None or lng is None:
        return False
    if lat > 60.0 or lat < 48.2:
        return False
    if lng < -139.1 or lng > -114.0:
        return False
    # Below 49°N only allow Vancouver Island / Gulf Islands (west of Strait of Georgia)
    if lat < 49.0 and lng > -123.3:
        return False
    return True


def _parse_station(raw: dict) -> dict:
    fuels  = raw.get("fuels") or []
    prices = raw.get("prices") or []

    addr = (raw.get("address") or {}).get("line1", "")
    station: dict = {
        "station_id":      str(raw.get("id", "")),
        "name":            raw.get("name", f"Station #{raw.get('id','')}"),
        "address":         addr,
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


BATCH_SIZE     = 200   # zones per browser session before restarting
SESSION_BREAK  = 90    # seconds to wait between browser sessions
ZONE_SLEEP     = 6     # seconds between zone requests within a session
FLUSH_EVERY    = 50    # flush cache + DB every N zones


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


async def _fetch_via_playwright(on_flush=None) -> tuple[list[dict], list[dict]]:
    stations_map: dict[str, dict] = {}
    trends: list[dict] = []
    total = len(SEARCH_COORDS)

    async with async_playwright() as pw:
        i = 0
        session_num = 0

        while i < total:
            batch_end = min(i + BATCH_SIZE, total)
            session_num += 1
            print(f"  [session {session_num}] zones {i+1}–{batch_end} of {total}")

            browser, page, gbcsrf_token = await _start_browser_session(pw)
            consecutive_errors = 0

            for j in range(i, batch_end):
                if j > i:
                    await asyncio.sleep(ZONE_SLEEP)

                lat, lng = SEARCH_COORDS[j]
                try:
                    result = await page.evaluate(
                        _JS_FETCH, {"query": _GQL, "lat": lat, "lng": lng, "gbcsrf": gbcsrf_token}
                    )
                except Exception as e:
                    logger.warning("  evaluate error: %s", e)
                    consecutive_errors += 1
                    continue

                if not isinstance(result, dict) or "error" in result:
                    err = (result or {}).get("error", "") if isinstance(result, dict) else str(result)
                    if "429" in str(err):
                        consecutive_errors += 1
                        backoff = min(120, 30 * consecutive_errors)
                        print(f"  [429] rate limited — backing off {backoff}s (zone {j+1})")
                        await asyncio.sleep(backoff)
                        continue
                    if "403" in str(err):
                        print(f"  [403] session blocked at zone {j+1} — restarting session early")
                        batch_end = j  # end this batch here, restart session
                        break
                    consecutive_errors += 1
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
                if added > 0 or (j + 1) % 100 == 0:
                    print(f"  [{pct:5.1f}%] zone {j+1}/{total}: +{added} new → {len(stations_map)} total")

                # Progressive flush every FLUSH_EVERY zones
                if (j + 1) % FLUSH_EVERY == 0 or (j + 1) == total:
                    snapshot = list(stations_map.values())
                    _cache["stations"]   = snapshot
                    _cache["trends"]     = trends or []
                    _cache["fetched_at"] = datetime.now(timezone.utc)
                    if on_flush:
                        on_flush(snapshot)
                    print(f"  [flush] {len(snapshot)} stations → cache + DB")

            await browser.close()
            i = batch_end

            # Break between sessions so GasBuddy doesn't flag us
            if i < total:
                print(f"  [session break] {SESSION_BREAK}s before next session …")
                await asyncio.sleep(SESSION_BREAK)

    logger.info("Done: %d stations, %d trends", len(stations_map), len(trends))
    return list(stations_map.values()), trends


async def _ensure_fresh() -> None:
    now = datetime.now(timezone.utc)
    if (
        _cache["stations"] is None
        or _cache["fetched_at"] is None
        or now - _cache["fetched_at"] > CACHE_TTL
    ):
        await _fetch_via_playwright()


async def search_nearby(lat: float, lon: float) -> tuple[list[dict], list[dict]]:
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]


async def get_all_vancouver() -> tuple[list[dict], list[dict]]:
    # Return cached data immediately if available (even if stale — background poll will refresh)
    if _cache["stations"] is not None:
        return _cache["stations"], _cache["trends"] or []
    # No cache yet — must wait for first poll
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]
