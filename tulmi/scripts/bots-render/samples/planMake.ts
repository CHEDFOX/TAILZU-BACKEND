/**
 * PLAN EASE'S HOME AND "PLAN SOMETHING" (screens/bots/planHome.ts, screens/bots/planMake.ts): the reads, as the routes answer them, on the
 * sample day (Wednesday 28 October, 7:40 pm), and the check face's states.
 *
 *   PLAN_DAY_API   GET .../plan/day: today in full (an all-day birthday, a leave-by with Open map, a must row, rain, a tight leg, Mom's
 *                  follow line, Dad's medicine, free time, a to-do, a bill with Pay, a done to-do), one Needs-you card, three to-dos with no
 *                  day, travel credits; tomorrow; an empty Saturday; and today just after Done ("Added: …", the new row outlined)
 *   MAKE_API       GET .../plan/make (the real PlanMake.setup): You, Dad, Mom and Riya, follow-through on, AI on (they said yes after
 *                  onboarding), an invite (MAKE_OFF:
 *                  follow-through off)
 *   MAKE_STATES    the card's states (Sample.state): filled by hand; and as the screen's own actions leave them after the real PlanMake's
 *                  answers: looks good, notes, a stop, two drafts, who is Nani, a bill's preview, a day's answer, What
 *                  words still messy after Check ("Read it with AI")
 *
 * Every answer is the real service's, worked out once when this file loads: the home's from PlanEase.day (botsBots/planThread.ts threadOf,
 * planRows.ts rowOf), "Plan something"'s from PlanMake.setup, .draft and .check (botsBots/planMakeService.ts), over the boards' calendar.
 */
import { FIXED_NOW, IST } from "../../../src/experience/bots/fixtures.js";
import { LOOK as SPACE_LOOK } from "../../../tests/spaces-data.js";
import { emptyCard, type CardDraft, type MakeSetup } from "../../../src/botsBots/planMake.js";
import type { PlanDayData } from "../../../src/botsBots/planThread.js";
import type { PlanTravel, PlanTravelling } from "../../../src/botsBots/planTravel.js";
import type { FollowPeople } from "../../../src/botsBots/planFollowPeople.js";
import type { PlanCapture } from "../../../src/botsBots/planCapture.js";

const MIN = 60_000;
const A = "/v1/botsapp/bots";
const ist = (month: number, day: number, h: number, m = 0) => Date.UTC(2026, month - 1, day, h, m) - IST * MIN;

const ME = "00000000-0000-4000-8000-00000000aaaa";
export const MOM = "aaaaaaaa-0000-4000-8000-000000000001";
export const DAD = "bbbbbbbb-0000-4000-8000-000000000002";
export const RIYA = "cccccccc-0000-4000-8000-000000000003";
/** Done's key, as the made rows carry it (make:<key>:0). */
export const MADE_KEY = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

/**
 * Their space's looks (follow-through's looksOf, as threads.ts contacts give them): the same tiny bots the sample space draws them with
 * in "Notes from your space" (tests/spaces-data.ts LOOK: Mom m, Dad d, Riya r), so one person is one tiny bot on every row, card and chip.
 */
const LOOKS = new Map([[MOM, SPACE_LOOK.m], [DAD, SPACE_LOOK.d], [RIYA, SPACE_LOOK.r]].map(([id, l]) => [id as string, { ...(l as typeof SPACE_LOOK.m), seed: id as string }]));
const spaceLooks = async () => LOOKS;

const CREDITS = [{ text: "Map data © OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" }, { text: "Routes: OSRM", url: "https://project-osrm.org" }];

// ------------------------------------------------------------------ the home, as PlanEase.day answers it

const HOUR = 60 * MIN;
const day28 = "2026-10-28", day29 = "2026-10-29";

/** The leave-bys, the tight leg and the rain, as places' travel (planTravel.ts) works them out for today and tomorrow. */
function travelFor(day: string, ids: { dentist: string; pickup: string; ptm: string }): PlanTravel {
  const base = { on: true, pending: false, home: "HSR Layout", homeFound: true, savedWeekMin: 40, credits: CREDITS };
  if (day === day28) {
    return {
      ...base,
      legs: [
        { fromId: "home", toId: ids.dentist, to: "Indiranagar", mode: "drive", minutes: 25, leaveBy: ist(10, 28, 19, 50), gapMin: null, tight: false },
        { fromId: ids.dentist, toId: ids.pickup, to: "HSR Layout", mode: "drive", minutes: 20, leaveBy: ist(10, 28, 20, 55), gapMin: 15, tight: true },
      ],
      headsUp: [{ eventId: ids.dentist, kind: "rain", text: "Rain likely around 8 pm" }],
    } as PlanTravel;
  }
  return { ...base, legs: [{ fromId: "home", toId: ids.ptm, to: "Green Valley School", mode: "drive", minutes: 30, leaveBy: ist(10, 29, 17, 30), gapMin: null, tight: false }], headsUp: [] } as PlanTravel;
}

/**
 * The boards' calendar, in memory: today with an all-day birthday, a standup already over, the dentist (must not miss, made by "Plan
 * something"'s Done a moment ago), a pickup Mom has, Dad's medicine, a late call, a to-do, a bill with Pay, a done to-do; three to-dos with
 * no day; tomorrow's standup, parent-teacher meeting and dinner; Friday's meeting; Sunday's lunch.
 */
async function boardCalendar() {
  const { Calendar, memoryCalendarRows } = await import("../../../src/calendar/index.js");
  const now = () => FIXED_NOW;
  const c = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
  const ev = (raw: Record<string, unknown>, more: Parameters<typeof c.addEvent>[3] = {}) => c.addEvent(ME, { tz: IST, ...raw }, { kind: "me" }, more);
  // Saved as said (Done's `parsed`): "Book a cab for Friday" stays a to-do for today, never read again as Friday.
  const todo = (raw: Record<string, unknown>, more: Parameters<typeof c.addTask>[4] = {}) => c.addTask(ME, { tz: IST, ...raw }, { kind: "me" }, null, more, { parsed: true });

  await ev({ title: "Riya's birthday", day: day28, time: "" }, { parsed: true });
  await ev({ title: "Studio standup", day: day28, time: "09:30", minutes: 30, place: "Video call" });
  const dentist = await ev({ title: "Dentist · Dr. Mehta", day: day28, time: "20:15", minutes: 45, place: "Indiranagar" }, { key: `make:${MADE_KEY}:0`, parsed: true });
  await c.setFollow(ME, { kind: "event", id: dentist.id }, { importance: "must" });
  const pickup = await ev({ title: "Pick up Kabir from tuition", day: day28, time: "21:15", minutes: 15, place: "HSR Layout" }, { people: [{ k: "u", id: MOM, name: "Mom" }] });
  await todo({ title: "Medicine", day: day28, time: "22:00" }, { people: [{ k: "u", id: DAD, name: "Dad" }] });
  await ev({ title: "Call with Dev", day: day28, time: "23:30", minutes: 30, place: "Video call" });
  await todo({ title: "Buy fruit costume", day: day28 });
  await todo({ title: "Electricity", day: day28 }, { kind: "due", amount_paise: 214_000, payee: "BESCOM", pay_link: "upi://pay?pa=bescom@hdfcbank&pn=BESCOM&am=2140.00&cu=INR" });
  const cab = await todo({ title: "Book a cab for Friday", day: day28 });
  await c.tickTask(ME, cab.id, true);
  for (const title of ["Renew car insurance", "Return the library books", "Call the plumber about the kitchen tap"]) await todo({ title });
  await ev({ title: "Studio standup", day: day29, time: "09:30", minutes: 30, place: "Video call" });
  const ptm = await ev({ title: "Parent-teacher meeting", day: day29, time: "18:00", minutes: 60, place: "Green Valley School" }, { people: [{ k: "u", id: RIYA, name: "Riya" }] });
  await ev({ title: "Dinner with Mom", day: day29, time: "19:30", minutes: 120, place: "Koramangala" });
  await todo({ title: "Pick up the cake for Mom", day: day29 });
  await ev({ title: "Parent-teacher meeting", day: "2026-10-30", time: "18:15", minutes: 60 });
  await ev({ title: "Lunch with Kavya", day: "2026-11-01", time: "13:00", minutes: 60, place: "Bandra" });
  return { c, now, ids: { dentist: dentist.id, pickup: pickup.id, ptm: ptm.id } };
}

/**
 * The boards' day on the real home (PlanEase.day over the boards' calendar): rain, a tight leg to Kabir's pickup that Mom hasn't said
 * done for, free time, one Needs-you card; tomorrow; an empty Saturday; today just after Done. Places' travel and follow-through's cards
 * and lines are their sources' answers (a stand-in travel, the "follow" source), registered only while the day is read.
 */
async function planDays(): Promise<Record<string, PlanDayData>> {
  const { PlanEase } = await import("../../../src/botsBots/planEase.js");
  const { memoryPlanPrefs } = await import("../../../src/botsBots/planPrefs.js");
  const { MemoryTable } = await import("../../../src/botsBots/rows.js");
  const { addPlanSource, removePlanSource } = await import("../../../src/botsBots/planSources.js");
  const { c, now, ids } = await boardCalendar();
  const travel = {
    on: true,
    plan: async (_u: string, o: { tomorrow: string }) => ({ travel: travelFor(o.tomorrow, ids) }),
    keepShown: async () => undefined,
  } as unknown as PlanTravelling;
  addPlanSource({
    name: "follow",
    more: async () => ({
      cards: [{
        type: "follow", key: "follow:f1:1:asker", until: FIXED_NOW + 2 * HOUR, question: "Mom hasn't said done", reason: "Pick up Kabir from tuition · 9:15 pm",
        item: "pf:f1:1", person: { look: LOOKS.get(MOM)!, name: "Mom" },
        buttons: [{ id: "done", label: "Done", primary: true, done: "Done." }, { id: "look", label: "Look", open: { screen: "bots.plan.follow", params: { follow: "f1" } } }],
      }],
      lines: { [`e:${ids.pickup}`]: "Mom · not done yet" },
    }),
  });
  try {
    const skips = new MemoryTable<{ user_id: string; key: string; at_ms: number }>();
    const ease = new PlanEase({ calendar: c, prefs: memoryPlanPrefs(now), skips, now, travel });
    ease.wire({ looks: spaceLooks });
    // The tight leg's Move card was left alone earlier (kept as answered), so Mom's follow is the one Needs-you card.
    const first = await ease.day(ME, IST);
    if (first.needs?.type === "move") await skips.upsert({ user_id: ME, key: first.needs.key, at_ms: FIXED_NOW - HOUR }, ["user_id", "key"]);
    return {
      today: await ease.day(ME, IST),
      tomorrow: await ease.day(ME, IST, day29),
      saturday: await ease.day(ME, IST, "2026-10-31"),
      added: await ease.day(ME, IST, day28, { made: MADE_KEY, n: 1 }),
    };
  } finally {
    removePlanSource("follow");
  }
}

const DAYS = await planDays();
const DAY = `GET ${A}/plan/day`;
/** GET .../plan/day for each variant's params (planHome.ts planDayQuery). */
export const PLAN_DAY_API: Record<string, unknown> = {
  [`${DAY}?tz=${IST}`]: DAYS.today,
  [`${DAY}?tz=${IST}&day=2026-10-29`]: DAYS.tomorrow,
  [`${DAY}?tz=${IST}&day=2026-10-31`]: DAYS.saturday,
  [`${DAY}?tz=${IST}&day=2026-10-28&made=${MADE_KEY}&n=1`]: DAYS.added,
};

// ------------------------------------------------------------------ "Plan something"

/** Follow-through's picker (planFollowPeople.ts): You, then Dad, Mom and Riya, the people the person may message in X0; the space's invite. */
const PICKER = {
  picker: async () => ({
    item: null, spaces: true, numbers: false, invite: { screen: "bots.space.invite", params: { id: "s1" } },
    people: [
      { key: `u:${ME}`, name: "You", me: true, number: false },
      { key: `u:${DAD}`, name: "Dad", me: false, number: false },
      { key: `u:${MOM}`, name: "Mom", me: false, number: false },
      { key: `u:${RIYA}`, name: "Riya", me: false, number: false },
    ],
  }),
} as unknown as FollowPeople;

/** GET .../plan/make as the real PlanMake.setup answers it (planMakeService.ts): the picker's people, and AI on (their yes after onboarding). */
async function makeSetup(): Promise<MakeSetup> {
  const { PlanMake } = await import("../../../src/botsBots/planMakeService.js");
  const capture = { aiOk: async () => true } as unknown as PlanCapture;
  const make = new PlanMake({ ease: () => { throw new Error("not read by setup"); }, calendar: () => { throw new Error("not read by setup"); }, people: () => PICKER, capture: () => capture, now: () => FIXED_NOW, looks: spaceLooks });
  return make.setup(ME, IST);
}
const SETUP: MakeSetup = await makeSetup();
const MAKE = `GET ${A}/plan/make?tz=${IST}`;
export const MAKE_API: Record<string, unknown> = { [MAKE]: SETUP };
export const MAKE_OFF_API: Record<string, unknown> = { [MAKE]: { ...SETUP, people: [], follow: false } };

/**
 * The check face's states (Sample.state), each the state the screen's own actions leave after a real answer: PlanMake.draft (the box's
 * Send, ON_FILL) and PlanMake.check (Check, ON_CHECK) over the boards' calendar, at the boards' moment (Wednesday 28 October, 7:40 pm),
 * with the picker's people and their yes to AI; no model is called (a read asked for answers "failed"), so the rules' drafts come back.
 */
async function makeStates(): Promise<Record<string, Record<string, unknown>>> {
  const { PlanEase } = await import("../../../src/botsBots/planEase.js");
  const { PlanMake } = await import("../../../src/botsBots/planMakeService.js");
  const { memoryPlanPrefs } = await import("../../../src/botsBots/planPrefs.js");
  const { MemoryTable } = await import("../../../src/botsBots/rows.js");
  const { DEFAULT_SETTINGS } = await import("../../../src/you/settings.js");
  const { setAddDue } = await import("../../../src/botsBots/planDue.js");
  const { c, now } = await boardCalendar();
  const ease = new PlanEase({ calendar: c, prefs: memoryPlanPrefs(now), skips: new MemoryTable(), now });
  const capture = { aiOk: async () => true, readWords: async () => "failed" } as unknown as PlanCapture;
  const make = new PlanMake({
    ease: () => ease, calendar: () => c, people: () => PICKER, capture: () => capture, now, settingsOf: async () => structuredClone(DEFAULT_SETTINGS),
  });
  const day0 = MAKE_PARAMS.day;
  const withDue = async <T>(fn: () => Promise<T>): Promise<T> => {
    setAddDue(async () => ({ id: "due-sample", monthly: false }));
    try { return await fn(); } finally { setAddDue(null); }
  };
  // ON_FILL: drafts are the check face; a bill's preview; the box's own answer (afterBox clears the box).
  const sent = async (words: string): Promise<Record<string, unknown>> => {
    const res = await make.draft(ME, { words, tz: IST, d: emptyCard(day0), list: [], at: "0", day: day0 });
    if (res.kind === "draft") return { step: "check", list: res.drafts, d: res.d, at: res.at, chk: res.view, key: res.key };
    // A preview takes the words out of the box (ON_FILL clears say): they are in the preview, and its Change puts them back.
    return res.kind === "preview" ? { pre: res.preview } : { boxed: res.box };
  };
  // ON_CHECK: the card checked (Check sends the card at `at` and the day it opened with).
  const checked = async (card: Partial<CardDraft>): Promise<Record<string, unknown>> => {
    const res = await make.check(ME, { list: [], d: { ...emptyCard(day0), ...card }, at: "0", tz: IST, day0 });
    return { step: "check", list: res.drafts, d: res.d, at: res.at, chk: res.view, key: res.key };
  };
  return {
    // The card filled by hand (the edit face): tomorrow at 5 pm, for Dad, must not miss, a place.
    filled: { d: { ...emptyCard(day0), title: "Pick up Kabir from tuition", day: "2026-10-29", time: "other", timeWords: "5 pm", who: DAD, imp: "must", place: "Brainy Bunch, HSR Layout" } },
    // "Dentist Fri 5 pm" in the box: sure, no AI, "Looks good".
    good: await sent("Dentist Fri 5 pm"),
    // The card: Medicine, tomorrow, typed "9", for Dad: a clash with the standup (Move to …), 9 am or 9 pm?, medicine.
    notes: await checked({ title: "Medicine", day: "2026-10-29", time: "other", timeWords: "9", who: DAD }),
    // The card: Call the bank, today at 8 am, at 7:40 pm: a stop, with Tomorrow and tonight.
    stop: await checked({ title: "Call the bank", time: "other", timeWords: "8 am" }),
    // Two things with their own times in one line: two drafts, one Done.
    multi: await sent("Dentist Fri 5 pm and haircut Sat 11 am"),
    // "Nani" is not one of their X0 people: who is Nani?, and her tablets are must not miss.
    whoIs: await sent("remind Nani to take her tablets at 8 every morning"),
    // A bill: a preview first, added only on Done (the box's due slot reads bills while capture's addDue is wired, as on the server).
    bill: await withDue(() => sent("Electricity 2140 due 14th")),
    // A day's question: the box's own answer, under it.
    boxDay: await sent("What's on tomorrow?"),
    // The card's What still messy after Check (rules): "Some words were hard to read. Read it with AI" (the owner's "ai checks").
    messy: await checked({ title: "meet Rahul around 7ish after his class" }),
  };
}

export const MAKE_PARAMS = { from: "plan", day: "2026-10-28" };
/** The check face's states (Sample.state), merged into MAKE_STATE before drawing. */
export const MAKE_STATES: Record<string, Record<string, unknown>> = await makeStates();
