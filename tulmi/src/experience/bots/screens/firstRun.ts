/**
 * FIRST RUN: WELCOME, SIGN IN, CODE, ABOUT YOU, NAME (Welcome, SignIn, SignCode, NameIt and their D* boards), and the
 * pages that used to follow them and are now reached from the app: Language (from You), Turn on Keylessbord (from the
 * keyboard card), First words (after the microphone card) and Plans (from You and Billing). One id serves the phone
 * and the window (ctx.client).
 *
 * ON THE MACHINERY THAT IS ALREADY THERE, NOT BESIDE IT.
 *
 *   Before the session (Welcome, Sign in, Code) the app draws the bootstrap's `auth.screen`, the only tree that reaches
 *   it before there is an account. With the Bots app on, catalog.buildBootstrap sends `botsAuthTree()` there: these
 *   steps, drawn with the kit, around the sign-in components the gate already runs (SwipePill's field, GoogleSignIn,
 *   AppleSignIn, CodeEntry). The sign-in itself (Supabase OTP, the captcha, Google, Apple, the review address) stays
 *   in AuthGateScreen (phone) and sdui.js's gate (window); this only decides how it looks.
 *
 *   ONE BLIP, THE WHOLE WAY. The root is an OnboardStage, the onboarding's own: each step holds a BlipSpot (where he
 *   stands and in which pose) and the apps draw Blip once, above everything (the phone's BlipHost, the window's
 *   blip.js walker), walking him from spot to spot. He waves on Welcome, listens while the number or the email is
 *   typed, waits for the code and thinks while it is checked. After the code the gate goes and the app fetches
 *   bots.name-it, whose root is a stage too (id "bots.first"): the apps hold Blip and the white ground through the
 *   swap, exactly as they do between the onboarding's two stages, and he walks on to its spot, presents "About you",
 *   and cheers on "Name". Reduce Motion is the apps': no walk and no glide, a fade.
 *
 *   After the session, bots.name-it is the first screen of someone not onboarded yet (buildBootstrap): About you (the
 *   name and gender card's own question and write, PUT /v1/profile { full_name, gender }, started from the sign-in's
 *   own name), then "What will you call me?" (X0 unless they pick their own), which saves the boss bot's name and marks the account onboarded (PUT /v1/profile
 *   { onboarded }, as the onboarding's Done does) and lands on Bots.
 *
 * As screens of their own (bots.welcome, bots.sign-in, bots.sign-code) the three sign-in steps are the same layout
 * drawn with the kit only, each on a stage of its own so Blip walks on from one to the next; someone who reaches them is
 * already signed in, so Google and Apple lead to the gate (sign out), and Send code and Continue walk on through the
 * Code page to About you without sending anything. A build without the stage gets each step as a page.
 *
 * AFTER ONBOARDING, two cards on Bots (and on Keylessbord) ask for what Keylessbord still lacks: the keyboard with Full Access
 * (opens the keyboard's settings) and the microphone (asks for it, then opens First words). Each is drawn from what
 * the app itself reports into the screen's state (keyboardEnabled, keyboardReady, micGranted) and goes once it is on.
 *
 * Reads: GET /v1/bots/first-run/{profile,languages,words,plans} (routes/botsFirstRun.ts), GET /v1/personality.
 * Writes: PUT /v1/profile { full_name, gender }, PUT /v1/personality (languages, the boss bot's name), PUT /v1/profile
 * { onboarded }, the paywall's own purchase actions (iap.showPaywall / iap.subscribe: RevenueCat on the phone, the pay
 * page in a window).
 */
import type { ActionRef, ActionSpec, Condition, Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import {
  blip, BOTS_THEME, botAvatar, botCard, botLook, box, button, C, call, canMove, col, divider, FACE, grow, icon, labelled, meta, PALETTE_HEX,
  primaryButton, row, SCREENS, sectionLabel, segmented, seq, shapes, statusMark, tailzuMark, text, title,
  when, type BlipPose, type BotsCtx, type IconName,
} from "../kit.js";
import type { TextOpts } from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import { ASSISTANT_NAME } from "../../assistantName.js";

const CLAY = PALETTE_HEX.clay!;
/** The window's setup steps. */
const STEPS = ["Sign in", "About you", "Name"];
type Mode = "gate" | "page";
type Style = Record<string, unknown>;

// ===================================================================== words

const W = {
  welcomeH: "Hi, I'm X0.",
  welcomeP: "Everything here is a bot. Tell them what you need; they do the work.",
  start: "Start",
  haveAccount: "I already have an account",
  phoneH: "Your phone number",
  phoneP: "We text you a 6-digit code. New here? This makes your account.",
  emailH: "Your email",
  emailP: "We email you a 6-digit code. New here? This makes your account.",
  sendCode: "Send code",
  trustH: "Your bots never act for you in secret",
  trustP: "They never post, send or message anyone without asking you first.",
  codeH: "Enter the code",
  codeNote: "Nothing else in your messages is read.",
  langH: "Which languages do you speak?",
  langP: "Pick every one you use, at home, at work, with friends.",
  langMix: "Mix them freely. Keylessbord follows how you talk.",
  youH: "What's your name?",
  youP: "So your bots know what to call you, and how to write for you.",
  youGender: "You are",
  youMissing: "Add your name and pick one.",
  nameH: "What will you call me?",
  nameP: "I'm the one in charge. Your other bots report to me and call me by this name. Say it to talk to me.",
  keyH: "Turn on Keylessbord",
  keyP: "Speak instead of type, in every app",
  wordsH: "Now just talk",
  plansH: "Pick a plan",
  saveErr: "Couldn't save that. Try again.",
};

/** The name and gender card's choices (the app's `profile.genders`), as PUT /v1/profile takes them. */
const GENDERS: Array<{ value: string; label: string }> = [{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }];

// ===================================================================== Blip, one for the whole run

/** The poses Blip takes in the run: the walker's own names (blip.js, the phone's blipFigure). */
type Pose = "wave" | "listen" | "wait" | "think" | "present" | "tada";
/** The same pose as the kit's picture of him, for a build that draws no stage. */
const KIT_POSE: Record<Pose, BlipPose> = { wave: "hello", listen: "listen", wait: "listen", think: "think", present: "needs", tada: "done" };

/** Blip in a step: where the stage's one Blip stands (a BlipSpot), or, with no stage, his picture. */
type Figure = (pose: Pose, h: number) => Node;
/** An empty box the apps measure; Blip is drawn above it, by them. No words: the boards give him none. */
const onStage: Figure = (pose, h) => ({ type: "BlipSpot", props: { pose, h, say: "", bubble: "side" } });
const asPicture: Figure = (pose, h) => blip(KIT_POSE[pose], h);

/** Does this build draw the onboarding's stage and its one Blip? (Every BotsKit build so far does.) */
const staged = (ctx: BotsCtx): boolean => ctx.can.has("OnboardStage") && ctx.can.has("BlipSpot");
const figureFor = (ctx: BotsCtx): Figure => (staged(ctx) ? onStage : asPicture);

/**
 * The stage's look, the same on both sides of sign-in so nothing changes at the boundary: white, no bar (drawn
 * transparent), Blip in the onboarding's own colours (the kit's pictures of him are cut from the same drawing), no
 * bubble (he says nothing), a short glide. Reduce Motion is the apps' to apply.
 */
const STAGE_LOOK = {
  // Sentences, not titles: the capitalising pass leaves them be.
  keepCase: true,
  ground: C.paper,
  progress: { on: "transparent", off: "transparent", height: 1, gap: 0 },
  blip: { dot: "#F3E2C6", sticker: "#151311", glow: "#39FF14" },
  // Never shown (no words); its ground is the paper the window's walker draws him against.
  bubble: { background: C.paper, border: C.ink, ink: C.ink, font: "Tailzu Hand", size: 17, bigSize: 19 },
  glide: { slide: 18, outMs: 200, inMs: 260, inDelayMs: 40 },
};
/** The run's steps, for the stages' `first` / `of`: Welcome and Sign in, Code, About you, Name. */
const RUN_STEPS = 4;

// ===================================================================== small parts

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const toast = (message: string): ActionSpec => ({ kind: "toast", message, tone: "error" } as ActionSpec);
/** A short ink toast for a write that went through. */
const saved = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const go = (screenId: string, params?: Record<string, unknown>, replace = false): ActionSpec =>
  ({ kind: "navigate", screenId, ...(params ? { params } : {}), ...(replace ? { replace: true } : {}) });
const back: ActionSpec = { kind: "navigateBack" };
const signOut = { kind: "signOut" } as ActionSpec;

/** The end of the first run: onboarded, as the onboarding's Done marks it, and on to Bots. */
function finish(): ActionSpec {
  return call("PUT", "/v1/profile", { onboarded: true }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, { kind: "switchTab", tabId: "bots" }),
    fail: toast("Couldn't finish setting up. Try again."),
  });
}

/** The phone's back chevron: 44 x 44, pulled 10 left. */
const chevron = (onPress: ActionRef): Node =>
  labelled(box([icon("back", { size: 22 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), "Back");

/** The window's "‹ Back". */
const deskBack = (onPress: ActionRef = back): Node =>
  row([icon("back", { size: 18, color: C.grey70 }), text("Back", { size: 14, color: C.grey70, lineHeight: 18 })], { minHeight: 44, gap: 4, paddingRight: 8, marginLeft: -6 }, onPress);

/** A link: ink words, 44 tall. */
const link = (label: string, onPress: ActionRef, o: { size?: number; color?: string; center?: boolean } = {}): Node =>
  row([text(label, { size: o.size ?? 15, weight: 500, color: o.color ?? C.ink, lineHeight: 20 })], {
    minHeight: 44, ...(o.center ? { justifyContent: "center" } : {}),
  }, onPress);

/** Text that follows a state path (Text bind.content), with `fallback` until it has a value. */
const bound = (path: string, fallback: string, o: Parameters<typeof text>[1] = {}): Node => text(fallback, { ...o, bind: path });

/** Blip's whole body, set against the left edge as the window's boards place him. */
const deskBlip = (pose: BlipPose, h: number): Node => box([blip(pose, h)], { alignSelf: "flex-start", marginLeft: -10 });

/** The four first bots, as four dots that pop in (Welcome). */
function fourDots(): Node {
  const dots = [PALETTE_HEX.moss!, CLAY, PALETTE_HEX.ochre!, PALETTE_HEX.sea!];
  return shapes(dots.map((fill, i) => ({ circle: [4 + i * 14, 4, 4] as [number, number, number], fill, motion: "pop" as const, delayMs: i * 90 })), {
    viewBox: "0 0 50 8", width: 50, height: 8, label: "Your first bots: Xode, Keylessbord, Plan Ease and Travel bot",
  });
}

/** Google's G, in ink as the boards draw it. */
function googleG(size: number): Node {
  return {
    type: "SVG",
    props: {
      viewBox: "0 0 24 24", fill: C.ink, stroke: "none",
      d: "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
    },
    style: { width: size, height: size, flexShrink: 0 },
  };
}

/** Apple's mark, in ink. */
function appleMark(size: number): Node {
  return {
    type: "SVG",
    props: {
      viewBox: "0 0 24 24", fill: C.ink, stroke: "none",
      d: "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
    },
    style: { width: size, height: size, flexShrink: 0 },
  };
}

/** An outline pill with a mark and words (Continue with Google / Apple, as the boards draw them). */
function outlinePill(mark: Node, label: string, onPress: ActionRef | undefined, h = 54): Node {
  return row([mark, text(label, { size: h >= 54 ? 16 : 14, weight: h >= 54 ? 600 : 500, lineHeight: 20 })], {
    height: h, borderRadius: h / 2, borderWidth: 1, borderColor: C.outline, justifyContent: "center", gap: 10, alignSelf: "stretch", backgroundColor: C.paper,
  }, onPress);
}

/** "—— or ——". */
const orLine = (): Node => row([box([], { flexGrow: 1, height: 1, backgroundColor: C.divider }), meta("or", { size: 12 }), box([], { flexGrow: 1, height: 1, backgroundColor: C.divider })], { gap: 12 });

/** The card under sign-in: Tailzu's promise. */
function trustCard(surface: boolean): Node {
  const head = botLook("tailzu").head;
  return row([
    head ? botAvatar({ color: C.ink, icon: "spark", head }, 30) : tailzuMark(30),
    col([text(W.trustH, { size: 14, weight: 600, lineHeight: 20 }), text(W.trustP, { size: 13, lineHeight: 19, color: C.grey70 })], { gap: 3, flexShrink: 1, minWidth: 0 }),
  ], {
    gap: 12, alignItems: "flex-start", paddingVertical: 14, paddingHorizontal: 16, borderRadius: surface ? 16 : 18,
    ...(surface ? { backgroundColor: C.surface } : { borderWidth: 1, borderColor: C.line }),
  });
}

/** "By continuing you agree to the Terms and Privacy policy. We never sell your number." Each link opens its page. */
function consent(terms: string, privacy: string, align: "center" | "right" = "center"): Node {
  const t = (s: string, url?: string): Node => text(s, {
    size: 12, lineHeight: 18, color: url ? C.grey70 : C.meta, ...(url ? { style: { textDecorationLine: "underline" } } : {}),
  });
  const tap = (n: Node, url: string): Node => ({ ...n, on: { onPress: { kind: "openUrl", url, external: true } } });
  const lineStyle = { flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-end" };
  return col([
    row([t("By continuing you agree to the "), tap(t("Terms", terms), terms), t(" and "), tap(t("Privacy policy", privacy), privacy), t(".")], lineStyle),
    row([t("We never sell your number.")], lineStyle),
  ], { paddingHorizontal: align === "center" ? 12 : 0, alignItems: align === "center" ? "center" : "flex-end", ...(align === "right" ? { maxWidth: 380 } : {}) });
}

// ===================================================================== progress

/** The phone's setup bar: a segment a step after sign-in, filled to the step. */
function phoneProgress(step: number, of: number): Node {
  return labelled(row(Array.from({ length: of }, (_, i) => box([], {
    flexGrow: 1, flexBasis: 0, height: 4, borderRadius: 2, backgroundColor: i < step ? C.ink : C.track,
  })), { width: 24 * of + 4 * (of - 1), gap: 4, flexShrink: 0 }), `Setup step ${step} of ${of}`);
}

/** The phone's top line: back (or nothing), the bar, and "N of M". */
function phoneTop(step: number, of: number, o: { back?: ActionRef | null } = {}): Node {
  return row([
    box(o.back ? [chevron(o.back)] : [], { flexGrow: 1, flexBasis: 0, alignItems: "flex-start", minHeight: 44, justifyContent: "center" }),
    phoneProgress(step, of),
    box([meta(`${step} of ${of}`, { size: 12 })], { flexGrow: 1, flexBasis: 0, alignItems: "flex-end" }),
  ], { minHeight: 44 });
}

/** A pushed page's top line on the phone: back, and something on the right. */
function phoneBackLine(right?: Node, backTo: ActionRef = back): Node {
  return row([chevron(backTo), grow(), ...(right ? [right] : [])], { minHeight: 44 });
}

/** The window's steps: a bar each, the name under it; done ones with a ring, the one in hand with the ink dot. */
function deskSteps(current: number): Node {
  return row(STEPS.map((s, i) => {
    const done = current >= 0 && i < current;
    const now = i === current;
    return col([
      box([], { height: 4, borderRadius: 2, backgroundColor: done || now ? C.ink : C.track }),
      row([
        ...(done ? [statusMark("done")] : now ? [statusMark("needs")] : []),
        text(s, { size: 12.5, weight: now ? 600 : 400, color: now ? C.ink : done ? C.grey70 : C.meta, lineHeight: 16, lines: 1 }),
      ], { gap: 7 }),
    ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 });
  }), { gap: 8, width: "100%", maxWidth: 1080, alignSelf: "center", alignItems: "flex-start" });
}

// ===================================================================== frames

function respond(ctx: BotsCtx, titleText: string, root: Node, state: Record<string, unknown> = {}, actions?: Record<string, ActionSpec>): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION, screenId: ctx.screenId, title: titleText, hideChrome: true, look: "bots",
    theme: BOTS_THEME, cacheTtlSeconds: 0, state: { ask: "", asking: false, ...state }, ...(actions ? { actions } : {}), root,
  };
}

interface PhoneOpts { title: string; body: Node[]; footer?: Node[]; state?: Record<string, unknown>; gap?: number; padTop?: number }

/** The phone's first-run page: white, 20 at the sides, the body scrolls and can push things down, the footer stays. */
function phoneFrame(ctx: BotsCtx, o: PhoneOpts): ScreenResponse {
  const root: Node = {
    type: "SafeArea",
    props: { edges: ["top"], barStyle: "dark-content" },
    style: { flex: 1, flexDirection: "column", backgroundColor: C.paper },
    children: [
      {
        type: "Screen",
        props: { paddingBottom: o.footer?.length ? 12 : 20 },
        style: { backgroundColor: C.paper, paddingHorizontal: 20, paddingTop: o.padTop ?? 10, gap: o.gap ?? 18, flexGrow: 1 },
        children: o.body,
      },
      ...(o.footer?.length ? [{
        type: "SafeArea",
        props: { edges: ["bottom"], inset: "max" },
        style: { flexGrow: 0, flexShrink: 0, flexDirection: "column", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 6, backgroundColor: C.paper },
        children: o.footer,
      } as Node] : []),
    ],
  };
  return respond(ctx, o.title, root, o.state);
}

interface DeskOpts {
  title: string;
  /** Top right: "About 2 minutes", "Signed in as …", Not now. */
  right?: Node | null;
  /** The step in hand (STEPS), -1 for none yet, null for no steps row. */
  current: number | null;
  left: Node[];
  main: Node[];
  foot?: Node;
  state?: Record<string, unknown>;
}

/** The window's header: the mark and Tailzu, and something on the right. */
function deskHeader(right: Node | null): Node {
  return row([
    row([tailzuMark(26), text("X0 Bot", { size: 17, weight: 700, tracking: -0.3, lineHeight: 22 })], { gap: 10 }),
    grow(),
    ...(right ? [right] : []),
  ], { minHeight: 44, gap: 12, width: "100%", maxWidth: 1080, alignSelf: "center" });
}

/** The window's two columns: Blip and the words on the left, the thing to do on the right. */
function deskBody(o: DeskOpts): Node[] {
  return [
    deskHeader(o.right ?? null),
    ...(o.current !== null ? [deskSteps(o.current)] : []),
    row([
      // Bases as lengths: the window reads a bare number in a flex property as a ratio.
      col(o.left, { flexGrow: 1, flexShrink: 1, flexBasis: "300px", minWidth: 0, gap: 16 }),
      col([...o.main, ...(o.foot ? [o.foot] : [])], { flexGrow: 1.45, flexShrink: 1, flexBasis: "500px", minWidth: 0, gap: 14 }),
    ], { flexGrow: 1, width: "100%", maxWidth: 1080, alignSelf: "center", alignItems: "center", flexWrap: "wrap", columnGap: 56, rowGap: 30 }),
  ];
}

/** The window's first-run page: no sidebar yet, the whole window, scrolling when it is short. */
function deskFrame(ctx: BotsCtx, o: DeskOpts): ScreenResponse {
  const inner = col(deskBody(o), { minHeight: "100%", paddingTop: 24, paddingHorizontal: 40, paddingBottom: 26, gap: 22 });
  return respond(ctx, o.title, col([inner], { height: "100%", overflowY: "auto", backgroundColor: C.paper }), o.state);
}

/** The window's footer row: Back on the left, the rest on the right. */
const deskFoot = (left: Node | null, right: Node[]): Node =>
  row([left ?? box([]), row(right, { gap: 18, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", flexShrink: 1 })], {
    justifyContent: "space-between", flexWrap: "wrap", gap: 12, paddingTop: 2,
  });

/** "Step 1 of 2" (or the page it is), the title, the line under it (the window's left column). */
const deskHeading = (kicker: string, h: string, sub: string): Node =>
  col([meta(kicker, { size: 13, lineHeight: 17 }), title(h, { lineHeight: 31 }), text(sub, { size: 15, lineHeight: 22, color: C.grey70, style: { maxWidth: 400 } })], { gap: 6 });

/** The phone's title and the line under it. */
const phoneHeading = (h: string, sub: string, gap = 8): Node =>
  col([title(h, { lineHeight: 31 }), text(sub, { size: 15, lineHeight: 22, color: C.grey70 })], { gap });

/** Who is signed in, for the window's header. */
const signedInAs = (ctx: BotsCtx): Node | null => {
  const who = ctx.user?.email ?? ctx.user?.name;
  return who ? meta(`Signed in as ${who}`, { size: 13, lines: 1 }) : null;
};

// ===================================================================== sign in: the parts both modes draw

const PHONE_ON: Condition = { flag: "auth.enablePhone" };
/** The phone number is the way in when the backend offers it and the person has not switched to email. */
const BY_PHONE: Condition = { all: [PHONE_ON, { neq: ["method", "email"] }] };
const BY_EMAIL: Condition = { any: [{ not: PHONE_ON }, { eq: ["method", "email"] }] };

export interface BotsAuthOpts {
  /** A window (the desktop app). */
  desktop?: boolean;
  /** Leave Google out (an Android bundle that cannot come back from it). */
  googleHidden?: boolean;
  /** With it, Google is a link to Supabase's own sign-in instead (the bridge for that bundle). */
  googleLink?: string | null;
  /** Leave Apple out (a window that is not a Mac). */
  appleHidden?: boolean;
  /** The policy pages the consent line opens. */
  terms: string;
  privacy: string;
}

/** The sign-in field: the gate's own (SwipePill, the field variant: input, then the button), or the kit's look of it. */
function signField(mode: Mode, method: "phone" | "email", desktop: boolean): Node {
  if (mode === "gate") {
    return {
      type: "SwipePill",
      props: {
        method, variant: "field", placeholder: method === "phone" ? "Mobile number" : "you@example.com", submitLabel: W.sendCode,
        ...(method === "phone" ? { presetCountry: "IN", dial: "+91" } : {}),
        height: desktop ? 54 : 48, radius: desktop ? 14 : 16, background: C.paper, borderColor: C.ink, textColor: C.ink,
        placeholderColor: C.idle, fontSize: 17, buttonBackground: C.ink, buttonTextColor: C.paper, buttonHeight: desktop ? 54 : 48, buttonRadius: desktop ? 27 : 16,
        countryBackground: C.paper, countryBorderColor: C.outline,
      },
    };
  }
  const input: Node = {
    type: "TextField", id: `sign.${method}`, bind: { value: `sign.${method}` },
    props: {
      placeholder: method === "phone" ? "Mobile number" : "you@example.com", placeholderColor: C.idle, background: "transparent", borderWidth: 0,
      radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 44, color: C.ink, autoCapitalize: "none", autoCorrect: false,
    },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 14, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 17,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  return col([
    row([
      ...(method === "phone" ? [row([text("+91", { size: 16, weight: 600, lineHeight: 20 }), icon("down", { size: 16, color: C.meta })], {
        gap: 4, height: "100%", paddingLeft: 16, paddingRight: 12, borderRightWidth: 1, borderRightColor: C.divider,
      })] : [box([], { width: 2 })]),
      input,
    ], { height: desktop ? 54 : 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: desktop ? 14 : 16, overflow: "hidden" }),
    // Signed in already, there is no code to send: this page leads on to the Code page, as the gate's would.
    primaryButton(W.sendCode, go(SCREENS.signCode), { wide: true }),
  ], { gap: 14 });
}

/** Google and Apple: the gate's own controls, or the kit's look of them. */
function socialButtons(mode: Mode, o: BotsAuthOpts, h: number, r = h / 2): Node[] {
  const label = (p: string) => (h >= 48 ? `Continue with ${p}` : p);
  if (mode === "page") return [outlinePill(googleG(18), label("Google"), signOut, h), outlinePill(appleMark(18), label("Apple"), signOut, h)];
  const google: Node | null = o.googleLink
    ? row([googleG(18), text(label("Google"), { size: h >= 48 ? 16 : 14, weight: h >= 48 ? 600 : 500, lineHeight: 20 })], {
        height: h, borderRadius: r, borderWidth: 1.5, borderColor: C.ink, justifyContent: "center", gap: 10, alignSelf: "stretch",
      }, seq(setState("googleStarted", true), { kind: "openUrl", url: o.googleLink, external: true }))
    : o.googleHidden ? null : {
        type: "GoogleSignIn",
        // The window's short pair (beside its QR panel) says just the name, as the board does.
        props: { size: h, radius: r, background: C.paper, borderWidth: 1.5, borderColor: C.ink, label: label("Google") },
        style: { width: "100%" },
        children: [row([googleG(18), text(label("Google"), { size: h >= 48 ? 16 : 14, weight: h >= 48 ? 600 : 500, lineHeight: 20 })], { gap: 10 })],
      };
  // Apple's own control (their guidelines): it draws itself, and hides where it cannot serve.
  const apple: Node | null = o.appleHidden ? null : {
    type: "AppleSignIn",
    props: { size: h, radius: r, buttonType: "CONTINUE", buttonStyle: "WHITE_OUTLINE", label: label("Apple") },
    style: { width: "100%" },
  };
  return [google, apple].filter((n): n is Node => !!n);
}

/** Phone or email: the heading, the label and the field follow the way in. */
function byMethod(phone: Node, email: Node): Node[] {
  return [when(BY_PHONE, phone), when(BY_EMAIL, email)];
}

// ----------------------------------------------------------------- Welcome

function welcomePhone(start: ActionRef, fig: Figure): { body: Node[]; footer: Node[] } {
  return {
    body: [
      row([tailzuMark(24), text("X0 Bot", { size: 16, weight: 700, tracking: -0.3, lineHeight: 20 })], { gap: 8, minHeight: 44 }),
      grow(),
      row([fig("wave", 172)], { justifyContent: "center" }),
      col([
        title(W.welcomeH, { align: "center", lineHeight: 31 }),
        text(W.welcomeP, { size: 15, lineHeight: 22, color: C.grey70, align: "center", style: { maxWidth: 300 } }),
      ], { alignItems: "center", gap: 10, paddingTop: 22, paddingHorizontal: 8 }),
      row([fourDots()], { justifyContent: "center", paddingTop: 22 }),
      { type: "Stack", style: { flexGrow: 1.3, flexShrink: 1 } },
    ],
    footer: [primaryButton(W.start, start, { wide: true }), link(W.haveAccount, start, { center: true })],
  };
}

const FIRST_BOTS: Array<{ slug: string; name: string; line: string }> = [
  { slug: "code", name: "Xode", line: "Fixes bugs in your code, and asks before anything ships." },
  { slug: "keybot", name: "Keylessbord", line: "Speak instead of type, in every app." },
  { slug: "plan", name: "Plan Ease", line: "Plans your day. Moves things only when you say yes." },
  { slug: "travel", name: "Travel bot", line: "Tickets, refunds and the waiting on hold." },
];

/** Blip in the window's left column, set against its edge as the boards place him. */
const deskFig = (fig: Figure, pose: Pose, h: number): Node => box([fig(pose, h)], { alignSelf: "flex-start", marginLeft: -10 });

function welcomeDesk(start: ActionRef, fig: Figure): DeskOpts {
  const rows: Node[] = [
    ...FIRST_BOTS.map((b) => ({ look: botLook(b.slug), name: b.name, line: b.line })),
    { look: { color: PALETTE_HEX.pine!, icon: "spark" as IconName }, name: "Your own bots", line: "Make one for anything, like a Gym bot." },
  ].map((b) => row([
    botAvatar(b.look, 40),
    col([text(b.name, { size: 15, weight: 600, lineHeight: 20 }), text(b.line, { size: 13, lineHeight: 18, color: C.grey70 })], { gap: 2, minWidth: 0, flexShrink: 1 }),
  ], { gap: 14, paddingVertical: 13, paddingHorizontal: 18 }));
  const list: Node[] = [];
  rows.forEach((r, i) => { if (i) list.push(divider()); list.push(r); });
  return {
    title: "Welcome", right: meta(`${STEPS.length} short steps`, { size: 13 }), current: -1,
    left: [
      deskFig(fig, "wave", 172),
      col([title(W.welcomeH, { lineHeight: 31 }), text(W.welcomeP, { size: 15, lineHeight: 22, color: C.grey70, style: { maxWidth: 400 } })], { gap: 6 }),
      row([fourDots(), meta("Free to start · about a minute", { size: 12 })], { gap: 12, paddingTop: 4 }),
    ],
    main: [col([
      row([sectionLabel("Your first bots"), grow(), meta("Each one does one job", { size: 12 })], { paddingTop: 14, paddingHorizontal: 18, paddingBottom: 4, gap: 10 }),
      ...list,
    ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })],
    foot: deskFoot(null, [link(W.haveAccount, start), button(W.start, start, { size: "lg" })]),
  };
}

// ----------------------------------------------------------------- Sign in

/** The heading with Blip beside it, listening while the number or the email is typed. */
const headingBeside = (heading: Node, fig: Figure): Node =>
  row([box([heading], { flexGrow: 1, flexShrink: 1, minWidth: 0 }), box([fig("listen", 84)], { marginRight: -12, marginTop: -8, flexShrink: 0 })], { gap: 4, alignItems: "flex-end" });

function signInPhone(mode: Mode, o: BotsAuthOpts, backTo: ActionRef, fig: Figure): Node[] {
  const social = socialButtons(mode, o, 48, 16);
  return [
    chevron(backTo),
    ...byMethod(headingBeside(phoneHeading(W.phoneH, W.phoneP), fig), headingBeside(phoneHeading(W.emailH, W.emailP), fig)),
    // Every way in on one page, as the earlier sign-in had them: the phone number (when the backend offers it), the email,
    // then Google and Apple. The phone field picks its country as ever: the one used last, else the phone's region.
    when(PHONE_ON, col([signField(mode, "phone", false), orLine()], { gap: 8 })),
    signField(mode, "email", false),
    ...(social.length ? [orLine(), col(social, { gap: 8 })] : []),
    grow(),
    trustCard(false),
    consent(o.terms, o.privacy),
  ];
}

function signInDesk(mode: Mode, o: BotsAuthOpts, backTo: ActionRef, fig: Figure): DeskOpts {
  const social = socialButtons(mode, o, 46);
  const field = (label: string, method: "phone" | "email", hint: string) => col([
    text(label, { size: 13, weight: 500, lineHeight: 17 }),
    signField(mode, method, true),
    meta(hint, { size: 12 }),
  ], { gap: 6 });
  const form = [
    when(PHONE_ON, segmented([{ label: "Phone", value: "phone" }, { label: "Email", value: "email" }], "method")),
    ...byMethod(
      field("Mobile number", "phone", "We text you a 6-digit code. Email works too, from the tab above."),
      field("Email", "email", "We email you a 6-digit code."),
    ),
    ...(social.length ? [orLine(), row(social.map((s) => box([s], { flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 8 })] : []),
  ];
  const card = { borderRadius: 18, borderWidth: 1, borderColor: C.line };
  return {
    title: "Sign in", right: meta("About a minute", { size: 13 }), current: 0,
    left: [
      deskFig(fig, "listen", 140),
      ...byMethod(deskHeading("Sign in", W.phoneH, W.phoneP), deskHeading("Sign in", W.emailH, W.emailP)),
      box([trustCard(true)], { maxWidth: 400 }),
    ],
    // In the gate, the phone's way in beside the form (DSignIn): the window draws the QR panel itself, and a window that
    // does not know it draws nothing there, leaving the form the whole card.
    main: [mode === "gate"
      ? row([col(form, { padding: 20, gap: 14, flexGrow: 1.2, flexShrink: 1, flexBasis: "260px", minWidth: 0 }), linkPanel()], { ...card, alignItems: "stretch", flexWrap: "wrap" })
      : col(form, { padding: 20, gap: 14, ...card })],
    foot: deskFoot(deskBack(backTo), [consent(o.terms, o.privacy, "right")]),
  };
}

/**
 * SIGN IN WITH THE PHONE (docs/bots-gaps.md item 16): the window's own panel ("DeskLinkSignIn", TAILZU-DESKTOP
 * linkSignIn.js). It asks POST /v1/auth/link for a request, draws the QR the answer carries and the code to type,
 * waits on POST /v1/auth/link/poll, and signs in with the one-time sign-in it gets once the phone approves (bots.link).
 * Only the words are the server's; `{t}` is the time left, `{code}` the code.
 */
function linkPanel(): Node {
  return {
    type: "DeskLinkSignIn",
    props: {
      or: "or",
      title: "Scan with your phone",
      sub: "Already use X0 Bot there? No code to type.",
      steps: ["Open the camera on your phone", "Point it at this code", "Tap Approve in X0 Bot"],
      typed: "No camera? In X0 Bot, go to You, then Link a computer, and type {code}",
      changesIn: "Code changes in {t}",
      loading: "Making a code…",
      approved: "Approved on your phone. Signing you in…",
      denied: "Not approved on your phone.",
      expired: "This code ran out.",
      failed: "Couldn't sign you in this way. Use your number or email.",
      offline: "Couldn't make a code. Check your connection.",
      renew: "Show a new code",
      qrLabel: "Sign-in code for your phone",
    },
  };
}

// ----------------------------------------------------------------- Code

/** The code: the gate's own entry (one box a digit, sent-to line, send again, change it), or the kit's look of it. */
function codeEntry(mode: Mode, desktop: boolean): Node {
  if (mode === "gate") {
    return {
      type: "CodeEntry",
      props: {
        variant: "boxes",
        sentTo: "We sent a {len}-digit code to {to}.",
        waitLabel: desktop ? "Type it here when it comes. Paste works too." : "Filled from SMS when it comes, or type it in.",
        okLabel: "Got it. Checking…", failLabel: "Couldn't send the code. Tap Send it again.",
        resendLabel: "Send it again", wrongLabel: "Wrong number?", wrongEmailLabel: "Wrong email?", changeLabel: "Change it",
        boxHeight: desktop ? 60 : 58, boxRadius: 14, boxGap: 8, boxBackground: C.paper, boxBorderColor: C.outline,
        boxFilledBackground: C.paper, boxFilledBorderColor: C.ink, boxActiveRing: "rgba(10,10,10,0.08)",
        digitColor: C.ink, digitFont: FACE.semibold, digitSize: 24, textColor: C.grey70, linkColor: C.ink,
      },
    };
  }
  return row(Array.from({ length: 6 }, (_, i) => box([], {
    flexGrow: 1, flexBasis: 0, height: desktop ? 60 : 58, borderRadius: 14, borderWidth: i === 0 ? 1.5 : 1, borderColor: i === 0 ? C.ink : C.outline,
  })), { gap: 8 });
}

/**
 * Blip on Code: in the gate he waits while the code is on its way (the flow's `verify`) and thinks while it is checked
 * (`verifying`): two spots of one size, each shown in its phase (AuthPhase), so the step does not move.
 */
function codeFigure(mode: Mode, fig: Figure, h: number): Node {
  if (mode !== "gate" || fig !== onStage) return fig("think", h);
  return box([
    { type: "AuthPhase", props: { phases: ["verify"] }, children: [fig("wait", h)] },
    { type: "AuthPhase", props: { phases: ["verifying"] }, children: [fig("think", h)] },
  ]);
}

const smsNote = (): Node => row([icon("notes", { size: 16, color: C.meta }), meta(W.codeNote, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 8 });

function codePhone(mode: Mode, fig: Figure): { body: Node[]; footer: Node[] } {
  return {
    body: [
      ...(mode === "page" ? [chevron(back)] : []),
      row([codeFigure(mode, fig, 124)], { justifyContent: "center" }),
      phoneHeading(W.codeH, mode === "gate" ? "The code is on its way." : "Sent by SMS to your number."),
      col([codeEntry(mode, false), smsNote()], { gap: 12 }),
      ...(mode === "page" ? [row([meta("Didn't get it?", { size: 14 }), grow(), link("Wrong number?", back, { size: 14 })], {
        borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 4,
      })] : []),
    ],
    // The code is checked the moment it is complete, so the gate has nothing to press.
    footer: mode === "page" ? [primaryButton("Continue", go(SCREENS.nameIt), { wide: true })] : [],
  };
}

function codeDesk(mode: Mode, fig: Figure): DeskOpts {
  return {
    title: "Enter the code", right: meta("About a minute", { size: 13 }), current: 0,
    left: [
      box([codeFigure(mode, fig, 140)], { alignSelf: "flex-start", marginLeft: -10 }),
      deskHeading("Sign in", W.codeH, "Type the 6-digit code we sent you."),
      row([icon("lock", { size: 16, color: C.grey70 }), text("The code is only for this sign-in. Nothing else in your messages is read.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], {
        gap: 10, alignItems: "flex-start", maxWidth: 400,
      }),
    ],
    main: [col([
      col([text("Type the code", { size: 16, weight: 600, lineHeight: 21 }), meta("It comes by SMS or email, from X0 Bot.", { size: 13 })], { gap: 3 }),
      codeEntry(mode, true),
      ...(mode === "page" ? [primaryButton("Continue", go(SCREENS.nameIt), { wide: true })] : []),
    ], { padding: 20, gap: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line })],
    ...(mode === "page" ? { foot: deskFoot(deskBack(), [link("Wrong number?", back, { size: 14 })]) } : {}),
  };
}

// ===================================================================== the stage

/**
 * A step of a stage: on the phone a column that fills the step (the stage gives it the safe area); in a window the
 * whole width, not the stage's narrow column.
 */
function gateStep(desktop: boolean, kids: Node[], extra: Partial<Node> = {}): Node {
  const style: Style = desktop
    // The stage centres a phone-wide column (460) under a 44 top; the boards are two columns across 1080.
    ? { width: "min(1160px, 100vw)", alignSelf: "center", minHeight: "calc(100vh - 44px)", marginTop: -20, paddingHorizontal: 40, paddingBottom: 26, gap: 22, backgroundColor: C.paper }
    : { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.paper };
  return { type: "Stack", style: { flexDirection: "column", ...style }, children: kids, ...extra };
}

/** A phone step's content: its body, then its footer at the foot of the step. */
const phoneStepBody = (body: Node[], footer: Node[], gap = 18): Node =>
  col([...body, ...(footer.length ? [grow(), col(footer, { gap: 6, paddingTop: 8 })] : [])], { flexGrow: 1, gap });

/** An OnboardStage in the run's look: one Blip walks from spot to spot across it, and on into the next stage. */
function stageNode(id: string, first: number, steps: Node[], extra: Record<string, unknown> = {}): Node {
  return { type: "OnboardStage", bind: { step: "step" }, props: { id, first, of: RUN_STEPS, ...STAGE_LOOK, ...extra }, children: steps };
}

/**
 * A screen of stage steps: the stage itself for a build that draws it, else the steps one at a time by the same
 * `step`, in the frame a page has (the safe area and a scrolling body on the phone, the whole window in one).
 */
function stageScreen(ctx: BotsCtx, o: { title: string; id: string; first: number; steps: Node[]; state?: Record<string, unknown> }): ScreenResponse {
  const state = { step: 0, ...o.state };
  if (staged(ctx)) return respond(ctx, o.title, stageNode(o.id, o.first, o.steps), state);
  const shown = o.steps.length > 1 ? o.steps.map((s, i) => when({ eq: ["step", i] }, s)) : o.steps;
  if (ctx.client === "desktop") {
    return respond(ctx, o.title, col([col(shown, { minHeight: "100%", paddingTop: 44 })], { height: "100%", overflowY: "auto", backgroundColor: C.paper }), state);
  }
  return respond(ctx, o.title, {
    type: "SafeArea",
    props: { edges: ["top", "bottom"], barStyle: "dark-content" },
    style: { flex: 1, flexDirection: "column", backgroundColor: C.paper },
    children: [{ type: "Screen", props: { paddingBottom: 0 }, style: { backgroundColor: C.paper, paddingTop: 22, flexGrow: 1 }, children: shown }],
  }, state);
}

// ===================================================================== the gate's tree

/**
 * Welcome, Sign in and Code for the bootstrap's `auth.screen`, with the Bots app on (catalog.buildBootstrap).
 * All actions are inline: the gate has no action table. Its state: `signing` (Welcome → Sign in) and `method`
 * (phone or email). The flow's phase shows Code (phaseStep), and "Change it" there returns to Sign in. Each step has
 * Blip's spot: he waves, listens, waits and thinks, and walks on into bots.name-it's stage after the code.
 */
export function botsAuthTree(o: BotsAuthOpts): Record<string, unknown> {
  const desktop = o.desktop === true;
  const start = setState("signing", true);
  const toWelcome = setState("signing", false);
  const welcomeOn: Condition = { falsy: "signing" };
  const signOn: Condition = { truthy: "signing" };

  let entry: Node;
  let code: Node;
  if (desktop) {
    const wd = welcomeDesk(start, onStage), sd = signInDesk("gate", o, toWelcome, onStage), cd = codeDesk("gate", onStage);
    entry = gateStep(true, [
      when(welcomeOn, col(deskBody(wd), { gap: 22, flexGrow: 1 })),
      when(signOn, col(deskBody(sd), { gap: 22, flexGrow: 1 })),
    ], { props: { stepId: "entry" } });
    code = gateStep(true, deskBody(cd), { props: { stepId: "code" } });
  } else {
    const w = welcomePhone(start, onStage);
    const c = codePhone("gate", onStage);
    entry = gateStep(false, [
      when(welcomeOn, col([...w.body, col(w.footer, { gap: 6, paddingTop: 8 })], { flexGrow: 1 })),
      when(signOn, col(signInPhone("gate", o, toWelcome, onStage), { flexGrow: 1, gap: 18 })),
    ], { props: { stepId: "entry" } });
    code = gateStep(false, [col(c.body, { gap: 18, flexGrow: 1 })], { props: { stepId: "code" } });
  }
  return stageNode("bots.auth", 0, [entry, code], { phaseStep: { verify: 1, verifying: 1 } }) as unknown as Record<string, unknown>;
}

/** The first screen after sign-in for someone not onboarded yet, and every id of the run (the app parks a keyboard tap until they are past). */
export const BOTS_FIRST_RUN_SCREEN = SCREENS.nameIt;
export const BOTS_FIRST_RUN_IDS: string[] = [SCREENS.nameIt];

// ===================================================================== the pages: Welcome, Sign in, Code

const PAGE_AUTH: BotsAuthOpts = { terms: "https://x0bot.com/terms", privacy: "https://x0bot.com/privacy" };

/** One sign-in step as a page of its own, on a stage of its own, so Blip walks between them as he does in the gate. */
function authPage(ctx: BotsCtx, title: string, step: Node, state: Record<string, unknown> = {}): ScreenResponse {
  return stageScreen(ctx, { title, id: ctx.screenId, first: 0, steps: [step], state });
}

function welcomePage(ctx: BotsCtx): ScreenResponse {
  const start = go(SCREENS.signIn);
  const fig = figureFor(ctx);
  if (ctx.client === "desktop") return authPage(ctx, "Welcome", gateStep(true, deskBody(welcomeDesk(start, fig)), { props: { stepId: "welcome" } }));
  const w = welcomePhone(start, fig);
  return authPage(ctx, "Welcome", gateStep(false, [col([...w.body, col(w.footer, { gap: 6, paddingTop: 8 })], { flexGrow: 1 })], { props: { stepId: "welcome" } }));
}

function signInPage(ctx: BotsCtx): ScreenResponse {
  const fig = figureFor(ctx);
  if (ctx.client === "desktop") return authPage(ctx, "Sign in", gateStep(true, deskBody(signInDesk("page", PAGE_AUTH, back, fig)), { props: { stepId: "signin" } }), { method: "phone" });
  return authPage(ctx, "Sign in", gateStep(false, [col(signInPhone("page", PAGE_AUTH, back, fig), { flexGrow: 1, gap: 18 })], { props: { stepId: "signin" } }), { method: "phone" });
}

function signCodePage(ctx: BotsCtx): ScreenResponse {
  const fig = figureFor(ctx);
  if (ctx.client === "desktop") return authPage(ctx, "Enter the code", gateStep(true, deskBody(codeDesk("page", fig)), { props: { stepId: "code" } }));
  const c = codePhone("page", fig);
  return authPage(ctx, "Enter the code", gateStep(false, [phoneStepBody(c.body, c.footer)], { props: { stepId: "code" } }));
}

// ===================================================================== Languages

/** GET /v1/bots/first-run/languages. */
interface Langs { options: Array<{ value: string; label: string }>; picked: string[]; saved?: boolean }

/** When the list cannot be read: the boards' own, every one a code the onboarding saves. */
const FALLBACK_LANGS: Langs["options"] = [
  ["hinglish", "Hinglish"], ["hi", "Hindi"], ["en", "English"], ["mr", "Marathi"], ["ta", "Tamil"], ["te", "Telugu"],
  ["bn", "Bengali"], ["gu", "Gujarati"], ["kn", "Kannada"], ["ml", "Malayalam"], ["pa", "Punjabi"],
].map(([value, label]) => ({ value: value!, label: label! }));

/** A language chip: picked is ink with a tick, the rest outline. Toggles the language in `langs` (never to none). */
function langChip(l: { value: string; label: string }, desk: boolean): Node {
  const on: Condition = { contains: ["langs", l.value] };
  const c = (then: string, otherwise: string) => ({ ...on, then, else: otherwise });
  return row([
    when(on, icon("check", { size: 14, color: C.paper, weight: 2 })),
    text(l.label, { size: desk ? 14 : 13, weight: 500, lineHeight: 17, style: { color: c(C.paper, C.ink) } }),
  ], {
    gap: 6, paddingVertical: desk ? 0 : 9, height: desk ? 40 : undefined, paddingHorizontal: 14, borderRadius: desk ? 20 : 18, borderWidth: 1,
    borderColor: c(C.ink, C.outline), backgroundColor: c(C.ink, C.paper),
  }, { kind: "toggleInArray", path: "langs", value: l.value, min: 1 });
}

function language(ctx: BotsCtx, data: Langs | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const options = data?.options?.length ? data.options : FALLBACK_LANGS;
  const picked = data?.picked?.length ? data.picked : ["hinglish", "hi", "en"];
  // Reached from You (and Keylessbord's settings): saved, and back to where it was opened from.
  const next = call("PUT", "/v1/personality", { languages: "$state.langs" }, { ok: seq(saved("Saved"), back), fail: toast(W.saveErr) });
  const cont: ActionRef = { kind: "condition", if: { truthy: "langs" }, then: next, else: toast("Pick at least one language.") } as ActionSpec;
  const chips = row(options.map((l) => langChip(l, desk)), { gap: 8, flexWrap: "wrap" });
  const keybot = botLook("keybot");
  const state = { langs: picked };
  const sample = (label: string, line: string, strong: boolean): Node => row([
    box([text(label, { size: 12, weight: strong ? 600 : 400, color: strong ? C.ink : C.meta, lineHeight: 16 })], { width: 96, flexShrink: 0 }),
    text(line, { size: 15, lineHeight: 22, style: { flexShrink: 1, minWidth: 0 } }),
  ], { gap: 14, alignItems: "flex-start", paddingVertical: 11, paddingHorizontal: 16 });

  if (desk) {
    return deskFrame(ctx, {
      title: "Your languages", right: signedInAs(ctx), current: null, state,
      left: [
        deskBlip("hello", 150),
        deskHeading("Language", W.langH, W.langP),
        row([botAvatar(keybot, 30), text(W.langMix, { size: 14, lineHeight: 20, color: C.grey70, style: { flexShrink: 1 } })], { gap: 12, maxWidth: 400 }),
      ],
      main: [
        col([row([sectionLabel("Languages"), grow(), meta("Pick all that fit", { size: 12 })], { gap: 10 }), chips], {
          padding: 16, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line,
        }),
        col([
          row([sectionLabel("Live sample"), grow(), meta("One thing, said three ways", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 4, gap: 10 }),
          sample("Hinglish", "Aaj 6 baje tak report bhej dena, phir chai pe milte hain.", true), divider(),
          sample("Hindi", "आज 6 बजे तक रिपोर्ट भेज देना, फिर चाय पे मिलते हैं।", false), divider(),
          sample("English", "Send the report by 6 today, then let's meet over chai.", false), divider(),
          box([meta("Said in one breath. Written the way you'd type it, no switching keyboards.", { size: 13, lineHeight: 18 })], { paddingTop: 10, paddingHorizontal: 16, paddingBottom: 14 }),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ],
      foot: deskFoot(deskBack(), [button("Save", cont, { size: "lg" })]),
    });
  }
  return phoneFrame(ctx, {
    title: "Your languages", state, gap: 20,
    body: [
      phoneBackLine(),
      phoneHeading(W.langH, W.langP),
      col([row([sectionLabel("Languages"), grow(), meta("Pick all that fit", { size: 12 })]), chips], { gap: 10 }),
      row([botAvatar(keybot, 30), text(W.langMix, { size: 15, lineHeight: 21, style: { flexShrink: 1 } })], { gap: 12 }),
      col([
        row([sectionLabel("Live sample"), grow(), row([icon("mic", { size: 14, color: C.meta }), meta("Hinglish", { size: 12 })], { gap: 6 })]),
        text("Aaj 6 baje tak report bhej dena, phir chai pe milte hain.", { size: 17, lineHeight: 25 }),
        meta("Said in one breath. Written the way you'd type it, no switching keyboards.", { size: 12, lineHeight: 17 }),
      ], { paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ],
    footer: [primaryButton("Save", cont, { wide: true })],
  });
}

// ===================================================================== About you, Name: the stage after sign-in

/** GET /v1/personality, as much as this step reads. */
interface Persona { personality?: { assistantName?: string } }
/** GET /v1/bots/first-run/profile (routes/botsFirstRun.ts). */
interface Me { name: string; via: string; source: "saved" | "provider" | "email" | null; gender: string | null; saved: boolean; onboarded?: boolean }
interface AfterSignIn { me?: Me; persona?: Persona }

const NAME_IDEAS = ["Tara", "Mitra", "Chotu", "Jarvis"];

/** A text field in the boards' look: the ink outline, the clear button. */
function nameField(path: string, placeholder: string, onSubmit: ActionRef, desk: boolean, o: { capitalize?: boolean; label: string }): Node {
  const input: Node = {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0,
      paddingVertical: 0, minHeight: 44, color: C.ink, autoCorrect: false, returnKeyType: "done",
      ...(o.capitalize ? { autoCapitalize: "words", textContentType: "name", autoComplete: "name" } : {}),
    },
    on: { onSubmit },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.medium, fontSize: 17,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  return row([
    input,
    labelled(box([icon("close", { size: 18, color: C.meta })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 }, setState(path, "")), `Clear ${o.label}`),
  ], { height: desk ? 54 : 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: desk ? 14 : 16, paddingLeft: 16, paddingRight: desk ? 6 : 4 });
}

/** The name and gender card's three choices, as chips: picked is ink with a tick. */
function genderChips(desk: boolean): Node {
  return row(GENDERS.map((g) => {
    const on: Condition = { eq: ["gender", g.value] };
    const c = (then: string, otherwise: string) => ({ ...on, then, else: otherwise });
    return labelled(row([
      when(on, icon("check", { size: 14, color: C.paper, weight: 2 })),
      text(g.label, { size: desk ? 14 : 15, weight: 500, lineHeight: 19, style: { color: c(C.paper, C.ink) } }),
    ], {
      gap: 6, height: desk ? 44 : 48, paddingHorizontal: 18, borderRadius: desk ? 22 : 24, borderWidth: 1, justifyContent: "center",
      borderColor: c(C.ink, C.outline), backgroundColor: c(C.ink, C.paper), flexGrow: desk ? 0 : 1, flexBasis: desk ? "auto" : 0,
    }, setState("gender", g.value)), g.label);
  }), { gap: 8 });
}

/** Where the name in the field came from, said under it: nothing for one the person typed or saved. */
function nameSource(me: Me | undefined): string | null {
  if (!me?.name || me.source === "saved" || !me.source) return null;
  if (me.source === "email") return "Guessed from your email. Change it if it's wrong.";
  const who = me.via === "apple" ? "Apple" : me.via === "google" ? "Google" : "sign-in";
  return `From your ${who} account. Change it if you like.`;
}

/**
 * About you: the person's own name and gender, the name and gender card's question, saved where it saves them.
 * `only`: the whole screen for someone onboarded before the first run asked it (the bootstrap's promptScreenId, in
 * place of the native card): no steps around it, and saving closes it instead of going on to Name.
 */
function youStep(ctx: BotsCtx, fig: Figure, me: Me | undefined, only = false): Node {
  const desk = ctx.client === "desktop";
  const save: ActionSpec = {
    kind: "condition", if: { all: [{ truthy: "fullName" }, { truthy: "gender" }] },
    // PUT /v1/profile { full_name, gender }: the card's own write, so everything that reads them (the bootstrap's
    // profile.complete, the greeting, the prompt) keeps working, and the card is never asked again.
    then: call("PUT", "/v1/profile", { full_name: "$state.fullName", gender: "$state.gender" }, {
      ok: only
        ? seq({ kind: "haptic", style: "success" } as ActionSpec, { kind: "refresh" } as ActionSpec, back)
        : seq({ kind: "haptic", style: "selection" } as ActionSpec, setState("step", 1)),
      fail: toast(W.saveErr),
    }),
    else: toast(W.youMissing),
  } as ActionSpec;
  const field = nameField("fullName", "Your name", save, desk, { capitalize: true, label: "your name" });
  const source = nameSource(me);
  const cont = button("Continue", save, { size: "lg", wide: !desk });

  if (desk) {
    return gateStep(true, deskBody({
      title: "About you", right: signedInAs(ctx), current: only ? null : 1,
      left: [
        deskFig(fig, "present", 140),
        deskHeading(only ? "About you" : `Step 1 of ${STEPS.length - 1}`, W.youH, W.youP),
      ],
      main: [col([
        col([text("Your name", { size: 13, weight: 500, lineHeight: 17 }), field, ...(source ? [meta(source, { size: 12 })] : [])], { gap: 6 }),
        col([text(W.youGender, { size: 13, weight: 500, lineHeight: 17 }), genderChips(true)], { gap: 8 }),
      ], { padding: 20, gap: 18, borderRadius: 18, borderWidth: 1, borderColor: C.line })],
      foot: deskFoot(null, [cont]),
    }), { props: { stepId: "you" } });
  }
  return gateStep(false, [phoneStepBody([
    only ? phoneTop(1, 1, { back }) : phoneTop(1, 2),
    row([fig("present", 116)], { justifyContent: "center" }),
    phoneHeading(W.youH, W.youP),
    col([sectionLabel("Your name"), field, ...(source ? [meta(source, { size: 12 })] : [])], { gap: 8 }),
    col([sectionLabel(W.youGender), genderChips(false)], { gap: 8 }),
  ], [cont])], { props: { stepId: "you" } });
}

/** What will you call me? The boss bot's name (X0 unless they pick their own); saving it finishes onboarding. */
function nameStep(ctx: BotsCtx, fig: Figure): Node {
  const desk = ctx.client === "desktop";
  const save = call("PUT", "/v1/personality", { assistantName: "$state.name" }, {
    ok: finish(),
    fail: toast("A name is letters and spaces, up to 24 characters."),
  });
  const fieldBox = nameField("name", ASSISTANT_NAME, save, desk, { label: "name" });
  const ideas = row([
    meta("Or try", { size: desk ? 13 : 12, style: { marginRight: 2 } }),
    ...NAME_IDEAS.map((n) => row([text(n, { size: desk ? 14 : 13, lineHeight: 17 })], {
      paddingVertical: desk ? 0 : 8, height: desk ? 40 : undefined, paddingHorizontal: desk ? 16 : 14, borderRadius: desk ? 20 : 18, borderWidth: 1, borderColor: C.outline,
    }, setState("name", n))),
  ], { gap: 8, flexWrap: "wrap", paddingTop: desk ? 0 : 4 });
  /** A bot reporting to the one in charge, by the name being typed. */
  const says = (slug: string, line: string, who: string): Node => row([
    botAvatar(botLook(slug), 30),
    col([
      bound("name", ASSISTANT_NAME, { size: desk ? 15 : 14, weight: 600, lineHeight: desk ? 22 : 20 }),
      text(line, { size: desk ? 15 : 14, lineHeight: desk ? 22 : 20 }),
      meta(who, { size: 12 }),
    ], { gap: 2, flexShrink: 1, minWidth: 0 }),
  ], { gap: desk ? 12 : 10, alignItems: "flex-start" });

  if (desk) {
    const heads = ctx.live.bots.slice(0, 4);
    return gateStep(true, deskBody({
      title: "What will you call me?", right: signedInAs(ctx), current: 2,
      left: [
        deskFig(fig, "tada", 140),
        deskHeading(`Step 2 of ${STEPS.length - 1}`, W.nameH, W.nameP),
        ...(heads.length ? [row([
          row(heads.map((b) => botAvatar(b, 22)), { gap: 4 }),
          meta(`${heads.length === 1 ? "1 bot" : `${heads.length} bots`} will report to this name`, { size: 13 }),
        ], { gap: 10, maxWidth: 400 })] : []),
      ],
      main: [
        col([
          col([text("Name", { size: 13, weight: 500, lineHeight: 17 }), fieldBox, meta("You can change it any time in Settings.", { size: 12 })], { gap: 6 }),
          ideas,
        ], { padding: 16, gap: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
        col([
          row([sectionLabel("How your bots will say it"), grow(), meta("Updates as you type", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 2, gap: 10 }),
          box([says("plan", "the dentist can do Friday 10 am. Should I book it?", "Plan Ease, reporting to the one in charge")], { paddingVertical: 14, paddingHorizontal: 16 }),
          divider(),
          box([says("travel", "the Goa refund is still with the airline. I'll ask again on Friday.", "Travel bot, in Activity")], { paddingVertical: 14, paddingHorizontal: 16 }),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ],
      // A window's stage never steps back, so there is no Back here.
      foot: deskFoot(null, [button("That's my name", save, { size: "lg" })]),
    }), { props: { stepId: "name" } });
  }
  return gateStep(false, [phoneStepBody([
    phoneTop(2, 2, { back: setState("step", 0) }),
    row([fig("tada", 128)], { justifyContent: "center" }),
    phoneHeading(W.nameH, W.nameP),
    col([sectionLabel("Name"), fieldBox, ideas], { gap: 8 }),
    col([sectionLabel("How your bots will say it"), says("plan", "the dentist can do Friday 10 am. Should I book it?", "Plan Ease, reporting to the one in charge")], {
      backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10,
    }),
  ], [primaryButton("That's my name", save, { wide: true })])], { props: { stepId: "name" } });
}

/**
 * bots.name-it: About you, then Name, on the stage Blip walks on to from the gate's (id "bots.first"). Someone whose
 * account already has both answers starts on Name.
 */
function afterSignIn(ctx: BotsCtx, data: AfterSignIn | undefined): ScreenResponse {
  const fig = figureFor(ctx);
  const me = data?.me;
  const gender = GENDERS.some((g) => g.value === me?.gender) ? me!.gender! : "";
  // Someone already onboarded is here only for the card's question (the bootstrap's promptScreenId): About you
  // alone, which closes once saved. Naming it, and finishing the first run, are not theirs to do again.
  const only = me?.onboarded === true;
  return stageScreen(ctx, {
    title: "About you", id: only ? "bots.about-you" : "bots.first", first: 2,
    steps: only ? [youStep(ctx, fig, me, true)] : [youStep(ctx, fig, me), nameStep(ctx, fig)],
    state: {
      step: me?.saved && !only ? 1 : 0,
      fullName: me?.name ?? "",
      gender,
      name: (data?.persona?.personality?.assistantName ?? "").trim() || ASSISTANT_NAME,
    },
  });
}

// ===================================================================== Turn on Keylessbord

/** GET /v1/bots/first-run/words: the account's words and audio seconds, all time; with a baseline, what came since. */
interface Words { words: number; seconds: number; typingSeconds: number; totalWords: number; totalSeconds: number }

/** Said by the pages in the app that open Keylessbord's setup, so its way out can be back to them (`leave`). */
const FROM_APP = { from: "app" } as const;
const fromApp = (ctx: BotsCtx): boolean => ctx.params.from === "app";

/**
 * Out of Keylessbord's setup (Turn on Keylessbord, then Now just talk): back to the page in the app that opened it. Opened by a
 * link instead (the keyboard's "Tap to set it up", a widget, the setup list) it is the app's only page, and back has
 * nowhere to go: so it is Home.
 */
const leave = (ctx: BotsCtx): ActionSpec => (fromApp(ctx) ? back : go(SCREENS.home, undefined, true));

/**
 * On to First words, in place of Turn on Keylessbord (so its Done leaves the setup, not back into it), with what has been
 * said so far, so First words can count only what is said there.
 */
const toFirstWords = (ctx: BotsCtx, w: Words | undefined): ActionSpec =>
  go(SCREENS.firstWords, { ...(w ? { w: w.totalWords, s: w.totalSeconds } : {}), ...(fromApp(ctx) ? FROM_APP : {}) }, true);

/** The phone's three steps in Settings, each done, in hand, or still to come, from what the phone itself reports. */
function keyOnPhone(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  // iPhone's words unless the phone says it is an Android one.
  const android: Condition = { platform: "android" };
  const ios: Condition = { not: android };
  // Full Access read, or, on an iPhone, the keyboard switched on: an iPhone reads Full Access only after the keyboard has
  // run, so waiting for it there would hold Continue back from someone who has done every step (the keyboard itself says
  // so if Full Access is still off).
  const ready: Condition = { any: [{ truthy: "keyboardReady" }, { all: [ios, { truthy: "keyboardEnabled" }] }] };
  const done: Condition[] = [
    { any: [{ truthy: "opened" }, { truthy: "keyboardEnabled" }, ready] },
    { any: [{ truthy: "keyboardEnabled" }, ready] },
    ready,
  ];
  const now = (i: number): Condition => (i === 0 ? { not: done[0]! } : { all: [done[i - 1]!, { not: done[i]! }] });
  const later = (i: number): Condition => ({ not: done[i - 1]! });
  const badge = (i: number): Node[] => [
    when(done[i]!, box([icon("check", { size: 14, weight: 2 })], { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" })),
    when(now(i), box([text(String(i + 1), { size: 13, weight: 700, color: C.paper, lineHeight: 16 })], { width: 26, height: 26, borderRadius: 13, backgroundColor: CLAY, alignItems: "center", justifyContent: "center" })),
    ...(i ? [when(later(i), box([text(String(i + 1), { size: 13, weight: 700, color: C.meta, lineHeight: 16 })], { width: 26, height: 26, borderRadius: 13, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }))] : []),
  ];
  /** A step's words: iPhone's and Android's differ; the one in hand is bold. */
  const words = (i: number, t: { ios: string; android: string }): Node[] => [
    when({ all: [ios, now(i)] }, text(t.ios, { size: 15, weight: 600, lineHeight: 20 })),
    when({ all: [android, now(i)] }, text(t.android, { size: 15, weight: 600, lineHeight: 20 })),
    when({ all: [ios, { not: now(i) }] }, text(t.ios, { size: 15, lineHeight: 20, style: { color: { ...done[i]!, then: C.meta, else: C.ink } } })),
    when({ all: [android, { not: now(i) }] }, text(t.android, { size: 15, lineHeight: 20, style: { color: { ...done[i]!, then: C.meta, else: C.ink } } })),
  ];
  const step = (i: number, t: { ios: string; android: string }, extra: Node[] = []): Node => row([
    box(badge(i), { width: 26, flexShrink: 0 }),
    col([...words(i, t), ...extra], { gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    when(done[i]!, meta("Done", { size: 12 })),
    when(now(i), box([statusMark("working", { color: CLAY })], { height: 20, justifyContent: "center" })),
  ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: "flex-start" });
  const seg = (i: number): Node => box([
    when(done[i]!, box([], { height: 5, backgroundColor: C.ink })),
    when(now(i), box([], { height: 5, backgroundColor: CLAY })),
  ], { flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3, backgroundColor: C.track, overflow: "hidden" });
  const stepOf = [
    when(now(0), meta("Step 1 of 3", { size: 12 })), when(now(1), meta("Step 2 of 3", { size: 12 })),
    when(now(2), meta("Step 3 of 3", { size: 12 })), when(ready, meta("All done", { size: 12 })),
  ];
  const chipPath = (s: string): Node => box([text(s, { size: 11.5, mono: true, color: C.grey70, lineHeight: 15 })], {
    alignSelf: "flex-start", backgroundColor: C.surface, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8,
  });
  const openIos = seq(setState("opened", true), { kind: "requestPermission", permission: "microphone" } as ActionSpec, { kind: "openUrl", url: "app-settings:", external: true });
  const openAndroid = seq(setState("opened", true), { kind: "openSettings", target: "keyboard" });
  return phoneFrame(ctx, {
    title: W.keyH,
    // Overwritten live by the app: it re-reads the keyboard on a timer and on every return from Settings.
    state: { opened: false, keyboardEnabled: false, keyboardReady: false },
    body: [
      phoneBackLine(link("Not now", leave(ctx), { size: 14, color: C.grey70 }), leave(ctx)),
      row([botAvatar(botLook("keybot"), 52), col([title(W.keyH, { lineHeight: 31 }), meta(W.keyP, { size: 13 })], { gap: 3, flexShrink: 1 })], { gap: 14 }),
      col([
        col([
          row([when(ios, meta("In your iPhone Settings", { size: 12 })), when(android, meta("In your phone's Settings", { size: 12 })), grow(), ...stepOf]),
          row([seg(0), seg(1), seg(2)], { gap: 4 }),
        ], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6, gap: 8 }),
        step(0, { ios: "Open Settings", android: "Open Settings" }),
        divider(),
        step(1, { ios: "Keyboards, then switch on X0 Bot", android: "Switch on X0 Bot, and tap OK" }, [when(ios, chipPath("Settings › X0 Bot › Keyboards"))]),
        divider(),
        step(2, { ios: "Allow Full Access", android: "Come back here" }, [
          when(ios, meta("Turn the switch on, then come back here", { size: 12 })),
          when(android, meta("Keylessbord takes it from there", { size: 12 })),
        ]),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      when(ios, col([
        text("Why full access?", { size: 14, weight: 600, lineHeight: 19 }),
        row([icon("mic", { size: 16, color: C.grey70 }), text("Keylessbord needs the internet to turn your voice into text. Full Access is what lets a keyboard reach it.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
        row([icon("lock", { size: 16, color: C.grey70 }), text("It only takes your words after you tap its mic key.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
      ], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10 })),
    ],
    // One button: Continue opens Settings until the phone says Keylessbord is on, then goes on to try it.
    footer: [
      when({ all: [ios, { not: ready }] }, primaryButton("Continue", openIos, { wide: true })),
      when({ all: [android, { not: ready }] }, primaryButton("Continue", openAndroid, { wide: true })),
      when(ready, primaryButton("Continue", toFirstWords(ctx, w), { wide: true })),
      when({ all: [ios, { not: ready }] }, meta("Opens X0 Bot in Settings. Come back here when it's on.", { size: 12, align: "center" })),
      when({ all: [android, { not: ready }] }, meta("Opens your keyboards. Come back here when it's on.", { size: 12, align: "center" })),
      when(ready, meta("Keylessbord is on. Tap its mic key in any app.", { size: 12, align: "center" })),
    ],
  });
}

/** The window: the microphone (the OS asks the first time) and Accessibility, read on this computer by its own card. */
function keyOnDesk(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  // This computer's answers (Accessibility, Screen Recording) are known only to its own main process; its card
  // ("DeskAskSetup", declared by a window that has it) draws the real state and opens the right page in Settings.
  const askCard = ctx.can.has("DeskAskSetup");
  const keys = ctx.can.has("DeskShell");
  const why = (name: IconName, line: string): Node =>
    row([icon(name, { size: 16, color: C.grey70 }), text(line, { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" });
  const permRow = (name: IconName, h: string, sub: string, right: Node | null): Node => row([
    box([icon(name, { size: 15 })], { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" }),
    col([text(h, { size: 15, weight: 600, lineHeight: 20 }), text(sub, { size: 13, lineHeight: 18, color: C.grey70 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(right ? [right] : []),
  ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "flex-start" });
  const access: Node = askCard
    ? box([{
        type: "DeskAskSetup",
        props: {
          place: "settings", on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart X0 Bot to finish", restartButton: "Restart",
          rows: [{ key: "read", title: "Accessibility", sub: "So Keylessbord can put the words where your cursor is, in any app." }],
        },
      }], { paddingHorizontal: 4, paddingBottom: 4 })
    : permRow("computer", "Accessibility", "If your Mac asks, allow X0 Bot in Privacy & Security › Accessibility, so Keylessbord can type where your cursor is.", null);
  return deskFrame(ctx, {
    title: W.keyH, current: null,
    right: link("Not now", leave(ctx), { size: 14, color: C.grey70 }),
    left: [
      deskBlip("needs", 140),
      deskHeading("Keylessbord", W.keyH, "Speak instead of type, in every app."),
      col([
        text("Why these two?", { size: 14, weight: 600, lineHeight: 19 }),
        why("mic", "The mic is on only while you hold the key. It never listens otherwise."),
        why("lock", "Keylessbord types only where your cursor is, and only what you said."),
      ], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 10, maxWidth: 400 }),
    ],
    main: [
      col([
        box([meta("In this computer's settings", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 4 }),
        permRow("mic", "Microphone", "So Keylessbord hears you while you hold the key. Your computer asks the first time.", null),
        divider(),
        access,
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      col([
        row([sectionLabel("Key to hold while you speak"), grow(), meta("Change it later in Settings", { size: 12 })], { gap: 10 }),
        keys
          ? row([{ type: "Keys", props: { source: "hotkey" } }, text("Hold it in any app, speak, let go.", { size: 14, lineHeight: 19, color: C.grey70 })], { gap: 12, flexWrap: "wrap" })
          : text("Hold your Keylessbord key in any app, speak, let go.", { size: 14, lineHeight: 19, color: C.grey70 }),
      ], { padding: 16, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ],
    foot: deskFoot(deskBack(leave(ctx)), [
      meta("Allowed? Carry on and say something.", { size: 12, style: { maxWidth: 200 }, align: "right" }),
      button("Continue", toFirstWords(ctx, w), { size: "lg" }),
    ]),
  });
}

// ===================================================================== First words

/** "4", "4.5". */
const secs = (s: number): string => (s >= 10 || Number.isInteger(s) ? String(Math.round(s)) : s.toFixed(1));

/** What was said here, as the boards' numbers: words, the seconds it took, and typing it by comparison. Null until something was said. */
function spoken(w: Words | undefined, desk: boolean): Node | null {
  if (!w || w.words <= 0) return null;
  const words = w.words === 1 ? "1 word" : `${w.words.toLocaleString("en-IN")} words`;
  const typing = Math.max(1, w.typingSeconds);
  const bar = (label: string, pct: number, color: string, value: string) => row([
    box([meta(label, { size: 12 })], { width: desk ? 70 : 78, flexShrink: 0 }),
    box([box([], { width: `${Math.max(4, Math.min(100, pct)).toFixed(0)}%`, height: 6, borderRadius: 3, backgroundColor: color })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    box([meta(value, { size: 12, align: "right" })], { width: 40, flexShrink: 0, alignItems: "flex-end" }),
  ], { gap: 10 });
  const faster = w.seconds > 0 ? typing / w.seconds : 0;
  return col([
    row([text(words, { size: 34, weight: 700, tracking: -0.8, lineHeight: 41 }), ...(w.seconds > 0 ? [text(`in ${secs(w.seconds)} seconds`, { size: 15, color: C.grey70, lineHeight: 20 })] : [])], {
      gap: 8, alignItems: "baseline", flexWrap: "wrap",
    }),
    ...(w.seconds > 0 ? [
      bar("Speaking", (w.seconds / Math.max(typing, w.seconds)) * 100, CLAY, `${secs(w.seconds)} s`),
      bar("Typing", 100, C.track, `~${typing} s`),
    ] : []),
    meta(faster >= 1.5 ? `About ${Math.round(faster)}× faster than typing it.` : `Typing it would take about ${typing} seconds.`, { size: 13 }),
  ], { gap: 10 });
}

/** The practice box: whatever Keylessbord writes into it stays on this page. */
function practiceField(desk: boolean): Node {
  return {
    type: "TextField", id: "said", bind: { value: "said" },
    props: {
      placeholder: desk ? "Click here, then hold your key and speak" : "Tap the clay key and speak. Your words land here.", placeholderColor: C.idle,
      background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, multiline: true,
      minHeight: desk ? 86 : 54, minHeightMultiline: desk ? 86 : 54, color: C.ink,
    },
    style: {
      minHeight: desk ? 86 : 54, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 18, lineHeight: desk ? 28 : 27,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}

/**
 * The keyboard of the phone's board, with Keylessbord's clay key. On a phone that has it, the clay key IS the mic, and works
 * as the real keyboard's does: tap it and speak, tap it again (the app's own VoiceButton: /v1/transcribe-clean, which
 * counts the words and the seconds), and the words land in the box above; then the numbers are worked out again.
 */
function keyboardArt(mic: Node | null): Node {
  const key = (style: Style = {}): Node => box([], { height: 32, borderRadius: 7, backgroundColor: C.paper, flexGrow: 1, flexBasis: 0, ...style });
  const wave = [8, 16, 22, 12, 18, 9, 14, 6];
  return labelled(col([
    row(Array.from({ length: 10 }, () => key()), { gap: 5 }),
    row(Array.from({ length: 9 }, () => key()), { gap: 5, paddingHorizontal: 16 }),
    row([
      key({ height: 38, backgroundColor: C.track, flexGrow: 1.3 }),
      mic ?? box([icon("mic", { size: 18, color: C.paper })], { height: 38, borderRadius: 7, backgroundColor: CLAY, flexGrow: 1.1, flexBasis: 0, alignItems: "center", justifyContent: "center" }),
      row(wave.map((h) => box([], { width: 3, height: h, borderRadius: 2, backgroundColor: CLAY })), { height: 38, borderRadius: 7, backgroundColor: C.paper, flexGrow: 4, flexBasis: 0, gap: 3, justifyContent: "center" }),
      key({ height: 38, backgroundColor: C.track, flexGrow: 1.4 }),
    ], { gap: 5 }),
  ], { backgroundColor: C.surface, borderRadius: 22, paddingTop: 10, paddingHorizontal: 8, paddingBottom: 12, gap: 8 }), mic ? "Keyboard: tap the clay key to speak" : "Keyboard with the clay Keylessbord mic key");
}

/**
 * The clay key as the app's own speak button (a build that has one: it says "VoiceButton"). Tap to start, tap to stop,
 * as the keyboard's mic key is: the stop square while it listens.
 */
function clayMic(after: ActionRef): Node {
  return {
    type: "VoiceButton",
    bind: { value: "said", state: "mic" },
    props: { radius: 7, background: CLAY, recordingBackground: CLAY, paddingVertical: 0, label: "", stopLabel: "", transcribingLabel: "" },
    style: { height: 38, flexGrow: 1.1, flexBasis: 0, alignItems: "center", justifyContent: "center", paddingVertical: 0 },
    on: { onChange: after, onError: toast("Couldn't hear that. Tap the key and try again.") },
    children: [
      when({ neq: ["mic", "recording"] }, icon("mic", { size: 18, color: C.paper })),
      when({ eq: ["mic", "recording"] }, icon("stop", { size: 16, color: C.paper, weight: 2.4 })),
    ],
  };
}

function firstWords(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));
  const baseW = num(ctx.params.w) ?? w?.totalWords;
  const baseS = num(ctx.params.s) ?? w?.totalSeconds;
  const said = typeof ctx.params.said === "string" ? ctx.params.said : "";
  // The numbers are worked out on the server from the account's own usage since this step opened; this asks again.
  const check: ActionSpec = go(SCREENS.firstWords, {
    ...(baseW !== undefined ? { w: baseW } : {}), ...(baseS !== undefined ? { s: baseS } : {}), said: "$state.said", ...(fromApp(ctx) ? FROM_APP : {}),
  }, true);
  const result = spoken(w, desk);
  const nothingYet = col([
    meta("Your words, and how long they took, show here once you've spoken.", { size: 13, lineHeight: 18 }),
    when({ truthy: "said" }, button("How fast was that?", check, { kind: "secondary", size: "md" })),
  ], { gap: 10 });
  // Out of the setup, to where it was opened from (Turn on Keylessbord is no longer under it), or Home.
  const next = button(result ? "Nice, done" : "Done", leave(ctx), { size: "lg", wide: !desk });
  const state = { said, mic: "idle" };

  if (desk) {
    return deskFrame(ctx, {
      title: W.wordsH, right: signedInAs(ctx), current: null, state,
      left: [
        deskBlip("listen", 140),
        deskHeading("Keylessbord", W.wordsH, "Hold your key and say anything, in any mix."),
        box([result ?? nothingYet], { maxWidth: 400 }),
      ],
      main: [col([
        row([
          row([0, 1, 2].map(() => box([], { width: 11, height: 11, borderRadius: 6, backgroundColor: C.outline })), { gap: 7 }),
          grow(), meta("Try it here", { size: 13 }), grow(), box([], { width: 47 }),
        ], { height: 40, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.divider }),
        col([
          meta("Just for practice. Keylessbord writes what you say here.", { size: 12 }),
          box([practiceField(true)], { borderWidth: 1.5, borderColor: C.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, minHeight: 118 }),
          ctx.can.has("DeskShell")
            ? row([{ type: "Keys", props: { source: "hotkey" } }, meta("Hold, speak, let go to drop the words in.", { size: 12 })], { gap: 8, justifyContent: "center", flexWrap: "wrap" })
            : meta("Hold your key, speak, let go to drop the words in.", { size: 12, align: "center" }),
          ...(result ? [when({ truthy: "said" }, row([button("Count again", check, { kind: "quiet", size: "md" })], { justifyContent: "center" }))] : []),
        ], { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }),
      ], { borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper })],
      foot: deskFoot(deskBack(leave(ctx)), [next]),
    });
  }
  return phoneFrame(ctx, {
    title: W.wordsH, state, gap: 16,
    body: [
      phoneBackLine(undefined, leave(ctx)),
      phoneHeading(W.wordsH, "Tap the clay key and say anything, in any mix. Tap it again when you're done.", 6),
      col([
        box([blip("listen", 140)], { position: "absolute", top: 0, right: 22 }),
        col([
          row([
            icon("mic", { size: 14, color: CLAY }),
            when({ eq: ["mic", "idle"] }, meta("Keylessbord writes here", { size: 12 })),
            when({ eq: ["mic", "recording"] }, meta("Listening. Tap the clay key again when you're done.", { size: 12, color: CLAY })),
            when({ eq: ["mic", "busy"] }, meta("Writing it down…", { size: 12 })),
          ], { gap: 8 }),
          practiceField(false),
        ], { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, gap: 8, zIndex: 1 }),
      ], { paddingTop: 72 }),
      result ? col([result, when({ truthy: "said" }, row([button("Count again", check, { kind: "quiet", size: "md" })]))], { gap: 6 }) : nothingYet,
      grow(),
      keyboardArt(ctx.can.has("VoiceButton") ? clayMic(check) : null),
    ],
    footer: [next],
  });
}

// ===================================================================== Plans

/** GET /v1/bots/first-run/plans (routes/botsFirstRun.ts). */
interface Plans {
  freeForAll: boolean;
  entitled: boolean;
  store?: string;
  freeWords: number;
  features: string[];
  plans: Array<{
    id: string; label: string; price: string; per: string; perTemplate?: string; note?: string; badge?: string; trialDays?: number; default?: boolean; line?: string;
    buy?: { kind: "iap.showPaywall"; offeringId: string; packageId?: string } | { kind: "iap.subscribe"; productId: string };
  }>;
}

/** "4 Nov": the day a trial that starts now ends. */
function dayAfter(nowMs: number, tzOffsetMinutes: number, days: number): string {
  const d = new Date(nowMs + tzOffsetMinutes * 60_000 + days * 86_400_000);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m}`;
}

function plansScreen(ctx: BotsCtx, data: Plans | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  // Reached from You and Billing, not the first run any more: every way out goes back to where it was opened from.
  const done: ActionSpec = back;
  const doneHeading = (h: string, sub: string): Node[] => desk ? [deskBlip("done", 140), deskHeading("Plans", h, sub)] : [phoneBackLine(), phoneHeading(h, sub, 6)];
  // Nothing to choose: free for everyone, already paying, or the plans could not be read. Say so, and go in.
  const simple = (h: string, sub: string, cta: string): ScreenResponse => desk
    ? deskFrame(ctx, { title: W.plansH, right: signedInAs(ctx), current: null, left: doneHeading(h, sub), main: [], foot: deskFoot(deskBack(), [button(cta, done, { size: "lg" })]) })
    : phoneFrame(ctx, { title: W.plansH, body: [...doneHeading(h, sub), row([blip("done", 160)], { justifyContent: "center", paddingTop: 20 })], footer: [primaryButton(cta, done, { wide: true })] });
  if (!data) return simple("Plans", "Plans couldn't load just now. Try again in a moment.", "Done");
  if (data.freeForAll) return simple("Plans", "X0 Bot is free for everyone right now. Nothing to pick, nothing to pay.", "Done");
  if (data.entitled) return simple("You have a plan", "This account already has a plan. It covers your phone and your computer.", "Done");
  const paid = data.plans;
  if (!paid.length) return simple("Plans", "You're on Free. Plans to buy aren't available here yet.", "Done");

  const chosen = (paid.find((p) => p.default) ?? paid[0]!).id;
  const isOn = (id: string): Condition => ({ eq: ["plan", id] });
  const sel = (id: string, then: unknown, otherwise: unknown) => ({ ...isOn(id), then, else: otherwise });
  const buyAction = (p: Plans["plans"][number]): ActionRef | undefined => {
    if (!p.buy) return undefined;
    const failed = toast("Couldn't complete the purchase. Nothing was charged.");
    // The window has no store: the pay page opens in the browser, and the account is ready when they come back.
    if (desk) return seq(p.buy as ActionSpec, done);
    return { ...p.buy, onSuccess: seq(saved("You're in."), done), onError: failed } as ActionSpec;
  };
  const radio = (id: string): Node => box([when(isOn(id), box([], { width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink }))], {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: sel(id, C.ink, C.outline), alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
  const tag = (s: string): Node => box([text(s, { size: 12, weight: 500, lineHeight: 16 })], { backgroundColor: C.surface, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 });
  // A phone's plans carry their store package: the price shows as the store words it once it answers (catalog.ts storePriceOf).
  const store = (p: Plans["plans"][number], o: { field?: "perMonth"; template?: string } = {}): TextOpts =>
    p.buy?.kind === "iap.showPaywall" && p.buy.packageId
      ? { storePrice: { packageId: p.buy.packageId, offeringId: p.buy.offeringId, ...o } }
      : {};
  // A plan is its name, its price and period, and one line that is the same for every bot. The selected one shows its
  // billing terms too (the stores want the commitment before the purchase).
  const planCard = (p: Plans["plans"][number]): Node => col([
    row([radio(p.id), text(p.label, { size: 17, weight: 600, lineHeight: 22 }),
      ...(p.trialDays ? [tag(`${p.trialDays} days free`)] : p.badge ? [tag(p.badge)] : []),
      grow(), text(p.price, { size: 17, weight: 700, lineHeight: 22, ...store(p) })], { gap: 10 }),
    col([
      ...(p.per ? [meta(p.per, { size: 12, ...(p.perTemplate ? store(p, { field: "perMonth", template: p.perTemplate }) : {}) })] : []),
      ...(p.line ? [text(p.line, { size: 14, lineHeight: 19 })] : []),
      ...(p.note && !p.trialDays ? [when(isOn(p.id), meta(p.note, { size: 12 }))] : []),
    ], { gap: 6, paddingLeft: 32, marginTop: -6 }),
  ], {
    paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderRadius: 18, borderWidth: sel(p.id, 1.5, 1), borderColor: sel(p.id, C.ink, C.line),
  }, setState("plan", p.id));
  const cards = paid.map(planCard);
  /** What a trial costs, day by day: nothing today, the price when it ends. */
  const trial = (p: Plans["plans"][number]): Node | null => p.trialDays ? when(isOn(p.id), col([
    text(`Try ${p.label} free for ${p.trialDays} days. Cancel any time before it ends and you pay nothing.`, { size: 14, lineHeight: 20 }),
    row([
      col([meta("Today", { size: 12 }), text("Free", { size: 13, weight: 600, lineHeight: 17 })], { gap: 2, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0 }),
      col([meta(dayAfter(ctx.live.now, ctx.tzOffsetMinutes, p.trialDays), { size: 12 }), text(`Then ${p.price}`, { size: 13, weight: 600, lineHeight: 17, ...store(p, { template: "Then {price}" }) })], {
        gap: 2, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0, borderLeftWidth: 1, borderLeftColor: C.track,
      }),
    ], { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 10 }),
  ], { gap: 10 })) : null;
  const trials = paid.map(trial).filter((n): n is Node => !!n);
  const ctaFor = (p: Plans["plans"][number]): string =>
    p.trialDays ? (p.trialDays === 7 ? "Start free week" : `Start ${p.trialDays} free days`) : `Choose ${p.label}`;
  const ctas: Node[] = [
    ...paid.map((p) => when(isOn(p.id), button(ctaFor(p), buyAction(p), { size: "lg", wide: !desk, ...(p.buy ? {} : { kind: "disabled" }) }))),
  ];
  const stay = link("Not now", done, { center: true });
  const sub = "Start today. Switch any time from You.";
  // THE PURCHASE SCREEN, AND THE ONLY ONE WITH MONEY ON IT: the stores (App Review 3.1.2, Google Play) want the price and its period
  // shown before someone buys, with the renewal and the terms. Everywhere else the app shows no money.
  const fine = desk
    ? "Renews automatically until you cancel. You pay in your browser, and nothing is charged until you confirm there."
    : "Renews automatically until you cancel. Cancel any time in your store's subscriptions. Your store shows the final price before you pay.";
  const legal = row([link("Terms", { kind: "openUrl", url: "https://x0bot.com/terms", external: true }, { size: 13, color: C.meta }), link("Privacy", { kind: "openUrl", url: "https://x0bot.com/privacy", external: true }, { size: 13, color: C.meta })], { gap: 18, justifyContent: "center" });
  const state = { plan: chosen };

  if (desk) {
    return deskFrame(ctx, {
      title: W.plansH, right: signedInAs(ctx), current: null, state,
      left: [...doneHeading(W.plansH, sub), ...(trials.length ? [box(trials, { maxWidth: 400 })] : []), meta(fine, { size: 12, style: { maxWidth: 400 } }), legal],
      main: [col(cards, { gap: 12 })],
      foot: deskFoot(deskBack(), [stay, ...ctas]),
    });
  }
  return phoneFrame(ctx, {
    title: W.plansH, state, gap: 16,
    body: [...doneHeading(W.plansH, sub), col(cards, { gap: 12 }), ...trials],
    footer: [...ctas, stay, meta(fine, { size: 11, align: "center" }), legal],
  });
}

// ===================================================================== after onboarding: one card for what Keylessbord still needs

/**
 * What the app reports into every screen's state: the phone's SduiApp writes keyboardEnabled, keyboardReady (Full
 * Access) and micGranted on a timer and on every return from Settings; a window that declares DeskMicAsk writes
 * micGranted from its own system's answer, and one that declares DeskAxState writes axGranted (the Mac's Accessibility
 * for Tailzu; any other system has none to give, so true) on each paint and each return to the window. Keylessbord
 * declares them "on", so its card never flashes up for someone who has it all and then vanishes: it comes in once the
 * app says something is missing, and goes when it is on.
 */
export const DEVICE_STATE = { keyboardEnabled: true, keyboardReady: true, micGranted: true, axGranted: true };

/**
 * The first arrival (over Home): unknown until the app's readings come in (null), so the card decides only then;
 * `micAsked` once the microphone has been asked (allowed or not: either way on to the keyboard), `permitClosed`
 * once it is answered or put off.
 */
export const ARRIVAL_STATE = { keyboardEnabled: null, keyboardReady: null, micGranted: null, axGranted: null, micAsked: false, permitClosed: false };

/** A window that reads this computer's Accessibility into $state.axGranted (TAILZU-DESKTOP sdui.js axFollow). */
export const AX_STATE = "DeskAxState";
/** The window's own action (sdui.js, declared with its Ask card's): the main process opens the Mac's Accessibility page. */
const OPEN_AX = { kind: "ask.openAccessibility" } as unknown as ActionSpec;

/** The read the first-arrival card is due on (GET /v1/bots/first-run/arrival) and the write that ends it. */
export const ARRIVAL_PATH = "/v1/bots/first-run/arrival";

const MIC_SETTLED: Condition = { any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] };
// An iPhone only learns Full Access once the keyboard has been opened (only the keyboard can read it), so there the
// keyboard switched on is enough for the card; the keyboard asks for Full Access itself if it is still off.
const KEYS_ON: Condition = { all: [{ truthy: "keyboardEnabled" }, { any: [{ truthy: "keyboardReady" }, { platform: "ios" }] }] };
const KEYS_MISSING: Condition = { not: KEYS_ON };
const SOMETHING_MISSING: Condition = { any: [{ falsy: "micGranted" }, KEYS_MISSING] };

/** The bot on the permission cards: neutral, ink grey (the cards carry no bot's colour). */
const CARD_BOT = { color: C.grey70, stageHeight: 128 } as const;

/** One step of the card: monochrome, ink on white; one black pill, and a quiet second choice under it. */
function permitStep(o: { when: Condition; title: string; lines: Node[]; cta?: { label: string; onPress: ActionRef }; quiet?: { label: string; onPress: ActionRef }; extra?: Node[] }): Node {
  return when(o.when, col([
    col([text(o.title, { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), ...o.lines], { gap: 6 }),
    ...(o.extra ?? []),
    ...(o.cta || o.quiet ? [col([
      ...(o.cta ? [primaryButton(o.cta.label, o.cta.onPress, { wide: true })] : []),
      ...(o.quiet ? [labelled(row([text(o.quiet.label, { size: 15, weight: 500, color: C.meta, lineHeight: 20 })], { minHeight: 44, justifyContent: "center", alignSelf: "stretch" }, o.quiet.onPress), o.quiet.label)] : []),
    ], { gap: 4, marginTop: 6 })] : []),
  ], { paddingHorizontal: 22, paddingTop: 16, paddingBottom: o.quiet ? 10 : 22, gap: 12 }));
}

const line = (s: string): Node => text(s, { size: 14, color: C.grey70, lineHeight: 20 });

/** The card's last step, once everything is on: its words give way to one short line while the bot cheers, then it goes. */
const gotYou = (whenOn: Condition): Node =>
  when(whenOn, row([text("X0 got you!", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { justifyContent: "center", paddingTop: 18, paddingBottom: 26 }));
/** How long the bot cheers on that line before the card goes. */
const CHEER_MS = 2800;

/** The keyboard step's words: iPhone and Android each say where the switch is. */
function keyboardLines(): Node[] {
  const android: Condition = { platform: "android" };
  return [
    when({ not: android }, line("In Settings, open Keyboards, switch on X0 Bot, then Allow Full Access.")),
    when(android, line("Switch on X0 Bot in your keyboards, and tap OK.")),
  ];
}

/**
 * THE FIRST ARRIVAL: one card over Home, the first time someone lands in the app (until it is answered or put off;
 * the server keeps that, GET/PUT /v1/bots/first-run/arrival). Step 1 asks for the microphone, for real; allowed or
 * not, the same card moves on to step 2, the keyboard (straight to its settings). Once both are on, a small happy
 * moment and it closes. "Not now" closes it for good. Over a blurred Home (BotCard overlay) where the build draws it,
 * else a plain card at the top of Home. Nothing at all when there is nothing to ask for.
 */
export function arrivalCard(ctx: BotsCtx, o: { after?: string } = {}): Node[] {
  const desk = ctx.client === "desktop";
  const close = seq(setState("permitClosed", true), call("PUT", ARRIVAL_PATH, {}, {}));
  const notNow = { label: "Not now", onPress: close };
  const askMic = (onGranted: ActionRef, extra: ActionRef): ActionSpec => ({
    kind: "requestPermission", permission: "microphone",
    onGranted, onDenied: extra, onBlocked: extra,
  } as ActionSpec);
  const mic = (whenMic: Condition) => permitStep({
    when: whenMic,
    title: "Let X0 Bot hear you",
    lines: [line("Allow the microphone for a better experience: talk to any bot, in any app.")],
    cta: { label: "Allow microphone", onPress: askMic(seq(setState("micGranted", true), setState("micAsked", true)), setState("micAsked", true)) },
    quiet: notNow,
  });
  let steps: Node[], ready: Condition | undefined, done: Condition | undefined;
  if (desk) {
    // A window: its microphone (where it can tell) and this computer's Accessibility (where it can show it). A window
    // that reads Accessibility itself (AX_STATE) lets the step go on its own once it is on, and the card close; one
    // that only shows it (DeskAskSetup) keeps a Done.
    const hasMic = ctx.can.has("DeskMicAsk"), askCard = ctx.can.has("DeskAskSetup"), axRead = ctx.can.has(AX_STATE);
    const hasAx = askCard || axRead;
    if (!hasMic && !hasAx) return [];
    const axTurn: Condition = hasMic ? MIC_SETTLED : { falsy: "permitClosed" };
    const allSet: Condition | undefined = axRead ? { all: [...(hasMic ? [MIC_SETTLED] : []), { truthy: "axGranted" }] } : hasMic && !hasAx ? MIC_SETTLED : undefined;
    steps = [
      ...(hasMic ? [mic({ all: [{ falsy: "micGranted" }, { falsy: "micAsked" }] })] : []),
      ...(hasAx ? [permitStep({
        when: axRead ? { all: [axTurn, { falsy: "axGranted" }] } : axTurn,
        title: "Let Keylessbord type for you",
        lines: [line("Allow Accessibility so Keylessbord can put your words where your cursor is, in any app.")],
        ...(askCard ? {
          extra: [{
            type: "DeskAskSetup",
            props: {
              place: "settings", eyebrow: "", title: "", titleEm: "", lede: "",
              on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart X0 Bot to finish", restartButton: "Restart",
              rows: [{ key: "read", title: "Accessibility", sub: "Lets Keylessbord type what you said into the app you're in." }],
            },
          }],
        } : {
          // The Mac's own page; the window asks the main process, which opens only that fixed address.
          cta: { label: "Open Settings", onPress: OPEN_AX },
        }),
        quiet: axRead ? notNow : { label: "Done", onPress: close },
      })] : []),
      ...(allSet ? [permitStep({ when: allSet, title: "You're all set", lines: [
        // The key this computer holds to talk (desktop.holdKey: the one key, as main.js has it bound): "Hold Fn to talk".
        when({ truthy: "desktop.hold" }, row([line("Hold"), text("Fn", { size: 14, weight: 600, lineHeight: 20, bind: "desktop.holdKey" }), line("to talk, in any app.")], { gap: 4, flexWrap: "wrap" })),
        when({ falsy: "desktop.hold" }, line("Hold the clay key to speak, in any app.")),
      ] })] : []),
    ];
    const known: Condition[] = [...(hasMic ? [{ neq: ["micGranted", null] } as Condition] : []), ...(axRead ? [{ neq: ["axGranted", null] } as Condition] : [])];
    ready = known.length > 1 ? { all: known } : known[0];
    done = allSet;
  } else {
    steps = [
      mic({ all: [{ falsy: "micGranted" }, { falsy: "micAsked" }] }),
      permitStep({
        when: { all: [MIC_SETTLED, KEYS_MISSING] },
        title: "Add the X0 Bot keyboard",
        lines: keyboardLines(),
        cta: { label: "Open Settings", onPress: { kind: "openSettings", target: "keyboard" } as ActionSpec },
        quiet: notNow,
      }),
      gotYou({ all: [MIC_SETTLED, KEYS_ON] }),
    ];
    // Known enough to decide: the microphone, and the keyboard switched on or not. Full Access is only read once the
    // keyboard has run; an iPhone may not have that yet, and KEYS_ON does not need it there.
    ready = { all: [{ neq: ["micGranted", null] }, { neq: ["keyboardEnabled", null] }, { any: [{ neq: ["keyboardReady", null] }, { platform: "ios" }] }] };
    done = { all: [MIC_SETTLED, KEYS_ON] };
  }
  if (canMove(ctx)) {
    // `after`: a state path that must be true first (Home's hello plays alone, then the card comes). Home waits on the card
    // closing then, so it is not also kept per device: a second account on the same phone still gets it.
    const wait: Condition | undefined = o.after ? (ready ? { all: [ready, { truthy: o.after }] } : { truthy: o.after }) : ready;
    return [botCard(steps, {
      ...CARD_BOT, kind: "custom", overlay: true, width: desk ? 360 : 330, label: "Set up Keylessbord",
      ...(wait ? { readyWhen: wait } : {}), ...(done ? { doneWhen: done } : {}),
      closeWhen: { truthy: "permitClosed" }, ...(o.after ? {} : { once: "bots.arrival" }), doneDelayMs: CHEER_MS, onComplete: close,
    })];
  }
  // A build without the living tiles: the same steps in a plain card at the top, gone when answered or all done.
  const shown: Condition = { all: [{ falsy: "permitClosed" }, ...(ready ? [ready] : []), ...(done ? [{ not: done }] : [])] };
  return [when(shown, col(steps.filter((st) => !texts(st).includes("You're all set")), { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6 }))];
}

/**
 * KEYBOT'S CARD: the same card in the page, for what is still missing (the microphone, and on a phone the keyboard
 * with Full Access); with everything on, no card at all. The microphone is asked for for real, and once allowed
 * First words opens to try it; refused before, the phone opens the app's page in Settings. A window shows the
 * microphone where it declares DeskMicAsk; its Accessibility stays on its own card (DeskAskSetup), which hides once on.
 */
export function keybotCard(ctx: BotsCtx): Node[] {
  const desk = ctx.client === "desktop";
  const off = desk
    ? toast("The microphone is off for X0 Bot. Turn it on in your computer's Privacy settings.")
    : seq(toast("The microphone is off for X0 Bot. Turn it on in Settings."), { kind: "openSettings", target: "app" } as ActionSpec);
  const ask = {
    kind: "requestPermission", permission: "microphone",
    onGranted: seq(setState("micGranted", true), go(SCREENS.firstWords, FROM_APP)),
    onDenied: seq(setState("micAsked", true), toast("Keylessbord can't hear you yet. Allow the microphone to speak.")),
    onBlocked: seq(setState("micAsked", true), off),
  } as ActionSpec;
  const out: Node[] = [];
  if (desk) {
    if (ctx.can.has("DeskMicAsk")) {
      const steps = [permitStep({
        when: { falsy: "micGranted" }, title: "Let Keylessbord hear you",
        lines: [line("Allow the microphone, then say something to try it.")],
        cta: { label: "Allow microphone", onPress: ask },
      })];
      out.push(when({ falsy: "micGranted" }, canMove(ctx)
        ? botCard(steps, { ...CARD_BOT, kind: "custom", label: "Let Keylessbord hear you" })
        : col(steps, { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper })));
    }
    if (ctx.can.has("DeskAskSetup")) {
      out.push({
        type: "DeskAskSetup",
        props: {
          place: "home", eyebrow: "Keylessbord", title: "Turn on", titleEm: "Accessibility",
          lede: "So Keylessbord can put your words where your cursor is, in any app.",
          on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart X0 Bot to finish", restartButton: "Restart",
          rows: [{ key: "read", title: "Accessibility", sub: "Lets Keylessbord type what you said into the app you're in." }],
        },
      });
    } else if (ctx.can.has(AX_STATE)) {
      // No Ask card here: the same step as the arrival's, while this computer says Accessibility is off.
      const steps = [permitStep({
        when: { falsy: "axGranted" }, title: "Let Keylessbord type for you",
        lines: [line("Allow Accessibility so Keylessbord can put your words where your cursor is, in any app.")],
        cta: { label: "Open Settings", onPress: OPEN_AX },
      })];
      out.push(when({ falsy: "axGranted" }, canMove(ctx)
        ? botCard(steps, { ...CARD_BOT, kind: "custom", label: "Let Keylessbord type for you" })
        : col(steps, { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper })));
    }
    return out;
  }
  const steps = [
    permitStep({
      // The microphone first; refused, it waits behind the keyboard and comes back once the keyboard is on.
      when: { all: [{ falsy: "micGranted" }, { any: [{ falsy: "micAsked" }, KEYS_ON] }] },
      title: "Let Keylessbord hear you",
      lines: [line("Allow the microphone, then say something to try it.")],
      cta: { label: "Allow microphone", onPress: ask },
    }),
    permitStep({
      when: { all: [MIC_SETTLED, KEYS_MISSING] },
      title: "Turn on full access",
      lines: keyboardLines(),
      cta: { label: "Open Settings", onPress: { kind: "openSettings", target: "keyboard" } as ActionSpec },
      quiet: { label: "Show me how", onPress: go(SCREENS.keyOn, FROM_APP) },
    }),
  ];
  // Drawn once the app says something is missing; when it is all on, the bot cheers on "X0 got you!" and the card goes.
  if (canMove(ctx)) {
    return [botCard([...steps, gotYou({ not: SOMETHING_MISSING })], {
      ...CARD_BOT, kind: "custom", label: "Set up Keylessbord",
      readyWhen: SOMETHING_MISSING, doneWhen: { not: SOMETHING_MISSING }, closeWhen: { truthy: "keybotSet" },
      doneDelayMs: CHEER_MS, onComplete: setState("keybotSet", true),
    })];
  }
  return [when(SOMETHING_MISSING, col(steps, { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6 }))];
}

/** Every text in a tree. */
function texts(n: Node): string[] {
  const out: string[] = [];
  const visit = (x: Node) => { if (x.type === "Text" && typeof x.props?.content === "string") out.push(x.props.content); (x.children ?? []).forEach(visit); };
  visit(n);
  return out;
}

// ===================================================================== the list

const q = (o: Record<string, unknown>): string => {
  const parts = Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

export const firstRunScreens: BotsScreen[] = [
  screen({ id: SCREENS.welcome, build: (ctx) => welcomePage(ctx) }),
  screen({ id: SCREENS.signIn, build: (ctx) => signInPage(ctx) }),
  screen({ id: SCREENS.signCode, build: (ctx) => signCodePage(ctx) }),
  screen<Langs>({ id: SCREENS.language, load: (_ctx, deps) => deps.api<Langs>("GET", "/v1/bots/first-run/languages"), build: language }),
  screen<AfterSignIn>({
    id: SCREENS.nameIt,
    load: async (_ctx, deps) => {
      const [me, persona] = await Promise.all([
        deps.api<Me>("GET", "/v1/bots/first-run/profile").catch(() => undefined),
        deps.api<Persona>("GET", "/v1/personality").catch(() => undefined),
      ]);
      return { me, persona };
    },
    build: afterSignIn,
  }),
  screen<Words>({
    id: SCREENS.keyOn,
    load: (_ctx, deps) => deps.api<Words>("GET", "/v1/bots/first-run/words"),
    build: (ctx, w) => (ctx.client === "desktop" ? keyOnDesk(ctx, w) : keyOnPhone(ctx, w)),
  }),
  screen<Words>({
    id: SCREENS.firstWords,
    load: (ctx, deps) => deps.api<Words>("GET", `/v1/bots/first-run/words${q({ w: ctx.params.w, s: ctx.params.s })}`),
    build: firstWords,
  }),
  screen<Plans>({
    id: SCREENS.plans,
    load: (ctx, deps) => deps.api<Plans>("GET", `/v1/bots/first-run/plans${q({ client: ctx.client, ...(ctx.client === "desktop" ? { market: ctx.tzOffsetMinutes === 330 ? "IN" : "world" } : {}) })}`),
    build: plansScreen,
  }),
];
