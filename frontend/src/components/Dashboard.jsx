import { useState, useRef } from "react";

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
  return r.display_name.split(", ")
    .filter((p) => !/Canada|British Columbia|Regional District|Regional Municipality/.test(p) && !/^\d[A-Z]\d/.test(p))
    .slice(0, 4).join(", ");
}

const FUEL_LABELS = {
  regular_gas:  "Regular",
  midgrade_gas: "Mid",
  premium_gas:  "Premium",
  diesel:       "Diesel",
};

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular" },
  { key: "midgrade_gas", label: "Mid" },
  { key: "premium_gas",  label: "Premium" },
  { key: "diesel",       label: "Diesel" },
];

const VEHICLE_PRESETS = [
  { icon: "🚗", label: "Compact",  l100km: 7  },
  { icon: "🚙", label: "Sedan",    l100km: 9  },
  { icon: "🚐", label: "SUV/Van",  l100km: 12 },
  { icon: "🛻", label: "Truck",    l100km: 14 },
];

const VEHICLE_ICONS = ["🚗", "🚙", "🚐", "🛻", "⚡", "🛵", "🚌", "🏎️"];

function VALID_PRICE(p) { return typeof p === "number" && p > 0; }

function timeAgo(isoString) {
  if (!isoString) return "unknown";
  const diff = Math.floor((Date.now() - new Date(isoString)) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const hrs = Math.floor(diff / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortName(displayName) {
  if (!displayName) return "";
  return displayName.split(",").slice(0, 2).join(",").trim();
}

// ── My Stations section ───────────────────────────────────────────────────────

function FavouriteStationRow({ station, activeFuel, cheapestPrices, onToggleFavourite }) {
  const fuelData   = station[activeFuel];
  const price      = fuelData?.price;
  const isCheapest = VALID_PRICE(price) && price === cheapestPrices?.[activeFuel];

  return (
    <div className="fav-station-row">
      <div className="fav-station-info">
        <div className="fav-station-name">
          {station.name}
          {isCheapest && <span className="badge-cheapest fav-cheapest-badge">Cheapest</span>}
        </div>
        <div className="fav-station-meta">{station.address}{station._area ? ` · ${station._area}` : ""}</div>
      </div>
      <div className="fav-station-prices">
        {FUEL_TYPES.map(({ key, label }) => {
          const fd = station[key];
          if (!VALID_PRICE(fd?.price)) return null;
          return (
            <div key={key} className={`fav-price-chip ${key === activeFuel ? "fav-price-active" : ""}`}>
              <span className="fav-price-label">{label}</span>
              <span className="fav-price-value">{fd.price}¢</span>
            </div>
          );
        })}
      </div>
      <button className="btn-unfav" onClick={() => onToggleFavourite(station.station_id)} title="Remove from My Stations">★</button>
    </div>
  );
}

// ── Price Snapshot section ────────────────────────────────────────────────────

function SnapshotCard({ snap, stationsWithArea, onDelete }) {
  const current = stationsWithArea.find((s) => s.station_id === snap.station_id);
  const currentPrice = current?.[snap.fuel_type]?.price ?? null;
  const delta = currentPrice != null ? currentPrice - snap.price : null;

  let deltaClass = "snapshot-delta-same";
  let deltaLabel = "No change";
  if (delta != null && Math.abs(delta) >= 0.1) {
    deltaClass = delta > 0 ? "snapshot-delta-up" : "snapshot-delta-down";
    deltaLabel = `${delta > 0 ? "+" : ""}${delta.toFixed(1)}¢`;
  }

  return (
    <div className="snapshot-card">
      <div className="snapshot-info">
        <div className="snapshot-name">{snap.name}</div>
        <div className="snapshot-meta">
          {snap.address}{snap._area ? ` · ${snap._area}` : ""} ·{" "}
          {FUEL_LABELS[snap.fuel_type] || snap.fuel_type} · snapped {timeAgo(snap.timestamp)}
        </div>
      </div>
      <div className="snapshot-prices">
        <div className="snapshot-was">was {snap.price}¢</div>
        {currentPrice != null ? (
          <>
            <div className="snapshot-now">{currentPrice}¢</div>
            <div className={`snapshot-delta ${deltaClass}`}>{deltaLabel}</div>
          </>
        ) : (
          <div className="snapshot-unavail">price unavailable</div>
        )}
      </div>
      <button className="btn-delete-snapshot" onClick={() => onDelete(snap.id)} title="Remove snapshot">×</button>
    </div>
  );
}

// ── Saved Route section ───────────────────────────────────────────────────────

function SavedRouteCard({ route, onLaunch, onDelete }) {
  const fuelLabel = FUEL_LABELS[route.fuelType] || route.fuelType;
  const from = shortName(route.fromPlace?.display_name);
  const to   = shortName(route.toPlace?.display_name);

  return (
    <div className="saved-route-card">
      <div className="saved-route-info">
        <div className="saved-route-label">{route.label || `${from} → ${to}`}</div>
        <div className="saved-route-sub">
          {from} → {to} · {fuelLabel} · saved {timeAgo(route.savedAt)}
        </div>
      </div>
      <div className="saved-route-actions">
        <button className="btn-launch-route" onClick={() => onLaunch(route)}>Launch</button>
        <button className="btn-delete-snapshot" onClick={() => onDelete(route.id)} title="Remove">×</button>
      </div>
    </div>
  );
}

// ── Vehicle Manager (used inside ProfileModal) ────────────────────────────────

function VehicleManager() {
  const [vehicles, setVehicles] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-vehicles") || "[]"); }
    catch { return []; }
  });
  const [activeId, setActiveId] = useState(() => localStorage.getItem("gasman-active-vehicle") || null);
  const [adding, setAdding]     = useState(false);
  const [newName, setNewName]   = useState("");
  const [newL100, setNewL100]   = useState("10");
  const [newIcon, setNewIcon]   = useState("🚗");
  const [showTip, setShowTip]   = useState(false);

  function selectVehicle(v) {
    setActiveId(v.id);
    localStorage.setItem("gasman-active-vehicle", v.id);
    localStorage.setItem("gasman-consumption", String(v.l100km));
  }

  function addVehicle() {
    const l100km = parseFloat(newL100);
    if (!newName.trim() || isNaN(l100km) || l100km <= 0) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: newName.trim(),
      icon: newIcon,
      l100km,
    };
    const next = [...vehicles, entry];
    setVehicles(next);
    localStorage.setItem("gasman-vehicles", JSON.stringify(next));
    selectVehicle(entry);
    setAdding(false);
    setNewName(""); setNewL100("10"); setNewIcon("🚗");
  }

  function deleteVehicle(id) {
    const next = vehicles.filter((v) => v.id !== id);
    setVehicles(next);
    localStorage.setItem("gasman-vehicles", JSON.stringify(next));
    if (activeId === id) {
      const fallback = next[0] || null;
      if (fallback) selectVehicle(fallback);
      else {
        setActiveId(null);
        localStorage.removeItem("gasman-active-vehicle");
      }
    }
  }

  return (
    <div>
      <div className="profile-section-row">
        <h3 className="profile-section-label">🚗 My Vehicles</h3>
        <button className="profile-tip-btn" onClick={() => setShowTip((o) => !o)} title="Why do I need this?">?</button>
      </div>
      {showTip && (
        <div className="profile-tip-box">
          Your vehicle's fuel economy (L/100km) lets GASMAN estimate how much a trip will cost you in dollars — so you can compare stations by actual savings, not just cents-per-litre.
        </div>
      )}

      {vehicles.length > 0 && (
        <div className="vehicle-list">
          {vehicles.map((v) => (
            <div
              key={v.id}
              className={`vehicle-row ${activeId === v.id ? "vehicle-active" : ""}`}
              onClick={() => selectVehicle(v)}
            >
              <span className="vehicle-icon-display">{v.icon}</span>
              <div className="vehicle-info">
                <span className="vehicle-name">{v.name}</span>
                <span className="vehicle-economy">{v.l100km} L/100km</span>
              </div>
              {activeId === v.id && <span className="vehicle-check">✓ Active</span>}
              <button className="btn-delete-snapshot"
                onClick={(e) => { e.stopPropagation(); deleteVehicle(v.id); }}
                title="Remove vehicle">×</button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="vehicle-add-form">
          <div className="vehicle-icon-picker">
            {VEHICLE_ICONS.map((ic) => (
              <button key={ic}
                className={`vehicle-icon-btn ${newIcon === ic ? "vehicle-icon-active" : ""}`}
                onClick={() => setNewIcon(ic)}>{ic}</button>
            ))}
          </div>
          <input className="route-save-input vehicle-name-input"
            placeholder="Vehicle name (e.g. Honda Civic)"
            value={newName} onChange={(e) => setNewName(e.target.value)}
            maxLength={30} autoFocus />
          <div className="vehicle-economy-row">
            <span className="profile-unit" style={{ flexShrink: 0 }}>Fuel economy:</span>
            <div className="vehicle-preset-chips">
              {VEHICLE_PRESETS.map((p) => (
                <button key={p.label}
                  className={`vehicle-preset-chip ${parseFloat(newL100) === p.l100km ? "brand-chip-active" : "brand-chip"}`}
                  onClick={() => setNewL100(String(p.l100km))}>
                  {p.icon} {p.l100km}L
                </button>
              ))}
            </div>
            <input type="number" className="route-save-input" style={{ width: 68 }}
              value={newL100} min={3} max={30} step={0.5}
              onChange={(e) => setNewL100(e.target.value)} />
            <span className="profile-unit">L/100km</span>
          </div>
          <div className="vehicle-add-actions">
            <button className="btn-refresh"
              disabled={!newName.trim() || !parseFloat(newL100)}
              onClick={addVehicle}>Add Vehicle</button>
            <button className="btn-clear-filters"
              onClick={() => { setAdding(false); setNewName(""); setNewL100("10"); setNewIcon("🚗"); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn-section-nav" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
          + Add Vehicle
        </button>
      )}

      {vehicles.length === 0 && !adding && (
        <p className="dashboard-empty" style={{ marginTop: 6 }}>
          No vehicles yet. Add one to get accurate trip cost estimates in Route Finder.
        </p>
      )}
    </div>
  );
}

// ── Add Place Form (inside ProfileModal) ──────────────────────────────────────

const PLACE_PRESETS = [
  { emoji: "🏠", label: "Home" },
  { emoji: "💼", label: "Work" },
  { emoji: "🎓", label: "School" },
];

function AddPlaceForm({ onAdd, onCancel }) {
  const [label, setLabel]           = useState("");
  const [emoji, setEmoji]           = useState("📍");
  const [query, setQuery]           = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected]     = useState(null);
  const timer = useRef(null);

  function handleQueryChange(e) {
    const q = e.target.value;
    setQuery(q);
    setSelected(null);
    clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); return; }
    timer.current = setTimeout(async () => {
      try { setSuggestions(await nominatimSearch(q)); } catch { /* ignore */ }
    }, 400);
  }

  function handleSelect(s) {
    const label = formatPlace(s);
    setQuery(label);
    setSuggestions([]);
    setSelected({ lat: parseFloat(s.lat), lng: parseFloat(s.lon), display_name: label });
  }

  function handleAdd() {
    if (!label.trim() || !selected) return;
    onAdd({ emoji, label: label.trim(), ...selected });
  }

  return (
    <div className="add-place-form">
      <div className="add-place-presets">
        {PLACE_PRESETS.map((p) => (
          <button key={p.label}
            className={`save-place-preset ${label === p.label && emoji === p.emoji ? "save-place-preset-active" : ""}`}
            onClick={() => { setLabel(p.label); setEmoji(p.emoji); }}>
            {p.emoji} {p.label}
          </button>
        ))}
      </div>
      <input className="route-save-input" placeholder="Custom label (e.g. Gym)"
        value={label} maxLength={32}
        onChange={(e) => { setLabel(e.target.value); setEmoji("📍"); }} />
      <div className="add-place-search-wrap">
        <input className="route-save-input" placeholder="Search address in BC…"
          value={query} autoComplete="off" onChange={handleQueryChange} />
        {suggestions.length > 0 && (
          <div className="route-suggestions">
            {suggestions.map((s, i) => (
              <button key={i} className="route-suggestion-item" onMouseDown={() => handleSelect(s)}>
                {formatPlace(s)}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected && <p style={{ fontSize: "0.78rem", color: "var(--text-dim)", margin: 0 }}>📍 {selected.display_name}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-refresh" disabled={!label.trim() || !selected} onClick={handleAdd}>
          + Add Place
        </button>
        <button className="btn-clear-filters" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Profile Modal ─────────────────────────────────────────────────────────────

function ProfileModal({ onClose }) {
  const [places, setPlaces] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-saved-places") || "[]"); }
    catch { return []; }
  });
  const [addingPlace, setAddingPlace] = useState(false);

  function deletePlace(id) {
    const next = places.filter((p) => p.id !== id);
    setPlaces(next);
    localStorage.setItem("gasman-saved-places", JSON.stringify(next));
  }

  function addPlace(entry) {
    const next = [...places, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      ...entry,
    }];
    setPlaces(next);
    localStorage.setItem("gasman-saved-places", JSON.stringify(next));
    setAddingPlace(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">My Profile</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <VehicleManager />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="profile-section-label">📍 Saved Places</h3>
          {!addingPlace && (
            <button className="profile-add-btn" onClick={() => setAddingPlace(true)}>+ Add location</button>
          )}
        </div>
        {places.length > 0 ? (
          places.map((p) => (
            <div key={p.id} className="profile-place-row">
              <span>{p.emoji} {p.label}</span>
              <span className="profile-place-addr">{p.display_name}</span>
              <button className="btn-delete-snapshot" onClick={() => deletePlace(p.id)} title="Remove">×</button>
            </div>
          ))
        ) : (
          !addingPlace && <p className="dashboard-empty">No saved places yet. Add home, work, or school for quick access in Route Finder.</p>
        )}
        {addingPlace && <AddPlaceForm onAdd={addPlace} onCancel={() => setAddingPlace(false)} />}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard({
  snapshots, savedRoutes, stationsWithArea,
  favourites, activeFuel, cheapestPrices, onToggleFavourite,
  onDeleteSnapshot, onDeleteRoute, onLaunchRoute, onNavigate,
  showProfile, onCloseProfile,
}) {
  const favStations = stationsWithArea.filter((s) => favourites.includes(s.station_id));

  return (
    <div className="dashboard">

      {showProfile && <ProfileModal onClose={onCloseProfile} />}

      {/* ── Route Finder Hero ── */}
      <div className="route-hero-card" onClick={() => onNavigate("route")}>
        <div className="route-hero-left">
          <div className="route-hero-title">🗺️ Route Finder</div>
          <div className="route-hero-sub">
            Enter A → B and we find the cheapest gas along your drive
          </div>
        </div>
        <button className="route-hero-cta" onClick={(e) => { e.stopPropagation(); onNavigate("route"); }}>
          Start →
        </button>
      </div>

      {/* ── Saved Routes ── */}
      <div>
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">
            🗺️ Saved Routes
            {savedRoutes.length > 0 && <span className="tab-badge">{savedRoutes.length}</span>}
          </div>
          <button className="btn-section-nav" onClick={() => onNavigate("route")}>+ Plan a Route</button>
        </div>
        {savedRoutes.length === 0 ? (
          <p className="dashboard-empty">
            No saved routes yet. Run a search in Route Finder and click "★ Save this route".
          </p>
        ) : (
          <div className="saved-route-list">
            {savedRoutes.map((route) => (
              <SavedRouteCard key={route.id} route={route}
                onLaunch={onLaunchRoute}
                onDelete={onDeleteRoute} />
            ))}
          </div>
        )}
      </div>

      {/* ── My Stations ── */}
      <div>
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">
            ★ My Stations
            {favStations.length > 0 && <span className="tab-badge">{favStations.length}</span>}
          </div>
          <button className="btn-section-nav" onClick={() => onNavigate("all")}>+ Browse Stations</button>
        </div>
        {favStations.length === 0 ? (
          <p className="dashboard-empty">
            No favourite stations yet. Click ☆ on any station card to pin it here.
          </p>
        ) : (
          <div className="fav-station-list">
            {favStations.map((s) => (
              <FavouriteStationRow key={s.station_id} station={s}
                activeFuel={activeFuel}
                cheapestPrices={cheapestPrices}
                onToggleFavourite={onToggleFavourite} />
            ))}
          </div>
        )}
      </div>

      {/* ── Price Snapshots ── */}
      <div>
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">
            📷 Price Snapshots
            {snapshots.length > 0 && <span className="tab-badge">{snapshots.length}</span>}
          </div>
          <button className="btn-section-nav" onClick={() => onNavigate("all")}>+ Browse Stations</button>
        </div>
        {snapshots.length === 0 ? (
          <p className="dashboard-empty">
            No snapshots yet. Click "📷 Save price" on any station card to track price changes over time.
          </p>
        ) : (
          <div className="snapshot-list">
            {snapshots.map((snap) => (
              <SnapshotCard key={snap.id} snap={snap}
                stationsWithArea={stationsWithArea}
                onDelete={onDeleteSnapshot} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
