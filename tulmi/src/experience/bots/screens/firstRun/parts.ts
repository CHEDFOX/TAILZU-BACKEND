/**
 * What several of the first run's screens share.
 */

import {
  type Node, type ActionSpec, type ActionRef, type ScreenResponse, SDUI_SCHEMA_VERSION, type Condition,
} from "../../../../../../shared/types/sdui.js";
import {
  PALETTE_HEX, labelled, box, icon, row, C, text, type BlipPose, blip, meta, grow, col, type BotsCtx, BOTS_THEME, SCREENS,
  tailzuMark, title, FACE, when, primaryButton,
} from "../../kit.js";

export const CLAY = PALETTE_HEX.clay!;
export type Style = Record<string, unknown>;

// ===================================================================== words

export const W = {
  welcomeH: "Hi, I'm X0.",
  welcomeP: "Everything here is a bot. Tell them what you need; they do the work.",
  start: "Start",
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
  restore: "Restore Purchases",
  restoreDone: "Restore finished. If a plan was bought with this Apple ID or Google account, it's active again.",
  restoreErr: "Couldn't restore just now. Try again in a moment.",
  keyH: "Turn on Keylessbord",
  keyP: "Speak instead of type, in every app",
  wordsH: "Now just talk",
  plansH: "Pick a plan",
  saveErr: "Couldn't save that. Try again.",
};

/** The name and gender card's choices, as PUT /v1/profile takes them. */
export const GENDERS: Array<{ value: string; label: string }> = [{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }];

// ===================================================================== Blip, one for the whole run

/** The poses Blip takes in the run: the walker's own names (blip.js, the phone's blipFigure). */
export type Pose = "wave" | "listen" | "wait" | "think" | "present" | "tada";

/** Blip in a step: where the stage's one Blip stands (a BlipSpot), or, with no stage, his picture. */
export type Figure = (pose: Pose, h: number) => Node;

// ===================================================================== small parts
export const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
export const toast = (message: string): ActionSpec => ({ kind: "toast", message, tone: "error" } as ActionSpec);
/** A short ink toast for a write that went through. */
export const saved = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
export const go = (screenId: string, params?: Record<string, unknown>, replace = false): ActionSpec =>
  ({ kind: "navigate", screenId, ...(params ? { params } : {}), ...(replace ? { replace: true } : {}) });
export const back: ActionSpec = { kind: "navigateBack" };

/** The phone's back chevron: 44 x 44, pulled 10 left. */
export const chevron = (onPress: ActionRef): Node =>
  labelled(box([icon("back", { size: 22 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), "Back");

/** The window's "‹ Back". */
export const deskBack = (onPress: ActionRef = back): Node =>
  row([icon("back", { size: 18, color: C.grey70 }), text("Back", { size: 14, color: C.grey70, lineHeight: 18 })], { minHeight: 44, gap: 4, paddingRight: 8, marginLeft: -6 }, onPress);

/** A link: ink words, 44 tall. */
export const link = (label: string, onPress: ActionRef, o: { size?: number; color?: string; center?: boolean } = {}): Node =>
  row([text(label, { size: o.size ?? 15, weight: 500, color: o.color ?? C.ink, lineHeight: 20 })], {
    minHeight: 44, ...(o.center ? { justifyContent: "center" } : {}),
  }, onPress);

/** Blip's whole body, set against the left edge as the window's boards place him. */
export const deskBlip = (pose: BlipPose, h: number): Node => box([blip(pose, h)], { alignSelf: "flex-start", marginLeft: -10 });

/** A pushed page's top line on the phone: back, and something on the right. */
export function phoneBackLine(right?: Node, backTo: ActionRef = back): Node {
  return row([chevron(backTo), grow(), ...(right ? [right] : [])], { minHeight: 44 });
}

// ===================================================================== frames

export function respond(ctx: BotsCtx, titleText: string, root: Node, state: Record<string, unknown> = {}, actions?: Record<string, ActionSpec>): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION, screenId: ctx.screenId, title: titleText, hideChrome: true, look: "bots",
    // Never kept: the first run and the plans are read fresh. Language is a settings page now (Keylessbord's), kept as
    // the kit keeps those (kit.ts STEADY): a choice of the person's, and their own change drops it.
    theme: BOTS_THEME, cacheTtlSeconds: ctx.screenId === SCREENS.language ? 600 : 0, state: { ask: "", asking: false, ...state }, ...(actions ? { actions } : {}), root,
  };
}

interface PhoneOpts { title: string; body: Node[]; footer?: Node[]; state?: Record<string, unknown>; gap?: number; padTop?: number }

/** The phone's first-run page: white, 20 at the sides, the body scrolls and can push things down, the footer stays. */
export function phoneFrame(ctx: BotsCtx, o: PhoneOpts): ScreenResponse {
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

export interface DeskOpts {
  title: string;
  /** Top right: "About a minute", "Signed in as …", Not now. */
  right?: Node | null;
  left: Node[];
  main: Node[];
  foot?: Node;
  state?: Record<string, unknown>;
}

/** The window's header: the mark and Tailzu, and something on the right. */
export function deskHeader(right: Node | null): Node {
  return row([
    row([tailzuMark(26), text("X0 Bot", { size: 17, weight: 700, tracking: -0.3, lineHeight: 22 })], { gap: 10 }),
    grow(),
    ...(right ? [right] : []),
  ], { minHeight: 44, gap: 12, width: "100%", maxWidth: 1080, alignSelf: "center" });
}

/** The window's two columns: Blip and the words on the left, the thing to do on the right. */
export function deskBody(o: DeskOpts): Node[] {
  return [
    deskHeader(o.right ?? null),
    row([
      // Bases as lengths: the window reads a bare number in a flex property as a ratio.
      col(o.left, { flexGrow: 1, flexShrink: 1, flexBasis: "300px", minWidth: 0, gap: 16 }),
      col([...o.main, ...(o.foot ? [o.foot] : [])], { flexGrow: 1.45, flexShrink: 1, flexBasis: "500px", minWidth: 0, gap: 14 }),
    ], { flexGrow: 1, width: "100%", maxWidth: 1080, alignSelf: "center", alignItems: "center", flexWrap: "wrap", columnGap: 56, rowGap: 30 }),
  ];
}

/** The window's first-run page: no sidebar yet, the whole window, scrolling when it is short. */
export function deskFrame(ctx: BotsCtx, o: DeskOpts): ScreenResponse {
  const inner = col(deskBody(o), { minHeight: "100%", paddingTop: 24, paddingHorizontal: 40, paddingBottom: 26, gap: 22 });
  return respond(ctx, o.title, col([inner], { height: "100%", overflowY: "auto", backgroundColor: C.paper }), o.state);
}

/** The window's footer row: Back on the left, the rest on the right. */
export const deskFoot = (left: Node | null, right: Node[]): Node =>
  row([left ?? box([]), row(right, { gap: 18, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", flexShrink: 1 })], {
    justifyContent: "space-between", flexWrap: "wrap", gap: 12, paddingTop: 2,
  });

/** "Step 1 of 2" (or the page it is), the title, the line under it (the window's left column). */
export const deskHeading = (kicker: string, h: string, sub: string): Node =>
  col([meta(kicker, { size: 13, lineHeight: 17 }), title(h, { lineHeight: 31 }), text(sub, { size: 15, lineHeight: 22, color: C.grey70, style: { maxWidth: 400 } })], { gap: 6 });

/** The phone's title and the line under it. */
export const phoneHeading = (h: string, sub: string, gap = 8): Node =>
  col([title(h, { lineHeight: 31 }), text(sub, { size: 15, lineHeight: 22, color: C.grey70 })], { gap });

/** Who is signed in, for the window's header. */
export const signedInAs = (ctx: BotsCtx): Node | null => {
  const who = ctx.user?.email ?? ctx.user?.name;
  return who ? meta(`Signed in as ${who}`, { size: 13, lines: 1 }) : null;
};

/** Blip in the window's left column, set against its edge as the boards place him. */
export const deskFig = (fig: Figure, pose: Pose, h: number): Node => box([fig(pose, h)], { alignSelf: "flex-start", marginLeft: -10 });

// ===================================================================== the stage

/**
 * A step of a stage: on the phone a column that fills the step (the stage gives it the safe area); in a window the
 * whole width, not the stage's narrow column.
 */
export function gateStep(desktop: boolean, kids: Node[], extra: Partial<Node> = {}): Node {
  const style: Style = desktop
    // The stage centres a phone-wide column (460) under a 44 top; the boards are two columns across 1080.
    ? { width: "min(1160px, 100vw)", alignSelf: "center", minHeight: "calc(100vh - 44px)", marginTop: -20, paddingHorizontal: 40, paddingBottom: 26, gap: 22, backgroundColor: C.paper }
    : { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: C.paper };
  return { type: "Stack", style: { flexDirection: "column", ...style }, children: kids, ...extra };
}

/** A phone step's content: its body, then its footer at the foot of the step. */
export const phoneStepBody = (body: Node[], footer: Node[], gap = 18): Node =>
  col([...body, ...(footer.length ? [grow(), col(footer, { gap: 6, paddingTop: 8 })] : [])], { flexGrow: 1, gap });

/** GET /v1/bots/first-run/profile (routes/bots/botsFirstRun.ts). */
/** GET /v1/bots/first-run/about: the About you card (aboutCard.ts), due after a few visits while the answer is owed. */
export interface About { due: boolean; name: string; via: string; source: "saved" | "provider" | "email" | null; gender: string | null; botName?: string }

/** A text field in the boards' look: the ink outline, the clear button. */
export function nameField(path: string, placeholder: string, onSubmit: ActionRef, desk: boolean, o: { capitalize?: boolean; label: string; height?: number }): Node {
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
  ], { height: o.height ?? (desk ? 54 : 56), borderWidth: 1.5, borderColor: C.ink, borderRadius: desk ? 14 : 16, paddingLeft: 16, paddingRight: desk ? 6 : 4 });
}

// ===================================================================== Turn on Keylessbord

/** GET /v1/bots/first-run/words: the account's words and audio seconds, all time; with a baseline, what came since. */
export interface Words { words: number; seconds: number; typingSeconds: number; totalWords: number; totalSeconds: number }

/** Said by the pages in the app that open Keylessbord's setup, so its way out can be back to them (`leave`). */
export const FROM_APP = { from: "app" } as const;
export const fromApp = (ctx: BotsCtx): boolean => ctx.params.from === "app";

/**
 * Out of Keylessbord's setup (Turn on Keylessbord, then Now just talk): back to the page in the app that opened it. Opened by a
 * link instead (the keyboard's "Tap to set it up", a widget, the setup list) it is the app's only page, and back has
 * nowhere to go: so it is Home.
 */
export const leave = (ctx: BotsCtx): ActionSpec => (fromApp(ctx) ? back : go(SCREENS.home, undefined, true));

/** A window that reads this computer's Accessibility into $state.axGranted (TAILZU-DESKTOP sdui.js axFollow). */
export const AX_STATE = "DeskAxState";
/** The window's own action (sdui.js, declared with its Ask card's): the main process opens the Mac's Accessibility page. */
export const OPEN_AX = { kind: "ask.openAccessibility" } as unknown as ActionSpec;

export const MIC_SETTLED: Condition = { any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] };
// An iPhone only learns Full Access once the keyboard has been opened (only the keyboard can read it), so there the
// keyboard switched on is enough for the card; the keyboard asks for Full Access itself if it is still off.
export const KEYS_ON: Condition = { all: [{ truthy: "keyboardEnabled" }, { any: [{ truthy: "keyboardReady" }, { platform: "ios" }] }] };
export const KEYS_MISSING: Condition = { not: KEYS_ON };

/** The bot on the permission cards: neutral, ink grey (the cards carry no bot's colour). */
export const CARD_BOT = { color: C.grey70, stageHeight: 128 } as const;

/** One step of the card: monochrome, ink on white; one black pill, and a quiet second choice under it. */
export function permitStep(o: { when: Condition; title: string; lines: Node[]; cta?: { label: string; onPress: ActionRef }; quiet?: { label: string; onPress: ActionRef }; extra?: Node[] }): Node {
  return when(o.when, col([
    col([text(o.title, { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), ...o.lines], { gap: 6 }),
    ...(o.extra ?? []),
    ...(o.cta || o.quiet ? [col([
      ...(o.cta ? [primaryButton(o.cta.label, o.cta.onPress, { wide: true })] : []),
      ...(o.quiet ? [labelled(row([text(o.quiet.label, { size: 15, weight: 500, color: C.meta, lineHeight: 20 })], { minHeight: 44, justifyContent: "center", alignSelf: "stretch" }, o.quiet.onPress), o.quiet.label)] : []),
    ], { gap: 4, marginTop: 6 })] : []),
  ], { paddingHorizontal: 22, paddingTop: 16, paddingBottom: o.quiet ? 10 : 22, gap: 12 }));
}

export const line = (s: string): Node => text(s, { size: 14, color: C.grey70, lineHeight: 20 });

/** The card's last step, once everything is on: its words give way to one short line while the bot cheers, then it goes. */
export const gotYou = (whenOn: Condition): Node =>
  when(whenOn, row([text("X0 got you!", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { justifyContent: "center", paddingTop: 18, paddingBottom: 26 }));
/** How long the bot cheers on that line before the card goes. */
export const CHEER_MS = 2800;

/** The keyboard step's words: iPhone and Android each say where the switch is. */
export function keyboardLines(): Node[] {
  const android: Condition = { platform: "android" };
  return [
    when({ not: android }, line("In Settings, open Keyboards, switch on X0 Bot, then Allow Full Access.")),
    when(android, line("Switch on X0 Bot in your keyboards, and tap OK.")),
  ];
}
