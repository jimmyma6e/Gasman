const FUEL_LABELS = {
  regular_gas:  "Regular (87)",
  midgrade_gas: "Mid (89)",
  premium_gas:  "Premium (91)",
  diesel:       "Diesel",
};

function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default function LogsTab({ fillups, onDelete, onNavigate }) {
  const month = thisMonth();

  // ── Stats ────────────────────────────────────────────────────────────────────
  const monthFillups  = fillups.filter((f) => f.date?.startsWith(month));
  const monthSaved    = monthFillups.reduce((s, f) => s + (f.total_saved > 0 ? f.total_saved : 0), 0);
  const monthSpent    = monthFillups.reduce((s, f) => s + (f.total_cost || 0), 0);
  const monthLitres   = monthFillups.reduce((s, f) => s + (f.litres || 0), 0);

  const overallSaved  = fillups.reduce((s, f) => s + (f.total_saved > 0 ? f.total_saved : 0), 0);
  const overallSpent  = fillups.reduce((s, f) => s + (f.total_cost || 0), 0);
  const overallLitres = fillups.reduce((s, f) => s + (f.litres || 0), 0);
  const fillupCount   = fillups.length;

  // Group by month for history display
  const grouped = fillups.reduce((acc, f) => {
    const key = f.date ? f.date.slice(0, 7) : "Unknown";
    (acc[key] = acc[key] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="logs-tab">

      {/* ── Stats cards ── */}
      <div className="logs-stats-grid">
        <div className="logs-stat-card logs-stat-highlight">
          <div className="logs-stat-label">💸 Saved this month</div>
          <div className="logs-stat-value">${monthSaved.toFixed(2)}</div>
          <div className="logs-stat-sub">vs average price</div>
        </div>
        <div className="logs-stat-card">
          <div className="logs-stat-label">⛽ Spent this month</div>
          <div className="logs-stat-value">${monthSpent.toFixed(2)}</div>
          <div className="logs-stat-sub">{monthLitres.toFixed(0)}L · {monthFillups.length} fill-up{monthFillups.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="logs-stat-card">
          <div className="logs-stat-label">💸 Total saved</div>
          <div className="logs-stat-value">${overallSaved.toFixed(2)}</div>
          <div className="logs-stat-sub">all time vs avg</div>
        </div>
        <div className="logs-stat-card">
          <div className="logs-stat-label">📊 All time</div>
          <div className="logs-stat-value">${overallSpent.toFixed(2)}</div>
          <div className="logs-stat-sub">{overallLitres.toFixed(0)}L · {fillupCount} fill-up{fillupCount !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* ── Empty state ── */}
      {fillups.length === 0 && (
        <div className="logs-empty">
          <div className="logs-empty-icon">⛽</div>
          <p className="logs-empty-title">No fill-ups logged yet</p>
          <p className="logs-empty-sub">Tap "⛽ Log Fill-up" on any station to start tracking your spending and savings.</p>
          <button className="btn-refresh" style={{ marginTop: 16 }} onClick={() => onNavigate("all")}>
            Browse Stations
          </button>
        </div>
      )}

      {/* ── History grouped by month ── */}
      {Object.entries(grouped)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([monthKey, entries]) => {
          const mSaved = entries.reduce((s, f) => s + (f.total_saved > 0 ? f.total_saved : 0), 0);
          const mSpent = entries.reduce((s, f) => s + (f.total_cost || 0), 0);
          const [yr, mo] = monthKey.split("-");
          const label = new Date(parseInt(yr), parseInt(mo) - 1, 1)
            .toLocaleDateString("en-CA", { month: "long", year: "numeric" });
          return (
            <div key={monthKey} className="logs-month-group">
              <div className="logs-month-header">
                <span className="logs-month-label">{label}</span>
                <span className="logs-month-meta">
                  {mSpent > 0 && <span>${mSpent.toFixed(2)} spent</span>}
                  {mSaved > 0 && <span className="logs-month-saved"> · 💸 ${mSaved.toFixed(2)} saved</span>}
                </span>
              </div>
              <div className="logs-entries">
                {entries.map((f) => (
                  <div key={f.id} className="log-entry">
                    <div className="log-entry-left">
                      <div className="log-entry-top">
                        <span className="log-entry-station">{f.station_name}</span>
                        <span className="log-entry-date">{formatDate(f.date)}</span>
                      </div>
                      <div className="log-entry-meta">
                        {FUEL_LABELS[f.fuel_type] || f.fuel_type} · {f.price_cpl}¢/L
                        {f.vehicle_name && <span className="log-entry-vehicle"> · {f.vehicle_name}</span>}
                        {f.price_was_edited && <span className="fillup-contrib-badge">📝</span>}
                      </div>
                      {f.litres && (
                        <div className="log-entry-cost">
                          {f.litres}L
                          {f.total_cost ? ` · $${f.total_cost.toFixed(2)}` : ""}
                          {f.total_saved > 0 && (
                            <span className="log-entry-saved"> · 💸 saved ${f.total_saved.toFixed(2)}</span>
                          )}
                        </div>
                      )}
                      {f.notes && <div className="log-entry-notes">{f.notes}</div>}
                    </div>
                    <button className="btn-delete-snapshot" onClick={() => onDelete(f.id)} title="Delete">×</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
