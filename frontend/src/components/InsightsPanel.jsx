import { useState, useEffect } from "react";

const FUEL_LABELS = {
  regular_gas:  "Regular",
  midgrade_gas: "Mid",
  premium_gas:  "Premium",
  diesel:       "Diesel",
};

export default function InsightsPanel({ activeFuel }) {
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    fetch(`/api/insights?fuel_type=${activeFuel}`)
      .then((r) => r.json())
      .then(setInsights)
      .catch(() => {});
  }, [activeFuel]);

  if (!insights) return null;

  const { area_averages, ytd_vs_today } = insights;
  const hasAnyData = area_averages.some((a) => a.avg_today != null);
  if (!hasAnyData) return null;

  const fuelLabel = FUEL_LABELS[activeFuel] ?? activeFuel;

  return (
    <div className="insights-panel">
      <div className="insights-header">
        <span className="insights-title">{fuelLabel} Price Insights</span>
        {ytd_vs_today.today_avg && (
          <div className="insights-summary-pills">
            <span className="insight-pill">Today avg <strong>{ytd_vs_today.today_avg}¢/L</strong></span>
            {ytd_vs_today.ytd_avg && (
              <span className="insight-pill">YTD avg <strong>{ytd_vs_today.ytd_avg}¢/L</strong></span>
            )}
            {ytd_vs_today.change_pct != null && (
              <span className={`insight-pill ${ytd_vs_today.change_pct > 0 ? "pill-up" : "pill-down"}`}>
                vs YTD {ytd_vs_today.change_pct > 0 ? "+" : ""}{ytd_vs_today.change_pct}%
              </span>
            )}
          </div>
        )}
      </div>

      <div className="insights-areas">
        {area_averages.filter((a) => a.avg_today != null).map((a) => (
          <div key={a.area} className="insight-area-card">
            <div className="insight-area-name">{a.area}</div>
            <div className="insight-area-today">{a.avg_today}¢</div>
            {a.change != null && (
              <div className={`insight-area-change ${a.change > 0 ? "delta-up" : "delta-down"}`}>
                {a.change > 0 ? "↑" : "↓"}{Math.abs(a.change)}¢ vs YTD
              </div>
            )}
            {a.avg_ytd != null && (
              <div className="insight-area-ytd">YTD {a.avg_ytd}¢</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
