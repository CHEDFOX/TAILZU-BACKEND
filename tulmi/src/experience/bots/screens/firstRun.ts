/**
 * FIRST RUN: WELCOME, SIGN IN, CODE, LANGUAGES, NAME, TURN ON KEYBOT, FIRST WORDS, PLANS (Welcome, SignIn, SignCode,
 * Language, NameIt, KeyOn, FirstWords, Plans and their D* boards). One id serves the phone and the window (ctx.client).
 *
 * ON THE MACHINERY THAT IS ALREADY THERE, NOT BESIDE IT.
 *
 *   Before the session (Welcome, Sign in, Code) the app draws the bootstrap's `auth.screen`, the only tree that reaches
 *   it before there is an account. With the Bots app on, catalog.buildBootstrap sends `botsAuthTree()` there: these
 *   steps, drawn with the kit, around the sign-in components the gate already runs (SwipePill's field, GoogleSignIn,
 *   AppleSignIn, CodeEntry). The sign-in itself (Supabase OTP, the captcha, Google, Apple, the review address) stays
 *   in AuthGateScreen (phone) and sdui.js's gate (window); this only decides how it looks. The root is an
 *   OnboardStage, the one container both gates already step through (a state change repaints it in the window, and
 *   the flow's phase picks the Code step on both), dressed white with no bar and no Blip of its own.
 *
 *   After it, bots.language is the first screen of someone not onboarded yet (buildBootstrap), and each step leads to
 *   the next: Languages → Name → Turn on Keybot → First words → Plans, which marks the account onboarded
 *   (PUT /v1/profile, as the onboarding's Done does) and lands on Bots.
 *
 * As screens of their own (bots.welcome, bots.sign-in, bots.sign-code) the three sign-in steps are the same layout
 * drawn with the kit only; someone who reaches them is already signed in, so their buttons lead to the gate (sign out)
 * or on to Languages rather than pretending to send a code.
 *
 * Reads: GET /v1/bots/first-run/{languages,words,plans} (routes/botsFirstRun.ts), GET /v1/personality.
 * Writes: PUT /v1/personality (languages, the boss bot's name), PUT /v1/profile { onboarded }, the paywall's own
 * purchase actions (iap.showPaywall / iap.subscribe: RevenueCat on the phone, the pay page in a window).
 */
import type { ActionRef, ActionSpec, Condition, Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import {
  blip, BOTS_THEME, botAvatar, botLook, box, button, C, call, col, divider, FACE, grow, icon, labelled, meta, PALETTE_HEX,
  primaryButton, row, SCREENS, sectionLabel, segmented, seq, shapes, statusMark, tailzuMark, text, title,
  when, type BlipPose, type BotsCtx, type IconName,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

const CLAY = PALETTE_HEX.clay!;
/** The window's setup steps, as its boards list them. */
const STEPS = ["Sign in", "Languages", "Name", "Keybot", "First words", "Plan"];
type Mode = "gate" | "page";
type Style = Record<string, unknown>;

// ===================================================================== words

const W = {
  welcomeH: "Hi, I'm Tailzu.",
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
  langMix: "Mix them freely. Keybot follows how you talk.",
  nameH: "What should I be called?",
  nameP: "I'm the one in charge. Your other bots report to me and call me by this name.",
  keyH: "Turn on Keybot",
  keyP: "Speak instead of type, in every app",
  wordsH: "Now just talk",
  plansH: "Pick a plan",
  saveErr: "Couldn't save that. Try again.",
};

// ===================================================================== small parts

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const toast = (message: string): ActionSpec => ({ kind: "toast", message, tone: "error" } as ActionSpec);
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
    viewBox: "0 0 50 8", width: 50, height: 8, label: "Your first bots: Code bot, Keybot, Plan bot and Travel bot",
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

/** The phone's setup bar: five segments, filled to the step. */
function phoneProgress(step: number): Node {
  return labelled(row(Array.from({ length: 5 }, (_, i) => box([], {
    flexGrow: 1, flexBasis: 0, height: 4, borderRadius: 2, backgroundColor: i < step ? C.ink : C.track,
  })), { width: 116, gap: 4, flexShrink: 0 }), `Setup step ${step} of 5`);
}

/** The phone's top line: back, the bar, and "N of 5" (or what the step puts there). */
function phoneTop(step: number, o: { back?: ActionRef | null; right?: Node } = {}): Node {
  const backTo = o.back === undefined ? back : o.back;
  return row([
    box(backTo ? [chevron(backTo)] : [], { flexGrow: 1, flexBasis: 0, alignItems: "flex-start", minHeight: 44, justifyContent: "center" }),
    phoneProgress(step),
    box([o.right ?? meta(`${step} of 5`, { size: 12 })], { flexGrow: 1, flexBasis: 0, alignItems: "flex-end" }),
  ], { minHeight: 44 });
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
    row([tailzuMark(26), text("Tailzu", { size: 17, weight: 700, tracking: -0.3, lineHeight: 22 })], { gap: 10 }),
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

/** "Step 1 of 5", the title, the line under it (the window's left column). */
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
        height: desktop ? 54 : 56, radius: desktop ? 14 : 16, background: C.paper, borderColor: C.ink, textColor: C.ink,
        placeholderColor: C.idle, fontSize: 17, buttonBackground: C.ink, buttonTextColor: C.paper, buttonHeight: 54, buttonRadius: 27,
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
    // Signed in already, this page's way to sign in is the gate itself.
    primaryButton(W.sendCode, signOut, { wide: true }),
  ], { gap: 14 });
}

/** Google and Apple: the gate's own controls, or the kit's look of them. */
function socialButtons(mode: Mode, o: BotsAuthOpts, h: number): Node[] {
  const label = (p: string) => (h >= 54 ? `Continue with ${p}` : p);
  if (mode === "page") return [outlinePill(googleG(18), label("Google"), signOut, h), outlinePill(appleMark(18), label("Apple"), signOut, h)];
  const google: Node | null = o.googleLink
    ? row([googleG(18), text(label("Google"), { size: h >= 54 ? 16 : 14, weight: h >= 54 ? 600 : 500, lineHeight: 20 })], {
        height: h, borderRadius: h / 2, borderWidth: 1, borderColor: C.outline, justifyContent: "center", gap: 10, alignSelf: "stretch",
      }, seq(setState("googleStarted", true), { kind: "openUrl", url: o.googleLink, external: true }))
    : o.googleHidden ? null : {
        type: "GoogleSignIn",
        props: { size: h, radius: h / 2, background: C.paper, borderWidth: 1, borderColor: C.outline, label: "Continue with Google" },
        style: { width: "100%" },
        children: [row([googleG(18), text(label("Google"), { size: h >= 54 ? 16 : 14, weight: h >= 54 ? 600 : 500, lineHeight: 20 })], { gap: 10 })],
      };
  // Apple's own control (their guidelines): it draws itself, and hides where it cannot serve.
  const apple: Node | null = o.appleHidden ? null : {
    type: "AppleSignIn",
    props: { size: h, radius: h / 2, buttonType: "CONTINUE", buttonStyle: "WHITE_OUTLINE", label: "Continue with Apple" },
    style: { width: "100%" },
  };
  return [google, apple].filter((n): n is Node => !!n);
}

/** Phone or email: the heading, the label and the field follow the way in. */
function byMethod(phone: Node, email: Node): Node[] {
  return [when(BY_PHONE, phone), when(BY_EMAIL, email)];
}

// ----------------------------------------------------------------- Welcome

function welcomePhone(start: ActionRef): { body: Node[]; footer: Node[] } {
  return {
    body: [
      row([tailzuMark(24), text("Tailzu", { size: 16, weight: 700, tracking: -0.3, lineHeight: 20 })], { gap: 8, minHeight: 44 }),
      grow(),
      row([blip("hello", 200)], { justifyContent: "center" }),
      col([
        title(W.welcomeH, { align: "center", lineHeight: 31 }),
        text(W.welcomeP, { size: 15, lineHeight: 22, color: C.grey70, align: "center", style: { maxWidth: 300 } }),
      ], { alignItems: "center", gap: 10, paddingTop: 28, paddingHorizontal: 8 }),
      row([fourDots()], { justifyContent: "center", paddingTop: 22 }),
      { type: "Stack", style: { flexGrow: 1.3, flexShrink: 1 } },
    ],
    footer: [primaryButton(W.start, start, { wide: true }), link(W.haveAccount, start, { center: true })],
  };
}

const FIRST_BOTS: Array<{ slug: string; name: string; line: string }> = [
  { slug: "code", name: "Code bot", line: "Fixes bugs in your code, and asks before anything ships." },
  { slug: "keybot", name: "Keybot", line: "Speak instead of type, in every app." },
  { slug: "plan", name: "Plan bot", line: "Plans your day. Moves things only when you say yes." },
  { slug: "travel", name: "Travel bot", line: "Tickets, refunds and the waiting on hold." },
];

function welcomeDesk(start: ActionRef): DeskOpts {
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
    title: "Welcome", right: meta("6 short steps", { size: 13 }), current: -1,
    left: [
      deskBlip("hello", 200),
      col([title(W.welcomeH, { lineHeight: 31 }), text(W.welcomeP, { size: 15, lineHeight: 22, color: C.grey70, style: { maxWidth: 400 } })], { gap: 6 }),
      row([fourDots(), meta("Free to start · about 2 minutes", { size: 12 })], { gap: 12, paddingTop: 4 }),
    ],
    main: [col([
      row([sectionLabel("Your first bots"), grow(), meta("Each one does one job", { size: 12 })], { paddingTop: 14, paddingHorizontal: 18, paddingBottom: 4, gap: 10 }),
      ...list,
    ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })],
    foot: deskFoot(null, [link(W.haveAccount, start), button(W.start, start, { size: "lg" })]),
  };
}

// ----------------------------------------------------------------- Sign in

function signInPhone(mode: Mode, o: BotsAuthOpts, backTo: ActionRef): Node[] {
  const social = socialButtons(mode, o, 54);
  return [
    chevron(backTo),
    ...byMethod(phoneHeading(W.phoneH, W.phoneP), phoneHeading(W.emailH, W.emailP)),
    ...byMethod(
      col([sectionLabel("Mobile number"), signField(mode, "phone", false)], { gap: 8 }),
      col([sectionLabel("Email"), signField(mode, "email", false)], { gap: 8 }),
    ),
    when({ all: [PHONE_ON, { neq: ["method", "email"] }] }, link("Use email instead", setState("method", "email"), { size: 14, center: true })),
    when({ all: [PHONE_ON, { eq: ["method", "email"] }] }, link("Use your phone number instead", setState("method", "phone"), { size: 14, center: true })),
    ...(social.length ? [orLine(), col(social, { gap: 10 })] : []),
    grow(),
    trustCard(false),
    consent(o.terms, o.privacy),
  ];
}

function signInDesk(mode: Mode, o: BotsAuthOpts, backTo: ActionRef): DeskOpts {
  const social = socialButtons(mode, o, 46);
  const field = (label: string, method: "phone" | "email", hint: string) => col([
    text(label, { size: 13, weight: 500, lineHeight: 17 }),
    signField(mode, method, true),
    meta(hint, { size: 12 }),
  ], { gap: 6 });
  return {
    title: "Sign in", right: meta("About 2 minutes", { size: 13 }), current: 0,
    left: [
      deskBlip("needs", 150),
      ...byMethod(deskHeading("Sign in", W.phoneH, W.phoneP), deskHeading("Sign in", W.emailH, W.emailP)),
      box([trustCard(true)], { maxWidth: 400 }),
    ],
    main: [col([
      when(PHONE_ON, segmented([{ label: "Phone", value: "phone" }, { label: "Email", value: "email" }], "method")),
      ...byMethod(
        field("Mobile number", "phone", "We text you a 6-digit code. Email works too, from the tab above."),
        field("Email", "email", "We email you a 6-digit code."),
      ),
      ...(social.length ? [orLine(), row(social.map((s) => box([s], { flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 8 })] : []),
    ], { padding: 20, gap: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line })],
    foot: deskFoot(deskBack(backTo), [consent(o.terms, o.privacy, "right")]),
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

const smsNote = (): Node => row([icon("notes", { size: 16, color: C.meta }), meta(W.codeNote, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 8 });

function codePhone(mode: Mode): { body: Node[]; footer: Node[] } {
  return {
    body: [
      ...(mode === "page" ? [chevron(back)] : []),
      row([blip("listen", 130)], { justifyContent: "center" }),
      phoneHeading(W.codeH, mode === "gate" ? "The code is on its way." : "Sent by SMS to your number."),
      col([codeEntry(mode, false), smsNote()], { gap: 12 }),
      ...(mode === "page" ? [row([meta("Didn't get it?", { size: 14 }), grow(), link("Wrong number?", back, { size: 14 })], {
        borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 4,
      })] : []),
    ],
    // The code is checked the moment it is complete, so the gate has nothing to press.
    footer: mode === "page" ? [primaryButton("Continue", go(SCREENS.language), { wide: true })] : [],
  };
}

function codeDesk(mode: Mode): DeskOpts {
  return {
    title: "Enter the code", right: meta("About 2 minutes", { size: 13 }), current: 0,
    left: [
      deskBlip("listen", 150),
      deskHeading("Sign in", W.codeH, "Type the 6-digit code we sent you."),
      row([icon("lock", { size: 16, color: C.grey70 }), text("The code is only for this sign-in. Nothing else in your messages is read.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], {
        gap: 10, alignItems: "flex-start", maxWidth: 400,
      }),
    ],
    main: [col([
      col([text("Type the code", { size: 16, weight: 600, lineHeight: 21 }), meta("It comes by SMS or email, from Tailzu.", { size: 13 })], { gap: 3 }),
      codeEntry(mode, true),
      ...(mode === "page" ? [primaryButton("Continue", go(SCREENS.language), { wide: true })] : []),
    ], { padding: 20, gap: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line })],
    ...(mode === "page" ? { foot: deskFoot(deskBack(), [link("Wrong number?", back, { size: 14 })]) } : {}),
  };
}

// ===================================================================== the gate's tree

/** A step of the gate's stage: on the phone a column that fills the step; in a window the whole width, not the stage's narrow column. */
function gateStep(desktop: boolean, kids: Node[], extra: Partial<Node> = {}): Node {
  const style: Style = desktop
    // The stage centres a phone-wide column (460) under a 44 top; the boards are two columns across 1080.
    ? { width: "min(1160px, 100vw)", alignSelf: "center", minHeight: "calc(100vh - 44px)", marginTop: -20, paddingHorizontal: 40, paddingBottom: 26, gap: 22, backgroundColor: C.paper }
    : { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.paper };
  return { type: "Stack", style: { flexDirection: "column", ...style }, children: kids, ...extra };
}

/**
 * Welcome, Sign in and Code for the bootstrap's `auth.screen`, with the Bots app on (catalog.buildBootstrap).
 * All actions are inline: the gate has no action table. Its state: `signing` (Welcome → Sign in) and `method`
 * (phone or email). The flow's phase shows Code (phaseStep), and "Change it" there returns to Sign in.
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
    const wd = welcomeDesk(start), sd = signInDesk("gate", o, toWelcome), cd = codeDesk("gate");
    entry = gateStep(true, [
      when(welcomeOn, col(deskBody(wd), { gap: 22, flexGrow: 1 })),
      when(signOn, col(deskBody(sd), { gap: 22, flexGrow: 1 })),
    ], { props: { stepId: "entry" } });
    code = gateStep(true, deskBody(cd), { props: { stepId: "code" } });
  } else {
    const w = welcomePhone(start);
    const c = codePhone("gate");
    entry = gateStep(false, [
      when(welcomeOn, col([...w.body, col(w.footer, { gap: 6, paddingTop: 8 })], { flexGrow: 1 })),
      when(signOn, col(signInPhone("gate", o, toWelcome), { flexGrow: 1, gap: 18 })),
    ], { props: { stepId: "entry" } });
    code = gateStep(false, [col(c.body, { gap: 18, flexGrow: 1 })], { props: { stepId: "code" } });
  }
  return {
    type: "OnboardStage",
    bind: { step: "step" },
    props: {
      id: "bots.auth", first: 0, of: 2,
      // Sentences, not titles: the capitalising pass leaves them be.
      keepCase: true,
      // White, no bar (it is drawn transparent), no Blip walking (no spot): the boards' pages.
      ground: C.paper,
      progress: { on: "transparent", off: "transparent", height: 1, gap: 0 },
      glide: { slide: 18, outMs: 200, inMs: 260, inDelayMs: 40 },
      phaseStep: { verify: 1, verifying: 1 },
    },
    children: [entry, code],
  };
}

/** The first screen after sign-in for someone not onboarded yet, and every id of the run (the app parks a keyboard tap until they are past). */
export const BOTS_FIRST_RUN_SCREEN = SCREENS.language;
export const BOTS_FIRST_RUN_IDS: string[] = [SCREENS.language, SCREENS.nameIt, SCREENS.keyOn, SCREENS.firstWords, SCREENS.plans];

// ===================================================================== the pages: Welcome, Sign in, Code

const PAGE_AUTH: BotsAuthOpts = { terms: "https://tailzu.space/terms", privacy: "https://tailzu.space/privacy" };

function welcomePage(ctx: BotsCtx): ScreenResponse {
  const start = go(SCREENS.signIn);
  if (ctx.client === "desktop") return deskFrame(ctx, welcomeDesk(start));
  const w = welcomePhone(start);
  return phoneFrame(ctx, { title: "Welcome", body: w.body, footer: w.footer, gap: 0, padTop: 14 });
}

function signInPage(ctx: BotsCtx): ScreenResponse {
  if (ctx.client === "desktop") return deskFrame(ctx, { ...signInDesk("page", PAGE_AUTH, back), state: { method: "phone" } });
  return phoneFrame(ctx, { title: "Sign in", body: signInPhone("page", PAGE_AUTH, back), state: { method: "phone" } });
}

function signCodePage(ctx: BotsCtx): ScreenResponse {
  if (ctx.client === "desktop") return deskFrame(ctx, codeDesk("page"));
  const c = codePhone("page");
  return phoneFrame(ctx, { title: "Enter the code", body: c.body, footer: c.footer });
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
  const next = call("PUT", "/v1/personality", { languages: "$state.langs" }, { ok: go(SCREENS.nameIt), fail: toast(W.saveErr) });
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
      title: "Your languages", right: signedInAs(ctx), current: 1, state,
      left: [
        deskBlip("hello", 150),
        deskHeading("Step 1 of 5", W.langH, W.langP),
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
      foot: deskFoot(null, [button("Continue", cont, { size: "lg" })]),
    });
  }
  return phoneFrame(ctx, {
    title: "Your languages", state, gap: 20,
    // The first screen after sign-in: there is nothing behind it to go back to.
    body: [
      phoneTop(1, { back: null }),
      phoneHeading(W.langH, W.langP),
      col([row([sectionLabel("Languages"), grow(), meta("Pick all that fit", { size: 12 })]), chips], { gap: 10 }),
      row([botAvatar(keybot, 30), text(W.langMix, { size: 15, lineHeight: 21, style: { flexShrink: 1 } })], { gap: 12 }),
      col([
        row([sectionLabel("Live sample"), grow(), row([icon("mic", { size: 14, color: C.meta }), meta("Hinglish", { size: 12 })], { gap: 6 })]),
        text("Aaj 6 baje tak report bhej dena, phir chai pe milte hain.", { size: 17, lineHeight: 25 }),
        meta("Said in one breath. Written the way you'd type it, no switching keyboards.", { size: 12, lineHeight: 17 }),
      ], { paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ],
    footer: [primaryButton("Continue", cont, { wide: true })],
  });
}

// ===================================================================== Name

/** GET /v1/personality, as much as this step reads. */
interface Persona { personality?: { assistantName?: string } }

const NAME_IDEAS = ["Tara", "Mitra", "Chotu", "Jarvis"];

function nameIt(ctx: BotsCtx, data: Persona | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const name = (data?.personality?.assistantName ?? "").trim() || "Tailzu";
  const save = call("PUT", "/v1/personality", { assistantName: "$state.name" }, {
    ok: go(SCREENS.keyOn),
    fail: toast("A name is letters and spaces, up to 24 characters."),
  });
  const input: Node = {
    type: "TextField", id: "name", bind: { value: "name" },
    props: {
      placeholder: "Tailzu", placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0,
      paddingVertical: 0, minHeight: 44, color: C.ink, autoCorrect: false, returnKeyType: "done",
    },
    on: { onSubmit: save },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.medium, fontSize: 17,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  const fieldBox = row([
    input,
    labelled(box([icon("close", { size: 18, color: C.meta })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 }, setState("name", "")), "Clear name"),
  ], { height: desk ? 54 : 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: desk ? 14 : 16, paddingLeft: 16, paddingRight: desk ? 6 : 4 });
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
      bound("name", "Tailzu", { size: desk ? 15 : 14, weight: 600, lineHeight: desk ? 22 : 20 }),
      text(line, { size: desk ? 15 : 14, lineHeight: desk ? 22 : 20 }),
      meta(who, { size: 12 }),
    ], { gap: 2, flexShrink: 1, minWidth: 0 }),
  ], { gap: desk ? 12 : 10, alignItems: "flex-start" });
  const state = { name };

  if (desk) {
    const heads = ctx.live.bots.slice(0, 4);
    return deskFrame(ctx, {
      title: "Name your Tailzu", right: signedInAs(ctx), current: 2, state,
      left: [
        deskBlip("think", 150),
        deskHeading("Step 2 of 5", W.nameH, W.nameP),
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
          box([says("plan", "the dentist can do Friday 10 am. Should I book it?", "Plan bot, reporting to the one in charge")], { paddingVertical: 14, paddingHorizontal: 16 }),
          divider(),
          box([says("travel", "the Goa refund is still with the airline. I'll ask again on Friday.", "Travel bot, in Activity")], { paddingVertical: 14, paddingHorizontal: 16 }),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ],
      foot: deskFoot(deskBack(), [button("That's my name", save, { size: "lg" })]),
    });
  }
  return phoneFrame(ctx, {
    title: "Name your Tailzu", state,
    body: [
      phoneTop(2),
      row([blip("think", 150)], { justifyContent: "center" }),
      phoneHeading(W.nameH, W.nameP),
      col([sectionLabel("Name"), fieldBox, ideas], { gap: 8 }),
      col([sectionLabel("How your bots will say it"), says("plan", "the dentist can do Friday 10 am. Should I book it?", "Plan bot, reporting to the one in charge")], {
        backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10,
      }),
    ],
    footer: [primaryButton("That's my name", save, { wide: true })],
  });
}

// ===================================================================== Turn on Keybot

/** GET /v1/bots/first-run/words: the account's words and audio seconds, all time; with a baseline, what came since. */
interface Words { words: number; seconds: number; typingSeconds: number; totalWords: number; totalSeconds: number }

/** On to First words, with what has been said so far, so First words can count only what is said there. */
const toFirstWords = (w: Words | undefined, replace = false): ActionSpec =>
  go(SCREENS.firstWords, w ? { w: w.totalWords, s: w.totalSeconds } : undefined, replace);

/** The phone's three steps in Settings, each done, in hand, or still to come, from what the phone itself reports. */
function keyOnPhone(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  // iPhone's words unless the phone says it is an Android one.
  const android: Condition = { platform: "android" };
  const ios: Condition = { not: android };
  const ready: Condition = { truthy: "keyboardReady" };
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
      phoneTop(3, { right: link("Not now", go(SCREENS.plans), { size: 14, color: C.grey70 }) }),
      row([botAvatar(botLook("keybot"), 52), col([title(W.keyH, { lineHeight: 31 }), meta(W.keyP, { size: 13 })], { gap: 3, flexShrink: 1 })], { gap: 14 }),
      col([
        col([
          row([when(ios, meta("In your iPhone Settings", { size: 12 })), when(android, meta("In your phone's Settings", { size: 12 })), grow(), ...stepOf]),
          row([seg(0), seg(1), seg(2)], { gap: 4 }),
        ], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6, gap: 8 }),
        step(0, { ios: "Open Settings", android: "Open Settings" }),
        divider(),
        step(1, { ios: "Keyboards, then switch on Tailzu", android: "Switch on Tailzu, and tap OK" }, [when(ios, chipPath("Settings › Tailzu › Keyboards"))]),
        divider(),
        step(2, { ios: "Allow Full Access", android: "Come back here" }, [
          when(ios, meta("Turn the switch on, then come back here", { size: 12 })),
          when(android, meta("Keybot takes it from there", { size: 12 })),
        ]),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      when(ios, col([
        text("Why full access?", { size: 14, weight: 600, lineHeight: 19 }),
        row([icon("mic", { size: 16, color: C.grey70 }), text("Keybot needs the internet to turn your voice into text. Full Access is what lets a keyboard reach it.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
        row([icon("lock", { size: 16, color: C.grey70 }), text("It only listens while you hold the mic key.", { size: 13, lineHeight: 19, color: C.grey70, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }),
      ], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10 })),
    ],
    footer: [
      when({ all: [ios, { not: ready }] }, primaryButton("Open Settings", openIos, { wide: true })),
      when({ all: [android, { not: ready }] }, primaryButton("Open Settings", openAndroid, { wide: true })),
      when(ready, primaryButton("Continue", toFirstWords(w), { wide: true })),
      when({ all: [ios, { not: ready }] }, meta("Opens Tailzu in Settings. Come back here when it's on.", { size: 12, align: "center" })),
      when({ all: [android, { not: ready }] }, meta("Opens your keyboards. Come back here when it's on.", { size: 12, align: "center" })),
      when(ready, meta("Keybot is on. Hold its mic key in any app.", { size: 12, align: "center" })),
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
          place: "settings", on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart Tailzu to finish", restartButton: "Restart",
          rows: [{ key: "read", title: "Accessibility", sub: "So Keybot can put the words where your cursor is, in any app." }],
        },
      }], { paddingHorizontal: 4, paddingBottom: 4 })
    : permRow("computer", "Accessibility", "If your Mac asks, allow Tailzu in Privacy & Security › Accessibility, so Keybot can type where your cursor is.", null);
  return deskFrame(ctx, {
    title: W.keyH, current: 3,
    right: link("Not now", go(SCREENS.plans), { size: 14, color: C.grey70 }),
    left: [
      deskBlip("needs", 140),
      deskHeading("Step 3 of 5", W.keyH, "Speak instead of type, in every app."),
      col([
        text("Why these two?", { size: 14, weight: 600, lineHeight: 19 }),
        why("mic", "The mic is on only while you hold the key. It never listens otherwise."),
        why("lock", "Keybot types only where your cursor is, and only what you said."),
      ], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 10, maxWidth: 400 }),
    ],
    main: [
      col([
        box([meta("In this computer's settings", { size: 12 })], { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 4 }),
        permRow("mic", "Microphone", "So Keybot hears you while you hold the key. Your computer asks the first time.", null),
        divider(),
        access,
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      col([
        row([sectionLabel("Key to hold while you speak"), grow(), meta("Change it later in Settings", { size: 12 })], { gap: 10 }),
        keys
          ? row([{ type: "Keys", props: { source: "hotkey" } }, text("Hold it in any app, speak, let go.", { size: 14, lineHeight: 19, color: C.grey70 })], { gap: 12, flexWrap: "wrap" })
          : text("Hold your Keybot key in any app, speak, let go.", { size: 14, lineHeight: 19, color: C.grey70 }),
      ], { padding: 16, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line }),
    ],
    foot: deskFoot(deskBack(), [
      meta("Allowed? Carry on and say something.", { size: 12, style: { maxWidth: 200 }, align: "right" }),
      button("Continue", toFirstWords(w), { size: "lg" }),
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

/** The practice box: whatever Keybot writes into it stays on this page. */
function practiceField(desk: boolean): Node {
  return {
    type: "TextField", id: "said", bind: { value: "said" },
    props: {
      placeholder: desk ? "Click here, then hold your key and speak" : "Hold the clay key and speak. Your words land here.", placeholderColor: C.idle,
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
 * The keyboard of the phone's board, with Keybot's clay key. On a phone that has it, the clay key IS the mic: hold it
 * and speak (the app's own VoiceButton, as the onboarding's Try it uses: /v1/transcribe-clean, which counts the words
 * and the seconds), and the words land in the box above; then the numbers are worked out again.
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
  ], { backgroundColor: C.surface, borderRadius: 22, paddingTop: 10, paddingHorizontal: 8, paddingBottom: 12, gap: 8 }), mic ? "Keyboard: hold the clay key to speak" : "Keyboard with the clay Keybot mic key");
}

/** The clay key as the app's own hold-to-speak button (a build that has one: it says "VoiceButton"). */
function clayMic(after: ActionRef): Node {
  return {
    type: "VoiceButton",
    bind: { value: "said", state: "mic" },
    props: {
      hold: true, radius: 7, background: CLAY, recordingBackground: CLAY, paddingVertical: 0, label: "", stopLabel: "", transcribingLabel: "",
      accessibilityLabel: "Hold to speak",
    },
    style: { height: 38, flexGrow: 1.1, flexBasis: 0, alignItems: "center", justifyContent: "center", paddingVertical: 0 },
    on: { onChange: after, onError: toast("Couldn't hear that. Hold the key and try again.") },
    children: [icon("mic", { size: 18, color: C.paper })],
  };
}

function firstWords(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));
  const baseW = num(ctx.params.w) ?? w?.totalWords;
  const baseS = num(ctx.params.s) ?? w?.totalSeconds;
  const said = typeof ctx.params.said === "string" ? ctx.params.said : "";
  // The numbers are worked out on the server from the account's own usage since this step opened; this asks again.
  const check: ActionSpec = go(SCREENS.firstWords, { ...(baseW !== undefined ? { w: baseW } : {}), ...(baseS !== undefined ? { s: baseS } : {}), said: "$state.said" }, true);
  const result = spoken(w, desk);
  const nothingYet = col([
    meta("Your words, and how long they took, show here once you've spoken.", { size: 13, lineHeight: 18 }),
    when({ truthy: "said" }, button("How fast was that?", check, { kind: "secondary", size: "md" })),
  ], { gap: 10 });
  const next = button(result ? "Nice, next" : "Next", go(SCREENS.plans), { size: "lg", wide: !desk });
  const state = { said };

  if (desk) {
    return deskFrame(ctx, {
      title: W.wordsH, right: signedInAs(ctx), current: 4, state,
      left: [
        deskBlip("listen", 140),
        deskHeading("Step 4 of 5", W.wordsH, "Hold your key and say anything, in any mix."),
        box([result ?? nothingYet], { maxWidth: 400 }),
      ],
      main: [col([
        row([
          row([0, 1, 2].map(() => box([], { width: 11, height: 11, borderRadius: 6, backgroundColor: C.outline })), { gap: 7 }),
          grow(), meta("Try it here", { size: 13 }), grow(), box([], { width: 47 }),
        ], { height: 40, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.divider }),
        col([
          meta("Just for practice. Keybot writes what you say here.", { size: 12 }),
          box([practiceField(true)], { borderWidth: 1.5, borderColor: C.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, minHeight: 118 }),
          ctx.can.has("DeskShell")
            ? row([{ type: "Keys", props: { source: "hotkey" } }, meta("Hold, speak, let go to drop the words in.", { size: 12 })], { gap: 8, justifyContent: "center", flexWrap: "wrap" })
            : meta("Hold your key, speak, let go to drop the words in.", { size: 12, align: "center" }),
          ...(result ? [when({ truthy: "said" }, row([button("Count again", check, { kind: "quiet", size: "md" })], { justifyContent: "center" }))] : []),
        ], { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }),
      ], { borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper })],
      foot: deskFoot(deskBack(), [next]),
    });
  }
  return phoneFrame(ctx, {
    title: W.wordsH, state, gap: 16,
    body: [
      phoneTop(4),
      phoneHeading(W.wordsH, "Hold the clay key and say anything, in any mix.", 6),
      col([
        box([blip("listen", 140)], { position: "absolute", top: 0, right: 22 }),
        col([
          row([icon("mic", { size: 14, color: CLAY }), meta("Keybot writes here", { size: 12 })], { gap: 8 }),
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
    id: string; label: string; price: string; per: string; note?: string; badge?: string; trialDays?: number; default?: boolean;
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
  const top = desk ? null : phoneTop(5);
  const doneHeading = (h: string, sub: string): Node[] => desk ? [deskBlip("done", 140), deskHeading("Step 5 of 5", h, sub)] : [top!, phoneHeading(h, sub, 6)];
  // Nothing to choose: free for everyone, already paying, or the plans could not be read. Say so, and go in.
  const simple = (h: string, sub: string, cta: string): ScreenResponse => desk
    ? deskFrame(ctx, { title: W.plansH, right: signedInAs(ctx), current: 5, left: doneHeading(h, sub), main: [], foot: deskFoot(deskBack(), [button(cta, finish(), { size: "lg" })]) })
    : phoneFrame(ctx, { title: W.plansH, body: [...doneHeading(h, sub), row([blip("done", 160)], { justifyContent: "center", paddingTop: 20 })], footer: [primaryButton(cta, finish(), { wide: true })] });
  if (!data) return simple("You're set up", "Plans couldn't load just now. You can pick one any time from You.", "Start using Tailzu");
  if (data.freeForAll) return simple("You're set up", "Tailzu is free for everyone right now. Nothing to pick, nothing to pay.", "Start using Tailzu");
  if (data.entitled) return simple("You're set up", "This account already has a plan. It covers your phone and your computer.", "Start using Tailzu");
  const paid = data.plans;
  if (!paid.length) return simple("You're set up", "You're on Free. Plans to buy aren't available here yet; you can pick one later from You.", "Start using Tailzu");

  const chosen = (paid.find((p) => p.default) ?? paid[0]!).id;
  const isOn = (id: string): Condition => ({ eq: ["plan", id] });
  const sel = (id: string, then: unknown, otherwise: unknown) => ({ ...isOn(id), then, else: otherwise });
  const freeLine = `Keybot, ${data.freeWords.toLocaleString("en-IN")} words a month`;
  const buyAction = (p: Plans["plans"][number]): ActionRef | undefined => {
    if (!p.buy) return undefined;
    const failed = toast("Couldn't complete the purchase. Nothing was charged.");
    // The window has no store: the pay page opens in the browser, and the account is ready when they come back.
    if (desk) return seq(p.buy as ActionSpec, finish());
    return { ...p.buy, onSuccess: seq({ kind: "toast", message: "You're in.", tone: "success" } as ActionSpec, finish()), onError: failed } as ActionSpec;
  };
  const radio = (id: string): Node => box([when(isOn(id), box([], { width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink }))], {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: sel(id, C.ink, C.outline), alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
  const feature = (lead: Node, line: string): Node => row([lead, text(line, { size: 14, lineHeight: 19, style: { flexShrink: 1 } })], { gap: 10 });
  const tag = (s: string): Node => box([text(s, { size: 12, weight: 500, lineHeight: 16 })], { backgroundColor: C.surface, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 });
  const keyHead = botAvatar(botLook("keybot"), 22);
  const planCard = (id: string, name: string, price: Node, extra: Node[], per: string, lines: Node[]): Node => col([
    row([radio(id), text(name, { size: 17, weight: 600, lineHeight: 22 }), ...extra, grow(), price], { gap: 10 }),
    ...(per ? [meta(per, { size: 12, style: { paddingLeft: 32, marginTop: -8 } })] : []),
    col(lines, { gap: 8, paddingLeft: 32 }),
  ], {
    paddingVertical: 14, paddingHorizontal: 16, gap: 12, borderRadius: 18, borderWidth: sel(id, 1.5, 1), borderColor: sel(id, C.ink, C.line),
  }, setState("plan", id));
  const tick = (): Node => box([icon("check", { size: 14 })], { width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" });
  const cards = [
    planCard("free", "Free", text("₹0", { size: 17, weight: 700, lineHeight: 22 }), [], "", [feature(keyHead, freeLine)]),
    ...paid.map((p) => planCard(p.id, p.label, text(p.price, { size: 17, weight: 700, lineHeight: 22 }), [
      ...(p.trialDays ? [tag(`${p.trialDays} days free`)] : p.badge ? [tag(p.badge)] : []),
    ], p.per, [
      feature(keyHead, "Unlimited Keybot"),
      // The rest of what it adds, on the plan in hand (the paywall's own words).
      when(isOn(p.id), col([
        ...data.features.map((f) => feature(tick(), f)),
        ...(p.note && !p.trialDays ? [meta(p.note, { size: 12 })] : []),
      ], { gap: 8 })),
    ])),
  ];
  /** What a trial costs, day by day: nothing today, the price when it ends. */
  const trial = (p: Plans["plans"][number]): Node | null => p.trialDays ? when(isOn(p.id), col([
    text(`Try ${p.label} free for ${p.trialDays} days. Cancel any time before it ends and you pay nothing.`, { size: 14, lineHeight: 20 }),
    row([
      col([meta("Today", { size: 12 }), text("₹0", { size: 13, weight: 600, lineHeight: 17 })], { gap: 2, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0 }),
      col([meta(dayAfter(ctx.live.now, ctx.tzOffsetMinutes, p.trialDays), { size: 12 }), text(`Then ${p.price}`, { size: 13, weight: 600, lineHeight: 17 })], {
        gap: 2, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0, borderLeftWidth: 1, borderLeftColor: C.track,
      }),
    ], { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 10 }),
  ], { gap: 10 })) : null;
  const trials = paid.map(trial).filter((n): n is Node => !!n);
  const ctaFor = (p: Plans["plans"][number]): string =>
    p.trialDays ? (p.trialDays === 7 ? "Start free week" : `Start ${p.trialDays} free days`) : `Choose ${p.label}`;
  const ctas: Node[] = [
    when(isOn("free"), button("Continue on Free", finish(), { size: "lg", wide: !desk })),
    ...paid.map((p) => when(isOn(p.id), button(ctaFor(p), buyAction(p), { size: "lg", wide: !desk, ...(p.buy ? {} : { kind: "disabled" }) }))),
  ];
  const stay = when({ neq: ["plan", "free"] }, link("Stay on Free", finish(), { center: true }));
  const sub = "Start today. Switch any time from You.";
  const fine = desk
    ? "You pay in your browser. Nothing is charged until you confirm there."
    : "Your phone's store shows the final price before you pay.";
  const state = { plan: chosen };

  if (desk) {
    return deskFrame(ctx, {
      title: W.plansH, right: signedInAs(ctx), current: 5, state,
      left: [...doneHeading(W.plansH, sub), ...(trials.length ? [box(trials, { maxWidth: 400 })] : []), meta(fine, { size: 12, style: { maxWidth: 400 } })],
      main: [col(cards, { gap: 12 })],
      foot: deskFoot(deskBack(), [stay, ...ctas]),
    });
  }
  return phoneFrame(ctx, {
    title: W.plansH, state, gap: 16,
    body: [...doneHeading(W.plansH, sub), col(cards, { gap: 12 }), ...trials],
    footer: [...ctas, stay, meta(fine, { size: 11, align: "center" })],
  });
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
  screen<Persona>({ id: SCREENS.nameIt, load: (_ctx, deps) => deps.api<Persona>("GET", "/v1/personality"), build: nameIt }),
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
