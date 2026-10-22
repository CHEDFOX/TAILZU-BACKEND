/**
 * GOOGLE CALENDAR, as a native connector: plain fetch to Calendar API v3.
 *
 *   list_events      read         events in a time range (default today)
 *   find_free_time   read         gaps in the working day, from free/busy
 *   create_event     write, or send when it has guests (Google emails them)
 *   move_event       write, or send when the event has guests
 *   delete_event     destructive
 *
 * Times go in as the person says them ("friday 10:00", "tomorrow 3pm") and are
 * read in their own zone: the `timezone` argument if the request has one, else
 * the zone set on their Google calendar. Results are sentences ("Friday
 * 10:00–10:30, Design sync, with Rahul"), each event with its id so a later
 * move or delete can name it.
 */
import { RESULT_MAX, type CallOutcome } from "../client.js";
import type { Args, NativeConnector, NativeTool } from "../native.js";
import { ConnectorError } from "../oauth.js";
import type { Risk } from "../risk.js";
import type { GoogleSession } from "./oauth.js";
import { DAY, MIN, allDayWords, atWall, dateOf, dayStart, dayWord, parseWhen, rangeWords, rfc3339, validZone, wallOf, type When } from "./time.js";

const API = "https://www.googleapis.com/calendar/v3";
const PRIMARY = `${API}/calendars/primary`;
const ID = "google-calendar";
const APP = "Google Calendar";
const EMAIL = /^[^\s@<>,;"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;
const MAX_RANGE_DAYS = 62;
const MAX_FREE_DAYS = 14;
const ZONE_CACHE_MS = 60 * MIN;

interface Attendee { email?: string; displayName?: string; self?: boolean; resource?: boolean }
interface EventTime { date?: string; dateTime?: string; timeZone?: string }
interface GEvent {
  id: string; summary?: string; status?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  attendees?: Attendee[];
}

const TOOLS: NativeTool[] = [
  {
    name: "list_events", risk: "read",
    description: "List the events on the person's Google Calendar in a time range. With no range it is today. Each event comes back with its id.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start: a day or time as they said it (\"today\", \"tomorrow\", \"friday\", \"30 oct\", \"friday 3pm\") or ISO. Default today." },
        to: { type: "string", description: "End of the range, same forms; a day means through the end of that day. Default the end of `from`'s day." },
        max: { type: "number", description: "Most events to return (default 10, at most 25)." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place. Default: their calendar's own." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "find_free_time", risk: "read",
    description: "Find free slots in the person's Google Calendar, inside their working day. With no range it is the rest of today.",
    inputSchema: {
      type: "object",
      properties: {
        duration_minutes: { type: "number", description: "How long the slot must be (default 30)." },
        from: { type: "string", description: "Start day or time (\"tomorrow\", \"monday\", \"friday 2pm\"). Default now." },
        to: { type: "string", description: "End day or time; a day means through that day. Default the end of `from`'s day." },
        earliest: { type: "string", description: "Working day starts (default 09:00)." },
        latest: { type: "string", description: "Working day ends (default 18:00)." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_event", risk: "write",
    description: "Add an event to the person's Google Calendar. With attendees, Google emails each of them an invite. Use only the details they gave; ask for a missing title or time.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "When it starts, as they said it (\"friday 10:00\", \"tomorrow 3pm\") or ISO. A day alone makes an all-day event." },
        end: { type: "string", description: "When it ends, same forms. Default start plus duration_minutes." },
        duration_minutes: { type: "number", description: "Default 30." },
        timezone: { type: "string", description: "IANA zone, only if the person named a place." },
        description: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Email addresses to invite. Only addresses the person gave." },
      },
      required: ["title", "start"],
    },
    annotations: {},
  },
  {
    name: "move_event", risk: "write",
    description: "Move an existing Google Calendar event to a new time, keeping its length unless an end is given. If it has attendees, Google tells them.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "The id from list_events." },
        start: { type: "string", description: "The new start, as they said it or ISO." },
        end: { type: "string", description: "The new end. Default: same length as before." },
        timezone: { type: "string" },
      },
      required: ["event_id", "start"],
    },
    annotations: {},
  },
  {
    name: "delete_event", risk: "destructive",
    description: "Delete an event from the person's Google Calendar. If it has attendees, Google tells them it is cancelled.",
    inputSchema: { type: "object", properties: { event_id: { type: "string", description: "The id from list_events." } }, required: ["event_id"] },
    annotations: { destructiveHint: true },
  },
];

const reject = (message: string) => new ConnectorError("rejected", message);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
const oneLine = (s: string | undefined, max = 80) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim() || "(no title)";
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};
const cut = (s: string) => (s.length > RESULT_MAX ? s.slice(0, RESULT_MAX).trimEnd() + "…" : s);

/** "Rahul", or "rahul.sharma@x.com" -> "Rahul Sharma". */
function nameOf(a: Attendee): string {
  if (a.displayName?.trim()) return a.displayName.trim();
  const local = (a.email ?? "").split("@")[0] ?? "";
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || "a guest";
}
const guests = (e: GEvent) => (e.attendees ?? []).filter((a) => !a.self && !a.resource);
function withWords(e: GEvent): string {
  const g = guests(e).map(nameOf);
  if (!g.length) return "";
  return ` with ${g.length > 3 ? `${g.slice(0, 3).join(", ")} and ${g.length - 3} more` : g.length > 1 ? `${g.slice(0, -1).join(", ")} and ${g.at(-1)}` : g[0]}`;
}

export interface CalendarOptions { session: GoogleSession; now?: () => number }

export function googleCalendar(o: CalendarOptions): NativeConnector {
  const now = () => (o.now ?? Date.now)();
  const zones = new Map<string, { tz: string; at: number }>();
  const get = <T = any>(userId: string, url: string, notFound?: string) => o.session.json<T>(userId, ID, APP, url, { notFound });

  /** The zone times are read and said in: the request's, else the one on their Google calendar. */
  async function zoneFor(userId: string, args: Args): Promise<string> {
    const asked = validZone(args.timezone);
    if (asked) return asked;
    const hit = zones.get(userId);
    if (hit && now() - hit.at < ZONE_CACHE_MS) return hit.tz;
    const s = await get<{ value?: string }>(userId, `${API}/users/me/settings/timezone`);
    const tz = validZone(s.value) ?? "UTC";
    zones.set(userId, { tz, at: now() });
    return tz;
  }

  const when = (v: unknown, tz: string, what: string): When => {
    const w = parseWhen(v, tz, now());
    if (!w) throw reject(`I couldn't read ${what} "${String(v).slice(0, 40)}" as a time. Try something like "friday 10:00" or "tomorrow 3pm".`);
    return w;
  };

  const eventUrl = (id: unknown) => {
    const s = typeof id === "string" ? id.trim() : "";
    if (!EVENT_ID.test(s)) throw reject("I need the id of the event, from looking at the calendar first.");
    return `${PRIMARY}/events/${encodeURIComponent(s)}`;
  };
  const fetchEvent = (userId: string, id: unknown) =>
    get<GEvent>(userId, `${eventUrl(id)}?fields=id,summary,status,start,end,attendees(email,displayName,self,resource)`, "I couldn't find that event.");

  /** An event's start and end as instants, whether timed or all-day. */
  function span(e: GEvent, tz: string): { start: number; end: number; allDay: boolean } {
    if (e.start?.dateTime) return { start: Date.parse(e.start.dateTime), end: Date.parse(e.end?.dateTime ?? e.start.dateTime), allDay: false };
    const [y, m, d] = (e.start?.date ?? "1970-01-01").split("-").map(Number) as [number, number, number];
    const [y2, m2, d2] = (e.end?.date ?? e.start?.date ?? "1970-01-01").split("-").map(Number) as [number, number, number];
    return { start: atWall(y, m, d, 0, 0, tz), end: atWall(y2, m2, d2, 0, 0, tz), allDay: true };
  }
  function whenWords(e: GEvent, tz: string): string {
    const s = span(e, tz);
    return s.allDay ? allDayWords(e.start?.date ?? "", tz, now()) : rangeWords(s.start, s.end, tz, now());
  }

  /** "Friday 10:00–10:30", or "Friday, all day". */
  const atWords = (start: When, endMs: number, tz: string) =>
    start.dateOnly ? `${dayWord(start.ms, tz, now())}, all day` : rangeWords(start.ms, endMs, tz, now());

  /** start/end fields for a write: all-day when only days were given, else timed in `tz`. */
  function timeFields(start: When, endMs: number, endIsDay: boolean, tz: string): { start: EventTime; end: EventTime } {
    if (start.dateOnly) {
      const endDay = endIsDay ? endMs : dayStart(start.ms, tz, 1);
      return { start: { date: dateOf(start.ms, tz) }, end: { date: dateOf(Math.max(endDay, dayStart(start.ms, tz, 1)), tz) } };
    }
    return { start: { dateTime: rfc3339(start.ms, tz), timeZone: tz }, end: { dateTime: rfc3339(endMs, tz), timeZone: tz } };
  }

  /** A start and end from the arguments. */
  function window(args: Args, tz: string): { start: When; endMs: number; endIsDay: boolean } {
    const start = when(args.start, tz, "the start");
    if (args.end !== undefined && args.end !== null && args.end !== "") {
      const end = when(args.end, tz, "the end");
      // An all-day event "through friday" ends at the end of that day.
      const endMs = end.dateOnly ? dayStart(end.ms, tz, 1) : end.ms;
      if (endMs <= start.ms) throw reject("That ends before it starts.");
      return { start, endMs, endIsDay: end.dateOnly };
    }
    const minutes = clampInt(args.duration_minutes, 5, 24 * 60, 30);
    return { start, endMs: start.ms + minutes * MIN, endIsDay: false };
  }

  function emails(v: unknown): string[] {
    const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/) : [];
    const out: string[] = [];
    for (const raw of list) {
      const e = typeof raw === "string" ? raw.trim() : "";
      if (!e) continue;
      if (!EMAIL.test(e)) throw reject(`"${e.slice(0, 60)}" doesn't look like an email address. Who should I invite?`);
      if (!out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
    }
    if (out.length > 20) throw reject("That's more guests than I can invite at once.");
    return out;
  }

  async function listEvents(userId: string, args: Args): Promise<CallOutcome> {
    const tz = await zoneFor(userId, args);
    const from = args.from ? when(args.from, tz, "the start") : { ms: dayStart(now(), tz), dateOnly: true };
    const to = args.to ? when(args.to, tz, "the end") : null;
    const fromMs = from.ms;
    const toMs = to ? (to.dateOnly ? dayStart(to.ms, tz, 1) : to.ms) : from.dateOnly ? dayStart(from.ms, tz, 1) : from.ms + DAY;
    if (toMs <= fromMs) throw reject("The end of that range is before its start.");
    if (toMs - fromMs > MAX_RANGE_DAYS * DAY) throw reject("That's too long a stretch to read out. Ask for a month at most.");
    const max = clampInt(args.max, 1, 25, 10);
    const q = new URLSearchParams({
      singleEvents: "true", orderBy: "startTime", maxResults: String(max), timeZone: tz,
      timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(),
      fields: "items(id,summary,status,start,end,attendees(email,displayName,self,resource))",
    });
    const res = await get<{ items?: GEvent[] }>(userId, `${PRIMARY}/events?${q}`);
    const items = (res.items ?? []).filter((e) => e.status !== "cancelled");
    const label = spanWords(fromMs, toMs, tz);
    if (!items.length) return ok(`Nothing on your calendar ${label}.`);
    const lines = items.map((e) => `- ${whenWords(e, tz)}, ${oneLine(e.summary)}${withWords(e)} (id: ${e.id})`);
    return ok(cut(`${items.length} ${items.length === 1 ? "event" : "events"} ${label}:\n${lines.join("\n")}`));
  }

  /** "today", "tomorrow", "on Friday", or "from Fri 23 Oct to Sun 25 Oct". */
  function spanWords(fromMs: number, toMs: number, tz: string): string {
    if (dayStart(fromMs, tz, 1) >= toMs - 1000 && dayStart(fromMs, tz) <= fromMs) {
      const w = dayWord(fromMs, tz, now());
      return /^(Today|Tomorrow|Yesterday)$/.test(w) ? w.toLowerCase() : `on ${w}`;
    }
    return `from ${dayWord(fromMs, tz, now())} to ${dayWord(toMs - 1, tz, now())}`;
  }

  async function findFreeTime(userId: string, args: Args): Promise<CallOutcome> {
    const tz = await zoneFor(userId, args);
    const minutes = clampInt(args.duration_minutes, 5, 8 * 60, 30);
    const from = args.from ? when(args.from, tz, "the start") : { ms: now(), dateOnly: false };
    const to = args.to ? when(args.to, tz, "the end") : null;
    // Never a slot that has already gone.
    const startMs = Math.max(from.ms, now());
    const endMs = to ? (to.dateOnly ? dayStart(to.ms, tz, 1) : to.ms) : dayStart(from.ms, tz, 1);
    if (endMs <= startMs) throw reject("The end of that range is before its start.");
    if (endMs - startMs > MAX_FREE_DAYS * DAY) throw reject("That's too long a stretch to search. Ask for two weeks at most.");
    const open = hm(args.earliest, 9 * 60), close = hm(args.latest, 18 * 60);
    if (close - open < minutes) throw reject("The working day is shorter than the slot you asked for.");

    const fb = await o.session.json<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(userId, ID, APP, `${API}/freeBusy`, {
      method: "POST",
      body: { timeMin: new Date(startMs).toISOString(), timeMax: new Date(endMs).toISOString(), timeZone: tz, items: [{ id: "primary" }] },
    });
    const busy = (fb.calendars?.primary?.busy ?? [])
      .map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
      .sort((a, b) => a[0] - b[0]);

    const slots: Array<[number, number]> = [];
    for (let day = dayStart(startMs, tz); day < endMs && slots.length < 5; day = dayStart(day, tz, 1)) {
      const w = wallOf(day, tz);
      const lo = Math.max(atWall(w.y, w.mo, w.d, 0, open, tz), startMs);
      const hi = Math.min(atWall(w.y, w.mo, w.d, 0, close, tz), endMs);
      let cursor = lo;
      for (const [bs, be] of busy) {
        if (be <= cursor) continue;
        if (bs >= hi) break;
        if (bs - cursor >= minutes * MIN) slots.push([cursor, bs]);
        cursor = Math.max(cursor, be);
      }
      if (hi - cursor >= minutes * MIN) slots.push([cursor, hi]);
    }
    const label = spanWords(startMs, endMs, tz);
    if (!slots.length) return ok(`You have no free ${minutes}-minute slot ${label}, between ${clockHm(open)} and ${clockHm(close)}.`);
    const lines = slots.slice(0, 5).map(([a, b]) => `- ${rangeWords(round5(a), b, tz, now())}`);
    return ok(cut(`Free for ${minutes} minutes or more ${label}:\n${lines.join("\n")}`));
  }

  async function createEvent(userId: string, args: Args): Promise<CallOutcome> {
    const title = str(args.title, 200);
    if (!title) throw reject("What should I call the event?");
    const tz = await zoneFor(userId, args);
    const { start, endMs, endIsDay } = window(args, tz);
    const guestList = emails(args.attendees);
    const description = str(args.description, 4000);
    const q = new URLSearchParams({ sendUpdates: guestList.length ? "all" : "none" });
    const e = await o.session.json<GEvent>(userId, ID, APP, `${PRIMARY}/events?${q}`, {
      method: "POST",
      body: {
        summary: title, ...(description ? { description } : {}),
        ...timeFields(start, endMs, endIsDay, tz),
        ...(guestList.length ? { attendees: guestList.map((email) => ({ email })) } : {}),
      },
    });
    const who = guestList.length ? ` with ${guestList.map((g) => nameOf({ email: g })).join(", ")}. Google emailed them the invite` : "";
    return ok(`Added "${oneLine(title)}" for ${atWords(start, endMs, tz)}${who}. (id: ${e.id})`);
  }

  async function moveEvent(userId: string, args: Args): Promise<CallOutcome> {
    const tz = await zoneFor(userId, args);
    const cur = await fetchEvent(userId, args.event_id);
    const old = span(cur, tz);
    const start = when(args.start, tz, "the new start");
    let endMs: number, endIsDay = false;
    if (args.end !== undefined && args.end !== null && args.end !== "") {
      const end = when(args.end, tz, "the new end");
      endMs = end.dateOnly ? dayStart(end.ms, tz, 1) : end.ms;
      endIsDay = end.dateOnly;
    } else {
      endMs = start.ms + (old.end - old.start);
    }
    if (endMs <= start.ms) throw reject("That ends before it starts.");
    const others = guests(cur).length > 0;
    const q = new URLSearchParams({ sendUpdates: others ? "all" : "none" });
    await o.session.json<GEvent>(userId, ID, APP, `${eventUrl(args.event_id)}?${q}`, { method: "PATCH", body: timeFields(start, endMs, endIsDay, tz), notFound: "I couldn't find that event." });
    return ok(`Moved "${oneLine(cur.summary)}" to ${atWords(start, endMs, tz)}${others ? `. Google told ${guests(cur).map(nameOf).join(", ")}` : ""}.`);
  }

  async function deleteEvent(userId: string, args: Args): Promise<CallOutcome> {
    const tz = await zoneFor(userId, args);
    const cur = await fetchEvent(userId, args.event_id);
    const others = guests(cur).length > 0;
    const q = new URLSearchParams({ sendUpdates: others ? "all" : "none" });
    await o.session.json(userId, ID, APP, `${eventUrl(args.event_id)}?${q}`, { method: "DELETE", notFound: "I couldn't find that event." });
    return ok(`Deleted "${oneLine(cur.summary)}" (${whenWords(cur, tz)})${others ? `. Google told ${guests(cur).map(nameOf).join(", ")} it's cancelled` : ""}.`);
  }

  return {
    tools: () => TOOLS,

    async riskOf(userId, tool, args): Promise<Risk | undefined> {
      if (tool === "create_event") return emails(args.attendees).length ? "send" : "write";
      if (tool === "move_event") return guests(await fetchEvent(userId, args.event_id)).length ? "send" : "write";
      return undefined;
    },

    /** The confirm card: what exactly, and who Google will email. */
    async preview(userId, tool, args): Promise<string | undefined> {
      const tz = await zoneFor(userId, args);
      if (tool === "create_event") {
        const { start, endMs } = window(args, tz);
        const g = emails(args.attendees);
        return `Add "${oneLine(str(args.title, 200))}" to ${APP}: ${atWords(start, endMs, tz)}${g.length ? `. Google will email an invite to ${g.join(", ")}` : ""}`;
      }
      if (tool === "move_event") {
        const cur = await fetchEvent(userId, args.event_id);
        const start = when(args.start, tz, "the new start");
        const old = span(cur, tz);
        const endMs = args.end ? (when(args.end, tz, "the new end").ms) : start.ms + (old.end - old.start);
        const g = guests(cur);
        return `Move "${oneLine(cur.summary)}" (${whenWords(cur, tz)}) to ${atWords(start, endMs, tz)}${g.length ? `. Google will tell ${g.map(nameOf).join(", ")}` : ""}`;
      }
      if (tool === "delete_event") {
        const cur = await fetchEvent(userId, args.event_id);
        const g = guests(cur);
        return `Delete "${oneLine(cur.summary)}" (${whenWords(cur, tz)}) from ${APP}${g.length ? `. Google will tell ${g.map(nameOf).join(", ")} it's cancelled` : ""}`;
      }
      return undefined;
    },

    async call(userId, tool, args): Promise<CallOutcome> {
      switch (tool) {
        case "list_events": return listEvents(userId, args);
        case "find_free_time": return findFreeTime(userId, args);
        case "create_event": return createEvent(userId, args);
        case "move_event": return moveEvent(userId, args);
        case "delete_event": return deleteEvent(userId, args);
        default: throw reject(`${APP} doesn't have an action called ${tool.slice(0, 40)}.`);
      }
    },
  };
}

const ok = (text: string): CallOutcome => ({ ok: true, text });

/** "09:00" / "9am" -> minutes after midnight; `dflt` when it is not a time. */
function hm(v: unknown, dflt: number): number {
  const m = typeof v === "string" ? /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(v) : null;
  if (!m) return dflt;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (m[3]) { if (h < 1 || h > 12) return dflt; h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0); }
  return h > 24 || mi > 59 ? dflt : h * 60 + mi;
}
const clockHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** A slot that starts "now" starts on the next five minutes, not at 10:03:41. */
const round5 = (ms: number) => Math.ceil(ms / (5 * MIN)) * 5 * MIN;

