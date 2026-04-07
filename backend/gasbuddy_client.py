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

# search zones covering Greater Vancouver
SEARCH_COORDS = [
    # Vancouver
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver / Mount Pleasant
    (49.2300, -123.1500),  # Vancouver West Side (Kitsilano, Marpole)
    # North Shore
    (49.3163, -123.0724),  # North Vancouver
    (49.3667, -123.1670),  # West Vancouver
    # Burnaby / New Westminster
    (49.2488, -122.9805),  # Burnaby West
    (49.2650, -122.9200),  # Burnaby East
    (49.2057, -122.9110),  # New Westminster
    # Richmond / Delta
    (49.2045, -123.1116),  # Richmond North
    (49.1700, -123.1380),  # Richmond Central
    (49.0900, -123.0800),  # Delta (Ladner / Tsawwassen)
    # Surrey / White Rock / Langley
    (49.1045, -122.8490),  # Surrey Central
    (49.1600, -122.8450),  # Surrey North
    (49.0253, -122.8027),  # White Rock
    (49.1050, -122.6604),  # Langley City
    (49.1900, -122.6800),  # Langley Township
    # Tri-Cities
    (49.2837, -122.8310),  # Coquitlam
    (49.2607, -122.7800),  # Port Coquitlam
    (49.2834, -122.8319),  # Port Moody
    # Pitt Meadows / Maple Ridge
    (49.2320, -122.6890),  # Pitt Meadows
    (49.2200, -122.5980),  # Maple Ridge
]

CACHE_TTL = timedelta(minutes=30)

_cache: dict = {"stations": None, "trends": None, "fetched_at": None}
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
        address { line1 city state country }
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

    addr = raw.get("address") or {}
    station: dict = {
        "station_id":      str(raw.get("id", "")),
        "name":            raw.get("name", f"Station #{raw.get('id','')}"),
        "address":         addr.get("line1", ""),
        "city":            addr.get("city", ""),
        "province":        addr.get("state", ""),
        "country":         addr.get("country", ""),
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
                await asyncio.sleep(8)  # avoid 429 rate limiting

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

            for s in raw_stations:
                sid = str(s.get("id", ""))
                if sid and sid not in stations_map:
                    parsed = _parse_station(s)
                    # Filter by country if available, fall back to coordinate check
                    country = parsed.get("country", "")
                    if country and country.upper() not in ("CA", "CAN", "CANADA"):
                        continue
                    if not country and not _is_bc_station(parsed["latitude"], parsed["longitude"]):
                        continue
                    stations_map[sid] = parsed

            if not trends and raw_trends:
                trends.extend(_parse_trend(t) for t in raw_trends)

            logger.info("  -> %d stations, total unique: %d", len(raw_stations), len(stations_map))

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
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]
