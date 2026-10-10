import { useEffect, useRef, type ReactNode } from "react";
import { useBackLayer } from "../useBackLayer";

/**
 * Bottom sheet. It follows the *visual* viewport, so that on a phone the on-screen keyboard never hides it
 * (the sheet shrinks and scrolls instead). `dismissable=false` keeps a tap outside from closing it (unsaved form).
 */
export function Dialog({ title, children, onClose, dismissable = true }: { title: string; children: ReactNode; onClose(): void; dismissable?: boolean }) {
  const backdrop = useRef<HTMLDivElement>(null);
  // Android Back closes the dialog (an unsaved form refuses: the user must choose Annuler or Enregistrer).
  useBackLayer(true, () => (dismissable ? onClose() : false));
  useEffect(() => {
    const vv = window.visualViewport;
    const el = backdrop.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      el.style.bottom = "auto";
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);
  return (
    <div className="sheet-backdrop" ref={backdrop} onClick={dismissable ? onClose : undefined}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
