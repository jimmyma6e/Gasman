import { useState, useEffect, useCallback } from "react";
import PriceChart from "./components/PriceChart";

// Haversine distance in km between two lat/lng points
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

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
    const d = haversine(lat, lng, a.lat, a.lng);
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
function StationCard({ station, activeFuel, cheapestPrices, isFavourite, onToggleFavourite, onOpenChart, distance, showArea }) {
  const fuelData = station[activeFuel];
  const isCheapest = fuelData?.price != null && fuelData.price === cheapestPrices[activeFuel];

  return (
    <div className={`card ${isCheapest ? "card-cheapest" : ""}`}>
      {isCheapest && <div className="cheapest-tag">Cheapest</div>}
      {distance != null && <div className="distance-badge">📍 {fmtDist(distance)}</div>}

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
  const [tab, setTab]         = useState("all");        // "all" | "mine" | "near"
  const [sortBy, setSortBy]   = useState("price");
  const [activeFuel, setActiveFuel] = useState("regular_gas");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [chartStation, setChartStation] = useState(null);

  const [userLocation, setUserLocation] = useState(null);   // {lat, lon}
  const [locStatus, setLocStatus]       = useState("idle"); // "idle"|"loading"|"ok"|"denied"
  const [locError, setLocError]         = useState("");
  const [manualAddr, setManualAddr]     = useState("");
  const [nearRadius, setNearRadius]     = useState(5);      // km

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

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocStatus("denied");
      setLocError("Your browser doesn't support geolocation.");
      return;
    }
    setLocStatus("loading");
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocStatus("ok");
        setTab("near");
      },
      (err) => {
        setLocStatus("denied");
        if (err.code === 1) {
          setLocError("Permission denied. On Mac: System Settings → Privacy & Security → Location Services → enable your browser.");
        } else if (err.code === 2) {
          setLocError("Location unavailable on this device.");
        } else {
          setLocError("Location timed out.");
        }
      },
      { timeout: 10000 }
    );
  }, []);

  const geocodeManual = useCallback(async (addr) => {
    if (!addr.trim()) return;
    setLocStatus("loading");
    setLocError("");
    try {
      const q = encodeURIComponent(addr + ", Vancouver, BC");
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const results = await res.json();
      if (!results.length) throw new Error("Address not found");
      setUserLocation({ lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) });
      setLocStatus("ok");
      setTab("near");
    } catch (e) {
      setLocStatus("denied");
      setLocError(`Could not find "${addr}". Try a street address or intersection.`);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchData]);

  const allStations = data?.stations ?? [];

  // Attach distance + area to each station
  const stationsWithDist = allStations.map((s) => ({
    ...s,
    _dist: userLocation && s.latitude != null && s.longitude != null
      ? haversine(userLocation.lat, userLocation.lon, s.latitude, s.longitude)
      : null,
    _area: getArea(s.latitude, s.longitude),
  }));

  // Cheapest price per fuel type
  const cheapestPrices = {};
  for (const { key } of FUEL_TYPES) {
    const prices = allStations.map((s) => s[key]?.price).filter((p) => p != null);
    cheapestPrices[key] = prices.length ? Math.min(...prices) : null;
  }

  // Filter
  let filtered = stationsWithDist;
  if (tab === "mine") {
    filtered = stationsWithDist.filter((s) => favourites.includes(s.station_id));
  } else if (tab === "near") {
    filtered = stationsWithDist.filter((s) => s._dist != null && s._dist <= nearRadius);
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (tab === "near") return (a._dist ?? Infinity) - (b._dist ?? Infinity);
    if (sortBy === "price") {
      const pa = a[activeFuel]?.price ?? Infinity;
      const pb = b[activeFuel]?.price ?? Infinity;
      return pa - pb;
    }
    if (sortBy === "city") {
      const cmp = a._area.localeCompare(b._area);
      if (cmp !== 0) return cmp;
      // Within same area, sort cheapest first
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
            <button
              className={`tab-nav ${tab === "near" ? "tab-nav-active" : ""}`}
              onClick={locStatus === "ok" ? () => setTab("near") : requestLocation}
              disabled={locStatus === "loading"}
            >
              {locStatus === "loading" ? "Locating…" : "📍 Near Me"}
              {tab === "near" && sorted.length > 0 && <span className="tab-badge">{sorted.length}</span>}
            </button>
          </div>

          {/* Radius slider — only shown on Near Me tab */}
          {tab === "near" && locStatus === "ok" && (
            <div className="radius-control">
              <span>Within</span>
              <input
                type="range" min="1" max="20" step="1"
                value={nearRadius}
                onChange={(e) => setNearRadius(Number(e.target.value))}
              />
              <span className="radius-label">{nearRadius} km</span>
            </div>
          )}
        </div>

        {/* Location denied warning */}
        {locStatus === "denied" && (
          <div className="loc-error">
            <div>{locError || "Location access denied."}{" "}
              <button onClick={requestLocation}>Try GPS</button>
            </div>
            <form
              className="manual-loc-form"
              onSubmit={(e) => { e.preventDefault(); geocodeManual(manualAddr); }}
            >
              <input
                className="manual-loc-input"
                placeholder="Or enter your address (e.g. 123 Main St)"
                value={manualAddr}
                onChange={(e) => setManualAddr(e.target.value)}
              />
              <button type="submit" className="manual-loc-btn">Go</button>
            </form>
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

        {tab === "near" && locStatus === "ok" && sorted.length === 0 && (
          <div className="empty-state">
            <p style={{ fontSize: "2.5rem" }}>📍</p>
            <p><strong>No stations within {nearRadius} km</strong></p>
            <p>Try increasing the radius above.</p>
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
                  distance={station._dist}
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
