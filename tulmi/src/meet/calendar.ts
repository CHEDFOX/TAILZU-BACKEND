/**
 * THE MEETING BOT'S AUTO-JOIN (docs/meet.md): it reads each person's Google Calendar and sends a bot to the meetings that have a link.
 *
 *   googleEvents(session)    the events of the primary calendar with a meeting link (an EventSource)
 *   autoJoinSweep(deps)      one pass over everyone with auto-join on: bots for the meetings 11 to 45 minutes away, and the bot of a calendar
 *                            meeting whose event was deleted, moved or declined called off
 *   startAutoJoin(deps, ms)  the sweep on a timer (every five minutes), which never throws; returns the function that stops it
 *
 * Why 11 minutes: Recall keeps a bot for a meeting asked for more than ten minutes ahead, so a later ask would be a bot that may not come.
 * Why 45: the sweep runs every five minutes, so each meeting is seen several times before it starts, and a move is noticed in time.
 * A meeting is scheduled once: its row carries the event's key (the event's id and its start), so a second pass finds it and does nothing;
 * a moved event has a new key, so the old row is called off and the new time gets its own bot. A person whose calendar is not connected,
 * or needs signing in again, is skipped without a word; any other error is logged for that person and the rest go on.
 */
import { ConnectorError } from "../connectors/oauth.js";
import type { GoogleSession } from "../connectors/google/oauth.js";
import type { MeetStore } from "./store.js";
import { meetingOf, type Platform } from "./words.js";

export interface UpcomingEvent { key: string; title: string; startMs: number; url: string; platform: Platform }
export type EventSource = (userId: string, fromMs: number, toMs: number) => Promise<UpcomingEvent[]>;

const CONNECTOR = "google-calendar";
const APP = "Google Calendar";
const MIN = 60_000;
/** The window a bot is asked for in: not sooner than Recall's ten minutes, not later than the sweeps can keep up with. */
const FROM_MIN = 11;
const TO_MIN = 45;

interface Attendee { self?: boolean; responseStatus?: string }
interface CalEvent {
  id?: string; status?: string; summary?: string; location?: string; description?: string; hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: Attendee[];
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

/** The meeting link of an event: the Meet link, a video entry point, then what the location or the description says. */
function linkOf(e: CalEvent): ReturnType<typeof meetingOf> {
  const direct = [e.hangoutLink, ...(e.conferenceData?.entryPoints ?? []).filter((p) => p.entryPointType === "video").map((p) => p.uri)];
  for (const u of direct) {
    const hit = u ? meetingOf(u) : null;
    if (hit) return hit;
  }
  return meetingOf(e.location) ?? meetingOf(e.description);
}

/** Google Calendar's events with a meeting link, from the person's primary calendar. */
export function googleEvents(session: Pick<GoogleSession, "json">): EventSource {
  return async (userId, fromMs, toMs) => {
    const q = new URLSearchParams({
      timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: "50",
    });
    const res = await session.json<{ items?: CalEvent[] }>(userId, CONNECTOR, APP, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q.toString()}`);
    const out: UpcomingEvent[] = [];
    for (const e of res.items ?? []) {
      const start = e.start?.dateTime;
      if (!e.id || e.status === "cancelled" || !start) continue;
      const startMs = Date.parse(start);
      if (!Number.isFinite(startMs)) continue;
      if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
      const link = linkOf(e);
      if (!link) continue;
      out.push({ key: `${e.id}:${start}`, title: e.summary?.trim() || "Meeting", startMs, url: link.url, platform: link.platform });
    }
    return out;
  };
}

export interface AutoJoinDeps {
  store: MeetStore;
  source: EventSource;
  schedule(userId: string, ev: UpcomingEvent): Promise<unknown>;
  cancel(userId: string, meetingId: string): Promise<unknown>;
  now?: () => number;
}

/** One pass: bots for the meetings 11 to 45 minutes away, and the bot of a calendar meeting whose event is gone or moved called off. */
export async function autoJoinSweep(d: AutoJoinDeps): Promise<{ scheduled: number; cancelled: number }> {
  const total = { scheduled: 0, cancelled: 0 };
  const now = (d.now ?? Date.now)();
  const from = now + FROM_MIN * MIN;
  const to = now + TO_MIN * MIN;
  for (const userId of await d.store.autoJoiners()) {
    try {
      const events = (await d.source(userId, from, to)).filter((e) => e.startMs >= from && e.startMs <= to);
      const keys = new Set(events.map((e) => e.key));
      for (const ev of events) {
        if (await d.store.byEvent(userId, ev.key)) continue;
        await d.schedule(userId, ev);
        total.scheduled++;
      }
      for (const m of await d.store.list(userId, 100)) {
        if (m.status !== "scheduled" || m.source !== "calendar") continue;
        if (m.joinAt === null || m.joinAt < from || m.joinAt > to) continue;
        if (m.eventKey && keys.has(m.eventKey)) continue;
        await d.cancel(userId, m.id);
        total.cancelled++;
      }
    } catch (err) {
      if (err instanceof ConnectorError && (err.code === "not_connected" || err.code === "needs_reconnect")) continue;
      console.warn(`[meet] auto-join failed for a person: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return total;
}

/** Runs the sweep every `everyMs` (five minutes by default), unref'd; returns a function that stops it. Never throws. */
export function startAutoJoin(d: AutoJoinDeps, everyMs = 5 * MIN): () => void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    autoJoinSweep(d).catch((err) => console.warn(`[meet] auto-join sweep failed: ${err instanceof Error ? err.message : "error"}`)).finally(() => { running = false; });
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
