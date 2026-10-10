declare const process: { env: Record<string, string | undefined> }; // read at build time (Node), no @types/node needed
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// Identity of THIS build, baked into the bundle and published next to it (/version.json): the app compares the two to know whether
// the server now serves a newer build than the one running on the phone.
const commit = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "").slice(0, 7);
const builtAt = new Date().toISOString();
const buildId = `${commit || "local"}-${Date.now().toString(36)}`;
const versionPlugin = (): Plugin => ({
  name: "smartcourse-version",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: buildId, commit: commit || null, builtAt }) });
  },
});

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId), __BUILD_COMMIT__: JSON.stringify(commit), __BUILD_TIME__: JSON.stringify(builtAt) },
  plugins: [
    react(),
    versionPlugin(),
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
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//, /^\/version\.json$/],
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
