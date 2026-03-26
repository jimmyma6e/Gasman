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

# ── search zones covering Greater Vancouver ───────────────────────────────────
SEARCH_COORDS = [
    (49.2827, -123.1207),  # Downtown Vancouver
    (49.2640, -123.0586),  # East Vancouver
    (49.3163, -123.0724),  # North Vancouver
    (49.2045, -123.1116),  # Richmond / South Van
    (49.2488, -122.9805),  # Burnaby
]

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
                    stations_map[sid] = _parse_station(s)

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


async def get_all_vancouver() -> tuple[list[dict], list[dict]]:
    """Return (stations, trends) for Greater Vancouver, cached 30 min."""
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]
