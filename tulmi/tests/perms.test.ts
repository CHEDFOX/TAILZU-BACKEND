// LOCATION, CONTACTS AND HEALTH, the server's half (docs: perms, the design's §8).
//
// What is checked here: each button is drawn only for a phone that declares its capability AND only while its launch-dark
// switch is on; the window's trees are byte-identical to today's; every card before a system prompt is one choice (Continue)
// and no second; the location Save sends the words the phone found to the route a typed area has always used; the invite
// preview is literally what the mail will say; the invite and its mail are swept; and the health switch is reachable only
// through the phone's own POST.
//
// The never-rules of §4.6 (no AI service, no ads, no notification, no kept page, no log with a value) are in their own file,
// tests/health-never.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The test console's turn, caught on its way to the model. `Bots.test()` saves nothing, so what it hands `runBot` is the
 * only place its skills can be read, and the one that matters here is `health` (docs: perms §4.5).
 */
const RAN = vi.hoisted(() => ({ bot: null as unknown }));
vi.mock("../src/bots/run.js", async (orig) => ({
  ...(await orig<typeof import("../src/bots/run.js")>()),
  runBot: async (_deps: unknown, o: { bot: unknown }) => {
    RAN.bot = o.bot;
    return { bot: o.bot, text: "ok", paise: 0, tools: [], approvals: [], artifacts: [], opens: [], notes: [] };
  },
}));
import type { Node, ScreenResponse } from "../../shared/types/sdui.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.BOTS_APP = "true";

const { CONTACT_PICK_CAPABILITY, HEALTH_CAPABILITY, LOCATION_CAPABILITY } = await import("../../shared/types/sdui.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");
const { homePart, PLAN_STATE } = await import("../src/experience/bots/screens/botsPlaces.js");
const { invitePage } = await import("../src/experience/bots/screens/spaces/invitePage.js");
const { startScreen } = await import("../src/experience/bots/screens/spaces/start.js");
const { mailPreview } = await import("../src/experience/bots/screens/spaces/parts.js");
const { healthRows, hasHealthRow, movesLine } = await import("../src/experience/bots/screens/bots/health.js");
const { isFitnessBot, stemsOf } = await import("../src/bots/door.js");
const { inviteMail, inviteSender } = await import("../src/botsBots/inviteMail.js");
const { forgetInvitesOf, sweepInvites, INVITE_KEEP_MS, OUTBOX_KEEP_MS } = await import("../src/botsBots/inviteSweeper.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { MemoryPaged } = await import("../src/botsBots/spaceRows.js");
const { healthAllowed } = await import("../src/bots/healthGate.js");
const { movesOf, readHealthDays, dayKeyBefore } = await import("../src/bots/healthDays.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");

type Any = Record<string, unknown>;
/** Every node of a tree of parts, flat (lint.ts walk takes one root). */
const all = (n: Node[]): Node[] => walk({ type: "Stack", children: n } as unknown as Node);
/** Every word drawn in a tree of parts. */
const texts = (n: Node[]): string[] => all(n).map((x) => String(((x as Any).props as Any)?.content ?? "")).filter(Boolean);

// ------------------------------------------------------------------ the card rule, walked rather than grepped
//
// Grepping a tree for '"ask":true', "Continue" and no "Not now" passes even when the ask is wired straight to the
// feature's own button and the card is only decoration beside it. These walk the tree instead.

interface Seen { node: Any; chain: Any[] }
/** Every node with the chain of nodes above it, nearest last. */
function withParents(n: Any, chain: Any[] = [], out: Seen[] = []): Seen[] {
  out.push({ node: n, chain });
  for (const c of (Array.isArray(n.children) ? n.children : []) as Any[]) withParents(c, [...chain, n], out);
  return out;
}
/** Is there an action anywhere in this action tree that asks the system (`ask: true`)? */
function asksSomewhere(a: unknown): boolean {
  if (!a || typeof a !== "object") return false;
  const o = a as Any;
  if ((o.kind === "location.area" || o.kind === "health.sync") && o.ask === true) return true;
  return Object.values(o).some((v) => (Array.isArray(v) ? v.some(asksSomewhere) : asksSomewhere(v)));
}
/** Does this node answer a tap at all? */
const pressable = (n: Any): boolean => !!(n.on as Any)?.onPress;
/** The words inside one node's subtree. */
const wordsIn = (n: Any): string[] => withParents(n).map((x) => String((x.node.props as Any)?.content ?? "")).filter(Boolean);

/**
 * THE CARD RULE (App Review 5.1.1(iv)), checked on the tree: every ask sits on one pressable, that pressable's own press
 * IS the ask (nothing routes round it), its words are Continue, and the card it sits in has that one pressable and no
 * other. A second choice of any wording, quiet or not, fails here — not only the words "Not now".
 */
function checkCards(parts: Node[]): number {
  const root = { type: "Stack", children: parts } as unknown as Any;
  const seen = withParents(root);
  const askers = seen.filter((s) => asksSomewhere((s.node.on as Any)?.onPress));
  for (const { node, chain } of askers) {
    const press = (node.on as Any).onPress as Any;
    // The ask is the press itself: not behind a condition, a sequence, or anything else that could fire it elsewhere.
    expect(["location.area", "health.sync"], JSON.stringify(press).slice(0, 120)).toContain(press.kind);
    expect(press.ask).toBe(true);
    expect(wordsIn(node)).toEqual(["Continue"]);
    // The card: the nearest thing above it that is shown on a condition of its own (permitStep's `when`).
    const card = [...chain].reverse().find((c) => c.visibleIf !== undefined);
    expect(card, "an ask with no card above it").toBeTruthy();
    const presses = withParents(card!).filter((s) => pressable(s.node));
    expect(presses.length, `the card has ${presses.length} things to tap: ${presses.map((p) => wordsIn(p.node).join(" ")).join(" | ")}`).toBe(1);
  }
  // And nothing else in the tree asks: no onAppear, onChange or any other handler carries one.
  expect(seen.filter((s) => asksSomewhere(s.node.on)).length).toBe(askers.length);
  return askers.length;
}

const TRAVEL = { on: true, pending: false, home: "", homeFound: false, legs: [], headsUp: [], savedWeekMin: 0, credits: [] };
const envOn = (keys: string[]) => { for (const k of keys) process.env[k] = "true"; resetConfigForTests?.(); };
const envOff = (keys: string[]) => { for (const k of keys) delete process.env[k]; resetConfigForTests?.(); };
const PERM_KEYS = ["PERM_LOCATION", "PERM_CONTACT_PICK", "PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID"];

afterEach(() => { envOff([...PERM_KEYS, "PERM_HEALTH_ANDROID_USERS", "PERM_HEALTH_IOS_USERS"]); });

// ===================================================================== location

describe("Use my location", () => {
  const ctx = (o: { phone?: boolean; can?: boolean } = {}) =>
    ctxFor("bots.plan", o.phone === false ? "desktop" : "phone", undefined, { can: new Set(o.can === false ? ["BotsKit"] : ["BotsKit", LOCATION_CAPABILITY]) });

  it("is drawn only on a phone that declares Location1, and only while PERM_LOCATION is on", () => {
    envOff(PERM_KEYS);
    expect(texts(homePart(ctx(), TRAVEL))).not.toContain("Use my location");
    envOn(["PERM_LOCATION"]);
    expect(texts(homePart(ctx(), TRAVEL))).toContain("Use my location");
    // The window and an older binary get exactly today's card.
    expect(texts(homePart(ctx({ phone: false }), TRAVEL))).not.toContain("Use my location");
    expect(texts(homePart(ctx({ can: false }), TRAVEL))).not.toContain("Use my location");
  });

  it("the window's card is byte-identical with the switch on and off", () => {
    envOff(PERM_KEYS);
    const before = JSON.stringify(homePart(ctx({ phone: false }), TRAVEL));
    envOn(["PERM_LOCATION"]);
    expect(JSON.stringify(homePart(ctx({ phone: false }), TRAVEL))).toBe(before);
  });

  it("asks the system only behind a card, and the card has one choice and no second", () => {
    envOn(["PERM_LOCATION"]);
    const tree = homePart(ctx(), TRAVEL);
    expect(JSON.stringify(tree)).toContain('"kind":"location.area"');
    // Walked, not grepped: the one ask is the card's Continue, the button beside it cannot fire the ask itself, and the
    // card has nothing else to tap (a quiet second choice of any wording fails here).
    expect(checkCards(tree)).toBe(1);
  });

  it("the Use my location button opens the card and never the system prompt", () => {
    envOn(["PERM_LOCATION"]);
    const tree = homePart(ctx(), TRAVEL);
    const button = withParents({ type: "Stack", children: tree } as unknown as Any)
      .find((s) => pressable(s.node) && wordsIn(s.node).includes("Use my location"))!.node;
    const press = ((button.on as Any).onPress) as Any;
    // Granted already: the fix with no ask. Not yet: the card. Neither branch asks, so the card can never be skipped.
    expect(press.kind).toBe("condition");
    expect(asksSomewhere(press)).toBe(false);
  });

  it("checks the permission without asking when the card appears", () => {
    envOn(["PERM_LOCATION"]);
    const s = JSON.stringify(homePart(ctx(), TRAVEL));
    expect(s).toContain('"kind":"checkPermission"');
    expect(s).toContain('"permission":"location"');
    expect(s).toContain('"assignTo":"locGranted"');
  });

  it("Save sends the words the phone found to the route a typed area has always used", () => {
    envOn(["PERM_LOCATION"]);
    const s = JSON.stringify(homePart(ctx(), TRAVEL));
    expect(s).toContain('"path":"/v1/botsapp/bots/plan/home"');
    expect(s).toContain('"home":"$state.home_near"');
  });

  it("no coordinate is anywhere in the tree, and the state holds only words", () => {
    envOn(["PERM_LOCATION"]);
    const s = JSON.stringify(homePart(ctx(), TRAVEL));
    expect(s).not.toMatch(/\b(lat|lon|latitude|longitude|coords?)\b/i);
    expect(PLAN_STATE.home_near).toBe("");
    expect(Object.keys(PLAN_STATE)).toEqual(["home_edit", "home", "home_locate", "home_near", "locGranted", "locBlocked"]);
  });

  it("offers Settings only once the system will not ask again, and typing always works", () => {
    envOn(["PERM_LOCATION"]);
    const s = JSON.stringify(homePart(ctx(), TRAVEL));
    expect(s).toContain('"kind":"openSettings"');
    expect(s).toContain("Type it instead");
    // The field is there whatever happens, so a refusal is never a dead end (5.1.1(iv)).
    expect(s).toContain("Your area, like HSR Layout");
  });
});

// ===================================================================== contacts

describe("Add from contacts", () => {
  const space = {
    id: "s1", name: "Family", mine: true, me: { admin: true, perms: [] as never[] }, members: [], bots: [],
    invite: null, roles: [], code: "7KQ29D",
    mailPreview: { sender: "X0 Bot (noreply@x0bot.com), for Asha", subject: "Asha invited you to Family on X0 Bot", text: "the body" },
  };
  const page = (o: { phone?: boolean; can?: boolean } = {}): ScreenResponse => invitePage(
    ctxFor("bots.space.invite", o.phone === false ? "desktop" : "phone", undefined, {
      can: new Set(o.can === false ? ["BotsKit"] : ["BotsKit", CONTACT_PICK_CAPABILITY]), params: { id: "s1" },
    }),
    { space, items: [], payments: [], tasks: [], mailReady: true } as never,
  );

  it("is drawn only on a phone that declares ContactPick1, and only while PERM_CONTACT_PICK is on", () => {
    envOff(PERM_KEYS);
    expect(JSON.stringify(page())).not.toContain("Add from contacts");
    envOn(["PERM_CONTACT_PICK"]);
    expect(JSON.stringify(page())).toContain("Add from contacts");
    expect(JSON.stringify(page({ phone: false }))).not.toContain("Add from contacts");
    expect(JSON.stringify(page({ can: false }))).not.toContain("Add from contacts");
  });

  it("has NO card and asks no permission: a picker is not a system prompt", () => {
    envOn(["PERM_CONTACT_PICK"]);
    const s = JSON.stringify(page());
    expect(s).toContain('"kind":"contact.pick"');
    expect(s).toContain('"assignTo":"email"');
    expect(s).not.toContain('"permission":"contacts"');
    expect(s).not.toContain('"kind":"requestPermission"');
  });

  it("sends exactly what a typed email sends: the request body is unchanged", () => {
    envOn(["PERM_CONTACT_PICK"]);
    const on = JSON.stringify(page());
    envOff(PERM_KEYS);
    const off = JSON.stringify(page());
    for (const s of [on, off]) expect(s).toContain('"email":"$state.email"');
    expect(off).toContain('"path":"/v1/botsapp/bots/spaces/s1/invite"');
  });

  it("previews the sender, the subject and the body, all from inviteMail()", () => {
    const mail = inviteMail({ from: "Asha", space: "Family", email: "their email", joinCode: "7KQ-29D", link: "https://x0bot.com/i/7KQ29D", adminLine: "The admin can see it." });
    const sender = inviteSender("X0 Bot <noreply@x0bot.com>", "Asha");
    expect(sender).toBe("X0 Bot (noreply@x0bot.com), for Asha");
    expect(mail.subject).toBe("Asha invited you to Family on X0 Bot");
    expect(mail.text).toContain("their email");
    expect(mail.text).toContain("7KQ-29D");
    const shown = JSON.stringify(mailPreview({ sender, ...mail }));
    // Everything the recipient will see is on the screen, the body behind one tap (5.1.2(v)).
    expect(shown).toContain(sender);
    expect(shown).toContain(mail.subject);
    expect(shown).toContain(JSON.stringify(mail.text).slice(1, 60));
    expect(shown).toContain("See the whole email");
  });

  it("the mail and the preview are the same words: only the address slot differs", () => {
    const of = (email: string) => inviteMail({ from: "Asha", space: "Family", email, joinCode: "7KQ-29D", link: "L", adminLine: "A" });
    const real = of("rahul@example.in"), preview = of("their email");
    expect(preview.subject).toBe(real.subject);
    expect(preview.text.replace("their email", "rahul@example.in")).toBe(real.text);
  });
});

describe("an invite and its mail do not outlive what they were for", () => {
  const NOW = Date.parse("2026-11-13T00:00:00Z");
  let invites: InstanceType<typeof MemoryTable>;
  let outbox: InstanceType<typeof MemoryPaged>;
  beforeEach(() => { invites = new MemoryTable(); outbox = new MemoryPaged(); });
  const t = () => ({ invites: invites as never, outbox: outbox as never });

  const invite = (code: string, expires: number, by = "u1") =>
    invites.insert({ code, space_id: "s1", created_by: by, created_ms: expires - 7 * 86_400_000, expires_ms: expires, email: `${code}@e.in` } as never);
  const mail = (id: string, status: string, created: number, by = "u1") =>
    outbox.insert({ id, to_email: "a@e.in", subject: "s", body_text: "b", body_html: null, kind: "space_invite", ref: id, status, attempts: 0, last_error: "", created_ms: created, next_ms: created, sent_ms: null, sent_by: by } as never);

  it("deletes an invite seven days after it expires, and keeps one still open", async () => {
    await invite("old", NOW - INVITE_KEEP_MS - 1);
    await invite("justexpired", NOW - 1);
    await invite("open", NOW + 86_400_000);
    expect((await sweepInvites(t(), NOW)).invites).toBe(1);
    expect((await invites.select({})).map((r: never) => (r as { code: string }).code).sort()).toEqual(["justexpired", "open"]);
  });

  it("deletes a finished mail seven days after it was queued, and never a queued one", async () => {
    await mail("sent-old", "sent", NOW - OUTBOX_KEEP_MS - 1);
    await mail("failed-old", "failed", NOW - OUTBOX_KEEP_MS - 1);
    await mail("cancelled-old", "cancelled", NOW - OUTBOX_KEEP_MS - 1);
    await mail("queued-old", "queued", NOW - 400 * 86_400_000);
    await mail("sent-new", "sent", NOW - 1000);
    expect((await sweepInvites(t(), NOW)).mails).toBe(3);
    expect((await outbox.select({})).map((r: never) => (r as { id: string }).id).sort()).toEqual(["queued-old", "sent-new"]);
  });

  it("a row stuck in sending goes too, a week on: a crash mid-send must not keep an address for ever", async () => {
    // mail.ts moves a row from queued to sending and then to sent or failed in the next breath. Nothing moves a stale
    // `sending` row anywhere, so without this one the address, the subject and the whole body sit there for good.
    await mail("sending-old", "sending", NOW - OUTBOX_KEEP_MS - 1);
    await mail("sending-now", "sending", NOW - 1000);
    await mail("queued-ancient", "queued", NOW - 400 * 86_400_000);
    expect((await sweepInvites(t(), NOW)).mails).toBe(1);
    expect((await outbox.select({})).map((r: never) => (r as { id: string }).id).sort()).toEqual(["queued-ancient", "sending-now"]);
  });

  it("the thirty-a-day cap still has its last 24 hours: nothing inside a day is ever swept", async () => {
    for (let i = 0; i < 30; i += 1) await mail(`m${i}`, "sent", NOW - 3600_000);
    expect((await sweepInvites(t(), NOW)).mails).toBe(0);
    expect((await outbox.select({})).length).toBe(30);
  });

  it("an account's invites and their mail go with the account, whatever their status", async () => {
    await invite("mine", NOW + 86_400_000, "u1");
    await invite("theirs", NOW + 86_400_000, "u2");
    await mail("mine-queued", "queued", NOW, "u1");
    await mail("theirs-sent", "sent", NOW, "u2");
    expect(await forgetInvitesOf("u1", t())).toEqual({ invites: 1, mails: 1 });
    expect((await invites.select({})).map((r: never) => (r as { code: string }).code)).toEqual(["theirs"]);
    expect((await outbox.select({})).map((r: never) => (r as { id: string }).id)).toEqual(["theirs-sent"]);
  });
});

// ===================================================================== health

describe("which bots get the health row", () => {
  it("a fitness word, through the same stemmer on both sides", () => {
    for (const n of ["Gym Buddy", "Morning runs", "Kasrat tracker", "Yoga days", "Run my week", "Walking log"]) {
      expect(isFitnessBot(n, ""), n).toBe(true);
    }
    for (const n of ["Profit tracker", "Outfit picker", "Benefits helper", "Brunch planner"]) {
      expect(isFitnessBot(n, ""), n).toBe(false);
    }
    // The purpose counts as much as the name.
    expect(isFitnessBot("Buddy", "keeps my workouts in order")).toBe(true);
  });

  it("stemsOf is wordsOf without the what-people-say expansion", () => {
    expect([...stemsOf("workouts and running")].sort()).toEqual(["runn", "workout"]);
    expect(stemsOf("budget").has("money")).toBe(false);
  });
});

describe("the health row and its card", () => {
  const bot = (o: Partial<{ name: string; purpose: string; builtin: boolean; health: boolean }> = {}) => ({
    slug: "gym-buddy", name: o.name ?? "Gym Buddy", purpose: o.purpose ?? "counts my gym days", builtin: o.builtin ?? false,
    skills: { health: o.health ?? false },
  });
  const ctx = (o: { phone?: boolean; can?: boolean; android?: boolean } = {}) =>
    ctxFor("bots.edit", o.phone === false ? "desktop" : "phone", undefined, {
      can: new Set(o.can === false ? ["BotsKit"] : ["BotsKit", HEALTH_CAPABILITY]),
      ...(o.android ? { platform: "android" as const } : {}),
    });

  it("is drawn only for a phone with Health1, a bot the person made, a fitness name, and the switch on", () => {
    envOff(PERM_KEYS);
    expect(hasHealthRow(ctx(), bot())).toBe(false);
    envOn(["PERM_HEALTH_IOS"]);
    expect(hasHealthRow(ctx(), bot())).toBe(true);
    expect(hasHealthRow(ctx({ phone: false }), bot())).toBe(false);
    expect(hasHealthRow(ctx({ can: false }), bot())).toBe(false);
    expect(hasHealthRow(ctx(), bot({ builtin: true }))).toBe(false);
    expect(hasHealthRow(ctx(), bot({ name: "Profit tracker", purpose: "my money" }))).toBe(false);
  });

  it("stays once health is on, whatever the bot is renamed to, so it can always be switched off", () => {
    envOn(["PERM_HEALTH_IOS"]);
    expect(hasHealthRow(ctx(), bot({ name: "Profit tracker", purpose: "my money", health: true }))).toBe(true);
  });

  it("Android needs its own switch, and its account list is the reviewer's stage", () => {
    envOn(["PERM_HEALTH_IOS"]);
    expect(hasHealthRow(ctx({ android: true }), bot())).toBe(false);
    envOn(["PERM_HEALTH_ANDROID"]);
    expect(hasHealthRow(ctx({ android: true }), bot())).toBe(true);
    process.env.PERM_HEALTH_ANDROID_USERS = "11111111-1111-4111-8111-111111111111";
    resetConfigForTests?.();
    expect(healthAllowed("android", "11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(healthAllowed("android", "00000000-0000-4000-8000-00000000aaaa")).toBe(false);
    // The iPhone switch is read on its own, so one platform never gates the other.
    expect(healthAllowed("ios", "00000000-0000-4000-8000-00000000aaaa")).toBe(true);
  });

  it("the card has Continue and no second choice, and only Continue asks", () => {
    envOn(["PERM_HEALTH_IOS"]);
    const rows = healthRows(ctx(), bot());
    expect(JSON.stringify(rows)).toContain('"enable":true');
    // Walked: the switch row itself cannot fire the sync, and the card has one thing to tap.
    expect(checkCards(rows)).toBe(1);
  });

  it("names Apple Health on iPhone and Health Connect on Android, in the same bytes", () => {
    envOn(["PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID"]);
    const ios = JSON.stringify(healthRows(ctx(), bot()));
    const android = JSON.stringify(healthRows(ctx({ android: true }), bot()));
    expect(ios).toBe(android);
    expect(ios).toContain("Count my workouts from Apple Health");
    expect(ios).toContain("Count my workouts from Health Connect");
    expect(ios).toContain('"platform":"android"');
  });

  it("the path it posts to is the bot's own health route, and nothing else", () => {
    envOn(["PERM_HEALTH_IOS"]);
    const s = JSON.stringify(healthRows(ctx(), bot()));
    expect(s).toContain('"path":"/v1/bots/gym-buddy/health/days"');
    expect(s).not.toContain("/ask");
  });

  it("switching off is the plain PUT, which deletes the days", () => {
    envOn(["PERM_HEALTH_IOS"]);
    const s = JSON.stringify(healthRows(ctx(), bot({ health: true })));
    expect(s).toContain('"method":"PUT"');
    expect(s).toContain('"skills":{"health":false}');
    expect(s).toContain("Switching it off deletes what it counted.");
  });

  it("the switch does not move until the phone has said yes, and moves at once when it goes off", () => {
    envOn(["PERM_HEALTH_IOS"]);
    // Off: the tap opens the card and nothing else. A switch that read "on" while the person was still reading the card,
    // or after they refused the phone's own sheet, would say the bot was counting when it was not.
    const off = JSON.stringify(healthRows(ctx(), bot()));
    expect(off).not.toContain('"toggleState"');
    expect(off).toContain('"path":"healthCard"');
    // On: the tap turns it off at once, and the PUT behind it deletes the days.
    expect(JSON.stringify(healthRows(ctx(), bot({ health: true })))).toContain('{"kind":"toggleState","path":"healthOn"}');
  });

  it("says nothing yet rather than a zero when the sheet was answered and no data came", () => {
    const words = JSON.stringify(movesLine(ctxFor("bots.bot", "phone"), bot({ health: true }), { workouts: 0, lastDay: null, lastMinutes: 0, steps: 0, stepDays: 0, asOf: 0 }));
    expect(words).toContain("Nothing from Apple Health yet");
    expect(words).not.toContain("0 workouts");
  });

  it("the Moves line counts, and says when the numbers are from", () => {
    const m = movesOf([
      { day: "2026-11-10", steps: 7412, workouts: [{ kind: "strength", minutes: 48 }], updatedAt: Date.parse("2026-11-13T09:40:00Z") },
      { day: "2026-11-11", steps: 5000, workouts: [], updatedAt: Date.parse("2026-11-13T09:40:00Z") },
    ]);
    expect(m).toMatchObject({ workouts: 1, lastMinutes: 48, steps: 12412, stepDays: 2 });
    const words = JSON.stringify(movesLine(ctxFor("bots.bot", "phone"), bot({ health: true }), m));
    expect(words).toContain("1 workout this month");
    expect(words).toContain("48 min");
    expect(words).toContain("as of");
  });

  it("draws nothing at all when the switch is off, however many days there are", () => {
    expect(movesLine(ctxFor("bots.bot", "phone"), bot({ health: false }), { workouts: 9, lastDay: "2026-11-10", lastMinutes: 48, steps: 1, stepDays: 1, asOf: 1 })).toEqual([]);
  });

  // ------------------------------------------------------------------ the way out never disappears

  it("a bot that is counting keeps a way to stop, on any client and whatever the switches say", () => {
    // The policy says "turn the switch off at any time, from the bot's edit page" (privacy 1.5.1). The server's switch can
    // go off under a person's feet — Google refuses the form, their account leaves the list — and the window never had it.
    envOff(PERM_KEYS);
    for (const where of [ctx(), ctx({ phone: false }), ctx({ android: true }), ctx({ can: false })]) {
      const rows = healthRows(where, bot({ health: true }));
      const s = JSON.stringify(rows);
      expect(hasHealthRow(where, bot({ health: true }))).toBe(true);
      expect(s).toContain('"skills":{"health":false}');
      // Stop only: no card, no sync, and no source named (the phone that turned it on may not be the one reading).
      expect(s).not.toContain("health.sync");
      expect(s).not.toContain("Continue");
      expect(texts(rows)).toContain("Counting steps and workouts");
    }
  });

  it("but a bot that is NOT counting still needs the phone, its capability and the switch to be offered one", () => {
    envOff(PERM_KEYS);
    for (const where of [ctx(), ctx({ phone: false }), ctx({ can: false })]) expect(healthRows(where, bot())).toEqual([]);
    envOn(["PERM_HEALTH_IOS"]);
    expect(healthRows(ctx({ phone: false }), bot())).toEqual([]);
    expect(healthRows(ctx({ can: false }), bot())).toEqual([]);
    expect(texts(healthRows(ctx(), bot()))).toContain("Count my workouts from Apple Health");
  });

  // ------------------------------------------------------------------ the quiet re-read

  it("the quiet re-read is gated by the same switch as the row, so a phone never posts days the route would refuse", async () => {
    const { healthRefresh } = await import("../src/experience/bots/screens/bots/health.js");
    envOff(PERM_KEYS);
    // Switched off on the server: no onAppear read at all. Without this the phone would read Apple Health or Health
    // Connect on every visit and POST days the route answers 403, over and over.
    expect(healthRefresh(ctx(), bot({ health: true }))).toEqual([]);
    expect(healthRefresh(ctx({ phone: false }), bot({ health: true }))).toEqual([]);
    envOn(["PERM_HEALTH_IOS"]);
    const s = JSON.stringify(healthRefresh(ctx(), bot({ health: true })));
    expect(s).toContain('"ask":false');
    // Denied (a new phone, a reinstall, a grant taken back): the page says so instead of quietly counting nothing.
    expect(s).toContain('"onDenied":{"kind":"setState","path":"healthNotHere","value":true}');
    expect(s).toContain('"onEmpty"');
    expect(healthRefresh(ctx(), bot({ health: false }))).toEqual([]);
  });

  it("the Moves line carries the line for a phone that has stopped sharing", () => {
    const m = { workouts: 1, lastDay: "2026-11-10", lastMinutes: 48, steps: 10, stepDays: 1, asOf: Date.parse("2026-11-13T09:40:00Z") };
    const s = JSON.stringify(movesLine(ctxFor("bots.bot", "phone"), bot({ health: true }), m));
    expect(s).toContain("Not shared from this phone");
    expect(s).toContain('{"truthy":"healthNotHere"}');
  });

  it("the empty line names the phone's own place: Apple Health on iPhone, Health Connect on Android", () => {
    const empty = { workouts: 0, lastDay: null, lastMinutes: 0, steps: 0, stepDays: 0, asOf: 0 };
    const s = JSON.stringify(movesLine(ctxFor("bots.bot", "phone"), bot({ health: true }), empty));
    expect(s).toContain("Nothing from Apple Health yet");
    expect(s).toContain("Nothing from Health Connect yet");
    expect(s).toContain("Health Connect › App permissions › X0 Bot");
    // Both in the same bytes, each behind its own platform, as the row itself is.
    expect(s).toContain('"platform":"android"');
  });

  it("the day of the last workout is the day the person had it, at every offset", () => {
    // movesOf keeps the phone's own day KEY, not a timestamp: a timestamp is read back through the reader's offset and
    // lands a day out everywhere but Greenwich. -11:00 and +14:00 are real offsets (Niue, Kiritimati).
    const m = movesOf([{ day: "2026-11-10", steps: 0, workouts: [{ kind: "run", minutes: 30 }], updatedAt: Date.parse("2026-11-13T09:40:00Z") }]);
    expect(m.lastDay).toBe("2026-11-10");
    const now = Date.parse("2026-11-13T09:40:00Z");
    for (const tz of [-660, -300, 0, 330, 840]) {
      const base = ctxFor("bots.bot", "phone");
      const ctxTz = ctxFor("bots.bot", "phone", undefined, { tzOffsetMinutes: tz, live: { ...base.live, now } as never });
      const words = texts(movesLine(ctxTz, bot({ health: true }), { ...m, lastMinutes: 30 })).join(" · ");
      expect(words, `tz ${tz}`).toContain("last Tue 10 Nov");
    }
  });

  it("'last today' is not English: today and yesterday lose the word", () => {
    const now = Date.parse("2026-11-13T09:40:00Z");
    const ctxNow = ctxFor("bots.bot", "phone", undefined, { live: { ...ctxFor("bots.bot", "phone").live, now } as never });
    const m = { workouts: 1, lastDay: "2026-11-13", lastMinutes: 48, steps: 0, stepDays: 0, asOf: now };
    const words = texts(movesLine(ctxNow, bot({ health: true }), m)).join(" · ");
    expect(words).toContain("today, 48 min");
    expect(words).not.toMatch(/last Today|last today/);
  });
});

describe("what the phone may send", () => {
  const NOW = Date.parse("2026-11-13T12:00:00Z");
  const body = (days: unknown) => ({ platform: "ios", tz: "+05:30", days });
  const ok = (d: unknown) => readHealthDays(body([d]), NOW);
  const bad = (d: unknown) => () => readHealthDays(body([d]), NOW);
  const day = (o: Record<string, unknown> = {}) => ({ day: "2026-11-12", steps: 7412, workouts: [{ kind: "strength", minutes: 48 }], ...o });

  it("takes a day the phone summed in its own time zone", () => {
    expect(ok(day())).toEqual([{ day: "2026-11-12", steps: 7412, workouts: [{ kind: "strength", minutes: 48 }] }]);
  });

  it("refuses more than 31 days, a day outside the window, and the same day twice", () => {
    expect(() => readHealthDays(body(Array.from({ length: 32 }, (_, i) => day({ day: dayKeyBefore(NOW, i) }))), NOW)).toThrow(/31 days at most/);
    expect(bad(day({ day: dayKeyBefore(NOW, 40) }))).toThrow(/last 31/);
    expect(bad(day({ day: "2030-01-01" }))).toThrow(/last 31/);
    expect(() => readHealthDays(body([day(), day()]), NOW)).toThrow(/once/);
  });

  it("refuses steps out of range, too many workouts, an unknown kind and silly minutes", () => {
    expect(bad(day({ steps: 200_001 }))).toThrow(/steps/);
    expect(bad(day({ steps: 1.5 }))).toThrow(/steps/);
    expect(bad(day({ workouts: Array.from({ length: 9 }, () => ({ kind: "run", minutes: 10 })) }))).toThrow(/8 workouts/);
    expect(bad(day({ workouts: [{ kind: "heart rate", minutes: 10 }] }))).toThrow(/kind is one of/);
    expect(bad(day({ workouts: [{ kind: "run", minutes: 601 }] }))).toThrow(/minutes/);
    expect(bad(day({ workouts: [{ kind: "run", minutes: 0 }] }))).toThrow(/minutes/);
  });

  it("takes nothing it was not given: no device, no source, no timestamp", () => {
    const [d] = ok(day({ source: "Apple Watch", at: NOW, heartRate: 140 }));
    expect(Object.keys(d!)).toEqual(["day", "steps", "workouts"]);
  });
});

// ===================================================================== Forget, and the pages that are never kept

describe("Forget, on You › Privacy › What this phone shares", () => {
  it("clears the stored words, because the card's Forget sends the same PUT with nothing in it", async () => {
    const { PlanTravelling } = await import("../src/botsBots/planTravel.js");
    const prefs = new MemoryTable();
    const travel = new PlanTravelling({ places: {} as never, later: {} as never, prefs: prefs as never, now: () => Date.parse("2026-11-13T00:00:00Z") });
    expect(await travel.setHome("u1", "  HSR Layout  ")).toBe("HSR Layout");
    expect(((await prefs.select({ user_id: "u1" }))[0] as unknown as { home: string }).home).toBe("HSR Layout");
    // Forget: the same route, an empty value. It has to leave nothing behind, not keep the last area.
    expect(await travel.setHome("u1", "")).toBe("");
    expect(((await prefs.select({ user_id: "u1" }))[0] as unknown as { home: string }).home).toBe("");
  });
});

describe("a page that can draw a health number is never kept on the phone", () => {
  // The phone writes every page with a cache time into AsyncStorage, which goes into the device backup and so into iCloud
  // (docs: perms §4.6). The two pages that can show health pass `keep: false`, and only while this bot has it on.
  const FITNESS = {
    slug: "gym-buddy", name: "Gym Buddy", colour: "moss", purpose: "counts my gym days", principles: [], tone: "",
    builtin: false, publicCard: false, skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
  };
  const screenOf = async (screenId: string, health: boolean) => {
    const { buildBotsScreen } = await import("../src/experience/bots/index.js");
    const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
    return buildBotsScreen({
      screenId, client: "phone", params: { slug: FITNESS.slug }, platform: "ios", tzOffsetMinutes: 330,
      user: { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya" },
      can: new Set(["BotsKit", HEALTH_CAPABILITY]), desk: { pages: false, notes: false },
    }, fakeDeps({
      api: {
        [`GET /v1/bots/${FITNESS.slug}`]: { bot: { ...FITNESS, skills: { ...FITNESS.skills, health } } },
        // The counts are their own route now (routes/bots/botHealth.ts), away from the file that hosts POST .../ask.
        [`GET /v1/bots/${FITNESS.slug}/health/moves`]: {
          moves: health ? { workouts: 9, lastDay: "2026-11-10", lastMinutes: 48, steps: 60_000, stepDays: 8, asOf: Date.parse("2026-11-13T09:40:00Z") } : null,
        },
      },
    })) as Promise<ScreenResponse>;
  };

  beforeEach(() => { envOn(["PERM_HEALTH_IOS"]); });

  it("the bot's page and its edit page are sent cacheTtlSeconds 0 while health is on", async () => {
    for (const id of ["bots.bot", "bots.edit"]) expect((await screenOf(id, true)).cacheTtlSeconds, id).toBe(0);
  });

  it("the same pages for a bot with health off are kept exactly as they always were", async () => {
    for (const id of ["bots.bot", "bots.edit"]) expect((await screenOf(id, false)).cacheTtlSeconds, id).toBe(1);
  });

  it("with health on, the Moves line is on the page and no raw day is", async () => {
    const s = await screenOf("bots.bot", true);
    expect(texts([s.root])).toContain("Moves");
    expect(JSON.stringify(s)).not.toContain("7412");
  });

  it("with the platform switch off there is no health.sync anywhere in the bot's page", async () => {
    // Health on for the bot, the switch off on the server: without this the phone reads Apple Health or Health Connect on
    // every visit and POSTs days the route answers 403 — health leaving the phone for a feature we have switched off.
    envOff(PERM_KEYS);
    const s = JSON.stringify(await screenOf("bots.bot", true));
    expect(s).not.toContain("health.sync");
    expect(s).not.toContain("/health/days");
    // The Moves line itself stays: the numbers already counted are still the person's to see.
    expect(s).toContain("Moves");
  });
});

// ===================================================================== the start screen's preview, before any draft

describe("Spaces' start screen, before the first invite", () => {
  const ctx = (o: { phone?: boolean; can?: boolean } = {}) =>
    ctxFor("bots.spaces", o.phone === false ? "desktop" : "phone", undefined, {
      can: new Set(o.can === false ? ["BotsKit"] : ["BotsKit", CONTACT_PICK_CAPABILITY, "BotStage", "BotCrowd", "Vanish", "PersonBot"]),
    });
  const PREVIEW = { sender: "X0 Bot (noreply@x0bot.com), for Asha", subject: "Asha invited you to their space on X0 Bot", text: "the whole body" };
  const data = (draft: unknown) => ({
    spaces: [], you: "Asha", unread: 0, invitations: [], requests: [], asked: [], draft, mailPreview: PREVIEW,
  } as never);

  it("draws the picker AND the preview with no draft at all: the first invite is the one 5.1.2(v) is about", () => {
    envOn(["PERM_CONTACT_PICK"]);
    const s = JSON.stringify(startScreen(ctx(), data(null)));
    expect(s).toContain("Add from contacts");
    expect(s).toContain("See the whole email");
    expect(s).toContain(PREVIEW.subject);
    expect(s).toContain(PREVIEW.sender);
  });

  it("the draft's own preview wins once there is one", () => {
    envOn(["PERM_CONTACT_PICK"]);
    const draft = { id: "d1", name: null, invites: [], mailPreview: { ...PREVIEW, subject: "Asha invited you to Family on X0 Bot" } };
    const s = JSON.stringify(startScreen(ctx(), data(draft)));
    expect(s).toContain("Asha invited you to Family on X0 Bot");
    expect(s).not.toContain(PREVIEW.subject);
  });

  it("the window and an older binary get the email box exactly as they always did", () => {
    envOn(["PERM_CONTACT_PICK"]);
    for (const where of [ctx({ phone: false }), ctx({ can: false })]) {
      expect(JSON.stringify(startScreen(where, data(null)))).not.toContain("Add from contacts");
    }
  });

  it("the server writes that preview from the same inviteMail() the mail is written with", async () => {
    const { Spaces } = await import("../src/botsBots/spaces.js");
    const s = Object.create(Spaces.prototype) as { blankPreview: (who: string) => { sender: string; subject: string; text: string } };
    (s as unknown as { origin: () => string }).origin = () => "https://app.x0bot.com";
    const p = s.blankPreview("Asha");
    const mail = inviteMail({ from: "Asha", space: "their space", email: "their email", joinCode: "the space's code", link: "https://app.x0bot.com/s/bots.spaces", adminLine: "" });
    expect(p.subject).toBe(mail.subject);
    expect(p.text).toContain("their email");
    expect(p.sender).toContain("for Asha");
  });
});

// ===================================================================== the days, and the switch going off

describe("switching health off", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const NOW = Date.parse("2026-11-13T12:00:00Z");
  const DAYS = { tz: "+05:30", days: [{ day: "2026-11-12", steps: 7412, workouts: [{ kind: "strength", minutes: 48 }] }] };

  async function made(o: { connectors?: string[] } = {}) {
    const { Bots } = await import("../src/bots/index.js");
    const { attachHealth } = await import("../src/bots/healthService.js");
    const { MemoryBotStore } = await import("../src/bots/store.js");
    const { healthDays, resetHealthDaysForTests } = await import("../src/bots/healthDays.js");
    resetHealthDaysForTests();
    // A connectors port that knows no apps: every linked app comes back "unavailable", which is what check() refuses.
    const ports = { connectors: { status: async (_u: string, ids: string[]) => ids.map((id) => ({ id, status: "unavailable" })) } };
    const bots = new Bots({ store: new MemoryBotStore(), now: () => NOW, ports } as never);
    const health = attachHealth(bots, () => NOW);
    const { bot } = await bots.create(OWNER, { name: "Gym Buddy", purpose: "counts my gym days" });
    await health.sync(OWNER, bot.slug, DAYS, { enable: true });
    const id = (await bots.resolve(OWNER, bot.slug))!.stored!.id;
    // An app the server has no definition for: check() marks it unavailable and refuses the whole update.
    if (o.connectors) await (bots as unknown as { store: { updateBot: (u: string, i: string, p: unknown, n: number) => Promise<unknown> } })
      .store.updateBot(OWNER, id, { skills: { web: false, files: false, artifacts: false, code: false, research: false, health: true, connectors: o.connectors } }, NOW);
    return { bots, health, slug: bot.slug, id, healthDays };
  }

  it("deletes the days even when something else about the bot would fail the usual checks", async () => {
    const { bots, slug, id, healthDays } = await made({ connectors: ["an-app-that-went-away"] });
    // The usual path refuses this bot outright, which is exactly the trap: the person could not stop the counting.
    await expect(bots.update(OWNER, slug, { purpose: "still my gym days" })).rejects.toMatchObject({ status: 400 });
    // The row's own off switch goes straight through.
    const { bot } = await bots.update(OWNER, slug, { skills: { health: false } });
    expect(bot.skills.health).toBe(false);
    expect(await healthDays().list(OWNER, id)).toEqual([]);
  });

  it("a patch carrying anything besides the off switch still goes the long way", async () => {
    const { bots, slug, id, healthDays } = await made();
    const { bot } = await bots.update(OWNER, slug, { skills: { health: false }, purpose: "my gym days, still" });
    expect([bot.skills.health, bot.purpose]).toEqual([false, "my gym days, still"]);
    expect(await healthDays().list(OWNER, id)).toEqual([]);
  });

  it("the days go before the write, so a failed write never hides them from the export", async () => {
    const { bots, health, slug, id, healthDays } = await made();
    const order: string[] = [];
    const store = (bots as unknown as { store: { updateBot: (...a: unknown[]) => Promise<unknown> } }).store;
    const real = store.updateBot.bind(store);
    store.updateBot = async (...a: unknown[]) => { order.push("write"); return real(...a); };
    const drop = healthDays().dropBot.bind(healthDays());
    healthDays().dropBot = async (u: string, b: string) => { order.push("days"); return drop(u, b); };
    await bots.update(OWNER, slug, { skills: { health: false }, purpose: "gym days" });
    expect(order).toEqual(["days", "write"]);
    expect(await healthDays().list(OWNER, id)).toEqual([]);
    expect(await health.exportOf(OWNER)).toEqual([]);
  });
});

// ===================================================================== health is forced off on every other path

describe("no path but the phone's POST ever says health is on", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";

  it("the test console runs a draft with health off, whatever the definition said", async () => {
    const { Bots } = await import("../src/bots/index.js");
    const { MemoryBotStore } = await import("../src/bots/store.js");
    const bots = new Bots({ store: new MemoryBotStore() } as never);
    RAN.bot = null;
    await bots.test(OWNER, { name: "Gym Buddy", purpose: "counts my gym days", skills: { health: true, web: true } }, { message: "hi" });
    // The console never saves a bot, so nothing else would catch this: what it hands the model is the only evidence.
    expect((RAN.bot as { skills: Record<string, unknown> }).skills).toMatchObject({ health: false, web: true });
  });

  it("a copy from Find a bot starts with it off, whatever the listing says", async () => {
    const { Bots } = await import("../src/bots/index.js");
    const { MemoryBotStore } = await import("../src/bots/store.js");
    const bots = new Bots({ store: new MemoryBotStore() } as never);
    // BotShop.add() hands the listing's definition straight to create(), which is what forces it false.
    const { bot } = await bots.create(OWNER, { name: "Gym Buddy", purpose: "counts my gym days", skills: { health: true } });
    expect(bot.skills.health).toBe(false);
    // And the shop's own templates are built with it pinned, so a new ready-made one cannot arrive with it on.
    const shop = await import("node:fs").then((fs) => fs.readFileSync("src/botsBots/shop.ts", "utf8"));
    expect(shop).toContain("...on, health: false");
  });
});

// ===================================================================== You › Privacy follows the switches

describe("You › Privacy says only what this build can do", () => {
  const privacy = async (o: { desk?: boolean } = {}) => {
    const { buildBotsScreen } = await import("../src/experience/bots/index.js");
    const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
    const you = { plan: { name: "Free", active: false }, usage: null, apps: null, exportUrl: null, language: null,
      settings: { monthLimitPaise: 0, stopAtLimit: false, notify: { done: "quiet", summary: false, summaryAt: 0, quiet: false, quietFrom: 0, quietTo: 0, botsOff: [] }, privacy: {} } };
    return buildBotsScreen({
      screenId: "bots.privacy", client: o.desk ? "desktop" : "phone", params: {}, platform: "ios", tzOffsetMinutes: 330,
      user: { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya" },
      can: new Set(["BotsKit"]), desk: { pages: false, notes: false },
    }, fakeDeps({ api: { "GET /v1/you?tz=330": you } })) as Promise<ScreenResponse>;
  };

  it("with every switch off it is the screen it was: no card, and no row about a button nobody has", async () => {
    envOff(PERM_KEYS);
    for (const desk of [false, true]) {
      const s = JSON.stringify(await privacy({ desk }));
      expect(s, `desk ${desk}`).not.toContain("What this phone shares");
      expect(s).not.toContain("Where your day starts");
      expect(s).not.toContain("Steps and workouts");
      // The invite retention is true whatever the switches say: the sweeper deletes a typed email the same way.
      expect(s).toContain("An invite's email");
    }
  });

  it("each row comes back with its own switch, and no other", async () => {
    envOn(["PERM_LOCATION"]);
    let s = JSON.stringify(await privacy());
    expect(s).toContain("What this phone shares");
    expect(s).toContain("Where your day starts");
    expect(s).not.toContain("Adding someone from your contacts");
    expect(s).not.toContain("Your steps and workouts");
    envOn(["PERM_LOCATION", "PERM_CONTACT_PICK", "PERM_HEALTH_IOS"]);
    s = JSON.stringify(await privacy());
    for (const w of ["Where your day starts", "Adding someone from your contacts", "Your steps and workouts", "Steps and workouts"]) {
      expect(s, w).toContain(w);
    }
    // The invite row's words follow the picker; the window is where a KEPT row's second line is drawn.
    expect(JSON.stringify(await privacy({ desk: true }))).toContain("Only the one you typed or picked, to send it");
    envOff(PERM_KEYS);
    expect(JSON.stringify(await privacy({ desk: true }))).toContain("Only the one you typed, to send it");
  });
});
