const dt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
export const fmtDateTime = (iso: string) => dt.format(new Date(iso));
export const fmtDay = (iso: string) => day.format(new Date(iso));
