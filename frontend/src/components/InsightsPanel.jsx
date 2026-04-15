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

  // Extract BC trend data
  const bc = trend?.find((t) => t.country === "CA") || trend?.[0];
  const trendArrow = bc?.trend === 1 ? "↑" : bc?.trend === -1 ? "↓" : null;
  const trendCls   = bc?.trend === 1 ? "insights-val-up" : bc?.trend === -1 ? "insights-val-down" : "";

  const todayAvg  = regular?.ytd_vs_today?.today_avg  ?? bc?.today;
  const ytdAvg    = regular?.ytd_vs_today?.ytd_avg;
  const changePct = regular?.ytd_vs_today?.change_pct;
  const areasWithData = (regular?.area_averages || []).filter((a) => a.avg_today != null);

  const activeLabel = { midgrade_gas: "Mid", premium_gas: "Premium", diesel: "Diesel" }[activeFuel];
  const activeAvg   = active?.ytd_vs_today?.today_avg;

  if (!todayAvg && !bc) return null;

  return (
    <div className="insights-bar">
      {/* Today avg — colored by trend direction */}
      <div className="insights-stat">
        <span className="insights-stat-label">Regular</span>
        <span className={`insights-stat-value ${trendCls}`}>
          {trendArrow && <>{trendArrow} </>}{todayAvg?.toFixed(1)}¢/L
        </span>
      </div>

      {/* Today low — from trend data */}
      {bc?.todayLow != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">Low today</span>
            <span className="insights-stat-value insights-val-down">{bc.todayLow.toFixed(1)}¢/L</span>
          </div>
        </>
      )}

      {ytdAvg && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">YTD avg</span>
            <span className="insights-stat-value">{ytdAvg}¢/L</span>
          </div>
        </>
      )}

      {changePct != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">vs YTD</span>
            <span className={`insights-stat-value ${changePct > 0 ? "insights-val-up" : "insights-val-down"}`}>
              {changePct > 0 ? "+" : ""}{changePct}%
            </span>
          </div>
        </>
      )}

      {activeLabel && activeAvg && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">{activeLabel}</span>
            <span className="insights-stat-value">{activeAvg}¢/L</span>
          </div>
        </>
      )}

      {areasWithData.length > 0 && (
        <button
          className="insights-expand"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse" : "By area"}
        >
          {expanded ? "▴" : "▾"}
        </button>
      )}

      {/* Area breakdown — full-width row below */}
      {expanded && (
        <div className="insights-areas-row">
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
