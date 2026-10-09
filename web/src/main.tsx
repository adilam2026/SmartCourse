import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { createEngine } from "./sync/engine";
import "./styles.css";

/** Warm the photo cache in the background so the catalogue works fully offline. */
async function preloadPhotos(urls: string[]): Promise<void> {
  const queue = [...urls];
  const worker = async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      try {
        await fetch(u, { credentials: "same-origin" });
      } catch {
        return; // offline: stop quietly, the next refresh retries
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

const engine = createEngine({ preload: (urls) => void preloadPhotos(urls), eventSource: (url) => new EventSource(url) });
(window as unknown as { __engine: typeof engine }).__engine = engine;
registerSW({ immediate: true });
// The catalogue pictures were replaced: drop the previous picture cache so phones do not keep the old images.
void window.caches?.delete("photos").catch(() => {});

// Connection back, app back in the foreground, and a slow poll: all just "check the server now".
// Live updates arrive over SSE (engine.openEvents). When a proxy or tunnel holds the stream back (no "ready" event: live stays
// false), this poll is what keeps the profiles in sync, so it is short enough to feel immediate.
window.addEventListener("online", () => void engine.retryNow());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void engine.retryNow());
setInterval(() => document.visibilityState === "visible" && !engine.getState().live && void engine.refresh(), 8_000);

void engine.start();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App engine={engine} />
  </StrictMode>,
);
