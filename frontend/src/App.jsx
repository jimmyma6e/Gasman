import { useState, useEffect, useCallback } from "react";
import PriceChart from "./components/PriceChart";

// Map station coordinates to a neighbourhood name using nearest centroid
const AREAS = [
  { name: "Downtown Vancouver", lat: 49.2827, lng: -123.1207 },
  { name: "East Vancouver",     lat: 49.2640, lng: -123.0586 },
  { name: "North Vancouver",    lat: 49.3163, lng: -123.0724 },
  { name: "Richmond",           lat: 49.2045, lng: -123.1116 },
  { name: "Burnaby",            lat: 49.2488, lng: -122.9805 },
];

function getArea(lat, lng) {
  if (lat == null || lng == null) return "Other";
  let best = AREAS[0];
  let min = Infinity;
  for (const a of AREAS) {
    const dlat = lat - a.lat, dlng = lng - a.lng;
    const d = dlat * dlat + dlng * dlng;
    if (d < min) { min = d; best = a; }
  }
  return best.name;
}

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular" },
  { key: "midgrade_gas", label: "Mid" },
  { key: "premium_gas",  label: "Premium" },
  { key: "diesel",       label: "Diesel" },
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

// ---------- Trend Banner ----------
function TrendBanner({ trend }) {
  if (!trend?.length) return null;
  const bc = trend.find((t) => t.country === "CA") || trend[0];
  if (!bc) return null;
  const arrow = bc.trend === 1 ? "↑" : bc.trend === -1 ? "↓" : "→";
  const cls = bc.trend === 1 ? "trend-up" : bc.trend === -1 ? "trend-down" : "trend-stable";
  return (
    <div className={`trend-banner ${cls}`}>
      <span className="trend-area">{bc.areaName}</span>
      <span className="trend-price">
        {arrow} Avg today: <strong>{bc.today?.toFixed(1)}</strong>
        {bc.todayLow ? ` · Low: ${bc.todayLow.toFixed(1)}` : ""}
      </span>
    </div>
  );
}

// ---------- Chart Modal ----------
function ChartModal({ station, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{station.name}</h2>
            <p className="modal-address">{station.address}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Current prices summary */}
        <div className="modal-prices">
          {FUEL_TYPES.map(({ key, label }) => {
            const price = station[key]?.price;
            return price != null ? (
              <div key={key} className="modal-price-chip">
                <span className="modal-price-label">{label}</span>
                <span className="modal-price-value">
                  {formatPrice(price, station.unit_of_measure)}
                </span>
              </div>
            ) : null;
          })}
        </div>

        <h3 className="modal-chart-title">Price Today</h3>
        <PriceChart stationId={station.station_id} />
      </div>
    </div>
  );
}

// ---------- Station Card ----------
function StationCard({ station, activeFuel, cheapestPrices, isFavourite, onToggleFavourite, onOpenChart, showArea }) {
  const fuelData = station[activeFuel];
  const isCheapest = fuelData?.price != null && fuelData.price === cheapestPrices[activeFuel];

  return (
    <div className={`card ${isCheapest ? "card-cheapest" : ""}`}>
      {isCheapest && <div className="cheapest-tag">Cheapest</div>}

      <div className="card-top">
        <div className="card-header">
          <div className="station-name">{station.name}</div>
          <div className="station-address">{station.address}</div>
          {showArea && <div className="station-area">{station._area}</div>}
        </div>
        <button
          className={`btn-fav ${isFavourite ? "btn-fav-active" : ""}`}
          onClick={() => onToggleFavourite(station.station_id)}
          title={isFavourite ? "Remove from My Stations" : "Add to My Stations"}
        >
          {isFavourite ? "★" : "☆"}
        </button>
      </div>

      <div className="fuel-grid">
        {FUEL_TYPES.map(({ key, label }) => {
          const price = station[key]?.price;
          return (
            <div key={key} className={`fuel-item ${key === activeFuel ? "fuel-active" : ""}`}>
              <span className="fuel-label">{label}</span>
              {price != null ? (
                <span className={`badge ${key === activeFuel && isCheapest ? "badge-cheapest" : ""}`}>
                  {formatPrice(price, station.unit_of_measure)}
                </span>
              ) : (
                <span className="badge badge-empty">—</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="card-footer">
        {fuelData?.last_updated && (
          <span className="last-updated">Updated {timeAgo(fuelData.last_updated)}</span>
        )}
        <button className="btn-chart" onClick={() => onOpenChart(station)}>
          📈 Price History
        </button>
      </div>
    </div>
  );
}

// ---------- App ----------
export default function App() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]         = useState("all");   // "all" | "mine"
  const [sortBy, setSortBy]   = useState("price");
  const [activeFuel, setActiveFuel] = useState("regular_gas");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [chartStation, setChartStation] = useState(null);
  const [search, setSearch]   = useState("");
  const [areaFilter, setAreaFilter] = useState("all");

  const [favourites, setFavourites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-favourites") || "[]"); }
    catch { return []; }
  });

  const toggleFavourite = useCallback((id) => {
    setFavourites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem("gasman-favourites", JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

  const allStations = data?.stations ?? [];

  // Attach area to each station
  const stationsWithArea = allStations.map((s) => ({
    ...s,
    _area: getArea(s.latitude, s.longitude),
  }));

  // Cheapest price per fuel type
  const cheapestPrices = {};
  for (const { key } of FUEL_TYPES) {
    const prices = allStations.map((s) => s[key]?.price).filter((p) => p != null);
    cheapestPrices[key] = prices.length ? Math.min(...prices) : null;
  }

  // Filter
  const q = search.trim().toLowerCase();
  const filtered = stationsWithArea.filter((s) => {
    if (tab === "mine" && !favourites.includes(s.station_id)) return false;
    if (areaFilter !== "all" && s._area !== areaFilter) return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.address.toLowerCase().includes(q)) return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "price") {
      const pa = a[activeFuel]?.price ?? Infinity;
      const pb = b[activeFuel]?.price ?? Infinity;
      return pa - pb;
    }
    if (sortBy === "city") {
      const cmp = a._area.localeCompare(b._area);
      if (cmp !== 0) return cmp;
      const pa = a[activeFuel]?.price ?? Infinity;
      const pb = b[activeFuel]?.price ?? Infinity;
      return pa - pb;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="app">
      {/* Header */}
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

        {/* Tabs */}
        <div className="tabs-row">
          <div className="tabs">
            <button
              className={`tab-nav ${tab === "all" ? "tab-nav-active" : ""}`}
              onClick={() => setTab("all")}
            >
              All Stations
              {allStations.length > 0 && <span className="tab-badge">{allStations.length}</span>}
            </button>
            <button
              className={`tab-nav ${tab === "mine" ? "tab-nav-active" : ""}`}
              onClick={() => setTab("mine")}
            >
              ★ My Stations
              {favourites.length > 0 && <span className="tab-badge">{favourites.length}</span>}
            </button>
          </div>
        </div>

        {/* Search + Area filter */}
        <div className="search-row">
          <input
            className="search-input"
            type="search"
            placeholder="Search stations or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="area-select"
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
          >
            <option value="all">All Areas</option>
            {AREAS.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Controls */}
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
                    {formatPrice(cheapestPrices[key], allStations[0]?.unit_of_measure)}
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
              <option value="city">City / Area</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="error-box">
            Failed to load: {error}.{" "}
            <button onClick={fetchData}>Retry</button>
          </div>
        )}

        {loading && !data && (
          <div className="loading-box">
            <div className="spinner" />
            <p>Fetching gas prices across Vancouver...</p>
          </div>
        )}

        {tab === "mine" && favourites.length === 0 && (
          <div className="empty-state">
            <p style={{ fontSize: "2.5rem" }}>☆</p>
            <p><strong>No favourite stations yet</strong></p>
            <p>Click the ☆ on any station to add it here.</p>
          </div>
        )}

        {data && sorted.length > 0 && (
          <>
            <p className="station-count">{sorted.length} station{sorted.length !== 1 ? "s" : ""}</p>
            <div className="grid">
              {sorted.map((station) => (
                <StationCard
                  key={station.station_id}
                  station={station}
                  activeFuel={activeFuel}
                  cheapestPrices={cheapestPrices}
                  isFavourite={favourites.includes(station.station_id)}
                  onToggleFavourite={toggleFavourite}
                  onOpenChart={setChartStation}
                  showArea={sortBy === "city"}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {chartStation && (
        <ChartModal station={chartStation} onClose={() => setChartStation(null)} />
      )}
    </div>
  );
}
