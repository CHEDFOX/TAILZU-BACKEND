/**
 * WHEN A TRIP IS, FROM HOW THE PERSON WROTE IT: "14–16 Nov", "Nov 14-16", "14 Nov – 2 Dec", "14/11 - 16/11", "Sat 14 Nov", "this weekend",
 * "tomorrow". The year is the next time that day comes (a date more than two months back is next year's). Anything else is null, and
 * the trip simply has no dates: the weather and the stay totals wait for them.
 *
 *   tripDates("14–16 Nov", "2026-10-28")  -> { from: "2026-11-14", to: "2026-11-16", nights: 2 }
 */
export interface TripDates { from: string; to: string; nights: number }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY = 86_400_000;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (key: string) => Date.parse(`${key}T00:00:00Z`);
const monthOf = (w: string): number => MONTHS.indexOf(w.slice(0, 3).toLowerCase());

function dateKey(y: number, m: number, d: number): string | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m, d);
  const dt = new Date(ms);
  return dt.getUTCMonth() === m && dt.getUTCDate() === d ? keyOf(ms) : null;
}

/** That day and month, in the year that makes it not long past. */
function upcoming(today: string, m: number, d: number, year?: number): string | null {
  const y0 = Number(today.slice(0, 4));
  if (year) return dateKey(year, m, d);
  const k = dateKey(y0, m, d);
  if (!k) return null;
  return msOf(k) < msOf(today) - 60 * DAY ? dateKey(y0 + 1, m, d) : k;
}

function span(from: string | null, to: string | null): TripDates | null {
  if (!from || !to) return null;
  let t = to;
  if (msOf(t) < msOf(from)) {
    const next = dateKey(Number(t.slice(0, 4)) + 1, Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
    if (!next) return null;
    t = next;
  }
  const nights = Math.round((msOf(t) - msOf(from)) / DAY);
  return nights > 30 ? null : { from, to: t, nights };
}

export function tripDates(when: string, today: string): TripDates | null {
  const w = when.toLowerCase().replace(/[–—]/g, "-").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/g, "")
    .replace(/\s+/g, " ").trim();
  if (!w) return null;
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (/^(this )?weekend$|^next weekend$/.test(w)) {
    const toSat = (6 - dow + 7) % 7;
    const sat = msOf(today) + (dow === 0 ? -1 : toSat) * DAY + (w.startsWith("next") ? 7 * DAY : 0);
    return { from: keyOf(Math.max(sat, msOf(today))), to: keyOf(sat + DAY), nights: Math.round((sat + DAY - Math.max(sat, msOf(today))) / DAY) };
  }
  if (w === "today") return { from: today, to: today, nights: 0 };
  if (w === "tomorrow") { const k = keyOf(msOf(today) + DAY); return { from: k, to: k, nights: 0 }; }

  const M = "([a-z]{3,9})", D = "(\\d{1,2})", Y = "(?:\\s*,?\\s*(\\d{4}))?", SEP = "\\s*(?:-|to|till|until)\\s*";
  let m: RegExpMatchArray | null;
  // 14-16 nov [2026]
  if ((m = w.match(new RegExp(`^${D}${SEP}${D}\\s*${M}${Y}$`))) && monthOf(m[3]!) >= 0) {
    const mo = monthOf(m[3]!), y = m[4] ? Number(m[4]) : undefined;
    const from = upcoming(today, mo, Number(m[1]), y);
    return span(from, from ? dateKey(Number(from.slice(0, 4)), mo, Number(m[2])) : null);
  }
  // nov 14-16 [2026]
  if ((m = w.match(new RegExp(`^${M}\\s*${D}${SEP}${D}${Y}$`))) && monthOf(m[1]!) >= 0) {
    const mo = monthOf(m[1]!), y = m[4] ? Number(m[4]) : undefined;
    const from = upcoming(today, mo, Number(m[2]), y);
    return span(from, from ? dateKey(Number(from.slice(0, 4)), mo, Number(m[3])) : null);
  }
  // 14 nov - 2 dec [2026]
  if ((m = w.match(new RegExp(`^${D}\\s*${M}${SEP}${D}\\s*${M}${Y}$`))) && monthOf(m[2]!) >= 0 && monthOf(m[4]!) >= 0) {
    const y = m[5] ? Number(m[5]) : undefined;
    const from = upcoming(today, monthOf(m[2]!), Number(m[1]), y);
    return span(from, from ? dateKey(Number(from.slice(0, 4)), monthOf(m[4]!), Number(m[3])) : null);
  }
  // nov 14 - dec 2
  if ((m = w.match(new RegExp(`^${M}\\s*${D}${SEP}${M}\\s*${D}${Y}$`))) && monthOf(m[1]!) >= 0 && monthOf(m[3]!) >= 0) {
    const y = m[5] ? Number(m[5]) : undefined;
    const from = upcoming(today, monthOf(m[1]!), Number(m[2]), y);
    return span(from, from ? dateKey(Number(from.slice(0, 4)), monthOf(m[3]!), Number(m[4])) : null);
  }
  // 14 nov / nov 14
  if ((m = w.match(new RegExp(`^${D}\\s*${M}${Y}$`))) && monthOf(m[2]!) >= 0) {
    const k = upcoming(today, monthOf(m[2]!), Number(m[1]), m[3] ? Number(m[3]) : undefined);
    return k ? { from: k, to: k, nights: 0 } : null;
  }
  if ((m = w.match(new RegExp(`^${M}\\s*${D}${Y}$`))) && monthOf(m[1]!) >= 0) {
    const k = upcoming(today, monthOf(m[1]!), Number(m[2]), m[3] ? Number(m[3]) : undefined);
    return k ? { from: k, to: k, nights: 0 } : null;
  }
  // 14/11[/2026] [- 16/11[/2026]]   (day first, as India writes it)
  const N = "(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?";
  if ((m = w.match(new RegExp(`^${N}(?:${SEP}${N})?$`)))) {
    const yr = (s?: string) => (s ? (s.length === 2 ? 2000 + Number(s) : Number(s)) : undefined);
    const from = upcoming(today, Number(m[2]) - 1, Number(m[1]), yr(m[3]));
    if (!m[4]) return from ? { from, to: from, nights: 0 } : null;
    return span(from, from ? dateKey(yr(m[6]) ?? Number(from.slice(0, 4)), Number(m[5]) - 1, Number(m[4])) : null);
  }
  // 14-16/11
  if ((m = w.match(/^(\d{1,2})\s*-\s*(\d{1,2})[/.](\d{1,2})$/))) {
    const from = upcoming(today, Number(m[3]) - 1, Number(m[1]));
    return span(from, from ? dateKey(Number(from.slice(0, 4)), Number(m[3]) - 1, Number(m[2])) : null);
  }
  return null;
}

/** The days of a trip, first to last ("2026-11-14", "2026-11-15", "2026-11-16"). */
export function tripDays(d: TripDates): string[] {
  const out: string[] = [];
  for (let t = msOf(d.from); t <= msOf(d.to) && out.length < 31; t += DAY) out.push(keyOf(t));
  return out;
}
