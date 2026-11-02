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
 * Reads: GET /v1/bots/first-run/{profile,languages,words,plans} (routes/bots/botsFirstRun.ts), GET /v1/personality.
 * Writes: PUT /v1/profile { full_name, gender }, PUT /v1/personality (languages, the boss bot's name), PUT /v1/profile
 * { onboarded }, the paywall's own purchase actions (iap.showPaywall / iap.subscribe: RevenueCat on the phone, the pay
 * page in a window).
 */

import type { ActionSpec, Node, ActionRef, Condition, ScreenResponse } from "../../../../../shared/types/sdui.js";
import {
  PALETTE_HEX, shapes, C, row, text, box, meta, botLook, botAvatar, tailzuMark, col, FACE, icon, primaryButton, SCREENS, seq, when, grow,
  title, type IconName, divider, sectionLabel, button, segmented, type BotsCtx,
} from "../kit.js";
import { type BotsScreen, screen } from "../registry.js";
import { onStage, stageNode, stageScreen, figureFor, type AfterSignIn, type Persona, afterSignIn } from "./firstRun/afterSignIn.js";
import { firstWords } from "./firstRun/firstWords.js";
import { keyOnDesk, keyOnPhone } from "./firstRun/keyStep.js";
import { type Langs, language } from "./firstRun/language.js";
import {
  CLAY, W, go, setState, type Figure, link, type DeskOpts, STEPS, deskFig, deskFoot, chevron, phoneHeading, deskHeading, deskBack, back,
  gateStep, deskBody, phoneStepBody, type Me, type Words,
} from "./firstRun/parts.js";
import { type Plans, plansScreen } from "./firstRun/plansScreen.js";

type Mode = "gate" | "page";

const signOut = { kind: "signOut" } as ActionSpec;

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
