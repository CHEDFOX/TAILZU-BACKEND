/**
 * The boards' day for the bots area's screens (Aanya, her Gym bot, her week, her Pune trip, her spaces), as the routes answer it.
 * Used by tests/bots-bots.test.ts, and for the render check:
 *   npx tsx -e 'import("./tests/bots-bots-data.ts").then(async (m) => console.log(JSON.stringify(await m.sampleApi())))' > /tmp/api.json
 */
import { FIXED_NOW, IST } from "../src/experience/bots/fixtures.js";
import { PlanDays, type PlanEvent, type PlanReader } from "../src/botsBots/plan.js";
import { MemoryTable } from "../src/botsBots/rows.js";
import { spacesApi } from "./spaces-data.js";

const A = "/v1/botsapp/bots";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** IST wall time on a day of October / November 2026, as UTC ms. */
const ist = (month: 10 | 11, day: number, h: number, m = 0) => Date.UTC(2026, month - 1, day, h, m) - IST * MIN;
const ev = (id: string, title: string, month: 10 | 11, day: number, h: number, m: number, mins: number, o: Partial<PlanEvent> = {}): PlanEvent =>
  ({ id, title, start: ist(month, day, h, m), end: ist(month, day, h, m) + mins * MIN, allDay: false, people: 0, ...o });

export const WEEK: PlanEvent[] = [
  ev("e1", "Standup", 10, 26, 9, 30, 30), ev("e2", "Client call", 10, 26, 11, 0, 60, { where: "Tanmay", people: 1 }), ev("e3", "Gym", 10, 26, 18, 0, 45),
  ev("e4", "Standup", 10, 27, 9, 30, 30), ev("e5", "Design review", 10, 27, 14, 0, 60, { people: 3 }),
  ev("e6", "Standup", 10, 28, 9, 30, 30), ev("e7", "Lunch with Kavya", 10, 28, 13, 0, 60, { where: "Bandra", people: 1 }), ev("e8", "Diwali sale plan", 10, 28, 15, 0, 45), ev("e9", "Gym · upper body", 10, 28, 18, 0, 45),
  ev("e10", "Studio standup", 10, 29, 9, 30, 30, { where: "Video call", people: 3 }), ev("e11", "Dentist · Dr. Mehta", 10, 29, 18, 0, 45, { where: "Indiranagar" }),
  ev("e12", "Dinner with Mom", 10, 29, 19, 0, 120, { where: "Koramangala", people: 1 }),
  ev("e13", "Standup", 10, 30, 9, 0, 30),
  ev("e14", "Bank", 10, 31, 10, 0, 90, { where: "Jayanagar" }), ev("e15", "Rohan's match", 10, 31, 12, 0, 90), ev("e16", "Tailor pickup", 10, 31, 15, 0, 60), ev("e17", "Diwali party", 10, 31, 19, 0, 150, { where: "Kavya's", people: 6 }),
  ev("e18", "Call Nani", 11, 1, 11, 0, 60),
];

export function fakeReader(o: { calendar?: boolean; tasks?: boolean; events?: PlanEvent[] } = {}): PlanReader {
  return {
    connected: async () => ({ calendar: o.calendar ?? true, tasks: o.tasks ?? true }),
    events: async (_u, from, to) => (o.events ?? WEEK).filter((e) => e.end > from && e.start < to),
    tasks: async () => [{ id: "t1", title: "Pick up the cake for Mom", due: "2026-10-29" }, { id: "t2", title: "GST papers due", due: "2026-10-30" }],
  };
}

export const GYM = {
  id: "9d0c1b2a-0000-4000-8000-000000000001", ownerId: "u", slug: "gym-bot", name: "Gym bot", colour: "pine", purpose: "Plans workouts around your calendar",
  principles: ["Never plan on days I'm travelling", "Keep sessions under 45 minutes", "Remind me at 9 pm the night before"],
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: ["google-calendar"] },
  knowledge: [], tone: "upbeat", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 800 }, builtin: false, publicCard: true, createdAt: FIXED_NOW - 30 * DAY, updatedAt: FIXED_NOW - DAY,
};

const turn = (id: string, role: "me" | "bot", text: string, at: number, extra: Record<string, unknown> = {}) => ({ id, role, text, at, opens: [], approvals: [], paise: 0, ...extra });
export const GYM_TURNS = [
  turn("c1", "bot", "Legs tomorrow, 7:00 am. Shoes by the door?", FIXED_NOW - DAY + 90 * MIN),
  turn("c2", "me", "Legs done, 40 minutes", FIXED_NOW - 6 * HOUR),
  turn("c3", "bot", "Logged. That's 4 in a row.", FIXED_NOW - 6 * HOUR + 1),
  turn("c4", "me", "Plan my next week", FIXED_NOW - 20 * MIN),
  turn("c5", "bot", "Three sessions, 40 minutes each, none on Thursday (you fly to Pune). Reminders at 9 pm the night before.\n\n- Mon: Legs · 7:00 am\n- Wed: Upper body · 7:00 am\n- Sat: Run + core · 8:30 am", FIXED_NOW - 20 * MIN + 1,
    { approvals: [{ taskId: "a1b2c3d4-0000-4000-8000-0000000000ff", connector: "google-calendar", preview: "Add 3 workouts to your calendar" }] }),
];

/** Tomorrow's travel as GET /plan answers it with places set up (src/botsBots/planTravel.ts): home in HSR Layout, the dentist in
 *  Indiranagar, dinner in Koramangala 35 min away with 15 min between (too short), and 40 min saved by last week's yeses. */
export const SAMPLE_PLAN_TRAVEL = {
  on: true, pending: false, home: "HSR Layout", homeFound: true,
  legs: [
    { fromId: "home", toId: "e11", to: "Indiranagar", mode: "drive", minutes: 30, leaveBy: ist(10, 29, 17, 30), gapMin: null, tight: false },
    { fromId: "e11", toId: "e12", to: "Koramangala", mode: "drive", minutes: 35, leaveBy: ist(10, 29, 18, 25), gapMin: 15, tight: true },
  ],
  headsUp: [], savedWeekMin: 40,
  credits: [{ text: "Map data © OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" }, { text: "Routes: OSRM", url: "https://project-osrm.org" }],
};

const stay = (id: string, name: string, area: string, rupees: number, rating: number, reviews: number, url: string, extra: Record<string, unknown>) => ({
  id, name, area, url, host: new URL(url).hostname.replace(/^www\./, ""), nightPaise: rupees * 100, rating, ratingOf: 5, reviews, by: "web", picked: false, at: FIXED_NOW - HOUR, ...extra,
});
/** The Pune trip's weather, places and stays as GET /trip/:id/extras answers them (src/botsBots/tripExtras.ts). */
export const SAMPLE_TRIP_EXTRAS = {
  dates: { from: "2026-11-14", to: "2026-11-16", nights: 2 }, where: "Pune",
  weather: {
    days: [{ key: "2026-11-14", hiC: 29, loC: 17, sky: "clear", rainMm: 0 }, { key: "2026-11-15", hiC: 30, loC: 16, sky: "clear", rainMm: 0 }, { key: "2026-11-16", hiC: 28, loC: 16, sky: "clear", rainMm: 0 }],
    line: "Clear days, cool nights", sub: "Sat 29° · Sun 30° · Mon 28° · lows 16°", pack: null, more: null,
  },
  weatherNote: null,
  spots: [{ text: "Sakshi and Arjun's wedding, Koregaon Park", found: true }],
  main: "the wedding",
  stays: [
    stay("s1", "Shanti Residency", "Koregaon Park", 3200, 4.4, 1820, "https://www.booking.com/hotel/in/shanti-residency-pune.html", { label: "Travel bot's pick", minutes: 12, mode: "drive", totalPaise: 640000, stars: 4.4 }),
    stay("s2", "Deccan Courtyard", "FC Road", 2600, 4.1, 960, "https://www.makemytrip.com/hotels/deccan_courtyard-details-pune.html", { label: "Cheaper", minutes: 28, mode: "drive", totalPaise: 520000, stars: 4.1 }),
  ],
  finding: false, searched: null, canFind: true, canMeasure: true, pending: false,
  credits: [{ text: "Map data © OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" }, { text: "Routes: OSRM", url: "https://project-osrm.org" }, { text: "Weather: MET Norway", url: "https://www.met.no/en" }],
};

export async function samplePlan() {
  const plan = new PlanDays(fakeReader(), null, () => FIXED_NOW, new MemoryTable());
  return plan.read("u", { tz: IST, week: 0 });
}

export async function sampleApi(): Promise<Record<string, unknown>> {
  const plan = await samplePlan();
  const chat = { turns: GYM_TURNS };
  return {
    "GET /v1/bots/gym-bot": { bot: GYM },
    "GET /v1/bots/gym-bot/memory": { facts: ["You like 7 am sessions", "Go easy on the left knee", "Flying to Pune on Thursday", "Gym in HSR Layout opens at 6 am"].map((text, i) => ({ id: `f${i}`, text, createdAt: FIXED_NOW - i * DAY })), summary: "", turns: 14 },
    "GET /v1/bots/gym-bot/connectors": { connectors: [{ id: "google-calendar", name: "Google Calendar", status: "connected" }] },
    [`GET ${A}/chat/gym-bot?limit=6`]: { turns: GYM_TURNS.slice(-4) },
    [`GET ${A}/chat/gym-bot?limit=30`]: chat,
    [`GET ${A}/chat/gym-bot?limit=2`]: { turns: GYM_TURNS.slice(-2) },
    "GET /v1/connectors": { enabled: true, connectors: [
      { id: "google-calendar", name: "Google Calendar", oneLine: "Reads your days, adds events", connected: true },
      { id: "google-tasks", name: "Google Tasks", oneLine: "Your to-do list", connected: true },
      { id: "email-handoff", name: "Gmail", oneLine: "Drafts an email for you to send", connected: false },
    ] },
    "GET /v1/bots": { bots: [
      { slug: "code", name: "Code bot", colour: "pine", builtin: true }, { slug: "keybot", name: "Keybot", colour: "ochre", builtin: true },
      { slug: "plan", name: "Plan bot", colour: "sea", builtin: true }, { slug: "travel", name: "Travel bot", colour: "clay", builtin: true },
      { slug: "gym-bot", name: "Gym bot", colour: "pine", builtin: false }, { slug: "shop-bot", name: "Shop bot", colour: "sand", builtin: false },
    ] },
    [`GET ${A}/listing/gym-bot`]: { listed: true },
    "GET /v1/bots/gym-bot/keys": { keys: [
      { id: "k1", label: "Website", masked: "tzb_3f9a••••", createdAt: Date.UTC(2026, 9, 2), lastUsedAt: FIXED_NOW - 4 * MIN, revokedAt: null, active: true },
      { id: "k2", label: "Testing", masked: "tzb_81c2••••", createdAt: Date.UTC(2026, 8, 12), lastUsedAt: FIXED_NOW - DAY, revokedAt: null, active: true },
    ] },
    [`GET ${A}/keys/gym-bot/usage?tz=${IST}`]: {
      usage: {
        month: "October", requests: 1284, paise: 3850,
        byKey: { "tzb_3f9a••••": { requests: 1192, paise: 3850, lastAt: FIXED_NOW - 4 * MIN }, "tzb_81c2••••": { requests: 92, paise: 0, lastAt: FIXED_NOW - DAY } },
        days: Array.from({ length: 28 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, requests: [8, 56, 33, 23, 64, 55, 63, 74, 57, 40, 37, 66, 74, 66, 85, 75, 44, 42, 92, 79, 88, 77, 104, 56, 44, 103, 101, 52][i]! })),
      },
      ratePerMin: 30, dayCapPaise: 500, endpoint: "https://api.tailzu.space/v1/bots/gym-bot/ask",
    },
    [`GET ${A}/draft`]: { draft: {
      sentence: "A bot that plans my workouts around my calendar and reminds me the night before.", updatedAt: FIXED_NOW - 9 * MIN,
      draft: {
        definition: { name: "Gym bot", slug: "gym-bot", colour: "pine", purpose: "Plans workouts that fit your week", principles: GYM.principles, skills: { ...GYM.skills, connectors: ["google-calendar"] }, tone: "upbeat" },
        tests: ["Plan my next week", "I'm sore, go easy"], connectors: [{ id: "google-calendar", name: "Google Calendar", status: "not_connected" }], warnings: [],
      },
      trial: [{ said: "Plan my next week", answered: "Three sessions, 40 minutes each. Connect your calendar and I'll skip your travel days.\n\n- Mon: Legs · 7:00 am\n- Wed: Upper body · 7:00 am\n- Sat: Run + core · 8:30 am" }],
    } },
    [`GET ${A}/store`]: {
      readyMade: [
        { id: "tailzu-study", kind: "ready", name: "Study bot", colour: "plum", purpose: "Turns Classroom work into a daily plan", by: "Tailzu", adds: 41200, status: null, does: ["Read new work from Google Classroom each evening.", "Split work into 25-minute blocks before the due date.", "Put the plan in my calendar only after I say yes."], will: "Read Classroom and your calendar", wont: "Submit work or message your teachers", apps: ["Google Classroom", "Calendar"] },
        { id: "tailzu-money", kind: "ready", name: "Money bot", colour: "stone", purpose: "Tracks UPI spends, never pays alone", by: "Tailzu", adds: 33000, status: null, does: [], will: "Note your spends and open UPI for you", wont: "Pay or move money by itself", apps: ["UPI"] },
        { id: "tailzu-recipe", kind: "ready", name: "Recipe bot", colour: "sand", purpose: "Cooks from what's in your fridge", by: "Tailzu", adds: 27000, status: null, does: [], will: "Suggest dishes, steps and a shopping list", wont: "Order or buy anything", apps: [] },
      ],
      people: [
        { id: "l1", kind: "people", slug: "shop-bot", name: "Shop bot", colour: "sand", purpose: "Weekly groceries at the best price", by: "Meera R.", adds: 12600, status: "added", does: [], will: "Search the web", wont: "Pay, book or send anything without your yes", apps: [] },
        { id: "l2", kind: "people", slug: "gym-bot", name: "Gym bot", colour: "pine", purpose: "Plans workouts around your calendar", by: "you", adds: 2140, status: "yours", does: [], will: "Use Google Calendar", wont: "Never plan on days I'm travelling", apps: ["Google Calendar"] },
      ],
    },
    [`GET ${A}/plan?tz=${IST}&week=0`]: { ...plan, travel: SAMPLE_PLAN_TRAVEL },
    [`GET ${A}/trip/7a1b2c3d-0000-4000-8000-0000000000aa/extras?tz=${IST}`]: { extras: SAMPLE_TRIP_EXTRAS },
    [`GET ${A}/trip`]: {
      trip: { id: "7a1b2c3d-0000-4000-8000-0000000000aa", place: "Pune", when: "14–16 Nov", who: "You + Rohan", spots: ["Sakshi and Arjun's wedding, Koregaon Park"], stays: SAMPLE_TRIP_EXTRAS.stays, packing: [
        { text: "Light jacket, 16° nights", done: false }, { text: "Aadhaar for check-in", done: false }, { text: "Snacks for the train", done: false },
        { text: "Clothes for 2 days", done: true }, { text: "Phone charger", done: true }, { text: "Power bank", done: true }, { text: "Rohan's inhaler", done: true }, { text: "Toothbrush kit", done: true },
      ] },
      facts: [{ id: "tf1", text: "Likes window seats" }, { id: "tf2", text: "Rohan needs his inhaler packed" }],
      bookings: [{ label: "Deccan Queen 12123 · 2 window seats · ₹790", url: "https://www.irctc.co.in/nget/train-search", at: FIXED_NOW - 2 * HOUR, said: "Trains from Mumbai to Pune on 14 Nov" }],
    },
    "GET /v1/files": { files: [
      { id: "f-1", name: "Hotel_Shanti_Residency_booking.pdf", mime: "application/pdf", bytes: 96_000, createdAt: FIXED_NOW - DAY, pages: 1 },
      { id: "f-2", name: "GST_Q2_draft.xlsx", mime: "application/vnd.ms-excel", bytes: 48_000, createdAt: FIXED_NOW - 2 * DAY },
    ] },
    // Spaces (tests/spaces-data.ts): Home with Mom and Rohan, Dev's Studio, one space whole, the chats.
    ...spacesApi(),
    "GET /v1/files/f-9": {
      file: { id: "f-9", name: "Ticket_BLR-GOI_14Nov.pdf", mime: "application/pdf", bytes: 182_000, createdAt: FIXED_NOW - 5 * MIN, pages: 1 },
      attachment: { id: "f-9", name: "Ticket_BLR-GOI_14Nov.pdf", mime: "application/pdf", bytes: 182_000, sha256: "a".repeat(64), kind: "pdf" },
    },
    [`POST ${A}/share/suggest`]: { pick: "travel", by: "rules", reasons: ["ticket"], ask: "Add this trip to my plan", line: "" },
  };
}
