import { useState, useRef, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular (87)" },
  { key: "midgrade_gas", label: "Mid (89)"     },
  { key: "premium_gas",  label: "Premium (91)" },
  { key: "diesel",       label: "Diesel"       },
];

// ── Geo helpers ─────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Perpendicular distance (km) from point P to segment A→B
function distToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return haversineKm(pLat, pLng, aLat, aLng);
  const t = Math.max(0, Math.min(1, ((pLng - aLng) * dx + (pLat - aLat) * dy) / len2));
  return haversineKm(pLat, pLng, aLat + t * dy, aLng + t * dx);
}

// Minimum distance from station to any segment of the route polyline
function distToRouteKm(sLat, sLng, polyline) {
  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [aLat, aLng] = polyline[i];
    const [bLat, bLng] = polyline[i + 1];
    const d = distToSegmentKm(sLat, sLng, aLat, aLng, bLat, bLng);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ── APIs ─────────────────────────────────────────────────────────────────────

async function nominatimSearch(q) {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(q + " BC Canada")}` +
    `&format=json&limit=5&addressdetails=0&countrycodes=ca`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Gasman/1.0 (gasman-app)" },
  });
  return res.json();
}

async function getOsrmRoute(from, to) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length)
    throw new Error("No route found between these locations.");
  // OSRM returns [lng, lat] — convert to [lat, lng] for Leaflet
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

// ── Leaflet icon helpers ──────────────────────────────────────────────────────

function makeIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:${color};color:#fff;font-weight:700;font-size:0.7rem;
      border-radius:50%;width:28px;height:28px;display:flex;
      align-items:center;justify-content:center;
      border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);
      white-space:nowrap;line-height:1;">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const fromIcon = L.divIcon({
  className: "",
  html: `<div style="background:#16a34a;color:#fff;font-weight:700;font-size:0.75rem;
    border-radius:50%;width:32px;height:32px;display:flex;align-items:center;
    justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">A</div>`,
  iconSize: [32, 32], iconAnchor: [16, 16],
});

const toIcon = L.divIcon({
  className: "",
  html: `<div style="background:#dc2626;color:#fff;font-weight:700;font-size:0.75rem;
    border-radius:50%;width:32px;height:32px;display:flex;align-items:center;
    justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">B</div>`,
  iconSize: [32, 32], iconAnchor: [16, 16],
});

function RouteMapFit({ polyline }) {
  const map = useMap();
  useEffect(() => {
    if (polyline.length > 0) {
      map.fitBounds(polyline, { padding: [40, 40], animate: true });
    }
  }, [polyline.map((p) => p.join(",")).join("|")]);
  return null;
}

// ── Address autocomplete input ───────────────────────────────────────────────

function PlaceInput({ label, value, onSelect, placeholder }) {
  const [query, setQuery] = useState(value?.display_name || "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (value) setQuery(value.display_name);
  }, [value?.display_name]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const results = await nominatimSearch(q);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch { /* ignore */ }
    }, 400);
  }

  function handleSelect(s) {
    setQuery(s.display_name);
    setSuggestions([]);
    setOpen(false);
    onSelect({ lat: parseFloat(s.lat), lng: parseFloat(s.lon), display_name: s.display_name });
  }

  return (
    <div className="route-place-wrap" ref={wrapRef}>
      <label className="route-place-label">{label}</label>
      <input
        className="route-place-input"
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="route-suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="route-suggestion-item" onMouseDown={() => handleSelect(s)}>
              {s.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main RouteTab ─────────────────────────────────────────────────────────────

const DETOUR_THRESHOLD_KM = 5;
// Effective cost penalty: ~0.4¢/L per km of detour (based on ~12L/100km avg, 50L fill)
const DETOUR_PENALTY_PER_KM = 0.4;
const STATION_COLORS = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#ffedd5"];

export default function RouteTab({ stations }) {
  const [fromPlace, setFromPlace] = useState(null);
  const [toPlace, setToPlace]     = useState(null);
  const [fuelType, setFuelType]   = useState("regular_gas");
  const [routeCoords, setRouteCoords] = useState(null);
  const [results, setResults]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [routeInfo, setRouteInfo] = useState(null); // {distanceKm, durationMin}

  const handleFind = useCallback(async () => {
    if (!fromPlace || !toPlace) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setRouteCoords(null);
    setRouteInfo(null);

    try {
      // 1. Get driving route
      const polyline = await getOsrmRoute(fromPlace, toPlace);
      setRouteCoords(polyline);

      // Rough distance from OSRM (re-fetch with annotations for accuracy)
      const osrmUrl =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${fromPlace.lng},${fromPlace.lat};${toPlace.lng},${toPlace.lat}?overview=false`;
      const meta = await fetch(osrmUrl).then((r) => r.json());
      if (meta.code === "Ok") {
        const route = meta.routes[0];
        setRouteInfo({
          distanceKm: Math.round(route.distance / 1000),
          durationMin: Math.round(route.duration / 60),
        });
      }

      // 2. Filter stations with price for selected fuel, within threshold
      const candidates = stations
        .filter((s) => s[fuelType]?.price && s.latitude && s.longitude)
        .map((s) => {
          const detour = distToRouteKm(s.latitude, s.longitude, polyline);
          const price = s[fuelType].price;
          const effective = price + detour * DETOUR_PENALTY_PER_KM;
          return { ...s, detour: Math.round(detour * 10) / 10, effective };
        })
        .filter((s) => s.detour <= DETOUR_THRESHOLD_KM)
        .sort((a, b) => a.effective - b.effective);

      setResults(candidates.slice(0, 10));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fromPlace, toPlace, fuelType, stations]);

  const fuelLabel = FUEL_TYPES.find((f) => f.key === fuelType)?.label || "";

  return (
    <div className="route-tab">
      {/* ── Input form ── */}
      <div className="route-form">
        <PlaceInput
          label="From"
          value={fromPlace}
          onSelect={setFromPlace}
          placeholder="e.g. Vancouver, BC"
        />
        <PlaceInput
          label="To"
          value={toPlace}
          onSelect={setToPlace}
          placeholder="e.g. Whistler, BC"
        />
        <div className="route-fuel-wrap">
          <label className="route-place-label">Fuel</label>
          <select
            className="route-fuel-select"
            value={fuelType}
            onChange={(e) => setFuelType(e.target.value)}
          >
            {FUEL_TYPES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
        <button
          className="btn-refresh route-find-btn"
          onClick={handleFind}
          disabled={!fromPlace || !toPlace || loading}
        >
          {loading ? "Finding…" : "Find Stations"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* ── Map ── */}
      {routeCoords && (
        <div className="route-map-wrap">
          <MapContainer
            center={routeCoords[Math.floor(routeCoords.length / 2)]}
            zoom={9}
            style={{ height: "100%", width: "100%", borderRadius: 12 }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <RouteMapFit polyline={routeCoords} />
            <Polyline positions={routeCoords} color="#3b82f6" weight={4} opacity={0.75} />
            <Marker position={[fromPlace.lat, fromPlace.lng]} icon={fromIcon}>
              <Popup>{fromPlace.display_name}</Popup>
            </Marker>
            <Marker position={[toPlace.lat, toPlace.lng]} icon={toIcon}>
              <Popup>{toPlace.display_name}</Popup>
            </Marker>
            {results?.map((s, i) => (
              <Marker
                key={s.station_id}
                position={[s.latitude, s.longitude]}
                icon={makeIcon(i + 1, STATION_COLORS[i] || "#94a3b8")}
              >
                <Popup>
                  <strong>{s.name}</strong><br />
                  {s.address}<br />
                  {fuelLabel}: <strong>{s[fuelType].price}¢</strong><br />
                  Detour: ~{s.detour}km
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {/* ── Route summary ── */}
      {routeInfo && (
        <div className="route-summary">
          <span>🛣️ <strong>{routeInfo.distanceKm} km</strong></span>
          <span>⏱️ <strong>{routeInfo.durationMin} min</strong></span>
          {results !== null && (
            <span>⛽ <strong>{results.length}</strong> station{results.length !== 1 ? "s" : ""} along route</span>
          )}
        </div>
      )}

      {/* ── Results ── */}
      {results !== null && results.length === 0 && (
        <div className="empty-state">
          <p>No stations found within {DETOUR_THRESHOLD_KM}km of this route.</p>
          <p style={{ fontSize: "0.82rem", color: "var(--text-dim)", marginTop: 6 }}>
            Try a different fuel type or route.
          </p>
        </div>
      )}

      {results?.length > 0 && (
        <div className="route-results">
          <p className="route-results-title">
            Best <strong>{fuelLabel}</strong> stations along your route
            <span style={{ fontWeight: 400, color: "var(--text-dim)", fontSize: "0.78rem", marginLeft: 8 }}>
              sorted by price + detour cost
            </span>
          </p>
          <div className="route-result-list">
            {results.map((s, i) => {
              const priceData = s[fuelType];
              return (
                <div key={s.station_id} className={`route-result-row ${i === 0 ? "route-result-best" : ""}`}>
                  <div className="route-result-rank" style={{ background: STATION_COLORS[i] || "#94a3b8" }}>
                    {i + 1}
                  </div>
                  <div className="route-result-info">
                    <span className="route-result-name">{s.name}</span>
                    <span className="route-result-addr">{s.address}{s._area ? ` · ${s._area}` : ""}</span>
                  </div>
                  <div className="route-result-right">
                    <span className="route-result-price">{priceData.price}¢</span>
                    <span className="route-result-detour">
                      {s.detour <= 0.3 ? "on route" : `+${s.detour}km detour`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="route-results-note">
            Effective cost includes a ~{DETOUR_PENALTY_PER_KM}¢/L per km detour penalty
          </p>
        </div>
      )}

      {/* ── Empty prompt ── */}
      {!routeCoords && !loading && !error && (
        <div className="route-empty-prompt">
          <span style={{ fontSize: "2.5rem" }}>🗺️</span>
          <p><strong>Find the cheapest station on your route</strong></p>
          <p>Enter your start and destination, pick a fuel type, and we'll suggest the best stops along the way.</p>
        </div>
      )}
    </div>
  );
}
