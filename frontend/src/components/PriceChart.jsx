import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";

const FUEL_CONFIG = {
  regular_gas:  { label: "Regular",  color: "#f59e0b" },
  midgrade_gas: { label: "Mid",      color: "#3b82f6" },
  premium_gas:  { label: "Premium",  color: "#8b5cf6" },
  diesel:       { label: "Diesel",   color: "#22c55e" },
};

const RANGES = [
  { label: "24h",  hours: 24  },
  { label: "7d",   hours: 168 },
  { label: "30d",  hours: 720 },
];

function bucketKey(date, hours) {
  if (hours <= 24) {
    const d = new Date(date);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }
  if (hours <= 168) {
    const d = new Date(date);
    d.setHours(Math.floor(d.getHours() / 6) * 6, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatBucketLabel(isoKey, hours) {
  const d = new Date(isoKey);
  if (hours <= 24) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (hours <= 168) return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function timeAgoShort(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-time">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: <strong>{entry.value?.toFixed(1)}</strong>
        </p>
      ))}
    </div>
  );
}

export default function PriceChart({ stationId, activeFuel }) {
  const [range, setRange]     = useState(168); // default 7-day view
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setHistory(null);
    fetch(`/api/history/${stationId}?hours=${range}`)
      .then((r) => r.json())
      .then((data) => { setHistory(data.history); setLoading(false); })
      .catch(() => setLoading(false));
  }, [stationId, range]);

  const rangeBar = (
    <div className="chart-range-row">
      {RANGES.map(({ label, hours }) => (
        <button key={hours} className={`chart-range-btn ${range === hours ? "chart-range-active" : ""}`} onClick={() => setRange(hours)}>
          {label}
        </button>
      ))}
    </div>
  );

  if (loading) return <div>{rangeBar}<div className="chart-state"><div className="spinner" /><p>Loading price history...</p></div></div>;

  if (!history?.length) return (
    <div>{rangeBar}<div className="chart-state"><p style={{ fontSize: "2rem" }}>📊</p><p><strong>No history yet for this range</strong></p><p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>Price data is collected every 30 minutes.<br />Check back soon!</p></div></div>
  );

  const bucketMap = {};
  const bucketCount = {};
  for (const h of history) {
    const key = bucketKey(new Date(h.recorded_at), range);
    if (!bucketMap[key]) { bucketMap[key] = { _ts: new Date(key).getTime(), time: formatBucketLabel(key, range) }; bucketCount[key] = {}; }
    if (h.price != null) { bucketMap[key][h.fuel_type] = (bucketMap[key][h.fuel_type] ?? 0) + h.price; bucketCount[key][h.fuel_type] = (bucketCount[key][h.fuel_type] ?? 0) + 1; }
  }
  for (const [key, bucket] of Object.entries(bucketMap)) {
    for (const fuel of Object.keys(FUEL_CONFIG)) {
      if (bucket[fuel] != null && bucketCount[key][fuel] > 1) bucket[fuel] = bucket[fuel] / bucketCount[key][fuel];
    }
  }
  const chartData = Object.values(bucketMap).sort((a, b) => a._ts - b._ts);

  // Stats for active fuel (or all prices if no activeFuel)
  const fuelForStats = activeFuel ?? Object.keys(FUEL_CONFIG)[0];
  const activePrices = history.filter((h) => h.fuel_type === fuelForStats && h.price != null).map((h) => h.price);
  const minPrice = activePrices.length ? Math.min(...activePrices) : null;
  const maxPrice = activePrices.length ? Math.max(...activePrices) : null;
  const firstPrice = activePrices[0];
  const lastPrice  = activePrices[activePrices.length - 1];
  const change = (firstPrice != null && lastPrice != null) ? lastPrice - firstPrice : null;

  // Last recorded timestamp across all history
  const lastTs = history.reduce((best, h) => {
    const t = new Date(h.recorded_at).getTime();
    return t > best ? t : best;
  }, 0);
  const lastTsIso = lastTs ? new Date(lastTs).toISOString() : null;

  const unit = history[0]?.unit ?? "";
  const unitLabel = (unit.includes("litre") || unit.includes("liter")) ? "¢/L" : "$/gal";
  const rangeLabel = RANGES.find((r) => r.hours === range)?.label ?? "";

  return (
    <div>
      {rangeBar}
      <div className="chart-stats-row">
        {minPrice != null && <div className="chart-stat"><span className="chart-stat-label">{rangeLabel} Low</span><span className="chart-stat-value green">{minPrice.toFixed(1)}{unitLabel}</span></div>}
        {maxPrice != null && <div className="chart-stat"><span className="chart-stat-label">{rangeLabel} High</span><span className="chart-stat-value red">{maxPrice.toFixed(1)}{unitLabel}</span></div>}
        {change !== null && <div className="chart-stat"><span className="chart-stat-label">Change</span><span className={`chart-stat-value ${change > 0 ? "red" : change < 0 ? "green" : ""}`}>{change > 0 ? "+" : ""}{change.toFixed(1)}{unitLabel}</span></div>}
        {lastTsIso && <div className="chart-stat"><span className="chart-stat-label">Last data</span><span className="chart-stat-value">{timeAgoShort(lastTsIso)}</span></div>}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2e3245" />
          <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 11 }} width={48} tickFormatter={(v) => v.toFixed(1)} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12, color: "#94a3b8" }} />
          {minPrice != null && <ReferenceLine y={minPrice} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />}
          {Object.entries(FUEL_CONFIG).map(([key, { label, color }]) => {
            const isActive = activeFuel ? key === activeFuel : true;
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={isActive ? 2.5 : 1.5}
                strokeOpacity={isActive ? 1 : 0.35}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
