"""
Custom GasBuddy GraphQL client.

Uses FlareSolverr to get cf_clearance + session cookies from gasbuddy.com,
then replays those cookies via curl-cffi (Chrome TLS impersonation) on POST
requests to /graphql.

Why curl-cffi: Cloudflare ties cf_clearance to the browser's TLS fingerprint.
aiohttp has a different JA3/HTTP2 fingerprint from Chrome, so requests are
blocked even with valid cookies. curl-cffi impersonates Chrome exactly.
"""

import json
import logging
from datetime import datetime, timezone, timedelta

import aiohttp
from curl_cffi.requests import AsyncSession as CurlSession

logger = logging.getLogger(__name__)

FLARESOLVERR_URL = "http://localhost:8191/v1"
GASBUDDY_HOME    = "https://www.gasbuddy.com"
GASBUDDY_GRAPHQL = "https://www.gasbuddy.com/graphql"
COOKIE_TTL       = timedelta(minutes=45)   # refresh before cf_clearance expires

# ── in-memory cookie cache ────────────────────────────────────────────────────
_state: dict = {"cookies": None, "ua": None, "fetched_at": None}

# ── GraphQL query ─────────────────────────────────────────────────────────────
# GasBuddy's public GraphQL schema (reverse-engineered)
NEARBY_QUERY = """
query LocationBySearchTerm($lat: Float, $long: Float) {
  locationBySearchTerm(lat: $lat, long: $long) {
    stations {
      count
      results {
        id
        name
        address {
          line1
        }
        latitude
        longitude
        prices {
          credit {
            nickname
            postedTime
            price
          }
          cash {
            nickname
            postedTime
            price
          }
        }
        fuels
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

# Fuel type number → canonical key used in the rest of the app
FUEL_MAP = {
    1: "regular_gas",
    2: "midgrade_gas",
    3: "premium_gas",
    4: "diesel",
    5: "e85",
}
FUEL_NAME_MAP = {
    "regular":   "regular_gas",
    "midgrade":  "midgrade_gas",
    "premium":   "premium_gas",
    "diesel":    "diesel",
    "e85":       "e85",
    "unleaded":  "regular_gas",
}


# ── session management ────────────────────────────────────────────────────────

async def _refresh_cookies() -> None:
    logger.info("Fetching GasBuddy session via FlareSolverr …")
    async with aiohttp.ClientSession() as http:
        async with http.post(
            FLARESOLVERR_URL,
            json={"cmd": "request.get", "url": GASBUDDY_HOME, "maxTimeout": 60000},
        ) as resp:
            data = await resp.json()

    if data.get("status") != "ok":
        raise RuntimeError(f"FlareSolverr error: {data.get('message')}")

    sol = data["solution"]
    _state["cookies"]    = {c["name"]: c["value"] for c in sol["cookies"]}
    _state["ua"]         = sol["userAgent"]
    _state["fetched_at"] = datetime.now(timezone.utc)
    logger.info(
        f"  Cookies: {list(_state['cookies'].keys())} | "
        f"UA: {_state['ua'][:70]}"
    )


async def _ensure_cookies() -> None:
    if (
        _state["cookies"] is None
        or _state["fetched_at"] is None
        or datetime.now(timezone.utc) - _state["fetched_at"] > COOKIE_TTL
    ):
        await _refresh_cookies()


# ── GraphQL request ───────────────────────────────────────────────────────────

async def _graphql(query: str, variables: dict) -> dict:
    await _ensure_cookies()

    headers = {
        "Content-Type":    "application/json",
        "Accept":          "application/json",
        "Origin":          GASBUDDY_HOME,
        "Referer":         GASBUDDY_HOME + "/",
        "Accept-Language": "en-CA,en;q=0.9",
    }

    # curl-cffi impersonates Chrome's TLS + HTTP/2 fingerprint so
    # Cloudflare accepts the cf_clearance cookie we got via FlareSolverr.
    async with CurlSession(impersonate="chrome120") as session:
        resp = await session.post(
            GASBUDDY_GRAPHQL,
            json={"query": query, "variables": variables},
            headers=headers,
            cookies=_state["cookies"],
        )

    text = resp.text
    ct   = resp.headers.get("Content-Type", "")

    # Cloudflare challenge — refresh cookies next time
    if "Just a moment" in text or "cf_chl" in text:
        _state["fetched_at"] = None
        raise RuntimeError("Cloudflare challenge on /graphql — will refresh cookies")

    # Try to parse as JSON regardless of Content-Type (GraphQL errors come back as JSON even on 4xx)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        logger.error("Non-JSON /graphql response (status %s):\n%s", resp.status_code, text[:800])
        raise RuntimeError(f"Non-JSON response (HTTP {resp.status_code}): {text[:200]}")

    if "errors" in payload:
        logger.warning("GraphQL errors (status %s): %s", resp.status_code, payload["errors"])

    return payload


# ── response parser ───────────────────────────────────────────────────────────

def _parse_price(raw_price: dict | None) -> dict | None:
    """Normalise a raw GasBuddy price dict into our internal format."""
    if not raw_price or raw_price.get("price") is None:
        return None
    return {
        "price":        raw_price.get("price"),
        "cash_price":   None,    # filled below by caller if cash exists
        "credit":       raw_price.get("nickname"),
        "last_updated": raw_price.get("postedTime"),
    }


def _parse_station(raw: dict) -> dict:
    """
    Convert a raw GasBuddy station object into our standardised shape.

    GasBuddy returns fuel type as an integer in the `fuels` list.
    Prices come in `prices.credit` / `prices.cash` for the cheapest reported
    fuel at that station (the API doesn't always return per-fuel-type prices
    from `locationBySearchTerm` — it returns the primary fuel price).
    We map what we get and leave the rest as None.
    """
    credit_raw = (raw.get("prices") or {}).get("credit") or {}
    cash_raw   = (raw.get("prices") or {}).get("cash")   or {}

    credit_price = _parse_price(credit_raw) if credit_raw.get("price") is not None else None
    cash_price   = cash_raw.get("price")

    # Determine fuel type from fuels list (list of ints)
    fuels = raw.get("fuels") or []
    fuel_key = FUEL_MAP.get(fuels[0], "regular_gas") if fuels else "regular_gas"

    if credit_price and cash_price is not None:
        credit_price["cash_price"] = cash_price

    station: dict = {
        "station_id":       str(raw.get("id", "")),
        "name":             raw.get("name", f"Station #{raw.get('id','')}"),
        "address":          (raw.get("address") or {}).get("line1", "Vancouver, BC"),
        "latitude":         raw.get("latitude"),
        "longitude":        raw.get("longitude"),
        "currency":         "CAD",
        "unit_of_measure":  "cents_per_litre",
        "regular_gas":      None,
        "midgrade_gas":     None,
        "premium_gas":      None,
        "diesel":           None,
        "e85":              None,
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


# ── public API ────────────────────────────────────────────────────────────────

async def search_nearby(lat: float, lon: float) -> tuple[list[dict], list[dict]]:
    """
    Return (stations, trends) for the given coordinates.
    stations — list of dicts with station_id, name, address, prices …
    trends   — list of regional trend dicts
    """
    data = await _graphql(NEARBY_QUERY, {"lat": lat, "long": lon})

    loc_data = (data.get("data") or {}).get("locationBySearchTerm") or {}
    raw_stations = (loc_data.get("stations") or {}).get("results") or []
    raw_trends   = loc_data.get("trends") or []

    stations = [_parse_station(s) for s in raw_stations]
    trends   = [_parse_trend(t)   for t in raw_trends]

    logger.info("search_nearby(%.4f, %.4f) → %d stations", lat, lon, len(stations))
    return stations, trends
