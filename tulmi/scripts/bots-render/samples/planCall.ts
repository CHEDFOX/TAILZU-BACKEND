/**
 * "X0 is calling" (screens/bots/planCall.ts): the call screen's reads, as GET /v1/botsapp/bots/plan/calls/:id answers them, on the sample
 * day (Tuesday 28 October). c1 the leave-by ringing (Zara, with AI), c2 a bill due today ringing (X0, no AI: the phone's own voice, no
 * talking back), c3 the leave-by missed, c4 a call that ended.
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
const base = { origin: "server" as const, ringAt: RING, missedClock: "4:55 pm", answeredAt: null, endedAt: null };

export const CALL_VIEWS: Record<"c1" | "c2" | "c3" | "c4", CallView> = {
  c1: { ...base, id: "c1", state: "ringing", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting", late: true, ai: true, card: leaveCard },
  c2: {
    ...base, id: "c2", state: "ringing", name: "X0", source: "due", line: "Electricity bill due today", missedClock: "10 am", late: true, ai: false,
    card: { title: "Electricity bill ₹2,340", sub: "To BESCOM · due today", item: "pt:7d1f0c2e-1111-4222-8333-944445555666", taskId: "7d1f0c2e-1111-4222-8333-944445555666", pay: true },
  },
  c3: { ...base, id: "c3", state: "missed", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting", late: false, ai: true, endedAt: RING + 45_000, card: leaveCard },
  c4: { ...base, id: "c4", state: "ended", name: "Zara", source: "leave", line: "Leave by 5:05 pm for parent-teacher meeting", late: false, ai: true, answeredAt: RING + 9_000, endedAt: RING + 70_000, card: leaveCard },
};

/** Every call's read, for any sample. */
export const CALL_API: Record<string, unknown> = Object.fromEntries(Object.entries(CALL_VIEWS).map(([id, v]) => [`GET ${CALLS}/${id}`, v]));
