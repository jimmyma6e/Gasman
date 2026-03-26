"""
End-to-end test of the production gasbuddy_client fetch flow.
Run with:  python debug_playwright.py
"""

import asyncio
import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

import gasbuddy_client as gb


async def main():
    print("Fetching Vancouver gas prices via Playwright …\n")
    stations, trends = await gb.get_all_vancouver()

    print(f"\n{'='*60}")
    print(f"Total stations: {len(stations)}")
    print(f"Trends:         {trends[:2]}")
    print(f"\nTop 15 cheapest regular gas:\n")
    print(f"  {'Name':<35} {'Address':<30} {'Regular':>8} {'Premium':>9} {'Diesel':>8}")
    print(f"  {'-'*35} {'-'*30} {'-'*8} {'-'*9} {'-'*8}")
    for s in stations[:15]:
        reg  = (s.get("regular_gas")  or {}).get("price")
        prem = (s.get("premium_gas")  or {}).get("price")
        dsl  = (s.get("diesel")       or {}).get("price")
        print(
            f"  {s['name']:<35} {s['address']:<30} "
            f"{f'{reg}¢':>8} {f'{prem}¢' if prem else '-':>9} {f'{dsl}¢' if dsl else '-':>8}"
        )


asyncio.run(main())
