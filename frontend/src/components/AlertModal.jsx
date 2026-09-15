import { useState, useEffect, useMemo } from "react";
import { FUEL_TYPES } from "../fuelTypes.js";
import { useBodyScrollLock } from "../useBodyScrollLock.js";

const SUPPRESS_OPTIONS = [
  { label: "1 hour",   hours: 1 },
  { label: "6 hours",  hours: 6 },
  { label: "12 hours", hours: 12 },
  { label: "1 day",    hours: 24 },
  { label: "3 days",   hours: 72 },
  { label: "1 week",   hours: 168 },
];

const BASELINE_OPTIONS = [
  { label: "Year-to-date average", value: "ytd" },
  { label: "2-day average",        value: "2d" },
  { label: "3-day average",        value: "3d" },
];

const EMAIL_STORAGE_KEY = "gasman-alert-email";

function toggleSetValue(set, value) {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

export default function AlertModal({ stationsWithArea, prefilledStation, onClose, onCreated }) {
  useBodyScrollLock();

  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_STORAGE_KEY) || "");
  const [scopeType, setScopeType] = useState(prefilledStation ? "stations" : "any");
  const [cities, setCities] = useState([]);
  const [citySearch, setCitySearch] = useState("");
  const [selectedCities, setSelectedCities] = useState(new Set());
  const [stationSearch, setStationSearch] = useState("");
  const [selectedStations, setSelectedStations] = useState(
    () => new Set(prefilledStation ? [prefilledStation.station_id] : [])
  );
  const [fuelTypes, setFuelTypes] = useState(new Set());
  const [triggerType, setTriggerType] = useState("fixed_price");
  const [fixedPrice, setFixedPrice] = useState("");
  const [lowestDays, setLowestDays] = useState(7);
  const [baseline, setBaseline] = useState("3d");
  const [suppressHours, setSuppressHours] = useState(24);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // /api/cities only returns cities with a station that's reported a
    // price recently — no point offering a city that has nothing to alert on.
    fetch("/api/cities").then((r) => r.json()).then((d) => setCities(d.cities || [])).catch(() => {});
  }, []);

  const filteredCities = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    return q ? cities.filter((c) => c.toLowerCase().includes(q)) : cities;
  }, [citySearch, cities]);

  const filteredStations = useMemo(() => {
    const q = stationSearch.trim().toLowerCase();
    const list = q
      ? stationsWithArea.filter((s) =>
          s.name?.toLowerCase().includes(q) ||
          s.address?.toLowerCase().includes(q) ||
          s._area?.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q)
        )
      : stationsWithArea;
    return list.slice(0, 40);
  }, [stationSearch, stationsWithArea]);

  function validate() {
    if (!email.includes("@")) return "Enter a valid email address.";
    if (scopeType === "cities" && selectedCities.size === 0) return "Pick at least one city.";
    if (scopeType === "stations" && selectedStations.size === 0) return "Pick at least one station.";
    if (fuelTypes.size === 0) return "Pick at least one gas type.";
    if (triggerType === "fixed_price" && !(parseFloat(fixedPrice) > 0)) return "Enter a price to trigger at.";
    if (triggerType === "lowest_over_days" && !(parseInt(lowestDays, 10) > 0)) return "Enter a number of days.";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    const triggerConfig =
      triggerType === "fixed_price"        ? { price: parseFloat(fixedPrice) } :
      triggerType === "lowest_over_days"   ? { days: parseInt(lowestDays, 10) } :
      /* below_baseline */                   { baseline };

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          scope_type: scopeType,
          scope_values: scopeType === "cities" ? [...selectedCities] : scopeType === "stations" ? [...selectedStations] : [],
          fuel_types: [...fuelTypes],
          trigger_type: triggerType,
          trigger_config: triggerConfig,
          suppress_hours: suppressHours,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      try { localStorage.setItem(EMAIL_STORAGE_KEY, email); } catch { /* storage unavailable — ignore */ }
      onCreated(email);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create alert.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal alert-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2 className="modal-title">🔔 New Price Alert</h2>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>

        {prefilledStation && (
          <p className="alert-prefill-note">For <strong>{prefilledStation.name}</strong> — change scope below to widen it.</p>
        )}

        <label className="alert-field-label">Email me at</label>
        <input
          type="email" className="alert-text-input" placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} required
        />

        <label className="alert-field-label">Which stations?</label>
        <div className="alert-scope-tabs">
          <button type="button" className={`alert-scope-tab ${scopeType === "any" ? "alert-scope-tab-active" : ""}`} onClick={() => setScopeType("any")}>Any station</button>
          <button type="button" className={`alert-scope-tab ${scopeType === "cities" ? "alert-scope-tab-active" : ""}`} onClick={() => setScopeType("cities")}>Specific cities</button>
          <button type="button" className={`alert-scope-tab ${scopeType === "stations" ? "alert-scope-tab-active" : ""}`} onClick={() => setScopeType("stations")}>Specific stations</button>
        </div>

        {scopeType === "cities" && (
          <div className="alert-station-picker">
            <input
              type="text" className="alert-text-input" placeholder="Search cities…"
              value={citySearch} onChange={(e) => setCitySearch(e.target.value)}
            />
            <div className="alert-station-list">
              {cities.length === 0 && <p className="alert-picker-empty">Loading cities…</p>}
              {cities.length > 0 && filteredCities.length === 0 && <p className="alert-picker-empty">No cities match.</p>}
              {filteredCities.map((city) => (
                <label key={city} className="alert-station-row">
                  <input
                    type="checkbox" checked={selectedCities.has(city)}
                    onChange={() => setSelectedCities((prev) => toggleSetValue(prev, city))}
                  />
                  <span className="alert-station-name">{city}</span>
                </label>
              ))}
            </div>
            {selectedCities.size > 0 && <p className="alert-picker-count">{selectedCities.size} selected</p>}
          </div>
        )}

        {scopeType === "stations" && (
          <div className="alert-station-picker">
            <input
              type="text" className="alert-text-input" placeholder="Search by name, address, or city…"
              value={stationSearch} onChange={(e) => setStationSearch(e.target.value)}
            />
            <div className="alert-station-list">
              {filteredStations.map((s) => (
                <label key={s.station_id} className="alert-station-row">
                  <input
                    type="checkbox" checked={selectedStations.has(s.station_id)}
                    onChange={() => setSelectedStations((prev) => toggleSetValue(prev, s.station_id))}
                  />
                  <span className="alert-station-name">{s.name}</span>
                  <span className="alert-station-addr">{s.address}{s._area ? `, ${s._area}` : ""}</span>
                </label>
              ))}
              {filteredStations.length === 0 && <p className="alert-picker-empty">No stations match.</p>}
            </div>
            {selectedStations.size > 0 && <p className="alert-picker-count">{selectedStations.size} selected</p>}
          </div>
        )}

        <label className="alert-field-label">Gas type</label>
        <div className="alert-chip-picker">
          {FUEL_TYPES.map(({ key, label }) => (
            <button type="button" key={key}
              className={`alert-chip ${fuelTypes.has(key) ? "alert-chip-active" : ""}`}
              onClick={() => setFuelTypes((prev) => toggleSetValue(prev, key))}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="alert-field-label">Trigger when…</label>
        <div className="alert-trigger-options">
          <label className="alert-trigger-option">
            <input type="radio" name="triggerType" checked={triggerType === "fixed_price"} onChange={() => setTriggerType("fixed_price")} />
            <span>Price drops to or below</span>
            <input
              type="number" step="0.1" min="0" className="alert-inline-input" placeholder="¢/L"
              value={fixedPrice} onChange={(e) => setFixedPrice(e.target.value)}
              onFocus={() => setTriggerType("fixed_price")}
            />
            <span className="alert-trigger-unit">¢/L</span>
          </label>

          <label className="alert-trigger-option">
            <input type="radio" name="triggerType" checked={triggerType === "lowest_over_days"} onChange={() => setTriggerType("lowest_over_days")} />
            <span>New lowest price in the last</span>
            <input
              type="number" step="1" min="1" className="alert-inline-input alert-inline-input-sm"
              value={lowestDays} onChange={(e) => setLowestDays(e.target.value)}
              onFocus={() => setTriggerType("lowest_over_days")}
            />
            <span className="alert-trigger-unit">days</span>
          </label>

          <label className="alert-trigger-option">
            <input type="radio" name="triggerType" checked={triggerType === "below_baseline"} onChange={() => setTriggerType("below_baseline")} />
            <span>Falls below its</span>
            <select
              className="alert-inline-select" value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
              onFocus={() => setTriggerType("below_baseline")}
            >
              {BASELINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <label className="alert-field-label">Then stay quiet for</label>
        <select className="alert-inline-select alert-suppress-select" value={suppressHours} onChange={(e) => setSuppressHours(parseInt(e.target.value, 10))}>
          {SUPPRESS_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
        </select>

        {error && <p className="alert-error">{error}</p>}

        <div className="modal-actions alert-modal-actions">
          <button type="button" className="btn-modal-action" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-modal-action alert-submit-btn" disabled={submitting}>
            {submitting ? "Creating…" : "Create Alert"}
          </button>
        </div>
      </form>
    </div>
  );
}
