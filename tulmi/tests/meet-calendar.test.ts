/**
 * THE MEETING BOT'S AUTO-JOIN (meet/calendar.ts): which calendar events count as meetings, and which a pass sends a bot to or calls off.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { googleEvents, autoJoinSweep, startAutoJoin } = await import("../src/meet/calendar.js");
const { MemoryMeetStore, DEFAULT_SETTINGS } = await import("../src/meet/store.js");
const { ConnectorError } = await import("../src/connectors/oauth.js");
type Meeting = import("../src/meet/store.js").Meeting;
type UpcomingEvent = import("../src/meet/calendar.js").UpcomingEvent;

const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("googleEvents", () => {
  const items = [
    { id: "a", summary: " Design sync ", status: "confirmed", start: { dateTime: "2026-11-12T09:20:00Z" }, hangoutLink: "https://meet.google.com/abc-defg-hij" },
    { id: "b", start: { dateTime: "2026-11-12T09:30:00Z" }, location: "Zoom: https://acme.zoom.us/j/123456789?pwd=x" },
    { id: "c", summary: "Declined", start: { dateTime: "2026-11-12T09:40:00Z" }, hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
      attendees: [{ email: "x@y.z" }, { self: true, responseStatus: "declined" }] },
    { id: "d", summary: "All day", start: { date: "2026-11-12" }, hangoutLink: "https://meet.google.com/ddd-eeee-fff" },
    { id: "e", summary: "Cancelled", status: "cancelled", start: { dateTime: "2026-11-12T09:50:00Z" }, hangoutLink: "https://meet.google.com/ggg-hhhh-iii" },
    { id: "f", summary: "Lunch", start: { dateTime: "2026-11-12T10:00:00Z" }, location: "Cafe" },
    { id: "g", summary: "Entry point", start: { dateTime: "2026-11-12T10:05:00Z" },
      conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://teams.microsoft.com/l/meetup-join/abc" }] } },
    { id: "h", summary: "In description", start: { dateTime: "2026-11-12T10:10:00Z" }, description: "Join https://acme.webex.com/meet/room" },
  ];

  it("keeps the events with a meeting link, and asks for the right range", async () => {
    const calls: Array<{ userId: string; connector: string; app: string; url: string }> = [];
    const session = { async json(userId: string, connector: string, app: string, url: string) { calls.push({ userId, connector, app, url }); return { items }; } };
    const got = await googleEvents(session as never)("u1", NOW, NOW + 45 * MIN);
    expect(got.map((e) => [e.key, e.title, e.platform, e.url])).toEqual([
      ["a:2026-11-12T09:20:00Z", "Design sync", "google_meet", "https://meet.google.com/abc-defg-hij"],
      ["b:2026-11-12T09:30:00Z", "Meeting", "zoom", "https://acme.zoom.us/j/123456789?pwd=x"],
      ["g:2026-11-12T10:05:00Z", "Entry point", "teams", "https://teams.microsoft.com/l/meetup-join/abc"],
      ["h:2026-11-12T10:10:00Z", "In description", "webex", "https://acme.webex.com/meet/room"],
    ]);
    expect(got[0]!.startMs).toBe(Date.parse("2026-11-12T09:20:00Z"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userId: "u1", connector: "google-calendar", app: "Google Calendar" });
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect(u.searchParams.get("timeMin")).toBe(iso(NOW));
    expect(u.searchParams.get("timeMax")).toBe(iso(NOW + 45 * MIN));
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(u.searchParams.get("orderBy")).toBe("startTime");
    expect(u.searchParams.get("maxResults")).toBe("50");
  });
});

function row(o: Partial<Meeting>): Meeting {
  return {
    id: "m1", userId: "u1", botId: null, tokenHash: `h-${o.id ?? "m1"}`, url: "https://meet.google.com/abc-defg-hij", platform: "google_meet", title: "T",
    status: "scheduled", voice: true, source: "calendar", eventKey: null, joinAt: null, startedAt: null, endedAt: null, noteId: null, liveNotes: null,
    participants: [], error: null, createdAt: NOW, updatedAt: NOW, ...o,
  };
}
const ev = (key: string, minutes: number): UpcomingEvent => ({ key, title: key, startMs: NOW + minutes * MIN, url: "https://meet.google.com/abc-defg-hij", platform: "google_meet" });

async function rig() {
  const store = new MemoryMeetStore();
  await store.saveSettings("u1", { ...DEFAULT_SETTINGS, autoJoin: true });
  await store.saveSettings("u2", { ...DEFAULT_SETTINGS, autoJoin: false });
  const scheduled: Array<[string, string]> = [];
  const cancelled: Array<[string, string]> = [];
  const events: Record<string, UpcomingEvent[] | Error> = {};
  const asked: string[] = [];
  const deps = {
    store, now: () => NOW,
    source: async (u: string, from: number, to: number) => {
      asked.push(`${u}:${(from - NOW) / MIN}:${(to - NOW) / MIN}`);
      const e = events[u] ?? [];
      if (e instanceof Error) throw e;
      return e;
    },
    schedule: async (u: string, e: UpcomingEvent) => { scheduled.push([u, e.key]); },
    cancel: async (u: string, id: string) => { cancelled.push([u, id]); },
  };
  return { store, scheduled, cancelled, events, asked, deps };
}

describe("autoJoinSweep", () => {
  it("schedules new events once, only for people with auto-join on, inside the window", async () => {
    const r = await rig();
    r.events.u1 = [ev("soon:1", 20), ev("too-soon:1", 5), ev("too-late:1", 60), ev("later:1", 44)];
    r.events.u2 = [ev("not-theirs:1", 20)];
    expect(await autoJoinSweep(r.deps)).toEqual({ scheduled: 2, cancelled: 0 });
    expect(r.scheduled).toEqual([["u1", "soon:1"], ["u1", "later:1"]]);
    expect(r.asked).toEqual(["u1:11:45"]);

    // The first one now has its row (as the service would add it): a second pass only has the other left to do.
    await r.store.add(row({ id: "m-soon", eventKey: "soon:1", joinAt: NOW + 20 * MIN }));
    r.scheduled.length = 0;
    expect(await autoJoinSweep(r.deps)).toEqual({ scheduled: 1, cancelled: 0 });
    expect(r.scheduled).toEqual([["u1", "later:1"]]);
  });

  it("calls off a scheduled calendar meeting whose event is gone, and leaves the rest", async () => {
    const r = await rig();
    r.events.u1 = [ev("kept:1", 20)];
    await r.store.add(row({ id: "kept", eventKey: "kept:1", joinAt: NOW + 20 * MIN }));
    await r.store.add(row({ id: "gone", eventKey: "gone:1", joinAt: NOW + 25 * MIN }));
    await r.store.add(row({ id: "link", eventKey: null, source: "link", joinAt: NOW + 25 * MIN }));
    await r.store.add(row({ id: "far", eventKey: "far:1", joinAt: NOW + 3 * 60 * MIN }));
    await r.store.add(row({ id: "live", eventKey: "live:1", status: "in_call", joinAt: NOW + 25 * MIN }));
    expect(await autoJoinSweep(r.deps)).toEqual({ scheduled: 0, cancelled: 1 });
    expect(r.cancelled).toEqual([["u1", "gone"]]);
  });

  it("skips a person whose calendar is not connected, and goes on with the rest", async () => {
    const r = await rig();
    await r.store.saveSettings("u3", { ...DEFAULT_SETTINGS, autoJoin: true });
    await r.store.saveSettings("u4", { ...DEFAULT_SETTINGS, autoJoin: true });
    r.events.u1 = new ConnectorError("not_connected", "no");
    r.events.u3 = new ConnectorError("needs_reconnect", "no");
    r.events.u4 = [ev("x:1", 15)];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await autoJoinSweep(r.deps)).toEqual({ scheduled: 1, cancelled: 0 });
    expect(warn).not.toHaveBeenCalled();
    r.events.u1 = new Error("boom");
    await autoJoinSweep(r.deps);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("startAutoJoin", () => {
  it("runs the sweep on a timer and stops", async () => {
    vi.useFakeTimers();
    try {
      const r = await rig();
      r.events.u1 = [];
      const stop = startAutoJoin(r.deps, 1000);
      await vi.advanceTimersByTimeAsync(2500);
      expect(r.asked.length).toBe(2);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(r.asked.length).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
