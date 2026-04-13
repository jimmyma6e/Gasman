// PostHog initialisation — Vite + React SPA (no React Router)
// Reads credentials from Vite env vars; no-ops safely if key is absent.
//
// Usage:
//   Wrap <App /> in main.jsx:
//     <PostHogProvider><App /></PostHogProvider>
//
// Future event tracking anywhere in the app:
//   import posthog from "posthog-js";
//   posthog.capture("route_search", { origin, destination, estimated_savings });

import { useEffect } from "react";
import posthog from "posthog-js";

const POSTHOG_KEY  = import.meta.env.VITE_POSTHOG_KEY  || "phc_BnKv7kR833Qfds7oojpoXXLShMNxoQjixsy7pV5iog5z";
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

export default function PostHogProvider({ children }) {
  useEffect(() => {
    // Skip if no key configured or already initialised
    if (!POSTHOG_KEY || posthog.__loaded) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false,   // we fire $pageview manually on tab changes
      capture_pageleave: true,
      autocapture: true,         // clicks, inputs, rage-clicks etc.
    });
  }, []); // runs once on mount

  return children;
}

// ── Planned future events (call posthog.capture when ready) ──────────────────
//
// search_start          — user opens Route Finder
// search_complete       — results returned
// route_search          — { origin, destination, mode, fuel_type }
// route_results_view    — { result_count, cheapest_price }
// station_view          — { station_id, station_name, price }
// featured_station_click
// price_submit
// price_confirm
// save_station          — { station_id }
// affiliate_click       — { partner, location }
