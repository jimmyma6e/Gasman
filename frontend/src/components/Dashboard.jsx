import { useState } from "react";

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
  const parts = displayName.split(",");
  return parts.slice(0, 2).join(",").trim();
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

// ── Profile Modal ─────────────────────────────────────────────────────────────

function ProfileModal({ onClose }) {
  const [places, setPlaces] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gasman-saved-places") || "[]"); }
    catch { return []; }
  });
  const [consumption, setConsumption] = useState(() => {
    const v = parseFloat(localStorage.getItem("gasman-consumption"));
    return isNaN(v) || v <= 0 ? 10 : v;
  });

  function deletePlace(id) {
    const next = places.filter((p) => p.id !== id);
    setPlaces(next);
    localStorage.setItem("gasman-saved-places", JSON.stringify(next));
  }

  function updateConsumption(v) {
    setConsumption(v);
    localStorage.setItem("gasman-consumption", String(v));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">My Profile</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <h3 className="profile-section-label">📍 Saved Places</h3>
        {places.length > 0 ? (
          places.map((p) => (
            <div key={p.id} className="profile-place-row">
              <span>{p.emoji} {p.label}</span>
              <span className="profile-place-addr">{p.display_name}</span>
              <button className="btn-delete-snapshot" onClick={() => deletePlace(p.id)} title="Remove">×</button>
            </div>
          ))
        ) : (
          <p className="dashboard-empty">No saved places yet. Add them in the 🗺️ Route Finder tab.</p>
        )}

        <h3 className="profile-section-label">⛽ Gas Consumption</h3>
        <div className="profile-consumption-row">
          <input
            type="number" className="route-save-input" style={{ width: 80 }}
            value={consumption} min={3} max={30} step={0.5}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) updateConsumption(v);
            }}
          />
          <span className="profile-unit">L/100km</span>
        </div>
        <div className="profile-vehicle-presets">
          {VEHICLE_PRESETS.map((v) => (
            <button key={v.label}
              className={`save-place-preset ${Math.abs(consumption - v.l100km) < 0.1 ? "save-place-preset-active" : ""}`}
              onClick={() => updateConsumption(v.l100km)}>
              {v.icon} {v.label} ({v.l100km})
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard({
  snapshots, savedRoutes, stationsWithArea,
  favourites, activeFuel, cheapestPrices, onToggleFavourite,
  onDeleteSnapshot, onDeleteRoute, onLaunchRoute, onNavigate,
}) {
  const [showProfile, setShowProfile] = useState(false);
  const favStations = stationsWithArea.filter((s) => favourites.includes(s.station_id));

  return (
    <div className="dashboard">

      {/* ── Profile row ── */}
      <div className="dashboard-profile-row">
        <span className="dashboard-welcome">Your saved stations, prices & routes</span>
        <button className="btn-edit-profile" onClick={() => setShowProfile(true)}>⚙️ My Profile</button>
      </div>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

      {/* ── My Stations ── */}
      <div>
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">
            ★ My Stations
            {favStations.length > 0 && (
              <span className="tab-badge">{favStations.length}</span>
            )}
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
            {snapshots.length > 0 && (
              <span className="tab-badge">{snapshots.length}</span>
            )}
          </div>
          <button className="btn-section-nav" onClick={() => onNavigate("all")}>+ Browse Stations</button>
        </div>
        {snapshots.length === 0 ? (
          <p className="dashboard-empty">
            No snapshots yet. Click "📷 Save price" on any station card to save its current price and compare when you return.
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

      {/* ── Saved Routes ── */}
      <div>
        <div className="dashboard-section-header">
          <div className="dashboard-section-title">
            🗺️ Saved Routes
            {savedRoutes.length > 0 && (
              <span className="tab-badge">{savedRoutes.length}</span>
            )}
          </div>
          <button className="btn-section-nav" onClick={() => onNavigate("route")}>+ Plan a Route</button>
        </div>
        {savedRoutes.length === 0 ? (
          <p className="dashboard-empty">
            No saved routes yet. Run a search in the 🗺️ Route Finder tab and click "★ Save this route".
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

    </div>
  );
}
