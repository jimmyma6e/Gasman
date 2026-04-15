import { useState, useEffect } from "react";

function InsightsCities({ regular, premium }) {
  const regMap = {};
  for (const a of regular?.area_averages || []) {
    if (a.avg_today != null) regMap[a.area] = a;
  }
  const preMap = {};
  for (const a of premium?.area_averages || []) {
    if (a.avg_today != null) preMap[a.area] = a;
  }
  const areas = Object.keys(regMap).sort();
  if (!areas.length) return null;

  return (
    <div className="insights-areas-row">
      {areas.map((area) => {
        const reg = regMap[area];
        const pre = preMap[area];
        return (
          <div key={area} className="insight-area-pill">
            <span className="insight-area-name">{area}</span>
            {/* Regular price + YTD delta */}
            <span className="insight-area-today">{reg.avg_today}¢</span>
            {reg.change != null && (
              <span className={`insight-area-change ${reg.change > 0 ? "delta-up" : "delta-down"}`}>
                {reg.change > 0 ? "↑" : "↓"}{Math.abs(reg.change)}¢
              </span>
            )}
            {/* Premium price + YTD delta */}
            {pre && (
              <>
                <span className="insight-area-sep">·</span>
                <span className="insight-area-today insight-area-premium">{pre.avg_today}¢</span>
                {pre.change != null && (
                  <span className={`insight-area-change ${pre.change > 0 ? "delta-up" : "delta-down"}`}>
                    {pre.change > 0 ? "↑" : "↓"}{Math.abs(pre.change)}¢
                  </span>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function InsightsPanel({ trend }) {
  const [regular, setRegular] = useState(null);
  const [premium, setPremium] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/insights?fuel_type=regular_gas")
      .then((r) => r.json())
      .then(setRegular)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/insights?fuel_type=premium_gas")
      .then((r) => r.json())
      .then(setPremium)
      .catch(() => {});
  }, []);

  // BC trend from GasBuddy
  const bc = trend?.find((t) => t.country === "CA") || trend?.[0];
  const trendArrow = bc?.trend === 1 ? "↑" : bc?.trend === -1 ? "↓" : null;
  const trendCls   = bc?.trend === 1 ? "insights-val-up" : bc?.trend === -1 ? "insights-val-down" : "";

  // Derived stats
  const regularAvg = regular?.ytd_vs_today?.today_avg ?? bc?.today;
  const premiumAvg = premium?.ytd_vs_today?.today_avg;
  const todayLow   = bc?.todayLow;
  const todayHigh  = (() => {
    const vals = (regular?.area_averages || []).map((a) => a.avg_today).filter((v) => v != null);
    return vals.length ? Math.max(...vals) : null;
  })();
  const vsYTD = regular?.ytd_vs_today?.change_pct;
  const vs7d  = regular?.ytd_vs_today?.seven_day_change_pct;

  const hasAreaData = (regular?.area_averages || []).some((a) => a.avg_today != null);

  if (!regularAvg && !bc) return null;

  return (
    <div className="insights-bar">

      {/* Avg Regular — colored by trend direction */}
      <div className="insights-stat">
        <span className="insights-stat-label">Avg Regular</span>
        <span className={`insights-stat-value ${trendCls}`}>
          {trendArrow && <>{trendArrow} </>}{regularAvg?.toFixed(1)}¢/L
        </span>
      </div>

      {premiumAvg != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">Avg Premium</span>
            <span className="insights-stat-value">{premiumAvg.toFixed(1)}¢/L</span>
          </div>
        </>
      )}

      {todayLow != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">Low today</span>
            <span className="insights-stat-value insights-val-down">{todayLow.toFixed(1)}¢/L</span>
          </div>
        </>
      )}

      {todayHigh != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">High today</span>
            <span className="insights-stat-value insights-val-up">{todayHigh.toFixed(1)}¢/L</span>
          </div>
        </>
      )}

      {vsYTD != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">vs YTD</span>
            <span className={`insights-stat-value ${vsYTD > 0 ? "insights-val-up" : "insights-val-down"}`}>
              {vsYTD > 0 ? "+" : ""}{vsYTD}%
            </span>
          </div>
        </>
      )}

      {vs7d != null && (
        <>
          <div className="insights-divider" />
          <div className="insights-stat">
            <span className="insights-stat-label">vs 7 days</span>
            <span className={`insights-stat-value ${vs7d > 0 ? "insights-val-up" : "insights-val-down"}`}>
              {vs7d > 0 ? "+" : ""}{vs7d}%
            </span>
          </div>
        </>
      )}

      {hasAreaData && (
        <button
          className="insights-expand"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse" : "By city"}
        >
          {expanded ? "▴" : "▾"}
        </button>
      )}

      {/* City breakdown — full-width row below the stats */}
      {expanded && <InsightsCities regular={regular} premium={premium} />}
    </div>
  );
}
