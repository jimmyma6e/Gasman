import { useState, useEffect } from "react";

export default function InsightsPanel({ activeFuel, trend }) {
  const [regular, setRegular] = useState(null);
  const [active, setActive]   = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/insights?fuel_type=regular_gas")
      .then((r) => r.json())
      .then(setRegular)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeFuel === "regular_gas") { setActive(null); return; }
    fetch(`/api/insights?fuel_type=${activeFuel}`)
      .then((r) => r.json())
      .then(setActive)
      .catch(() => {});
  }, [activeFuel]);

  // Extract trend data (BC or first available)
  const bc = trend?.find((t) => t.country === "CA") || trend?.[0];
  const trendArrow = bc?.trend === 1 ? "↑" : bc?.trend === -1 ? "↓" : null;
  const trendCls   = bc?.trend === 1 ? "pill-up" : bc?.trend === -1 ? "pill-down" : "";

  // If no data at all, show just the trend banner if available
  if (!regular) {
    if (!bc) return null;
    return (
      <div className="insights-panel">
        <div className="insights-header">
          <span className={`insight-pill ${trendCls}`} style={{ fontWeight: 600 }}>
            {trendArrow && `${trendArrow} `}{bc.today?.toFixed(1)}¢/L avg
            {bc.todayLow ? ` · Low ${bc.todayLow.toFixed(1)}¢` : ""}
          </span>
        </div>
      </div>
    );
  }

  const { area_averages, ytd_vs_today } = regular;
  const areasWithData = (area_averages || []).filter((a) => a.avg_today != null);
  if (areasWithData.length === 0 && !bc) return null;

  const todayAvg  = ytd_vs_today?.today_avg;
  const ytdAvg    = ytd_vs_today?.ytd_avg;
  const changePct = ytd_vs_today?.change_pct;

  const activeLabel = {
    midgrade_gas: "Mid", premium_gas: "Premium", diesel: "Diesel", e85: "E85",
  }[activeFuel];
  const activeAvg = active?.ytd_vs_today?.today_avg;

  return (
    <div className="insights-panel">
      <div className="insights-header">
        {/* Trend + today avg (from trend API — real-time) */}
        {bc && (
          <span className={`insight-pill ${trendCls}`} style={{ fontWeight: 600 }}>
            {trendArrow && `${trendArrow} `}{bc.today?.toFixed(1)}¢/L
            {bc.todayLow ? ` · Low ${bc.todayLow.toFixed(1)}` : ""}
          </span>
        )}
        <div className="insights-summary-pills">
          {/* Show today avg from insights only when trend doesn't already supply it */}
          {todayAvg && !bc && (
            <span className="insight-pill">
              Today <strong>{todayAvg}¢/L</strong>
            </span>
          )}
          {ytdAvg && (
            <span className="insight-pill">
              YTD <strong>{ytdAvg}¢/L</strong>
            </span>
          )}
          {changePct != null && (
            <span className={`insight-pill ${changePct > 0 ? "pill-up" : "pill-down"}`}>
              {changePct > 0 ? "+" : ""}{changePct}% vs YTD
            </span>
          )}
          {activeLabel && activeAvg && (
            <span className="insight-pill pill-active-fuel">
              {activeLabel} <strong>{activeAvg}¢/L</strong>
            </span>
          )}
        </div>
        {areasWithData.length > 0 && (
          <button
            className="insights-toggle"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse" : "Show by area"}
          >
            {expanded ? "▴" : "▾"}
          </button>
        )}
      </div>

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
