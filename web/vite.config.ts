import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "SmartCourse — liste de courses familiale",
        short_name: "Courses",
        lang: "fr",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#fbf7f0",
        theme_color: "#1f7a4d",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//],
        // Photos are immutable (content-addressed): cache-first, kept for offline use.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/photos/"),
            handler: "CacheFirst",
            options: { cacheName: "photos-v2", expiration: { maxEntries: 500 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:3000", "/health": "http://localhost:3000" } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
