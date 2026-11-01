import { describe, expect, it } from "vitest";
import { checkClock, fmtOffset, offsetMinutes } from "./clock";
import { fmtTime, fmtWhen } from "./format";

describe("heure affichée : toujours celle du foyer (Africa/Casablanca), quel que soit le fuseau du téléphone", () => {
  // Règle officielle (base IANA des fuseaux, version 2026c du 08/07/2026) : UTC+1 hors Ramadan jusqu'au 20/09/2026 à 02:00,
  // puis UTC+0 permanent (Maroc et Sahara occidental). Ces attentes exigent des données de fuseaux 2026c ou plus récentes.
  it("07:00 UTC : 08:00 (UTC+1) jusqu'au 20 septembre 2026, puis 07:00 (UTC+0 permanent)", () => {
    expect(fmtTime("2026-01-15T07:00:00Z")).toBe("08:00");
    expect(fmtTime("2026-09-19T07:00:00Z")).toBe("08:00"); // veille du changement
    expect(fmtTime("2026-09-21T07:00:00Z")).toBe("07:00"); // lendemain : UTC+0
    expect(fmtTime("2026-10-11T07:00:00Z")).toBe("07:00");
    expect(fmtTime("2026-06-11T23:30:00Z")).toBe("00:30"); // UTC+1 : passage de minuit, jour suivant
    expect(fmtWhen("2026-06-11T23:30:00Z", new Date("2026-06-12T10:00:00Z"))).toBe("00:30"); // même jour du foyer
    expect(fmtTime("2026-10-11T23:30:00Z")).toBe("23:30"); // UTC+0 : même jour
  });
  it("pendant le Ramadan 2026 le Maroc passe à UTC+0 : l'heure affichée suit ce changement officiel", () => {
    expect(offsetMinutes("Africa/Casablanca", new Date("2026-03-01T12:00:00Z"))).toBe(0);
    expect(offsetMinutes("Africa/Casablanca", new Date("2026-06-15T12:00:00Z"))).toBe(60);
    expect(offsetMinutes("Africa/Casablanca", new Date("2026-10-11T12:00:00Z"))).toBe(0); // UTC+0 permanent depuis le 20/09/2026
    expect(offsetMinutes("Africa/Casablanca", new Date("2027-06-15T12:00:00Z"))).toBe(0);
  });
  it("le diagnostic signale un fuseau de téléphone différent et un écart d'horloge", async () => {
    const now = new Date("2026-10-11T12:00:00Z");
    const c = await checkClock(now, async () => new Date("2026-10-11T11:58:00Z"));
    expect(c.shownOffset).toBe(0); // octobre 2026 : UTC+0
    expect(c.skewSec).toBe(120);
    expect((await checkClock(now, async () => null)).skewSec).toBeNull();
    expect(fmtOffset(60)).toBe("UTC+1");
    expect(fmtOffset(0)).toBe("UTC+0");
    expect(fmtOffset(-330)).toBe("UTC−5:30");
  });
});
