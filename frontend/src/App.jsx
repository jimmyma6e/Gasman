import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import PriceChart from "./components/PriceChart";
import StationTable from "./components/StationTable";
import InsightsPanel from "./components/InsightsPanel";
import MapView from "./components/MapView";
import RouteTab from "./components/RouteTab";
import Dashboard, { ProfileModal } from "./components/Dashboard";
import Onboarding from "./components/Onboarding";
import FillupModal from "./components/FillupModal";
import LogsTab from "./components/LogsTab";
import BottomNav from "./components/BottomNav";
import { bestCardSavings } from "./creditCards.js";
import { pageview } from "./analytics.js";
import posthog from "posthog-js";

// Virtual paths per tab — used for GA4 pageview tracking
const TAB_PATHS = {
  dashboard: "/dashboard",
  all:       "/all-stations",
  route:     "/route-finder",
  logs:      "/logs",
};

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
const QUICK_BRANDS = ["Shell", "Petro-Canada", "Chevron", "Esso"];

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

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
function ChartModal({ station, activeFuel, onClose, onLogFillup, onSnapshot }) {
  // Initialize to activeFuel if that fuel has price data, else first available fuel
  const firstAvailable = FUEL_TYPES.find(({ key }) => station[key]?.price != null)?.key ?? "regular_gas";
  const initFuel = station[activeFuel]?.price != null ? activeFuel : firstAvailable;
  const [selectedFuel, setSelectedFuel] = useState(initFuel);
  const [visitedDone, setVisitedDone] = useState(false);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${station.name}, ${station.address}, ${station._area}, BC`)}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title">{station.name}</h2>
            <p className="modal-address">{station.address}, {station._area}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Fuel price chips — tap to switch chart fuel */}
        <div className="modal-prices">
          {FUEL_TYPES.map(({ key, label }) => {
            const price = station[key]?.price;
            if (price == null) return null;
            return (
              <button
                key={key}
                className={`modal-price-chip ${selectedFuel === key ? "modal-price-chip-active" : ""}`}
                onClick={() => setSelectedFuel(key)}
              >
                <span className="modal-price-label">{label}</span>
                <span className="modal-price-value">{formatPrice(price, station.unit_of_measure)}</span>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="modal-actions">
          <a className="btn-modal-action" href={mapsUrl} target="_blank" rel="noreferrer">
            🗺️ Directions
          </a>
          {station[selectedFuel]?.price != null && (
            <button className="btn-modal-action" onClick={() => { onLogFillup(station, selectedFuel); onClose(); }}>
              ⛽ Log Fill-up
            </button>
          )}
          <button className="btn-modal-action" onClick={() => { onSnapshot(station, selectedFuel); onClose(); }}>
            📷 Snapshot
          </button>
        </div>

        <h3 className="modal-chart-title">Price History</h3>
        <PriceChart stationId={station.station_id} activeFuel={selectedFuel} />

        {/* Just visited? — price accuracy prompt shown after chart */}
        {!visitedDone && (
          <div className="modal-visited">
            <span className="modal-visited-label">📍 Just filled up here? Is the price still correct?</span>
            <div className="modal-visited-btns">
              <button className="btn-visited-yes" onClick={() => setVisitedDone(true)}>✓ Yes</button>
              <button className="btn-visited-update" onClick={() => { onLogFillup(station, selectedFuel); onClose(); }}>
                ✏️ Update
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Station Card ----------
function StationCard({ station, activeFuel, cheapestPrices, isFavourite, onToggleFavourite, onOpenChart, onSnapshot, showArea, selectedCards, showCardDiscounts, fillLitres, showFillCost, userCoords, onLogFillup }) {
  const fuelData  = station[activeFuel];
  const isCheapest = VALID_PRICE(fuelData?.price) && fuelData.price === cheapestPrices[activeFuel];
  const deltas    = station.price_delta || {};
  const distKm = userCoords && station.latitude
    ? haversineKm(userCoords.lat, userCoords.lng, station.latitude, station.longitude)
    : null;

  return (
    <div className={`card ${isCheapest ? "card-cheapest" : ""}`}>
      {isCheapest && <div className="cheapest-tag">★ Top Pick</div>}

      <div className="card-top">
        <div className="card-header">
          <div className="station-name">
            {station.name}
            {distKm != null && (
              <span className="dist-badge">{distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`}</span>
            )}
          </div>
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
                <>
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
                  {key === activeFuel && showCardDiscounts && (() => {
                    const brand = station._brand || station.name;
                    const result = bestCardSavings(selectedCards, price, brand);
                    if (!result) return null;
                    const discounted = Math.round((price - result.savings) * 10) / 10;
                    return (
                      <div className="fuel-card-discount">
                        <span className="fuel-card-price">💳 {discounted}¢</span>
                        <span className="fuel-card-tag">–{result.savings}¢ {result.card.bank}</span>
                      </div>
                    );
                  })()}
                  {key === activeFuel && showFillCost && parseFloat(fillLitres) > 0 && (() => {
                    const litres = parseFloat(fillLitres);
                    const total = (price * litres / 100).toFixed(2);
                    const cardResult = showCardDiscounts
                      ? bestCardSavings(selectedCards, price, station._brand || station.name)
                      : null;
                    const cardTotal = cardResult
                      ? ((price - cardResult.savings) * litres / 100).toFixed(2)
                      : null;
                    return (
                      <div className="fuel-fill-cost">
                        <span>{litres}L: <strong>${total}</strong></span>
                        {cardTotal && <span className="fuel-fill-card">💳 ${cardTotal}</span>}
                      </div>
                    );
                  })()}
                </>
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
        <div className="card-footer-actions">
          {VALID_PRICE(fuelData?.price) && (
            <button className="btn-fillup" onClick={(e) => { e.stopPropagation(); onLogFillup(station); }}
              title="Log a fill-up at this station">⛽ Log Fill-up</button>
          )}
          {VALID_PRICE(fuelData?.price) && (
            <button className="btn-snapshot" onClick={() => onSnapshot(station, activeFuel)}
              title="Snapshot price to My Dashboard">📷</button>
          )}
          <button className="btn-chart" onClick={() => onOpenChart(station)}>
            📈
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Station Summary Bar ----------
function StationSummaryBar({ sorted, activeFuel, cheapestPrices, userCoords }) {
  if (!sorted?.length) return null;

  // Cheapest station for the active fuel type
  const cheapStation = VALID_PRICE(cheapestPrices?.[activeFuel])
    ? sorted.find((s) => s[activeFuel]?.price === cheapestPrices[activeFuel])
    : null;

  // Closest station (only when Near Me is active)
  let closest = null;
  if (userCoords) {
    let minDist = Infinity;
    for (const s of sorted) {
      if (!s.latitude || !s.longitude) continue;
      const d = haversineKm(userCoords.lat, userCoords.lng, s.latitude, s.longitude);
      if (d < minDist) { minDist = d; closest = { station: s, dist: d }; }
    }
  }

  if (!cheapStation && !closest) return null;

  const distLabel = (d) => d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;

  return (
    <div className="station-summary-bar">
      {cheapStation && (
        <span className="summary-best">
          <span className="summary-top-pick">★ Best</span>
          {" "}<strong>{cheapStation[activeFuel].price.toFixed(1)}¢</strong>
          {" at "}<span className="summary-sname">{cheapStation.name}</span>
        </span>
      )}
      {cheapStation && closest && <span className="summary-dot">·</span>}
      {closest && (
        <span className="summary-closest">
          📍 <strong>{distLabel(closest.dist)}</strong>
          {" to "}<span className="summary-sname">{closest.station.name}</span>
        </span>
      )}
    </div>
  );
}

// ---------- Crowdsource Prompt ----------
function CrowdsourcePrompt({ onConfirm, onUpdate, onDismiss }) {
  return (
    <div className="crowdsource-prompt">
      <div className="crowdsource-top">
        <span className="crowdsource-title">Help keep Gasman accurate</span>
        <button className="crowdsource-dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
      </div>
      <p className="crowdsource-body">Is this price still correct?</p>
      <div className="crowdsource-actions">
        <button className="crowdsource-btn-yes" onClick={onConfirm}>✓ Yes, looks right</button>
        <button className="crowdsource-btn-update" onClick={onUpdate}>✏️ Update price</button>
        <button className="crowdsource-btn-skip" onClick={onDismiss}>Not now</button>
      </div>
    </div>
  );
}

// ---------- App ----------
export default function App() {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState("dashboard");
  const [sortBy, setSortBy]     = useState(() => localStorage.getItem("gasman-sort-by") || "price");
  const [activeFuel, setActiveFuel] = useState(() => localStorage.getItem("gasman-active-fuel") || "regular_gas");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [chartStation, setChartStation] = useState(null);
  const [search, setSearch]     = useState("");
  const [areaFilter, setAreaFilter]     = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("gasman-area-filter") || "[]")); }
    catch { return new Set(); }
  });
  const [brandFilter, setBrandFilter]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("gasman-brand-filter") || "[]")); }
    catch { return new Set(); }
  });
  const [viewMode, setViewMode]         = useState(() => localStorage.getItem("gasman-view-mode") || "card");
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

  const [snapshots, setSnapshots] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-snapshots") || "[]"); }
    catch { return []; }
  });

  const [savedRoutes, setSavedRoutes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-fav-routes") || "[]"); }
    catch { return []; }
  });

  const [activeRouteLoad, setActiveRouteLoad] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  const [selectedCards, setSelectedCards] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-cards") || "[]"); }
    catch { return []; }
  });
  const [showCardDiscounts, setShowCardDiscounts] = useState(
    () => localStorage.getItem("gasman-show-card-discounts") === "1"
  );
  const [fillLitres, setFillLitres] = useState(
    () => localStorage.getItem("gasman-fill-litres") || ""
  );
  const [showFillCost, setShowFillCost] = useState(
    () => localStorage.getItem("gasman-show-fill-cost") === "1"
  );
  // PWA install prompt
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);

  const [onboarded, setOnboarded] = useState(
    () => !!localStorage.getItem("gasman-onboarded")
  );

  // Near Me
  const [userCoords, setUserCoords] = useState(null);
  const [nearMeLoading, setNearMeLoading] = useState(false);
  const [nearMeError, setNearMeError] = useState(null);

  const getNearMe = useCallback(() => {
    if (!navigator.geolocation) { setNearMeError("not-supported"); return; }
    setNearMeLoading(true); setNearMeError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSortBy("distance");
        setNearMeLoading(false);
      },
      () => { setNearMeError("denied"); setNearMeLoading(false); }
    );
  }, []);

  // Fill-up log
  const [fillups, setFillups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-fillups") || "[]"); }
    catch { return []; }
  });
  const [fillupTarget, setFillupTarget] = useState(null); // { station, fuelType }

  const [showAllStations, setShowAllStations] = useState(false);

  const handleSaveFillup = useCallback((entry) => {
    setFillups((prev) => {
      const exists = prev.some((f) => f.id === entry.id);
      const next = exists
        ? prev.map((f) => f.id === entry.id ? entry : f)
        : [entry, ...prev];
      localStorage.setItem("gasman-fillups", JSON.stringify(next));
      return next;
    });
    posthog.capture("log_added", {
      fuel_type:    entry.fuel_type,
      has_station:  !!entry.station_id,
      has_litres:   !!entry.litres,
      price_edited: entry.price_was_edited,
    });
    posthog.capture("station_log_completed", {
      station_id:   entry.station_id,
      station_name: entry.station_name,
      fuel_type:    entry.fuel_type,
    });
    setFillupTarget(null);
  }, []);

  const handleDeleteFillup = useCallback((id) => {
    setFillups((prev) => {
      const next = prev.filter((f) => f.id !== id);
      localStorage.setItem("gasman-fillups", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSnapshot = useCallback((station, fuelType) => {
    const price = station[fuelType]?.price;
    if (price == null) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      station_id: station.station_id,
      name: station.name,
      address: station.address,
      _area: station._area,
      fuel_type: fuelType,
      price,
      timestamp: new Date().toISOString(),
    };
    setSnapshots((prev) => {
      const next = [entry, ...prev];
      localStorage.setItem("gasman-snapshots", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDeleteSnapshot = useCallback((id) => {
    setSnapshots((prev) => {
      const next = prev.filter((s) => s.id !== id);
      localStorage.setItem("gasman-snapshots", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSaveRoute = useCallback((route) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...route,
      savedAt: new Date().toISOString(),
    };
    setSavedRoutes((prev) => {
      const next = [entry, ...prev];
      localStorage.setItem("gasman-fav-routes", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDeleteRoute = useCallback((id) => {
    setSavedRoutes((prev) => {
      const next = prev.filter((r) => r.id !== id);
      localStorage.setItem("gasman-fav-routes", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleLaunchRoute = useCallback((route) => {
    setActiveRouteLoad(route);
    setTab("route");
  }, []);

  const [scanStatus, setScanStatus] = useState(null);
  // true while a backend scan is in progress (set from /api/stations response)
  const [scanning, setScanning]     = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/stations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setScanning(!!json.scanning);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Normal data refresh: every 5 min when idle, every 8 s while scanning
  // (so new stations appear quickly during the initial discovery scan)
  useEffect(() => {
    fetchData();
    const interval = scanning ? 8_000 : REFRESH_INTERVAL;
    const id = setInterval(fetchData, interval);
    return () => clearInterval(id);
  }, [fetchData, scanning]);

  // Poll /api/scan-status every 4 s to drive the progress bar
  useEffect(() => {
    let id;
    const poll = async () => {
      try {
        const res = await fetch("/api/scan-status");
        if (res.ok) setScanStatus(await res.json());
      } catch { /* ignore */ }
    };
    poll();
    id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  // Persist All Stations filter state to localStorage
  useEffect(() => { localStorage.setItem("gasman-sort-by",     sortBy);    }, [sortBy]);
  useEffect(() => { localStorage.setItem("gasman-active-fuel", activeFuel); }, [activeFuel]);
  useEffect(() => { localStorage.setItem("gasman-view-mode",   viewMode);  }, [viewMode]);
  useEffect(() => { localStorage.setItem("gasman-area-filter",  JSON.stringify([...areaFilter]));  }, [areaFilter]);
  useEffect(() => { localStorage.setItem("gasman-brand-filter", JSON.stringify([...brandFilter])); }, [brandFilter]);
  useEffect(() => { localStorage.setItem("gasman-show-card-discounts", showCardDiscounts ? "1" : "0"); }, [showCardDiscounts]);
  useEffect(() => { localStorage.setItem("gasman-show-fill-cost", showFillCost ? "1" : "0"); }, [showFillCost]);
  // Sync state from localStorage when profile modal closes (cards/fill litres may have changed)
  useEffect(() => {
    if (!showProfile) {
      try {
        setSelectedCards(JSON.parse(localStorage.getItem("gasman-cards") || "[]"));
        setFillLitres(localStorage.getItem("gasman-fill-litres") || "");
      } catch { /* ignore */ }
    }
  }, [showProfile]);

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstall(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setShowInstall(false); setInstallPrompt(null); }
  };

  // GA4 — skip first render because index.html gtag snippet already fires the hit.
  const gaTabMounted = useRef(false);
  useEffect(() => {
    if (!gaTabMounted.current) { gaTabMounted.current = true; return; }
    pageview(TAB_PATHS[tab] || "/");
  }, [tab]);

  // PostHog — fire on every tab change including first render (no duplicate risk).
  useEffect(() => {
    const path = TAB_PATHS[tab] || "/";
    posthog.capture("$pageview", { $current_url: window.location.origin + path, tab });
  }, [tab]);

  // Auto Near Me — request on first visit to All Stations if not already active
  const nearMeRequested = useRef(false);
  useEffect(() => {
    if (tab === "all" && !userCoords && !nearMeRequested.current) {
      nearMeRequested.current = true;
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setSortBy("distance");
          },
          () => {} // silent — manual Near Me button still available
        );
      }
    }
  }, [tab, userCoords]);

  // Track last station_view to avoid duplicate fires when clicking the same card twice
  const lastViewedStation = useRef(null);

  function handleSelectStation(station, rank) {
    setSelectedStation(station);
    setChartStation(station); // Open detail modal directly — user can report price from there
    if (!station || lastViewedStation.current === station.station_id) return;
    lastViewedStation.current = station.station_id;
    const price = station[activeFuel]?.price ?? null;
    posthog.capture("station_view", {
      station_id:   station.station_id,
      station_name: station.name,
      price,
      rank,
      is_featured:  station.is_featured ?? false,
    });
    if (station.is_featured) {
      posthog.capture("featured_station_click", {
        station_id:   station.station_id,
        station_name: station.name,
        position:     rank,
        price,
      });
    }
  }

  // Reset "show more" when tab or filters change
  useEffect(() => {
    setShowAllStations(false);
  }, [tab, areaFilter, brandFilter, search]);

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
    if (areaFilter.size  > 0 && !areaFilter.has(s._area))    return false;
    if (brandFilter.size > 0 && !brandFilter.has(s._brand))   return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.address.toLowerCase().includes(q)) return false;
    return true;
  });

  // Cheapest within filtered set (valid prices only) — drives "Cheapest" badge
  const cheapestPrices = {};
  const avgPrices = {};
  for (const { key } of FUEL_TYPES) {
    const allPrices  = stationsWithArea.map((s) => s[key]?.price).filter(VALID_PRICE);
    const filtPrices = filtered.map((s) => s[key]?.price).filter(VALID_PRICE);
    cheapestPrices[key] = filtPrices.length ? Math.min(...filtPrices) : null;
    avgPrices[key]      = allPrices.length  ? Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length * 10) / 10 : null;
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

    if (sortBy === "distance" && userCoords) {
      const aDist = haversineKm(userCoords.lat, userCoords.lng, a.latitude, a.longitude);
      const bDist = haversineKm(userCoords.lat, userCoords.lng, b.latitude, b.longitude);
      return aDist - bDist;
    }
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

  // Limit initial station list to 10 to reduce cognitive load
  const displayedStations = showAllStations ? sorted : sorted.slice(0, 10);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-title">
            <span className="header-icon">⛽</span>
            <div>
              <h1>GASMAN</h1>
              <p className="header-sub">Moving You Always &middot; powered by JM</p>
            </div>
          </div>
          <div className="header-actions">
            {lastRefresh && <span className="refresh-time">{timeAgo(lastRefresh.toISOString())}</span>}
            {showInstall && (
              <button className="btn-install" onClick={handleInstall} title="Add to Home Screen">
                📲 Install
              </button>
            )}
            <button className="btn-edit-profile" onClick={() => setShowProfile(true)} title="My Profile">⚙️</button>
          </div>
        </div>
      </header>

      <main className="main">
        <InsightsPanel trend={data?.trend} />

        {/* Tabs */}
        <div className="tabs-row">
          <div className="tabs">
            <button className={`tab-nav ${tab === "dashboard" ? "tab-nav-active" : ""}`} onClick={() => setTab("dashboard")}>
              📊 My Dashboard
              {(favourites.length + snapshots.length + savedRoutes.length) > 0 && (
                <span className="tab-badge">{favourites.length + snapshots.length + savedRoutes.length}</span>
              )}
            </button>
            <button className={`tab-nav ${tab === "all"   ? "tab-nav-active" : ""}`} onClick={() => setTab("all")}>
              All Stations
              {allStations.length > 0 && <span className="tab-badge">{allStations.length}</span>}
            </button>
            <button className={`tab-nav ${tab === "route" ? "tab-nav-active" : ""}`} onClick={() => setTab("route")}>
              🗺️ Route Finder
            </button>
            <button className={`tab-nav ${tab === "logs" ? "tab-nav-active" : ""}`} onClick={() => setTab("logs")}>
              ⛽ Logs
              {fillups.length > 0 && <span className="tab-badge">{fillups.length}</span>}
            </button>
          </div>
        </div>

        {/* Logs Tab */}
        {tab === "logs" && (
          <LogsTab
            fillups={fillups}
            onDelete={handleDeleteFillup}
            onEdit={(entry) => {
              const pseudoStation = entry.station_id ? {
                station_id: entry.station_id,
                name: entry.station_name,
                address: entry.station_address,
              } : null;
              setFillupTarget({ station: pseudoStation, fuelType: entry.fuel_type, editEntry: entry });
            }}
            onNavigate={setTab}
            onAddLog={() => {
              setFillupTarget({ station: null, fuelType: activeFuel });
              posthog.capture("station_log_started", { source: "logs_tab" });
            }}
          />
        )}

        {/* Route Tab */}
        {tab === "route" && (
          <RouteTab stations={stationsWithArea}
            activeRouteLoad={activeRouteLoad}
            onClearRouteLoad={() => setActiveRouteLoad(null)}
            onSaveRoute={handleSaveRoute}
            selectedCards={selectedCards}
            showCardDiscounts={showCardDiscounts}
            fillLitres={fillLitres}
            onOpenProfile={() => setShowProfile(true)}
            onLogFillup={(s, ft) => setFillupTarget({ station: s, fuelType: ft })}
            onOpenChart={(s) => setChartStation(s)} />
        )}

        {/* Dashboard Tab */}
        {tab === "dashboard" && (
          <Dashboard
            snapshots={snapshots}
            savedRoutes={savedRoutes}
            stationsWithArea={stationsWithArea}
            favourites={favourites}
            activeFuel={activeFuel}
            cheapestPrices={cheapestPrices}
            onToggleFavourite={toggleFavourite}
            onDeleteSnapshot={handleDeleteSnapshot}
            onDeleteRoute={handleDeleteRoute}
            onLaunchRoute={handleLaunchRoute}
            onNavigate={setTab}
            fillups={fillups}
            onDeleteFillup={handleDeleteFillup}
          />
        )}

        {/* Station list — All Stations tab: sidebar + content layout */}
        {tab === "all" && (
        <div className="all-stations-layout">

        {/* ── Sidebar: search, filters, controls ── */}
        <div className="all-stations-sidebar">
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
                Clear
              </button>
            )}
          </div>

          {/* Area filter */}
          <div className="filter-section">
            <span className="filter-label">Area</span>
            <div className="chip-row">
              {POPULAR_AREAS.map((name) => (
                <button key={name}
                  className={`brand-chip ${areaFilter.has(name) ? "brand-chip-active" : ""}`}
                  onClick={() => setAreaFilter(toggleSet(areaFilter, name))}
                >{name}</button>
              ))}
              <div className="area-more-wrap" ref={dropdownRef}>
                <button
                  className={`area-more-btn ${[...areaFilter].some((n) => !POPULAR_AREAS.includes(n)) ? "brand-chip-active" : ""}`}
                  onClick={() => { setAreaDropdownOpen((o) => !o); setAreaSearch(""); }}
                >
                  All regions {areaDropdownOpen ? "▴" : "▾"}
                </button>
                {areaDropdownOpen && (
                  <div className="area-dropdown">
                    <input className="area-search-input" type="text" placeholder="Search area..."
                      value={areaSearch} onChange={(e) => setAreaSearch(e.target.value)} autoFocus />
                    {Object.entries(BC_REGIONS).map(([region, cities]) => {
                      const filtered = cities.filter((c) => c.toLowerCase().includes(areaSearch.toLowerCase()));
                      if (!filtered.length) return null;
                      return (
                        <div key={region} className="area-region-group">
                          <div className="area-region-header">{region}</div>
                          {filtered.map((name) => (
                            <label key={name} className="area-dropdown-item">
                              <input type="checkbox" checked={areaFilter.has(name)}
                                onChange={() => setAreaFilter(toggleSet(areaFilter, name))} />
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

          {/* Brand filter */}
          {brands.length > 0 && (
            <div className="filter-section">
              <span className="filter-label">Brand</span>
              <div className="chip-row">
                {QUICK_BRANDS.filter((b) => brands.includes(b)).map((b) => (
                  <button key={b}
                    className={`brand-chip ${brandFilter.has(b) ? "brand-chip-active" : ""}`}
                    onClick={() => setBrandFilter(toggleSet(brandFilter, b))}
                  >{b}</button>
                ))}
                {brands.filter((b) => !QUICK_BRANDS.includes(b)).length > 0 && (
                  <div className="area-more-wrap" ref={brandDropdownRef}>
                    <button
                      className={`area-more-btn ${[...brandFilter].some((b) => !QUICK_BRANDS.includes(b)) ? "brand-chip-active" : ""}`}
                      onClick={() => { setBrandDropdownOpen((o) => !o); setBrandSearch(""); }}
                    >
                      More {brandDropdownOpen ? "▴" : "▾"}
                    </button>
                    {brandDropdownOpen && (
                      <div className="area-dropdown brand-dropdown">
                        <input className="area-search-input" type="text" placeholder="Search brand…"
                          value={brandSearch} onChange={(e) => setBrandSearch(e.target.value)} autoFocus />
                        {brands.filter((b) => !QUICK_BRANDS.includes(b) && b.toLowerCase().includes(brandSearch.toLowerCase())).map((b) => (
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

          {/* Controls: fuel tabs + icon buttons + sort + view */}
          <div className="controls">
            <div className="controls-top">
              <div className="fuel-tabs">
                {FUEL_TYPES.map(({ key, label }) => (
                  <button key={key}
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
            </div>
            <div className="controls-bottom">
              <div className="toolbar-icons">
                <button
                  className={`btn-icon ${showCardDiscounts && selectedCards.length > 0 ? "btn-icon-active" : ""}`}
                  onClick={selectedCards.length > 0 ? () => setShowCardDiscounts((o) => !o) : () => setShowProfile(true)}
                  title={selectedCards.length > 0 ? (showCardDiscounts ? "Card prices ON" : "Card prices OFF") : "Add a credit card"}
                >
                  <span className="btn-icon-emoji">💳</span>
                  <span className="btn-icon-label">Card</span>
                </button>
                <button
                  className={`btn-icon ${userCoords ? "btn-icon-active" : ""}`}
                  onClick={userCoords ? () => { setUserCoords(null); setSortBy("price"); } : getNearMe}
                  title={userCoords ? "Clear Near Me" : "Find stations near you"}
                  disabled={nearMeLoading}
                >
                  <span className="btn-icon-emoji">{nearMeLoading ? "⏳" : "📍"}</span>
                  <span className="btn-icon-label">{userCoords ? "Near ✓" : "Near Me"}</span>
                </button>
                <button
                  className={`btn-icon ${showFillCost ? "btn-icon-active" : ""}`}
                  onClick={() => { if (!fillLitres) { setShowProfile(true); return; } setShowFillCost((o) => !o); }}
                  title={fillLitres ? `Show fill cost (${fillLitres}L)` : "Set fill litres in Profile"}
                >
                  <span className="btn-icon-emoji">⛽</span>
                  <span className="btn-icon-label">Cost</span>
                </button>
              </div>
              <button className={`btn-map-toggle ${showMap ? "btn-map-toggle-active" : ""}`}
                onClick={() => setShowMap((v) => !v)}>
                🗺 Map
              </button>
              {viewMode !== "table" && (
                <div className="sort-controls">
                  <label>Sort</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="price">Price</option>
                    <option value="updated">Latest</option>
                    <option value="name">Name</option>
                    <option value="city">City</option>
                    {userCoords && <option value="distance">Distance</option>}
                  </select>
                </div>
              )}
              <div className="view-toggle">
                {[
                  { id: "card",    icon: "⊞", title: "Card view"    },
                  { id: "compact", icon: "☰", title: "Compact view" },
                  { id: "table",   icon: "⊟", title: "Table view"   },
                ].map(({ id, icon, title }) => (
                  <button key={id}
                    className={`view-btn ${viewMode === id ? "view-btn-active" : ""}`}
                    onClick={() => setViewMode(id)} title={title}
                  >{icon}</button>
                ))}
              </div>
              {nearMeError === "denied" && <span className="near-me-error">Location denied</span>}
            </div>
          </div>
        </div>{/* end sidebar */}

        {/* ── Content: loading states + station results ── */}
        <div className="all-stations-content">
        {error && (
          <div className="error-box">Failed to load: {error}.{" "}<button onClick={fetchData}>Retry</button></div>
        )}

        {loading && !data && !scanning && (
          <div className="loading-box">
            <div className="spinner" />
            <p>Fetching gas prices across British Columbia…</p>
          </div>
        )}

        {/* Scan progress banner — only shown during discovery */}
        {scanStatus?.mode === "discovery" && (scanStatus?.running || scanning) && (
          <div className="scan-banner">
            <div className="spinner spinner-sm" />
            <div className="scan-banner-text">
              <span>
                <strong>{scanStatus?.mode === "discovery" ? "Discovering" : "Refreshing"} stations</strong>
                {scanStatus?.stations_found > 0 && ` · ${scanStatus.stations_found} found`}
              </span>
              {scanStatus?.zones_done > 0 && scanStatus?.zones_total > 0 && (
                <span className="scan-progress-label">
                  {Math.round(scanStatus.zones_done / scanStatus.zones_total * 100)}% · zone {scanStatus.zones_done}/{scanStatus.zones_total}
                  {scanStatus.session > 1 && ` · session ${scanStatus.session}`}
                </span>
              )}
            </div>
            {scanStatus?.zones_done > 0 && scanStatus?.zones_total > 0 && (
              <div className="scan-progress-bar scan-banner-bar">
                <div className="scan-progress-fill"
                  style={{ width: `${Math.round(scanStatus.zones_done / scanStatus.zones_total * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {loading && !data && scanning && (
          <div className="loading-box">
            <div className="spinner" />
            <p>Waiting for first stations…</p>
          </div>
        )}

        {data && sorted.length === 0 && !loading && (
          <div className="empty-state">
            {scanning ? (
              <>
                <p style={{ fontSize: "2rem" }}>📡</p>
                <p><strong>Scanning for stations…</strong></p>
                <p style={{ color: "var(--text-dim)", fontSize: "0.88rem" }}>
                  First results will appear shortly. The page updates automatically.
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: "2rem" }}>🔍</p>
                <p><strong>No stations match your filters</strong></p>
                {(areaFilter.size > 0 || brandFilter.size > 0 || search) && (
                  <button className="btn-clear-filters" style={{ marginTop: 8 }}
                    onClick={() => { setAreaFilter(new Set()); setBrandFilter(new Set()); setSearch(""); }}>
                    Clear all filters
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {data && sorted.length > 0 && (
          <>
            <StationSummaryBar sorted={sorted} activeFuel={activeFuel} cheapestPrices={cheapestPrices} userCoords={userCoords} />
            <p className="station-count">{sorted.length} station{sorted.length !== 1 ? "s" : ""}</p>

            <div className={showMap ? "split-view" : ""}>
              <div className={showMap ? "split-list" : ""}>

            {viewMode === "card" && (
              <div className="grid">
                {displayedStations.map((station, i) => (
                  <div
                    key={station.station_id}
                    className={selectedStation?.station_id === station.station_id ? "card-selected" : ""}
                    onClick={() => handleSelectStation(station, i + 1)}
                  >
                    <StationCard
                      station={station}
                      activeFuel={activeFuel}
                      cheapestPrices={cheapestPrices}
                      isFavourite={favourites.includes(station.station_id)}
                      onToggleFavourite={toggleFavourite}
                      onOpenChart={setChartStation}
                      onSnapshot={handleSnapshot}
                      showArea={sortBy === "city"}
                      selectedCards={selectedCards}
                      showCardDiscounts={showCardDiscounts}
                      fillLitres={fillLitres}
                      showFillCost={showFillCost}
                      userCoords={userCoords}
                      onLogFillup={(s) => {
                        setFillupTarget({ station: s, fuelType: activeFuel });
                        posthog.capture("station_log_started", { source: "station_card", station_id: s.station_id });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {viewMode === "compact" && (
              <div className="compact-list">
                {displayedStations.map((station, i) => {
                  const fuelData = station[activeFuel];
                  const isCheapest = VALID_PRICE(fuelData?.price) && fuelData.price === cheapestPrices[activeFuel];
                  const delta = station.price_delta?.[activeFuel];
                  const isFav = favourites.includes(station.station_id);
                  const isSelected = selectedStation?.station_id === station.station_id;
                  return (
                    <div key={station.station_id} className={`compact-row ${isCheapest ? "compact-cheapest" : ""} ${isSelected ? "compact-selected" : ""}`} onClick={() => handleSelectStation(station, i + 1)}>
                      <button
                        className={`btn-fav btn-fav-sm ${isFav ? "btn-fav-active" : ""}`}
                        onClick={(e) => { e.stopPropagation(); toggleFavourite(station.station_id); }}
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
                          onClick={(e) => e.stopPropagation()}
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
                      {VALID_PRICE(fuelData?.price) && (
                        <button className="btn-snapshot btn-chart-sm" onClick={(e) => { e.stopPropagation(); handleSnapshot(station, activeFuel); }} title="Save current price to My Dashboard">📷 Save</button>
                      )}
                      <button className="btn-chart btn-chart-sm" onClick={(e) => { e.stopPropagation(); setChartStation(station); }} title="Price history">📈</button>
                    </div>
                  );
                })}
              </div>
            )}

            {viewMode === "table" && (
              <StationTable
                stations={displayedStations}
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

            {/* Show more button */}
            {!showAllStations && sorted.length > 10 && (
              <button className="btn-show-more"
                onClick={() => { setShowAllStations(true); posthog.capture("show_more_clicked", { total: sorted.length }); }}
              >
                Show {sorted.length - 10} more stations
              </button>
            )}
          </>
        )}
        </div>{/* end all-stations-content */}
        </div>)}{/* end all-stations-layout / tab === all */}
      </main>

      {chartStation && (
        <ChartModal
          station={chartStation}
          activeFuel={activeFuel}
          onClose={() => setChartStation(null)}
          onLogFillup={(s, fuelType) => { setFillupTarget({ station: s, fuelType }); setChartStation(null); }}
          onSnapshot={(s, fuelType) => { handleSnapshot(s, fuelType); setChartStation(null); }}
        />
      )}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {fillupTarget && (
        <FillupModal
          station={fillupTarget.station}
          fuelType={fillupTarget.fuelType}
          avgPriceAtLog={avgPrices[fillupTarget.fuelType] ?? null}
          onSave={handleSaveFillup}
          onClose={() => setFillupTarget(null)}
          editEntry={fillupTarget.editEntry ?? null}
          favouriteStations={stationsWithArea.filter((s) => favourites.includes(s.station_id))}
        />
      )}
      {!onboarded && <Onboarding onDone={() => setOnboarded(true)} />}
      <BottomNav tab={tab} setTab={setTab} fillupCount={fillups.length} />

      <footer className="app-footer">
        GASMAN is an independent, non-commercial project for academic &amp; personal use among friends and family only.
        Price data is sourced from public listings and provided for informational purposes.
        We make no guarantees of accuracy or completeness. Not affiliated with any fuel retailer or pricing service.
      </footer>
    </div>
  );
}
