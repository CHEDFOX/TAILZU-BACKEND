/**
 * A WORK CALENDAR'S FILE, READ (docs/plan-ease.md "The work calendar"; design B6). Google's secret address, Outlook's published link and
 * iCloud's public link all answer an iCalendar file; this turns one into the starts it holds between two times, repeats expanded.
 *
 *   readIcs(text, { fromMs, toMs, tz })   every start in the window: { uid, ref, start, end, allDay, title, place, busy, people }
 *   providerOf(url)                       google | outlook | icloud | other, from the host
 *   hintOf(url)                           what a screen may show of the address ("calendar.google.com/…a91f")
 *
 * The iCalendar library (ical.js, MPL-2.0: THIRD_PARTY_NOTICES.md) does the repeats: their rules, the days taken out of them (EXDATE),
 * the single starts moved or renamed (RECURRENCE-ID) and the file's own time zones (VTIMEZONE). A time zone named but not given in the
 * file (Google often names "Asia/Kolkata" and leaves it out) is the world's one by that name; a time with no zone at all is the person's.
 *
 * Kept from each meeting: its title, its place, its times, whether it holds the time (TRANSP:TRANSPARENT does not), and how many people
 * are asked (a count only). Never the attendees' addresses, never the description, where call links and passcodes live, and never a
 * call link or passcode in the place either (placeOf: "Online"). A cancelled one
 * is dropped. Google's file holds every meeting a person ever had, so a meeting that does not repeat and is outside the window is left
 * out before the file is read in full.
 *
 * Pure: no network, no store.
 */
import { createHash } from "node:crypto";
import ICAL from "ical.js";

const MIN = 60_000, DAY = 24 * 60 * MIN;
/** At most this many starts from one file (the mirror keeps 3,000 a link). */
export const ICS_MAX = 3000;
/** A repeat is walked at most this many steps in all (a daily one since 2010 is a few thousand). */
const STEPS_MAX = 60_000;

export interface IcsStart {
  uid: string;
  /** Its id on the person's days: the same meeting keeps it when it moves (uid and which start of a series it is). */
  ref: string;
  start: number;
  end: number;
  allDay: boolean;
  title: string;
  place: string;
  /** Whether it holds the time (a "free" one doesn't, and is never a clash). */
  busy: boolean;
  /** How many people are asked, the person among them. */
  people: number;
}

const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A video call's own names: a place that holds one of these (or a link, or a passcode) is a call. */
const VIDEO = /\b(?:zoom|zoom\.us|microsoft teams|teams|google meet|meet\.google\.com|gmeet|webex|skype|gotomeeting|hangouts?|whereby|jitsi|online|virtual|video call)\b/gi;
/** What is left of a call's place once its name and link are out: filler, not a place. */
const FILLER = /\b(?:join(?: the)?(?: meeting)?|meeting|meet|click here|call|link)\b/gi;
const LINK = /(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:zoom\.us|webex\.com|teams\.microsoft\.com|meet\.google\.com|gotomeeting\.com)\S*/gi;
/** "Passcode: 991", "Meeting ID 812 3344 5566", "pwd=…", "PIN #12": what lets anyone into the call. */
const CREDENTIAL = /\b(?:pass\s?code|password|pwd|pin|meeting\s?id|conference\s?id|access\s?code|webinar\s?id|id)\b\s*[:#=]?\s*[\w-]+(?:\s+\d[\d\s-]*)?/gi;

/**
 * A meeting's place as kept: a join link and its passcode are never kept (they would ride into the chat's context, a screen, a push).
 * What is left of a real place stays ("Room 4B" of "Room 4B; https://zoom.us/j/…?pwd=…"); a place that was only a call is "Online".
 */
export function placeOf(location: unknown): string {
  const raw = clean(location, 600);
  if (!raw) return "";
  LINK.lastIndex = 0; CREDENTIAL.lastIndex = 0; VIDEO.lastIndex = 0; FILLER.lastIndex = 0;
  const online = LINK.test(raw) || CREDENTIAL.test(raw) || VIDEO.test(raw);
  if (!online) return raw.slice(0, 160);
  const left = raw.replace(LINK, " ").replace(CREDENTIAL, " ").replace(VIDEO, " ").replace(FILLER, " ")
    .replace(/\s+([,;:])/g, "$1").replace(/([,;:|·/-])(?:\s*[,;:|·/-])+/g, "$1").replace(/^[\s,;:|·()/-]+|[\s,;:|·()/-]+$/g, "").replace(/\s{2,}/g, " ").trim();
  return /[A-Za-z\u0900-\u0DFF]{2,}/.test(left) ? left.slice(0, 160) : "Online";
}

/** The meeting's id on the person's days, from the link, its uid and which start it is: short, and safe in a path and an item. */
export function refOf(linkId: string, uid: string, which: string): string {
  return `wk-${createHash("sha256").update(`${linkId}|${uid}|${which}`).digest("base64url").slice(0, 22)}`;
}

// ------------------------------------------------------------------ time zones the file names but doesn't give

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>();
function zoneFormat(tzid: string): Intl.DateTimeFormat | null {
  if (zoneFormats.has(tzid)) return zoneFormats.get(tzid)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tzid, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { f = null; }
  if (zoneFormats.size > 200) zoneFormats.clear();
  zoneFormats.set(tzid, f);
  return f;
}

/** The zone's offset from UTC at an instant, in minutes. */
function offsetAt(f: Intl.DateTimeFormat, ms: number): number {
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((wall - ms) / MIN);
}

/** A wall-clock time in a named zone as UTC ms (twice round, for the hour a clock change moves). */
function wallToUtc(wall: number, f: Intl.DateTimeFormat): number {
  let at = wall - offsetAt(f, wall) * MIN;
  at = wall - offsetAt(f, at) * MIN;
  return at;
}

interface TimeLike { year: number; month: number; day: number; hour: number; minute: number; second: number; isDate: boolean; zone?: { tzid?: string } | null; toJSDate(): Date }

/** An iCalendar time as UTC ms: its own zone when the file gave it; else the named one; else the person's. */
function msOf(t: TimeLike, tzid: string | null, personTz: number): number {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const zone = t.zone?.tzid ?? "";
  if (zone === "UTC" || zone === "Z") return wall;
  if (zone && zone !== "floating") return t.toJSDate().getTime();
  const f = tzid ? zoneFormat(tzid) : null;
  return f ? wallToUtc(wall, f) : wall - personTz * MIN;
}

// ------------------------------------------------------------------ cheap look before the full read

/** DTSTART's day as a number (YYYYMMDD), from one VEVENT's lines, or null. */
function startDayOf(block: string): number | null {
  const m = /\nDTSTART[^:\n]*:(\d{8})/.exec(block);
  return m ? Number(m[1]) : null;
}
const dayNum = (ms: number): number => Number(new Date(ms).toISOString().slice(0, 10).replace(/-/g, ""));

/**
 * The file with only what can be in the window: its time zones, every meeting that repeats or moves a start of one, and the single
 * meetings whose day is near the window. A huge file is cut down here before the full read.
 */
export function narrow(text: string, fromMs: number, toMs: number): string {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const lo = dayNum(fromMs - 2 * DAY), hi = dayNum(toMs + 2 * DAY);
  const head = unfolded.slice(0, Math.max(0, unfolded.indexOf("BEGIN:VEVENT")));
  const zones = unfolded.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\n?/g) ?? [];
  const kept: string[] = [];
  const re = /BEGIN:VEVENT\n[\s\S]*?END:VEVENT\n?/g;
  for (let m = re.exec(unfolded); m; m = re.exec(unfolded)) {
    const block = `\n${m[0]}`;
    if (/\n(?:RRULE|RDATE|RECURRENCE-ID)[;:]/.test(block)) { kept.push(m[0]); continue; }
    if (/\nSTATUS:CANCELLED/i.test(block)) continue;
    const d = startDayOf(block);
    if (d !== null && d >= lo && d <= hi) kept.push(m[0]);
  }
  const begin = head.includes("BEGIN:VCALENDAR") ? head.replace(/BEGIN:VTIMEZONE[\s\S]*$/, "") : "BEGIN:VCALENDAR\nVERSION:2.0\n";
  return `${begin.trimEnd()}\n${zones.join("")}${kept.join("")}END:VCALENDAR\n`;
}

// ------------------------------------------------------------------ the read

interface EventLike {
  uid: string; summary: string; location: string;
  startDate: TimeLike; endDate: TimeLike;
  component: { getFirstPropertyValue(n: string): unknown; getAllProperties(n: string): unknown[]; getFirstProperty(n: string): { getParameter(p: string): unknown } | null };
  isRecurring(): boolean; isRecurrenceException(): boolean;
  relateException(e: unknown): void;
  iterator(): { next(): TimeLike | null | undefined };
  getOccurrenceDetails(t: TimeLike): { startDate: TimeLike; endDate: TimeLike; recurrenceId: { toString(): string }; item: EventLike };
}

/** Every start in the window, sorted, ICS_MAX at most. Throws on a file that isn't iCalendar at all. */
export function readIcs(text: string, o: { fromMs: number; toMs: number; tz: number; linkId: string }): IcsStart[] {
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) throw new Error("not_ics");
  const comp = new ICAL.Component(ICAL.parse(narrow(text, o.fromMs, o.toMs)));
  for (const z of comp.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(z); } catch { /* a zone it can't read: its times fall back to the named zone */ }
  }
  const masters = new Map<string, EventLike>();
  const moved: EventLike[] = [];
  for (const v of comp.getAllSubcomponents("vevent")) {
    let e: EventLike;
    try { e = new ICAL.Event(v) as unknown as EventLike; } catch { continue; }
    if (!e.uid) continue;
    if (e.isRecurrenceException()) moved.push(e); else masters.set(e.uid, e);
  }
  for (const e of moved) {
    const m = masters.get(e.uid);
    if (m) { try { m.relateException(e); } catch { /* the moved start is read as a meeting of its own below */ } } else masters.set(`${e.uid}#${moved.indexOf(e)}`, e);
  }

  const out: IcsStart[] = [];
  let steps = 0;
  const add = (e: EventLike, item: EventLike, s: TimeLike, en: TimeLike | null, which: string) => {
    if (String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    const tzid = (p: string) => { const v = item.component.getFirstProperty(p)?.getParameter("tzid"); return typeof v === "string" ? v : null; };
    const allDay = s.isDate;
    const start = allDay ? Date.UTC(s.year, s.month - 1, s.day) : msOf(s, tzid("dtstart"), o.tz);
    let end = en ? (en.isDate ? Date.UTC(en.year, en.month - 1, en.day) : msOf(en, tzid("dtend") ?? tzid("dtstart"), o.tz)) : start + (allDay ? DAY : 0);
    if (!(end > start)) end = start + (allDay ? DAY : 0);
    // An all-day one is its date at UTC midnight (as the own calendar keeps one): its window is checked as the person's day.
    const at = allDay ? start - o.tz * MIN : start, until = allDay ? end - o.tz * MIN : end;
    if (until <= o.fromMs || at >= o.toMs) return;
    out.push({
      uid: e.uid, ref: refOf(o.linkId, e.uid, which), start, end, allDay,
      title: clean(item.summary, 120) || "Busy", place: placeOf(item.location),
      busy: String(item.component.getFirstPropertyValue("transp") ?? "").toUpperCase() !== "TRANSPARENT",
      people: Math.min(1000, item.component.getAllProperties("attendee").length),
    });
  };

  for (const e of masters.values()) {
    if (out.length >= ICS_MAX || steps > STEPS_MAX) break;
    try {
      if (!e.isRecurring()) {
        // A moved start whose series isn't in the file: which start it was keeps its id apart from the others.
        const which = e.isRecurrenceException() ? String(e.component.getFirstPropertyValue("recurrence-id") ?? "one") : "one";
        add(e, e, e.startDate, e.endDate, which);
        continue;
      }
      const it = e.iterator();
      for (let t = it.next(); t && steps <= STEPS_MAX && out.length < ICS_MAX; t = it.next()) {
        steps += 1;
        const d = e.getOccurrenceDetails(t);
        const s = msOf(d.startDate, null, o.tz);
        if (s - 2 * DAY > o.toMs && msOf(t, null, o.tz) - 2 * DAY > o.toMs) break;
        add(e, d.item, d.startDate, d.endDate, d.recurrenceId.toString());
      }
    } catch { /* one meeting it can't read is left out; the rest stand */ }
  }
  return out.sort((a, b) => a.start - b.start || a.ref.localeCompare(b.ref)).slice(0, ICS_MAX);
}

// ------------------------------------------------------------------ the address

/** Which calendar it is, from the host. */
export function providerOf(url: string): "google" | "outlook" | "icloud" | "other" {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "other"; }
  if (host === "calendar.google.com" || host.endsWith(".calendar.google.com")) return "google";
  if (host === "outlook.office365.com" || host === "outlook.live.com" || host === "outlook.office.com" || host.endsWith(".outlook.com")) return "outlook";
  if (host === "icloud.com" || host.endsWith(".icloud.com")) return "icloud";
  return "other";
}

/** "calendar.google.com/…a91f": enough to tell two apart, never enough to read one. */
export function hintOf(url: string): string {
  try {
    const u = new URL(url);
    const tail = createHash("sha256").update(url).digest("hex").slice(0, 4);
    return `${u.hostname.slice(0, 60)}/…${tail}`;
  } catch { return "a calendar"; }
}

/** A link as pasted, as the https address it is read at: webcal:// is https://, spaces and quotes taken off. Null when it isn't one. */
export function linkOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^[<"'(\s]+|[>"')\s]+$/g, "");
  if (!s || s.length > 2048) return null;
  const https = s.replace(/^webcals?:\/\//i, "https://");
  try {
    const u = new URL(https);
    return u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}
