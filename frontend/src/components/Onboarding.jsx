import { useState } from "react";
import { CREDIT_CARDS } from "../creditCards.js";

const VEHICLE_PRESETS = [
  { icon: "🚗", label: "Compact",  l100km: 7  },
  { icon: "🚙", label: "Sedan",    l100km: 9  },
  { icon: "🚐", label: "SUV/Van",  l100km: 12 },
  { icon: "🛻", label: "Truck",    l100km: 14 },
];

const CARDS_BY_BANK = CREDIT_CARDS.reduce((acc, c) => {
  (acc[c.bank] = acc[c.bank] || []).push(c);
  return acc;
}, {});

// Reusable bank-chip card picker (same UX as Profile modal)
function CardPicker({ selectedIds, onToggle }) {
  const [openBank, setOpenBank] = useState(null);
  return (
    <div>
      <div className="card-bank-chips-row">
        {Object.entries(CARDS_BY_BANK).map(([bank, cards]) => {
          const count = cards.filter((c) => selectedIds.includes(c.id)).length;
          const isOpen = openBank === bank;
          const bankColor = cards[0].color;
          return (
            <button key={bank}
              className={`card-bank-chip ${isOpen ? "card-bank-chip-open" : ""} ${count > 0 ? "card-bank-chip-has" : ""}`}
              style={count > 0 ? { borderColor: bankColor } : {}}
              onClick={() => setOpenBank(isOpen ? null : bank)}>
              <span className="card-bank-chip-dot" style={{ background: bankColor }} />
              <span className="card-bank-chip-name">{bank}</span>
              {count > 0 && <span className="card-bank-chip-count" style={{ background: bankColor }}>{count}</span>}
            </button>
          );
        })}
      </div>
      {openBank && CARDS_BY_BANK[openBank] && (
        <div className="card-bank-panel">
          {CARDS_BY_BANK[openBank].map((c) => {
            const active = selectedIds.includes(c.id);
            return (
              <button key={c.id}
                className={`card-row ${active ? "card-row-active" : ""}`}
                onClick={() => onToggle(c.id)}>
                <div className="card-row-left">
                  <span className="card-color-dot" style={{ background: c.color }} />
                  <div>
                    <div className="card-row-name">
                      {c.name}
                      {c.type === "combo" && <span className="card-type-badge card-type-combo">combo</span>}
                    </div>
                    <div className="card-row-note">{c.note}</div>
                  </div>
                </div>
                {active && <span className="card-row-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [vehicleName, setVehicleName] = useState("");
  const [customL100, setCustomL100]   = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [openBank, setOpenBank] = useState(null);

  function toggleCard(id) {
    setSelectedCardIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function finish(skipVehicle = false) {
    if (!skipVehicle && (selectedPreset || parseFloat(customL100) > 0)) {
      const l100km = parseFloat(customL100) > 0 ? parseFloat(customL100) : selectedPreset?.l100km;
      const name   = vehicleName.trim() || selectedPreset?.label || "My Vehicle";
      const icon   = selectedPreset?.icon || "🚗";
      if (l100km > 0) {
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          name, icon, l100km,
        };
        const existing = (() => {
          try { return JSON.parse(localStorage.getItem("gasman-vehicles") || "[]"); }
          catch { return []; }
        })();
        const next = [entry, ...existing];
        localStorage.setItem("gasman-vehicles", JSON.stringify(next));
        localStorage.setItem("gasman-active-vehicle", entry.id);
        localStorage.setItem("gasman-consumption", String(l100km));
      }
    }
    if (selectedCardIds.length > 0) {
      localStorage.setItem("gasman-cards", JSON.stringify(selectedCardIds));
    }
    localStorage.setItem("gasman-onboarded", "1");
    onDone();
  }

  return (
    <div className="onboard-overlay">
      <div className="onboard-modal">

        {step === 0 && (
          <>
            <div className="onboard-hero">
              <div className="onboard-logo">⛽</div>
              <h1 className="onboard-title">Welcome to GASMAN</h1>
              <p className="onboard-subtitle">
                Real-time BC gas prices — and the fastest way to find cheap fuel on your next drive.
              </p>
            </div>

            <div className="onboard-features">
              <div className="onboard-feature">
                <div className="onboard-feature-icon">🗺️</div>
                <div className="onboard-feature-body">
                  <div className="onboard-feature-title">Route Finder</div>
                  <div className="onboard-feature-desc">
                    Enter your start &amp; end point. We rank the cheapest gas stations along your route — no unnecessary detours.
                  </div>
                </div>
              </div>
              <div className="onboard-feature">
                <div className="onboard-feature-icon">📊</div>
                <div className="onboard-feature-body">
                  <div className="onboard-feature-title">My Dashboard</div>
                  <div className="onboard-feature-desc">Pin favourite stations, save routes, and track price changes with snapshots.</div>
                </div>
              </div>
              <div className="onboard-feature">
                <div className="onboard-feature-icon">📡</div>
                <div className="onboard-feature-body">
                  <div className="onboard-feature-title">Live BC Prices</div>
                  <div className="onboard-feature-desc">Prices refresh every 30 min across Metro Vancouver, the Island, Okanagan & more.</div>
                </div>
              </div>
            </div>

            <div className="onboard-actions">
              <button className="onboard-btn-primary" onClick={() => setStep(1)}>Next →</button>
              <button className="onboard-btn-skip" onClick={() => finish(true)}>Skip setup</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="onboard-step-header">
              <button className="onboard-back" onClick={() => setStep(0)}>← Back</button>
              <span className="onboard-step-label">Step 2 of 3</span>
            </div>

            <div className="onboard-vehicle-section">
              <h2 className="onboard-section-title">🚗 What's your vehicle?</h2>
              <p className="onboard-section-sub">
                Used to estimate your <strong>total trip fuel cost</strong> in Route Finder — so you see dollar savings, not just cents-per-litre.
              </p>

              <div className="onboard-vehicle-presets">
                {VEHICLE_PRESETS.map((p) => (
                  <button key={p.label}
                    className={`onboard-vehicle-btn ${selectedPreset?.label === p.label ? "onboard-vehicle-active" : ""}`}
                    onClick={() => { setSelectedPreset(p); setCustomL100(""); }}>
                    <span className="onboard-vehicle-icon">{p.icon}</span>
                    <div>
                      <span className="onboard-vehicle-label">{p.label}</span>
                      <span className="onboard-vehicle-val">{p.l100km} L/100km</span>
                    </div>
                    {selectedPreset?.label === p.label && <span className="onboard-vehicle-check">✓</span>}
                  </button>
                ))}
              </div>

              <div className="onboard-vehicle-custom">
                <input className="route-save-input onboard-vehicle-name"
                  placeholder="Vehicle name (optional, e.g. My Civic)"
                  value={vehicleName}
                  onChange={(e) => setVehicleName(e.target.value)}
                  maxLength={30} />
                <div className="onboard-custom-l100">
                  <span className="profile-unit">Custom:</span>
                  <input type="number" className="route-save-input" style={{ width: 72 }}
                    placeholder="—"
                    value={customL100} min={3} max={30} step={0.5}
                    onChange={(e) => { setCustomL100(e.target.value); setSelectedPreset(null); }} />
                  <span className="profile-unit">L/100km</span>
                </div>
              </div>
            </div>

            <div className="onboard-actions">
              <button className="onboard-btn-primary" onClick={() => setStep(2)}>
                Next →
              </button>
              <button className="onboard-btn-skip" onClick={() => setStep(2)}>Skip</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboard-step-header">
              <button className="onboard-back" onClick={() => setStep(1)}>← Back</button>
              <span className="onboard-step-label">Step 3 of 3</span>
            </div>

            <div className="onboard-card-section">
              <h2 className="onboard-section-title">💳 Gas rewards cards?</h2>
              <p className="onboard-section-sub">
                Tap a bank to see its cards. Select any you own — we'll show your effective discounted price.
                {selectedCardIds.length > 0 && (
                  <span className="onboard-card-count"> {selectedCardIds.length} selected.</span>
                )}
              </p>
              <div className="onboard-card-scroll">
                <CardPicker selectedIds={selectedCardIds} onToggle={toggleCard} />
              </div>
            </div>

            <div className="onboard-actions">
              <button className="onboard-btn-primary" onClick={() => finish(false)}>
                Get Started →
              </button>
              <button className="onboard-btn-skip" onClick={() => finish(true)}>Skip for now</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
