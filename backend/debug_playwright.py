"""
Debug script: try multiple gas price URLs and report which ones work.
Run with:  python debug_playwright.py
"""

import asyncio
import json
from playwright.async_api import async_playwright

URLS_TO_TRY = [
    # GasBuddy variations
    "https://www.gasbuddy.com/gas-prices/canada/british-columbia/greater-vancouver",
    "https://www.gasbuddy.com/gas-prices/canada/british-columbia/vancouver",
    "https://www.gasbuddy.com/gas-prices/canada/british-columbia",
    "https://www.gasbuddy.com/buy-gas?search=Vancouver%2C+BC",
    "https://www.gasbuddy.com/buy-gas",
    # Alternative Canadian sources
    "https://www.gasprices.ca/British-Columbia/Vancouver",
    "https://gasprices.ca/British-Columbia/Vancouver",
    "https://www.gasbuddy.ca/gas-prices/british-columbia/vancouver",
]


async def probe_url(pw, url: str) -> dict:
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 800},
        locale="en-CA",
    )
    page = await context.new_page()

    api_calls: list[dict] = []

    async def on_response(resp):
        u = resp.url
        ct = resp.headers.get("content-type", "")
        # Capture JSON / XHR / fetch responses that look like data
        if "json" in ct or any(k in u for k in ["graphql", "/api/", "price", "station"]):
            entry = {"url": u[:120], "status": resp.status, "ct": ct[:60]}
            try:
                body = await resp.json()
                entry["body_preview"] = json.dumps(body)[:500]
            except Exception:
                pass
            api_calls.append(entry)

    page.on("response", on_response)

    result = {"url": url, "status": None, "title": None, "api_calls": [], "html_snippet": ""}
    try:
        resp = await page.goto(url, wait_until="networkidle", timeout=45_000)
        await asyncio.sleep(2)
        result["status"] = resp.status if resp else None
        result["title"] = await page.title()
        html = await page.content()
        # Look for price data in the HTML
        result["has_prices"] = any(k in html for k in ["cents", "¢", "/L", "per litre", "price"])
        result["html_snippet"] = html[2000:4000]  # middle chunk — skip <head>
        result["api_calls"] = api_calls
    except Exception as e:
        result["error"] = str(e)
    finally:
        await browser.close()

    return result


async def main():
    async with async_playwright() as pw:
        for url in URLS_TO_TRY:
            print(f"\n{'='*70}")
            print(f"Probing: {url}")
            r = await probe_url(pw, url)
            print(f"  HTTP status : {r.get('status')}")
            print(f"  Title       : {r.get('title')}")
            print(f"  Has prices? : {r.get('has_prices')}")
            if r.get("error"):
                print(f"  ERROR: {r['error']}")
            if r["api_calls"]:
                print(f"  API/JSON calls intercepted ({len(r['api_calls'])}):")
                for c in r["api_calls"]:
                    print(f"    [{c['status']}] {c['url']}")
                    if "body_preview" in c:
                        print(f"           {c['body_preview'][:200]}")
            if r.get("has_prices"):
                print(f"\n  *** FOUND PRICES *** HTML snippet:")
                print(r["html_snippet"][:1000])
            # Stop at first URL that returns prices
            if r.get("has_prices") and r.get("status") == 200:
                print("\n\n✅ Found working URL — stopping search")
                break


asyncio.run(main())
