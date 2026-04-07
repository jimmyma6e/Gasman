import { useState, useEffect } from "react";

export default function InsightsPanel({ activeFuel }) {
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

  if (!regular) return null;

  const { area_averages, ytd_vs_today } = regular;
  const areasWithData = (area_averages || []).filter((a) => a.avg_today != null);
  if (areasWithData.length === 0) return null;

  const todayAvg = ytd_vs_today?.today_avg;
  const ytdAvg   = ytd_vs_today?.ytd_avg;
  const changePct = ytd_vs_today?.change_pct;

  // Active fuel label (for secondary pill, when not regular)
  const activeLabel = {
    midgrade_gas: "Mid", premium_gas: "Premium", diesel: "Diesel", e85: "E85",
  }[activeFuel];
  const activeAvg = active?.ytd_vs_today?.today_avg;

  return (
    <div className="insights-panel">
      <div className="insights-header">
        <span className="insights-title">Regular Insights</span>
        <div className="insights-summary-pills">
          {todayAvg && (
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
        <button
          className="insights-toggle"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse" : "Show by area"}
        >
          {expanded ? "▴" : "▾"}
        </button>
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
