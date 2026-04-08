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

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard({
  snapshots, savedRoutes, stationsWithArea,
  favourites, activeFuel, cheapestPrices, onToggleFavourite,
  onDeleteSnapshot, onDeleteRoute, onLaunchRoute,
}) {
  const favStations = stationsWithArea.filter((s) => favourites.includes(s.station_id));

  return (
    <div className="dashboard">

      {/* ── My Stations ── */}
      <div>
        <div className="dashboard-section-title">
          ★ My Stations
          {favStations.length > 0 && (
            <span className="tab-badge">{favStations.length}</span>
          )}
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
        <div className="dashboard-section-title">
          📷 Price Snapshots
          {snapshots.length > 0 && (
            <span className="tab-badge">{snapshots.length}</span>
          )}
        </div>
        {snapshots.length === 0 ? (
          <p className="dashboard-empty">
            No snapshots yet. Click 📷 on any station card to save its current price and compare when you return.
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
        <div className="dashboard-section-title">
          🗺️ Saved Routes
          {savedRoutes.length > 0 && (
            <span className="tab-badge">{savedRoutes.length}</span>
          )}
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
