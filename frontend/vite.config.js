import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "GASMAN — BC Gas Prices",
        short_name: "GASMAN",
        description: "Real-time BC gas prices, route finder, and fill-up tracker",
        theme_color: "#f97316",
        background_color: "#f5f7fa",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Cache shell + assets
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Cache API responses for offline fallback (stale-while-revalidate)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\/api\/stations/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-stations",
              expiration: { maxAgeSeconds: 60 * 60 * 2 }, // 2h
            },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "nominatim",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
