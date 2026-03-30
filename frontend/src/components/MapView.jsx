import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function MapController({ selectedStation, stations }) {
  const map = useMap();

  useEffect(() => {
    if (selectedStation?.latitude && selectedStation?.longitude) {
      map.flyTo([selectedStation.latitude, selectedStation.longitude], 15, { duration: 0.8 });
    }
  }, [selectedStation, map]);

  useEffect(() => {
    if (selectedStation) return;
    const pts = stations.filter((s) => s.latitude && s.longitude).map((s) => [s.latitude, s.longitude]);
    if (pts.length > 0) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 14, animate: true, duration: 0.6 });
    }
  }, [stations.map((s) => s.station_id).join(","), map]);

  return null;
}

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular (87)" },
  { key: "midgrade_gas", label: "Mid (89)"     },
  { key: "premium_gas",  label: "Premium (91)" },
  { key: "diesel",       label: "Diesel"       },
];

function getPriceColor(price, minPrice, maxPrice) {
  if (price == null || price <= 0) return "#aaaaaa";
  const ratio = (price - minPrice) / (maxPrice - minPrice || 1);
  const r = Math.round(34  + (239 - 34)  * ratio);
  const g = Math.round(197 + (68  - 197) * ratio);
  const b = Math.round(94  + (68  - 94)  * ratio);
  return `rgb(${r},${g},${b})`;
}

function makePriceIcon(price, color, isSelected = false) {
  const label = price != null ? `${price.toFixed(1)}¢` : "—";
  const scale = isSelected ? 1.15 : 1;
  const html = `
    <div style="
      display:inline-flex;
      flex-direction:column;
      align-items:center;
      transform:scale(${scale});
      transform-origin:bottom center;
      filter:${isSelected ? "drop-shadow(0 0 6px rgba(245,158,11,0.9))" : "drop-shadow(0 2px 4px rgba(0,0,0,0.5))"};
    ">
      <div style="
        background:#fff;
        color:${color};
        font-size:12px;
        font-weight:800;
        font-family:system-ui,sans-serif;
        padding:4px 8px;
        border-radius:8px;
        white-space:nowrap;
        border:2.5px solid ${color};
        line-height:1.2;
      ">${label}</div>
      <div style="
        width:0;height:0;
        border-left:5px solid transparent;
        border-right:5px solid transparent;
        border-top:7px solid ${color};
        margin-top:-1px;
      "></div>
    </div>
  `;
  return L.divIcon({ html, className: "", iconAnchor: [24, 38] });
}

export default function MapView({ stations, activeFuel, onOpenChart, selectedStation, onSelectStation }) {
  const VANCOUVER_CENTER = [49.2827, -123.1207];

  const valid    = stations.filter((s) => s.latitude && s.longitude);
  const prices   = valid.map((s) => s[activeFuel]?.price).filter((p) => p != null && p > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  return (
    <MapContainer
      center={VANCOUVER_CENTER}
      zoom={12}
      style={{ height: "620px", width: "100%", borderRadius: "12px", zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController selectedStation={selectedStation} stations={valid} />
      {valid.map((station) => {
        const price = station[activeFuel]?.price > 0 ? station[activeFuel].price : null;
        const isSelected = selectedStation?.station_id === station.station_id;
        const color = isSelected ? "#f59e0b" : getPriceColor(price, minPrice, maxPrice);
        const icon  = makePriceIcon(price, color, isSelected);

        return (
          <Marker
            key={station.station_id}
            position={[station.latitude, station.longitude]}
            icon={icon}
            eventHandlers={{ click: () => onSelectStation?.(station) }}
          >
            <Popup minWidth={180}>
              <div style={{ fontFamily: "system-ui, sans-serif" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "2px" }}>{station.name}</div>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
                  {station.address}, {station._area}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 12px", fontSize: "13px", marginBottom: "8px" }}>
                  {FUEL_TYPES.map(({ key, label }) => {
                    const p = station[key]?.price;
                    return p != null && p > 0 ? (
                      <>
                        <span key={`${key}-label`} style={{ color: "#555" }}>{label}</span>
                        <span key={`${key}-price`} style={{ fontWeight: 600, textAlign: "right" }}>{p.toFixed(1)}¢/L</span>
                      </>
                    ) : null;
                  })}
                </div>
                <button
                  onClick={() => onOpenChart(station)}
                  style={{ width: "100%", padding: "5px", cursor: "pointer", borderRadius: "6px", border: "1px solid #ddd", background: "#f5f5f5", fontSize: "12px" }}
                >
                  📈 Price History
                </button>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
