import { LoginScreen, Welcome } from "./screens/Login";
import { UpdateBanner } from "./components/VersionInfo";
import { ParentApp } from "./screens/Parent";
import { StaffScreen } from "./screens/Staff";
import { useEffect } from "react";
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

function Screens({ engine }: { engine: Engine }) {
  const s = useEngine(engine);
  // A phone keeps no notification subscription of a previous profile, nor any for staff.
  const meId = s.me?.id;
  const role = s.me?.role;
  useEffect(() => {
    if (meId && role) void reconcilePush(role);
    if (role === "staff") clearOpenTarget(); // lists are for parents and administrators
  }, [meId, role]);
  if (s.phase === "boot") return <main className="nolist"><div className="nolist__body"><div className="nolist__icon">🛒</div></div></main>;
  if (s.phase === "loggedOut" || !s.me) return <LoginScreen engine={engine} s={s} />;
  if (s.welcomeCode) return <Welcome code={s.welcomeCode} onDone={engine.dismissWelcome} />;
  if (s.me.role === "staff") return <StaffScreen engine={engine} s={s} />;
  return <ParentApp engine={engine} s={s} />;
}
