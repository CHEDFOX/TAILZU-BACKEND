/**
 * THE NEW ONBOARDING, FOR THE BUILDS IN THE STORES.
 *
 * A fresh download from the App Store or Play runs the JavaScript the store
 * build was made with on its first launch; an over-the-air update applies only
 * on the NEXT one. So a new person, the one the new onboarding is for, would
 * meet the old one. This is the same onboarding drawn only with what that
 * build already draws: no OnboardStage, no BlipSpot, nothing that is not in its
 * registry (the phone repo's main: sdui/registry.ts, components*.tsx,
 * actions.ts). tests/onboard-store.test.ts holds that down, name by name,
 * against those files.
 *
 * THE SAME STEPS AND WORDS. The steps are onboard.ts's own builders
 * (languagesStep, keyboardStep, yoursStep, appsStep, carefulStep, doneStep),
 * called with a Plan whose `step` and `spot` are this file's: a step here is a
 * pane in one screen, Blip here is a picture. Every line is OB_EN / OB_HG
 * (OB_STORE_EN for the four that say how to use a tap-to-talk button), so
 * there is one place the words live, and Hinglish applies to this screen as
 * it does to that one (it is the same screen id, `onboard`).
 *
 * WHICH STEPS, AND IN WHAT ORDER. Sign-in and the code are the store build's
 * own native screens, drawn before there is a session, and they stay exactly as
 * they are (see below). So the flow is: sign in (native) -> Welcome ->
 * Languages -> Keyboard -> Try it -> Make me yours -> [Connect apps -> How
 * careful ->] Done. Welcome comes after sign-in here, where the stage puts it
 * before.
 *
 * HOW THE STEPS MOVE. Not a Pager: the store's Pager is a free swipe with no
 * way to go to a page from a button or a state, so Continue could not advance
 * it, a person could swipe past Make me yours, nothing could resume at the
 * right page, and its pages do not scroll. Not a screen per step either
 * (navigate replace): each would be a fetch, and the state the steps share
 * (the languages, what was said, the switches) would be lost between them. One
 * screen, a `step` in its state, a pane per step shown by `visibleIf`; Continue
 * is a setState; and each pane arrives with the build's own entrance motion
 * (`motion.appear`, and Rise for Blip) every time it becomes the one shown. The
 * bar on top reads the same `step`. A pane scrolls inside a Screen, its buttons
 * pinned below it, which is also what a short phone needs.
 *
 * BLIP is a short transparent loop of the same drawing, per pose, drawn by the
 * build's Image (expo-image animates a WebP): blipLoops.ts. The next step's
 * pictures are fetched while this one is shown, so they are there when it
 * arrives.
 *
 * SIGN-IN IS NOT TOUCHED. The store build draws its sign-in from the bootstrap's
 * `auth.screen` with pills and buttons whose looks come from props this tree
 * would have to reach into (the backdrop behind them is its own layer), and
 * "sign in works by every method" is worth more than the paper. Those builds are
 * sent the sign-in tree they have always been sent.
 *
 * WHAT THE BUILD CANNOT DO, THE FLOW DOES NOT PROMISE. Connect apps opens the
 * assistant's sign-in page from an answer the server only learns after a call:
 * that needs the build to fill "$state.x" into an address, which the build
 * says with `ActionUrl` and the store build does not. Without it Connect apps
 * and How careful are left out (as when connected apps are off), and the words
 * that mention apps change.
 */
import type { ActionSpec, Condition, Node, ScreenResponse } from "../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../shared/types/sdui.js";
import { DAILY_LANGUAGES } from "./catalog.js";
import type { ScreenContext } from "./catalog.js";
import { BLIP_LOOPS, blipSize, blipUrl } from "./blipLoops.js";
import type { BlipLoop } from "./blipLoops.js";
import {
  BTN, C1, EN, FINE, FROM, H, HD, IF, LAB, OB, OB_STORE_EN, P, PUSH, SET, TXT,
  appsStep, canOnboard, carefulStep, doneStep, haptic, keyboardStep, languagesStep, permActions, plain, postAuthSteps,
  seq, shownChip, toast, yoursStep,
} from "./onboard.js";
import type { Plan, Style } from "./onboard.js";

/**
 * The node types this screen draws, all of them in the store build's registry:
 * a build that does not declare every one is served the old onboarding.
 */
export const STORE_NEEDS = [
  "Stack", "Screen", "Text", "Heading", "Paragraph", "Image", "Rise", "SVG",
  "Switch", "Grid", "BottomSheet", "VoiceButton",
] as const;

const hasAll = (c: unknown, names: readonly string[]): boolean => {
  const has = c instanceof Set ? (n: string) => c.has(n) : Array.isArray(c) ? (n: string) => c.includes(n) : null;
  return !!has && names.every(has);
};

/**
 * Does the asking build get the store variant? A phone that cannot draw the
 * stage and Blip (those get onboard.ts), while ONBOARD_V2 is not "0", and that
 * says it draws everything this tree is made of.
 */
export function canOnboardStore(c?: unknown, formFactor?: string): boolean {
  if (process.env.ONBOARD_V2 === "0") return false;
  if (formFactor === "desktop" || canOnboard(c)) return false;
  return hasAll(c, STORE_NEEDS);
}

export type OnboardMode = "v2" | "store" | "old";

/** Which onboarding this build is given: the stage's, the store variant's, or the one it has always had. */
export function onboardMode(c?: unknown, formFactor?: string): OnboardMode {
  return canOnboard(c) ? "v2" : canOnboardStore(c, formFactor) ? "store" : "old";
}

/** The build can fill "$state.x" into an address (so Connect apps works). */
export const storeCanConnect = (c?: unknown): boolean => hasAll(c, ["ActionUrl"]);

/**
 * Where a cold start lands. Languages are asked once: someone who has answered
 * has met Welcome, and goes on to the next thing still missing (the keyboard,
 * else Try it); someone who has not starts at Welcome.
 */
export function storeStart(f: { languagesSet: boolean; keyboardReady: boolean; I: Record<string, number> }): number {
  if (!f.languagesSet) return f.I.welcome!;
  return f.keyboardReady ? f.I.try! : f.I.keyboard!;
}

// ---------------------------------------------------------------------------
// Blip, as a picture
// ---------------------------------------------------------------------------

/** One of Blip's loops, drawn at the size it was cut at. */
function blipImage(loop: BlipLoop): Node {
  const { w, h } = blipSize(loop);
  return {
    type: "Image",
    props: { source: { url: blipUrl(loop) }, contentFit: "contain" },
    // A radius of 0: an Image rounds itself by default, and he is not a tile.
    style: { width: w, height: h, borderRadius: 0 },
  };
}

/** The speech bubble: what he says, in his hand, with a tail toward him. */
function bubble(content: string, big: boolean, tail: "left" | "bottom"): Node {
  const square: Style = {
    width: 12, height: 12, backgroundColor: OB.surf, borderColor: OB.ink, transform: [{ rotate: "45deg" }],
    ...(tail === "left" ? { borderLeftWidth: 2, borderBottomWidth: 2 } : { borderRightWidth: 2, borderBottomWidth: 2 }),
  };
  return {
    type: "Stack",
    style: {
      paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, borderWidth: 2, borderColor: OB.ink, backgroundColor: OB.surf,
      ...(tail === "left" ? { flexShrink: 1, marginTop: 14, marginLeft: -2 } : { alignSelf: "center", marginBottom: 12 }),
    },
    children: [
      {
        type: "Text",
        props: { content },
        style: plain({
          fontFamily: OB.hand, fontSize: big ? 22 : 19, lineHeight: big ? 26 : 22, color: OB.ink,
          ...(tail === "bottom" ? { textAlign: "center" } : {}),
        }),
      },
      // The tail is a square on the edge, turned: half of it shows.
      tail === "left"
        ? { type: "Stack", style: { position: "absolute", left: -8, top: 15, ...square } }
        : { type: "Stack", style: { position: "absolute", left: 0, right: 0, bottom: -8, alignItems: "center" }, children: [{ type: "Stack", style: square }] },
    ],
  };
}

/**
 * Where Blip stands, in which pose, saying what: the same call a stage's
 * BlipSpot answers, answered with a picture and a bubble. A step's head is the
 * small loop with the bubble beside it; Welcome's and Done's is the big one
 * with the bubble over it (where the stage says "corner").
 */
const spot: Plan["spot"] = (pose, _h, say, bubbleAt = "side", x = {}) => {
  const big = bubbleAt === "corner";
  const loop = `${pose}-${big ? "l" : "s"}` as BlipLoop;
  if (!(BLIP_LOOPS as readonly string[]).includes(loop)) throw new Error(`Blip has no loop ${loop}`);
  // He rises into place a beat after the pane does.
  const him: Node = { type: "Rise", props: { delayMs: 120, fromY: 28, scaleFrom: 0.88 }, children: [blipImage(loop)] };
  return {
    type: "Stack",
    // A burst is thrown when he arrives (a first good Try it, Done).
    ...(x.burst === true ? { on: { onAppear: { kind: "confetti" } as ActionSpec } } : {}),
    style: big ? { alignItems: "center" } : { flexDirection: "row", alignItems: "flex-start" },
    children: big ? [bubble(EN[say], true, "bottom"), him] : [him, bubble(EN[say], false, "left")],
  };
};

// ---------------------------------------------------------------------------
// A step is a pane
// ---------------------------------------------------------------------------

/** A node that draws nothing in the layout and so is not part of the pinned foot: a sheet, a watcher. */
const aside = (n: Node): boolean => n.type === "BottomSheet" || (n.style?.height === 0 && n.type === "Stack");

/**
 * A pane: what the step says scrolls, and what it asks (the buttons under the
 * spacer the steps already end with) is pinned below. Shown only while `step`
 * is its own, which is also what makes its entrance motion run each time it is
 * reached, and its `onAppear` (the permission check, the keyboard watcher) run
 * when it is.
 */
function paneFor(index: number): Plan["step"] {
  return (id, kids, extra = {}) => {
    const all = kids.filter((k): k is Node => !!k);
    const cut = all.findIndex((k) => k.type === "Spacer");
    const body = cut < 0 ? all : all.slice(0, cut);
    const rest = cut < 0 ? [] : all.slice(cut + 1);
    const foot = rest.filter((k) => !aside(k));
    return {
      type: "Stack",
      id,
      visibleIf: { eq: ["step", index] },
      style: { flex: 1 },
      ...extra,
      children: [
        {
          type: "Screen",
          // What is under the last line is the foot's, not a tab bar's.
          props: { paddingBottom: 12 },
          style: { backgroundColor: OB.paper, paddingHorizontal: OB.side, paddingTop: 4 },
          children: [{ type: "Stack", motion: { appear: "fadeInUp", durationMs: 320, delayMs: 40 }, children: body }],
        },
        ...(foot.length
          ? [{
              type: "Stack" as const,
              motion: { appear: "fadeInUp" as const, durationMs: 320, delayMs: 140 },
              style: { paddingHorizontal: OB.side, paddingTop: 10, paddingBottom: 34, gap: 8 },
              children: foot,
            }]
          : []),
        ...rest.filter(aside),
      ],
    };
  };
}

// ---------------------------------------------------------------------------
// The steps this build has to say differently
// ---------------------------------------------------------------------------

function welcomeStep(p: Plan): Node {
  return p.step("welcome", [
    C1(p.spot("wave", 196, "s1.say", "corner")),
    H("s1.h", true),
    P(p.appsOn ? "s1.p" : "s1.p0", { textAlign: "center", paddingHorizontal: 6 }),
    PUSH(),
    BTN(EN["s1.cta"], seq(haptic("selection"), SET(p.I.languages!))),
    FINE("s1.fine", true),
  ]);
}

/**
 * Try it. The store build's mic button is tapped to start and tapped to stop,
 * and says only its own words (there is no state to read "recording" from), so
 * the lines that say how, and the pose that listens, are not here.
 */
function tryStep(p: Plan): Node {
  const untried: Condition = { falsy: "tried" };
  const tried: Condition = { truthy: "tried" };
  const mic = (label: string, shown: Condition, first: boolean): Node => ({
    type: "VoiceButton",
    bind: { value: "tried" },
    visibleIf: shown,
    props: {
      label, stopLabel: OB_STORE_EN["st.live"], transcribingLabel: EN["s4.busy"],
      // Lit while it listens: the neon with ink on it.
      background: OB.ink, recordingBackground: OB.neon, recordingColor: OB.ink, radius: 28, paddingVertical: 16,
    },
    style: { marginTop: 10 },
    // The mic is asked for by the button itself, on the first tap.
    on: { onError: toast(EN["s4.err"], "error"), onChange: first ? haptic("success") : haptic("selection") },
  });
  return p.step("try", [
    HD(
      { ...p.spot("present", 96, "s4.say"), visibleIf: untried },
      { ...p.spot("tada", 96, "s4.say2", "side", { burst: true }), visibleIf: tried },
    ),
    H("s4.h"),
    { type: "Paragraph", props: { content: OB_STORE_EN["st.p"] }, style: plain({ fontSize: 15, lineHeight: 21, color: OB.ink2, marginBottom: 12 }) },
    {
      type: "Stack",
      style: { gap: 8, marginVertical: 4 },
      children: [
        {
          type: "Stack",
          style: { borderRadius: 16, padding: 11, borderWidth: 1.5, borderColor: OB.hair, backgroundColor: OB.surf },
          children: [LAB("s4.you"), TXT(EN["s4.ex"], { fontSize: 16, fontStyle: "italic", color: OB.ink2 })],
        },
        {
          type: "Stack",
          style: {
            borderRadius: 16, padding: 11, minHeight: 70, borderWidth: 1.5, borderColor: OB.ink,
            backgroundColor: IF(tried, OB.neonSoft, OB.white),
          },
          children: [
            LAB("s4.me"),
            { ...TXT("• • •", { fontSize: 18, letterSpacing: 3.6, color: OB.ti2 }), visibleIf: untried },
            { ...FROM("tried", { fontSize: 17, lineHeight: 22, fontWeight: "600", color: OB.ink }), visibleIf: tried },
          ],
        },
      ],
    },
    mic(OB_STORE_EN["st.tap"], untried, true),
    mic(OB_STORE_EN["st.again"], tried, false),
    { ...FINE("s4.ok", true), visibleIf: tried },
    PUSH(),
    BTN(EN["ob.cont"], SET(p.next("try"))),
  ]);
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * Every Blip picture a pane draws, so the pane before it can have them fetched.
 * A pane's own ride in as soon as it is shown (the entrance hides the wait); the
 * next one's are drawn, 1 point and clear, in the pane before.
 */
function loopsIn(n: Node, out = new Set<string>()): Set<string> {
  const url = (n.props?.source as { url?: unknown } | undefined)?.url;
  if (n.type === "Image" && typeof url === "string" && url.includes("/blip/")) out.add(url);
  for (const c of n.children ?? []) loopsIn(c, out);
  return out;
}

const preload = (url: string): Node => ({
  type: "Image",
  props: { source: { url }, contentFit: "contain" },
  style: { position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, borderRadius: 0 },
});

/** An action field the store build does not read, taken out of everything under `n`. */
function dropUnread(n: unknown): void {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(dropUnread); return; }
  const o = n as Record<string, unknown>;
  if (o.kind === "openUrl") delete o.external;
  Object.values(o).forEach(dropUnread);
}

/**
 * The store variant of the screen `onboard`: Welcome, Languages, Keyboard, Try
 * it, Make me yours, [Connect apps, How careful,] Done, on a phone. Built the
 * way onboardScreen builds its own, from the same step builders, with the apps
 * steps only when the build can open what Connect leads to.
 */
export function onboardStoreScreen(ctx: ScreenContext): ScreenResponse {
  const ios = ctx.platform !== "android";
  const apps = ctx.assistant?.apps ?? [];
  const five = apps.filter((a) => !a.custom && a.auth === "oauth").slice(0, 5);
  const appsOn = ctx.connectorsOn === true && five.length > 0 && storeCanConnect(ctx.can);
  const ids = ["welcome", ...postAuthSteps(false, appsOn)];
  const I = Object.fromEntries(ids.map((id, i) => [id, i]));
  const p: Plan = {
    desktop: false, ios, appsOn, I,
    next: (id) => I[ids[ids.indexOf(id) + 1]!]!,
    apps, five,
    // Both are chosen per step: a pane knows which one it is.
    step: ((id, kids, extra) => paneFor(I[id]!)(id, kids, extra)) as Plan["step"],
    spot,
  };

  const build: Record<string, () => Node> = {
    welcome: () => welcomeStep(p),
    languages: () => languagesStep(p),
    keyboard: () => keyboardStep(p),
    try: () => tryStep(p),
    yours: () => yoursStep(p),
    apps: () => appsStep(p),
    careful: () => carefulStep(p),
    done: () => doneStep(p),
  };
  const panes = ids.map((id) => build[id]!());
  // The store build's openUrl opens whatever it is given outside the app and
  // reads no `external`; a field the build does not read is not sent.
  panes.forEach(dropUnread);
  // While a pane is shown, the next one's Blip is being fetched.
  panes.forEach((pane, i) => {
    const mine = loopsIn(pane);
    const next = panes[i + 1] ? [...loopsIn(panes[i + 1]!)].filter((u) => !mine.has(u)) : [];
    pane.children = [...(pane.children ?? []), ...next.map(preload)];
  });

  const saved = (ctx.personality.languages ?? []).map(String);
  const langs = saved.length ? saved : /-IN$/i.test(ctx.locale ?? "") ? ["hinglish", "hi", "en"] : ["en"];

  const state: Record<string, unknown> = {
    step: storeStart({ languagesSet: saved.length > 0, keyboardReady: ctx.keyboardReady === true, I }),
    langs,
    ln: Object.fromEntries(DAILY_LANGUAGES.filter(shownChip).map((l) => [l.value, l.label])),
    // Overwritten live by the app, which re-reads the device on a timer and on
    // every return to the foreground. Declared with the conservative answer.
    keyboardReady: false, keyboardEnabled: false, micGranted: false,
    tried: "",
    perm: { all: false, n: false, m: false },
    sheet: Object.fromEntries(five.map((a) => [a.id, false])),
    link: {},
    n: Object.fromEntries(five.map((a) => [a.id, a.name])),
    ini: Object.fromEntries(five.map((a) => [a.id, a.name.trim().charAt(0).toUpperCase() || "?"])),
  };

  // A phone lands on You, where the name card still appears.
  const actions: Record<string, ActionSpec> = {
    finish: { kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { onboarded: true }, onSuccess: "finishOk", onError: "finishErr" },
    finishOk: { kind: "sequence", actions: [haptic("success"), { kind: "switchTab", tabId: "personality" }] },
    finishErr: toast(EN["ob.err.finish"], "error"),
    ...permActions(),
  };

  // The bar: one segment a pane, lit up to the one shown. It rides on an ink
  // band at the top, under the clock: the store build draws its status bar for
  // a dark app (white icons), which paper would swallow, and nothing a screen
  // sends can change that.
  const bar: Node = {
    type: "Stack",
    style: { flexDirection: "row", gap: 4, height: 4, marginHorizontal: OB.side, marginBottom: 16 },
    children: ids.map((_, i): Node => ({
      type: "Stack",
      style: { flex: 1, height: 4, borderRadius: 2, backgroundColor: IF({ gte: ["step", i] } as Condition, OB.neon, "rgba(255,255,255,0.2)") },
    })),
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboard",
    title: "",
    hideChrome: true,
    state,
    actions,
    root: {
      type: "Stack",
      // Opts the tree out of the capitalising pass (titleCase.ts): these are sentences.
      props: { keepCase: true },
      // hideChrome is full-bleed: the padding is the status bar's, in ink.
      style: { flex: 1, backgroundColor: OB.ink, paddingTop: 56 },
      children: [
        bar,
        // The paper is a sheet laid over the band, with its top corners turned.
        {
          type: "Stack",
          style: { flex: 1, backgroundColor: OB.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden", paddingTop: 10 },
          children: panes,
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}
