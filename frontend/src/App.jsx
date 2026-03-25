import { useState, useEffect, useCallback } from "react";

const FUEL_TYPES = [
  { key: "regular_gas", label: "Regular" },
  { key: "midgrade_gas", label: "Mid" },
  { key: "premium_gas", label: "Premium" },
  { key: "diesel", label: "Diesel" },
];

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function formatPrice(price, unit) {
  if (price == null) return null;
  const isPerLitre = unit?.includes("litre") || unit?.includes("liter");
  return `${price.toFixed(isPerLitre ? 1 : 2)}${isPerLitre ? "¢/L" : "$/gal"}`;
}

function timeAgo(isoString) {
  if (!isoString) return "unknown";
  const diff = Math.floor((Date.now() - new Date(isoString)) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const hrs = Math.floor(diff / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function TrendBanner({ trend }) {
  if (!trend?.length) return null;
  const bc = trend.find((t) => t.country === "CA") || trend[0];
  if (!bc) return null;
  const arrow = bc.trend === 1 ? "↑" : bc.trend === -1 ? "↓" : "→";
  const color = bc.trend === 1 ? "trend-up" : bc.trend === -1 ? "trend-down" : "trend-stable";
  return (
    <div className={`trend-banner ${color}`}>
      <span className="trend-area">{bc.areaName}</span>
      <span className="trend-price">
        {arrow} Avg today: <strong>{bc.today?.toFixed(1)}</strong>
        {bc.todayLow ? ` | Low: ${bc.todayLow.toFixed(1)}` : ""}
      </span>
    </div>
  );
}

function PriceBadge({ fuelData, unit, highlight }) {
  if (!fuelData || fuelData.price == null) return <span className="badge badge-empty">—</span>;
  const display = formatPrice(fuelData.price, unit);
  return (
    <span className={`badge ${highlight ? "badge-cheapest" : ""}`} title={`Updated ${timeAgo(fuelData.last_updated)}`}>
      {display}
    </span>
  );
}

function StationCard({ station, activeFuel, cheapestPrices }) {
  const fuelData = station[activeFuel];
  const isCheapest = fuelData?.price != null && fuelData.price === cheapestPrices[activeFuel];

  return (
    <div className={`card ${isCheapest ? "card-cheapest" : ""}`}>
      {isCheapest && <div className="cheapest-tag">Cheapest</div>}
      <div className="card-header">
        <div className="station-name">{station.name}</div>
        <div className="station-address">{station.address}</div>
      </div>
      <div className="fuel-grid">
        {FUEL_TYPES.map(({ key, label }) => (
          <div key={key} className={`fuel-item ${key === activeFuel ? "fuel-active" : ""}`}>
            <span className="fuel-label">{label}</span>
            <PriceBadge
              fuelData={station[key]}
              unit={station.unit_of_measure}
              highlight={key === activeFuel && isCheapest}
            />
          </div>
        ))}
      </div>
      {fuelData?.last_updated && (
        <div className="last-updated">Updated {timeAgo(fuelData.last_updated)}</div>
      )}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState("price");
  const [activeFuel, setActiveFuel] = useState("regular_gas");
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  const stations = data?.stations ?? [];

  // Find cheapest price per fuel type
  const cheapestPrices = {};
  for (const { key } of FUEL_TYPES) {
    const prices = stations.map((s) => s[key]?.price).filter((p) => p != null);
    cheapestPrices[key] = prices.length ? Math.min(...prices) : null;
  }

  // Sort stations
  const sorted = [...stations].sort((a, b) => {
    if (sortBy === "price") {
      const pa = a[activeFuel]?.price ?? Infinity;
      const pb = b[activeFuel]?.price ?? Infinity;
      return pa - pb;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-icon">⛽</span>
            <div>
              <h1>Vancouver Gas Prices</h1>
              <p className="header-sub">Greater Vancouver Area</p>
            </div>
          </div>
          <div className="header-actions">
            {lastRefresh && (
              <span className="refresh-time">Refreshed {timeAgo(lastRefresh.toISOString())}</span>
            )}
            <button className="btn-refresh" onClick={fetchData} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {data?.trend && <TrendBanner trend={data.trend} />}

        <div className="controls">
          <div className="fuel-tabs">
            {FUEL_TYPES.map(({ key, label }) => (
              <button
                key={key}
                className={`tab ${activeFuel === key ? "tab-active" : ""}`}
                onClick={() => setActiveFuel(key)}
              >
                {label}
                {cheapestPrices[key] != null && (
                  <span className="tab-price">
                    {formatPrice(cheapestPrices[key], stations[0]?.unit_of_measure)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="sort-controls">
            <label>Sort by</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="price">Price</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="error-box">
            Failed to load data: {error}. <button onClick={fetchData}>Retry</button>
          </div>
        )}

        {loading && !data && (
          <div className="loading-box">
            <div className="spinner" />
            <p>Fetching gas prices across Vancouver...</p>
          </div>
        )}

        {data && (
          <>
            <p className="station-count">{sorted.length} stations found</p>
            <div className="grid">
              {sorted.map((station) => (
                <StationCard
                  key={station.station_id}
                  station={station}
                  activeFuel={activeFuel}
                  cheapestPrices={cheapestPrices}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
