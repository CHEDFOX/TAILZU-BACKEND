/**
 * THE RENDER CHECK FOR `primed: true` (shared/types/sdui.ts `primed`; tests/primed.test.ts).
 *
 *   cd tulmi && npx tsx scripts/bots-render/primed-shots.mts          # writes scripts/bots-render/out/
 *   PRIMED_OUT=/somewhere npx tsx scripts/bots-render/primed-shots.mts
 *
 * Every card whose Continue now goes straight to the system prompt, drawn by the apps' own renderers (render.ts), in
 * each context that draws it: the first-arrival card over Home, Keylessbord's own card, the call screen's "Let X0
 * hear you", What pings you' driving card, and Android's "Allow all the time" hand-off — on the iPhone, on an
 * Android phone and in the window. Plus the phone's own screens: the keyboard primer, the old onboarding's voice
 * step, and the ones on the other side of the line, whose ask keeps the phone's own box.
 *
 * WHAT TO LOOK AT: each card must read as the ONE explanation before the system asks — a title, why, and Continue
 * with nothing beside it to put the prompt off. Nothing on the server changed what the first thirteen cards SAY, so
 * a shot that differs from the same card before this change is a shot to look at twice. The last few are the
 * screens this change did touch: the primer before and after the prompt is answered, the voice step's Continue
 * where its ✕ used to be, and the three whose button now reads the permission before asking for it.
 */
process.env.PUBLIC_ORIGIN = "https://api.local";
process.env.SPACES_ENABLED = "true";
process.env.BOTS_APP = "true";
for (const k of [
  "PERM_LOCATION", "PERM_CONTACT_PICK", "PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID", "PERM_CALENDAR_ADD",
  "PERM_CALENDAR_READ", "PERM_CALENDAR_READ_ANDROID", "PERM_REMINDERS", "PERM_FOCUS", "PERM_MOTION",
  "PERM_MOTION_ANDROID", "PERM_MOTION_DRIVE", "PERM_MOTION_DRIVE_ANDROID", "PERM_ARRIVAL", "PERM_ARRIVAL_ANDROID",
]) process.env[k] = "true";
for (const k of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "SUPABASE_ANON_KEY"]) process.env[k] ||= "preview";
process.env.SUPABASE_URL ||= "http://127.0.0.1:1";

const R = await import("./render.js");
const OUT = process.env.PRIMED_OUT ?? new URL("out/", import.meta.url).pathname;
const { IST } = await import("../../src/experience/bots/fixtures.js");
const { keyboardPrimerScreen } = await import("../../src/experience/phone/keyboardPrimer.js");
// The Bots app draws the same screen in its own kit, off the same `actions` (screens/handoff.ts), which is what a
// Bots build really gets; the plain one is the old app's vocabulary and the Bots renderer does not draw it.
const { botsKeyboardPrimer, botsFlowArm } = await import("../../src/experience/bots/screens/handoff.js");
// The phone's own screens on the other side of the line: the ones whose ask keeps the phone's box, and the old
// onboarding's voice step, which is now one of the cards.
const { onboardingVoice } = await import("../../src/experience/phone/onboarding/voice.js");
const { flowArmScreen } = await import("../../src/experience/phone/flowArm.js");
const { onboardScreen } = await import("../../src/experience/onboard/screens.js");

const { THEME: PHONE_THEME } = await import("../../src/experience/phone/theme.js");

/** The context those builders take, with nothing from a real request in it. */
const phoneCtx = (o: Record<string, unknown> = {}): never => ({
  personality: {}, language: "en", platform: "ios", formFactor: "phone", can: new Set<string>(), params: {}, ...o,
} as never);
const primer = () => botsKeyboardPrimer(keyboardPrimerScreen(phoneCtx({ params: { session: "s1" } })));
/**
 * The old app's screens carry no `theme` of their own: they read the one the bootstrap sent (phone/theme.ts), and
 * this harness sends no bootstrap. Without it every `$color.text` resolves to black on a black screen and the shot
 * is a black rectangle. So the theme the phone really has is put on the screen here, in the SHOT only — nothing the
 * server sends changes.
 */
const themed = <T,>(s: T): T => ({ ...(s as object), theme: PHONE_THEME } as T);

const A = "/v1/botsapp/bots";
const CAL = "/v1/botsapp/calendar";
/** Build 8.9.1's capabilities, and the phone pieces the call screen needs. */
const WITH = ["Location1", "ContactPick1", "Health1", "CalendarAdd1", "CalendarRead1", "Reminders1", "Focus1", "Motion1", "HealthSleep1", "Arrival1", "DeskMicAsk", "DeskCamAsk", "DeskAskSetup"];

/** The first-arrival card is due, and the bot's hello is over, so the card is what is on screen. */
const HOME_API = { "GET /v1/bots/first-run/arrival": { due: true, kind: "first" } };
const FIRST_RUN_STATE = {
  keyboardEnabled: false, keyboardReady: false, micGranted: false, axGranted: false, micAsked: false,
  permitClosed: false, helloSeen: true, helloGone: true,
};

const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const ITEM_API = {
  [`GET ${CAL}/events/${EVENT_ID}?tz=${IST}`]: {
    event: {
      id: EVENT_ID, seriesId: EVENT_ID, title: "Pick up dry cleaning", notes: "", place: "Koramangala, Bengaluru",
      where: "Koramangala", start: Date.UTC(2026, 9, 28, 12, 30), end: Date.UTC(2026, 9, 28, 13, 0), allDay: false,
      day: "2026-10-28", repeat: "", remindMin: 15, from: null, source: "me", fixed: false,
    },
  },
  [`GET ${A}/plan/details?kind=event&id=${EVENT_ID}&tz=${IST}`]: {
    before: [], moves: [], arrivePlace: "Koramangala Market",
    arrivals: [{ id: EVENT_ID.toLowerCase(), lat: 12.9345, lon: 77.6266, radiusM: 150, title: "You're at Koramangala Market", body: "Pick up dry cleaning", screen: "bots.plan.item" }],
  },
};

const CALL_ID = "eeeeeeee-0000-4000-8000-0000000000c1";
const CALL_API = {
  [`GET ${A}/plan/calls/${CALL_ID}`]: {
    id: CALL_ID, state: "answered", origin: "server", name: "X0", source: "plan", line: "Leave by 9 pm",
    ringAt: Date.UTC(2026, 9, 28, 14, 0), missedClock: "7:30 pm", answeredAt: Date.UTC(2026, 9, 28, 14, 1),
    endedAt: null, late: false, ai: true, opening: "Ready when you are.",
    card: { item: `pe:${EVENT_ID}:1`, title: "Leave for the clinic", sub: "9 pm · Koramangala", pay: false },
  },
};

const NOTIFY_API = {
  [`GET /v1/you/notify?tz=${IST}`]: {
    settings: {
      monthLimitPaise: 100_000, stopAtLimit: false,
      notify: {
        done: "ping", summary: true, summaryAt: 21 * 60, quiet: false, quietFrom: 23 * 60, quietTo: 7 * 60,
        botsOff: [], calls: true, follow: true, followTell: true, ringMax: 6, followFrom: [], phoneCall: false,
        focusHold: true, driveWait: false,
      },
      privacy: { personalise: true },
    },
    today: { done: 3, needs: 1, spentPaise: 1200 }, line: "3 things done", calls: true, name: "X0",
    follow: true, followFrom: [], phone: null, focusOn: false,
  },
};

type Job = {
  id: string; base: string; client: "phone" | "desktop"; platform?: "android";
  params?: Record<string, string | number | boolean>; api?: Record<string, unknown>;
  state?: Record<string, unknown>; served?: unknown; height?: number;
};

const JOBS: Job[] = [
  // The first arrival: "Let X0 Bot hear you", Continue, and nothing else.
  { id: "bots.home", base: "pr-1-arrival-iphone", client: "phone", api: HOME_API, state: FIRST_RUN_STATE, height: 1800 },
  { id: "bots.home", base: "pr-2-arrival-android", client: "phone", platform: "android", api: HOME_API, state: FIRST_RUN_STATE, height: 1800 },
  { id: "bots.home", base: "pr-3-arrival-window", client: "desktop", api: HOME_API, state: FIRST_RUN_STATE, height: 1200 },
  // Keylessbord's own card, the same step in its page.
  { id: "bots.keybot", base: "pr-4-keybot-iphone", client: "phone", state: FIRST_RUN_STATE, height: 2200 },
  { id: "bots.keybot", base: "pr-5-keybot-android", client: "phone", platform: "android", state: FIRST_RUN_STATE, height: 2200 },
  { id: "bots.keybot", base: "pr-6-keybot-window", client: "desktop", state: FIRST_RUN_STATE, height: 1400 },
  // The call screen's microphone card.
  { id: "bots.plan.call", base: "pr-7-call-iphone", client: "phone", params: { call: CALL_ID }, api: CALL_API, state: { micCard: true, phase: "idle" }, height: 1600 },
  { id: "bots.plan.call", base: "pr-8-call-android", client: "phone", platform: "android", params: { call: CALL_ID }, api: CALL_API, state: { micCard: true, phase: "idle" }, height: 1600 },
  // What pings you: the driving card, both phones. The window has no driving row at all — that shot is the proof.
  { id: "bots.notify", base: "pr-9-drive-iphone", client: "phone", api: NOTIFY_API, state: { driveCard: true }, height: 2800 },
  { id: "bots.notify", base: "pr-10-drive-android", client: "phone", platform: "android", api: NOTIFY_API, state: { driveCard: true }, height: 2800 },
  { id: "bots.notify", base: "pr-11-drive-window", client: "desktop", api: NOTIFY_API, height: 1600 },
  // Android's second arrival card: Play's prominent disclosure, then Open Settings.
  { id: "bots.plan.item", base: "pr-12-background-android", client: "phone", platform: "android", params: { kind: "event", id: EVENT_ID }, api: ITEM_API, state: { arriveBackCard: true }, height: 1700 },
  { id: "bots.plan.item", base: "pr-13-arrival-iphone", client: "phone", params: { kind: "event", id: EVENT_ID }, api: ITEM_API, state: { arriveCard: true }, height: 1600 },
  // The keyboard primer: a screen of the phone's own, drawn as the server sends it. Continue and NOTHING beside it
  // — "Open X0 Bot Settings" waits for the prompt to be answered, which is the second shot.
  { id: "keyboard_primer", base: "pr-14-primer-iphone", client: "phone", served: primer(), height: 1500 },
  { id: "keyboard_primer", base: "pr-15-primer-after-refusal", client: "phone", served: R.withState(primer(), { micAsked: true }), height: 1500 },
  // The old onboarding's voice step, now one of the cards: Continue, the microphone named, and the ✕ gone.
  //
  // READ THIS SHOT KNOWING WHAT DRAWS IT. Its words are Heading / Paragraph nodes, and the phone's registry holds
  // neither any more (TAILZU-FRONTEND app/src/sdui/components/index.ts: "a type that is not here draws its
  // fallback, or nothing"). So today's renderer draws the pill and nothing else, and only the older builds this
  // screen is still served to — the ones without OnboardStage, which get `onboard`'s job done here instead — draw
  // the words around it. What this shot is for is the control: one dark pill saying Continue, where a ✕ and
  // "Allow access" used to be.
  { id: "onboarding", base: "pr-16-onboarding-voice-iphone", client: "phone", served: themed(onboardingVoice(phoneCtx())), height: 844 },
  // AND THE OTHER SIDE OF THE LINE, where the phone's own box is the explanation. Each of these reads the
  // permission before it asks, so a phone that has already answered sees no box at all. flow_arm in the Bots app's
  // own kit, which is the tree a build that draws the box really receives (screens/handoff.ts).
  { id: "flow_arm", base: "pr-17-flow-arm-iphone", client: "phone", served: botsFlowArm(flowArmScreen(phoneCtx())), height: 844 },
  { id: "bots.keybot.on", base: "pr-18-keybot-on-iphone", client: "phone", height: 2200 },
  {
    id: "onboard", base: "pr-19-make-me-yours-keyboard", client: "phone", height: 1900,
    // Step 2 of the new onboarding, the keyboard: its Open Settings is the ask that is read first.
    served: R.withState(onboardScreen(phoneCtx({ can: new Set(["OnboardStage", "BlipSpot"]), connectorsOn: false })), { step: 1 }),
  },
];

const browser = await R.launchBrowser();
let bad = 0;
try {
  for (const j of JOBS) {
    const r = await R.renderClient(browser, {
      screenId: j.id, client: j.client, params: j.params ?? {}, out: OUT, base: `${j.base}.${j.client}`,
      api: j.api ?? {}, quiet: true, compare: false, with: WITH,
      ...(j.platform ? { platform: j.platform } : {}),
      ...(j.state ? { state: j.state } : {}),
      ...(j.served ? { served: j.served } : {}),
      shot: { height: j.height ?? 1400 },
    });
    const real = r.errors.filter((e) => !/WebSocket|tunnel|api\.local/.test(e));
    for (const s of r.spills) console.log(`  spill ${j.base}: ${s}`);
    for (const e of real) { bad += 1; console.error(`  ERROR ${j.base}: ${e}`); }
    console.log(`${real.length ? "ERRORS" : "ok    "} ${j.base}.${j.client}.png${r.misses.length ? `   (no answer: ${r.misses.join(", ")})` : ""}`);
  }
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
