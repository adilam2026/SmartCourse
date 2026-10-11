import { TIME_ZONE } from "./format";

/** Offset of a zone from UTC at an instant, in minutes (from the runtime's own time-zone data). */
export function offsetMinutes(zone: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}
export const fmtOffset = (min: number): string => `UTC${min < 0 ? "−" : "+"}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, "0")}` : ""}`;

export interface ClockCheck {
  phoneZone: string;
  phoneOffset: number; // minutes
  shownZone: string;
  shownOffset: number; // minutes
  /** Phone clock minus server clock, in seconds (null when the server could not be reached). */
  skewSec: number | null;
}

/** Why a time can look "shifted": the phone's zone differs from the household zone, or the phone's clock is off. Shown in Réglages / profile. */
export async function checkClock(now = new Date(), fetchServerDate: () => Promise<Date | null> = serverDate): Promise<ClockCheck> {
  const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "inconnu";
  const server = await fetchServerDate().catch(() => null);
  return {
    phoneZone,
    phoneOffset: -now.getTimezoneOffset(),
    shownZone: TIME_ZONE,
    shownOffset: offsetMinutes(TIME_ZONE, now),
    skewSec: server ? Math.round((now.getTime() - server.getTime()) / 1000) : null,
  };
}

async function serverDate(): Promise<Date | null> {
  const res = await fetch("/health", { cache: "no-store" });
  const h = res.headers.get("date");
  return h ? new Date(h) : null;
}
