"""One-time (or periodic) audit: reverse-geocode every station missing a
city and store the result in the stations table. Ongoing discovery only
geocodes newly-found stations (see main.py's discovery_job), so this
script exists for the initial backfill and for re-auditing on demand.

Run inside the backend container (needs DATABASE_URL set):
    python backfill_cities.py           # only stations missing a city
    python backfill_cities.py --all     # re-geocode every station

Respects Nominatim's ~1 req/sec usage policy — this will take a while
for a few hundred/thousand stations (roughly 1 station/second).
"""

import asyncio
import sys

import database
from geocoding import reverse_geocode_city

SLEEP_BETWEEN_REQUESTS = 1.1  # seconds — stay under Nominatim's rate limit


async def run(all_stations: bool) -> None:
    database.init_db()

    if all_stations:
        stations = database.get_known_stations()
    else:
        stations = database.get_stations_missing_city()

    total = len(stations)
    if not total:
        print("Nothing to geocode.")
        return

    print(f"Geocoding {total} station(s) — ~{total * SLEEP_BETWEEN_REQUESTS / 60:.1f} min at 1 req/sec …")
    done, found = 0, 0
    for s in stations:
        city = await reverse_geocode_city(s.get("latitude"), s.get("longitude"))
        if city:
            database.update_station_city(s["station_id"], city)
            found += 1
        done += 1
        if done % 25 == 0 or done == total:
            print(f"  {done}/{total} — {found} resolved")
        await asyncio.sleep(SLEEP_BETWEEN_REQUESTS)

    print(f"Done — {found}/{total} stations got a city.")


if __name__ == "__main__":
    asyncio.run(run(all_stations="--all" in sys.argv))
