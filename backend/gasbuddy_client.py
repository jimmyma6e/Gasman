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

# ── search zones covering all of British Columbia ────────────────────────────
SEARCH_COORDS = [
    # Greater Vancouver
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver
    (49.3163, -123.0724),  # North Vancouver
    (49.2045, -123.1116),  # Richmond
    (49.2488, -122.9805),  # Burnaby / New Westminster
    # Lower Mainland extensions
    (49.1913, -122.8490),  # Surrey
    (49.1044, -122.6604),  # Langley
    (49.0504, -122.3045),  # Abbotsford
    (49.1579, -121.9514),  # Chilliwack
    (49.3828, -121.4455),  # Hope
    # Vancouver Island
    (48.4284, -123.3656),  # Victoria
    (49.1659, -123.9401),  # Nanaimo
    (49.6878, -124.9944),  # Courtenay / Comox
    (50.0162, -125.2477),  # Campbell River
    # Sea-to-Sky / Sunshine Coast
    (49.7016, -123.1558),  # Squamish
    (50.1163, -122.9574),  # Whistler
    (49.8326, -124.5248),  # Powell River
    # Okanagan
    (49.8880, -119.4960),  # Kelowna
    (49.4988, -119.5869),  # Penticton
    (50.2674, -119.2720),  # Vernon
    # Thompson / Interior
    (50.6745, -120.3273),  # Kamloops
    (50.1115, -120.7862),  # Merritt
    # Kootenays
    (49.4926, -117.2948),  # Nelson
    (49.5122, -115.7697),  # Cranbrook
    (49.0960, -117.7122),  # Trail / Castlegar
    # Central BC
    (52.1396, -122.1414),  # Williams Lake
    (52.9784, -122.4927),  # Quesnel
    (53.9166, -122.7497),  # Prince George
    # Northern BC
    (54.7825, -127.1776),  # Smithers
    (54.5149, -128.5989),  # Terrace
    (54.3150, -130.3208),  # Prince Rupert
    (56.2518, -120.8476),  # Fort St. John
    (58.8044, -122.6980),  # Fort Nelson
]


def _is_bc_station(lat, lng) -> bool:
    """Return True if coordinates fall within British Columbia, Canada."""
    if lat is None or lng is None:
        return True  # keep if no coords
    if not (48.2 <= lat <= 60.1):
        return False
    if not (-139.5 <= lng <= -114.0):
        return False
    # Exclude US Pacific Northwest near the border (Bellingham, Blaine, etc.)
    # Victoria BC (48.43, -123.37) must pass: it's west of -123.1 so it's fine
    if lat < 49.0 and lng > -123.1:
        return False
    return True

CACHE_TTL = timedelta(minutes=30)

# ── in-memory cache ───────────────────────────────────────────────────────────
_cache: dict = {"stations": None, "trends": None, "fetched_at": None}
_lock = asyncio.Lock()

# ── browser config ────────────────────────────────────────────────────────────
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_STEALTH_HEADERS = {
    "Sec-CH-UA":          '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="24"',
    "Sec-CH-UA-Mobile":   "?0",
    "Sec-CH-UA-Platform": '"macOS"',
}

# ── GraphQL query ─────────────────────────────────────────────────────────────
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

# JS runs inside the browser — same-origin fetch avoids Cloudflare WAF
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


# ── station parser ────────────────────────────────────────────────────────────
def _parse_station(raw: dict) -> dict:
    fuels  = raw.get("fuels") or []
    prices = raw.get("prices") or []

    station: dict = {
        "station_id":      str(raw.get("id", "")),
        "name":            raw.get("name", f"Station #{raw.get('id','')}"),
        "address":         (raw.get("address") or {}).get("line1", "Vancouver, BC"),
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


# ── main fetch ────────────────────────────────────────────────────────────────
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

        # Capture the gbcsrf CSRF token from GasBuddy's own first /graphql call
        async def on_request(req):
            nonlocal gbcsrf_token
            if "/graphql" in req.url and not gbcsrf_token:
                gbcsrf_token = req.headers.get("gbcsrf", "")

        page.on("request", on_request)

        logger.info("Loading https://www.gasbuddy.com …")
        try:
            await page.goto("https://www.gasbuddy.com", wait_until="networkidle", timeout=60_000)
        except Exception as e:
            logger.warning("Homepage load warning: %s", e)

        logger.info("Captured gbcsrf token: %s", gbcsrf_token or "(none)")

        # Query each zone
        for lat, lng in SEARCH_COORDS:
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
                    if _is_bc_station(parsed.get("latitude"), parsed.get("longitude")):
                        stations_map[sid] = parsed

            if not trends and raw_trends:
                trends.extend(_parse_trend(t) for t in raw_trends)

            logger.info("  → %d stations, total unique: %d", len(raw_stations), len(stations_map))

        await browser.close()

    stations = list(stations_map.values())
    stations.sort(key=lambda x: (
        x.get("regular_gas") is None or (x["regular_gas"] or {}).get("price") is None,
        (x.get("regular_gas") or {}).get("price") or float("inf"),
    ))
    logger.info("Done: %d stations, %d trends", len(stations), len(trends))
    return stations, trends


# ── cache ─────────────────────────────────────────────────────────────────────
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


# ── public API ────────────────────────────────────────────────────────────────
async def search_nearby(lat: float, lon: float) -> tuple[list[dict], list[dict]]:
    """API-compat shim — lat/lon ignored, full Vancouver fetched in one pass."""
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]


async def get_all_bc() -> tuple[list[dict], list[dict]]:
    """Return (stations, trends) for all of British Columbia, cached 30 min."""
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]


# backward-compat alias
get_all_vancouver = get_all_bc
