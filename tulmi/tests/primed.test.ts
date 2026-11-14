/**
 * `primed: true` — THE LINT THE PHONE'S COMMENT PROMISES (shared/types/sdui.ts `primed`; TAILZU-FRONTEND
 * app/src/sdui/actions.ts `primedCard`; App Review 5.1.1(iv), task #113).
 *
 * One app card stands before every system prompt. A phone that declares `primed` in its capabilities makes sure of
 * it: without `primed: true` on a `requestPermission` it draws its own box — "One permission first", one Continue —
 * and asks the system only once that is tapped. `primed: true` says the explaining has been done on the screen we
 * sent, so the phone goes straight to the system. Set it anywhere else and the person gets no explanation at all;
 * leave it off where our own card already explains and they get two.
 *
 * BOTH DIRECTIONS, which is the whole point. This file walks the BUILT screens — every one that carries an ask, on
 * the phone (iPhone and Android) and in the window — and for EVERY `requestPermission` on them asks one question:
 * is this ask the Continue of a card of ours that explains this permission? That is `cardFired` below:
 *
 *   • something fires it, and a TAP is the only thing that does (never an onAppear, an onChange, a rule, a
 *     gesture, or an action held in a node's props);
 *   • the thing tapped says Continue — or, for Android's "Allow all the time" hand-off, Open Settings, and only
 *     for that permission;
 *   • the card around it explains THIS permission in its own words, at some length;
 *   • nothing else in that card can be on screen while that one button is: not a "Not now", not a Close, not a
 *     bare ✕, not a second offer of any kind. A button whose own condition cannot hold while the Continue's does
 *     is fine — planCall's Open Settings, which is there only once the mic is blocked.
 *
 * And then: `primed` is set if and only if the answer is yes. An ask behind our own card with no mark is the
 * double card the owner asked us to fix; a mark anywhere else is a system prompt with nothing in front of it.
 *
 * Plus a source-level allowlist: the files allowed to write the word at all, each tied to a screen this file
 * really walks — so a file cannot be allowlisted and then never looked at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Node, ScreenResponse } from "../../shared/types/sdui.js";

// The translator, so `localize` can be run over a built screen without asking a model anything. It answers with no
// items, so every string stays as it is — what is being checked is that the walk does not DROP the new field.
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: '{"items":[]}' } }] }) } };
  },
  toFile: async (b: unknown, name: string) => ({ b, name }),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.BOTS_APP = "true";
});

const CAPS = await import("../../shared/types/sdui.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { resetConfigForTests } = await import("../src/config.js");
const { DRIVE, ARRIVAL_BACKGROUND_ANDROID } = await import("../src/experience/bots/screens/permitWords.js");
const { keyboardPrimerScreen } = await import("../src/experience/phone/keyboardPrimer.js");
const { botsKeyboardPrimer } = await import("../src/experience/bots/screens/handoff.js");
const { onboardingVoice } = await import("../src/experience/phone/onboarding/voice.js");
const { onboardingKeyboard } = await import("../src/experience/phone/onboarding/keyboard.js");
const { flowArmScreen } = await import("../src/experience/phone/flowArm.js");
const { onboardScreen } = await import("../src/experience/onboard/screens.js");
const { localize } = await import("../src/experience/i18n.js");
const { lintScreen } = await import("../src/experience/sdui2/lint.js");
const { PERM_CARD_LABELS, withAppKnobs } = await import("../src/experience/appKnobs.js");

type Any = Record<string, unknown>;
const SRC = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../src");
const isObj = (v: unknown): v is Any => !!v && typeof v === "object" && !Array.isArray(v);

// ===================================================================== the allowlist

/**
 * Every file allowed to write `primed`, and the screens THIS FILE walks that carry its mark. A new ask that wants
 * the field has to be added here on purpose — which is the whole point: the mark is a promise that this screen
 * explains the permission itself — and it has to name a screen the walk really builds, so the promise is checked.
 */
const ALLOWED: Array<{ file: string; where: string[] }> = [
  { file: "experience/bots/screens/bots/planCall.ts", where: ["bots.plan.call · iPhone", "bots.plan.call · Android"] },
  { file: "experience/bots/screens/firstRun/arrivalCard.ts", where: ["bots.home · iPhone", "bots.home · Android", "bots.home · window"] },
  { file: "experience/bots/screens/firstRun/keybotCard.ts", where: ["bots.keybot · iPhone", "bots.keybot · Android", "bots.keybot · window"] },
  { file: "experience/bots/screens/planItem.ts", where: ["bots.plan.item · Android"] },
  { file: "experience/bots/screens/you/notifyDesk.ts", where: ["bots.notify · iPhone", "bots.notify · Android"] },
  { file: "experience/phone/keyboardPrimer.ts", where: ["keyboard_primer", "keyboard_primer · Bots"] },
  { file: "experience/phone/onboarding/voice.ts", where: ["onboarding (voice)"] },
];

/**
 * Every file under src/ that SETS the field, repo-relative to src/.
 *
 * The quotes are in the pattern because `{ "primed": true }` is the same field written another way, and a lint a
 * pair of quotes walks past is not a lint. The notes at the unmarked asks name the word in prose, which is why the
 * colon has to follow it.
 */
function filesWithPrimed(dir = SRC, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesWithPrimed(p, out);
    else if (e.isFile() && e.name.endsWith(".ts") && /["']?\bprimed["']?\s*:/.test(fs.readFileSync(p, "utf8"))) {
      out.push(path.relative(SRC, p));
    }
  }
  return out;
}

// ===================================================================== the walk

/** The handler keys a FINGER works: a press and nothing else. Everything else is the phone's card's job. */
const BY_TAP = new Set(["onPress"]);
/** Keys that hang another action off this one, so the walk follows them. */
const FOLLOWS = (k: string): boolean => /^on[A-Z]/.test(k) || k === "then" || k === "else" || k === "actions";

/** Every action object a ref reaches, following named actions, sequences, conditions and every onX branch. */
function reached(ref: unknown, actions: Any, seen = new Set<unknown>()): Any[] {
  const out: Any[] = [];
  const visit = (r: unknown): void => {
    if (typeof r === "string") {
      if (seen.has(r) || actions[r] === undefined) return;
      seen.add(r);
      visit(actions[r]);
      return;
    }
    if (!isObj(r) || seen.has(r)) return;
    seen.add(r);
    out.push(r);
    for (const [k, v] of Object.entries(r)) {
      if (Array.isArray(v)) { for (const x of v) if (isObj(x) || (typeof x === "string" && FOLLOWS(k))) visit(x); continue; }
      if (isObj(v)) visit(v);
      else if (typeof v === "string" && FOLLOWS(k)) visit(v);
    }
  };
  visit(ref);
  return out;
}

interface Seen { node: Node; chain: Node[] }
/** The drawn tree: a node and its children. What a card SAYS is read off this. */
function withParents(n: Node, chain: Node[] = [], out: Seen[] = []): Seen[] {
  out.push({ node: n, chain });
  for (const c of n.children ?? []) withParents(c, [...chain, n], out);
  return out;
}

/**
 * The nodes a node holds OUTSIDE `children`: its `fallback` (drawn by a client that cannot draw this type), a
 * `Use`'s `slots`, and any node sitting in its props (a List's `itemTemplate`, a tile in a list of tiles). An
 * action hung on one of those is still an action the screen can run.
 */
function held(n: Node): Node[] {
  const out: Node[] = [];
  const take = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) take(x); return; }
    if (isObj(v) && typeof v.type === "string") out.push(v as unknown as Node);
  };
  take(n.fallback);
  for (const v of Object.values((n.slots ?? {}) as Any)) take(v);
  for (const v of Object.values((n.props ?? {}) as Any)) take(v);
  return out;
}

/** Every node a screen can run something from: the drawn tree, and everything `held` finds under it. */
function everyNode(n: Node, chain: Node[] = [], out: Seen[] = []): Seen[] {
  out.push({ node: n, chain });
  for (const c of [...(n.children ?? []), ...held(n)]) everyNode(c, [...chain, n], out);
  return out;
}

/** Every word drawn inside a node: a Text's content, and a Button's own label. */
function wordsIn(n: Node): string[] {
  return withParents(n)
    .flatMap((s) => [String((s.node.props as Any)?.content ?? ""), String((s.node.props as Any)?.label ?? "")])
    .filter(Boolean);
}
/** What a node says when it is the thing being tapped: its label, or the words inside it. */
const labelOf = (n: Node): string => wordsIn(n).join(" ").trim();
const pressable = (n: Node): boolean => !!(n.on as Any)?.onPress;

/**
 * Every place a node hangs an action: its handlers, its rules and its gestures.
 *
 * A rule fires `do` (shared/types/sdui.ts RuleSpec; the phone's kernel/rules.ts), and so does a gesture — reading
 * `run` and the `onX` keys alone was reading the two shapes that do not exist, so no rule and no gesture was ever
 * counted and a primed ask fired by one went straight through with nothing in front of it. `run` stays because an
 * older tree may still carry it; it costs nothing to follow.
 */
function handlers(n: Node): Array<{ key: string; ref: unknown }> {
  const out: Array<{ key: string; ref: unknown }> = [];
  for (const [k, v] of Object.entries((n.on ?? {}) as Any)) if (v !== undefined) out.push({ key: k, ref: v });
  for (const r of (n.rules ?? []) as Any[]) {
    if (r.do !== undefined) out.push({ key: "rule", ref: r.do });
    if (r.run !== undefined) out.push({ key: "rule", ref: r.run });
  }
  for (const g of (n.gestures ?? []) as Any[]) {
    if (g.do !== undefined) out.push({ key: "gesture.do", ref: g.do });
    for (const [k, v] of Object.entries(g)) if (/^on[A-Z]/.test(k) && v !== undefined) out.push({ key: `gesture.${k}`, ref: v });
  }
  return out;
}

/** What a card's one button may say in front of a system prompt, per permission. */
const CTA: Record<string, string[]> = {
  microphone: ["Continue"],
  motion: ["Continue"],
  // Android's "Allow all the time" hand-off: the request opens the phone's own location page, so the button names
  // that. It is the same shape — one explanation, one thing to tap — and it is allowed for this permission only.
  backgroundLocation: [ARRIVAL_BACKGROUND_ANDROID.cta],
};
/** What the card above an ask has to be talking about, for each permission we mark. */
const EXPLAINS: Record<string, RegExp> = {
  microphone: /microphone/i,
  motion: /driv|in a car/i,
  backgroundLocation: /location|watches for this place/i,
};

interface Found {
  /** How it was fired: "onPress", "onAppear", "rule", "screen.rule", "gesture.do", "props" … */
  key: string;
  node: Node;
  chain: Node[];
  action: Any;
}

/**
 * Every action a screen can run, with the handler that fires it and the node it hangs off.
 *
 * Everything that can fire one: a node's handlers, rules and gestures; the SCREEN's own rules; an action held in a
 * node's props. And over every tree the screen can draw — `root`, a template screen's `blocks`, and each of its
 * `defs` — not only `root.children`.
 */
function firings(s: ScreenResponse): Found[] {
  const actions = (s.actions ?? {}) as Any;
  const out: Found[] = [];
  const bare = { type: "Stack" } as Node;
  const add = (key: string, ref: unknown, node: Node, chain: Node[]): void => {
    for (const action of reached(ref, actions)) out.push({ key, node, chain, action });
  };
  // The screen as a whole: when / every / after with nothing on screen to have been tapped.
  for (const r of (s.rules ?? []) as Any[]) {
    if (r.do !== undefined) add("screen.rule", r.do, s.root ?? bare, []);
    if (r.run !== undefined) add("screen.rule", r.run, s.root ?? bare, []);
  }
  const roots: Node[] = [
    ...(s.root ? [s.root] : []),
    ...((s.blocks ?? []) as Node[]),
    ...Object.values((s.defs ?? {}) as Record<string, { root?: Node }>).flatMap((d) => (d?.root ? [d.root] : [])),
  ];
  for (const r of roots.length ? roots : [bare]) {
    for (const { node, chain } of everyNode(r)) {
      for (const h of handlers(node)) add(h.key, h.ref, node, chain);
      // An action sitting in props is an action too, and no finger pressed it.
      for (const a of allSpecs(node.props ?? {})) add("props", a, node, chain);
    }
  }
  return out;
}

/** Every object in a screen that carries `primed`, however deep — including one nothing can fire. */
function marked(x: unknown, out: Any[] = []): Any[] {
  if (Array.isArray(x)) { for (const v of x) marked(v, out); return out; }
  if (!isObj(x)) return out;
  if ("primed" in x) out.push(x);
  for (const v of Object.values(x)) marked(v, out);
  return out;
}

/** Every requestPermission in a screen, marked or not. */
const asks = (s: ScreenResponse): Any[] => allSpecs(s).filter((a) => a.kind === "requestPermission");
/** Every action object in a screen, however deep. */
function allSpecs(x: unknown, out: Any[] = []): Any[] {
  if (Array.isArray(x)) { for (const v of x) allSpecs(v, out); return out; }
  if (!isObj(x)) return out;
  if (typeof x.kind === "string") out.push(x);
  for (const v of Object.values(x)) allSpecs(v, out);
  return out;
}

// ------------------------------------------------------------------ is it drawn at the same time?

/** A state read, flat key first (the pins below are written flat) then by dot-path. */
function at(st: Any, p: string): unknown {
  if (p in st) return st[p];
  return p.split(".").reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), st);
}

/**
 * Does this condition hold, given a state and the platform the screen was built for?
 *
 * A kind this does not know (`flag`, `entitled`, a number compare) reads TRUE — the careful answer, because what
 * it is used for is "is this other button on screen beside the Continue", and a maybe has to count as a yes.
 */
function holds(c: unknown, st: Any, platform: "ios" | "android"): boolean {
  if (!isObj(c)) return true;
  if ("all" in c) return (c.all as unknown[]).every((x) => holds(x, st, platform));
  if ("any" in c) return (c.any as unknown[]).some((x) => holds(x, st, platform));
  if ("not" in c) return !holds(c.not, st, platform);
  if ("truthy" in c) return !!at(st, String(c.truthy));
  if ("falsy" in c) return !at(st, String(c.falsy));
  if ("platform" in c) return c.platform === platform;
  if ("eq" in c) { const [p, v] = c.eq as [string, unknown]; return at(st, p) === v; }
  if ("neq" in c) { const [p, v] = c.neq as [string, unknown]; return at(st, p) !== v; }
  if ("in" in c) { const [p, v] = c.in as [string, unknown[]]; return (v ?? []).includes(at(st, p)); }
  return true;
}

/** What a chain of conditions PINS DOWN: the flags that must hold for the thing under them to be drawn. */
function pinned(conds: unknown[], out: Any = {}): Any {
  for (const c of conds) {
    if (!isObj(c)) continue;
    if ("truthy" in c) out[String(c.truthy)] = true;
    else if ("falsy" in c) out[String(c.falsy)] = false;
    else if ("not" in c && isObj(c.not) && "truthy" in c.not) out[String(c.not.truthy)] = false;
    else if ("not" in c && isObj(c.not) && "falsy" in c.not) out[String(c.not.falsy)] = true;
    else if ("all" in c) pinned(c.all as unknown[], out);
  }
  return out;
}

/** Every `visibleIf` between a node and (not including) the top of the chain given. */
const conds = (node: Node, chain: Node[]): unknown[] => [...chain.map((c) => c.visibleIf), node.visibleIf].filter(Boolean);

// ------------------------------------------------------------------ the one question

interface Verdict { ok: boolean; why: string }
const no = (why: string): Verdict => ({ ok: false, why });

/**
 * IS THIS ASK THE CONTINUE OF A CARD OF OURS THAT EXPLAINS THIS PERMISSION?
 *
 * The whole rule, in one answer, with the reason it is no — because the value of this walk is that it says which
 * screen and which button, not that something somewhere is wrong. `primed` is set if and only if this is yes.
 */
function cardFired(a: Any, s: ScreenResponse, fired: Found[], platform: "ios" | "android"): Verdict {
  const perm = String(a.permission);
  const mine = fired.filter((f) => f.action === a);
  if (!mine.length) return no(`nothing on the screen fires this ${perm} ask`);
  const notTaps = [...new Set(mine.filter((f) => !BY_TAP.has(f.key)).map((f) => f.key))];
  if (notTaps.length) return no(`the ${perm} ask is fired by ${notTaps.join(", ")}, which explains nothing`);
  const cta = CTA[perm];
  if (!cta) return no(`no Continue is known for "${perm}" — add one to CTA if a card of ours may ask for it`);
  for (const { node, chain } of mine) {
    const label = labelOf(node);
    if (!cta.includes(label)) return no(`the button that asks for ${perm} says "${label}", not ${cta.join(" / ")}`);
    // The card: the first thing above the button that holds more than the button's own word.
    const card = [...chain].reverse().find((c) => wordsIn(c).some((w) => w !== label));
    if (!card) return no(`the ${perm} ask has no card around it`);
    const said = wordsIn(card).join(" ");
    const explains = EXPLAINS[perm];
    if (!explains) return no(`no words are known for "${perm}" — add them to EXPLAINS`);
    if (!explains.test(said)) return no(`the card above the ${perm} ask does not explain it: ${said.slice(0, 160)}`);
    // Long enough to be an explanation and not a label.
    if (said.length <= 60) return no(`the card above the ${perm} ask says almost nothing: ${said}`);
    // AND ONE WAY ON, WITH NOTHING BESIDE IT. Not a word list: anything pressable in the card fails unless its own
    // conditions cannot hold while the Continue's do (planCall's Open Settings, only once the mic is blocked).
    const st = { ...((s.state ?? {}) as Any), ...pinned(conds(node, chain)) };
    const inCard = withParents(card).filter((x) => pressable(x.node) && x.node !== node);
    for (const p of inCard) {
      if (!holds({ all: conds(p.node, p.chain) }, st, platform)) continue;
      const w = labelOf(p.node) || "a button with no words";
      return no(`"${w}" is on screen beside the Continue of the ${perm} ask (5.1.1(iv))`);
    }
  }
  return { ok: true, why: "" };
}

/**
 * THE RULE, on one screen's tree. Returns the marked asks it found, so a caller can say how many it expected.
 *
 * `where` names the screen in every failure.
 */
function checkPrimed(s: ScreenResponse, where: string, platform: "ios" | "android" = "ios"): Any[] {
  const all = marked(s);
  // Nothing but a requestPermission may carry it: on anything else the phone reads no card, shows no card, and the
  // field means nothing at all.
  for (const a of all) {
    expect(a.primed, `${where}: primed is only ever true (${JSON.stringify(a).slice(0, 120)})`).toBe(true);
    expect(a.kind, `${where}: primed on a ${String(a.kind)}, which draws no permission prompt`).toBe("requestPermission");
  }
  const fired = firings(s);
  // BOTH WAYS, over every ask on the screen. Marked and not our card's Continue: a system prompt with nothing in
  // front of it. Our card's Continue and not marked: our card AND the phone's box, which is the double card.
  for (const a of asks(s)) {
    const v = cardFired(a, s, fired, platform);
    if (a.primed === true) {
      expect(v.ok, `${where}: primed on an ask that is not our own card's Continue — ${v.why}`).toBe(true);
    } else {
      expect(v.ok, `${where}: our own card's Continue fires this ${String(a.permission)} ask and it has no primed, so the person gets our card and then the phone's box as well`).toBe(false);
    }
  }
  // A marked object nothing can fire is dead weight that reads as a promise.
  for (const a of all) {
    expect(fired.filter((f) => f.action === a).length, `${where}: a primed ask nothing can fire — ${String(a.permission)}`).toBeGreaterThan(0);
  }
  return all;
}

// ===================================================================== the screens

const PERMS = [
  "PERM_LOCATION", "PERM_CONTACT_PICK", "PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID", "PERM_CALENDAR_ADD",
  "PERM_CALENDAR_READ", "PERM_CALENDAR_READ_ANDROID", "PERM_REMINDERS", "PERM_FOCUS", "PERM_MOTION",
  "PERM_MOTION_ANDROID", "PERM_MOTION_DRIVE", "PERM_MOTION_DRIVE_ANDROID", "PERM_ARRIVAL", "PERM_ARRIVAL_ANDROID",
] as const;
const PHONE_CAN = [
  "BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "VoiceLive",
  "DoubleTap", "KitExtras", "ActionParams", "Scroll", "BotTilesStrip", "BotBuddy", "WriteOn", "LiveMark", "HeadBar",
  "FileUpload", "AudioPlay", "VoiceRecord", "Outbox", "PersonBot", "FontBricolage", "BotCall",
  CAPS.LOCATION_CAPABILITY, CAPS.MOTION_CAPABILITY, CAPS.ARRIVAL_CAPABILITY, CAPS.FOCUS_CAPABILITY,
  CAPS.CALENDAR_READ_CAPABILITY, CAPS.REMINDERS_CAPABILITY, CAPS.CALENDAR_ADD_CAPABILITY,
];
const DESK_CAN = [
  "BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "VoiceLive",
  "DoubleTap", "KitExtras", "PersonBot", "FontBricolage", "DeskShell", "DeskMicAsk", "DeskCamAsk", "DeskAskSetup",
];
const U = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Aanya" };

const EVENT_ID = "11111111-2222-4333-8444-555555555555";
const CALL_ID = "eeeeeeee-0000-4000-8000-0000000000c1";
const CAL = "/v1/botsapp/calendar";
const A = "/v1/botsapp/bots";

/** The first-arrival card is due: Home then draws it, with the microphone step inside. */
const HOME_API = { "GET /v1/bots/first-run/arrival": { due: true, kind: "first" } };

/** A plan item with a place this server has geocoded, so "Remind me when I get there" is drawn with its two cards. */
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

/** An answered Plan Ease call that can talk, which is the only shape that draws the microphone card. */
const CALL_API = {
  [`GET ${A}/plan/calls/${CALL_ID}`]: {
    id: CALL_ID, state: "answered", origin: "server", name: "X0", source: "plan", line: "Leave by 9 pm",
    ringAt: Date.UTC(2026, 9, 28, 14, 0), missedClock: "7:30 pm", answeredAt: Date.UTC(2026, 9, 28, 14, 1),
    endedAt: null, late: false, ai: true, opening: "Ready when you are.",
    card: { item: "pe:11111111-2222-4333-8444-555555555555:1", title: "Leave for the clinic", sub: "9 pm · Koramangala", pay: false },
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

type Client = "phone" | "desktop";
async function draw(
  screenId: string,
  client: Client,
  o: { platform?: "ios" | "android"; params?: Record<string, string>; api?: Record<string, unknown> } = {},
): Promise<ScreenResponse> {
  return buildBotsScreen({
    screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: U,
    can: new Set(client === "phone" ? PHONE_CAN : DESK_CAN),
    desk: { pages: client === "desktop", notes: false },
    ...(client === "phone" ? { platform: o.platform ?? "ios" } : {}),
  }, fakeDeps({ api: o.api ?? {} }));
}

interface BotsJob {
  where: string; id: string; client: Client; platform?: "ios" | "android";
  params?: Record<string, string>; api?: Record<string, unknown>; primed: number;
}

/** Every Bots-app screen that carries an ask, in each context that draws it. */
const BOTS_SCREENS: BotsJob[] = [
  // The first arrival card over Home: the microphone step's Continue.
  { where: "bots.home · iPhone", id: "bots.home", client: "phone", platform: "ios", api: HOME_API, primed: 1 },
  { where: "bots.home · Android", id: "bots.home", client: "phone", platform: "android", api: HOME_API, primed: 1 },
  { where: "bots.home · window", id: "bots.home", client: "desktop", api: HOME_API, primed: 1 },
  // Keylessbord's own card, the same step in its page.
  { where: "bots.keybot · iPhone", id: "bots.keybot", client: "phone", platform: "ios", primed: 1 },
  { where: "bots.keybot · Android", id: "bots.keybot", client: "phone", platform: "android", primed: 1 },
  { where: "bots.keybot · window", id: "bots.keybot", client: "desktop", primed: 1 },
  // The call screen's "Let X0 hear you" card. The window draws the call as a record and asks nothing.
  { where: "bots.plan.call · iPhone", id: "bots.plan.call", client: "phone", platform: "ios", params: { call: CALL_ID }, api: CALL_API, primed: 1 },
  { where: "bots.plan.call · Android", id: "bots.plan.call", client: "phone", platform: "android", params: { call: CALL_ID }, api: CALL_API, primed: 1 },
  { where: "bots.plan.call · window", id: "bots.plan.call", client: "desktop", params: { call: CALL_ID }, api: CALL_API, primed: 0 },
  // What pings you: the driving row's card.
  { where: "bots.notify · iPhone", id: "bots.notify", client: "phone", platform: "ios", api: NOTIFY_API, primed: 1 },
  { where: "bots.notify · Android", id: "bots.notify", client: "phone", platform: "android", api: NOTIFY_API, primed: 1 },
  // The window: the driving row is the phone's own motion, so a window is sent no row, no card and no ask.
  { where: "bots.notify · window", id: "bots.notify", client: "desktop", api: NOTIFY_API, primed: 0 },
  // The plan item: Android's second arrival card ("Allow all the time"). The iPhone has no such step.
  { where: "bots.plan.item · Android", id: "bots.plan.item", client: "phone", platform: "android", params: { kind: "event", id: EVENT_ID }, api: ITEM_API, primed: 1 },
  { where: "bots.plan.item · iPhone", id: "bots.plan.item", client: "phone", platform: "ios", params: { kind: "event", id: EVENT_ID }, api: ITEM_API, primed: 0 },
  { where: "bots.plan.item · window", id: "bots.plan.item", client: "desktop", params: { kind: "event", id: EVENT_ID }, api: ITEM_API, primed: 0 },
  // Keylessbord's three steps in Settings: the ask there only exists so iOS gives the app its own Settings page.
  { where: "bots.keybot.on · iPhone", id: "bots.keybot.on", client: "phone", platform: "ios", primed: 0 },
  { where: "bots.keybot.on · window", id: "bots.keybot.on", client: "desktop", primed: 0 },
];

/** The phone's own screens, outside the Bots app, each built from its own builder. */
function phoneCtx(o: Partial<Any> = {}): never {
  return {
    personality: {}, language: "en", platform: "ios", formFactor: "phone", can: new Set<string>(),
    params: {}, ...o,
  } as never;
}
const PHONE_SCREENS: Array<{ where: string; screen: () => ScreenResponse; primed: number }> = [
  { where: "keyboard_primer", screen: () => keyboardPrimerScreen(phoneCtx({ params: { session: "s1" } })), primed: 1 },
  // What a Bots build really receives: the same actions and the same conditions, in the Bots app's own kit
  // (screens/handoff.ts). The plain tree above is the old app's vocabulary.
  {
    where: "keyboard_primer · Bots",
    screen: () => botsKeyboardPrimer(keyboardPrimerScreen(phoneCtx({ params: { session: "s1" } }))),
    primed: 1,
  },
  // The old onboarding's voice step: now the one compliant explanation, Continue and no ✕.
  { where: "onboarding (voice)", screen: () => onboardingVoice(phoneCtx()), primed: 1 },
  { where: "onboarding_keyboard", screen: () => onboardingKeyboard(), primed: 0 },
  { where: "flow_arm", screen: () => flowArmScreen(phoneCtx()), primed: 0 },
  {
    where: "onboard · phone",
    screen: () => onboardScreen(phoneCtx({ can: new Set(["OnboardStage", "BlipSpot"]), connectorsOn: false })),
    primed: 0,
  },
  {
    where: "onboard · window",
    screen: () => onboardScreen(phoneCtx({
      formFactor: "desktop", os: "mac", connectorsOn: false,
      can: new Set(["OnboardStage", "BlipSpot", "DeskShell", "DeskMicAsk", "DeskCamAsk", "DeskAxState", "DeskSeeState"]),
    })),
    primed: 0,
  },
];

/** One screen by the name the tables above give it, however it is built. */
async function screenFor(where: string): Promise<{ screen: ScreenResponse; platform: "ios" | "android" }> {
  const j = BOTS_SCREENS.find((x) => x.where === where);
  if (j) return { screen: await draw(j.id, j.client, { platform: j.platform, params: j.params, api: j.api }), platform: j.platform ?? "ios" };
  const p = PHONE_SCREENS.find((x) => x.where === where);
  if (!p) throw new Error(`no screen is walked under the name "${where}"`);
  return { screen: p.screen(), platform: "ios" };
}

beforeEach(() => { for (const k of PERMS) vi.stubEnv(k, "true"); vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

// ===================================================================== the tests

describe("the word itself", () => {
  it("is written only where it is allowed, so a new use is a deliberate one", () => {
    expect(filesWithPrimed().sort()).toEqual(ALLOWED.map((a) => a.file).sort());
  });

  it("every allowlisted file has a screen this walk really builds, and the mark is on it", async () => {
    for (const a of ALLOWED) {
      expect(a.where.length, `${a.file}: allowlisted and no screen named to check it on`).toBeGreaterThan(0);
      let seen = 0;
      for (const where of a.where) {
        const { screen, platform } = await screenFor(where);
        seen += checkPrimed(screen, where, platform).length;
      }
      expect(seen, `${a.file}: none of its screens (${a.where.join(", ")}) carries a primed ask`).toBeGreaterThan(0);
    }
  });

  it("the contract says what the phone does with it, and the rule for setting it", () => {
    const t = fs.readFileSync(path.resolve(SRC, "../../shared/types/sdui.ts"), "utf8");
    expect(t).toMatch(/primed\?: true;/);
    const doc = t.slice(t.indexOf("THE CARD HAS ALREADY BEEN SHOWN"), t.indexOf("primed?: true;"));
    expect(doc).toMatch(/primedCard/);
    expect(doc).toMatch(/ONLY ON AN ASK FIRED/);
    expect(doc).toMatch(/5\.1\.1\(iv\)/);
    // And it says WHICH players draw the box, because one that declares nothing draws none (the window, and every
    // build older than the field).
    expect(doc).toMatch(/declares `primed` in its capabilities/);
    expect(t).toMatch(/primed\?: boolean;/);
  });

  it("the phone's own box names the permission and the reason, on every build that draws one", () => {
    for (const k of ["perm.microphone.title", "perm.microphone.body", "perm.motion.title", "perm.motion.body"]) {
      expect(PERM_CARD_LABELS[k], k).toBeTypeOf("string");
    }
    expect(PERM_CARD_LABELS["perm.microphone.body"]).toMatch(/microphone/i);
    expect(PERM_CARD_LABELS["perm.motion.body"]).toMatch(/driv/i);
    // And they go out in the bootstrap, which is the only way the phone ever sees them.
    const out = withAppKnobs({ labels: {}, flags: {} });
    expect(out.labels?.["perm.microphone.title"]).toBe(PERM_CARD_LABELS["perm.microphone.title"]);
    // The catalog still wins over them, as it does over every knob.
    expect(withAppKnobs({ labels: { "perm.microphone.title": "theirs" }, flags: {} }).labels?.["perm.microphone.title"]).toBe("theirs");
  });
});

describe("everything between the screen and the phone keeps the field", () => {
  it("the translator walks a requestPermission and hands primed on (i18n.ts case \"requestPermission\")", async () => {
    const s = await draw("bots.notify", "phone", { api: NOTIFY_API });
    expect(asks(s).find((a) => a.permission === "motion")?.primed).toBe(true);
    const hi = await localize(s as never, "hi");
    const ask = asks(hi as never).find((a) => a.permission === "motion");
    expect(ask, "the translator dropped the ask").toBeTruthy();
    expect(ask!.primed, "the translator dropped primed").toBe(true);
    // And the branches it does translate are still there.
    expect(ask!.onGranted).toBeTruthy();
    expect(ask!.onBlocked).toBeTruthy();
  });

  it("the publish gate takes it: an unknown field on an action is not a refusal (sdui2/lint.ts)", () => {
    const r = lintScreen({
      schemaVersion: CAPS.SDUI_SCHEMA_VERSION, screenId: "made-up", title: "",
      needs: ["rules"],
      root: {
        type: "Stack",
        children: [{
          type: "Stack",
          on: { onPress: { kind: "requestPermission", permission: "microphone", primed: true } as never },
          children: [{ type: "Text", props: { content: "Continue" } }],
        }],
      },
    } as never);
    expect(r.errors).toEqual([]);
  });
});

describe("the Bots app's screens", () => {
  for (const j of BOTS_SCREENS) {
    it(`${j.where}: every primed ask sits behind its own card, and every ask behind a card of ours carries it`, async () => {
      const s = await draw(j.id, j.client, { platform: j.platform, params: j.params, api: j.api });
      const found = checkPrimed(s, j.where, j.platform ?? "ios");
      expect(found.length, `${j.where}: ${found.length} primed asks, expected ${j.primed}`).toBe(j.primed);
      // Any ask the walk did NOT mark still has nothing: the phone's own box is its explanation.
      for (const a of asks(s)) if (!found.includes(a)) expect(a.primed, `${j.where}: ${String(a.permission)}`).toBeUndefined();
    });
  }
});

describe("the phone's own screens", () => {
  for (const j of PHONE_SCREENS) {
    it(`${j.where}: the same rule`, () => {
      const s = j.screen();
      const found = checkPrimed(s, j.where);
      expect(found.length, `${j.where}: ${found.length} primed asks, expected ${j.primed}`).toBe(j.primed);
      for (const a of asks(s)) if (!found.includes(a)) expect(a.primed, `${j.where}: ${String(a.permission)}`).toBeUndefined();
    });
  }
});

describe("each marked card's Continue, by name", () => {
  it("the first arrival card asks for the microphone with primed, and says why first", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await draw("bots.home", client, { api: HOME_API });
      const ask = asks(s).find((a) => a.permission === "microphone");
      expect(ask, `bots.home · ${client}`).toMatchObject({ kind: "requestPermission", permission: "microphone", primed: true });
      expect(JSON.stringify(s)).toContain("Next, your phone asks you.");
    }
  });

  it("Keylessbord's card asks for the microphone with primed", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await draw("bots.keybot", client);
      expect(asks(s).find((a) => a.permission === "microphone"), `bots.keybot · ${client}`)
        .toMatchObject({ permission: "microphone", primed: true });
    }
  });

  it("the call screen's askMic is primed, and the tap that only reads is not an ask at all", async () => {
    const s = await draw("bots.plan.call", "phone", { params: { call: CALL_ID }, api: CALL_API });
    expect(s.actions?.askMic).toMatchObject({ kind: "requestPermission", permission: "microphone", primed: true });
    // Tap to talk never asks: it reads the answer on record and opens the card when there is none.
    expect(s.actions?.talk).toMatchObject({ kind: "checkPermission", permission: "microphone" });
    expect(JSON.stringify(s.actions?.talk)).not.toContain("requestPermission");
  });

  it("the driving row's card is the explanation, so its ask is primed — and the row itself only opens the card", async () => {
    for (const platform of ["ios", "android"] as const) {
      const s = await draw("bots.notify", "phone", { platform, api: NOTIFY_API });
      const ask = asks(s).find((a) => a.permission === "motion");
      expect(ask, `bots.notify · ${platform}`).toMatchObject({ permission: "motion", primed: true });
      expect(JSON.stringify(s)).toContain(DRIVE.title);
      // The switch opens the card; the only requestPermission on the page is the card's own.
      expect(asks(s).length).toBe(1);
    }
    // The window asks nothing: the driving check is the phone's own motion, so it is sent no row at all.
    const desk = await draw("bots.notify", "desktop", { api: NOTIFY_API });
    expect(asks(desk)).toEqual([]);
    expect(JSON.stringify(desk)).not.toContain(DRIVE.title);
  });

  it("Android's \"Allow all the time\" hand-off is primed behind Play's disclosure, and the iPhone has neither", async () => {
    const and = await draw("bots.plan.item", "phone", { platform: "android", params: { kind: "event", id: EVENT_ID }, api: ITEM_API });
    expect(asks(and).find((a) => a.permission === "backgroundLocation"))
      .toMatchObject({ permission: "backgroundLocation", primed: true });
    expect(JSON.stringify(and)).toContain("even when the app is closed or not in use");
    // And the card's own line is true on both Androids: on 10 the request draws a dialog, from 11 it opens the
    // phone's location page, so it promises neither on its own.
    expect(ARRIVAL_BACKGROUND_ANDROID.lines.join(" ")).toContain("so the next tap asks you, or opens your phone's own location page");
    const ios = await draw("bots.plan.item", "phone", { platform: "ios", params: { kind: "event", id: EVENT_ID }, api: ITEM_API });
    expect(asks(ios)).toEqual([]);
  });

  it("the keyboard primer's Continue is primed, and nothing stands beside it until the prompt is answered", () => {
    const s = keyboardPrimerScreen(phoneCtx({ params: { session: "s1" } }));
    expect(s.actions?.grantMic).toMatchObject({ kind: "requestPermission", permission: "microphone", primed: true });
    expect(JSON.stringify(s)).toContain("Answer the iOS microphone prompt");
    // The Settings button waits for micAsked, which only a refusal sets. On a first visit iOS has no Microphone
    // row for this app anyway, so a button offering it would lead nowhere AND put the prompt off.
    expect(s.state?.micAsked).toBe(false);
    const after = { all: [{ not: { truthy: "micGranted" } }, { truthy: "micAsked" }] };
    const settings = (s.root!.children ?? []).find((n) => (n.props as Any)?.label === "Open X0 Bot Settings");
    expect(settings?.visibleIf).toEqual(after);
    expect(JSON.stringify(s.actions?.denied)).toContain('"path":"micAsked"');
    // The Bots app's own tree says the same thing, which bots-handoff.test.ts holds the two to.
    expect(JSON.stringify(botsKeyboardPrimer(s))).toContain(JSON.stringify(after));
  });

  it("the old onboarding's voice step is the one explanation: Continue, no ✕, and the microphone named", () => {
    const s = onboardingVoice(phoneCtx());
    expect(s.actions?.allowMic).toMatchObject({ kind: "requestPermission", permission: "microphone", primed: true });
    const said = JSON.stringify(s);
    expect(said).toContain("X0 Bot uses the microphone so you can talk in every app you type in. Next, your phone asks you.");
    expect(said).toContain("Continue");
    expect(said).not.toContain("Allow access");
    // The ✕ is the pill's `onDismiss`, and it is gone: the way out is the system's own No, which moves the step on.
    expect(said).not.toContain("M6 6 L18 18 M18 6 L6 18");
    expect(JSON.stringify(s.actions?.deniedNext)).toContain("onboarding_keyboard");
  });
});

describe("the asks that keep the phone's own card", () => {
  it("Keylessbord's Settings steps: the ask is read first, and only made when the mic is not granted", async () => {
    const s = await draw("bots.keybot.on", "phone");
    const mic = asks(s);
    expect(mic.length).toBeGreaterThan(0);
    for (const a of mic) expect(a.primed).toBeUndefined();
    // Because there IS a way out on that screen, which is the shape 5.1.1(iv) forbids in front of a prompt.
    expect(JSON.stringify(s)).toContain("Not now");
    // And the ask is behind a READ: granted, which is the usual answer by this step, opens Settings with no box.
    const read = allSpecs(s).find((x) => x.kind === "checkPermission" && x.permission === "microphone");
    expect(read, "the mic is asked for without being read first").toBeTruthy();
    expect(JSON.stringify(read!.onGranted)).not.toContain("requestPermission");
    expect(JSON.stringify(read!.onDenied)).toContain("requestPermission");
    expect(JSON.stringify(read!.onGranted)).toContain("app-settings:");
  });

  it("the keyboard step's belt-and-suspenders ask, on both onboardings, stays unmarked and behind a read", () => {
    for (const s of [onboardingKeyboard(), onboardScreen(phoneCtx({ can: new Set(["OnboardStage", "BlipSpot"]), connectorsOn: false }))]) {
      const mic = asks(s);
      expect(mic.length).toBeGreaterThan(0);
      for (const a of mic) expect(a.primed).toBeUndefined();
      const read = allSpecs(s).find((x) => x.kind === "checkPermission" && x.permission === "microphone"
        && JSON.stringify(x.onDenied ?? "").includes("requestPermission"));
      expect(read, "the keyboard step asks for the mic without reading it first").toBeTruthy();
      expect(JSON.stringify(read!.onGranted)).not.toContain("requestPermission");
      expect(JSON.stringify(read!.onGranted)).toContain("app-settings:");
    }
  });

  it("flow_arm reads before it asks, so a phone that already allowed the mic sees no box at all", () => {
    const s = flowArmScreen(phoneCtx());
    // On appear: a READ. The phone draws its box before it looks at the permission, so an ask here put a card and
    // a Continue in front of a mic allowed months ago, every time the flow session idled out.
    expect(s.actions?.arm).toMatchObject({ kind: "checkPermission", permission: "microphone", onGranted: "doArm" });
    expect(JSON.stringify(s.actions?.arm)).not.toContain("requestPermission");
    // The ask behind it is a first ask, and unmarked: nothing was tapped, so the phone's box is all it has.
    expect(s.actions?.askMic).toMatchObject({ kind: "requestPermission", permission: "microphone", onGranted: "doArm" });
    expect((s.actions?.askMic as Any).primed).toBeUndefined();
    expect(firings(s).filter((f) => f.action === s.actions?.askMic).map((f) => f.key)).toContain("onAppear");
  });

  it("Make me yours: a switch fires each ask, with no card, so none is marked", () => {
    const s = onboardScreen(phoneCtx({ can: new Set(["OnboardStage", "BlipSpot"]), connectorsOn: false }));
    for (const a of asks(s)) expect(a.primed).toBeUndefined();
    // And the switches really are what fire them.
    const byChange = firings(s).filter((f) => f.key === "onChange" && f.action.kind === "requestPermission");
    expect(byChange.length).toBeGreaterThan(0);
  });

  it("the window's permissions step asks from a row's own button, unmarked (the window has no card of its own)", () => {
    const s = onboardScreen(phoneCtx({
      formFactor: "desktop", os: "mac", connectorsOn: false,
      can: new Set(["OnboardStage", "BlipSpot", "DeskShell", "DeskMicAsk", "DeskCamAsk", "DeskAxState", "DeskSeeState"]),
    }));
    const mic = asks(s);
    expect(mic.length).toBeGreaterThan(0);
    for (const a of mic) expect(a.primed).toBeUndefined();
  });
});

describe("the walk itself refuses what it is meant to", () => {
  const card = (cta: Node, extra: Node[] = []): ScreenResponse => ({
    schemaVersion: CAPS.SDUI_SCHEMA_VERSION, screenId: "made-up", title: "", state: {},
    root: {
      type: "Stack",
      children: [{
        type: "Stack",
        children: [
          { type: "Text", props: { content: "Let X0 Bot hear you" } },
          { type: "Text", props: { content: "X0 Bot uses the microphone so you can talk to any bot, in any app. Next, your phone asks you." } },
          cta, ...extra,
        ],
      }],
    },
  });
  const ask = { kind: "requestPermission", permission: "microphone", primed: true } as const;
  const press = (label: string, on: Record<string, unknown> = { onPress: ask }): Node =>
    ({ type: "Stack", on: on as never, children: [{ type: "Text", props: { content: label } }] });

  it("passes the shape it is written for", () => {
    expect(checkPrimed(card(press("Continue")), "made-up")).toHaveLength(1);
  });
  it("refuses primed on anything that is not a requestPermission", () => {
    expect(() => checkPrimed(card(press("Continue", { onPress: { kind: "toast", message: "hi", primed: true } })), "made-up")).toThrow();
  });
  it("refuses an ask nothing taps", () => {
    expect(() => checkPrimed(card(press("Continue", { onAppear: ask })), "made-up")).toThrow(/onAppear/);
  });
  it("refuses a button that does not say Continue", () => {
    expect(() => checkPrimed(card(press("Allow access")), "made-up")).toThrow(/Allow access/);
  });
  it("refuses Open Settings as the Continue of a microphone ask: that word is Android's background location alone", () => {
    expect(() => checkPrimed(card(press(ARRIVAL_BACKGROUND_ANDROID.cta)), "made-up")).toThrow(/Open Settings/);
  });
  it("refuses a card that explains something else", () => {
    const s = card(press("Continue"));
    const inner = s.root!.children![0]!;
    inner.children = [
      { type: "Text", props: { content: "Turn on full access" } },
      { type: "Text", props: { content: "In Settings, open Keyboards, switch on X0 Bot, then Allow Full Access." } },
      inner.children![2]!,
    ];
    expect(() => checkPrimed(s, "made-up")).toThrow(/does not explain/);
  });

  // THE WAY OUT IS NOT A WORD LIST. Every one of these passed the old list, which named eight phrases; what is
  // checked now is whether the thing can be on screen beside the Continue at all.
  for (const w of ["Not now", "Close", "Done", "Skip for now", "No, thanks", "Not yet", "Back", "Open Settings", "Open X0 Bot Settings"]) {
    it(`refuses "${w}" beside the Continue of a primed ask`, () => {
      expect(() => checkPrimed(card(press("Continue"), [press(w, { onPress: { kind: "navigateBack" } })]), "made-up"))
        .toThrow(new RegExp(`"${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" is on screen beside`));
    });
  }
  it("refuses a wordless ✕ beside it", () => {
    expect(() => checkPrimed(card(press("Continue"), [{ type: "Stack", on: { onPress: { kind: "navigateBack" } } as never }]), "made-up"))
      .toThrow(/no words/);
  });
  it("takes a second button that cannot be drawn while the Continue is: the shape planCall's Open Settings has", () => {
    const s = card(
      { ...press("Continue"), visibleIf: { falsy: "micBlocked" } },
      [{ ...press("Open Settings", { onPress: { kind: "openSettings", target: "app" } }), visibleIf: { truthy: "micBlocked" } }],
    );
    s.state = { micBlocked: false };
    expect(checkPrimed(s, "made-up")).toHaveLength(1);
  });
  it("takes one that waits on a flag the ask itself sets: the keyboard primer's Settings button", () => {
    const s = card(
      { ...press("Continue"), visibleIf: { not: { truthy: "micGranted" } } },
      [{ ...press("Open X0 Bot Settings", { onPress: { kind: "openSettings" } }), visibleIf: { all: [{ not: { truthy: "micGranted" } }, { truthy: "micAsked" }] } }],
    );
    s.state = { micGranted: false, micAsked: false };
    expect(checkPrimed(s, "made-up")).toHaveLength(1);
  });

  // THE OTHER DIRECTION: an ask our own card's Continue fires, with no mark, is our card AND the phone's box.
  it("refuses an unmarked ask behind the Continue of a card that explains it", () => {
    const bare = { kind: "requestPermission", permission: "microphone" } as const;
    expect(() => checkPrimed(card(press("Continue", { onPress: bare })), "made-up"))
      .toThrow(/and then the phone's box as well/);
  });

  // EVERYTHING THAT CAN FIRE AN ACTION. Each of these fired a primed ask with no explanation in front of it and
  // the old walk never looked: it read `run` on a rule (the field is `do`), only `onX` on a gesture (also `do`),
  // and nothing but `root.children`.
  const fired = (why: string, mutate: (s: ScreenResponse) => void): void => {
    it(`refuses a primed ask fired by ${why}`, () => {
      const s = card(press("Continue", { onPress: { kind: "navigateBack" } }));
      mutate(s);
      expect(() => checkPrimed(s, "made-up")).toThrow(/which explains nothing/);
    });
  };
  fired("a node's own rule", (s) => { s.root!.rules = [{ id: "r", after: 0, do: ask } as never]; });
  fired("the screen's rules", (s) => { s.rules = [{ id: "r", when: { expr: "true" }, do: ask } as never]; });
  fired("a gesture", (s) => { s.root!.gestures = [{ kind: "longPress", do: ask } as never]; });
  fired("a fallback's onAppear", (s) => { s.root!.fallback = { type: "Stack", on: { onAppear: ask } as never }; });
  fired("a slot's onAppear", (s) => { s.root!.slots = { body: { type: "Stack", on: { onAppear: ask } as never } }; });
  fired("a def's tree", (s) => { s.defs = { card: { root: { type: "Stack", on: { onAppear: ask } as never } } } as never; });
  fired("a block's onAppear", (s) => { s.blocks = [{ type: "Stack", on: { onAppear: ask } as never }]; });
  fired("an action in a node's props", (s) => {
    (s.root!.children![0]! as Node).props = { itemTemplate: { type: "Stack", on: { onAppear: ask } as never } };
  });
  it("refuses a primed ask reached from a Continue AND from an action in props", () => {
    const s = card(press("Continue"));
    (s.root!.children![0]! as Node).props = { items: [{ onPress: ask }] };
    expect(() => checkPrimed(s, "made-up")).toThrow(/props/);
  });
});
