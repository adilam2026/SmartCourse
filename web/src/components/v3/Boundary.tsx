import { Component, type ReactNode } from "react";
import { setV3On } from "../../v3";

/** Filet de sécurité : si l'écran V3 plante, l'appareil revient seul à la V2 (le choix est coupé) ; rien n'est perdu. */
export class V3Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    setV3On(false);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
