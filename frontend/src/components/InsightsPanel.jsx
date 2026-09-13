import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { haversineKm } from "../geo.js";

// Virtual keys for the two octane-split premium tiers (91 vs 93) are
// resolved backend-side (database.py's _resolve_fuel_type) — a station's
// own premium price is always one specific octane already, implied by its
// brand, but an area-wide average needs the brands split apart to be
// meaningful. Regular/Mid/Diesel don't vary this way, so they use their
// real fuel_type directly.
const FUEL_TILES = [
  { key: "regular_gas",  label: "87" },
  { key: "midgrade_gas", label: "89" },
  { key: "premium_91",   label: "91" },
  { key: "premium_93",   label: "93" },
  { key: "diesel",       label: "Diesel" },
];

const RANGES = [
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
];

export default function InsightsPanel({ trend, userCoords, variant = "home" }) {
  // "home" = full section, always expanded (the Home/dashboard tab).
  // "compact" = collapsed strip by default elsewhere, expandable on tap.
  const isHome = variant === "home";
  const [manualExpand, setManualExpand] = useState(false);
  const expanded = isHome || manualExpand;
  // Independent of the Stations tab's activeFuel — the octane-split tiles
  // (91/93) are a widget-only concept that doesn't map onto a single
  // station's one real premium_gas price.
  const [selectedFuel, setSelectedFuel] = useState("regular_gas");
  const [selectedArea, setSelectedArea] = useState(null); // null = Overall
  const [insightsByFuel, setInsightsByFuel] = useState({});
  const [range, setRange] = useState(30);
  const [series, setSeries] = useState(null);

  useEffect(() => {
    FUEL_TILES.forEach(({ key }) => {
      fetch(`/api/insights?fuel_type=${key}`)
        .then((r) => r.json())
        .then((data) => setInsightsByFuel((prev) => ({ ...prev, [key]: data })))
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    setSeries(null);
    const areaParam = selectedArea ? `&area=${encodeURIComponent(selectedArea)}` : "";
    fetch(`/api/insights/history?fuel_type=${selectedFuel}${areaParam}&days=30`)
      .then((r) => r.json())
      .then((data) => setSeries(data.series || []))
      .catch(() => setSeries([]));
  }, [selectedFuel, selectedArea]);

  // BC trend from GasBuddy — a small arrow hint on Regular only, since it's
  // the one fuel GasBuddy itself reports an overall trend for.
  const bc = trend?.find((t) => t.country === "CA") || trend?.[0];

  const selectedData = insightsByFuel[selectedFuel];
  const areas = (selectedData?.area_averages || []).filter((a) => a.avg_today != null);
  // "Popularity" = station count within that area. When we know the user's
  // location, an area within ~15km is promoted ahead of a merely-larger
  // area far away, since "popular near me" beats "popular somewhere else".
  const rankedAreas = userCoords
    ? [...areas].sort((a, b) => {
        const da = haversineKm(userCoords.lat, userCoords.lng, a.latitude, a.longitude);
        const db = haversineKm(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
        const aNear = da <= 15, bNear = db <= 15;
        if (aNear !== bNear) return aNear ? -1 : 1;
        return (b.station_count ?? 0) - (a.station_count ?? 0);
      })
    : [...areas].sort((a, b) => (b.station_count ?? 0) - (a.station_count ?? 0));

  const anyLoaded = Object.keys(insightsByFuel).length > 0;
  if (!anyLoaded) return null;

  if (!expanded) {
    const regular = insightsByFuel.regular_gas?.ytd_vs_today?.today_avg;
    return (
      <button className="insights-bar insights-bar-collapsed" onClick={() => setManualExpand(true)}>
        <span className="insights-collapsed-summary">
          ⛽ Regular avg {regular != null ? `${regular.toFixed(1)}¢/L` : "—"}
        </span>
        <span className="insights-collapsed-caret">Insights ▾</span>
      </button>
    );
  }

  const cutoff = Date.now() - range * 24 * 3600 * 1000;
  const chartData = (series || [])
    .filter((p) => new Date(p.date).getTime() >= cutoff)
    .map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString([], { month: "short", day: "numeric" }) }));

  // Reference lines for the selected range, so the trend line reads against
  // its own average/high/low instead of needing to eyeball the axis.
  const rangePrices = chartData.map((p) => p.avg_price).filter((v) => v != null);
  const avgPrice = rangePrices.length ? rangePrices.reduce((s, v) => s + v, 0) / rangePrices.length : null;
  const minPrice = rangePrices.length ? Math.min(...rangePrices) : null;
  const maxPrice = rangePrices.length ? Math.max(...rangePrices) : null;

  return (
    <div className="insights-bar">
      {!isHome && (
        <button className="insights-collapse-btn" onClick={() => setManualExpand(false)}>▴ Collapse</button>
      )}
      <div className="insights-tiles-row">
        {FUEL_TILES.map(({ key, label }) => {
          const d = insightsByFuel[key];
          const avgToday = d?.ytd_vs_today?.today_avg;
          if (avgToday == null) return null;
          const changePct = d?.ytd_vs_today?.seven_day_change_pct;
          const isSelected = selectedFuel === key;
          const trendArrow = key === "regular_gas" && bc?.trend
            ? (bc.trend === 1 ? "↑" : bc.trend === -1 ? "↓" : null)
            : (changePct > 0 ? "↑" : changePct < 0 ? "↓" : null);
          const trendCls = trendArrow === "↑" ? "insights-val-up" : trendArrow === "↓" ? "insights-val-down" : "";
          return (
            <button
              key={key}
              className={`insights-tile ${isSelected ? "insights-tile-active" : ""}`}
              onClick={() => setSelectedFuel(key)}
            >
              <span className="insights-stat-label">{label}</span>
              <span className={`insights-stat-value ${trendCls}`}>
                {trendArrow && <>{trendArrow} </>}{avgToday.toFixed(1)}¢/L
              </span>
            </button>
          );
        })}
      </div>

      {/* City selector — always visible, "Overall" first, rest by popularity */}
      <div className="insights-areas-row">
        <button
          className={`insight-area-pill insight-area-pill-clickable ${selectedArea === null ? "insight-area-pill-active" : ""}`}
          onClick={() => setSelectedArea(null)}
        >
          <span className="insight-area-name">Overall</span>
        </button>
        {rankedAreas.map((a) => (
          <button
            key={a.area}
            className={`insight-area-pill insight-area-pill-clickable ${selectedArea === a.area ? "insight-area-pill-active" : ""}`}
            onClick={() => setSelectedArea(a.area)}
          >
            <span className="insight-area-name">{a.area}</span>
            <span className="insight-area-today">{a.avg_today}¢</span>
            {a.change != null && (
              <span className={`insight-area-change ${a.change > 0 ? "delta-up" : "delta-down"}`}>
                {a.change > 0 ? "↑" : "↓"}{Math.abs(a.change)}¢
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Chart — always visible, defaults to Regular · Overall */}
      <div className="insights-chart-section">
        <div className="chart-range-row">
          {RANGES.map(({ label, days }) => (
            <button key={days} className={`chart-range-btn ${range === days ? "chart-range-active" : ""}`} onClick={() => setRange(days)}>
              {label}
            </button>
          ))}
        </div>
        {series === null ? (
          <div className="chart-state"><div className="spinner" /></div>
        ) : chartData.length === 0 ? (
          <div className="chart-state"><p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>No history yet.</p></div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2e3245" />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={40} tickFormatter={(v) => v.toFixed(0)} />
              <Tooltip formatter={(v) => `${v.toFixed(1)}¢/L`} contentStyle={{ background: "#1a1f2e", border: "1px solid #2e3245", fontSize: 12 }} />
              {avgPrice != null && (
                <ReferenceLine y={avgPrice} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={0.7}
                  label={{ value: `Avg ${avgPrice.toFixed(1)}`, position: "insideTopRight", fill: "#94a3b8", fontSize: 10 }} />
              )}
              {maxPrice != null && (
                <ReferenceLine y={maxPrice} stroke="#dc2626" strokeDasharray="3 3" strokeOpacity={0.6}
                  label={{ value: `High ${maxPrice.toFixed(1)}`, position: "insideTopLeft", fill: "#dc2626", fontSize: 10 }} />
              )}
              {minPrice != null && minPrice !== maxPrice && (
                <ReferenceLine y={minPrice} stroke="#16a34a" strokeDasharray="3 3" strokeOpacity={0.6}
                  label={{ value: `Low ${minPrice.toFixed(1)}`, position: "insideBottomLeft", fill: "#16a34a", fontSize: 10 }} />
              )}
              <Line type="monotone" dataKey="avg_price" stroke="#f97316" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "#f97316" }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
