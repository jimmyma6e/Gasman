import { useState, useEffect, useCallback, useRef } from "react";
import PriceChart from "./components/PriceChart";
import StationTable from "./components/StationTable";
import InsightsPanel from "./components/InsightsPanel";

const AREAS = [
  "Downtown Vancouver", "East Vancouver", "Vancouver",
  "North Vancouver", "West Vancouver",
  "Burnaby", "New Westminster",
  "Richmond", "Delta",
  "Surrey", "White Rock", "Langley",
  "Coquitlam", "Port Coquitlam", "Port Moody",
  "Maple Ridge", "Pitt Meadows",
  "Abbotsford", "Chilliwack",
  "Victoria", "Nanaimo",
  "Kelowna", "Kamloops",
  "Prince George", "Kootenays", "Northern BC",
];

const POPULAR_AREAS = [
  "Downtown Vancouver", "North Vancouver", "Burnaby",
  "Richmond", "Surrey", "Coquitlam", "Langley", "Abbotsford",
];

const MORE_AREAS = AREAS.filter((a) => !POPULAR_AREAS.includes(a));

const POPULAR_BRANDS = [
  "Petro-Canada", "Shell", "Chevron", "Esso", "Husky",
  "Costco", "Canadian Tire", "7-Eleven", "Fas Gas", "Co-op",
];

function getArea(lat, lng) {
  if (lat == null || lng == null) return "Other";

  // North Shore
  if (lat >= 49.305 && lng <= -123.14) return "West Vancouver";
  if (lat >= 49.305) return "North Vancouver";

  // Port Moody
  if (lat >= 49.27 && lng >= -122.88 && lng <= -122.77) return "Port Moody";

  // Northeast Metro Van (east-first)
  if (lat >= 49.20 && lng >= -122.64) return "Maple Ridge";
  if (lat >= 49.20 && lng >= -122.73) return "Pitt Meadows";
  if (lat >= 49.20 && lng >= -122.79) return "Port Coquitlam";
  if (lat >= 49.20 && lng >  -122.87) return "Coquitlam";

  // South of Fraser River
  if (lat < 49.20) {
    if (lng >= -122.65)                 return "Langley";
    if (lat < 49.06 && lng >= -122.85) return "White Rock";
    if (lng >= -122.97)                 return "Surrey";
    if (lat < 49.16 && lng >= -123.02) return "Delta";
    return "Richmond";
  }

  // Inner Metro
  if (lng > -122.97 && lat < 49.225) return "New Westminster";
  if (lng > -123.027)                return "Burnaby";

  // City of Vancouver
  if (lng >= -123.10) return "East Vancouver";
  if (lat >= 49.265)  return "Downtown Vancouver";
  if (lat >= 49.20)   return "Vancouver";

  // BC-wide fallback
  if (lat >= 49.0 && lat <= 49.25 && lng >= -122.4 && lng <= -121.7) return "Abbotsford";
  if (lat >= 49.1 && lat <= 49.2  && lng >= -121.7 && lng <= -121.5) return "Chilliwack";
  if (lat < 48.7) return "Victoria";
  if (lat >= 48.7 && lat < 49.4 && lng <= -123.8) return "Nanaimo";
  if (lng >= -120.0 && lng <= -119.0 && lat >= 49.5 && lat <= 50.1) return "Kelowna";
  if (lat >= 50.5 && lat <= 51.0 && lng >= -121.0 && lng <= -119.5) return "Kamloops";
  if (lat >= 53.5 && lat <= 54.5) return "Prince George";
  if (lat >= 54.5) return "Northern BC";
  if (lng >= -118.0 && lng <= -115.0) return "Kootenays";

  return "Other";
}

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular" },
  { key: "midgrade_gas", label: "Mid" },
  { key: "premium_gas",  label: "Premium" },
  { key: "diesel",       label: "Diesel" },
];

const REFRESH_INTERVAL = 5 * 60 * 1000;

// Valid price range for BC gas in cents/litre
const VALID_PRICE = (p) => p != null && p >= 80 && p <= 350;

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
  const isCheapest = VALID_PRICE(fuelData?.price) && fuelData.price === cheapestPrices[activeFuel];
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
              {VALID_PRICE(price) ? (
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
  const [areaFilter, setAreaFilter]     = useState(new Set());
  const [brandFilter, setBrandFilter]   = useState(new Set());
  const [viewMode, setViewMode]         = useState("card");
  const [areaDropdownOpen, setAreaDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

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

  // Close area dropdown on outside click
  useEffect(() => {
    if (!areaDropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setAreaDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [areaDropdownOpen]);

  const allStations = data?.stations ?? [];

  const stationsWithArea = allStations.map((s) => ({
    ...s,
    _area: getArea(s.latitude, s.longitude),
  }));

  const brands = [...new Set(allStations.map((s) => s.name).filter(Boolean))];
  brands.sort((a, b) => {
    const ai = POPULAR_BRANDS.indexOf(a);
    const bi = POPULAR_BRANDS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  // Global cheapest (valid prices only) — used for tab price hints
  const globalCheapest = {};
  for (const { key } of FUEL_TYPES) {
    const prices = allStations.map((s) => s[key]?.price).filter(VALID_PRICE);
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

  // Cheapest within filtered set (valid prices only) — drives "Cheapest" badge
  const cheapestPrices = {};
  for (const { key } of FUEL_TYPES) {
    const prices = filtered.map((s) => s[key]?.price).filter(VALID_PRICE);
    cheapestPrices[key] = prices.length ? Math.min(...prices) : null;
  }

  function latestUpdate(s) {
    return FUEL_TYPES.map((f) => s[f.key]?.last_updated).filter(Boolean).sort().at(-1) ?? "";
  }

  const sorted = [...filtered].sort((a, b) => {
    // Always push stations with no valid price to the bottom
    const aPrice = a[activeFuel]?.price;
    const bPrice = b[activeFuel]?.price;
    const aHas = VALID_PRICE(aPrice);
    const bHas = VALID_PRICE(bPrice);
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

        {/* Area filter — popular chips + "More areas" dropdown */}
        <div className="filter-section">
          <span className="filter-label">Area</span>
          <div className="chip-row">
            {POPULAR_AREAS.map((name) => (
              <button
                key={name}
                className={`brand-chip ${areaFilter.has(name) ? "brand-chip-active" : ""}`}
                onClick={() => setAreaFilter(toggleSet(areaFilter, name))}
              >
                {name}
              </button>
            ))}
            {/* "More areas" dropdown */}
            <div className="area-more-wrap" ref={dropdownRef}>
              <button
                className={`area-more-btn ${MORE_AREAS.some((n) => areaFilter.has(n)) ? "brand-chip-active" : ""}`}
                onClick={() => setAreaDropdownOpen((o) => !o)}
              >
                More areas {areaDropdownOpen ? "▴" : "▾"}
              </button>
              {areaDropdownOpen && (
                <div className="area-dropdown">
                  {MORE_AREAS.map((name) => (
                    <label key={name} className="area-dropdown-item">
                      <input
                        type="checkbox"
                        checked={areaFilter.has(name)}
                        onChange={() => setAreaFilter(toggleSet(areaFilter, name))}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}
            </div>
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
                  const isCheapest = VALID_PRICE(fuelData?.price) && fuelData.price === cheapestPrices[activeFuel];
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
                        {VALID_PRICE(fuelData?.price) ? (
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
