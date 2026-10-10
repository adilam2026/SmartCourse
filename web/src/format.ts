/** Every date and time shown to the family follows the household's time zone, whatever the phone's setting. */
export const TIME_ZONE = "Africa/Casablanca";
const dt = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "long", year: "numeric" });
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const monthLong = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });
export const fmtDateTime = (iso: string) => dt.format(new Date(iso));
export const fmtDay = (iso: string) => day.format(new Date(iso));
/** "08:00" */
export const fmtTime = (iso: string) => hm.format(new Date(iso));
/** "08:00" today, "12 oct. 08:00" another day (same rule as the household's calendar day, not the phone's). */
export const fmtWhen = (iso: string, now = new Date()) => (ymd.format(new Date(iso)) === ymd.format(now) ? fmtTime(iso) : fmtDateTime(iso));
/** "octobre 2026" from "2026-10". */
export const fmtMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const s = monthLong.format(new Date(Date.UTC(y, m - 1, 15)));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
