import { PREMIUM_OCTANE_BY_BRAND, DEFAULT_OCTANE } from "./octane.js";
import { haversineKm } from "./geo.js";

// A station's own premium price is always one specific octane already,
// implied by its brand — but /api/insights area averages split premium
// into separate premium_91/premium_93 tiers (see database.py), so the
// fairness baseline has to pick the tier matching this station's brand.
export function insightsFuelKey(fuelKey, brand) {
  if (fuelKey !== "premium_gas") return fuelKey;
  const octane = PREMIUM_OCTANE_BY_BRAND[brand] ?? DEFAULT_OCTANE.premium_gas;
  return octane === 93 ? "premium_93" : "premium_91";
}

// Nearest-centroid match by the station's own coordinates — matching by
// area name can fail, since a station's area is derived from a coarser
// reverse-geocoded city (e.g. "Vancouver") while area_averages uses finer
// named areas (e.g. "Downtown Vancouver").
export function nearestAreaAverage(areas, lat, lng) {
  if (!areas?.length || lat == null || lng == null) return null;
  let best = null, bestDist = Infinity;
  for (const a of areas) {
    const d = haversineKm(lat, lng, a.latitude, a.longitude);
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best;
}

// Baseline is the area average, not this station's own history, so a
// station that's always expensive relative to its neighbours never reads
// as "fair" just because it matches its own trend.
export function computeFairness(price, areaAvgToday, lastUpdated) {
  if (price == null || !areaAvgToday) return null;
  const pct = ((price - areaAvgToday) / areaAvgToday) * 100;
  let label = pct <= -5 ? "Great" : pct <= -1 ? "Good" : pct <= 1 ? "Fair" : pct <= 5 ? "Above average" : "High";
  // A stale price could easily be wrong by now — don't call it a great
  // deal on data that's over 2 days old.
  const staleHours = lastUpdated ? (Date.now() - new Date(lastUpdated).getTime()) / 3600000 : Infinity;
  if (staleHours > 48 && (label === "Great" || label === "Good")) label = "Fair";
  const emoji = { Great: "🟢", Good: "🟢", Fair: "⚪", "Above average": "🟠", High: "🔴" }[label];
  return { label, emoji, pct };
}
