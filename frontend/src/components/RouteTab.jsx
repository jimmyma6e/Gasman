import { useState, useRef, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import posthog from "posthog-js";
import { bestCardSavings } from "../creditCards.js";

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular (87)" },
  { key: "midgrade_gas", label: "Mid (89)"     },
  { key: "premium_gas",  label: "Premium (91)" },
  { key: "diesel",       label: "Diesel"       },
];

const SAVE_PRESETS = [
  { emoji: "🏠", label: "Home"   },
  { emoji: "💼", label: "Office" },
  { emoji: "🎓", label: "School" },
];

const VEHICLE_PRESETS = [
  { icon: "🚗", label: "Compact",  l100km: 7  },
  { icon: "🚙", label: "Sedan",    l100km: 9  },
  { icon: "🚐", label: "SUV/Van",  l100km: 12 },
  { icon: "🛻", label: "Truck",    l100km: 14 },
];

function calcTripCost(distanceKm, consumption, priceCents) {
  return distanceKm * (consumption / 100) * (priceCents / 100);
}

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
  const dx = bLng - aLng, dy = bLat - aLat;
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
    `&format=json&limit=5&addressdetails=1&countrycodes=ca`;
  const res = await fetch(url, { headers: { "User-Agent": "Gasman/1.0 (gasman-app)" } });
  return res.json();
}

function formatPlace(r) {
  const a = r.address || {};
  const houseNum = a.house_number || "";
  const road     = a.road || a.pedestrian || a.footway || null;
  const city     = a.city || a.town || a.village || a.municipality || a.county || "";
  const postcode = a.postcode ? a.postcode.split(" ")[0] : "";

  // Determine result type: named place vs street address vs road
  const isStreetAddr = r.type === "house" || (!!houseNum && !r.name);
  const isRoad       = r.class === "highway";

  const parts = [];
  if (!isStreetAddr && !isRoad && r.name) {
    parts.push(r.name);
    if (houseNum && road) parts.push(`${houseNum} ${road}`);
  } else if (road) {
    parts.push(houseNum ? `${houseNum} ${road}` : road);
  }
  if (city && city !== r.name) parts.push(city);
  if (postcode) parts.push(postcode);

  if (parts.length) return parts.join(", ");
  // Fallback: strip noise from display_name
  return r.display_name.split(", ")
    .filter((p) => !/Canada|British Columbia|Regional District|Regional Municipality/.test(p) && !/^\d[A-Z]\d/.test(p))
    .slice(0, 4).join(", ");
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
  const shadow = selected
    ? "0 0 0 3px rgba(249,115,22,0.6), 0 3px 10px rgba(0,0,0,0.3)"
    : "0 2px 6px rgba(0,0,0,0.3)";
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;font-weight:700;font-size:0.7rem;
      border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;
      justify-content:center;border:${selected ? "3px" : "2px"} solid #fff;
      box-shadow:${shadow};">${label}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
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

// ── SavePlacePanel ────────────────────────────────────────────────────────────

function SavePlacePanel({ onSave, onCancel, saveLabel, setSaveLabel }) {
  const [selectedEmoji, setSelectedEmoji] = useState("📍");
  return (
    <div className="save-place-panel">
      <div className="save-place-presets">
        {SAVE_PRESETS.map((p) => (
          <button key={p.label}
            className={`save-place-preset ${saveLabel === p.label && selectedEmoji === p.emoji ? "save-place-preset-active" : ""}`}
            onClick={() => { setSaveLabel(p.label); setSelectedEmoji(p.emoji); }}>
            {p.emoji} {p.label}
          </button>
        ))}
      </div>
      <input className="save-place-custom" placeholder="Custom label…"
        value={saveLabel} maxLength={32} autoFocus
        onChange={(e) => { setSaveLabel(e.target.value); setSelectedEmoji("📍"); }} />
      <div className="save-place-actions">
        <button className="btn-refresh save-place-save"
          onClick={() => onSave(selectedEmoji, saveLabel)}
          disabled={!saveLabel.trim()}>Save</button>
        <button className="btn-clear-filters" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── PlaceInput ────────────────────────────────────────────────────────────────

function PlaceInput({ label, value, onSelect, placeholder, savedPlaces = [], onDelete }) {
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

  const filteredSaved = savedPlaces.filter((p) =>
    query.length < 2 ||
    p.label.toLowerCase().includes(query.toLowerCase()) ||
    p.display_name.toLowerCase().includes(query.toLowerCase())
  );

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); setOpen(true); return; }
    timer.current = setTimeout(async () => {
      try {
        const results = await nominatimSearch(q);
        setSuggestions(results);
        setOpen(true);
      } catch { /* ignore */ }
    }, 400);
  }

  function handleSelect(s) {
    const label = formatPlace(s);
    setQuery(label);
    setSuggestions([]);
    setOpen(false);
    onSelect({ lat: parseFloat(s.lat), lng: parseFloat(s.lon), display_name: label });
  }

  return (
    <div className="route-place-wrap" ref={wrapRef}>
      <input
        className="route-place-input"
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (filteredSaved.length > 0 || suggestions.length > 0) && (
        <div className="route-suggestions">
          {filteredSaved.length > 0 && (
            <>
              <div className="route-saved-section-header">Saved</div>
              {filteredSaved.map((p) => (
                <div key={p.id} className="route-saved-item">
                  <button className="route-saved-pick"
                    onMouseDown={() => {
                      setQuery(p.display_name);
                      setSuggestions([]);
                      setOpen(false);
                      onSelect({ lat: p.lat, lng: p.lng, display_name: p.display_name });
                    }}>
                    <span className="route-saved-emoji">{p.emoji}</span>
                    <span className="route-saved-label">{p.label}</span>
                    <span className="route-saved-addr">{p.display_name}</span>
                  </button>
                  <button className="route-saved-delete"
                    onMouseDown={(e) => { e.preventDefault(); onDelete(p.id); }}
                    title="Remove">×</button>
                </div>
              ))}
              {suggestions.length > 0 && (
                <div className="route-saved-section-header">Results</div>
              )}
            </>
          )}
          {suggestions.map((s, i) => (
            <button key={i} className="route-suggestion-item" onMouseDown={() => handleSelect(s)}>
              {formatPlace(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Result badge helper ───────────────────────────────────────────────────────

function getResultBadges(s, allResults, fuelType, routeInfo, consumption) {
  if (!allResults.length) return [];
  const prices  = allResults.map((r) => r[fuelType].price);
  const detours = allResults.map((r) => r.detour);
  const minPrice  = Math.min(...prices);
  const minDetour = Math.min(...detours);
  const maxCost   = Math.max(...allResults.map((r) =>
    calcTripCost(routeInfo?.distanceKm || 0, consumption, r[fuelType].price)));
  const myCost    = calcTripCost(routeInfo?.distanceKm || 0, consumption, s[fuelType].price);
  const savings   = maxCost - myCost;

  const badges = [];
  if (s[fuelType].price === minPrice)
    badges.push({ text: "Cheapest price", cls: "res-badge-green" });
  if (s.detour <= 0.3 && s.detour === minDetour)
    badges.push({ text: "On your route", cls: "res-badge-blue" });
  else if (s.detour === minDetour)
    badges.push({ text: `Least detour · +${s.detour}km`, cls: "res-badge-blue" });
  else if (s.detour <= 0.3)
    badges.push({ text: "On your route", cls: "res-badge-blue" });
  if (savings >= 1.0 && !badges.some((b) => b.cls === "res-badge-green"))
    badges.push({ text: `Saves $${savings.toFixed(2)} on trip`, cls: "res-badge-purple" });
  return badges;
}

// ── Main RouteTab ─────────────────────────────────────────────────────────────

const ROUTE_MODES = [
  { id: "cheapest", label: "Cheapest",  emoji: "💰", penalty: 0.4, threshold: 5,
    hint: "Balances price & detour — up to 5km off route" },
  { id: "rush",     label: "In a Rush", emoji: "⚡", penalty: 3.0, threshold: 1.5,
    hint: "Only stations within 1.5km — minimal time lost" },
  { id: "chill",    label: "Chill",     emoji: "😎", penalty: 0.1, threshold: 15,
    hint: "Willing to detour up to 15km for a better price" },
];

const POPULAR_BRANDS_RT = [
  "Petro-Canada", "Shell", "Chevron", "Esso", "Husky",
  "Costco", "Canadian Tire", "7-Eleven", "Fas Gas", "Co-op",
];

const STATION_COLORS = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#ffedd5"];

export default function RouteTab({ stations, activeRouteLoad, onClearRouteLoad, onSaveRoute, selectedCards, showCardDiscounts: showCardDiscountsProp, fillLitres: fillLitresProp, onOpenProfile, onLogFillup }) {
  const [fromPlace, setFromPlace]           = useState(null);
  const [toPlace, setToPlace]               = useState(null);
  const [fuelType, setFuelType]             = useState("regular_gas");
  const [routeCoords, setRouteCoords]       = useState(null);
  const [results, setResults]               = useState(null);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState(null);
  const [routeInfo, setRouteInfo]           = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  const [brandFilter, setBrandFilter]       = useState(new Set());

  // Saved places
  const [savedPlaces, setSavedPlaces] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-saved-places") || "[]"); }
    catch { return []; }
  });
  const [savingFor, setSavingFor]   = useState(null);  // "from" | "to" | null
  const [saveLabel, setSaveLabel]   = useState("");

  // Saved vehicles
  const [vehicles, setVehicles] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-vehicles") || "[]"); }
    catch { return []; }
  });
  const [activeVehicleId, setActiveVehicleId] = useState(
    () => localStorage.getItem("gasman-active-vehicle") || null
  );
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) || null;

  function pickVehicle(v) {
    setActiveVehicleId(v.id);
    setConsumption(v.l100km);
    localStorage.setItem("gasman-active-vehicle", v.id);
    localStorage.setItem("gasman-consumption", String(v.l100km));
  }

  // Vehicle consumption — init from active vehicle or localStorage
  const [consumption, setConsumption] = useState(() => {
    const activeId = localStorage.getItem("gasman-active-vehicle");
    if (activeId) {
      try {
        const vs = JSON.parse(localStorage.getItem("gasman-vehicles") || "[]");
        const active = vs.find((v) => v.id === activeId);
        if (active?.l100km > 0) return active.l100km;
      } catch { /* fall through */ }
    }
    const v = parseFloat(localStorage.getItem("gasman-consumption"));
    return isNaN(v) || v <= 0 ? 10 : v;
  });

  // Local fill litres — init from All Stations prop, kept in sync
  const [fillLitres, setFillLitres] = useState(fillLitresProp || "");

  const [savingRoute, setSavingRoute] = useState(false);
  const [routeLabel, setRouteLabel]   = useState("");

  const [routeMode, setRouteMode] = useState("cheapest");
  const [preferredBrands, setPreferredBrands] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("gasman-preferred-brands") || "[]")); }
    catch { return new Set(); }
  });
  const [brandPrefOpen, setBrandPrefOpen] = useState(false);

  // Local card discount toggle (independent from All Stations toggle)
  const [showCardDiscounts, setShowCardDiscounts] = useState(showCardDiscountsProp ?? false);

  const markerRefs = useRef({});

  // Pre-load a saved route when launched from Dashboard
  useEffect(() => {
    if (!activeRouteLoad) return;
    setFromPlace(activeRouteLoad.fromPlace);
    setToPlace(activeRouteLoad.toPlace);
    setFuelType(activeRouteLoad.fuelType);
    setResults(null);
    setRouteCoords(null);
    setRouteInfo(null);
    onClearRouteLoad();
  }, [activeRouteLoad]);

  const handleFind = useCallback(async () => {
    if (!fromPlace || !toPlace) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setRouteCoords(null);
    setRouteInfo(null);
    setSelectedStation(null);
    // Auto-seed brand filter from preferred brands; clear otherwise
    setBrandFilter(preferredBrands.size > 0 ? new Set(preferredBrands) : new Set());
    setSavingFor(null);
    setSaveLabel("");

    const mode = ROUTE_MODES.find((m) => m.id === routeMode) || ROUTE_MODES[0];
    const DETOUR_THRESHOLD_KM = mode.threshold;
    const DETOUR_PENALTY_PER_KM = mode.penalty;

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

      const top = candidates.slice(0, 10);
      setResults(top);

      // Analytics: route_search fires once per search, after results are known
      const prices = top.map((s) => s[fuelType]?.price).filter(Boolean);
      posthog.capture("route_search", {
        origin:            fromPlace.display_name,
        destination:       toPlace.display_name,
        stations_found:    top.length,
        estimated_savings: prices.length > 1
          ? Math.round((Math.max(...prices) - Math.min(...prices)) * 10) / 10
          : 0,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fromPlace, toPlace, fuelType, stations, routeMode, preferredBrands]);

  const handleSavePlace = useCallback((place, emoji, label) => {
    if (!place || !label.trim()) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: label.trim(), emoji,
      lat: place.lat, lng: place.lng, display_name: place.display_name,
    };
    setSavedPlaces((prev) => {
      const next = [...prev, entry];
      localStorage.setItem("gasman-saved-places", JSON.stringify(next));
      return next;
    });
    setSavingFor(null); setSaveLabel("");
  }, []);

  const handleDeletePlace = useCallback((id) => {
    setSavedPlaces((prev) => {
      const next = prev.filter((p) => p.id !== id);
      localStorage.setItem("gasman-saved-places", JSON.stringify(next));
      return next;
    });
  }, []);

  function handleSelectStation(s) {
    const wasSelected = selectedStation?.station_id === s.station_id;
    setSelectedStation(wasSelected ? null : s);
    if (wasSelected) return; // deselect — don't re-fire
    const rank = results ? results.indexOf(s) + 1 : null;
    const price = s[fuelType]?.price ?? null;
    posthog.capture("station_view", {
      station_id:   s.station_id,
      station_name: s.name,
      price,
      rank,
      is_featured:  s.is_featured ?? false,
    });
    if (s.is_featured) {
      posthog.capture("featured_station_click", {
        station_id:   s.station_id,
        station_name: s.name,
        position:     rank,
        price,
      });
    }
  }

  function toggleBrand(b) {
    setBrandFilter((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });
  }

  const availableBrands = results
    ? [...new Set(results.map((s) => s._brand || s.name).filter(Boolean))].sort()
    : [];

  const stationBrands = [...new Set(stations.map((s) => s._brand || s.name).filter(Boolean))].sort((a, b) => {
    const ai = POPULAR_BRANDS_RT.indexOf(a), bi = POPULAR_BRANDS_RT.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const displayedResults = results
    ? (brandFilter.size > 0
        ? results.filter((s) => brandFilter.has(s._brand || s.name))
        : results)
    : null;

  const fuelLabel = FUEL_TYPES.find((f) => f.key === fuelType)?.label || "";

  return (
    <div className="route-tab">

      {/* ── Input form ── */}
      <div className="route-form">

        {/* From */}
        <div className="route-place-with-save">
          <div className="route-place-label">From</div>
          <div className="route-place-input-row">
            <div className="route-place-wrap">
              <PlaceInput value={fromPlace} onSelect={setFromPlace}
                placeholder="e.g. Vancouver, BC"
                savedPlaces={savedPlaces} onDelete={handleDeletePlace} />
            </div>
            {fromPlace && (
              <button className="btn-save-place" title="Save this location"
                onClick={() => setSavingFor(savingFor === "from" ? null : "from")}>💾</button>
            )}
          </div>
          {savingFor === "from" && (
            <SavePlacePanel
              onSave={(emoji, label) => handleSavePlace(fromPlace, emoji, label)}
              onCancel={() => { setSavingFor(null); setSaveLabel(""); }}
              saveLabel={saveLabel} setSaveLabel={setSaveLabel} />
          )}
        </div>

        {/* To */}
        <div className="route-place-with-save">
          <div className="route-place-label">To</div>
          <div className="route-place-input-row">
            <div className="route-place-wrap">
              <PlaceInput value={toPlace} onSelect={setToPlace}
                placeholder="e.g. Whistler, BC"
                savedPlaces={savedPlaces} onDelete={handleDeletePlace} />
            </div>
            {toPlace && (
              <button className="btn-save-place" title="Save this location"
                onClick={() => setSavingFor(savingFor === "to" ? null : "to")}>💾</button>
            )}
          </div>
          {savingFor === "to" && (
            <SavePlacePanel
              onSave={(emoji, label) => handleSavePlace(toPlace, emoji, label)}
              onCancel={() => { setSavingFor(null); setSaveLabel(""); }}
              saveLabel={saveLabel} setSaveLabel={setSaveLabel} />
          )}
        </div>

        {/* Fuel type + Mode — side by side */}
        <div className="route-options-grid">
          <div className="route-option-group">
            <label className="route-place-label">Fuel type</label>
            <div className="route-fuel-btns">
              {FUEL_TYPES.map((f) => (
                <button key={f.key}
                  className={`route-fuel-btn ${fuelType === f.key ? "route-fuel-btn-active" : ""}`}
                  onClick={() => setFuelType(f.key)}>
                  {f.label.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
          <div className="route-option-group">
            <label className="route-place-label">Mode</label>
            <div className="route-mode-btns">
              {ROUTE_MODES.map((m) => (
                <button key={m.id}
                  className={`route-mode-btn ${routeMode === m.id ? "route-mode-active" : ""}`}
                  onClick={() => setRouteMode(m.id)}
                  title={m.hint}>
                  {m.emoji} {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Mode hint */}
        <p className="route-mode-hint">
          {ROUTE_MODES.find((m) => m.id === routeMode)?.hint}
        </p>

        {/* Vehicle picker */}
        <div className="route-vehicle-section">
          <label className="route-place-label">Your vehicle</label>
          {vehicles.length > 0 && (
            <div className="route-vehicle-chips">
              {vehicles.map((v) => (
                <button key={v.id}
                  className={`route-vehicle-chip ${activeVehicle?.id === v.id ? "route-vehicle-chip-active" : ""}`}
                  onClick={() => pickVehicle(v)}>
                  {v.icon} {v.name}
                  <span className="route-vehicle-chip-l100">{v.l100km}L</span>
                </button>
              ))}
            </div>
          )}
          <div className="route-consumption-input-wrap">
            <input id="route-consumption" className="route-consumption-input"
              type="number" min="1" max="40" step="0.5" value={consumption}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) {
                  setConsumption(v);
                  localStorage.setItem("gasman-consumption", String(v));
                }
              }} />
            <span className="route-consumption-unit">L/100km</span>
          </div>

          {/* Fill litres */}
          <div className="route-fill-row">
            <span className="route-place-label" style={{ marginBottom: 0 }}>⛽ Fill at pump</span>
            <div className="route-fill-inputs">
              <input
                type="number"
                className="route-consumption-input"
                placeholder="—"
                min={1} max={200} step={5}
                value={fillLitres}
                onChange={(e) => setFillLitres(e.target.value)}
              />
              <span className="route-consumption-unit">L</span>
              {activeVehicle?.tank_litres && (
                <button className="btn-fill-tank"
                  onClick={() => setFillLitres(String(activeVehicle.tank_litres))}>
                  Full tank ({activeVehicle.tank_litres}L)
                </button>
              )}
            </div>
          </div>

          {/* Card discount toggle */}
          <div className="route-card-toggle-row">
            {selectedCards.length > 0 ? (
              <>
                <button
                  className={`btn-card-toggle ${showCardDiscounts ? "btn-card-toggle-on" : ""}`}
                  onClick={() => setShowCardDiscounts((o) => !o)}>
                  💳 {showCardDiscounts ? "Card prices ON" : "Card prices"}
                </button>
                {showCardDiscounts && (
                  <span className="route-add-card-hint">Showing best discount per station</span>
                )}
              </>
            ) : (
              <>
                <span className="route-add-card-hint">Have a gas rewards card?</span>
                <button className="btn-route-add-card" onClick={onOpenProfile}>
                  + Add card for discounts
                </button>
              </>
            )}
          </div>
        </div>

        {/* Brand preference — collapsible */}
        {stationBrands.filter((b) => POPULAR_BRANDS_RT.includes(b)).length > 0 && (
          <div className="route-brand-pref-wrap">
            <button className="route-brand-toggle-btn" onClick={() => setBrandPrefOpen((o) => !o)}>
              <span>Brand preference</span>
              {preferredBrands.size > 0 && (
                <span className="route-brand-pref-count">{preferredBrands.size} selected</span>
              )}
              <span className="route-brand-toggle-arrow">{brandPrefOpen ? "▴" : "▾"}</span>
            </button>
            {brandPrefOpen && (
              <div className="chip-row" style={{ marginTop: 10 }}>
                {stationBrands.filter((b) => POPULAR_BRANDS_RT.includes(b)).map((b) => (
                  <button key={b}
                    className={`brand-chip ${preferredBrands.has(b) ? "brand-chip-active" : ""}`}
                    onClick={() => {
                      setPreferredBrands((prev) => {
                        const next = new Set(prev);
                        next.has(b) ? next.delete(b) : next.add(b);
                        localStorage.setItem("gasman-preferred-brands", JSON.stringify([...next]));
                        return next;
                      });
                    }}>
                    {b}
                  </button>
                ))}
                {preferredBrands.size > 0 && (
                  <span className="route-brand-pref-hint">Auto-applied as filter when you search</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Find button */}
        {stations.length === 0 && (
          <p className="route-no-data-note">
            ⚠️ No station data loaded yet — prices may still be fetching. Try refreshing the app first.
          </p>
        )}
        <button className="route-find-btn-big" onClick={handleFind}
          disabled={!fromPlace || !toPlace || loading}>
          {loading ? "Finding…" : "🔍 Find Stations Along Route"}
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
                <Marker key={s.station_id}
                  ref={(r) => { if (r) markerRefs.current[s.station_id] = r; }}
                  position={[s.latitude, s.longitude]}
                  icon={makeIcon(i + 1, STATION_COLORS[i] || "#94a3b8", isSelected)}
                  eventHandlers={{ click: () => handleSelectStation(s) }}>
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
          <span>⏱️ <strong>{routeInfo.durationMin} min</strong> drive</span>
          {results !== null && (
            <span>⛽ <strong>{results.length}</strong> station{results.length !== 1 ? "s" : ""} found</span>
          )}
          {results?.length > 0 && (() => {
            const costs = results.map((s) =>
              calcTripCost(routeInfo.distanceKm, consumption, s[fuelType]?.price || 0));
            const lo = Math.min(...costs).toFixed(2);
            const hi = Math.max(...costs).toFixed(2);
            return (
              <span>💰 ~<strong>{lo === hi ? `$${lo}` : `$${lo}–$${hi}`}</strong> trip fuel</span>
            );
          })()}
          {parseFloat(fillLitres) > 0 && results?.length > 0 && (() => {
            const litres = parseFloat(fillLitres);
            const prices = results.map((s) => s[fuelType]?.price || 0).filter(Boolean);
            const lo = (Math.min(...prices) * litres / 100).toFixed(2);
            const hi = (Math.max(...prices) * litres / 100).toFixed(2);
            return (
              <span>⛽ Fill {litres}L: ~<strong>{lo === hi ? `$${lo}` : `$${lo}–$${hi}`}</strong></span>
            );
          })()}
        </div>
      )}

      {/* ── Brand filter ── */}
      {availableBrands.length > 1 && (
        <div className="route-brand-filter">
          <span className="route-brand-label">Filter by brand</span>
          <div className="route-brand-chips">
            {availableBrands.map((b) => (
              <button key={b}
                className={`brand-chip ${brandFilter.has(b) ? "brand-chip-active" : ""}`}
                onClick={() => toggleBrand(b)}>{b}</button>
            ))}
            {brandFilter.size > 0 && (
              <button className="btn-clear-filters" onClick={() => setBrandFilter(new Set())}>Clear</button>
            )}
          </div>
        </div>
      )}

      {/* ── Save this route ── */}
      {results !== null && results.length > 0 && (
        <div className="route-save-row">
          {savingRoute ? (
            <div className="route-save-panel">
              <input className="route-save-input" placeholder="Route name (optional)"
                value={routeLabel} onChange={(e) => setRouteLabel(e.target.value)}
                maxLength={50} autoFocus />
              <button className="btn-refresh" onClick={() => {
                onSaveRoute({
                  fromPlace, toPlace, fuelType,
                  label: routeLabel.trim() ||
                    `${fromPlace.display_name.split(",")[0]} → ${toPlace.display_name.split(",")[0]}`,
                });
                setSavingRoute(false); setRouteLabel("");
              }}>Save</button>
              <button className="btn-clear-filters" onClick={() => { setSavingRoute(false); setRouteLabel(""); }}>Cancel</button>
            </div>
          ) : (
            <button className="btn-save-route" onClick={() => setSavingRoute(true)}>
              ★ Save this route
            </button>
          )}
        </div>
      )}

      {/* ── Results ── */}
      {results !== null && results.length === 0 && (
        <div className="empty-state">
          <p>No stations found within {(ROUTE_MODES.find((m) => m.id === routeMode) || ROUTE_MODES[0]).threshold}km of this route.</p>
          <p style={{ fontSize: "0.82rem", color: "var(--text-dim)", marginTop: 6 }}>
            Try a different fuel type, route, or switch to "Chill" mode for a wider search.
          </p>
        </div>
      )}

      {displayedResults?.length > 0 && (() => {
        const allCosts = displayedResults.map((s) =>
          calcTripCost(routeInfo?.distanceKm || 0, consumption, s[fuelType]?.price || 0));
        const maxCost = Math.max(...allCosts);
        const minCost = Math.min(...allCosts);
        const topSaving = maxCost - minCost;
        return (
          <div className="route-results">
            {topSaving >= 0.5 && (
              <div className="route-savings-banner">
                💸 You save <strong>${topSaving.toFixed(2)}</strong> by choosing the best station
              </div>
            )}
            <div className="route-results-header">
              <p className="route-results-title">
                Best <strong>{fuelLabel}</strong> stations along your route
              </p>
              <span className="route-results-hint">tap a row to highlight on map</span>
            </div>
            <div className="route-result-list">
              {displayedResults.map((s) => {
                const priceData = s[fuelType];
                const rank = results.indexOf(s) + 1;
                const isSelected = selectedStation?.station_id === s.station_id;
                const detourMin = s.detour > 0.3
                  ? Math.max(1, Math.round(s.detour * 2 / 50 * 60))
                  : 0;
                const totalMin = routeInfo ? routeInfo.durationMin + detourMin : null;
                const tripCost = routeInfo
                  ? calcTripCost(routeInfo.distanceKm, consumption, priceData.price)
                  : null;
                const savings = tripCost != null ? maxCost - tripCost : 0;

                // Compute badges only for top 3
                const badges = rank <= 3
                  ? getResultBadges(s, displayedResults, fuelType, routeInfo, consumption)
                  : [];
                // If #1 has no specific distinction, add "Best overall"
                if (rank === 1 && badges.length === 0)
                  badges.push({ text: "Best overall", cls: "res-badge-orange" });

                return (
                  <div key={s.station_id}
                    className={`route-result-row ${rank === 1 ? "route-result-best" : ""} ${isSelected ? "route-result-selected" : ""}`}
                    onClick={() => handleSelectStation(s)}>
                    <div className="route-result-rank"
                      style={{ background: STATION_COLORS[rank - 1] || "#94a3b8" }}>
                      {rank}
                    </div>
                    <div className="route-result-info">
                      <span className="route-result-name">{s.name}</span>
                      <span className="route-result-addr">
                        {s.address}{s._area ? ` · ${s._area}` : ""}
                      </span>
                      {badges.length > 0 && (
                        <div className="result-badges">
                          {badges.map((b) => (
                            <span key={b.text} className={`res-badge ${b.cls}`}>{b.text}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="route-result-right">
                      <span className="route-result-price">{priceData.price}¢/L</span>
                      {showCardDiscounts && (() => {
                        const brand = s._brand || s.name;
                        const result = bestCardSavings(selectedCards, priceData.price, brand);
                        if (!result) return null;
                        const discounted = Math.round((priceData.price - result.savings) * 10) / 10;
                        return (
                          <span className="route-card-discount">
                            💳 {discounted}¢/L
                            <span className="route-card-tag"> –{result.savings}¢ {result.card.bank}</span>
                          </span>
                        );
                      })()}
                      <span className="route-result-detour">
                        {s.detour <= 0.3
                          ? `on route · ${totalMin} min`
                          : `+${s.detour}km detour · ${totalMin} min`}
                      </span>
                      {tripCost != null && (
                        <span className="route-result-tripcost">
                          ~${tripCost.toFixed(2)}
                          {savings > 0.05 && (
                            <span className="route-result-savings"> · save ${savings.toFixed(2)}</span>
                          )}
                        </span>
                      )}
                      {parseFloat(fillLitres) > 0 && (() => {
                        const litres = parseFloat(fillLitres);
                        const fillCost = (priceData.price * litres / 100).toFixed(2);
                        const cardResult = showCardDiscounts
                          ? bestCardSavings(selectedCards, priceData.price, s._brand || s.name)
                          : null;
                        const cardFillCost = cardResult
                          ? ((priceData.price - cardResult.savings) * litres / 100).toFixed(2)
                          : null;
                        return (
                          <span className="route-fill-cost">
                            ⛽ {litres}L: ${fillCost}
                            {cardFillCost && <span className="route-card-fill"> · 💳 ${cardFillCost}</span>}
                          </span>
                        );
                      })()}
                    </div>
                    {onLogFillup && (
                      <button className="btn-route-fillup"
                        onClick={(e) => { e.stopPropagation(); onLogFillup(s, fuelType); }}
                        title="Log a fill-up at this station">
                        ⛽ Log Fill-up
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="route-results-note">
              Ranked by price + detour · trip cost over {routeInfo?.distanceKm}km at {consumption}L/100km
            </p>
          </div>
        );
      })()}

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
