"""One-time (or periodic) audit: reverse-geocode every station missing a
city and store the result in the stations table. Ongoing discovery only
geocodes newly-found stations (see main.py's discovery_job), so this
script exists for the initial backfill and for re-auditing on demand.

Run inside the backend container (needs DATABASE_URL set):
    python backfill_cities.py           # only stations missing a city
    python backfill_cities.py --all     # re-geocode every station

Paced well under Nominatim's ~1 req/sec usage policy, with automatic
retry-with-backoff on 429s (geocoding.py) — the public instance rate-limits
more aggressively than its stated policy in practice, so a run can take
noticeably longer than station_count * SLEEP_BETWEEN_REQUESTS if it hits
a lot of retries.
"""

import asyncio
import sys

import database
from geocoding import reverse_geocode_city

SLEEP_BETWEEN_REQUESTS = 2.0  # seconds — Nominatim's public instance rate-limits below its stated 1 req/sec


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

    print(f"Geocoding {total} station(s) — at least ~{total * SLEEP_BETWEEN_REQUESTS / 60:.1f} min "
          f"(more if rate-limited) …")
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
