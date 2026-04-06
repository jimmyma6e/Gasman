import { useState, useEffect } from "react";

const FUEL_LABELS = {
  regular_gas:  "Regular",
  midgrade_gas: "Mid",
  premium_gas:  "Premium",
  diesel:       "Diesel",
};

export default function InsightsPanel({ activeFuel }) {
  const [insights, setInsights] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/insights?fuel_type=${activeFuel}`)
      .then((r) => r.json())
      .then(setInsights)
      .catch(() => {});
  }, [activeFuel]);

  if (!insights) return null;

  const { area_averages, ytd_vs_today } = insights;
  const areasWithData = area_averages.filter((a) => a.avg_today != null);
  if (areasWithData.length === 0 || !ytd_vs_today.today_avg) return null;

  const fuelLabel = FUEL_LABELS[activeFuel] ?? activeFuel;

  return (
    <div className="insights-panel">
      {/* Always-visible summary bar */}
      <div className="insights-header">
        <span className="insights-title">{fuelLabel} Insights</span>
        <div className="insights-summary-pills">
          <span className="insight-pill">
            Today <strong>{ytd_vs_today.today_avg}¢/L</strong>
          </span>
          {ytd_vs_today.ytd_avg && (
            <span className="insight-pill">
              YTD <strong>{ytd_vs_today.ytd_avg}¢/L</strong>
            </span>
          )}
          {ytd_vs_today.change_pct != null && (
            <span className={`insight-pill ${ytd_vs_today.change_pct > 0 ? "pill-up" : "pill-down"}`}>
              {ytd_vs_today.change_pct > 0 ? "+" : ""}{ytd_vs_today.change_pct}% vs YTD
            </span>
          )}
        </div>
        <button
          className="insights-toggle"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse" : "Show by area"}
        >
          {expanded ? "▴" : "▾"}
        </button>
      </div>

      {/* Expanded: horizontal scrollable area pills */}
      {expanded && (
        <div className="insights-areas">
          {areasWithData.map((a) => (
            <div key={a.area} className="insight-area-pill">
              <span className="insight-area-name">{a.area}</span>
              <span className="insight-area-today">{a.avg_today}¢</span>
              {a.change != null && (
                <span className={`insight-area-change ${a.change > 0 ? "delta-up" : "delta-down"}`}>
                  {a.change > 0 ? "↑" : "↓"}{Math.abs(a.change)}¢
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
