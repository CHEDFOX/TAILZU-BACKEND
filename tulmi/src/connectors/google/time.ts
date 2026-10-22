/**
 * TIME, IN THE PERSON'S OWN ZONE, IN PLAIN WORDS.
 *
 * The planner has no clock (its prompt carries no dates, by design), so a tool
 * cannot be handed an ISO timestamp for "Friday at 3". Tools take what the
 * person said instead ("friday 3pm", "tomorrow 10:00", "30 oct", or an ISO
 * time) and this file turns it into an instant in their zone, and an instant
 * back into "Friday 10:00–10:30". Plain Intl, no date library; the zone is an
 * IANA name ("Asia/Kolkata"), and daylight saving is the zone's own.
 */
export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** A real IANA zone name, or null. */
export function validZone(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return null;
  try { formatter(tz.trim()); return tz.trim(); } catch { return null; }
}

export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number }

/** The clock on the wall in `tz` at instant `ms`. */
export function wallOf(ms: number, tz: string): Wall {
  const v: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== "literal") v[p.type] = Number(p.value);
  const y = v.year!, mo = v.month!, d = v.day!;
  return { y, mo, d, h: v.hour! % 24, mi: v.minute!, s: v.second!, wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** The zone's offset from UTC at `ms`, in ms (+5:30 is 19 800 000). */
export function offsetMs(ms: number, tz: string): number {
  const w = wallOf(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall in `tz` reads y-mo-d h:mi. Day and month may overflow (31 + 1 is the 1st). */
export function atWall(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = offsetMs(guess, tz);
  const t = guess - first;
  const second = offsetMs(t, tz);
  return second === first ? t : guess - second;
}

/** Midnight at the start of the day `ms` is in, plus `days` whole days. */
export function dayStart(ms: number, tz: string, days = 0): number {
  const w = wallOf(ms, tz);
  return atWall(w.y, w.mo, w.d + days, 0, 0, tz);
}

/** RFC 3339 with the zone's offset: 2026-10-23T10:00:00+05:30. */
export function rfc3339(ms: number, tz: string): string {
  const w = wallOf(ms, tz);
  const off = Math.round(offsetMs(ms, tz) / MIN);
  const a = Math.abs(off);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}${off < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export const dateOf = (ms: number, tz: string) => { const w = wallOf(ms, tz); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; };

// ---- reading what the person said -------------------------------------------

export interface When { ms: number; /** No time of day was given: the start of that day. */ dateOnly: boolean }

const WEEKDAY_WORDS = DAYS.map((d) => d.toLowerCase());
const MONTH_WORDS = MONTHS.map((m) => m.toLowerCase());

/** "10", "10:30", "3pm", "3:15 pm", "15:00", "noon" -> [h, mi], or null. */
function clockOf(s: string): [number, number] | null {
  if (s === "noon") return [12, 0];
  if (s === "midnight") return [0, 0];
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s.replace(/^at\s+/, ""));
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (mi > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return [h, mi];
}

/**
 * What they said, as an instant in `tz`, or null when it is not a time.
 * ISO ("2026-10-23", "2026-10-23T10:00", with or without Z / +05:30), a day
 * word ("today", "tomorrow", "friday", "next friday", "30 oct", "fri 30 oct")
 * and/or a time of day ("10am", "15:30", "noon"). A time alone is today.
 */
export function parseWhen(input: unknown, tz: string, now: number): When | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s || s.length > 60) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s?(z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    const [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (iso[4] === undefined) return { ms: atWall(y, mo, d, 0, 0, tz), dateOnly: true };
    const [h, mi] = [Number(iso[4]), Number(iso[5])];
    if (h > 23 || mi > 59) return null;
    if (iso[7]) {
      const z = iso[7];
      const off = z === "z" ? 0 : (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(-2)));
      return { ms: Date.UTC(y, mo - 1, d, h, mi, Number(iso[6] ?? 0)) - off * MIN, dateOnly: false };
    }
    return { ms: atWall(y, mo, d, h, mi, tz), dateOnly: false };
  }

  const today = wallOf(now, tz);
  const found: { day: { y: number; mo: number; d: number } | null } = { day: null };
  let rest = s;
  const take = (re: RegExp, f: (m: RegExpExecArray) => { y: number; mo: number; d: number } | null): boolean => {
    const m = re.exec(rest);
    if (!m) return false;
    const got = f(m);
    if (!got) return false;
    found.day = got;
    rest = rest.slice(m[0].length).trim();
    return true;
  };
  const plus = (n: number) => { const t = new Date(Date.UTC(today.y, today.mo - 1, today.d + n)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

  // "fri", "friday"; and the months the same way.
  const WD = "(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*";
  const MON = MONTH_WORDS.join("|");
  take(/^(today|tonight|tomorrow|yesterday)\b/, (m) => plus(m[1] === "tomorrow" ? 1 : m[1] === "yesterday" ? -1 : 0))
    || take(new RegExp(`^(?:(next|this) )?(${WD})\\b(?! \\d{1,2} (?:${MON}))`), (m) => {
      let n = (WEEKDAY_WORDS.findIndex((w) => w.startsWith(m[2]!.slice(0, 3))) - today.wd + 7) % 7;
      if (m[1] === "next" && n === 0) n = 7;
      return plus(n);
    })
    || take(new RegExp(`^(?:${WD} )?(\\d{1,2})(?:st|nd|rd|th)? (${MON})[a-z]*(?: (\\d{4}))?\\b`), (m) => dated(m[1]!, m[2]!, m[3]))
    || take(new RegExp(`^(?:${WD} )?(${MON})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?\\b`), (m) => dated(m[2]!, m[1]!, m[3]));

  function dated(d: string, mon: string, year?: string): { y: number; mo: number; d: number } | null {
    const mo = MONTH_WORDS.indexOf(mon.slice(0, 3)) + 1;
    const dd = Number(d);
    if (mo < 1 || dd < 1 || dd > 31) return null;
    // No year: the next time that date comes round.
    let y = year ? Number(year) : today.y;
    if (!year && (mo < today.mo || (mo === today.mo && dd < today.d))) y += 1;
    return { y, mo, d: dd };
  }

  const d = found.day;
  if (!d) {
    const only = clockOf(rest);
    if (!only) return null;
    return { ms: atWall(today.y, today.mo, today.d, only[0], only[1], tz), dateOnly: false };
  }
  if (!rest) return { ms: atWall(d.y, d.mo, d.d, 0, 0, tz), dateOnly: true };
  const c = clockOf(rest.replace(/^(?:at|@)\s*/, ""));
  return c ? { ms: atWall(d.y, d.mo, d.d, c[0], c[1], tz), dateOnly: false } : null;
}

// ---- saying it ----------------------------------------------------------------

export const clock = (ms: number, tz: string) => { const w = wallOf(ms, tz); return `${pad(w.h)}:${pad(w.mi)}`; };

/** "Today", "Tomorrow", "Friday" for the next week, else "Fri 30 Oct". */
export function dayWord(ms: number, tz: string, now: number): string {
  const w = wallOf(ms, tz);
  const n = wallOf(now, tz);
  const diff = Math.round((Date.UTC(w.y, w.mo - 1, w.d) - Date.UTC(n.y, n.mo - 1, n.d)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return DAYS[w.wd]!;
  return `${DAYS[w.wd]!.slice(0, 3)} ${w.d} ${MONTHS[w.mo - 1]}${w.y !== n.y ? ` ${w.y}` : ""}`;
}

/** "Friday 10:00–10:30", or "Friday 22:00 to Saturday 01:00" across midnight. */
export function rangeWords(startMs: number, endMs: number, tz: string, now: number): string {
  const a = wallOf(startMs, tz), b = wallOf(endMs, tz);
  const first = `${dayWord(startMs, tz, now)} ${clock(startMs, tz)}`;
  if (endMs <= startMs) return first;
  if (a.y === b.y && a.mo === b.mo && a.d === b.d) return `${first}–${clock(endMs, tz)}`;
  return `${first} to ${dayWord(endMs, tz, now)} ${clock(endMs, tz)}`;
}

/** The day alone, for an all-day event: "Friday" / "Tomorrow". */
export const allDayWords = (dateIso: string, tz: string, now: number) => {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return `${dayWord(atWall(y, m, d, 12, 0, tz), tz, now)}, all day`;
};
