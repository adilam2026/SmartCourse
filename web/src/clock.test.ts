import { describe, expect, it } from "vitest";
import { checkClock, fmtOffset, offsetMinutes } from "./clock";
import { fmtTime, fmtWhen } from "./format";

describe("heure affichée : toujours celle du foyer (Africa/Casablanca), quel que soit le fuseau du téléphone", () => {
  it("07:00 UTC s'affiche 08:00 (UTC+1) ; hors Ramadan comme en octobre", () => {
    expect(fmtTime("2026-10-11T07:00:00Z")).toBe("08:00");
    expect(fmtTime("2026-01-15T07:00:00Z")).toBe("08:00");
    expect(fmtTime("2026-10-11T23:30:00Z")).toBe("00:30"); // passage de minuit : jour suivant
    expect(fmtWhen("2026-10-11T23:30:00Z", new Date("2026-10-12T10:00:00Z"))).toBe("00:30"); // même jour du foyer
  });
  it("pendant le Ramadan 2026 le Maroc passe à UTC+0 : l'heure affichée suit ce changement officiel", () => {
    expect(offsetMinutes("Africa/Casablanca", new Date("2026-03-01T12:00:00Z"))).toBe(0);
    expect(offsetMinutes("Africa/Casablanca", new Date("2026-10-11T12:00:00Z"))).toBe(60);
  });
  it("le diagnostic signale un fuseau de téléphone différent et un écart d'horloge", async () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const c = await checkClock(now, async () => new Date("2026-10-11T11:58:00Z"));
    expect(c.shownOffset).toBe(60);
    expect(c.skewSec).toBe(120);
    expect((await checkClock(now, async () => null)).skewSec).toBeNull();
    expect(fmtOffset(60)).toBe("UTC+1");
    expect(fmtOffset(0)).toBe("UTC+0");
    expect(fmtOffset(-330)).toBe("UTC−5:30");
  });
});
