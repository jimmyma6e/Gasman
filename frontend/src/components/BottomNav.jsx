export default function BottomNav({ tab, setTab, fillupCount }) {
  const items = [
    { id: "dashboard", icon: "📊", label: "Home"   },
    { id: "all",       icon: "⛽", label: "Stations"},
    { id: "route",     icon: "🗺️", label: "Route"   },
    { id: "logs",      icon: "📋", label: "Logs"    },
  ];

  return (
    <nav className="bottom-nav">
      {items.map(({ id, icon, label }) => (
        <button
          key={id}
          className={`bottom-nav-item ${tab === id ? "bottom-nav-active" : ""}`}
          onClick={() => setTab(id)}
        >
          <span className="bottom-nav-icon">
            {icon}
            {id === "logs" && fillupCount > 0 && (
              <span className="bottom-nav-badge">{fillupCount > 9 ? "9+" : fillupCount}</span>
            )}
          </span>
          <span className="bottom-nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
