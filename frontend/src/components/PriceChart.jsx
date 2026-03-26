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

export default function PriceChart({ stationId }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/history/${stationId}`)
      .then((r) => r.json())
      .then((data) => { setHistory(data.history); setLoading(false); })
      .catch(() => setLoading(false));
  }, [stationId]);

  if (loading) {
    return (
      <div className="chart-state">
        <div className="spinner" />
        <p>Loading price history...</p>
      </div>
    );
  }

  if (!history?.length) {
    return (
      <div className="chart-state">
        <p style={{ fontSize: "2rem" }}>📊</p>
        <p><strong>No history yet</strong></p>
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          Price data is collected every 30 minutes.<br />Check back soon!
        </p>
      </div>
    );
  }

  // Pivot: { time → { regular_gas: price, ... } }
  const timeMap = {};
  for (const h of history) {
    const d = new Date(h.recorded_at);
    const key = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (!timeMap[key]) timeMap[key] = { time: key, _ts: d.getTime() };
    timeMap[key][h.fuel_type] = h.price;
  }
  const chartData = Object.values(timeMap).sort((a, b) => a._ts - b._ts);

  // Stats
  const prices = history.map((h) => h.price).filter(Boolean);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const firstPrice = history[0]?.price;
  const lastPrice  = history[history.length - 1]?.price;
  const change = lastPrice && firstPrice ? lastPrice - firstPrice : null;

  const unit = history[0]?.unit ?? "";
  const isPerLitre = unit.includes("litre") || unit.includes("liter");
  const unitLabel = isPerLitre ? "¢/L" : "$/gal";

  return (
    <div>
      {/* Summary stats */}
      <div className="chart-stats-row">
        <div className="chart-stat">
          <span className="chart-stat-label">Today's Low</span>
          <span className="chart-stat-value green">{minPrice.toFixed(1)}{unitLabel}</span>
        </div>
        <div className="chart-stat">
          <span className="chart-stat-label">Today's High</span>
          <span className="chart-stat-value red">{maxPrice.toFixed(1)}{unitLabel}</span>
        </div>
        {change !== null && (
          <div className="chart-stat">
            <span className="chart-stat-label">Change Today</span>
            <span className={`chart-stat-value ${change > 0 ? "red" : change < 0 ? "green" : ""}`}>
              {change > 0 ? "+" : ""}{change.toFixed(1)}{unitLabel}
            </span>
          </div>
        )}
        <div className="chart-stat">
          <span className="chart-stat-label">Data Points</span>
          <span className="chart-stat-value">{chartData.length}</span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2e3245" />
          <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            width={48}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: 8, fontSize: 12, color: "#94a3b8" }}
          />
          <ReferenceLine y={minPrice} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
          {Object.entries(FUEL_CONFIG).map(([key, { label, color }]) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={label}
              stroke={color}
              strokeWidth={2}
              dot={chartData.length < 5}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
