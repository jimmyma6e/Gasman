import { useState, useEffect } from "react";

const FUEL_LABELS = {
  regular_gas:  "Regular (87)",
  midgrade_gas: "Mid (89)",
  premium_gas:  "Premium (91)",
  diesel:       "Diesel",
};

export default function FillupModal({ station, fuelType, onSave, onClose }) {
  const stationPrice = station[fuelType]?.price ?? null;

  const [fuel,     setFuel]     = useState(fuelType);
  const [priceCpl, setPriceCpl] = useState(stationPrice != null ? String(stationPrice) : "");
  const [litres,   setLitres]   = useState("");
  const [date,     setDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [notes,    setNotes]    = useState("");

  // Recalculate when fuel type changes (update pre-filled price)
  useEffect(() => {
    const p = station[fuel]?.price;
    setPriceCpl(p != null ? String(p) : "");
  }, [fuel, station]);

  const priceNum  = parseFloat(priceCpl);
  const litresNum = parseFloat(litres);
  const totalCost = (!isNaN(priceNum) && !isNaN(litresNum) && litresNum > 0)
    ? (priceNum * litresNum / 100).toFixed(2)
    : null;

  const priceEdited = stationPrice != null && parseFloat(priceCpl) !== stationPrice;

  function handleSave() {
    if (!priceCpl || isNaN(priceNum)) return;
    const entry = {
      id:             `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      station_id:     station.station_id,
      station_name:   station.name,
      station_address: station.address,
      fuel_type:      fuel,
      price_cpl:      priceNum,
      price_was_edited: priceEdited,
      litres:         litresNum || null,
      total_cost:     totalCost ? parseFloat(totalCost) : null,
      date,
      notes:          notes.trim() || null,
      logged_at:      new Date().toISOString(),
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
            <h2 className="modal-title">⛽ Log Fill-up</h2>
            <div className="modal-address">{station.name} · {station.address}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="fillup-form">
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
            {priceEdited && (
              <p className="fillup-hint">Your price differs from what we have — it'll help update our data. Thanks!</p>
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

          {/* Total cost — auto-calculated */}
          {totalCost && (
            <div className="fillup-total">
              Total: <strong>${totalCost}</strong>
              <span className="fillup-total-sub">({litres}L × {priceNum}¢/L)</span>
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
              placeholder="e.g. Almost empty, paid by card"
              maxLength={120}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="fillup-actions">
            <button className="btn-refresh" onClick={handleSave} disabled={!priceCpl || isNaN(priceNum)}>
              Save Fill-up
            </button>
            <button className="btn-clear-filters" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
