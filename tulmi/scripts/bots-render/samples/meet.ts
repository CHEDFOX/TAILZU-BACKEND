/**
 * THE MEETING BOT'S DAY for the render check (screens/bots/meetPage.ts, meetScreens.ts): Aanya in a call now, a standup tomorrow, a
 * vendor call on Friday, three that are over, and — for a space's admin — two of her people's. The times are written as IST wall-clock
 * times on the boards' day (28 October 2026, 19:40 IST in fixtures.ts FIXED_NOW), not as offsets from it, so no two rows land on the
 * same minute and the durations add up to `minutesToday`.
 *
 * The join card opens on the link alone, so `MEET_STATES` carries the moments where there is a link in it: one to join now, one booked
 * for Friday afternoon.
 */
import type { MeetOverview, MeetingView } from "../../../src/meet/types.js";

/** An IST wall-clock time on the boards' week. IST is UTC+5:30. */
const ist = (day: number, h: number, m = 0): number => Date.UTC(2026, 9, day, h, m) - 330 * 60_000;

const base = {
  platform: "google_meet" as const, url: "https://meet.google.com/abc-defg-hij", voice: true, source: "link" as const,
  joinAt: null, startedAt: null, endedAt: null, noteId: null, participants: [] as string[], error: null, liveNotes: null,
};
const meeting = (o: Partial<MeetingView> & { id: string; title: string; status: MeetingView["status"] }): MeetingView => ({ ...base, ...o });

export const MEET_BOT = {
  slug: "meet", name: "Meeting bot", colour: "sea", builtin: true, publicCard: false, tone: "plain and brief", principles: [],
  purpose: "Joins your video calls: takes the notes, answers what people ask in the chat and out loud, and turns what was agreed into your to-dos.",
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};

/** One call now, one standup tomorrow, a few that are over. No admin: what most people see. */
export const MEET_OVERVIEW: MeetOverview = {
  settings: { autoJoin: true, voice: true, botName: "Aanya's notetaker" },
  botName: "Aanya's notetaker",
  live: [meeting({
    id: "m1", title: "Checkout redesign — weekly", status: "in_call", startedAt: ist(28, 19, 15),
    participants: ["Aanya Sharma", "Rohan Mehta", "Priya N", "Dev Kapoor"],
    liveNotes: { at: ist(28, 19, 37), points: ["Cart rounding goes per item", "Launch moves to 6 Nov"], actions: [{ who: "Rohan", what: "redo the totals test" }] },
  })],
  upcoming: [
    meeting({ id: "m2", title: "Standup", status: "scheduled", source: "calendar", joinAt: ist(29, 10, 0), platform: "zoom" }),
    meeting({ id: "m3", title: "Vendor contract — final call", status: "scheduled", source: "calendar", joinAt: ist(30, 15, 30), voice: false }),
  ],
  recent: [
    meeting({ id: "m4", title: "Investor call — Series A", status: "done", startedAt: ist(28, 16, 0), endedAt: ist(28, 17, 5), noteId: "11111111-2222-4333-8444-555555555555", participants: ["Aanya Sharma", "Neel Shah"] }),
    meeting({ id: "m5", title: "Design review", status: "done", platform: "teams", startedAt: ist(27, 11, 30), endedAt: ist(27, 12, 14) }),
    meeting({ id: "m6", title: "Vendor demo", status: "failed", joinAt: ist(26, 17, 0), error: "nobody let it in" }),
  ],
  // The investor call's 65 minutes, and 25 so far in the call now.
  minutesToday: 90,
  minutesCap: 300,
  calendar: true,
  people: [],
  sendFor: [],
};

/** The same day for a space's admin: the For chips and their people's meetings appear. */
export const MEET_ADMIN: MeetOverview = {
  ...MEET_OVERVIEW,
  people: [
    meeting({ id: "m7", title: "Support handover", status: "in_call", startedAt: ist(28, 19, 25), participants: ["Rohan Mehta", "Ira"], owner: { id: "u2", name: "Rohan Mehta" } }),
    meeting({ id: "m8", title: "Onboarding call", status: "done", startedAt: ist(27, 17, 0), endedAt: ist(27, 17, 34), noteId: "99999999-2222-4333-8444-555555555555", owner: { id: "u3", name: "Priya N" }, by: "Aanya Sharma" }),
  ],
  sendFor: [{ id: "u2", name: "Rohan Mehta" }, { id: "u3", name: "Priya N" }],
};

/** The first day: nothing has happened yet, no calendar connected, no name of its own. */
export const MEET_EMPTY: MeetOverview = {
  ...MEET_OVERVIEW, settings: { autoJoin: false, voice: true, botName: "" }, botName: "X0 Bot",
  live: [], upcoming: [], recent: [], people: [], sendFor: [], minutesToday: 0, calendar: false,
};

/** The join card with something in it: the card shows nothing but the link until there is one. */
export const MEET_STATES = {
  now: { mj_url: "https://meet.google.com/abc-defg-hij", mj_day: "", mj_time: "", mj_for: "", mj_name: "Aanya's notetaker" },
  later: { mj_url: "https://zoom.us/j/9876543210", mj_day: "2026-10-30", mj_time: "16:00", mj_for: "", mj_name: "Aanya's notetaker" },
};

/** The routes the meeting bot's page and its settings read, beside the bots' own. */
export const MEET_PAGE_API = (overview: MeetOverview): Record<string, unknown> => ({
  "GET /v1/bots/meet": { bot: MEET_BOT },
  "GET /v1/bots/meet/memory": { facts: [], summary: "", turns: 0 },
  "GET /v1/bots/meet/connectors": { connectors: [] },
  "GET /v1/botsapp/bots/chat/meet?limit=1": { turns: [] },
  "GET /v1/botsapp/bots/chat/meet?limit=30": { turns: [] },
  "GET /v1/meet/overview": overview,
});
