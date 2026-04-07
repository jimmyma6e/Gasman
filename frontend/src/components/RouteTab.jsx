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

function distToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return haversineKm(pLat, pLng, aLat, aLng);
  const t = Math.max(0, Math.min(1, ((pLng - aLng) * dx + (pLat - aLat) * dy) / len2));
  return haversineKm(pLat, pLng, aLat + t * dy, aLng + t * dx);
}

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
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

// ── Leaflet helpers ───────────────────────────────────────────────────────────

function makeIcon(label, color, selected) {
  const size = selected ? 34 : 28;
  const border = selected ? "3px solid #fff" : "2px solid #fff";
  const shadow = selected
    ? "0 0 0 3px rgba(249,115,22,0.6), 0 3px 10px rgba(0,0,0,0.3)"
    : "0 2px 6px rgba(0,0,0,0.3)";
  return L.divIcon({
    className: "",
    html: `<div style="
      background:${color};color:#fff;font-weight:700;font-size:0.7rem;
      border-radius:50%;width:${size}px;height:${size}px;display:flex;
      align-items:center;justify-content:center;
      border:${border};box-shadow:${shadow};
      transition:all 0.2s;">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
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
    if (polyline.length > 0)
      map.fitBounds(polyline, { padding: [40, 40], animate: true });
  }, [polyline.map((p) => p.join(",")).join("|")]);
  return null;
}

// Flies to selected station and opens its popup
function StationFocuser({ station, markerRefs }) {
  const map = useMap();
  useEffect(() => {
    if (!station) return;
    map.flyTo([station.latitude, station.longitude], 15, { duration: 0.6 });
    const marker = markerRefs.current[station.station_id];
    if (marker) setTimeout(() => marker.openPopup(), 700);
  }, [station?.station_id]);
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
const DETOUR_PENALTY_PER_KM = 0.4;
const STATION_COLORS = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#ffedd5"];

export default function RouteTab({ stations }) {
  const [fromPlace, setFromPlace]         = useState(null);
  const [toPlace, setToPlace]             = useState(null);
  const [fuelType, setFuelType]           = useState("regular_gas");
  const [routeCoords, setRouteCoords]     = useState(null);
  const [results, setResults]             = useState(null);   // all stations near route
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [routeInfo, setRouteInfo]         = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [brandFilter, setBrandFilter]     = useState(new Set());
  const markerRefs = useRef({});

  const handleFind = useCallback(async () => {
    if (!fromPlace || !toPlace) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setRouteCoords(null);
    setRouteInfo(null);
    setSelectedStation(null);
    setBrandFilter(new Set());

    try {
      const polyline = await getOsrmRoute(fromPlace, toPlace);
      setRouteCoords(polyline);

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

  // Available brands from current results
  const availableBrands = results
    ? [...new Set(results.map((s) => s._brand || s.name).filter(Boolean))].sort()
    : [];

  // Apply brand filter to list (map always shows all results)
  const displayedResults = results
    ? (brandFilter.size > 0
        ? results.filter((s) => brandFilter.has(s._brand || s.name))
        : results)
    : null;

  const fuelLabel = FUEL_TYPES.find((f) => f.key === fuelType)?.label || "";

  function toggleBrand(b) {
    setBrandFilter((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });
  }

  function handleSelectStation(s) {
    setSelectedStation((prev) => prev?.station_id === s.station_id ? null : s);
  }

  return (
    <div className="route-tab">
      {/* ── Input form ── */}
      <div className="route-form">
        <PlaceInput label="From" value={fromPlace} onSelect={setFromPlace} placeholder="e.g. Vancouver, BC" />
        <PlaceInput label="To"   value={toPlace}   onSelect={setToPlace}   placeholder="e.g. Whistler, BC" />
        <div className="route-fuel-wrap">
          <label className="route-place-label">Fuel</label>
          <select className="route-fuel-select" value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
            {FUEL_TYPES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <button className="btn-refresh route-find-btn" onClick={handleFind}
          disabled={!fromPlace || !toPlace || loading}>
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
            <StationFocuser station={selectedStation} markerRefs={markerRefs} />
            <Polyline positions={routeCoords} color="#3b82f6" weight={4} opacity={0.75} />
            <Marker position={[fromPlace.lat, fromPlace.lng]} icon={fromIcon}>
              <Popup>{fromPlace.display_name}</Popup>
            </Marker>
            <Marker position={[toPlace.lat, toPlace.lng]} icon={toIcon}>
              <Popup>{toPlace.display_name}</Popup>
            </Marker>
            {results?.map((s, i) => {
              const isSelected = selectedStation?.station_id === s.station_id;
              return (
                <Marker
                  key={s.station_id}
                  ref={(r) => { if (r) markerRefs.current[s.station_id] = r; }}
                  position={[s.latitude, s.longitude]}
                  icon={makeIcon(i + 1, STATION_COLORS[i] || "#94a3b8", isSelected)}
                  eventHandlers={{ click: () => handleSelectStation(s) }}
                >
                  <Popup>
                    <strong>{s.name}</strong><br />
                    {s.address}<br />
                    {fuelLabel}: <strong>{s[fuelType].price}¢</strong><br />
                    {s.detour <= 0.3 ? "On route" : `Detour: ~${s.detour}km`}
                  </Popup>
                </Marker>
              );
            })}
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

      {/* ── Brand filter (shown only when results exist) ── */}
      {availableBrands.length > 1 && (
        <div className="route-brand-filter">
          <span className="route-brand-label">Filter by brand</span>
          <div className="route-brand-chips">
            {availableBrands.map((b) => (
              <button
                key={b}
                className={`brand-chip ${brandFilter.has(b) ? "brand-chip-active" : ""}`}
                onClick={() => toggleBrand(b)}
              >
                {b}
              </button>
            ))}
            {brandFilter.size > 0 && (
              <button className="btn-clear-filters" onClick={() => setBrandFilter(new Set())}>
                Clear
              </button>
            )}
          </div>
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

      {displayedResults?.length > 0 && (
        <div className="route-results">
          <p className="route-results-title">
            Best <strong>{fuelLabel}</strong> stations along your route
            <span style={{ fontWeight: 400, color: "var(--text-dim)", fontSize: "0.78rem", marginLeft: 8 }}>
              click a row to see on map
            </span>
          </p>
          <div className="route-result-list">
            {displayedResults.map((s, i) => {
              const priceData = s[fuelType];
              const rank = results.indexOf(s) + 1;
              const isSelected = selectedStation?.station_id === s.station_id;
              return (
                <div
                  key={s.station_id}
                  className={`route-result-row ${rank === 1 ? "route-result-best" : ""} ${isSelected ? "route-result-selected" : ""}`}
                  onClick={() => handleSelectStation(s)}
                >
                  <div className="route-result-rank" style={{ background: STATION_COLORS[rank - 1] || "#94a3b8" }}>
                    {rank}
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

      {displayedResults?.length === 0 && results?.length > 0 && (
        <div className="empty-state" style={{ padding: "30px 20px" }}>
          <p>No stations match the selected brand{brandFilter.size > 1 ? "s" : ""}.</p>
          <button className="btn-clear-filters" style={{ marginTop: 8 }}
            onClick={() => setBrandFilter(new Set())}>Clear brand filter</button>
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
