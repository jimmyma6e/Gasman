import { useState, useEffect, useCallback } from "react";
import PriceChart from "./components/PriceChart";
import StationTable from "./components/StationTable";
import InsightsPanel from "./components/InsightsPanel";

const AREAS = [
  { name: "Downtown Vancouver", lat: 49.2827, lng: -123.1207 },
  { name: "East Vancouver",     lat: 49.2488, lng: -122.9805 },
  { name: "North Vancouver",    lat: 49.3163, lng: -123.0724 },
  { name: "Richmond / Delta",   lat: 49.2045, lng: -123.1116 },
  { name: "Surrey / Langley",   lat: 49.1044, lng: -122.8000 },
  { name: "Fraser Valley",      lat: 49.1200, lng: -122.0500 },
  { name: "Vancouver Island",   lat: 48.9000, lng: -124.0000 },
  { name: "Okanagan",           lat: 49.8880, lng: -119.4960 },
  { name: "Kamloops",           lat: 50.6745, lng: -120.3273 },
  { name: "Kootenays",          lat: 49.4926, lng: -117.2948 },
  { name: "Prince George",      lat: 53.9166, lng: -122.7497 },
  { name: "Northern BC",        lat: 56.2518, lng: -120.8476 },
];

function getArea(lat, lng) {
  if (lat == null || lng == null) return "Other";
  let best = AREAS[0], min = Infinity;
  for (const a of AREAS) {
    const d = (lat - a.lat) ** 2 + (lng - a.lng) ** 2;
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

const REFRESH_INTERVAL = 5 * 60 * 1000;

function formatPrice(price, unit) {
  if (price == null) return null;
  const perLitre = unit?.includes("litre") || unit?.includes("liter");
  return `${price.toFixed(perLitre ? 1 : 2)}${perLitre ? "¢/L" : "$/gal"}`;
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

// Toggle a value in/out of a Set, returning a new Set
function toggleSet(set, value) {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

// ---------- Trend Banner ----------
function TrendBanner({ trend }) {
  if (!trend?.length) return null;
  const bc = trend.find((t) => t.country === "CA") || trend[0];
  if (!bc) return null;
  const arrow = bc.trend === 1 ? "↑" : bc.trend === -1 ? "↓" : "→";
  const cls   = bc.trend === 1 ? "trend-up" : bc.trend === -1 ? "trend-down" : "trend-stable";
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
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{station.name}</h2>
            <a
              className="modal-address"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.address}, ${station._area}, BC`)}`}
              target="_blank"
              rel="noreferrer"
            >
              {station.address}, {station._area}
            </a>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-prices">
          {FUEL_TYPES.map(({ key, label }) => {
            const price = station[key]?.price;
            return price != null ? (
              <div key={key} className="modal-price-chip">
                <span className="modal-price-label">{label}</span>
                <span className="modal-price-value">{formatPrice(price, station.unit_of_measure)}</span>
              </div>
            ) : null;
          })}
        </div>
        <h3 className="modal-chart-title">Price History</h3>
        <PriceChart stationId={station.station_id} />
      </div>
    </div>
  );
}

// ---------- Station Card ----------
function StationCard({ station, activeFuel, cheapestPrices, isFavourite, onToggleFavourite, onOpenChart, showArea }) {
  const fuelData  = station[activeFuel];
  const isCheapest = fuelData?.price != null && fuelData.price === cheapestPrices[activeFuel];
  const deltas    = station.price_delta || {};

  return (
    <div className={`card ${isCheapest ? "card-cheapest" : ""}`}>
      {isCheapest && <div className="cheapest-tag">Cheapest</div>}

      <div className="card-top">
        <div className="card-header">
          <div className="station-name">{station.name}</div>
          <a
            className="station-address"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.address}, ${station._area}, BC`)}`}
            target="_blank"
            rel="noreferrer"
          >
            {station.address}, {station._area}
          </a>
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
          const delta = deltas[key];
          return (
            <div key={key} className={`fuel-item ${key === activeFuel ? "fuel-active" : ""}`}>
              <span className="fuel-label">{label}</span>
              {price != null ? (
                <div className="fuel-price-row">
                  <span className={`badge ${key === activeFuel && isCheapest ? "badge-cheapest" : ""}`}>
                    {formatPrice(price, station.unit_of_measure)}
                  </span>
                  {delta != null && (
                    <span className={`price-delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
                      {delta > 0 ? "↑" : "↓"}{Math.abs(delta).toFixed(1)}
                    </span>
                  )}
                </div>
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
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState("all");
  const [sortBy, setSortBy]     = useState("price");
  const [activeFuel, setActiveFuel] = useState("regular_gas");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [chartStation, setChartStation] = useState(null);
  const [search, setSearch]     = useState("");
  const [areaFilter, setAreaFilter]   = useState(new Set());   // empty = all
  const [brandFilter, setBrandFilter] = useState(new Set());   // empty = all
  const [viewMode, setViewMode]       = useState("card");      // "card" | "table" | "compact"

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
    setLoading(true); setError(null);
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

  const stationsWithArea = allStations.map((s) => ({
    ...s,
    _area: getArea(s.latitude, s.longitude),
  }));

  const brands = [...new Set(allStations.map((s) => s.name).filter(Boolean))].sort();

  // Global cheapest — used for tab price hints only
  const globalCheapest = {};
  for (const { key } of FUEL_TYPES) {
    const prices = allStations.map((s) => s[key]?.price).filter((p) => p != null);
    globalCheapest[key] = prices.length ? Math.min(...prices) : null;
  }

  const q = search.trim().toLowerCase();
  const filtered = stationsWithArea.filter((s) => {
    if (tab === "mine" && !favourites.includes(s.station_id)) return false;
    if (areaFilter.size  > 0 && !areaFilter.has(s._area))    return false;
    if (brandFilter.size > 0 && !brandFilter.has(s.name))    return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.address.toLowerCase().includes(q)) return false;
    return true;
  });

  // Cheapest within the filtered set — used for "Cheapest" badge on cards
  const cheapestPrices = {};
  for (const { key } of FUEL_TYPES) {
    const prices = filtered.map((s) => s[key]?.price).filter((p) => p != null);
    cheapestPrices[key] = prices.length ? Math.min(...prices) : null;
  }

  function latestUpdate(s) {
    return FUEL_TYPES.map((f) => s[f.key]?.last_updated).filter(Boolean).sort().at(-1) ?? "";
  }

  const sorted = [...filtered].sort((a, b) => {
    // Always push stations with no active fuel price to the bottom
    const aPrice = a[activeFuel]?.price;
    const bPrice = b[activeFuel]?.price;
    const aHas = aPrice != null && aPrice > 0;
    const bHas = bPrice != null && bPrice > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;

    if (sortBy === "price") {
      return (aPrice ?? Infinity) - (bPrice ?? Infinity);
    }
    if (sortBy === "city") {
      const cmp = a._area.localeCompare(b._area);
      return cmp !== 0 ? cmp : (aPrice ?? Infinity) - (bPrice ?? Infinity);
    }
    if (sortBy === "updated") {
      return latestUpdate(b).localeCompare(latestUpdate(a)); // newest first
    }
    return a.name.localeCompare(b.name);
  });

  const hasFilters = areaFilter.size > 0 || brandFilter.size > 0 || q;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-icon">⛽</span>
            <div>
              <h1>BC Gas Prices</h1>
              <p className="header-sub">British Columbia</p>
            </div>
          </div>
          <div className="header-actions">
            {lastRefresh && <span className="refresh-time">Refreshed {timeAgo(lastRefresh.toISOString())}</span>}
            <button className="btn-refresh" onClick={fetchData} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {data?.trend && <TrendBanner trend={data.trend} />}
        <InsightsPanel activeFuel={activeFuel} />

        {/* Tabs */}
        <div className="tabs-row">
          <div className="tabs">
            <button className={`tab-nav ${tab === "all"  ? "tab-nav-active" : ""}`} onClick={() => setTab("all")}>
              All Stations
              {allStations.length > 0 && <span className="tab-badge">{allStations.length}</span>}
            </button>
            <button className={`tab-nav ${tab === "mine" ? "tab-nav-active" : ""}`} onClick={() => setTab("mine")}>
              ★ My Stations
              {favourites.length > 0 && <span className="tab-badge">{favourites.length}</span>}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="search-row">
          <input
            className="search-input"
            type="search"
            placeholder="Search stations or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {hasFilters && (
            <button className="btn-clear-filters" onClick={() => { setAreaFilter(new Set()); setBrandFilter(new Set()); setSearch(""); }}>
              Clear filters
            </button>
          )}
        </div>

        {/* Area chips */}
        <div className="filter-section">
          <span className="filter-label">Area</span>
          <div className="chip-row">
            {AREAS.map((a) => (
              <button
                key={a.name}
                className={`brand-chip ${areaFilter.has(a.name) ? "brand-chip-active" : ""}`}
                onClick={() => setAreaFilter(toggleSet(areaFilter, a.name))}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        {/* Brand chips */}
        {brands.length > 0 && (
          <div className="filter-section">
            <span className="filter-label">Brand</span>
            <div className="chip-row">
              {brands.map((b) => (
                <button
                  key={b}
                  className={`brand-chip ${brandFilter.has(b) ? "brand-chip-active" : ""}`}
                  onClick={() => setBrandFilter(toggleSet(brandFilter, b))}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

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
                {globalCheapest[key] != null && (
                  <span className="tab-price">{formatPrice(globalCheapest[key], allStations[0]?.unit_of_measure)}</span>
                )}
              </button>
            ))}
          </div>
          <div className="controls-right">
            {viewMode !== "table" && (
              <div className="sort-controls">
                <label>Sort by</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="price">Price</option>
                  <option value="updated">Latest Update</option>
                  <option value="name">Name</option>
                  <option value="city">City / Area</option>
                </select>
              </div>
            )}
            <div className="view-toggle">
              {[
                { id: "card",    icon: "⊞", title: "Card view"    },
                { id: "compact", icon: "☰", title: "Compact view" },
                { id: "table",   icon: "⊟", title: "Table view"   },
              ].map(({ id, icon, title }) => (
                <button
                  key={id}
                  className={`view-btn ${viewMode === id ? "view-btn-active" : ""}`}
                  onClick={() => setViewMode(id)}
                  title={title}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="error-box">Failed to load: {error}.{" "}<button onClick={fetchData}>Retry</button></div>
        )}

        {loading && !data && (
          <div className="loading-box"><div className="spinner" /><p>Fetching gas prices across British Columbia...</p></div>
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

            {viewMode === "card" && (
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
            )}

            {viewMode === "compact" && (
              <div className="compact-list">
                {sorted.map((station) => {
                  const fuelData = station[activeFuel];
                  const isCheapest = fuelData?.price != null && fuelData.price === cheapestPrices[activeFuel];
                  const delta = station.price_delta?.[activeFuel];
                  const isFav = favourites.includes(station.station_id);
                  return (
                    <div key={station.station_id} className={`compact-row ${isCheapest ? "compact-cheapest" : ""}`}>
                      <button
                        className={`btn-fav btn-fav-sm ${isFav ? "btn-fav-active" : ""}`}
                        onClick={() => toggleFavourite(station.station_id)}
                      >
                        {isFav ? "★" : "☆"}
                      </button>
                      <div className="compact-info">
                        <span className="compact-name">{station.name}</span>
                        <a
                          className="compact-addr"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.address}, ${station._area}, BC`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {station.address}, {station._area}
                        </a>
                      </div>
                      <div className="compact-price">
                        {fuelData?.price != null ? (
                          <>
                            <span className={`compact-badge ${isCheapest ? "badge-cheapest" : ""}`}>
                              {formatPrice(fuelData.price, station.unit_of_measure)}
                            </span>
                            {delta != null && (
                              <span className={`price-delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
                                {delta > 0 ? "↑" : "↓"}{Math.abs(delta).toFixed(1)}
                              </span>
                            )}
                          </>
                        ) : <span className="tbl-empty">—</span>}
                      </div>
                      <button className="btn-chart btn-chart-sm" onClick={() => setChartStation(station)} title="Price history">📈</button>
                    </div>
                  );
                })}
              </div>
            )}

            {viewMode === "table" && (
              <StationTable
                stations={sorted}
                cheapestPrices={cheapestPrices}
                favourites={favourites}
                onToggleFavourite={toggleFavourite}
                onOpenChart={setChartStation}
              />
            )}
          </>
        )}
      </main>

      {chartStation && <ChartModal station={chartStation} onClose={() => setChartStation(null)} />}
    </div>
  );
}
