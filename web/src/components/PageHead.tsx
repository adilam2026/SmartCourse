import { useState, type ReactNode } from "react";
import type { Engine, State } from "../sync/engine";
import { Icon } from "./Icon";
import { UserSheet } from "./UserSheet";

/**
 * Header shared by every screen: brand and profile button on one line, then the title (and a line under it).
 * With `onBack` the brand is replaced by a labelled back button (screens opened from another one).
 */
export function PageHead({ engine, s, title, subtitle, onBack, backLabel = "Retour", backTestId = "back", children }: { engine: Engine; s: State; title: string; subtitle?: ReactNode; onBack?(): void; backLabel?: string; backTestId?: string; children?: ReactNode }) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="pagehead">
      <div className="pagehead__bar">
        {onBack ? (
          <button className="backbtn" data-testid={backTestId} aria-label={backLabel} onClick={onBack}>
            <Icon name="arrow-left" size={22} /> <span>{backLabel}</span>
          </button>
        ) : (
          <span className="brand">
            <img src="/icons/icon-192.png" alt="" width="32" height="32" />
            Courses
          </span>
        )}
        <button className="avatar" aria-label="Mon profil" data-testid="avatar" onClick={() => setMenu(true)}>
          {s.me?.displayName.slice(0, 1).toUpperCase()}
        </button>
      </div>
      <h1 className="pagehead__title">{title}</h1>
      {subtitle != null && <div className="pagehead__sub">{subtitle}</div>}
      {children}
      {menu && <UserSheet engine={engine} s={s} onClose={() => setMenu(false)} />}
    </header>
  );
}
