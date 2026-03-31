import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import PriceChart from "./components/PriceChart";
import StationTable from "./components/StationTable";
import MapView from "./components/MapView";

const AREAS = [
  { name: "Downtown Vancouver" },
  { name: "Vancouver"          },
  { name: "East Vancouver"     },
  { name: "North Vancouver"    },
  { name: "West Vancouver"     },
  { name: "Richmond"           },
  { name: "Burnaby"            },
  { name: "New Westminster"    },
  { name: "Coquitlam"         },
  { name: "Surrey"             },
];

function getArea(lat, lng) {
  if (lat == null || lng == null) return "Other";
  // West Vancouver: north of Burrard Inlet, west of Capilano River
  if (lat >= 49.305 && lng <= -123.14) return "West Vancouver";
  // North Vancouver: north of Burrard Inlet
  if (lat >= 49.305) return "North Vancouver";
  // Coquitlam: east of Burnaby AND north of Fraser River (lat >= 49.20)
  if (lng > -122.82 && lat >= 49.20) return "Coquitlam";
  // Surrey / Delta: south of Fraser main arm AND east of Richmond's eastern boundary (Fraser main arm ~lng -122.97)
  if (lat < 49.20 && lng > -122.97) return "Surrey";
  // Richmond: south of North Arm of Fraser, west of main arm
  if (lat < 49.20) return "Richmond";
  // New Westminster: south Burnaby / New West corridor
  if (lng > -123.027 && lat < 49.225) return "New Westminster";
  // Burnaby: east of Boundary Road (~lng -123.026)
  if (lng > -123.027) return "Burnaby";
  // East Vancouver: east of Cambie/Main corridor
  if (lng >= -123.10) return "East Vancouver";
  // Downtown Vancouver: the peninsula north of False Creek (lat >= 49.265)
  if (lat >= 49.265) return "Downtown Vancouver";
  // Vancouver: Kitsilano, South Granville, Marpole, Fairview, etc.
  return "Vancouver";
}

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular (87)" },
  { key: "midgrade_gas", label: "Mid (89)" },
  { key: "premium_gas",  label: "Premium (91)" },
  { key: "diesel",       label: "Diesel" },
];

const REFRESH_INTERVAL = 5 * 60 * 1000;

function formatPrice(price, unit) {
  if (price == null) return null;
  const perLitre = unit?.includes("litre") || unit?.includes("liter");
  return `${price.toFixed(perLitre ? 1 : 2)}${perLitre ? "\u00a2/L" : "$/gal"}`;
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

function toggleSet(set, value) {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

// ---------- Trend Banner ----------
function TrendBanner({ trend, stations, activeFuel }) {
  const bc = trend?.find((t) => t.country === "CA") || trend?.[0];

  const fuelLabel = FUEL_TYPES.find((f) => f.key === activeFuel)?.label ?? "Regular (87)";
  const prices    = stations.map((s) => s[activeFuel]?.price).filter((p) => p != null && p > 0);
  const avg       = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const low       = prices.length ? Math.min(...prices) : null;

  // For regular gas use GasBuddy trend; for others compare avg to regular avg
  let trendDir = bc?.trend ?? 0;
  if (activeFuel !== "regular_gas") {
    const regPrices = stations.map((s) => s.regular_gas?.price).filter((p) => p != null && p > 0);
    const regAvg    = regPrices.length ? regPrices.reduce((a, b) => a + b, 0) / regPrices.length : null;
    trendDir = avg != null && regAvg != null ? (avg > regAvg ? 1 : avg < regAvg ? -1 : 0) : 0;
  }
  const arrow = trendDir === 1 ? "↑" : trendDir === -1 ? "↓" : "→";
  const cls   = trendDir === 1 ? "trend-up" : trendDir === -1 ? "trend-down" : "trend-stable";

  if (avg == null) return null;

  return (
    <div className={`trend-banner ${cls}`}>
      <span className="trend-area">{bc?.areaName ?? "Vancouver"}</span>
      <span className="trend-price">
        {fuelLabel} {arrow} Avg: <strong>{avg.toFixed(1)}¢/L</strong>
        {low != null ? ` · Low: ${low.toFixed(1)}¢/L` : ""}
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
function StationCard({ station, activeFuel, cheapestPrices, isFavourite, onToggleFavourite, onOpenChart, showArea, isSelected, onSelect }) {
  const fuelData  = station[activeFuel];
  const isCheapest = fuelData?.price != null && fuelData.price > 0 && fuelData.price === cheapestPrices[activeFuel];
  const deltas    = station.price_delta || {};

  return (
    <div className={`card ${isCheapest ? "card-cheapest" : ""} ${isSelected ? "card-selected" : ""}`} onClick={() => onSelect?.(station)}>
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
          onClick={(e) => { e.stopPropagation(); onToggleFavourite(station.station_id); }}
          title={isFavourite ? "Remove from My Stations" : "Add to My Stations"}
        >
          {isFavourite ? "\u2605" : "\u2606"}
        </button>
      </div>

      <div className="fuel-grid">
        {FUEL_TYPES.map(({ key, label }) => {
          const price = station[key]?.price;
          const delta = deltas[key];
          return (
            <div key={key} className={`fuel-item ${key === activeFuel ? "fuel-active" : ""}`}>
              <span className="fuel-label">{label}</span>
              {price != null && price > 0 ? (
                <div className="fuel-price-row">
                  <span className={`badge ${key === activeFuel && isCheapest ? "badge-cheapest" : ""}`}>
                    {formatPrice(price, station.unit_of_measure)}
                  </span>
                  {delta != null && (
                    <span className={`price-delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
                      {delta > 0 ? "\u2191" : "\u2193"}{Math.abs(delta).toFixed(1)}
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
        <button className="btn-chart" onClick={(e) => { e.stopPropagation(); onOpenChart(station); }}>
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
  const [areaFilter, setAreaFilter]   = useState(new Set());
  const [brandFilter, setBrandFilter] = useState(new Set());
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandMenuPos, setBrandMenuPos] = useState({ top: 0, left: 0 });
  const brandBtnRef = useRef(null);
  const [viewMode, setViewMode]       = useState("card");
  const [mapPanelOpen, setMapPanelOpen] = useState(false);
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

  useEffect(() => {
    if (!brandMenuOpen) return;
    const handler = (e) => {
      if (!e.target.closest(".brand-more-wrap")) setBrandMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [brandMenuOpen]);

  const allStations = data?.stations ?? [];

  const stationsWithArea = allStations.map((s) => ({
    ...s,
    _area: getArea(s.latitude, s.longitude),
  }));

  const TOP_BRANDS = ["Chevron", "Shell", "Petro-Canada", "Esso", "Costco"];
  const allBrands = [...new Set(allStations.map((s) => s.name).filter(Boolean))];
  const pinnedBrands = TOP_BRANDS.filter((b) => allBrands.includes(b));
  const overflowBrands = allBrands.filter((b) => !TOP_BRANDS.includes(b)).sort();
  const brands = [...pinnedBrands, ...overflowBrands];

  // Global cheapest — used for fuel tab price hints only
  const globalCheapest = {};
  for (const { key } of FUEL_TYPES) {
    const prices = allStations.map((s) => s[key]?.price).filter((p) => p != null && p > 0);
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

  // Cheapest within filtered set — drives "Cheapest" badge on cards
  const cheapestPrices = {};
  for (const { key } of FUEL_TYPES) {
    const prices = filtered.map((s) => s[key]?.price).filter((p) => p != null && p > 0);
    cheapestPrices[key] = prices.length ? Math.min(...prices) : null;
  }

  function latestUpdate(s) {
    return FUEL_TYPES.map((f) => s[f.key]?.last_updated).filter(Boolean).sort().at(-1) ?? "";
  }

  function sortPrice(s) {
    const p = s[activeFuel]?.price;
    return p != null && p > 0 ? p : Infinity;
  }

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "price") {
      return sortPrice(a) - sortPrice(b);
    }
    if (sortBy === "city") {
      const cmp = a._area.localeCompare(b._area);
      return cmp !== 0 ? cmp : sortPrice(a) - sortPrice(b);
    }
    if (sortBy === "updated") {
      return latestUpdate(b).localeCompare(latestUpdate(a));
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
              <h1>Vancouver Gas Prices</h1>
              <p className="header-sub">Greater Vancouver Area</p>
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
        {allStations.length > 0 && <TrendBanner trend={data?.trend} stations={allStations} activeFuel={activeFuel} />}

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

        {brands.length > 0 && (
          <div className="filter-section">
            <span className="filter-label">Brand</span>
            <div className="chip-row">
              {pinnedBrands.map((b) => (
                <button
                  key={b}
                  className={`brand-chip ${brandFilter.has(b) ? "brand-chip-active" : ""}`}
                  onClick={() => setBrandFilter(toggleSet(brandFilter, b))}
                >
                  {b}
                </button>
              ))}
              {overflowBrands.length > 0 && (
                <div className="brand-more-wrap">
                  <button
                    ref={brandBtnRef}
                    className={`brand-chip brand-more-btn ${overflowBrands.some(b => brandFilter.has(b)) ? "brand-chip-active" : ""}`}
                    onClick={() => {
                      if (!brandMenuOpen && brandBtnRef.current) {
                        const r = brandBtnRef.current.getBoundingClientRect();
                        setBrandMenuPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX });
                      }
                      setBrandMenuOpen((o) => !o);
                    }}
                  >
                    {overflowBrands.some(b => brandFilter.has(b))
                      ? `${overflowBrands.filter(b => brandFilter.has(b)).length} more selected ▾`
                      : `+ ${overflowBrands.length} more ▾`}
                  </button>
                  {brandMenuOpen && createPortal(
                    <div
                      className="brand-dropdown"
                      style={{ top: brandMenuPos.top, left: brandMenuPos.left }}
                    >
                      {overflowBrands.map((b) => (
                        <button
                          key={b}
                          className={`brand-dropdown-item ${brandFilter.has(b) ? "brand-dropdown-item-active" : ""}`}
                          onClick={() => setBrandFilter(toggleSet(brandFilter, b))}
                        >
                          {brandFilter.has(b) ? "✓ " : ""}{b}
                        </button>
                      ))}
                    </div>,
                    document.body
                  )}
                </div>
              )}
            </div>
          </div>
        )}

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
            {viewMode !== "map" && (
              <button
                className={`btn-map-toggle ${mapPanelOpen ? "btn-map-toggle-active" : ""}`}
                onClick={() => setMapPanelOpen((v) => !v)}
              >
                🗺 {mapPanelOpen ? "Hide Map" : "Show Map"}
              </button>
            )}
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
                { id: "card",    icon: "\u229e", title: "Card view"    },
                { id: "compact", icon: "\u2630", title: "Compact view" },
                { id: "table",   icon: "\u229f", title: "Table view"   },
                { id: "map",     icon: "🗺",     title: "Map view"     },
              ].map(({ id, icon, title }) => (
                <button
                  key={id}
                  className={`view-btn ${viewMode === id ? "view-btn-active" : ""}`}
                  onClick={() => { setViewMode(id); if (id === "map") setMapPanelOpen(false); }}
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
          <div className="loading-box"><div className="spinner" /><p>Fetching gas prices across Vancouver...</p></div>
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
            <p className="station-count">
              {sorted.length} station{sorted.length !== 1 ? "s" : ""}
              {" · "}
              {[...new Set(sorted.map((s) => s._area))].length} {[...new Set(sorted.map((s) => s._area))].length === 1 ? "city" : "cities"}
            </p>

            <div className={mapPanelOpen && viewMode !== "map" ? "split-view" : ""}>
              <div className="split-list">
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
                        isSelected={selectedStation?.station_id === station.station_id}
                        onSelect={setSelectedStation}
                      />
                    ))}
                  </div>
                )}

                {viewMode === "compact" && (
                  <div className="compact-list">
                    {sorted.map((station) => {
                      const fuelData = station[activeFuel];
                      const isCheapest = fuelData?.price != null && fuelData.price > 0 && fuelData.price === cheapestPrices[activeFuel];
                      const delta = station.price_delta?.[activeFuel];
                      const isFav = favourites.includes(station.station_id);
                      const isSelected = selectedStation?.station_id === station.station_id;
                      return (
                        <div
                          key={station.station_id}
                          className={`compact-row ${isCheapest ? "compact-cheapest" : ""} ${isSelected ? "compact-selected" : ""}`}
                          onClick={() => setSelectedStation(station)}
                        >
                          <button
                            className={`btn-fav btn-fav-sm ${isFav ? "btn-fav-active" : ""}`}
                            onClick={(e) => { e.stopPropagation(); toggleFavourite(station.station_id); }}
                          >
                            {isFav ? "\u2605" : "\u2606"}
                          </button>
                          <div className="compact-info">
                            <span className="compact-name">{station.name}</span>
                            <a
                              className="compact-addr"
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.address}, ${station._area}, BC`)}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {station.address}, {station._area}
                            </a>
                          </div>
                          <div className="compact-price">
                            {fuelData?.price != null && fuelData.price > 0 ? (
                              <>
                                <span className={`compact-badge ${isCheapest ? "badge-cheapest" : ""}`}>
                                  {formatPrice(fuelData.price, station.unit_of_measure)}
                                </span>
                                {delta != null && (
                                  <span className={`price-delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
                                    {delta > 0 ? "\u2191" : "\u2193"}{Math.abs(delta).toFixed(1)}
                                  </span>
                                )}
                              </>
                            ) : <span className="tbl-empty">—</span>}
                          </div>
                          <button className="btn-chart btn-chart-sm" onClick={(e) => { e.stopPropagation(); setChartStation(station); }} title="Price history">📈</button>
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
                    selectedStation={selectedStation}
                    onSelectStation={setSelectedStation}
                  />
                )}

                {viewMode === "map" && (
                  <MapView
                    stations={sorted}
                    activeFuel={activeFuel}
                    onOpenChart={setChartStation}
                    selectedStation={selectedStation}
                    onSelectStation={setSelectedStation}
                  />
                )}
              </div>

              {mapPanelOpen && viewMode !== "map" && (
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
            </div>
          </>
        )}
      </main>

      {chartStation && <ChartModal station={chartStation} onClose={() => setChartStation(null)} />}
    </div>
  );
}
