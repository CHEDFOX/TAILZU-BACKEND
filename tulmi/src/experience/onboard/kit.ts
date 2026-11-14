/**
 * The onboarding's parts: its look, the stage and Blip's spot, headings, text, buttons and icons.
 */

import type { ConnectorInfo } from "../../../../shared/types/api.js";
import type { ActionSpec, ActionRef, Condition, Node } from "../../../../shared/types/sdui.js";
import { en } from "../../connectors/words.js";
import { type ObKey, EN } from "./copy.js";

export type Style = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------

/**
 * Every colour, face and measure of the new onboarding, as literals in the
 * tree (the way assistant.ts does), so neither the app's theme nor the sign-in
 * theme changes. What the persistent bot needs (ground, progress bar, bubble,
 * his own colours, the glide) travels as props on the stage, so his overlay
 * holds no colours of its own.
 */
export const OB = {
  paper: "#EFEDE8", card: "#F6F5F1", surf: "#FCFBF8", white: "#FFFFFF",
  ink: "#1C1A17", ink2: "rgba(28,26,23,0.7)", muted: "rgba(28,26,23,0.56)", hair: "rgba(28,26,23,0.13)",
  neon: "#39FF14", neonSoft: "rgba(57,255,20,0.2)", neonLine: "rgba(57,255,20,0.6)",
  ti1: "#8D8983", ti2: "#BDB9B2", ti3: "#DAD6CF",
  /** Blip's pale dots and his ink edge. */
  dot: "#F3E2C6", sticker: "#151311",
  /** PHONE_FONT.grotesk and .hand: Bricolage Grotesque 800 and Kalam. */
  grotesk: "Tailzu Grotesk", hand: "Tailzu Hand",
  /** The one switch for the step headings' face (the prototype's phone frame draws them in the system face). */
  headingFont: "Tailzu Grotesk",
  side: 20,
} as const;

/**
 * The icons, each as ONE path (the SVG node takes one): the prototype's, with
 * its rectangles written as arc paths.
 */
export const IC = {
  mic: "M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  lock: "M7.5 10.5h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-5a2.5 2.5 0 0 1 2.5-2.5zM8 10.5V8a4 4 0 0 1 8 0v2.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  mail: "M6 5.5h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3zM3.8 7.5l8.2 6 8.2-6",
  clock: "M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0zM12 7.5V12l3 2",
  chev: "M6 9l6 6 6-6",
  g: "M17.66 6.34A8 8 0 1 0 20 12h-8",
  eye: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
} as const;

export const words = en;

/** The stage moves only through setState: the desktop has no incrementState. */
export const SET = (i: number): ActionSpec => ({ kind: "setState", path: "step", value: i });
export const seq = (...actions: ActionRef[]): ActionSpec => ({ kind: "sequence", actions });
export const haptic = (style: "selection" | "success"): ActionSpec => ({ kind: "haptic", style });
export const toast = (message: string, tone: "info" | "error" = "info"): ActionSpec => ({ kind: "toast", message, tone });
export const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
export const when = (cond: Condition, then: ActionRef, otherwise?: ActionRef): ActionSpec =>
  ({ kind: "condition", if: cond, then, ...(otherwise !== undefined ? { else: otherwise } : {}) });
export const bothPerms: Condition = { all: [{ truthy: "perm.n" }, { truthy: "perm.m" }] };

export const nodes = (kids: Array<Node | null | false | undefined>): Node[] => kids.filter((k): k is Node => !!k);

/**
 * A style value that follows state: the app resolves `{<condition>, then, else}`
 * live, on every redraw. Typed as the string it stands for, because that is the
 * slot it fills.
 */
export const IF = (cond: Condition, then: string, otherwise: string): string => ({ ...cond, then, else: otherwise }) as unknown as string;

/** A step: what the stage shows one at a time. */
export const STEP = (id: string, kids: Array<Node | null>, extra: Partial<Node> = {}): Node => ({
  type: "Stack",
  props: { stepId: id },
  style: { flexGrow: 1, paddingHorizontal: OB.side, paddingBottom: 30 },
  children: nodes(kids),
  ...extra,
});

/** Where Blip stands, in which pose, saying what. An empty box the host measures. */
export const SPOT = (pose: string, h: number, say: ObKey, bubble: "side" | "corner" = "side", x: Style = {}): Node => ({
  type: "BlipSpot",
  props: { pose, h, say: EN[say], bubble, ...x },
  style: bubble === "side" ? { marginLeft: -Math.round(0.24 * h), marginRight: -Math.round(0.16 * h) } : {},
});
/** A step's head: Blip, with his bubble beside him. */
export const HD = (...spots: Node[]): Node =>
  ({ type: "Stack", style: { flexDirection: "row", alignItems: "flex-start" }, children: spots });
/** Welcome's and Done's head: Blip big, centred, his bubble in the corner. */
export const C1 = (...spots: Node[]): Node =>
  ({ type: "Stack", style: { alignItems: "center", marginTop: 10 }, children: spots });

export const H = (k: ObKey, xl = false): Node => ({
  type: "Heading",
  props: { content: EN[k] },
  // No fontWeight: a custom face's weight is its file.
  style: {
    fontFamily: OB.headingFont, fontSize: xl ? 32 : 26, lineHeight: xl ? 36 : 29, letterSpacing: -0.6, color: OB.ink,
    marginTop: 6, marginBottom: 6, ...(xl ? { textAlign: "center" } : {}),
  },
});
/**
 * HOW A LINE OF OURS SAYS WHAT IT LOOKS LIKE, ALL OF IT.
 *
 * Both apps draw a Text and a Paragraph in the dark theme's own voices first
 * (`body` and `paragraph`: Light, weight 300, a 26-point line) and lay a node's
 * style over them, so whatever a style leaves out falls through to those. Body
 * copy then came out Light and not Regular, and a 12-point label sat in a
 * 26-point box, which made the little pills 34 tall. So every line sets its own
 * weight and its own line height: Regular (400), and about 1.3 times its size.
 * A line with a face of its own is left without a weight, as the headings are:
 * a custom face's weight is its file.
 */
export const plain = (style: Style): Style => ({
  ...(style.fontFamily ? {} : { fontWeight: "400" }),
  lineHeight: Math.round((Number(style.fontSize) || 15) * 1.3),
  ...style,
});
export const P = (k: ObKey, s: Style = {}): Node => ({
  type: "Paragraph", props: { content: EN[k] },
  style: plain({ fontSize: 15, lineHeight: 21, color: OB.ink2, marginBottom: 12, ...s }),
});
/** The small capitals over a group: Suggested, You said, I wrote. */
export const LABEL = (content: string): Node => ({
  type: "Text", props: { content },
  style: plain({ fontSize: 12, lineHeight: 14, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", color: OB.ink2, marginTop: 6, marginBottom: 8 }),
});
export const LAB = (k: ObKey): Node => LABEL(EN[k]);
export const FINE = (k: ObKey, center = false): Node => ({
  type: "Text", props: { content: EN[k] },
  style: plain({ fontSize: 13, lineHeight: 18, color: OB.ink2, ...(center ? { textAlign: "center", marginTop: 6 } : { marginVertical: 2 }) }),
});
/** A line of ours in the system face. */
export const TXT = (content: string, style: Style): Node => ({ type: "Text", props: { content }, style: plain(style) });
/** A line drawn from the screen's state: an app's name, a language: never translated. */
export const FROM = (path: string, style: Style): Node => ({ type: "Text", props: { content: "" }, bind: { content: path }, style: plain(style) });

/** The ink button. `label` is the line itself (ours from OB_EN, or the shared table's). Dimmed it cannot be pressed. */
export const BTN = (label: string, action: ActionRef, dim = false): Node => ({
  type: "Stack",
  ...(dim ? {} : { on: { onPress: action } }),
  props: { pressOpacity: 0.7 },
  style: {
    height: 52, borderRadius: 16, backgroundColor: OB.ink, opacity: dim ? 0.3 : 1,
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
  },
  children: [TXT(label, { fontSize: 16, fontWeight: "600", color: OB.surf })],
});
/** The quiet one under it. */
export const BTN2 = (label: string, action: ActionRef): Node => ({
  type: "Stack",
  on: { onPress: action },
  props: { pressOpacity: 0.7 },
  style: { height: 40, borderRadius: 16, backgroundColor: "transparent", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  children: [TXT(label, { fontSize: 14.5, fontWeight: "600", color: OB.ink2 })],
});

const hairline = (): Node => ({ type: "Stack", style: { flex: 1, height: 1, backgroundColor: OB.hair } });
/** A line with "or" in the middle. */
export const OR = (): Node => ({
  type: "Stack",
  style: { flexDirection: "row", alignItems: "center", gap: 10 },
  children: [
    hairline(),
    TXT(EN["ob.or"], { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", color: OB.ink2 }),
    hairline(),
  ],
});
/** Pushes what follows to the bottom of the window. */
export const PUSH = (): Node => ({ type: "Spacer", style: { flex: 1, minHeight: 12 } });

export const ICON = (name: keyof typeof IC, size: number, color: string): Node => ({
  type: "SVG",
  props: { viewBox: "0 0 24 24", d: IC[name], fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
  style: { width: size, height: size },
});

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/**
 * The stage's look, which the persistent bot reads too. The same on both sides
 * of sign-in, so he does not change at the boundary. (Reduced motion is the
 * app's to apply to `glide`.)
 */
export function stageProps(id: "onboard.auth" | "onboard", first: number, of: number): Style {
  return {
    id, first, of,
    // Opts the tree out of the capitalising pass (titleCase.ts): these are
    // sentences, and the Hinglish seeds match them letter for letter.
    keepCase: true,
    ground: OB.paper,
    progress: { on: OB.ink, off: OB.hair, height: 4, gap: 4 },
    bubble: { background: OB.surf, border: OB.ink, ink: OB.ink, font: OB.hand, size: 19, bigSize: 22 },
    blip: { dot: OB.dot, sticker: OB.sticker, glow: OB.neon },
    glide: { slide: 26, outMs: 230, inMs: 320, inDelayMs: 60 },
  };
}

// ---------------------------------------------------------------------------
// After the session: the screen `onboard`
// ---------------------------------------------------------------------------

/** Everything a step needs to know about this person and this build. */
export interface Plan {
  desktop: boolean;
  ios: boolean;
  appsOn: boolean;
  /** Step id -> index, for the list actually built. */
  I: Record<string, number>;
  /** The index after this step's. */
  next: (id: string) => number;
  /** Every app the person can see, and the five the tiles show. */
  apps: ConnectorInfo[];
  five: ConnectorInfo[];
  /**
   * HOW A STEP AND BLIP ARE DRAWN. Here they are a stage's step and a BlipSpot;
   * the store variant (onboardStore.ts) builds the same steps out of what every
   * build draws, and hands these two its own.
   */
  step: typeof STEP;
  spot: typeof SPOT;
}
