import { useState, useEffect, useCallback, useRef } from "react";
import PriceChart from "./components/PriceChart";
import StationTable from "./components/StationTable";
import InsightsPanel from "./components/InsightsPanel";
import MapView from "./components/MapView";

// Region groupings for the area filter
const BC_REGIONS = {
  "Metro Vancouver": [
    "Downtown Vancouver", "East Vancouver", "Vancouver",
    "West Vancouver", "North Vancouver",
    "Burnaby", "South Burnaby", "New Westminster",
    "Richmond", "Delta", "North Delta",
    "Surrey", "White Rock",
    "Langley", "Aldergrove",
    "Coquitlam", "Port Coquitlam", "Port Moody",
    "Pitt Meadows", "Maple Ridge",
  ],
  "Sea to Sky": ["Squamish", "Whistler", "Gibsons", "Sechelt"],
  "Fraser Valley": ["Abbotsford", "Mission", "Chilliwack", "Hope"],
  "Vancouver Island": ["Victoria", "Nanaimo", "Courtenay", "Campbell River", "Port Alberni"],
  "Okanagan": ["Kelowna", "Vernon", "Penticton", "Oliver", "Osoyoos"],
  "Thompson / Kamloops": ["Kamloops", "Salmon Arm"],
  "Kootenays": ["Nelson", "Trail", "Cranbrook", "Fernie"],
  "Northern BC": ["Prince George", "Fort St. John", "Dawson Creek", "Terrace", "Prince Rupert", "Fort Nelson"],
};

const POPULAR_AREAS = [
  "Vancouver", "Burnaby", "Richmond", "Surrey",
  "North Vancouver", "Coquitlam", "Langley", "Abbotsford",
];

// Fallback area detection when city isn't available from API
function getAreaFromCoords(lat, lng) {
  if (lat == null || lng == null) return "Other";

  // ── Northern BC ──────────────────────────────────────────────────
  if (lat >= 58.0) return "Fort Nelson";
  if (lat >= 55.7) return "Fort St. John";
  if (lat >= 55.0) return "Dawson Creek";
  if (lat >= 54.4 && lng <= -128.0) return "Terrace";
  if (lat >= 54.0 && lng <= -130.0) return "Prince Rupert";
  if (lat >= 53.5) return "Prince George";

  // ── Kootenays (east of -118.5°) ──────────────────────────────────
  if (lng >= -118.5) {
    if (lat >= 49.4) return "Kootenays";
    return "Cranbrook";
  }

  // ── Okanagan (-120.5° to -118.5°) ────────────────────────────────
  if (lng >= -120.5) {
    if (lat >= 50.5) return "Salmon Arm";
    if (lat >= 50.0) return "Vernon";
    if (lat >= 49.7) return "Kelowna";
    if (lat >= 49.3) return "Penticton";
    return "Oliver";
  }

  // ── Thompson / Kamloops ───────────────────────────────────────────
  if (lat >= 50.2 && lng >= -121.5) return "Kamloops";

  // ── Sea to Sky ────────────────────────────────────────────────────
  if (lat >= 50.0 && lng >= -123.2 && lng <= -122.7) return "Whistler";
  if (lat >= 49.55 && lng >= -123.4 && lng <= -122.9) return "Squamish";
  if (lat >= 49.35 && lng <= -123.4) return "Gibsons";

  // ── Fraser Valley ─────────────────────────────────────────────────
  if (lat >= 49.3 && lng >= -121.6) return "Hope";
  if (lat >= 49.08 && lng >= -121.9 && lng < -121.3) return "Chilliwack";
  // Mission before Abbotsford — Mission is lat 49.1–49.2, lng -122.2 to -122.5
  if (lat >= 49.1 && lng >= -122.5 && lng < -121.9) return "Mission";
  if (lat >= 49.0 && lng >= -122.5 && lng < -121.9) return "Abbotsford";

  // ── Vancouver Island ─────────────────────────────────────────────
  // BC mainland ends at 49°N — below that is always Vancouver Island / Gulf Islands
  if (lat < 49.0) return "Victoria";
  // Mid-island: Nanaimo lat 49.0–49.4, well west of mainland
  if (lat < 49.35 && lng < -123.7) return "Nanaimo";
  // Northern Vancouver Island
  if (lng <= -124.8) {
    if (lat >= 49.9) return "Campbell River";
    if (lat >= 49.5) return "Courtenay";
    return "Nanaimo";
  }

  // ── Metro Vancouver ───────────────────────────────────────────────
  if (lat >= 49.31 && lng <= -123.14) return "West Vancouver";
  if (lat >= 49.30) return "North Vancouver";
  if (lat >= 49.27 && lng >= -122.90 && lng <= -122.77) return "Port Moody";
  if (lat >= 49.20 && lng >= -122.63) return "Maple Ridge";
  if (lat >= 49.20 && lng >= -122.74) return "Pitt Meadows";
  if (lat >= 49.22 && lng >= -122.83) return "Port Coquitlam";
  if (lat >= 49.22 && lng >= -122.90) return "Coquitlam";

  if (lat < 49.20) {
    if (lng >= -122.60) return "Langley";
    if (lat < 49.07 && lng >= -122.88) return "White Rock";
    if (lng >= -122.97) return "Surrey";
    // North Delta: east of Richmond, between Surrey and Ladner
    if (lat >= 49.09 && lng >= -123.04) return "North Delta";
    // Delta (Tsawwassen & Ladner): south of the South arm of Fraser
    if (lat < 49.12) return "Delta";
    // Richmond: lat 49.12–49.20, west of Surrey/North Delta
    return "Richmond";
  }

  if (lat < 49.225 && lng > -122.97) return "New Westminster";
  if (lat < 49.24 && lng > -123.027) return "South Burnaby";
  if (lng > -123.027) return "Burnaby";
  if (lng >= -123.11) return "East Vancouver";
  if (lat >= 49.27) return "Downtown Vancouver";
  return "Vancouver";
}

const POPULAR_BRANDS = [
  "Petro-Canada", "Shell", "Chevron", "Esso", "Husky",
  "Costco", "Canadian Tire", "7-Eleven", "Fas Gas", "Co-op",
];

// Normalize raw GasBuddy brand names to canonical versions
const BRAND_ALIASES = {
  "CENTEX": "Centex", "Centex Gas": "Centex",
  "CO-OP": "Co-op", "CO-OP Cardlock": "Co-op", "Co-op Cardlock": "Co-op", "Co-Op": "Co-op",
  "Yellow Stores": "Yellow",
  "Husky Go!": "Husky", "HUSKY": "Husky",
  "ESSO": "Esso",
  "SHELL": "Shell",
  "CHEVRON": "Chevron",
  "Petro-Can": "Petro-Canada",
};
function normalizeBrand(name) {
  return (name && BRAND_ALIASES[name]) || name;
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
  const [areaDropdownOpen, setAreaDropdownOpen]   = useState(false);
  const [areaSearch, setAreaSearch]               = useState("");
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const [brandSearch, setBrandSearch]             = useState("");
  const dropdownRef     = useRef(null);
  const brandDropdownRef = useRef(null);
  const [showMap, setShowMap] = useState(false);
  const [selectedStation, setSelectedStation] = useState(null);

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

  useEffect(() => {
    if (!brandDropdownOpen) return;
    const handler = (e) => {
      if (brandDropdownRef.current && !brandDropdownRef.current.contains(e.target))
        setBrandDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [brandDropdownOpen]);

  const allStations = data?.stations ?? [];

  const stationsWithArea = allStations.map((s) => ({
    ...s,
    _area:  s.city || getAreaFromCoords(s.latitude, s.longitude),
    _brand: normalizeBrand(s.name),
  }));

  const brands = [...new Set(stationsWithArea.map((s) => s._brand).filter(Boolean))];
  brands.sort((a, b) => {
    const ai = POPULAR_BRANDS.indexOf(a);
    const bi = POPULAR_BRANDS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const q = search.trim().toLowerCase();
  const filtered = stationsWithArea.filter((s) => {
    if (tab === "mine" && !favourites.includes(s.station_id)) return false;
    if (areaFilter.size  > 0 && !areaFilter.has(s._area))    return false;
    if (brandFilter.size > 0 && !brandFilter.has(s._brand))   return false;
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
              <h1>Gasman</h1>
              <p className="header-sub">moving you always &middot; powered by JM</p>
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
            {/* Region dropdown */}
            <div className="area-more-wrap" ref={dropdownRef}>
              <button
                className={`area-more-btn ${[...areaFilter].some((n) => !POPULAR_AREAS.includes(n)) ? "brand-chip-active" : ""}`}
                onClick={() => { setAreaDropdownOpen((o) => !o); setAreaSearch(""); }}
              >
                All regions {areaDropdownOpen ? "▴" : "▾"}
              </button>
              {areaDropdownOpen && (
                <div className="area-dropdown">
                  <input
                    className="area-search-input"
                    type="text"
                    placeholder="Search area..."
                    value={areaSearch}
                    onChange={(e) => setAreaSearch(e.target.value)}
                    autoFocus
                  />
                  {Object.entries(BC_REGIONS).map(([region, cities]) => {
                    const filtered = cities.filter((c) =>
                      c.toLowerCase().includes(areaSearch.toLowerCase())
                    );
                    if (filtered.length === 0) return null;
                    return (
                      <div key={region} className="area-region-group">
                        <div className="area-region-header">{region}</div>
                        {filtered.map((name) => (
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
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Brand filter — popular as chips, rest in dropdown */}
        {brands.length > 0 && (
          <div className="filter-section">
            <span className="filter-label">Brand</span>
            <div className="chip-row">
              {/* Popular brand chips (always visible) */}
              {POPULAR_BRANDS.filter((b) => brands.includes(b)).map((b) => (
                <button key={b}
                  className={`brand-chip ${brandFilter.has(b) ? "brand-chip-active" : ""}`}
                  onClick={() => setBrandFilter(toggleSet(brandFilter, b))}>
                  {b}
                </button>
              ))}
              {/* Selected non-popular brands as dismissible chips */}
              {[...brandFilter].filter((b) => !POPULAR_BRANDS.includes(b)).map((b) => (
                <button key={b} className="brand-chip brand-chip-active"
                  onClick={() => setBrandFilter(toggleSet(brandFilter, b))}>
                  {b} ×
                </button>
              ))}
              {/* "More" dropdown for non-popular brands */}
              {brands.filter((b) => !POPULAR_BRANDS.includes(b)).length > 0 && (
                <div className="area-more-wrap" ref={brandDropdownRef}>
                  <button
                    className={`area-more-btn ${[...brandFilter].some((b) => !POPULAR_BRANDS.includes(b)) ? "brand-chip-active" : ""}`}
                    onClick={() => { setBrandDropdownOpen((o) => !o); setBrandSearch(""); }}
                  >
                    More {brandDropdownOpen ? "▴" : "▾"}
                  </button>
                  {brandDropdownOpen && (
                    <div className="area-dropdown brand-dropdown">
                      <input className="area-search-input" type="text" placeholder="Search brand…"
                        value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)} autoFocus />
                      {brands.filter((b) => !POPULAR_BRANDS.includes(b) &&
                        b.toLowerCase().includes(brandSearch.toLowerCase())).map((b) => (
                        <label key={b} className="area-dropdown-item">
                          <input type="checkbox" checked={brandFilter.has(b)}
                            onChange={() => setBrandFilter(toggleSet(brandFilter, b))} />
                          {b}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                {cheapestPrices[key] != null && (
                  <span className="tab-price">{formatPrice(cheapestPrices[key], allStations[0]?.unit_of_measure)}</span>
                )}
              </button>
            ))}
          </div>
          <div className="controls-right">
            <button
              className={`btn-map-toggle ${showMap ? "btn-map-toggle-active" : ""}`}
              onClick={() => setShowMap((v) => !v)}
            >
              🗺 Map
            </button>
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

        {data && sorted.length === 0 && !loading && (
          <div className="empty-state">
            <p style={{ fontSize: "2rem" }}>🔍</p>
            <p><strong>No stations match your filters</strong></p>
            {(areaFilter.size > 0 || brandFilter.size > 0 || search) && (
              <button className="btn-clear-filters" style={{ marginTop: 8 }}
                onClick={() => { setAreaFilter(new Set()); setBrandFilter(new Set()); setSearch(""); }}>
                Clear all filters
              </button>
            )}
          </div>
        )}

        {data && sorted.length > 0 && (
          <>
            <p className="station-count">{sorted.length} station{sorted.length !== 1 ? "s" : ""}</p>

            <div className={showMap ? "split-view" : ""}>
              <div className={showMap ? "split-list" : ""}>

            {viewMode === "card" && (
              <div className="grid">
                {sorted.map((station) => (
                  <div
                    key={station.station_id}
                    className={selectedStation?.station_id === station.station_id ? "card-selected" : ""}
                    onClick={() => setSelectedStation(station)}
                  >
                  <StationCard
                    station={station}
                    activeFuel={activeFuel}
                    cheapestPrices={cheapestPrices}
                    isFavourite={favourites.includes(station.station_id)}
                    onToggleFavourite={toggleFavourite}
                    onOpenChart={setChartStation}
                    showArea={sortBy === "city"}
                  />
                  </div>
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
                  const isSelected = selectedStation?.station_id === station.station_id;
                  return (
                    <div key={station.station_id} className={`compact-row ${isCheapest ? "compact-cheapest" : ""} ${isSelected ? "compact-selected" : ""}`} onClick={() => setSelectedStation(station)}>
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

              </div>{/* end split-list */}

              {showMap && (
                <div className="split-map">
                  <MapView
                    stations={sorted}
                    activeFuel={activeFuel}
                    onOpenChart={setChartStation}
                    selectedStation={selectedStation}
                    onSelectStation={setSelectedStation}
                  />
                </div>
              )}
            </div>{/* end split-view */}
          </>
        )}
      </main>

      {chartStation && <ChartModal station={chartStation} onClose={() => setChartStation(null)} />}
    </div>
  );
}
