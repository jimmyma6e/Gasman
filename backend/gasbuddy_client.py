"""
GasBuddy client using Playwright browser automation.

GasBuddy's /graphql endpoint is protected by Cloudflare WAF rules that block
automated HTTP requests regardless of cookies or TLS fingerprinting.  The only
reliable approach is to open a real headless Chromium, let GasBuddy's own
JavaScript execute, intercept the GraphQL responses that the page's JS makes
successfully, and extract the station data from those.

Strategy
--------
1. Launch headless Chromium via Playwright.
2. Register a response-intercept handler on any URL containing "/graphql".
3. Navigate to the Vancouver gas-prices page and wait for network idle.
4. Collect all intercepted /graphql payloads; parse station + trend data.
5. Cache the results for CACHE_TTL minutes so we don't relaunch the browser
   on every API call.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta

from playwright.async_api import async_playwright, Response

logger = logging.getLogger(__name__)

PRICES_URL = "https://www.gasbuddy.com/gas-prices/british-columbia/vancouver"
CACHE_TTL  = timedelta(minutes=30)

# ── in-memory result cache ────────────────────────────────────────────────────
_cache: dict = {"stations": None, "trends": None, "fetched_at": None}
_lock = asyncio.Lock()

# ── fuel maps ─────────────────────────────────────────────────────────────────
FUEL_MAP = {
    1: "regular_gas",
    2: "midgrade_gas",
    3: "premium_gas",
    4: "diesel",
    5: "e85",
}


# ── response parsers ──────────────────────────────────────────────────────────

def _parse_price(raw_price: dict | None) -> dict | None:
    if not raw_price or raw_price.get("price") is None:
        return None
    return {
        "price":        raw_price.get("price"),
        "cash_price":   None,
        "credit":       raw_price.get("nickname"),
        "last_updated": raw_price.get("postedTime"),
    }


def _parse_station(raw: dict) -> dict:
    credit_raw   = (raw.get("prices") or {}).get("credit") or {}
    cash_raw     = (raw.get("prices") or {}).get("cash")   or {}
    credit_price = _parse_price(credit_raw) if credit_raw.get("price") is not None else None
    cash_price   = cash_raw.get("price")

    fuels    = raw.get("fuels") or []
    fuel_key = FUEL_MAP.get(fuels[0], "regular_gas") if fuels else "regular_gas"

    if credit_price and cash_price is not None:
        credit_price["cash_price"] = cash_price

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
    if credit_price:
        station[fuel_key] = credit_price
    return station


def _parse_trend(raw: dict) -> dict:
    return {
        "areaName": raw.get("areaName", ""),
        "country":  raw.get("country", ""),
        "today":    raw.get("today"),
        "todayLow": raw.get("todayLow"),
        "trend":    raw.get("trend", 0),
    }


def _extract_from_payload(payload: dict, stations_map: dict, trends: list) -> None:
    """Pull station/trend data out of one GraphQL response payload."""
    data = payload.get("data") or {}

    # locationBySearchTerm query
    loc = data.get("locationBySearchTerm") or {}
    raw_stations = (loc.get("stations") or {}).get("results") or []
    raw_trends   = loc.get("trends") or []

    for s in raw_stations:
        sid = str(s.get("id", ""))
        if sid and sid not in stations_map:
            stations_map[sid] = _parse_station(s)

    if not trends and raw_trends:
        trends.extend(_parse_trend(t) for t in raw_trends)

    # stationsByPlace / nearbyStations alternate query shapes
    for key in ("stationsByPlace", "nearbyStations"):
        node = data.get(key) or {}
        for s in (node.get("results") or []):
            sid = str(s.get("id", ""))
            if sid and sid not in stations_map:
                stations_map[sid] = _parse_station(s)


# ── browser fetch ─────────────────────────────────────────────────────────────

async def _fetch_via_playwright() -> tuple[list[dict], list[dict]]:
    """
    Launch headless Chromium, navigate to the Vancouver prices page, and
    collect all /graphql responses the page's JavaScript makes.
    """
    stations_map: dict[str, dict] = {}
    trends:       list[dict]      = []
    graphql_responses: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-CA",
        )
        page = await context.new_page()

        # Intercept every /graphql response and stash its JSON body
        async def on_response(response: Response) -> None:
            if "/graphql" not in response.url:
                return
            try:
                ct = response.headers.get("content-type", "")
                if "json" not in ct:
                    return
                body = await response.json()
                graphql_responses.append(body)
                logger.debug("Intercepted /graphql response (%d bytes)", len(str(body)))
            except Exception as exc:
                logger.debug("Could not read /graphql response: %s", exc)

        page.on("response", on_response)

        logger.info("Launching Chromium → %s", PRICES_URL)
        try:
            await page.goto(PRICES_URL, wait_until="networkidle", timeout=60_000)
        except Exception as exc:
            logger.warning("page.goto timed out or errored (%s) — processing what we have", exc)

        # Give any late XHR a moment to settle
        await asyncio.sleep(2)

        await browser.close()

    logger.info("Intercepted %d /graphql response(s)", len(graphql_responses))

    for payload in graphql_responses:
        _extract_from_payload(payload, stations_map, trends)

    stations = list(stations_map.values())
    stations.sort(key=lambda x: (
        x.get("regular_gas") is None or (x["regular_gas"] or {}).get("price") is None,
        (x.get("regular_gas") or {}).get("price") or float("inf"),
    ))

    logger.info("Parsed %d stations, %d trend(s)", len(stations), len(trends))
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
    """
    Return (stations, trends) for Greater Vancouver.

    lat/lon are accepted for API compatibility with the old client but are
    ignored — Playwright fetches the full Vancouver area in one page load.
    """
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]


async def get_all_vancouver() -> tuple[list[dict], list[dict]]:
    """Fetch (or return cached) full Vancouver station list and trends."""
    async with _lock:
        await _ensure_fresh()
    return _cache["stations"], _cache["trends"]
