import { LoginScreen } from "./screens/Login";
import { ParentApp } from "./screens/Parent";
import { StaffScreen } from "./screens/Staff";
import { useEngine } from "./useEngine";
import type { Engine } from "./sync/engine";

export function App({ engine }: { engine: Engine }) {
  const s = useEngine(engine);
  if (s.phase === "boot") return <main className="nolist"><div className="nolist__body"><div className="nolist__icon">🛒</div></div></main>;
  if (s.phase === "loggedOut" || !s.me) return <LoginScreen engine={engine} s={s} />;
  if (s.me.role === "staff") return <StaffScreen engine={engine} s={s} />;
  return <ParentApp engine={engine} s={s} />;
}
