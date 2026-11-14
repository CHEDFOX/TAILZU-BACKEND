/**
 * THE RENDER CHECK FOR LOCATION, CONTACTS AND HEALTH (docs: perms §8 "Renders").
 *
 *   cd tulmi && npx tsx scripts/bots-render/perms-shots.mts            # writes scripts/bots-render/out/
 *   PERMS_OUT=/somewhere npx tsx scripts/bots-render/perms-shots.mts
 *
 * Every screen the three features changed, in each of its states, drawn by the apps' own renderers (render.ts), on a page tall
 * enough to hold the whole of it: the day-starts card with the button, with the card open, with the area found and with
 * location turned off in Settings; the Invite page and Spaces' start screen, preview shut and open; the bot's edit page with
 * the health row off, its card, the row on, refused and with no Health Connect; the bot's page with the Moves line and with
 * nothing counted yet; and You, Privacy's "What this phone shares".
 *
 * Each one is also drawn WITHOUT its capability, which is what every older binary and the window get: the proof that a build
 * that cannot do it is sent nothing about it.
 *
 */
process.env.PUBLIC_ORIGIN = "https://api.local";
process.env.SPACES_ENABLED = "true";
process.env.BOTS_APP = "true";
/**
 * The switches are on here (they ship off), because a render of a screen nobody can see says nothing. PERMS_DARK=1 turns
 * them all off instead and draws the one screen that has to look like today's with nothing switched on: You > Privacy.
 */
const DARK = process.env.PERMS_DARK === "1";
if (!DARK) {
  process.env.PERM_LOCATION = "true";
  process.env.PERM_CONTACT_PICK = "true";
  process.env.PERM_HEALTH_IOS = "true";
  process.env.PERM_HEALTH_ANDROID = "true";
}
for (const k of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "SUPABASE_ANON_KEY"]) process.env[k] ||= "preview";
process.env.SUPABASE_URL ||= "http://127.0.0.1:1";

const R = await import("./render.js");
const OUT = process.env.PERMS_OUT ?? new URL("out/", import.meta.url).pathname;

const PLAN_TRAVEL = { on: true, pending: false, home: "", homeFound: false, legs: [], headsUp: [], savedWeekMin: 0, credits: [] };
const SPACE = {
  id: "s1", name: "Family", mine: true, me: { admin: true, perms: ["invite", "activity"] }, members: [], bots: [],
  invite: null, roles: [], code: "7KQ-29D",
  mailPreview: {
    sender: "X0 Bot (noreply@x0bot.com), for Asha",
    subject: "Asha invited you to Family on X0 Bot",
    text: "Asha invited you to Family on X0 Bot.\n\nSign in to X0 Bot with this email (their email) and the invite is waiting: open Spaces, tap your bot, and tap Accept.\n\nSigning in with another email? Open Spaces, tap your bot, and type this code: 7KQ-29D. Asha will let you in.\n\nThe space's admin can see and share your work and messages there.\n\nGet X0 Bot: https://x0bot.com/i/7KQ29D\n\nIf you weren't expecting this, you can ignore it.",
  },
};
const GYM = {
  slug: "gym-buddy", name: "Gym Buddy", colour: "moss", purpose: "Counts my gym days and keeps my streak",
  principles: ["Keep it short"], tone: "", builtin: false, publicCard: false,
  skills: { web: false, files: false, artifacts: false, code: false, research: false, health: false, connectors: [] },
};
const gymApi = (health: boolean, moves?: unknown) => ({
  "GET /v1/bots/gym-buddy": { bot: { ...GYM, skills: { ...GYM.skills, health } } },
  // The Moves counts are their own route (routes/bots/botHealth.ts), away from the file that hosts POST .../ask.
  "GET /v1/bots/gym-buddy/health/moves": { moves: moves ?? null },
  "GET /v1/bots/gym-buddy/memory": { facts: [], summary: "", turns: 0 },
  "GET /v1/bots/gym-buddy/connectors": { connectors: [] },
  "GET /v1/botsapp/bots/chat/gym-buddy": { turns: [] },
  "GET /v1/connectors": { connectors: [] },
  "GET /v1/bots": { bots: [{ slug: "gym-buddy", colour: "moss", name: "Gym Buddy", builtin: false }] },
  "GET /v1/botsapp/bots/listing/gym-buddy": { listed: false },
});
const MOVES = { workouts: 9, lastDay: "2026-11-10", lastMinutes: 48, steps: 74_120, stepDays: 10, asOf: Date.parse("2026-11-13T09:40:00Z") };

type Job = { id: string; base: string; client: "phone" | "desktop"; params?: Record<string, string | number | boolean>; api?: Record<string, unknown>; state?: Record<string, unknown>; without?: string[]; height?: number };

const WITH = ["Location1", "ContactPick1", "Health1"];
const { PLAN_DAY_API } = await import("./samples/planMake.js");
/** The sample day, but with no area saved yet, so the dashed "Where does your day start?" card is the one drawn. */
const planApi: Record<string, unknown> = Object.fromEntries(Object.entries(PLAN_DAY_API).map(([k, v]) => {
  const d = v as { travel?: Record<string, unknown> };
  return [k, d?.travel ? { ...d, travel: { ...d.travel, ...PLAN_TRAVEL } } : v];
}));
const spaceApi = { "GET /v1/botsapp/bots/spaces/s1": { space: SPACE, items: [], payments: [], tasks: [], mailReady: true } };

/** The preview before any draft exists (botsBots/spaces.ts blankPreview): the words stand in for what is not there yet. */
const BLANK_PREVIEW = {
  sender: "X0 Bot (noreply@x0bot.com), for You",
  subject: "You invited you to their space on X0 Bot",
  text: "You invited you to their space on X0 Bot.\n\nSign in to X0 Bot with this email (their email) and the invite is waiting: open Spaces, tap your bot, and tap Accept.\n\nSigning in with another email? Open Spaces, tap your bot, and type this code: the space's code. You will let you in.\n\nThe space's admin can see and share your work and messages there.\n\nGet X0 Bot: https://api.local/s/bots.spaces\n\nIf you weren't expecting this, you can ignore it.",
};
const spacesFull = (draft: unknown) => ({
  "GET /v1/botsapp/bots/spaces?full=1": {
    spaces: [], you: "You", unread: 0, invitations: [], requests: [], asked: [], draft, mailPreview: BLANK_PREVIEW,
  },
});
const spacesApi: Record<string, unknown> = spacesFull({
  id: "d1", name: null, invites: [{ code: "AAAA1111", email: "rahul@example.in", at: Date.now(), mail: "sent" }], mailPreview: SPACE.mailPreview,
});

const DARK_JOBS: Job[] = [
  // Every switch off: the Privacy screen is the one it was, with no card and no row about a button nobody has.
  { id: "bots.privacy", base: "pri-3-dark-phone", client: "phone", height: 2100 },
  { id: "bots.privacy", base: "pri-4-dark-window", client: "desktop", height: 1500 },
];

const LIVE_JOBS: Job[] = [
  // Location: the card, the card open, the words found, blocked; and the phone without the capability.
  { id: "bots.plan", base: "loc-1-button", client: "phone", api: planApi, height: 2400 },
  { id: "bots.plan", base: "loc-2-card", client: "phone", api: planApi, state: { home_locate: true }, height: 2400 },
  { id: "bots.plan", base: "loc-3-found", client: "phone", api: planApi, state: { home_near: "HSR Layout, Bengaluru" }, height: 2400 },
  { id: "bots.plan", base: "loc-4-blocked", client: "phone", api: planApi, state: { locBlocked: true }, height: 2400 },
  { id: "bots.plan", base: "loc-5-no-capability", client: "phone", api: planApi, without: ["Location1"], height: 2400 },
  { id: "bots.plan", base: "loc-6-window", client: "desktop", api: planApi, height: 1600 },
  // Contacts: the invite page and Spaces' start screen, preview shut and open.
  { id: "bots.space.invite", base: "con-1-invite", client: "phone", params: { id: "s1" }, api: spaceApi, height: 1300 },
  { id: "bots.space.invite", base: "con-2-invite-open", client: "phone", params: { id: "s1" }, api: spaceApi, state: { mailOpen: true }, height: 1500 },
  { id: "bots.space.invite", base: "con-3-no-capability", client: "phone", params: { id: "s1" }, api: spaceApi, without: ["ContactPick1"], height: 1300 },
  { id: "bots.space.invite", base: "con-4-window", client: "desktop", params: { id: "s1" }, api: spaceApi, height: 1100 },
  { id: "bots.spaces", base: "con-5-start", client: "phone", api: spacesApi, state: { creating: true, mailOpen: true }, height: 2000 },
  // The very first invite a person ever sends: no draft yet, so the preview is the blank one, and it is still in front
  // of them before anything goes (App Review 5.1.2(v)).
  { id: "bots.spaces", base: "con-6-start-first", client: "phone", api: spacesFull(null), state: { creating: true, mailOpen: true }, height: 2000 },
  // Health: the row off, the card, the row on with the Moves line, and no capability.
  { id: "bots.edit", base: "hea-1-row-off", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(false), height: 1500 },
  { id: "bots.edit", base: "hea-2-card", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(false), state: { healthCard: true }, height: 1600 },
  { id: "bots.edit", base: "hea-3-row-on", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true), state: { healthOn: true }, height: 1500 },
  { id: "bots.edit", base: "hea-4-blocked", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true), state: { healthOn: true, healthBlocked: true }, height: 1500 },
  { id: "bots.edit", base: "hea-5-missing", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true), state: { healthOn: true, healthGone: true }, height: 1500 },
  { id: "bots.edit", base: "hea-6-no-capability", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(false), without: ["Health1"], height: 1500 },
  { id: "bots.bot", base: "hea-7-moves", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true, MOVES), height: 1100 },
  { id: "bots.bot", base: "hea-8-nothing-yet", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true, { workouts: 0, lastDay: null, lastMinutes: 0, steps: 0, stepDays: 0, asOf: 0 }), height: 1100 },
  { id: "bots.edit", base: "hea-9-window", client: "desktop", params: { slug: "gym-buddy" }, api: gymApi(true), height: 1200 },
  // STOP ONLY: a bot that is counting keeps a way off on the window, and on a phone whose switch has gone off since.
  { id: "bots.edit", base: "hea-10-off-only-window", client: "desktop", params: { slug: "gym-buddy" }, api: gymApi(true), state: { healthOn: true }, without: ["Health1"], height: 1200 },
  { id: "bots.edit", base: "hea-11-off-only-phone", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true), state: { healthOn: true }, without: ["Health1"], height: 1500 },
  // The quiet re-read came back denied: the row still says on, so the page says the counting has stopped.
  { id: "bots.bot", base: "hea-12-not-here", client: "phone", params: { slug: "gym-buddy" }, api: gymApi(true, MOVES), state: { healthNotHere: true }, height: 1100 },
  // You, Privacy: What this phone shares.
  { id: "bots.privacy", base: "pri-1-phone", client: "phone", height: 2100 },
  { id: "bots.privacy", base: "pri-2-window", client: "desktop", height: 1500 },
];

const JOBS = DARK ? DARK_JOBS : LIVE_JOBS;

const browser = await R.launchBrowser();
let bad = 0;
try {
  for (const j of JOBS) {
    const r = await R.renderClient(browser, {
      screenId: j.id, client: j.client, params: j.params ?? {}, out: OUT, base: `${j.base}.${j.client}`,
      api: j.api ?? {}, quiet: true, compare: false,
      with: WITH.filter((w) => !(j.without ?? []).includes(w)),
      ...(j.state ? { state: j.state } : {}),
      shot: { height: j.height ?? 1200 },
    });
    const real = r.errors.filter((e) => !/WebSocket|tunnel|api\.local/.test(e));
    for (const s of r.spills) console.log(`  spill ${j.base}: ${s}`);
    for (const e of real) { bad += 1; console.error(`  ERROR ${j.base}: ${e}`); }
    console.log(`${real.length ? "ERRORS" : "ok    "} ${j.base}.${j.client}.png${r.misses.length ? `   (no answer: ${r.misses.join(", ")})` : ""}`);
  }
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
