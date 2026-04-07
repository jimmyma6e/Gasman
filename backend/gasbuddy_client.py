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

# search zones covering British Columbia
SEARCH_COORDS = [
    # --- Metro Vancouver: Vancouver ---
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver / Mount Pleasant
    (49.2300, -123.1500),  # Vancouver West Side (Kitsilano)
    (49.2100, -123.1400),  # Marpole / South Vancouver
    (49.2450, -123.1800),  # Kerrisdale / Oakridge
    # --- Metro Vancouver: North Shore ---
    (49.3163, -123.0724),  # North Vancouver Central
    (49.3400, -123.0200),  # North Vancouver East (Lynn Valley)
    (49.3667, -123.1670),  # West Vancouver
    # --- Metro Vancouver: Burnaby ---
    (49.2650, -122.9200),  # Burnaby North / Brentwood
    (49.2488, -122.9805),  # Burnaby West / Metrotown
    (49.2200, -122.9600),  # South Burnaby / Big Bend
    # --- Metro Vancouver: New Westminster / Coquitlam ---
    (49.2057, -122.9110),  # New Westminster
    (49.2837, -122.8310),  # Coquitlam
    (49.2607, -122.7800),  # Port Coquitlam
    (49.2834, -122.8319),  # Port Moody
    # --- Metro Vancouver: Richmond / Delta ---
    (49.2045, -123.1116),  # Richmond North
    (49.1700, -123.1380),  # Richmond Central / South
    (49.0900, -123.0800),  # Delta (Ladner / Tsawwassen)
    (49.1300, -123.0500),  # North Delta
    # --- Metro Vancouver: Surrey / White Rock ---
    (49.1045, -122.8490),  # Surrey Central / Whalley
    (49.1600, -122.8450),  # Surrey North / Guildford
    (49.0700, -122.8200),  # Surrey South / Cloverdale
    (49.0253, -122.8027),  # White Rock / South Surrey
    # --- Metro Vancouver: Langley ---
    (49.1050, -122.6604),  # Langley City
    (49.1900, -122.6800),  # Langley Township / Walnut Grove
    (49.0700, -122.6000),  # Aldergrove
    # --- Pitt Meadows / Maple Ridge ---
    (49.2320, -122.6890),  # Pitt Meadows
    (49.2200, -122.5980),  # Maple Ridge West
    (49.2100, -122.5000),  # Maple Ridge East
    # --- Sea to Sky ---
    (49.7016, -123.1558),  # Squamish
    (50.1163, -122.9574),  # Whistler
    (49.4400, -123.2800),  # Gibsons / Sechelt (Sunshine Coast)
    # --- Fraser Valley ---
    (49.1330, -122.3050),  # Mission
    (49.0504, -122.3045),  # Abbotsford West
    (49.0200, -122.1500),  # Abbotsford East
    (49.1579, -121.9514),  # Chilliwack West
    (49.1700, -121.7500),  # Chilliwack East
    (49.3837, -121.4419),  # Hope
    # --- Vancouver Island ---
    (48.4284, -123.3656),  # Victoria Downtown
    (48.4500, -123.4700),  # Langford / Colwood
    (48.5081, -123.4169),  # Saanich / Sidney
    (49.1659, -123.9401),  # Nanaimo
    (49.3000, -124.3100),  # Parksville / Qualicum
    (49.6870, -124.9901),  # Courtenay / Comox
    (50.0163, -125.2445),  # Campbell River
    (48.8267, -124.0281),  # Port Alberni
    # --- Okanagan ---
    (49.8880, -119.4960),  # Kelowna
    (49.9600, -119.3800),  # Lake Country / Winfield
    (50.2674, -119.2720),  # Vernon
    (49.4991, -119.5937),  # Penticton
    (49.1783, -119.5919),  # Oliver / Osoyoos
    (49.3300, -119.6500),  # Summerland / Naramata
    # --- Thompson / Kamloops ---
    (50.6745, -120.3273),  # Kamloops
    (50.7500, -120.3800),  # Kamloops North
    (50.9250, -118.7717),  # Salmon Arm
    (51.3000, -120.1400),  # Clearwater area
    # --- Kootenays ---
    (49.4926, -117.2948),  # Nelson
    (49.0956, -117.7097),  # Trail / Castlegar
    (49.5198, -115.7697),  # Cranbrook
    (49.5100, -114.9700),  # Fernie
    # --- Northern BC ---
    (53.9166, -122.7497),  # Prince George
    (54.0133, -124.2484),  # Vanderhoof / Burns Lake
    (54.7700, -127.1800),  # Smithers
    (54.5168, -128.5975),  # Terrace
    (54.3150, -130.3208),  # Prince Rupert
    (56.2518, -120.8476),  # Fort St. John
    (55.7596, -120.2388),  # Dawson Creek
    (58.8050, -122.6978),  # Fort Nelson
]

CACHE_TTL = timedelta(minutes=15)

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


async def _fetch_via_playwright() -> tuple[list[dict], list[dict]]:
    stations_map: dict[str, dict] = {}
    trends: list[dict] = []
    gbcsrf_token: str = ""

    async with async_playwright() as pw:
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

        async def on_request(req):
            nonlocal gbcsrf_token
            if "/graphql" in req.url and not gbcsrf_token:
                gbcsrf_token = req.headers.get("gbcsrf", "")

        page.on("request", on_request)

        logger.info("Loading GasBuddy to capture gbcsrf token …")
        try:
            await page.goto(
                "https://www.gasbuddy.com",
                wait_until="networkidle",
                timeout=60_000,
            )
        except Exception as e:
            logger.warning("Homepage load warning: %s", e)

        # Try to get gbcsrf from cookies (most reliable method)
        if not gbcsrf_token:
            cookies = await context.cookies("https://www.gasbuddy.com")
            for c in cookies:
                if c.get("name", "").lower() == "gbcsrf":
                    gbcsrf_token = c["value"]
                    logger.info("Got gbcsrf from cookie: %s", gbcsrf_token[:8] + "…")
                    break

        # Fallback: navigate to BC page to trigger GraphQL request interception
        if not gbcsrf_token:
            try:
                await page.goto(
                    "https://www.gasbuddy.com/gas-prices/canada/british-columbia",
                    wait_until="networkidle",
                    timeout=60_000,
                )
                await asyncio.sleep(3)
            except Exception as e:
                logger.warning("BC page load warning: %s", e)

        logger.info("Captured gbcsrf token: %s", gbcsrf_token or "(none)")

        for i, (lat, lng) in enumerate(SEARCH_COORDS):
            if i > 0:
                await asyncio.sleep(3)  # avoid 429 rate limiting

            logger.info("  /graphql for (%.4f, %.4f) …", lat, lng)
            try:
                result = await page.evaluate(
                    _JS_FETCH, {"query": _GQL, "lat": lat, "lng": lng, "gbcsrf": gbcsrf_token}
                )
            except Exception as e:
                logger.warning("  evaluate error: %s", e)
                continue

            if not isinstance(result, dict) or "error" in result:
                logger.warning("  error: %s", result)
                continue

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
            print(f"  zone {i+1}/{len(SEARCH_COORDS)} ({lat:.2f},{lng:.2f}): {len(raw_stations)} raw, +{added} new, total={len(stations_map)}")

        await browser.close()

    stations = list(stations_map.values())
    stations.sort(key=lambda x: (
        x.get("regular_gas") is None or (x["regular_gas"] or {}).get("price") is None,
        (x.get("regular_gas") or {}).get("price") or float("inf"),
    ))
    logger.info("Done: %d stations, %d trends", len(stations), len(trends))
    return stations, trends


async def _ensure_fresh() -> None:
    now = datetime.now(timezone.utc)
    if (
        _cache["stations"] is None
        or _cache["fetched_at"] is None
        or now - _cache["fetched_at"] > CACHE_TTL
    ):
        stations, trends = await _fetch_via_playwright()
        _cache["stations"]   = stations
        _cache["trends"]     = trends
        _cache["fetched_at"] = now


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
