"""
Debug: intercept GasBuddy's own /graphql requests to see exact query format,
then test our own fetch with the same structure.
Run with:  python debug_playwright.py
"""

import asyncio
import json
from playwright.async_api import async_playwright

STEALTH_HEADERS = {
    "Sec-CH-UA": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
}

# Test queries — try several variants to find what works
TEST_QUERIES = [
    # 1. Minimal introspection — should always work if endpoint is live
    ('__typename', '{ __typename }', {}),

    # 2. Coord with "lng" variable name
    ('locationBySearchTerm(lng)', """
query locationBySearchTerm($lat: Float, $lng: Float) {
  locationBySearchTerm(lat: $lat, lng: $lng) {
    stations { results { id name fuels prices { credit { price } } } }
    trends { today todayLow }
  }
}
""", {"lat": 49.2827, "lng": -123.1207}),

    # 3. Coord with "long" variable name
    ('locationBySearchTerm(long)', """
query locationBySearchTerm($lat: Float, $long: Float) {
  locationBySearchTerm(lat: $lat, long: $long) {
    stations { results { id name fuels prices { credit { price } } } }
    trends { today todayLow }
  }
}
""", {"lat": 49.2827, "long": -123.1207}),

    # 4. Inline literal args (no variables)
    ('locationBySearchTerm(inline)', """
{
  locationBySearchTerm(lat: 49.2827, lng: -123.1207) {
    stations { results { id name fuels prices { credit { price } } } }
    trends { today todayLow }
  }
}
""", {}),

    # 5. Inline with "long"
    ('locationBySearchTerm(inline long)', """
{
  locationBySearchTerm(lat: 49.2827, long: -123.1207) {
    stations { results { id name fuels prices { credit { price } } } }
    trends { today todayLow }
  }
}
""", {}),
]

JS_FETCH = """
async ({ query, variables, extraHeaders }) => {
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...extraHeaders,
        };
        const body = variables && Object.keys(variables).length
            ? JSON.stringify({ query, variables })
            : JSON.stringify({ query });
        const resp = await fetch('/graphql', {
            method: 'POST',
            credentials: 'include',
            headers,
            body,
        });
        const text = await resp.text();
        return { status: resp.status, body: text.slice(0, 2000) };
    } catch (e) {
        return { error: String(e) };
    }
}
"""


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-CA",
            extra_http_headers=STEALTH_HEADERS,
        )
        await context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
        )
        page = await context.new_page()

        # ── Intercept GasBuddy's own /graphql requests ──────────────────────
        gb_requests: list[dict] = []

        async def on_request(req):
            if "/graphql" in req.url:
                try:
                    body = req.post_data or ""
                    gb_requests.append({
                        "url":     req.url,
                        "headers": dict(req.headers),
                        "body":    body[:2000],
                    })
                except Exception:
                    pass

        page.on("request", on_request)

        print("Loading https://www.gasbuddy.com …")
        await page.goto("https://www.gasbuddy.com", wait_until="networkidle", timeout=60_000)
        await asyncio.sleep(2)

        print(f"\n=== GasBuddy's own /graphql requests ({len(gb_requests)}) ===")
        for i, r in enumerate(gb_requests):
            print(f"\n--- Request #{i+1} ---")
            print(f"URL: {r['url']}")
            print("Headers:")
            for k, v in r["headers"].items():
                print(f"  {k}: {v}")
            print(f"Body: {r['body'][:500]}")

        # Extract any extra headers GasBuddy's JS uses
        extra_headers: dict = {}
        if gb_requests:
            # Use headers from first /graphql request (excluding standard ones)
            skip = {"content-type", "accept", "content-length"}
            extra_headers = {
                k: v for k, v in gb_requests[0]["headers"].items()
                if k.lower() not in skip
            }
            print(f"\nExtra headers to reuse: {json.dumps(extra_headers, indent=2)}")

        # ── Test our queries ─────────────────────────────────────────────────
        print("\n\n=== Testing our GraphQL queries ===")
        for name, query, variables in TEST_QUERIES:
            print(f"\n--- {name} ---")
            result = await page.evaluate(
                JS_FETCH, {"query": query, "variables": variables, "extraHeaders": extra_headers}
            )
            status = result.get("status")
            body   = result.get("body", "")
            err    = result.get("error")
            print(f"Status: {status}")
            if err:
                print(f"Error:  {err}")
            else:
                print(f"Body ({len(body)} chars): {body[:600]}")
                if status == 200:
                    try:
                        data = json.loads(body)
                        loc = (data.get("data") or {}).get("locationBySearchTerm") or {}
                        stations = (loc.get("stations") or {}).get("results") or []
                        print(f"✅  {len(stations)} stations returned!")
                        for s in stations[:3]:
                            pr = (s.get("prices") or {}).get("credit") or {}
                            print(f"    {s.get('name','?'):35s}  {pr.get('price','?')} ¢/L")
                    except Exception:
                        pass

        await browser.close()


asyncio.run(main())
