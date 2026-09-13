// Shared across App.jsx, MapView, StationTable, RouteTab and Dashboard so
// the four fuel-tab labels never drift out of sync between files. Premium
// shows the full octane range since it varies by brand (91 default, 93 for
// Esso/Shell, 94 for Petro-Canada) — a single station's own premium price
// is always one specific number, shown via octaneLabel() instead.
export const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular (87)" },
  { key: "midgrade_gas", label: "Mid-Grade (89)" },
  { key: "premium_gas",  label: "Premium (91/93/94)" },
  { key: "diesel",       label: "Diesel" },
];
