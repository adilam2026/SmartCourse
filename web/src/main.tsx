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

// Connection back, app back in the foreground, and a slow poll: all just "check the server now".
// Live updates arrive over SSE (engine.openEvents); this poll is only the safety net.
window.addEventListener("online", () => void engine.retryNow());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void engine.retryNow());
setInterval(() => document.visibilityState === "visible" && !engine.getState().live && void engine.refresh(), 30_000);

void engine.start();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App engine={engine} />
  </StrictMode>,
);
