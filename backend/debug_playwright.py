"""
Debug script: open GasBuddy Vancouver prices page in headless Chromium and
print every outbound request URL + response status + content-type.
Run with:  python debug_playwright.py
"""

import asyncio
from playwright.async_api import async_playwright

URL = "https://www.gasbuddy.com/gas-prices/british-columbia/vancouver"


async def main() -> None:
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

        seen_urls: list[dict] = []

        async def on_response(resp) -> None:
            ct  = resp.headers.get("content-type", "")
            url = resp.url
            seen_urls.append({"status": resp.status, "ct": ct, "url": url})

            # Print JSON / GraphQL / API responses immediately so we see them live
            if any(k in url for k in ["graphql", "api", "price", "station", "gas"]):
                print(f"\n*** INTERESTING ***  {resp.status}  {url}")
                print(f"    content-type: {ct}")
                if "json" in ct:
                    try:
                        body = await resp.json()
                        import json
                        print(json.dumps(body, indent=2)[:2000])
                    except Exception as e:
                        print(f"    (could not parse JSON: {e})")

        page.on("response", on_response)

        print(f"Navigating to {URL} …")
        try:
            await page.goto(URL, wait_until="networkidle", timeout=60_000)
        except Exception as e:
            print(f"goto error: {e}")

        await asyncio.sleep(3)

        print("\n\n=== ALL RESPONSES ===")
        for r in seen_urls:
            print(f"  {r['status']:3d}  {r['ct'][:40]:40s}  {r['url'][:120]}")

        print("\n\n=== PAGE TITLE ===")
        print(await page.title())

        print("\n=== FIRST 3000 chars of page HTML ===")
        html = await page.content()
        print(html[:3000])

        await browser.close()


asyncio.run(main())
