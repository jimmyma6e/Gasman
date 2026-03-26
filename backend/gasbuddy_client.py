"""
GasBuddy client — Playwright + page.evaluate() strategy.

Problem: GasBuddy's /graphql is protected by a Cloudflare WAF that blocks
all automated HTTP requests (even with proper cookies / TLS impersonation).

Solution:
  1. Launch headless Chromium with stealth headers (hides HeadlessChrome from
     Sec-CH-UA, patches navigator.webdriver) so GasBuddy's CDN serves the
     real Next.js app rather than the legacy 404 fallback.
  2. Navigate to https://www.gasbuddy.com (the homepage loads fine).
  3. Use page.evaluate() to call fetch('/graphql', ...) from *inside* the
     browser — this is a same-origin request that Cloudflare treats as
     legitimate JS and lets through.
  4. Repeat for 5 Vancouver lat/lng zones, merge results, cache 30 min.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta

from playwright.async_playwright import async_playwright

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

# ── Playwright stealth settings ───────────────────────────────────────────────
_STEALTH_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
_STEALTH_HEADERS = {
    "Sec-CH-UA": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
}

# ── GraphQL query ─────────────────────────────────────────────────────────────
_GQL_QUERY = """
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
          cash   { nickname postedTime price }
        }
      }
    }
    trends {
      areaName
      country
      today
      todayLow
      trend
    }
  }
}
"""

# JavaScript run inside the browser to call /graphql from the gasbuddy.com origin
_JS_FETCH = """
async ({ query, lat, lng }) => {
    try {
        const resp = await fetch('/graphql', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ query, variables: { lat, lng } }),
        });
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        return await resp.json();
    } catch (e) {
        return { error: String(e) };
    }
}
"""

# ── fuel map ──────────────────────────────────────────────────────────────────
FUEL_MAP = {1: "regular_gas", 2: "midgrade_gas", 3: "premium_gas", 4: "diesel", 5: "e85"}


# ── parsers ───────────────────────────────────────────────────────────────────
def _parse_price(raw: dict | None) -> dict | None:
    if not raw or raw.get("price") is None:
        return None
    return {
        "price":        raw.get("price"),
        "cash_price":   None,
        "credit":       raw.get("nickname"),
        "last_updated": raw.get("postedTime"),
    }


def _parse_station(raw: dict) -> dict:
    prices    = raw.get("prices") or {}
    cr        = _parse_price(prices.get("credit"))
    cash_raw  = prices.get("cash") or {}
    if cr and cash_raw.get("price") is not None:
        cr["cash_price"] = cash_raw["price"]

    fuels    = raw.get("fuels") or []
    fuel_key = FUEL_MAP.get(fuels[0], "regular_gas") if fuels else "regular_gas"

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
    if cr:
        station[fuel_key] = cr
    return station


def _parse_trend(raw: dict) -> dict:
    return {
        "areaName": raw.get("areaName", ""),
        "country":  raw.get("country", ""),
        "today":    raw.get("today"),
        "todayLow": raw.get("todayLow"),
        "trend":    raw.get("trend", 0),
    }


# ── main browser fetch ────────────────────────────────────────────────────────
async def _fetch_via_playwright() -> tuple[list[dict], list[dict]]:
    stations_map: dict[str, dict] = {}
    trends: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = await browser.new_context(
            user_agent=_STEALTH_UA,
            viewport={"width": 1280, "height": 800},
            locale="en-CA",
            extra_http_headers=_STEALTH_HEADERS,
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
        )
        page = await context.new_page()

        logger.info("Loading https://www.gasbuddy.com …")
        try:
            await page.goto("https://www.gasbuddy.com", wait_until="networkidle", timeout=60_000)
        except Exception as e:
            logger.warning("Homepage load warning: %s", e)

        for lat, lng in SEARCH_COORDS:
            logger.info("  Querying /graphql for (%.4f, %.4f) …", lat, lng)
            try:
                result = await page.evaluate(_JS_FETCH, {"query": _GQL_QUERY, "lat": lat, "lng": lng})
            except Exception as e:
                logger.warning("  evaluate error: %s", e)
                continue

            if not isinstance(result, dict):
                logger.warning("  unexpected result type: %s", type(result))
                continue
            if "error" in result:
                logger.warning("  GraphQL JS error: %s", result["error"])
                continue

            loc = (result.get("data") or {}).get("locationBySearchTerm") or {}
            raw_stations = (loc.get("stations") or {}).get("results") or []
            raw_trends   = loc.get("trends") or []

            for s in raw_stations:
                sid = str(s.get("id", ""))
                if sid and sid not in stations_map:
                    stations_map[sid] = _parse_station(s)

            if not trends and raw_trends:
                trends.extend(_parse_trend(t) for t in raw_trends)

            logger.info("  → %d stations (total unique: %d)", len(raw_stations), len(stations_map))

        await browser.close()

    stations = list(stations_map.values())
    stations.sort(key=lambda x: (
        x.get("regular_gas") is None or (x["regular_gas"] or {}).get("price") is None,
        (x.get("regular_gas") or {}).get("price") or float("inf"),
    ))
    logger.info("Fetch complete: %d stations, %d trends", len(stations), len(trends))
    return stations, trends


# ── cache management ──────────────────────────────────────────────────────────
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
    """API-compatible shim; lat/lon ignored (full Vancouver fetched in one pass)."""
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]


async def get_all_vancouver() -> tuple[list[dict], list[dict]]:
    """Fetch (or return cached) station list and trends for Greater Vancouver."""
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]
