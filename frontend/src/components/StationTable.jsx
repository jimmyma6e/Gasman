import { useState } from "react";

const FUEL_TYPES = [
  { key: "regular_gas",  label: "Regular" },
  { key: "midgrade_gas", label: "Mid"     },
  { key: "premium_gas",  label: "Premium" },
  { key: "diesel",       label: "Diesel"  },
];

function formatPrice(price, unit) {
  if (price == null) return null;
  const perLitre = unit?.includes("litre") || unit?.includes("liter");
  return `${price.toFixed(perLitre ? 1 : 2)}${perLitre ? "¢/L" : "$/gal"}`;
}

function timeAgo(isoString) {
  if (!isoString) return "—";
  const diff = Math.floor((Date.now() - new Date(isoString)) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const hrs = Math.floor(diff / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DeltaBadge({ delta }) {
  if (delta == null) return null;
  return (
    <span className={`price-delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
      {delta > 0 ? "↑" : "↓"}{Math.abs(delta).toFixed(1)}
    </span>
  );
}

export default function StationTable({ stations, cheapestPrices, favourites, onToggleFavourite, onOpenChart }) {
  const [sortCol, setSortCol] = useState("regular_gas");
  const [sortDir, setSortDir] = useState(1);

  function handleColClick(col) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else { setSortCol(col); setSortDir(1); }
  }

  const sorted = [...stations].sort((a, b) => {
    if (sortCol === "name") return sortDir * a.name.localeCompare(b.name);
    if (sortCol === "area") return sortDir * (a._area ?? "").localeCompare(b._area ?? "");
    const av = a[sortCol]?.price ?? Infinity;
    const bv = b[sortCol]?.price ?? Infinity;
    return sortDir * (av - bv);
  });

  function ColHeader({ col, label }) {
    const active = sortCol === col;
    return (
      <th className={`tbl-th tbl-sortable ${active ? "tbl-th-active" : ""}`} onClick={() => handleColClick(col)}>
        {label}<span className="tbl-sort-icon">{active ? (sortDir === 1 ? " ↑" : " ↓") : " ↕"}</span>
      </th>
    );
  }

  return (
    <div className="tbl-wrap">
      <table className="station-table">
        <thead>
          <tr>
            <th className="tbl-th tbl-fav-col" title="Favourites">★</th>
            <ColHeader col="name" label="Station" />
            <th className="tbl-th">Address</th>
            <ColHeader col="area" label="Area" />
            {FUEL_TYPES.map(({ key, label }) => <ColHeader key={key} col={key} label={label} />)}
            <th className="tbl-th tbl-updated-col">Updated</th>
            <th className="tbl-th" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const isFav = favourites.includes(s.station_id);
            const deltas = s.price_delta || {};
            const updated = FUEL_TYPES.map((f) => s[f.key]?.last_updated).filter(Boolean).sort().at(-1);
            return (
              <tr key={s.station_id} className="tbl-row">
                <td className="tbl-td tbl-fav-col">
                  <button className={`btn-fav btn-fav-sm ${isFav ? "btn-fav-active" : ""}`} onClick={() => onToggleFavourite(s.station_id)}>
                    {isFav ? "★" : "☆"}
                  </button>
                </td>
                <td className="tbl-td tbl-name">{s.name}</td>
                <td className="tbl-td tbl-addr">
                  <a className="tbl-addr-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.address}, ${s._area}, BC`)}`} target="_blank" rel="noreferrer">{s.address}</a>
                </td>
                <td className="tbl-td tbl-area">{s._area}</td>
                {FUEL_TYPES.map(({ key }) => {
                  const price = s[key]?.price;
                  const isCheap = price != null && price === cheapestPrices[key];
                  return (
                    <td key={key} className={`tbl-td tbl-price ${isCheap ? "tbl-cheapest" : ""}`}>
                      {price != null ? <span className="tbl-price-inner">{formatPrice(price, s.unit_of_measure)}<DeltaBadge delta={deltas[key]} /></span> : <span className="tbl-empty">—</span>}
                    </td>
                  );
                })}
                <td className="tbl-td tbl-updated">{timeAgo(updated)}</td>
                <td className="tbl-td"><button className="btn-chart btn-chart-sm" onClick={() => onOpenChart(s)} title="Price history">📈</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
