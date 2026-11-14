/**
 * THE RENDER CHECK FOR BUILD 8.9.1's OWN THINGS (docs: perms2 §12 "Renders").
 *
 *   cd tulmi && npx tsx scripts/bots-render/perms2-shots.mts            # writes scripts/bots-render/out/
 *   PERMS2_OUT=/somewhere npx tsx scripts/bots-render/perms2-shots.mts
 *   PERMS2_DARK=1 npx tsx scripts/bots-render/perms2-shots.mts          # every switch off: the screens as they are today
 *   PERMS2_IPHONE_FIRST=1 npx tsx scripts/bots-render/perms2-shots.mts   # the shared switches on, every _ANDROID one off
 *
 * Every screen 8.9.1 changed, in each of its states, drawn by the apps' own renderers (render.ts): Plan Ease's "From this phone"
 * rows (off, each card open, both on, blocked, and Android's connectors instead); a plan item with *Add to my calendar* and
 * *Remind me when I get there* (off, the card, armed, Approximate only); the fitness bot's edit page with the Motion choice
 * and its card, and with the sleep sub-row and its card; the bot's page with the nights in its Moves line; What pings you with
 * the Focus and driving rows; and You, Privacy's own new lines.
 *
 * Each is also drawn WITHOUT its capability, which is what every older binary and the window get: the proof that a build which
 * cannot do a thing is sent nothing about it.
 */
process.env.PUBLIC_ORIGIN = "https://api.local";
process.env.SPACES_ENABLED = "true";
process.env.BOTS_APP = "true";
const DARK = process.env.PERMS2_DARK === "1";
/**
 * THE ROLLOUT AS OWNER.md §7 AND §10 DESCRIBE IT: the iPhone rows go on at submission and every `_ANDROID` switch stays
 * off. That is what an Android 8.9.1 phone really meets for a while, so it is worth looking at: its Plan Ease rows fall
 * back to the connectors, its driving row is gone (and the page tells a phone that was watching to stop), and You ›
 * Privacy describes none of the halves this build cannot do.
 */
const IPHONE_FIRST = process.env.PERMS2_IPHONE_FIRST === "1";
if (!DARK) {
  for (const k of [
    "PERM_LOCATION", "PERM_CONTACT_PICK", "PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID",
    "PERM_CALENDAR_ADD", "PERM_CALENDAR_READ", "PERM_REMINDERS", "PERM_FOCUS", "PERM_MOTION", "PERM_MOTION_DRIVE",
    "PERM_HEALTH_SLEEP_IOS", "PERM_HEALTH_SLEEP_ANDROID", "PERM_ARRIVAL",
    // The Android halves (8.9.1), so the Android shots below show the row and not the connector. Every one of these is off
    // in every deployed server; turning them on here is what makes an Android phone's own rows drawable at all.
    ...(IPHONE_FIRST ? [] : ["PERM_CALENDAR_READ_ANDROID", "PERM_MOTION_ANDROID", "PERM_MOTION_DRIVE_ANDROID", "PERM_ARRIVAL_ANDROID"]),
  ]) process.env[k] = "true";
}
for (const k of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "SUPABASE_ANON_KEY"]) process.env[k] ||= "preview";
process.env.SUPABASE_URL ||= "http://127.0.0.1:1";

const R = await import("./render.js");
const OUT = process.env.PERMS2_OUT ?? new URL("out/", import.meta.url).pathname;
const { IST } = await import("../../src/experience/bots/fixtures.js");
const { PLAN_DAY_API } = await import("./samples/planMake.js");

const A = "/v1/botsapp/bots";
const CAL = "/v1/botsapp/calendar";
/** Build 8.9.1's capability names, all of them, so each job can take one away. */
const WITH = ["Location1", "ContactPick1", "Health1", "CalendarAdd1", "CalendarRead1", "Reminders1", "Focus1", "Motion1", "HealthSleep1", "Arrival1"];

type Phone = { busy: boolean; busyAt: number; reminders: boolean; focusOn: boolean; focusHold: boolean; ai: boolean };
/** The sample day again, with the phone's own switches as this shot wants them. */
function dayWith(phone: Partial<Phone>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(PLAN_DAY_API)) {
    const d = JSON.parse(JSON.stringify(v)) as { phone?: Phone };
    d.phone = { busy: false, busyAt: 0, reminders: false, focusOn: false, focusHold: true, ai: false, ...(d.phone ?? {}), ...phone };
    out[k] = d;
  }
  return out;
}

// ------------------------------------------------------------------ a plan item with a place

const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const event = (arrive: boolean) => ({
  event: {
    id: EVENT_ID, seriesId: EVENT_ID, title: "Pick up dry cleaning", notes: "", place: "Koramangala, Bengaluru",
    where: "Koramangala", start: Date.UTC(2026, 9, 28, 12, 30), end: Date.UTC(2026, 9, 28, 13, 0), allDay: false,
    day: "2026-10-28", repeat: "", remindMin: 15, from: null, source: "me", fixed: false, ...(arrive ? { arrive: true } : {}),
  },
});
/** The details the item page reads beside the item: here, the armed arrival set as it would be with this item on. */
const details = {
  before: [], moves: [],
  arrivals: [{
    id: EVENT_ID.toLowerCase(), lat: 12.9345, lon: 77.6266, radiusM: 150,
    title: "You're at Koramangala Market", body: "Pick up dry cleaning", screen: "bots.plan.item",
  }],
  arrivePlace: "Koramangala Market",
};
const itemApi = (arrive: boolean) => ({
  [`GET ${CAL}/events/${EVENT_ID}?tz=${IST}`]: event(arrive),
  [`GET ${A}/plan/details?kind=event&id=${EVENT_ID}&tz=${IST}`]: details,
});

// ------------------------------------------------------------------ the fitness bot

const GYM = {
  slug: "gym-buddy", name: "Gym Buddy", colour: "moss", purpose: "Counts my gym days and keeps my streak",
  principles: ["Keep it short"], tone: "", builtin: false, publicCard: false,
  skills: { web: false, files: false, artifacts: false, code: false, research: false, health: false, healthSleep: false, connectors: [] },
};
const MOVES = {
  workouts: 9, lastDay: "2026-11-10", lastMinutes: 48, steps: 74_120, stepDays: 10, asOf: Date.parse("2026-11-13T09:40:00Z"),
  sleepLast: 430, sleepAvg: 410, sleepNights: 6,
};
const gymApi = (o: { health?: boolean; sleep?: boolean; motion?: boolean; moves?: unknown } = {}) => ({
  "GET /v1/bots/gym-buddy": { bot: { ...GYM, skills: {
    ...GYM.skills, health: o.health === true, healthSleep: o.sleep === true,
    // 0094: which reader this bot's days come from, which the row's own words follow.
    healthSource: o.motion === true ? "motion" : "health",
  } } },
  "GET /v1/bots/gym-buddy/health/moves": { moves: o.moves ?? null },
  "GET /v1/bots/gym-buddy/memory": { facts: [], summary: "", turns: 0 },
  "GET /v1/bots/gym-buddy/connectors": { connectors: [] },
  "GET /v1/botsapp/bots/chat/gym-buddy": { turns: [] },
  "GET /v1/connectors": { connectors: [] },
  "GET /v1/bots": { bots: [{ slug: "gym-buddy", colour: "moss", name: "Gym Buddy", builtin: false }] },
  "GET /v1/botsapp/bots/listing/gym-buddy": { listed: false },
});

// ------------------------------------------------------------------ What pings you

const notifyApi = (o: { focusOn?: boolean; focusHold?: boolean; driveWait?: boolean } = {}) => ({
  [`GET /v1/you/notify?tz=${IST}`]: {
    settings: {
      monthLimitPaise: 100_000, stopAtLimit: false,
      notify: {
        done: "ping", summary: true, summaryAt: 21 * 60, quiet: false, quietFrom: 23 * 60, quietTo: 7 * 60, botsOff: [],
        calls: true, follow: true, followTell: true, ringMax: 6, followFrom: [], phoneCall: false,
        focusHold: o.focusHold !== false, driveWait: o.driveWait !== false,
      },
      privacy: { personalise: true },
    },
    today: { done: 3, needs: 1, spentPaise: 1200 }, line: "3 things done", calls: true, name: "X0",
    follow: true, followFrom: [], phone: null, focusOn: o.focusOn === true,
  },
});

type Job = { id: string; base: string; client: "phone" | "desktop"; platform?: "android"; params?: Record<string, string | number | boolean>; api?: Record<string, unknown>; state?: Record<string, unknown>; without?: string[]; height?: number };

const DARK_JOBS: Job[] = [
  // Every switch off: the three screens 8.9.1 touched are the ones they were, with no new row and no card.
  { id: "bots.plan", base: "p2-dark-1-plan", client: "phone", api: dayWith({}), height: 2600 },
  { id: "bots.privacy", base: "p2-dark-2-privacy", client: "phone", height: 2400 },
  { id: "bots.notify", base: "p2-dark-3-notify", client: "phone", api: notifyApi(), height: 2400 },
];

const LIVE_JOBS: Job[] = [
  // Plan Ease: the two rows off, each card open, both on, blocked, and the window and an older binary with neither.
  { id: "bots.plan", base: "p2-cal-1-rows-off", client: "phone", api: dayWith({}), height: 2600 },
  { id: "bots.plan", base: "p2-cal-2-busy-card", client: "phone", api: dayWith({}), state: { busyCard: true }, height: 2800 },
  { id: "bots.plan", base: "p2-cal-3-rem-card", client: "phone", api: dayWith({ ai: true }), state: { remCard: true }, height: 2800 },
  { id: "bots.plan", base: "p2-cal-4-rem-card-no-ai", client: "phone", api: dayWith({ ai: false }), state: { remCard: true }, height: 2800 },
  // No injected on-states: the page's own state follows the data now (planHome homeState), so the renders show what the
  // server really sends. The same for the sleep row below.
  { id: "bots.plan", base: "p2-cal-5-both-on", client: "phone", api: dayWith({ busy: true, busyAt: Date.now(), reminders: true }), height: 2600 },
  { id: "bots.plan", base: "p2-cal-6-blocked", client: "phone", api: dayWith({}), state: { busyBlocked: true, remBlocked: true }, height: 2800 },
  { id: "bots.plan", base: "p2-cal-7-no-capability", client: "phone", api: dayWith({}), without: ["CalendarRead1", "Reminders1"], height: 2600 },
  { id: "bots.plan", base: "p2-cal-8-window", client: "desktop", api: dayWith({}), height: 1600 },
  // The plan item: Add to my calendar (no card at all), and the arrival switch off, its card, armed, and Approximate only.
  { id: "bots.plan.item", base: "p2-arr-1-off", client: "phone", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), height: 1400 },
  { id: "bots.plan.item", base: "p2-arr-2-card", client: "phone", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), state: { arriveCard: true }, height: 1600 },
  { id: "bots.plan.item", base: "p2-arr-3-armed", client: "phone", params: { kind: "event", id: EVENT_ID }, api: itemApi(true), state: { arriveOn: true }, height: 1400 },
  { id: "bots.plan.item", base: "p2-arr-4-approximate", client: "phone", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), state: { arriveCoarse: true }, height: 1500 },
  { id: "bots.plan.item", base: "p2-arr-5-no-capability", client: "phone", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), without: ["Arrival1", "CalendarAdd1"], height: 1400 },
  { id: "bots.plan.item", base: "p2-arr-6-window", client: "desktop", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), height: 1100 },
  // The fitness bot: the Motion choice and its card (health off), the sleep sub-row and its card (health on).
  { id: "bots.edit", base: "p2-mot-1-choice", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(), height: 1700 },
  { id: "bots.edit", base: "p2-mot-2-card", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(), state: { motionCard: true }, height: 1800 },
  { id: "bots.edit", base: "p2-sle-1-row", client: "phone", params: { slug: "gym-buddy" }, api: gymApi({ health: true }), height: 1700 },
  { id: "bots.edit", base: "p2-sle-2-card", client: "phone", params: { slug: "gym-buddy" }, api: gymApi({ health: true }), state: { sleepCard: true }, height: 1800 },
  { id: "bots.edit", base: "p2-sle-3-on", client: "phone", params: { slug: "gym-buddy" }, api: gymApi({ health: true, sleep: true }), height: 1700 },
  { id: "bots.edit", base: "p2-sle-4-no-capability", client: "phone", params: { slug: "gym-buddy" }, api: gymApi({ health: true }), without: ["HealthSleep1", "Motion1"], height: 1700 },
  { id: "bots.bot", base: "p2-sle-5-moves", client: "phone", params: { slug: "gym-buddy" }, api: gymApi({ health: true, sleep: true, moves: MOVES }), height: 1200 },
  // A bot already counting FROM MOTION (0094): its row names that reader, and there is no sleep sub-row for it.
  { id: "bots.edit", base: "p2-mot-3-on", client: "phone", params: { slug: "gym-buddy" }, api: gymApi({ health: true, motion: true }), height: 1700 },
  // What pings you: the Focus steps and the driving row, on the phone and in the window.
  { id: "bots.notify", base: "p2-foc-1-phone", client: "phone", api: notifyApi({ focusOn: true }), height: 2600 },
  { id: "bots.notify", base: "p2-foc-2-phone-idle", client: "phone", api: notifyApi({ focusOn: false }), height: 2600 },
  { id: "bots.notify", base: "p2-foc-3-no-capability", client: "phone", api: notifyApi(), without: ["Focus1", "Motion1"], height: 2400 },
  { id: "bots.notify", base: "p2-foc-4-window", client: "desktop", api: notifyApi({ focusOn: true }), height: 1600 },
  // The driving row's own card (perms2 §5.2), and the Settings line a refusal iOS will not ask about again leaves.
  { id: "bots.notify", base: "p2-drv-1-card", client: "phone", api: notifyApi({ driveWait: false }), state: { driveCard: true }, height: 2800 },
  { id: "bots.notify", base: "p2-drv-2-blocked", client: "phone", api: notifyApi({ driveWait: false }), state: { driveBlocked: true }, height: 2600 },
  // You, Privacy: What this phone shares, with all of 8.9.1's lines.
  { id: "bots.privacy", base: "p2-pri-1-phone", client: "phone", height: 2600 },
  { id: "bots.privacy", base: "p2-pri-2-window", client: "desktop", height: 1600 },

  // ---------------------------------------------------------------- ANDROID (8.9.1): the three halves, and their words
  //
  // The same screens on an Android phone, with the Android server switches on, which is the only way the rows are drawn
  // there at all. What to look at: the calendar card's two changed lines, the Motion row and card promising steps and no
  // workouts, the driving card's "sometimes neither", the arrival card's Play disclosure and the second card behind it,
  // and Privacy's three Android lines.
  { id: "bots.plan", base: "p2-and-1-rows-off", client: "phone", platform: "android", api: dayWith({}), height: 2600 },
  { id: "bots.plan", base: "p2-and-2-busy-card", client: "phone", platform: "android", api: dayWith({}), state: { busyCard: true }, height: 2800 },
  { id: "bots.plan", base: "p2-and-3-both-on", client: "phone", platform: "android", api: dayWith({ busy: true, busyAt: Date.now() }), height: 2600 },
  // An Android phone whose BINARY has no calendar read: the server's own Google Calendar connector in that place instead.
  { id: "bots.plan", base: "p2-and-4-connector", client: "phone", platform: "android", api: dayWith({}), without: ["CalendarRead1"], height: 2600 },
  { id: "bots.edit", base: "p2-and-5-motion-row", client: "phone", platform: "android", params: { slug: "gym-buddy" }, api: gymApi(), height: 1700 },
  { id: "bots.edit", base: "p2-and-6-motion-card", client: "phone", platform: "android", params: { slug: "gym-buddy" }, api: gymApi(), state: { motionCard: true }, height: 1800 },
  { id: "bots.edit", base: "p2-and-7-motion-on", client: "phone", platform: "android", params: { slug: "gym-buddy" }, api: gymApi({ health: true, motion: true }), height: 1700 },
  { id: "bots.bot", base: "p2-and-8-moves-no-workouts", client: "phone", platform: "android", params: { slug: "gym-buddy" }, api: gymApi({ health: true, motion: true, moves: MOVES }), height: 1200 },
  { id: "bots.notify", base: "p2-and-9-drive-card", client: "phone", platform: "android", api: notifyApi({ driveWait: false }), state: { driveCard: true }, height: 2800 },
  { id: "bots.plan.item", base: "p2-and-10-arrival-card", client: "phone", platform: "android", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), state: { arriveCard: true }, height: 1700 },
  { id: "bots.plan.item", base: "p2-and-11-background-card", client: "phone", platform: "android", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), state: { arriveBackCard: true }, height: 1700 },
  { id: "bots.plan.item", base: "p2-and-12-background-still", client: "phone", platform: "android", params: { kind: "event", id: EVENT_ID }, api: itemApi(false), state: { arriveBackStill: true }, height: 1500 },
  { id: "bots.privacy", base: "p2-and-13-privacy", client: "phone", platform: "android", height: 2600 },
];

const JOBS = DARK ? DARK_JOBS : LIVE_JOBS;

const browser = await R.launchBrowser();
let bad = 0;
try {
  for (const j of JOBS) {
    const r = await R.renderClient(browser, {
      screenId: j.id, client: j.client, params: j.params ?? {}, out: OUT, base: `${j.base}.${j.client}`,
      api: j.api ?? {}, quiet: true, compare: false,
      ...(j.platform ? { platform: j.platform } : {}),
      with: WITH.filter((w) => !(j.without ?? []).includes(w)),
      ...(j.state ? { state: j.state } : {}),
      shot: { height: j.height ?? 1400 },
    });
    const real = r.errors.filter((e) => !/WebSocket|tunnel|api\.local/.test(e));
    for (const s of r.spills) console.log(`  spill ${j.base}: ${s}`);
    for (const e of real) { bad += 1; console.error(`  ERROR ${j.base}: ${e}`); }
    console.log(`${real.length ? "ERRORS" : "ok    "} ${j.base}.${j.client}.png${r.misses.length ? `   (no answer: ${r.misses.join(", ")})` : ""}`);
  }
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
