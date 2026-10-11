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

/** A validation counts as "sent later" when the server received it more than 2 minutes after the person pressed the button. */
export const LATE_MS = 2 * 60_000;
export const isLate = (at: string, receivedAt?: string | null): boolean => !!receivedAt && new Date(receivedAt).getTime() - new Date(at).getTime() > LATE_MS;
/** "envoyé plus tard (reçu à 14:12)" or "" — both times are kept, the first one is the one that counts. */
export const lateNote = (at: string, receivedAt?: string | null, now = new Date()): string => (isLate(at, receivedAt) ? `envoyé plus tard (reçu ${fmtWhen(receivedAt!, now)})` : "");

const dayMonthLong = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, day: "numeric", month: "long" });
const dayMonthYear = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
/** "10 octobre" (the year is added when it is not the current one). */
export const fmtDayMonth = (iso: string, now = new Date()): string => {
  const same = ymd.format(new Date(iso)).slice(0, 4) === ymd.format(now).slice(0, 4);
  return (same ? dayMonthLong : dayMonthYear).format(new Date(iso));
};
const calDay = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const calDayMonth = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" });
const parseDay = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd));
};
/** "du 1er au 11 octobre 2026" / "du 1 août au 11 octobre 2026" from two YYYY-MM-DD days (inclusive). */
export const fmtDayRange = (fromDay: string, toDay: string): string => {
  const a = parseDay(fromDay);
  const b = parseDay(toDay);
  if (fromDay === toDay) return `le ${calDay.format(a)}`;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  const from = sameMonth ? String(a.getUTCDate()) : sameYear ? calDayMonth.format(a) : calDay.format(a);
  return `du ${from} au ${calDay.format(b)}`;
};
/** "1er août" style without year: same-period labels in the comparison line. */
export const fmtDayRangeShort = (fromDay: string, toDay: string): string => {
  const a = parseDay(fromDay);
  const b = parseDay(toDay);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  return sameMonth ? `${a.getUTCDate()} au ${calDayMonth.format(b)}` : `${calDayMonth.format(a)} au ${calDayMonth.format(b)}`;
};
/** "oct." — short month for chart axes, from "2026-10". */
export const fmtMonthShort = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "short" }).format(new Date(Date.UTC(y, m - 1, 15)));
};
