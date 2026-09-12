import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular" },
  { key: "midgrade_gas", label: "Mid" },
  { key: "premium_gas",  label: "Premium" },
  { key: "diesel",       label: "Diesel" },
];

const DRILLDOWN_RANGES = [
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function AreaDrilldown({ area, fuelLabel, fuelKey, onClose }) {
  const [range, setRange] = useState(30);
  const [series, setSeries] = useState(null);

  useEffect(() => {
    setSeries(null);
    fetch(`/api/insights/history?area=${encodeURIComponent(area)}&fuel_type=${fuelKey}&days=30`)
      .then((r) => r.json())
      .then((data) => setSeries(data.series || []))
      .catch(() => setSeries([]));
  }, [area, fuelKey]);

  const cutoff = Date.now() - range * 24 * 3600 * 1000;
  const chartData = (series || [])
    .filter((p) => new Date(p.date).getTime() >= cutoff)
    .map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString([], { month: "short", day: "numeric" }) }));

  return (
    <div className="insights-drilldown">
      <div className="insights-drilldown-header">
        <span><strong>{area}</strong> · {fuelLabel}</span>
        <button className="insights-drilldown-close" onClick={onClose}>✕</button>
      </div>
      <div className="chart-range-row">
        {DRILLDOWN_RANGES.map(({ label, days }) => (
          <button key={days} className={`chart-range-btn ${range === days ? "chart-range-active" : ""}`} onClick={() => setRange(days)}>
            {label}
          </button>
        ))}
      </div>
      {series === null ? (
        <div className="chart-state"><div className="spinner" /></div>
      ) : chartData.length === 0 ? (
        <div className="chart-state"><p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>No history yet for this area.</p></div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2e3245" />
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 10 }} width={40} tickFormatter={(v) => v.toFixed(0)} />
            <Tooltip formatter={(v) => `${v.toFixed(1)}¢/L`} contentStyle={{ background: "#1a1f2e", border: "1px solid #2e3245", fontSize: 12 }} />
            <Line type="monotone" dataKey="avg_price" stroke="#f97316" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "#f97316" }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function InsightsCities({ insightsByFuel, selectedFuel, userCoords, onSelectCity }) {
  const data = insightsByFuel[selectedFuel];
  const areas = (data?.area_averages || []).filter((a) => a.avg_today != null);
  if (!areas.length) return null;

  const sorted = userCoords
    ? [...areas].sort((a, b) =>
        haversineKm(userCoords.lat, userCoords.lng, a.latitude, a.longitude) -
        haversineKm(userCoords.lat, userCoords.lng, b.latitude, b.longitude))
    : [...areas].sort((a, b) => a.area.localeCompare(b.area));

  return (
    <div className="insights-areas-row">
      {sorted.map((a) => (
        <button key={a.area} className="insight-area-pill insight-area-pill-clickable" onClick={() => onSelectCity(a.area)}>
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
  );
}

export default function InsightsPanel({ trend, activeFuel, setActiveFuel, userCoords }) {
  const [insightsByFuel, setInsightsByFuel] = useState({});
  const [expanded, setExpanded] = useState(false);
  const [drilldownArea, setDrilldownArea] = useState(null);

  useEffect(() => {
    FUEL_TYPES.forEach(({ key }) => {
      fetch(`/api/insights?fuel_type=${key}`)
        .then((r) => r.json())
        .then((data) => setInsightsByFuel((prev) => ({ ...prev, [key]: data })))
        .catch(() => {});
    });
  }, []);

  // BC trend from GasBuddy — used only as a small arrow hint on Regular,
  // since it's the one fuel GasBuddy itself reports an overall trend for.
  const bc = trend?.find((t) => t.country === "CA") || trend?.[0];

  const selected = insightsByFuel[activeFuel];
  const hasAreaData = (selected?.area_averages || []).some((a) => a.avg_today != null);

  const anyLoaded = Object.keys(insightsByFuel).length > 0;
  if (!anyLoaded) return null;

  return (
    <div className="insights-bar">
      <div className="insights-tiles-row">
        {FUEL_TYPES.map(({ key, label }) => {
          const d = insightsByFuel[key];
          const avgToday = d?.ytd_vs_today?.today_avg;
          if (avgToday == null) return null;
          const changePct = d?.ytd_vs_today?.seven_day_change_pct;
          const isSelected = activeFuel === key;
          const trendArrow = key === "regular_gas" && bc?.trend
            ? (bc.trend === 1 ? "↑" : bc.trend === -1 ? "↓" : null)
            : (changePct > 0 ? "↑" : changePct < 0 ? "↓" : null);
          const trendCls = trendArrow === "↑" ? "insights-val-up" : trendArrow === "↓" ? "insights-val-down" : "";
          return (
            <button
              key={key}
              className={`insights-tile ${isSelected ? "insights-tile-active" : ""}`}
              onClick={() => setActiveFuel(key)}
            >
              <span className="insights-stat-label">{label}</span>
              <span className={`insights-stat-value ${trendCls}`}>
                {trendArrow && <>{trendArrow} </>}{avgToday.toFixed(1)}¢/L
              </span>
            </button>
          );
        })}

        {hasAreaData && (
          <button
            className="insights-expand"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse" : "By city"}
          >
            {expanded ? "▴" : "▾"}
          </button>
        )}
      </div>

      {/* City breakdown for the selected grade only — tap a city for its
          own price-over-time chart. */}
      {expanded && (
        <InsightsCities
          insightsByFuel={insightsByFuel}
          selectedFuel={activeFuel}
          userCoords={userCoords}
          onSelectCity={setDrilldownArea}
        />
      )}

      {drilldownArea && (
        <AreaDrilldown
          area={drilldownArea}
          fuelKey={activeFuel}
          fuelLabel={FUEL_TYPES.find((f) => f.key === activeFuel)?.label ?? activeFuel}
          onClose={() => setDrilldownArea(null)}
        />
      )}
    </div>
  );
}
