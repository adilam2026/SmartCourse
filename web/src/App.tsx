import { LinkScreen, LoginScreen, SetupVerify, Welcome } from "./screens/Login";
import { UpdateBanner } from "./components/VersionInfo";
import { ParentApp } from "./screens/Parent";
import { StaffScreen } from "./screens/Staff";
import { StaffApp } from "./components/v3/StaffApp";
import { V3Boundary } from "./components/v3/Boundary";
import { useV3 } from "./v3";
import { useEffect, useState } from "react";
import { reconcilePush } from "./push";
import { clearOpenTarget } from "./openTarget";
import { useEngine } from "./useEngine";
import type { Engine } from "./sync/engine";

export function App({ engine }: { engine: Engine }) {
  return (
    <>
      <UpdateBanner engine={engine} />
      <Screens engine={engine} />
    </>
  );
}

/** E-mail links open SmartCourse itself: /#/verify/<jeton> (adresse de récupération) or /#/reset/<jeton> (nouveau mot de passe).
 *  Le jeton est dans le fragment : il n'est jamais envoyé au serveur ni consigné dans ses journaux. */
function readLink(): { kind: "verify" | "reset"; token: string } | null {
  try {
    const m = window.location.hash.match(/^#\/(verify|reset)\/([A-Za-z0-9_%.-]{16,200})$/);
    if (m) return { kind: m[1] as "verify" | "reset", token: decodeURIComponent(m[2]!) };
  } catch {
    /* no address bar */
  }
  return null;
}

/** /#/install/<autorisation> : lien d'installation. L'autorisation est gardée par l'application, jamais saisie ni affichée. */
function takeInstallLink(engine: Engine): void {
  try {
    const m = window.location.hash.match(/^#\/install\/([A-Za-z0-9_%.-]{16,200})$/);
    if (!m) return;
    engine.acceptInstallLink(decodeURIComponent(m[1]!));
    window.history.replaceState(null, "", "/");
  } catch {
    /* no address bar */
  }
}

function Screens({ engine }: { engine: Engine }) {
  const s = useEngine(engine);
  const v3 = useV3();
  useEffect(() => {
    takeInstallLink(engine);
    const on = () => takeInstallLink(engine);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [engine]);
  const [link, setLink] = useState(readLink);
  useEffect(() => {
    const on = () => {
      const l = readLink();
      if (l) setLink(l); // un retour arrière du système ne doit pas faire disparaître un lien déjà ouvert
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const leaveLink = () => {
    try {
      window.history.replaceState(null, "", "/"); // the single-use token must not stay in the address bar or history
    } catch {
      /* ignore */
    }
    setLink(null);
  };
  // A phone keeps no notification subscription of a previous profile, nor any for staff.
  const meId = s.me?.id;
  const role = s.me?.role;
  useEffect(() => {
    if (meId && role) void reconcilePush(role);
    if (role === "staff") clearOpenTarget(); // lists are for parents and administrators
  }, [meId, role]);
  // Deux présentations : compacte pour les administrateurs, grande (photos, gros boutons) pour les autres profils.
  // Elle suit le profil connecté : changement de profil et déconnexion remettent la bonne présentation tout de suite.
  useEffect(() => {
    document.documentElement.dataset.ui = s.me?.role === "admin" ? "compact" : "comfort";
  }, [s.me?.role]);
  if (link && s.phase !== "boot") return <LinkScreen key={link.token} kind={link.kind} token={link.token} onDone={leaveLink} />;
  if (s.phase === "boot") return <main className="nolist"><div className="nolist__body"><img className="nolist__logo" src="/icons/icon-192.png" alt="" width="96" height="96" /></div></main>;
  if (s.phase === "loggedOut" || !s.me) return <LoginScreen engine={engine} s={s} />;
  if (s.me.setupPending) return <SetupVerify engine={engine} />;
  if (s.welcomeCode) return <Welcome code={s.welcomeCode} onDone={engine.dismissWelcome} />;
  // Personnel : l'écran de choix (V2) ou, avec l'aperçu V3 de cet appareil, le parcours V3 (Choisir + Liste du jour).
  if (s.me.role === "staff") return v3 ? <V3Boundary><StaffApp engine={engine} s={s} /></V3Boundary> : <StaffScreen engine={engine} s={s} />;
  return <ParentApp engine={engine} s={s} />;
}
