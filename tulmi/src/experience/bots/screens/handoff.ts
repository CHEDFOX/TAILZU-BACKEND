/**
 * THE KEYBOARD'S HANDOFF SCREENS IN THE BOTS APP: flow_arm, keyboard_record and keyboard_primer, in the launch's look.
 *
 * The keyboard opens these by id, and its config names them the same for every app, so the ids stay and the catalog
 * builds them as it always has (catalog.ts). For the Bots app (ScreenContext.bots) it hands its screen here and gets it
 * back drawn the new way: the launch's cream ground, the app icon's bot small at the top (the splash's own art), ink
 * words in Geist and the kit's pill buttons, with no old header or tab bar over a screen that only lasts a moment.
 *
 * ONLY THE LOOK. The state, the actions, the timing, the words (in the Bots app's sentence case), and every action a
 * control fires, every binding and every condition are the catalog's (bots-handoff.test.ts compares them). The mic itself (VoiceToggle) and the field
 * it writes into are the catalog's own nodes, untouched. flow_arm's demo clip (a keyboard on black) is left out: the
 * screen still leaves when its clip would have ended.
 */
import type { Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import { hangUrl } from "../art.js";
import { body, BOTS_THEME, C, col, gap, picture, primaryButton, row, secondaryButton, sectionLabel, text, title, when } from "../kit.js";

/** The launch's ground: the app icon's cream (the phone's splash, app/src/launch). */
export const CREAM = "#F7F3EC";

/** The splash's size, so the bot here is the bot the app opened on. */
const BOT_PT = 136;

const bot = (): Node => col([picture(hangUrl(), BOT_PT, BOT_PT, { label: "X0 Bot" })], { alignItems: "center" });

/** The catalog's own node of a type (its mic, its field): taken as it is. */
function own(base: ScreenResponse, type: string): Node {
  const find = (n: Node): Node | undefined => n.type === type ? n : (n.children ?? []).map(find).find(Boolean);
  const n = base.root && find(base.root);
  if (!n) throw new Error(`${base.screenId} has no ${type}`);
  return n;
}

/** The catalog's screen on the cream: the same state, actions and timing; safe-area aware, a dark status bar, no chrome. */
function page(base: ScreenResponse, content: Node, on?: Node["on"]): ScreenResponse {
  return {
    ...base,
    hideChrome: true,
    look: "bots",
    theme: { ...BOTS_THEME, color: { ...BOTS_THEME.color, bg: CREAM, surface: CREAM, tabBar: CREAM, card: C.paper } },
    root: {
      type: "SafeArea",
      // Sentence case, like every Bots app page: the catalog title-cases its phone screens (titleCase.ts), and a
      // root marked keepCase opts the whole screen out, its toasts too.
      props: { edges: ["top", "bottom"], barStyle: "dark-content", keepCase: true },
      style: { flex: 1, flexDirection: "column", backgroundColor: CREAM },
      ...(on ? { on } : {}),
      children: [content],
    },
  };
}

/** The words and controls, scrolling, 24 at the sides. */
const scroll = (children: Node[]): Node => ({
  type: "Screen", props: { paddingBottom: 24 }, style: { backgroundColor: CREAM, paddingHorizontal: 24, paddingTop: 12 }, children,
});

const card = (children: Node[], style: Record<string, unknown> = {}): Node =>
  col(children, { backgroundColor: C.paper, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10, ...style });

/** The head of each screen: the bot, a label, a title, a line. */
const head = (label: string, heading: string, line: string): Node[] => [
  bot(), gap(14),
  sectionLabel(label, { align: "center" }), gap(6),
  title(heading, { align: "center" }), gap(8),
  body(line, { align: "center", color: C.grey70 }),
];

/** The keyboard's handoff screens: today's ids (the keyboard's config names them), drawn in the Bots app's look. */
export const BOTS_HANDOFF_IDS: ReadonlySet<string> = new Set(["keyboard_record", "keyboard_primer", "flow_arm"]);

/** flow_arm: armed on appear, says what changed, leaves on its own. Centred on the screen; nothing to tap. */
export function botsFlowArm(base: ScreenResponse): ScreenResponse {
  return homeNotStats(page(base, col([
    bot(), gap(24),
    title("The mic goes with you.", { align: "center" }), gap(10),
    body("Tap the mic in any app and talk — the words land written.", { align: "center", color: C.grey70 }),
  ], { flex: 1, justifyContent: "center", paddingHorizontal: 28, paddingBottom: 48 }), base.root?.on));
}

/** Today's flow_arm leaves for the Stats tab, which the Bots app does not have: it leaves for Home. */
function homeNotStats<T>(v: T): T {
  if (Array.isArray(v)) return v.map(homeNotStats) as T;
  if (!v || typeof v !== "object") return v;
  const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, homeNotStats(x)])) as Record<string, unknown>;
  if (o.kind === "navigate" && o.screenId === "stats") o.screenId = "home";
  return o as T;
}

/** keyboard_record: the mic, the words it heard, Send and Cancel. */
export function botsKeyboardRecord(base: ScreenResponse): ScreenResponse {
  return page(base, scroll([
    ...head("Voice keyboard", "Speak, then swipe back",
      "We'll clean it up and drop the text into your keyboard. Nothing gets sent from here — the keyboard inserts it into whatever app you were in."),
    gap(28),
    col([own(base, "VoiceToggle")], { alignItems: "center", justifyContent: "center" }),
    gap(20),
    card([
      when({ falsy: "dictationSample" }, body("Tap the mic to start. Tap again to stop.", { color: C.meta, align: "center" })),
      own(base, "TextField"),
    ]),
    gap(20),
    when({ truthy: "dictationSample" }, primaryButton("Send to keyboard", "send", { wide: true })),
    gap(10),
    secondaryButton("Cancel", "cancel", { wide: true }),
  ]));
}

/** keyboard_primer: why, the three steps, Allow, and then You're set. */
export function botsKeyboardPrimer(base: ScreenResponse): ScreenResponse {
  const step = (n: string, what: string): Node => row([
    text(n, { size: 15, weight: 700, lineHeight: 20, style: { width: 24 } }),
    text(what, { size: 15, lineHeight: 20, style: { flex: 1 } }),
  ], { alignItems: "flex-start" });
  return page(base, scroll([
    ...head("One-time setup", "Turn on voice for the keyboard",
      "iOS requires this app to grant microphone access before the keyboard can use it. Tap Allow, then swipe back to your app — the keyboard mic will work from then on."),
    gap(24),
    card([
      step("1.", "Tap the Allow mic button below"),
      step("2.", "Approve the iOS microphone prompt"),
      step("3.", "Swipe back to your app and tap the keyboard mic again"),
    ]),
    gap(22),
    when({ not: { truthy: "micGranted" } }, primaryButton("Allow microphone", "grantMic", { wide: true })),
    { ...when({ truthy: "micGranted" }, card([
      text("You're set", { size: 18, weight: 700, lineHeight: 24 }),
      body("Swipe back to your app now and tap the keyboard mic. It'll work from here on out.", { color: C.grey70 }),
    ], { marginBottom: 12 })), motion: { appear: "fadeInUp" } },
    gap(10),
    when({ not: { truthy: "micGranted" } }, secondaryButton("Open X0 Bot Settings", "openMainSettings", { wide: true })),
    gap(8),
    secondaryButton("Cancel", "dismiss", { wide: true }),
  ]));
}
