import { useEffect, useRef } from "react";
import { backStack } from "./back";

/** While `active`, the system Back button runs `onBack` (return false to refuse) instead of leaving the app. */
export function useBackLayer(active: boolean, onBack: () => boolean | void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!active || !backStack) return;
    return backStack.push(() => cb.current());
  }, [active]);
}
