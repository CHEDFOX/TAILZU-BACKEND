/**
 * THE KEYBOARD'S HANDOFF SCREENS IN THE BOTS APP: flow_arm, keyboard_record and keyboard_primer, in the launch's look.
 *
 * The keyboard opens these by id, and its config names them the same for every app, so the ids stay and the catalog
 * builds them as it always has (phone/). For the Bots app (ScreenContext.bots) it hands its screen here and gets it
 * back drawn the new way: the launch's cream ground, the app icon's bot small at the top (the splash's own art), ink
 * words in Geist and the kit's pill buttons, with no old header or tab bar over a screen that only lasts a moment.
 *
 * ONLY THE LOOK. The state, the actions, the timing, the words (in the Bots app's sentence case), and every action a
 * control fires, every binding and every condition are the catalog's (bots-handoff.test.ts compares them). The mic itself (VoiceToggle) and the field
 * it writes into are the catalog's own nodes, untouched. flow_arm's demo clip (a keyboard on black) is left out: the
 * screen still leaves when its clip would have ended.
 */
import type { ActionRef, ActionSpec, Node, ScreenResponse } from "../../../../../shared/types/sdui.js";
import { hangUrl } from "../art.js";
import { body, BOTS_THEME, C, col, gap, picture, primaryButton, row, secondaryButton, sectionLabel, text, title, when, box, whenEq, seq } from "../kit.js";
import { keyboardArt, KEYS_DARK } from "./firstRun/firstWords.js";
import { CLAY } from "./firstRun/parts.js";

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

/**
 * flow_arm: armed on appear, leaves on its own, nothing to tap. What it says is what to do next — switch to the app you
 * want to write in — on black, over Keylessbord's own keyboard (the one its setup ends on, dark here), on which "Say it" is
 * typed out as a person would: one key at a time, each lit for a moment by a light touch with its letter showing on it.
 * The typing is state and time only (a delay and a setState a letter), so every build draws it, with nothing new.
 */
export function botsFlowArm(base: ScreenResponse): ScreenResponse {
  const typing: Node = {
    ...col([
      gap(8),
      title("Switch to the app you want to write in", { align: "center", color: C.paper }), gap(10),
      body("We feel the inconvenience too. Apple has a little trauma about microphones.", { align: "center", color: DIM }),
      { ...box([], { flexGrow: 1 }) },
      keyboardArt(null, {
        keys: KEYS_DARK,
        key: (r, i) => touchStyle(keyAt(r, i)),
        // The letter shows on its key while it is touched, and only then: the words are the keys, there is no box.
        keyIn: (r, i) => (keyAt(r, i) ? [when({ eq: [TOUCH, keyAt(r, i)] }, text(keyAt(r, i).toUpperCase(), { size: 16, weight: 600, lineHeight: 19, color: INK_ON_LIT }))] : []),
        // The space is the long bar: a touch rims it in clay.
        bar: { borderWidth: 1.5, borderColor: whenEq(TOUCH, " ", CLAY, KEYS_DARK.key) },
        label: "Keylessbord, typing: Say it",
      }),
    ], { flex: 1, paddingHorizontal: 20, paddingTop: 40, paddingBottom: 20 }),
    on: { onAppear: typeSayIt() },
  };
  return homeNotStats(dark(page({ ...base, actions: heldForTyping(base.actions), state: { ...(base.state ?? {}), [TOUCH]: "" } }, typing, base.root?.on)));
}

/** The Flow screen is on black: the moment between the keyboard and the app you are going back to. */
const BLACK = "#000000";
const DIM = "#9A9A9F";
/** A touched key: lit, its letter dark on it. */
const LIT = "#E5E5EA";
const INK_ON_LIT = "#111111";

/** The cream page made black: its theme, its ground and a light status bar. */
function dark(s: ScreenResponse): ScreenResponse {
  const root = s.root!;
  return {
    ...s,
    theme: { ...s.theme, color: { ...(s.theme?.color ?? {}), bg: BLACK, surface: BLACK, tabBar: BLACK } } as ScreenResponse["theme"],
    root: { ...root, props: { ...(root.props ?? {}), barStyle: "light-content" }, style: { ...(root.style ?? {}), backgroundColor: BLACK } },
  };
}

/** How long "Say it" takes to type, from the screen's first frame. */
const TYPE_MS = 1100 + [230, 190, 270, 320, 210, 250].reduce((a, g) => a + 130 + g, 0);
/** And how long it stays typed before the screen leaves, so it is read and not cut off. */
const READ_MS = 1500;

/**
 * The screen leaves on its own once the mic is armed (doArm's delay, then away). Held here until "Say it" has been typed
 * and read: never shorter than it was, only long enough for the typing.
 */
function heldForTyping(actions: ScreenResponse["actions"]): ScreenResponse["actions"] {
  const arm = actions?.doArm as { kind?: string; actions?: Array<{ kind?: string; ms?: number }> } | undefined;
  if (!actions || !arm || arm.kind !== "sequence" || !Array.isArray(arm.actions)) return actions;
  return { ...actions, doArm: { ...arm, actions: arm.actions.map((x) => (x.kind === "delay" ? { ...x, ms: Math.max(Number(x.ms) || 0, TYPE_MS + READ_MS) } : x)) } as never };
}

/** What is typed, and which key is being touched right now ("" none, " " the bar). */
const SAY = "Say it";
const TOUCH = "flowTouch";

/** Where each letter sits on the drawn keyboard's two letter rows (QWERTY: q-p, then a-l). */
const ROWS = ["qwertyuiop", "asdfghjkl"];
const keyAt = (r: number, i: number): string => ROWS[r]?.[i] ?? "";

/** A key lit for a moment while its letter lands: a light touch, not a press. */
function touchStyle(letter: string): Record<string, unknown> {
  return letter ? { backgroundColor: whenEq(TOUCH, letter, LIT, KEYS_DARK.key) } : {};
}

/**
 * "Say it", typed: a beat to settle, then for each letter its key lit with the letter on it, then let go; the spaces
 * between letters uneven, as a person's are.
 */
function typeSayIt(): ActionRef {
  const steps: ActionSpec[] = [{ kind: "delay", ms: 1100 }];
  const gaps = [230, 190, 270, 320, 210, 250]; // TYPE_MS adds these up: change them together
  [...SAY].forEach((ch, i) => {
    const k = ch === " " ? " " : ch.toLowerCase();
    steps.push(
      { kind: "setState", path: TOUCH, value: k },
      { kind: "delay", ms: 130 },
      { kind: "setState", path: TOUCH, value: "" },
      { kind: "delay", ms: gaps[i] ?? 140 },
    );
  });
  return seq(...steps);
}

/** The tab the Bots app opens on (bots/index.ts initialTabId): where the Flow screen leaves for. */
export const FLOW_LEAVES_FOR = "talk";

/**
 * Today's flow_arm leaves for the Stats tab, which the Bots app does not have. It leaves for Talk, the tab the app
 * opens on, BY SWITCHING TO IT: the switch puts that tab's own screen alone on the stack, with the tab bar. It used to
 * navigate to "home", which the Bots app serves as its Home page pushed on top of the Flow screen — a page nothing
 * leads to any more, with no tab bar under it, and which drew nothing at all while its welcome waited to play.
 */
function homeNotStats<T>(v: T): T {
  if (Array.isArray(v)) return v.map(homeNotStats) as T;
  if (!v || typeof v !== "object") return v;
  const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, homeNotStats(x)])) as Record<string, unknown>;
  if (o.kind === "navigate" && o.screenId === "stats") return { kind: "switchTab", tabId: FLOW_LEAVES_FOR } as T;
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
      "iOS asks this app for the microphone before the keyboard can use it. Tap Continue, then swipe back to your app: the keyboard mic will work from then on."),
    gap(24),
    card([
      step("1.", "Tap Continue below"),
      step("2.", "Answer the iOS microphone prompt"),
      step("3.", "Swipe back to your app and tap the keyboard mic again"),
    ]),
    gap(22),
    // App Review 5.1.1(iv): our button says Continue and goes straight to the system's prompt; nothing here puts it off.
    when({ not: { truthy: "micGranted" } }, primaryButton("Continue", "grantMic", { wide: true })),
    { ...when({ truthy: "micGranted" }, card([
      text("You're set", { size: 18, weight: 700, lineHeight: 24 }),
      body("Swipe back to your app now and tap the keyboard mic. It'll work from here on out.", { color: C.grey70 }),
    ], { marginBottom: 12 })), motion: { appear: "fadeInUp" } },
    gap(10),
    // Only once the prompt has been answered: before that Continue stands alone (phone/keyboardPrimer.ts, and
    // bots-handoff.test.ts holds the two trees' conditions the same).
    when({ all: [{ not: { truthy: "micGranted" } }, { truthy: "micAsked" }] }, secondaryButton("Open X0 Bot Settings", "openMainSettings", { wide: true })),
    gap(8),
    when({ truthy: "micGranted" }, secondaryButton("Done", "dismiss", { wide: true })),
  ]));
}
