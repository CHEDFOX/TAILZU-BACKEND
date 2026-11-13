/**
 * "X0 is calling" (screens/bots/planCall.ts): the call screen's reads, as GET /v1/botsapp/bots/plan/calls/:id answers them, on the sample
 * day (Tuesday 28 October). c1 the leave-by ringing (Zara, with AI), c2 a bill due today ringing (X0, no AI: the phone's own voice, no
 * talking back), c3 the leave-by missed, c4 a call that ended, c5 the leave-by answered with a realtime call to be had, c6 a call the
 * call judge asked for about an event (also realtime).
 */
import { FIXED_NOW } from "../../../src/experience/bots/fixtures.js";
import type { CallView } from "../../../src/botsBots/planCallWords.js";

const MIN = 60_000;
/** 4:55 pm on the sample day, ten minutes before the leave-by. */
const RING = FIXED_NOW - 165 * MIN;
const CALLS = "/v1/botsapp/bots/plan/calls";

const leaveCard: CallView["card"] = {
  title: "Parent-teacher meeting", sub: "Leave by 5:05 pm · 25 min drive to Green Valley School", item: "pe:ev-ptm:2026-10-28",
  eventId: "ev-ptm", to: "Green Valley School, HSR Layout", mode: "driving",
};
const base = { origin: "server" as const, ringAt: RING, missedClock: "4:55 pm", answeredAt: null, endedAt: null, rt: false, acted: [] };

export const CALL_VIEWS: Record<"c1" | "c2" | "c3" | "c4" | "c5" | "c6", CallView> = {
  c1: { ...base, id: "c1", state: "ringing", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting", late: true, ai: true, card: leaveCard },
  c2: {
    ...base, id: "c2", state: "ringing", name: "X0", source: "due", line: "Electricity bill due today", missedClock: "10 am", late: true, ai: false,
    card: { title: "Electricity bill ₹2,340", sub: "To BESCOM · due today", item: "pt:7d1f0c2e-1111-4222-8333-944445555666", taskId: "7d1f0c2e-1111-4222-8333-944445555666", pay: true },
  },
  c3: { ...base, id: "c3", state: "missed", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting", late: false, ai: true, endedAt: RING + 45_000, card: leaveCard },
  c4: { ...base, id: "c4", state: "ended", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting", late: false, ai: true, answeredAt: RING + 9_000, endedAt: RING + 70_000, card: leaveCard },
  // Answered, with the realtime call allowed: the same screen, in its live mode.
  c5: {
    ...base, id: "c5", state: "answered", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting",
    late: false, ai: true, rt: true, answeredAt: RING + 9_000, card: leaveCard,
  },
  // A call the call judge asked for: an event with a place, so the card gets Open map and Move.
  c6: {
    ...base, id: "c6", state: "answered", name: "Zara", source: "item", line: "Visa appointment at 11:30 am", missedClock: "9:30 am",
    late: false, ai: true, rt: true, answeredAt: RING + 9_000,
    card: {
      title: "Visa appointment", sub: "11:30 am · VFS Global, Koramangala", item: "pe:ev-visa:2026-10-28", kind: "event", eventId: "ev-visa",
      to: "VFS Global, Koramangala", mode: "driving",
    },
  },
};

/** Every call's read, for any sample. */
export const CALL_API: Record<string, unknown> = Object.fromEntries(Object.entries(CALL_VIEWS).map(([id, v]) => [`GET ${CALLS}/${id}`, v]));
