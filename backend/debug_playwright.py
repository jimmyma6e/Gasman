"""
Debug: try to get GasBuddy prices with stealth Playwright (hides HeadlessChrome)
and also test old-style .aspx GasBuddy pages that still live on the .NET MVC site.
Run with:  python debug_playwright.py
"""

import asyncio
import json
from playwright.async_api import async_playwright

URLS_TO_TRY = [
    # Old GasBuddy .NET MVC pages (may still be server-side rendered)
    "https://www.gasbuddy.com/GasPrice/Vancouver_British_Columbia.aspx",
    "https://www.gasbuddy.com/GasBuddyFindGas.aspx?find=Vancouver%2C+BC%2C+Canada",
    "https://www.gasbuddy.com/Gas-Price-Search-New.aspx?find=Vancouver%2C+BC",
    # GasBuddy homepage — does the new Next.js app load without HeadlessChrome?
    "https://www.gasbuddy.com",
    # GasBuddy find/buy gas map (Next.js route that existed before)
    "https://www.gasbuddy.com/station/",
]

# Stealth headers — replace HeadlessChrome with real Chrome client hints
STEALTH_HEADERS = {
    "Sec-CH-UA": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
}


async def probe_url(pw, url: str) -> dict:
    browser = await pw.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    )
    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 800},
        locale="en-CA",
        extra_http_headers=STEALTH_HEADERS,
    )

    # Patch navigator.webdriver to false
    await context.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
    )

    page = await context.new_page()

    api_calls: list[dict] = []
    all_responses: list[dict] = []

    async def on_response(resp):
        u = resp.url
        ct = resp.headers.get("content-type", "")
        all_responses.append({"status": resp.status, "ct": ct[:50], "url": u[:100]})
        if "json" in ct or any(k in u for k in ["graphql", "/api/", "/GetStation", "/GetGas"]):
            entry = {"url": u[:120], "status": resp.status, "ct": ct[:60]}
            try:
                body = await resp.json()
                entry["body_preview"] = json.dumps(body)[:800]
            except Exception:
                pass
            api_calls.append(entry)

    page.on("response", on_response)

    result = {
        "url": url, "status": None, "title": None,
        "api_calls": [], "html_len": 0,
        "has_price_numbers": False, "html_snippet": "",
    }
    try:
        resp = await page.goto(url, wait_until="networkidle", timeout=50_000)
        await asyncio.sleep(3)
        result["status"] = resp.status if resp else None
        result["title"] = await page.title()
        html = await page.content()
        result["html_len"] = len(html)
        # Look for things that look like Canadian gas prices (e.g. "178.9" or "1.789")
        import re
        prices = re.findall(r'\b1[5-9]\d\.\d\b|\b2[0-4]\d\.\d\b', html)
        result["has_price_numbers"] = bool(prices)
        result["price_samples"] = prices[:10]
        result["html_snippet"] = html[1500:4000]
        result["api_calls"] = api_calls
        result["all_responses"] = all_responses
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
            print(f"  HTTP status   : {r.get('status')}")
            print(f"  Title         : {r.get('title')}")
            print(f"  HTML length   : {r.get('html_len', 0)} chars")
            print(f"  Price numbers : {r.get('price_samples', [])}")
            if r.get("error"):
                print(f"  ERROR: {r['error']}")
            if r["api_calls"]:
                print(f"  JSON/API calls ({len(r['api_calls'])}):")
                for c in r["api_calls"]:
                    print(f"    [{c['status']}] {c['url']}")
                    if "body_preview" in c:
                        print(f"           {c['body_preview'][:300]}")
            print(f"  All responses ({len(r.get('all_responses', []))}):")
            for rr in r.get("all_responses", [])[:15]:
                print(f"    [{rr['status']:3d}] {rr['ct']:45s} {rr['url']}")
            if r.get("has_price_numbers"):
                print(f"\n  *** FOUND PRICE NUMBERS *** HTML snippet:")
                print(r["html_snippet"][:1500])
                print("\n✅ Found working URL — stopping search")
                break


asyncio.run(main())
