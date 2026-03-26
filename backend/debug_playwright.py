"""
Debug: test page.evaluate() GraphQL fetch from inside gasbuddy.com.
Run with:  python debug_playwright.py
"""

import asyncio
import json
from playwright.async_api import async_playwright

GQL_QUERY = """
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
    trends { areaName country today todayLow trend }
  }
}
"""

JS_FETCH = """
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
        const text = await resp.text();
        return { status: resp.status, body: text.slice(0, 3000) };
    } catch (e) {
        return { error: String(e) };
    }
}
"""

STEALTH_HEADERS = {
    "Sec-CH-UA": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
}


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

        print("Loading https://www.gasbuddy.com …")
        await page.goto("https://www.gasbuddy.com", wait_until="networkidle", timeout=60_000)
        print(f"Page loaded: {await page.title()}")

        # Test one coord: Downtown Vancouver
        lat, lng = 49.2827, -123.1207
        print(f"\nCalling /graphql via page.evaluate for ({lat}, {lng}) …")
        result = await page.evaluate(JS_FETCH, {"query": GQL_QUERY, "lat": lat, "lng": lng})

        print(f"\nResult status : {result.get('status')}")
        if "error" in result:
            print(f"JS error      : {result['error']}")
        else:
            body = result.get("body", "")
            print(f"Body length   : {len(body)} chars")
            print(f"Body preview  :\n{body[:2000]}")

            # Try to parse JSON and count stations
            try:
                data = json.loads(body)
                loc = (data.get("data") or {}).get("locationBySearchTerm") or {}
                stations = (loc.get("stations") or {}).get("results") or []
                trends   = loc.get("trends") or []
                print(f"\n✅ Parsed: {len(stations)} stations, {len(trends)} trends")
                for s in stations[:5]:
                    pr = (s.get("prices") or {}).get("credit") or {}
                    print(f"  {s.get('name'):35s}  {(s.get('address') or {}).get('line1',''):30s}  {pr.get('price','?')} ¢/L")
            except Exception as e:
                print(f"JSON parse error: {e}")

        await browser.close()


asyncio.run(main())
