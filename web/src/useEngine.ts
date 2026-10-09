import { useSyncExternalStore } from "react";
import type { Engine, State } from "./sync/engine";

export function useEngine(engine: Engine): State {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}
