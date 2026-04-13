// GA4 analytics helpers — Vite/React SPA
// Set VITE_GA_ID in .env to override the default measurement ID.

export const GA_MEASUREMENT_ID =
  import.meta.env.VITE_GA_ID || "G-61H0YWQ6D9";

// Mirror the gtag snippet exactly: push an Arguments object so GA4's SDK
// processes it correctly. Falls back to dataLayer queue if window.gtag
// hasn't been defined yet (rare, since the snippet is synchronous in index.html).
function gtag() {
  if (typeof window === "undefined" || !GA_MEASUREMENT_ID) return;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function") {
    // eslint-disable-next-line prefer-rest-params
    window.gtag.apply(window, arguments);
  } else {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  }
}

/**
 * Track a virtual pageview.
 * Call whenever the user navigates to a new "page" inside the SPA.
 * Do NOT call on initial mount — index.html snippet already fires that hit.
 *
 * @param {string} path   e.g. "/all-stations"
 * @param {string} [title] optional page title (defaults to document.title)
 */
export function pageview(path, title) {
  if (!GA_MEASUREMENT_ID) return;
  gtag("event", "page_view", {
    page_title: title || document.title,
    page_location: window.location.origin + path,
  });
}

/**
 * Track a custom GA4 event.
 *
 * @param {{ action: string, category?: string, label?: string, value?: number }} opts
 *
 * Example:
 *   event({ action: "search_route", category: "Route Finder", label: "Vancouver→Whistler" });
 */
export function event({ action, category, label, value }) {
  if (!GA_MEASUREMENT_ID) return;
  gtag("event", action, {
    event_category: category,
    event_label: label,
    value,
  });
}
