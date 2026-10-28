/**
 * TAILZU'S OWN CALENDAR: DAYS, TIMES AND A LINE OF WORDS, IN THE PERSON'S OWN TIME.
 *
 *   dayOf(ms, tz)                 "2026-10-29": the day `ms` falls on for someone `tz` minutes east of UTC
 *   startOfDay(key, tz)           when that day starts, in UTC ms
 *   timeOf("5:30 pm")             1050: minutes after midnight ("17:30" and "7:00" on a 24-hour clock, "5 pm", "noon"), or null
 *   dayFrom("fri", today)         "2026-10-30": a day said in words ("today", "kal", "next friday", "30 Oct", "30/10"), or null
 *   readLine(words, now, tz)      a line ("Dentist Friday 5 pm at Indiranagar") as what, when, how long, where, and whether it is a to-do
 *
 * India-first: "kal" is tomorrow, "parso" the day after, "5 baje" 5 o'clock, "shaam" the evening, dates day first (30/10). A bare hour
 * from 1 to 7 is in the afternoon or evening ("at 6" is 6 pm), 8 to 11 the morning, unless the words say which.
 */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** An offset that can be true: -12 h to +14 h, whole minutes (India's 330 when it can't be read). */
export const tzOf = (v: unknown, fallback = 330): number => {
  const n = typeof v === "string" && v.trim() ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(-720, Math.min(840, Math.round(n))) : fallback;
};

export const dayOf = (ms: number, tz: number): string => new Date(ms + tz * MIN).toISOString().slice(0, 10);
export const startOfDay = (key: string, tz: number): number => Date.parse(`${key}T00:00:00Z`) - tz * MIN;
export const shiftDay = (key: string, n: number): string => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const weekdayOf = (key: string): number => new Date(`${key}T00:00:00Z`).getUTCDay();
export const isDayKey = (s: unknown): s is string => typeof s === "string" && DAY_KEY.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/** Minutes after the day's midnight, in the person's time. */
export const minuteOf = (ms: number, tz: number): number => { const d = new Date(ms + tz * MIN); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** "9:30 am", "6 pm". */
export function clockWords(minute: number): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
export const clockAt = (ms: number, tz: number): string => clockWords(minuteOf(ms, tz));
/** "Thu 29 Oct". */
export function dayWords(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const weekdayLong = (key: string): string => WEEKDAYS_LONG[weekdayOf(key)]!;
/** "Today", "Tomorrow", "Thu 29 Oct". */
export function dayName(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === shiftDay(today, 1)) return "Tomorrow";
  if (key === shiftDay(today, -1)) return "Yesterday";
  return dayWords(key);
}
/** "17:30": a minute of the day as the forms keep it. */
export const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

// ------------------------------------------------------------------ a time

const PARTS: Record<string, number> = {
  morning: 9 * 60, subah: 9 * 60, afternoon: 14 * 60, dopahar: 14 * 60, evening: 18 * 60, shaam: 18 * 60, night: 20 * 60, raat: 21 * 60, tonight: 20 * 60,
  noon: 12 * 60, midday: 12 * 60, midnight: 0,
};

/** An hour said without am or pm: 1 to 7 is later in the day, 8 to 11 the morning, 12 noon. */
const guessHour = (h: number, part?: number): number => {
  if (h >= 13) return h;
  if (part !== undefined) return part >= 12 * 60 && h < 12 ? h + 12 : h === 12 && part < 12 * 60 ? 0 : h;
  return h >= 1 && h <= 7 ? h + 12 : h;
};

function clock(h: number, m: number, mer: string | undefined, part?: number): number | null {
  if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59 || h > 23) return null;
  const ampm = mer?.replace(/\./g, "").toLowerCase();
  if (ampm === "am" || ampm === "pm") {
    if (h < 1 || h > 12) return null;
    return ((ampm === "pm" ? (h % 12) + 12 : h % 12) * 60) + m;
  }
  return guessHour(h, part) * 60 + m;
}

/** "17:30", "5 pm", "5:30pm", "5.30 pm", "5", "noon", "evening": minutes after midnight, or null. */
export function timeOf(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (s in PARTS) return PARTS[s]!;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*baje)?$/.exec(s);
  if (!m) return null;
  // Hours and minutes with no am or pm ("17:30", "7:00", the forms' and the bots' way) are a 24-hour clock; a bare hour ("7") is guessed.
  if (!m[3] && m[2] !== undefined && !/baje/.test(s)) {
    const h = Number(m[1]), mm = Number(m[2]);
    return h <= 23 && mm <= 59 ? h * 60 + mm : null;
  }
  return clock(Number(m[1]), Number(m[2] ?? 0), m[3]);
}

// ------------------------------------------------------------------ a day

const WEEKDAY_WORDS: Array<[RegExp, number]> = [
  [/^sun(day)?$/, 0], [/^mon(day)?$/, 1], [/^tue(s|sday)?$/, 2], [/^wed(nesday)?$/, 3], [/^thu(r|rs|rsday)?$/, 4], [/^fri(day)?$/, 5], [/^sat(urday)?$/, 6],
];
const MONTH_WORDS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (w: string): number => MONTH_WORDS.indexOf(w.slice(0, 3).toLowerCase());
const weekdayWord = (w: string): number | null => { for (const [re, d] of WEEKDAY_WORDS) if (re.test(w)) return d; return null; };

/** The coming `weekday` from `today`: today itself when it is that day, unless `next` ("next Friday" on a Friday is a week away). */
function nextWeekday(today: string, weekday: number, next: boolean): string {
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return shiftDay(today, next && diff === 0 ? 7 : diff);
}

/** A date with no year: this year, or next when it has passed (by more than a day). */
function dateOf(day: number, month: number, today: string): string | null {
  let year = Number(today.slice(0, 4));
  const key = (y: number) => `${y}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isDayKey(key(year))) return null;
  if (key(year) < shiftDay(today, -1)) year += 1;
  return isDayKey(key(year)) ? key(year) : null;
}

/** A day in words, relative to `today` ("YYYY-MM-DD"). */
export function dayFrom(raw: unknown, today: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").replace(/^(on|by|due|this) /, "");
  if (!s) return null;
  if (isDayKey(s)) return s;
  if (/^(today|aaj|tonight)$/.test(s)) return today;
  if (/^(tomorrow|tmrw|tmr|tom|kal)$/.test(s)) return shiftDay(today, 1);
  if (/^(day after tomorrow|parso|parson)$/.test(s)) return shiftDay(today, 2);
  const nx = /^next (\w+)$/.exec(s);
  if (nx) {
    const wd = weekdayWord(nx[1]!);
    if (wd !== null) return nextWeekday(today, wd, true);
    if (nx[1] === "week") return shiftDay(today, 7);
  }
  const wd = weekdayWord(s);
  if (wd !== null) return nextWeekday(today, wd, false);
  let m = /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?: (\d{4}))?$/.exec(s);
  if (m && monthOf(m[2]!) >= 0) return m[3] ? (isDayKey(`${m[3]}-${String(monthOf(m[2]!) + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`) ? `${m[3]}-${String(monthOf(m[2]!) + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null) : dateOf(Number(m[1]), monthOf(m[2]!), today);
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
  if (m && monthOf(m[1]!) >= 0) return m[3] ? (isDayKey(`${m[3]}-${String(monthOf(m[1]!) + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`) ? `${m[3]}-${String(monthOf(m[1]!) + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null) : dateOf(Number(m[2]), monthOf(m[1]!), today);
  m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(s);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : "";
    const key = `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return y ? (isDayKey(key) ? key : null) : dateOf(Number(m[1]), Number(m[2]) - 1, today);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(s);
  if (m) {
    // "the 3rd": this month's, or next month's once it has passed.
    const d = Number(m[1]);
    for (let i = 0; i < 3; i += 1) {
      const t = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + i, d));
      if (t.getUTCDate() !== d) continue;
      const key = t.toISOString().slice(0, 10);
      if (key >= today) return key;
    }
    return null;
  }
  return null;
}

// ------------------------------------------------------------------ a line

export type Repeat = "" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export const REPEATS: readonly Repeat[] = ["", "daily", "weekdays", "weekly", "monthly", "yearly"];

export interface ReadLine {
  title: string;
  /** A day key, when one was said (or a time was said: today, or tomorrow once it has passed). */
  day?: string;
  /** The words named the day (not only a time). */
  daySaid?: boolean;
  /** Minutes after midnight. */
  time?: number;
  end?: number;
  minutes?: number;
  place?: string;
  repeat?: Repeat;
  /** "remind me", "to do", "task", "by Friday": a to-do rather than something on the calendar. */
  task: boolean;
  /** "remind me": a reminder at the time. */
  remind?: boolean;
  allDay?: boolean;
}

const DAY_RE = String.raw`(?:day after tomorrow|tomorrow|tmrw|tmr|today|tonight|aaj|kal|parso|(?:next |this )?(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?|\d{1,2}(?:st|nd|rd|th)?(?: of)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?|\d{1,2}/\d{1,2}(?:/\d{2,4})?|\d{4}-\d{2}-\d{2})`;
const TIME_RE = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)`;

/**
 * What a line of words asks for: "add dentist Friday 5 pm at Indiranagar" is { title: "Dentist", day, time: 17:00, place: "Indiranagar" }.
 * `now` and `tz` decide what "today" is; a time with no day is today, or tomorrow once it has passed.
 */
export function readLine(words: string, now: number, tz: number, o: { place?: boolean } = {}): ReadLine {
  const today = dayOf(now, tz);
  let s = ` ${words.replace(/\s+/g, " ").trim()} `;
  const out: ReadLine = { title: "", task: false };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void): void => {
    const m = re.exec(s);
    if (!m) return;
    if (fn(m) === false) return;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
  };

  // what kind of thing
  take(/^\s*(?:please\s+)?(?:remind me to|remind me|reminder to|reminder:?)\s+/i, () => { out.task = true; out.remind = true; });
  take(/^\s*(?:please\s+)?(?:add a task to|add a to-?do to|to-?do:?|task:?|to do:?)\s+/i, () => { out.task = true; });
  take(/^\s*(?:please\s+)?(?:add|put|schedule|create|new|set up|book in)\s+(?:an? )?(?:event\s+|meeting\s+)?/i, () => undefined);
  take(/\s(?:to|on|in|onto)\s+(?:my\s+)?(?:to-?dos?(?: list)?|tasks?(?: list)?)\b/i, () => { out.task = true; });
  take(/\s(?:to|on|in|onto)\s+my\s+list\s*[.!]?\s*$/i, () => { out.task = true; });
  take(/\s(?:to|on|in|onto)\s+(?:my\s+)?(?:calendar|cal)\b/i, () => undefined);
  take(/\s(?:to|on|in|onto)\s+my\s+(?:plan|day)\s*[.!]?\s*$/i, () => undefined);

  // repeats
  take(/\s(?:every ?day|daily|roz)\b/i, () => { out.repeat = "daily"; });
  take(/\s(?:every weekday|weekdays|on weekdays)\b/i, () => { out.repeat = "weekdays"; });
  take(/\severy (sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i, (m) => { out.repeat = "weekly"; out.day = dayFrom(m[1]!, today) ?? undefined; out.daySaid = !!out.day; });
  take(/\s(?:every week|weekly)\b/i, () => { out.repeat = "weekly"; });
  take(/\s(?:every month|monthly)\b/i, () => { out.repeat = "monthly"; });
  take(/\s(?:every year|yearly|annually)\b/i, () => { out.repeat = "yearly"; });
  take(/\sall[- ]day\b/i, () => { out.allDay = true; });

  // a part of the day, read first so "7 in the evening" is 7 pm
  let part: number | undefined;
  take(/\s(in the |this |kal |aaj |tomorrow |today )?(morning|afternoon|evening|night|tonight|subah|dopahar|shaam|raat)\b/i, (m) => {
    part = PARTS[m[2]!.toLowerCase()];
    const pre = (m[1] ?? "").trim().toLowerCase();
    const d = pre === "kal" || pre === "tomorrow" ? shiftDay(today, 1) : pre === "aaj" || pre === "today" || m[2]!.toLowerCase() === "tonight" ? today : null;
    if (d && !out.day) { out.day = d; out.daySaid = true; }
  });

  // a time, or a range
  take(new RegExp(String.raw`\s(?:from\s+)?(\d{1,2}(?:[:.]\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|to|till|until)\s*(\d{1,2}(?:[:.]\d{2})?)\s*(am|pm|a\.m\.|p\.m\.)(?=\s)`, "i"), (m) => {
    const [h1, m1] = m[1]!.split(/[:.]/).map(Number), [h2, m2] = m[3]!.split(/[:.]/).map(Number);
    const end = clock(h2!, m2 ?? 0, m[4]);
    let start = clock(h1!, m1 ?? 0, m[2] ?? m[4]);
    if (start !== null && end !== null && start >= end && !m[2]) start = clock(h1!, m1 ?? 0, m[4]!.toLowerCase().startsWith("p") ? "am" : "pm");
    if (start === null || end === null) return false;
    out.time = start; out.end = end > start ? end : undefined;
  });
  if (out.time === undefined) {
    take(new RegExp(String.raw`\s(?:at\s+|@\s*|by\s+)?(${TIME_RE})(?=[\s,.!])`, "i"), (m) => {
      const t = timeOf(m[1]!);
      if (t === null) return false;
      out.time = t;
    });
  }
  if (out.time === undefined) {
    take(/\s(?:at\s+|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*baje\b/i, (m) => { const t = clock(Number(m[1]), Number(m[2] ?? 0), undefined, part); if (t === null) return false; out.time = t; });
  }
  if (out.time === undefined) {
    take(/\s(?:at\s+|@\s*)(\d{1,2})(?:[:.](\d{2}))?(?=[\s,.!])(?!\s*(?:min|mins|minutes|h|hr|hrs|hours?|st|nd|rd|th|people|km)\b)/i, (m) => {
      const t = clock(Number(m[1]), Number(m[2] ?? 0), undefined, part); if (t === null) return false; out.time = t;
    });
  }
  if (out.time === undefined) {
    take(/\s(\d{1,2})[:](\d{2})(?=[\s,.!])/i, (m) => { const t = clock(Number(m[1]), Number(m[2]), undefined, part); if (t === null) return false; out.time = t; });
  }
  if (out.time === undefined && part !== undefined) out.time = part;

  // how long
  take(/\sfor\s+(?:an?|one)\s+hour\b/i, () => { out.minutes = 60; });
  take(/\sfor\s+half an? hour\b/i, () => { out.minutes = 30; });
  take(/\sfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes)\b/i, (m) => {
    const n = Number(m[1]);
    out.minutes = Math.round(/^h/i.test(m[2]!) ? n * 60 : n);
  });

  // a day
  if (!out.day) {
    take(new RegExp(String.raw`\s(?:(on|by|due|before)\s+)?(${DAY_RE})(?=[\s,.!])`, "i"), (m) => {
      const d = dayFrom(m[2]!, today);
      if (!d) return false;
      out.day = d;
      out.daySaid = true;
      if (m[1] && /by|due|before/i.test(m[1]) && out.time === undefined) out.task = true;
    });
  }

  // a place: "at Indiranagar", "in Koramangala" (words that start with a capital), what is left after the day and the time
  if (o.place !== false) take(/\s(?:at|in|@)\s+((?:[A-Z][\w'’.&-]*)(?:\s+(?:[A-Z][\w'’.&-]*|of|the|and|&)){0,4})(?=[\s,.!]|$)/, (m) => {
    const p = m[1]!.replace(/\s+(?:of|the|and|&)$/i, "").trim();
    if (!p || /^(?:I|AM|PM)$/.test(p)) return false;
    out.place = p;
  });

  if (out.time !== undefined && !out.day) out.day = out.time > minuteOf(now, tz) ? today : shiftDay(today, 1);
  if (out.repeat && !out.day) out.day = today;
  if (!out.task && out.time === undefined && !out.allDay) out.task = true;
  if (out.allDay) { out.time = undefined; out.end = undefined; }

  const title = s.replace(/\s+/g, " ").trim()
    .replace(/^(?:to|and|then|on|at|for|by)\s+/i, "")
    .replace(/\s+(?:on|at|for|by|from|in|and|,)$/i, "")
    .replace(/^[,;:.\-–\s]+|[,;:\-–\s]+$/g, "")
    .trim();
  out.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : "";
  return out;
}
