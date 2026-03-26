#!/usr/bin/env python3
"""Step-by-step connection diagnostic for GasBuddy."""
import asyncio
import json
import aiohttp
from curl_cffi.requests import AsyncSession

FLARESOLVERR = "http://localhost:8191/v1"
GRAPHQL      = "https://www.gasbuddy.com/graphql"


async def main():
    # ── Step 1: cookies ───────────────────────────────────────────────────────
    print("=== Step 1: Fetching cookies via FlareSolverr ===")
    async with aiohttp.ClientSession() as http:
        async with http.post(
            FLARESOLVERR,
            json={"cmd": "request.get", "url": "https://www.gasbuddy.com", "maxTimeout": 60000},
        ) as resp:
            data = await resp.json()

    if data.get("status") != "ok":
        print(f"FAILED: {data}")
        return

    cookies = {c["name"]: c["value"] for c in data["solution"]["cookies"]}
    ua      = data["solution"]["userAgent"]
    print(f"  Cookie names : {list(cookies.keys())}")
    print(f"  cf_clearance : {'PRESENT' if 'cf_clearance' in cookies else 'MISSING'}")
    print(f"  User-Agent   : {ua[:90]}")

    # ── Step 2: minimal GraphQL introspection ─────────────────────────────────
    print("\n=== Step 2: Minimal GraphQL query { __typename } ===")
    headers = {
        "Content-Type":    "application/json",
        "Accept":          "application/json, */*",
        "Origin":          "https://www.gasbuddy.com",
        "Referer":         "https://www.gasbuddy.com/",
        "Accept-Language": "en-US,en;q=0.9",
    }

    for impersonate in ["chrome120", "chrome124", "chrome"]:
        print(f"\n  [impersonate={impersonate!r}]")
        try:
            async with AsyncSession(impersonate=impersonate) as session:
                resp = await session.post(
                    GRAPHQL,
                    json={"query": "{ __typename }"},
                    headers=headers,
                    cookies=cookies,
                    timeout=30,
                )
            print(f"    HTTP status  : {resp.status_code}")
            print(f"    Content-Type : {resp.headers.get('Content-Type', '—')}")
            print(f"    Body (200)   : {resp.text[:300]}")
            if resp.status_code < 400:
                break   # success — no need to try other impersonation targets
        except Exception as e:
            print(f"    Exception    : {e}")

    # ── Step 3: try without cookies (baseline) ────────────────────────────────
    print("\n=== Step 3: Same request WITHOUT cookies (baseline) ===")
    try:
        async with AsyncSession(impersonate="chrome120") as session:
            resp = await session.post(
                GRAPHQL,
                json={"query": "{ __typename }"},
                headers=headers,
                timeout=30,
            )
        print(f"  HTTP status  : {resp.status_code}")
        print(f"  Body         : {resp.text[:300]}")
    except Exception as e:
        print(f"  Exception    : {e}")


asyncio.run(main())
