import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Hauteur réservée en bas pour la navigation : le menu ne s'y place jamais (px). */
const NAV = 84;
const EDGE = 8;

/**
 * Menu « … » ancré à son bouton : il s'ouvre sous le bouton (ou au-dessus s'il manque de place), aligné sur le bord du bouton
 * puis ramené dans l'écran des deux côtés ; jamais derrière la barre de navigation. Se ferme au toucher à côté, avec Échap ou après un choix.
 */
export function Menu({ label, testid, className = "", children }: { label: string; testid: string; className?: string; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useLayoutEffect(() => {
    if (!open || !btn.current || !box.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const el = box.current!;
      const vv = window.visualViewport;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      const w = Math.min(el.offsetWidth, vw - 2 * EDGE);
      const h = el.offsetHeight;
      const left = Math.max(EDGE, Math.min(r.right - w, vw - w - EDGE));
      let top = r.bottom + 4;
      if (top + h > vh - NAV) top = r.top - h - 4; // pas de place dessous : au-dessus du bouton
      top = Math.max(EDGE, Math.min(top, vh - NAV - h));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.maxWidth = `${vw - 2 * EDGE}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  return (
    <span className={`menuwrap ${className}`}>
      <button ref={btn} type="button" className="btn btn--small btn--ghost menubtn" aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid={testid} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <>
          <div className="menuveil" onClick={close} />
          <div ref={box} className="popmenu" role="menu" data-testid={`${testid}-menu`}>{children(close)}</div>
        </>
      )}
    </span>
  );
}

export function MenuItem({ children, onClick, danger, testid, disabled }: { children: ReactNode; onClick(): void; danger?: boolean; testid?: string; disabled?: boolean }) {
  return <button type="button" role="menuitem" disabled={disabled} className={`popmenu__item ${danger ? "popmenu__item--danger" : ""}`} data-testid={testid} onClick={onClick}>{children}</button>;
}
