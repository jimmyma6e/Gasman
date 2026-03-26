#!/usr/bin/env python3
"""Diagnostic: try multiple approaches to get GasBuddy data."""
import asyncio
import json
import re
import aiohttp
from curl_cffi.requests import AsyncSession

FLARESOLVERR = "http://localhost:8191/v1"
GRAPHQL      = "https://www.gasbuddy.com/graphql"
PRICES_PAGE  = "https://www.gasbuddy.com/gas-prices/british-columbia/vancouver"


async def flaresolverr_get(url: str) -> dict:
    async with aiohttp.ClientSession() as http:
        async with http.post(
            FLARESOLVERR,
            json={"cmd": "request.get", "url": url, "maxTimeout": 60000},
        ) as resp:
            return await resp.json()


async def main():
    # ── Approach A: visit /graphql via FlareSolverr GET to get cf_clearance ───
    print("=== Approach A: FlareSolverr GET /graphql ===")
    data = await flaresolverr_get(GRAPHQL)
    print(f"  status       : {data.get('status')}")
    cookies_a = {c["name"]: c["value"] for c in data.get("solution", {}).get("cookies", [])}
    print(f"  cookie names : {list(cookies_a.keys())}")
    print(f"  cf_clearance : {'PRESENT ✓' if 'cf_clearance' in cookies_a else 'MISSING ✗'}")
    ua_a = data.get("solution", {}).get("userAgent", "")
    print(f"  response len : {len(data.get('solution', {}).get('response', ''))}")

    # If we got cf_clearance, try POST /graphql with it
    if "cf_clearance" in cookies_a:
        print("\n  → Got cf_clearance! Trying POST /graphql ...")
        async with AsyncSession(impersonate="chrome120") as session:
            resp = await session.post(
                GRAPHQL,
                json={"query": "{ __typename }"},
                headers={
                    "Content-Type":    "application/json",
                    "Accept":          "application/json",
                    "Origin":          "https://www.gasbuddy.com",
                    "Referer":         "https://www.gasbuddy.com/",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                cookies=cookies_a,
                timeout=30,
            )
        print(f"  POST status  : {resp.status_code}")
        print(f"  POST body    : {resp.text[:300]}")

    # ── Approach B: scrape the Vancouver prices page ───────────────────────────
    print("\n=== Approach B: FlareSolverr GET Vancouver prices page ===")
    data_b = await flaresolverr_get(PRICES_PAGE)
    print(f"  status       : {data_b.get('status')}")
    html = data_b.get("solution", {}).get("response", "")
    print(f"  HTML length  : {len(html)}")

    # Look for price data in the rendered HTML
    # GasBuddy embeds a __NEXT_DATA__ JSON blob with all station data
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.DOTALL)
    if match:
        try:
            next_data = json.loads(match.group(1))
            print("  __NEXT_DATA__: FOUND ✓")
            # Navigate into the data to find stations
            props = next_data.get("props", {}).get("pageProps", {})
            print(f"  pageProps keys: {list(props.keys())[:10]}")
            # Try to find stations
            stations_raw = (
                props.get("stations")
                or props.get("stationsByPlace")
                or props.get("nearbyStations")
                or {}
            )
            if stations_raw:
                print(f"  Station count : {len(stations_raw.get('results', stations_raw) if isinstance(stations_raw, dict) else stations_raw)}")
                # Print first station as sample
                results = stations_raw.get("results", stations_raw) if isinstance(stations_raw, dict) else stations_raw
                if results:
                    print(f"  First station : {json.dumps(results[0], indent=2)[:400]}")
            else:
                print("  No stations key found. Top-level keys in next_data:")
                print(f"    {list(next_data.keys())}")
        except Exception as e:
            print(f"  Parse error: {e}")
    else:
        print("  __NEXT_DATA__: NOT FOUND")
        # Look for any price patterns
        prices_found = re.findall(r'\d+\.\d+\s*¢/L', html)
        print(f"  Price patterns found: {prices_found[:5]}")
        print(f"  HTML snippet (first 500 non-whitespace chars):")
        print("  " + " ".join(html.split())[:500])


asyncio.run(main())
