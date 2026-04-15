import { useState, useEffect } from "react";

const FUEL_LABELS = {
  regular_gas:  "Regular (87)",
  midgrade_gas: "Mid (89)",
  premium_gas:  "Premium (91)",
  diesel:       "Diesel",
};

export default function FillupModal({ station, fuelType, avgPriceAtLog, onSave, onClose, editEntry }) {
  // station may be null when logging manually from the Logs tab
  const stationPrice = station?.[fuelType]?.price ?? null;
  const isEdit = !!editEntry;

  const vehicles = (() => {
    try { return JSON.parse(localStorage.getItem("gasman-vehicles") || "[]"); }
    catch { return []; }
  })();
  const defaultVehicle = vehicles[0] ?? null;

  const [fuel,               setFuel]               = useState(editEntry?.fuel_type ?? fuelType);
  const [priceCpl,           setPriceCpl]           = useState(editEntry ? String(editEntry.price_cpl) : (stationPrice != null ? String(stationPrice) : ""));
  const [litres,             setLitres]             = useState(editEntry?.litres != null ? String(editEntry.litres) : "");
  const [date,               setDate]               = useState(editEntry?.date ?? new Date().toISOString().slice(0, 10));
  const [notes,              setNotes]              = useState(editEntry?.notes ?? "");
  const [vehicleId,          setVehicleId]          = useState(editEntry?.vehicle_id ?? defaultVehicle?.id ?? "");
  const [manualStationName,  setManualStationName]  = useState(editEntry?.station_name ?? "");

  // Re-fill price when fuel type changes (only when a station is known)
  useEffect(() => {
    const p = station?.[fuel]?.price;
    setPriceCpl(p != null ? String(p) : "");
  }, [fuel, station]);

  const priceNum  = parseFloat(priceCpl);
  const litresNum = parseFloat(litres);
  const totalCost = (!isNaN(priceNum) && !isNaN(litresNum) && litresNum > 0)
    ? (priceNum * litresNum / 100).toFixed(2)
    : null;

  const savedCpl   = avgPriceAtLog && !isNaN(priceNum) ? avgPriceAtLog - priceNum : null;
  const totalSaved = savedCpl && !isNaN(litresNum) && litresNum > 0
    ? (savedCpl * litresNum / 100).toFixed(2)
    : null;

  // Flag when user has edited the station's known price (triggers price contribution)
  const priceEdited = station && stationPrice != null && !isNaN(priceNum) && priceNum !== stationPrice;

  function handleSave() {
    if (!priceCpl || isNaN(priceNum)) return;
    const selectedVehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
    const entry = {
      id:                editEntry?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      station_id:        station?.station_id ?? null,
      station_name:      station?.name ?? (manualStationName.trim() || "Manual entry"),
      station_address:   station?.address ?? null,
      fuel_type:         fuel,
      price_cpl:         priceNum,
      price_was_edited:  priceEdited,
      avg_price_at_log:  avgPriceAtLog ?? null,
      saved_cpl:         savedCpl ?? null,
      litres:            litresNum || null,
      total_cost:        totalCost ? parseFloat(totalCost) : null,
      total_saved:       totalSaved ? parseFloat(totalSaved) : null,
      vehicle_id:        selectedVehicle?.id ?? null,
      vehicle_name:      selectedVehicle ? `${selectedVehicle.icon || "🚗"} ${selectedVehicle.name}` : null,
      date,
      notes:             notes.trim() || null,
      logged_at:         new Date().toISOString(),
    };
    onSave(entry);
  }

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fillup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{isEdit ? "✏️ Edit Fill-up" : "⛽ Log Fill-up"}</h2>
            {station
              ? <div className="modal-address">{station.name}{station.address ? ` · ${station.address}` : ""}</div>
              : <div className="modal-address">{isEdit ? (editEntry.station_name || "Manual entry") : "Manual entry"}</div>
            }
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="fillup-form">
          {/* Manual station name — only when no station pre-selected */}
          {!station && (
            <div className="fillup-field">
              <label className="fillup-label">Station (optional)</label>
              <input
                className="fillup-input"
                type="text"
                placeholder="e.g. Shell on Broadway"
                value={manualStationName}
                onChange={(e) => setManualStationName(e.target.value)}
                maxLength={80}
              />
            </div>
          )}

          {/* Vehicle picker */}
          {vehicles.length > 0 && (
            <div className="fillup-field">
              <label className="fillup-label">Vehicle</label>
              <div className="fillup-vehicle-row">
                {vehicles.map((v) => (
                  <button
                    key={v.id}
                    className={`fillup-vehicle-chip ${vehicleId === v.id ? "fillup-vehicle-active" : ""}`}
                    onClick={() => setVehicleId(v.id)}
                    type="button"
                  >
                    {v.icon || "🚗"} {v.name}
                  </button>
                ))}
                <button
                  className={`fillup-vehicle-chip ${vehicleId === "" ? "fillup-vehicle-active" : ""}`}
                  onClick={() => setVehicleId("")}
                  type="button"
                >
                  Other
                </button>
              </div>
            </div>
          )}

          {/* Fuel type */}
          <div className="fillup-field">
            <label className="fillup-label">Fuel Type</label>
            <select className="fillup-select" value={fuel} onChange={(e) => setFuel(e.target.value)}>
              {Object.entries(FUEL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Price */}
          <div className="fillup-field">
            <label className="fillup-label">
              Price per litre (¢/L)
              {priceEdited && <span className="fillup-contrib-tag">📝 Price report</span>}
            </label>
            <input
              className="fillup-input"
              type="number"
              step="0.1"
              min="50"
              max="350"
              placeholder="e.g. 179.9"
              value={priceCpl}
              onChange={(e) => setPriceCpl(e.target.value)}
            />
            {avgPriceAtLog && !isNaN(priceNum) && (
              <p className={`fillup-hint ${savedCpl > 0 ? "" : "fillup-hint-warn"}`}>
                {savedCpl > 0
                  ? `${savedCpl.toFixed(1)}¢/L below avg (${avgPriceAtLog.toFixed(1)}¢/L) — nice find!`
                  : savedCpl < 0
                  ? `${Math.abs(savedCpl).toFixed(1)}¢/L above avg (${avgPriceAtLog.toFixed(1)}¢/L)`
                  : `At the average price (${avgPriceAtLog.toFixed(1)}¢/L)`}
              </p>
            )}
            {priceEdited && (
              <p className="fillup-hint">Price differs from our data — thanks for the report!</p>
            )}
          </div>

          {/* Litres */}
          <div className="fillup-field">
            <label className="fillup-label">Litres filled (optional)</label>
            <input
              className="fillup-input"
              type="number"
              step="0.5"
              min="1"
              max="200"
              placeholder="e.g. 45"
              value={litres}
              onChange={(e) => setLitres(e.target.value)}
            />
          </div>

          {/* Total cost + savings summary */}
          {totalCost && (
            <div className="fillup-total">
              <div>Total: <strong>${totalCost}</strong>
                <span className="fillup-total-sub">({litres}L × {priceNum}¢/L)</span>
              </div>
              {totalSaved && parseFloat(totalSaved) > 0 && (
                <div className="fillup-saved">💸 You saved <strong>${totalSaved}</strong> vs avg</div>
              )}
            </div>
          )}

          {/* Date */}
          <div className="fillup-field">
            <label className="fillup-label">Date</label>
            <input
              className="fillup-input"
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="fillup-field">
            <label className="fillup-label">Notes (optional)</label>
            <input
              className="fillup-input"
              type="text"
              placeholder="e.g. Almost empty, used CIBC card"
              maxLength={120}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="fillup-actions">
            <button className="btn-refresh" onClick={handleSave} disabled={!priceCpl || isNaN(priceNum)}>
              {isEdit ? "Update Fill-up" : "Save Fill-up"}
            </button>
            <button className="btn-clear-filters" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
