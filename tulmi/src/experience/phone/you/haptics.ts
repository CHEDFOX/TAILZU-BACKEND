/**
 * Haptics: how the keyboard feels under the finger.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import {
  KB_ROW_LETTERS_1, KB_ROW_LETTERS_2, KB_ROW_LETTERS_3, KB_ROW_NUM_1, KB_ROW_NUM_2, KB_ROW_PUNCT_3, KB_ROW_SYM_1, KB_ROW_SYM_2,
} from "../../keyboard/keys.js";
import type { ScreenContext } from "../../screens.js";
import { YOU_UI, youHead } from "./copy.js";

/**
 * Haptics picker — the three keyboard layouts, exactly as they are laid out on
 * the keyboard, with every key tappable.
 *
 * Selection is SERVER state, not client state. Each tap posts one key and the
 * screen refreshes, so what you see is always what the keyboard will do. The
 * alternative — mirroring the set locally and syncing later — is how a settings
 * screen ends up disagreeing with the thing it configures.
 *
 * The master toggle and the individual keys stay INDEPENDENT. Turning "all keys"
 * off must not discard the keys someone picked one by one, and the toggle reads
 * as on whenever either is true, because in both cases keys are buzzing.
 */
/**
 * How the haptics screen draws its keyboards.
 *
 * Every value here was a constant inside KeyboardPreview. They are here now
 * because this screen's entire job is showing the keyboard, and a picture of a
 * keyboard that cannot be changed without a build is a picture that goes stale
 * the moment the real one is restyled.
 */
const HAPTICS_UI = {
  keyHeight: 42,
  gap: 6,
  radius: 5,
  /** A lit (chosen) key: pale ink, not amber — choosing is a setting, not
   *  something live. The black litLabel reads on it. */
  accent: "#F3E2C6",
  /** Unlit ordinary key, and unlit function key. */
  keyFill: "#FFFFFF8C",
  fnFill: "#FFFFFF26",
  /** Label on a lit key, an ordinary key, a function key. */
  litLabel: "#000000",
  keyLabel: "#111114",
  fnLabel: "#FFFFFF",
  fontSize: 17,
  longFontSize: 13,
  /** How the reels behave. Paging, because a keyboard resting half off the
   *  bottom has a bottom row nobody can reach. */
  paging: true,
  align: "center",
};

export function hapticsScreen(ctx: ScreenContext): ScreenResponse {
  const kb = HAPTICS_UI;
  const chosen = (ctx.personality?.hapticKeys ?? []).map((k) => String(k).toLowerCase());
  const all = ctx.personality?.hapticsAll === true;

  // The picker IS the keyboard. It is drawn by KeyboardPreview, one component
  // whose job is keyboards — the first attempt composed it from Button nodes
  // and came out as a field of pills with the labels clipped, because a
  // keyboard is a grid with its own sizing rules and not a row of small
  // buttons.
  //
  // Rows come from KB_ROW_*, which the KEYBOARD is also built from, so adding
  // a key there makes it appear here with nothing else to change.
  type PK = { label: string; id: string; flex?: number; w?: number; fn?: boolean; spacer?: boolean };
  const k = (label: string, id?: string, extra: Partial<PK> = {}): PK =>
    ({ label, id: id ?? label, ...extra });
  const chars = (list: string[]): PK[] => list.map((c) => k(c, c));
  const spacer = (flex: number): PK => ({ label: "", id: "", flex, spacer: true });

  // Identical on every layer bar its leftmost key — as on the real keyboard.
  const bottom = (leftLabel: string, leftId: string): PK[] => [
    k(leftLabel, leftId, { flex: 2.4, fn: true }),
    k(".", ".", { flex: 1.29, fn: true }),
    k("space", "space", { flex: 5.2 }),
    k("@", "@", { flex: 1.29, fn: true }),
    k("return", "return", { flex: 2.4, fn: true }),
  ];

  /**
   * ONE KEYBOARD PER REEL, and no name on it.
   *
   * Four keyboards will not fit on a screen at once, and the old answer —
   * stack them and scroll — left a keyboard resting half off the bottom with
   * its last row unreachable, which on a screen whose whole job is tapping
   * individual keys is not a cosmetic problem. So each layer gets the window
   * to itself and you move between them the way you move between reels.
   *
   * No title. "Letters", "Numbers", "Symbols" name what is already drawn full
   * size underneath them, and four labels down a screen of four keyboards
   * read as chapter headings on a book with one word per chapter.
   */
  const board = (rows: PK[][]): Node => ({
    type: "Stack",
    style: { paddingHorizontal: 12 },
    children: [
      {
        type: "KeyboardPreview",
        // THE WHOLE LOOK, from here. These were constants in the component,
        // which meant the screen that exists to show what the keyboard looks
        // like could only be restyled with a build — and would therefore
        // disagree with the real keyboard the first time that changed.
        props: {
          rows, selected: chosen, all,
          keyHeight: kb.keyHeight,
          gap: kb.gap,
          radius: kb.radius,
          accent: kb.accent,
          keyFill: kb.keyFill,
          fnFill: kb.fnFill,
          litLabel: kb.litLabel,
          keyLabel: kb.keyLabel,
          fnLabel: kb.fnLabel,
          fontSize: kb.fontSize,
          longFontSize: kb.longFontSize,
        },
        // A client without this component renders node.fallback — and without
        // one, renders NOTHING, which is how this screen came back as four
        // empty cards. Any node the backend adds ahead of the app that draws
        // it needs this; the master switch above still works meanwhile, so the
        // screen degrades to "less precise" rather than "broken".
        fallback: {
          type: "Paragraph",
          props: { content: "Update X0 Bot to choose keys one by one. \u201cEvery key\u201d above works either way." },
          style: { fontSize: 13, color: "$color.muted" },
        },
        // $event is the key's id — the component fires it, so one handler
        // serves every key instead of one action per key baked into the tree.
        on: { onPress: { kind: "sequence", actions: [
          { kind: "haptic", style: "selection" },
          { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
            body: { key: "$event" }, onError: "err" },
          { kind: "refresh" },
        ] } },
      },
    ],
  });

  /** The four layers, in the order the keyboard itself moves between them. */
  const layers: PK[][][] = [
    [
      chars(KB_ROW_LETTERS_1),
      [spacer(0.5), ...chars(KB_ROW_LETTERS_2), spacer(0.5)],
      [
        k("⇧", "shift", { flex: 1.35, fn: true }),
        spacer(0.22),
        ...chars(KB_ROW_LETTERS_3),
        spacer(0.22),
        k("⌫", "backspace", { flex: 1.35, fn: true }),
      ],
      bottom("123", "123"),
    ],
    [
      chars(KB_ROW_NUM_1),
      chars(KB_ROW_NUM_2),
      [
        k("#+=", "#+=", { flex: 1.5, fn: true }),
        ...chars(KB_ROW_PUNCT_3),
        k("⌫", "backspace", { flex: 1.5, fn: true }),
      ],
      bottom("ABC", "abc"),
    ],
    [
      chars(KB_ROW_SYM_1),
      chars(KB_ROW_SYM_2),
      [
        k("123", "123", { flex: 1.5, fn: true }),
        ...chars(KB_ROW_PUNCT_3),
        k("⌫", "backspace", { flex: 1.5, fn: true }),
      ],
      bottom("ABC", "abc"),
    ],
    [[
      k("mic", "mic", { fn: true }),
      k("Refine", "refine", { fn: true }),
      k("globe", "globe", { fn: true }),
    ]],
  ];

  /**
   * EACH KEY ONCE, across all four keyboards.
   *
   * Backspace, space, return, ".", "@", the layer keys and a whole row of
   * punctuation sit on more than one keyboard, so the picker showed them two
   * and three times — and a key you have already chosen on one reel looked
   * unchosen-and-available on the next. Now each appears on ONE keyboard,
   * picked by a shuffle rather than by position (not always the first reel),
   * and where it would have repeated the space stays blank at the key's own
   * width, so every keyboard keeps its shape.
   *
   * The shuffle is seeded by the account, not by the clock: every tap
   * refreshes this screen, and keys that moved on each refresh would be
   * impossible to find twice. Random to look at, stable to use.
   */
  const seed = String(ctx.email ?? ctx.phone ?? "tailzu");
  const hash = (text: string) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const onLayers = new Map<string, number[]>();
  layers.forEach((rows, li) => rows.forEach((row) => row.forEach((key) => {
    if (key.spacer || !key.id) return;
    const list = onLayers.get(key.id) ?? [];
    if (!list.includes(li)) list.push(li);
    onLayers.set(key.id, list);
  })));
  const home = new Map<string, number>();
  for (const [id, list] of onLayers) home.set(id, list[hash(`${seed}:${id}`) % list.length]!);
  const drawn = new Set<string>();
  const boards: Node[] = layers.map((rows, li) => board(rows.map((row) => row.map((key) => {
    if (key.spacer || !key.id) return key;
    if (home.get(key.id) !== li || drawn.has(key.id)) return spacer(key.flex ?? 1);
    drawn.add(key.id);
    return key;
  }))));

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "haptics",
    title: "Haptics",
    // Seeded from the saved setting so the switch is right the instant the
    // screen draws, and mutated in place by the switch after that.
    state: { hapticsAll: all },
    actions: {
      // The ONLY place this screen refetches. Every tap is applied locally the
      // moment it happens; a failure is the one time the server disagrees with
      // what the user is looking at, and then the screen has to go and find out
      // what is true rather than leave a key lit that is not.
      err: { kind: "sequence", actions: [
        { kind: "toast", message: "Couldn't save that.", tone: "error" },
        { kind: "refresh" },
      ] },
    },
    // The amber block reaches the top of the window, so the app's own header
    // has to go. The block carries the way back in its place.
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        // The kicker carries what the switch does, so the switch itself needs
        // no label beside it. One sentence at the top of the screen beats the
        // same word repeated next to a control on every layer.
        youHead("Tap a key. Or switch them all on.", "Haptics"),
        {
          // THE SWITCH DOES NOT SCROLL. It belongs to all four layers, and a
          // control that scrolls away with the one it happens to sit on reads
          // as belonging to that one. So it is a SIBLING of the pager, below
          // the amber and above the keyboards, and it stays where it is put.
          //
          // It wears the brand colour when on, not the system green: a colour
          // Apple drew, on a control Apple did not, reads as borrowed.
          type: "Stack",
          style: {
            flexDirection: "row", alignItems: "center", justifyContent: "flex-end",
            paddingHorizontal: YOU_UI.padding, paddingTop: 14, paddingBottom: 6,
          },
          children: [
            {
              type: "Switch",
              bind: { value: "hapticsAll" },
              // The switch writes the new value to state BEFORE this fires, so
              // the body reads it rather than negating the old one — no second
              // source of truth to drift.
              on: { onChange: { kind: "sequence", actions: [
                { kind: "haptic", style: "selection" },
                { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
                  body: { all: "$state.hapticsAll" }, onError: "err" },
                { kind: "refresh" },
              ] } },
              // Older bundles keep the row they already know how to draw. That
              // one carries a label, because a bare Row would be a blank line.
              fallback: {
                type: "Row",
                props: { label: "Every key", value: all ? "On" : "Off" },
                on: { onPress: { kind: "sequence", actions: [
                  { kind: "haptic", style: "selection" },
                  { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
                    body: { all: !all }, onError: "err" },
                  { kind: "refresh" },
                ] } },
              },
            },
          ],
        },
        {
          type: "Reels",
          props: { paging: kb.paging, align: kb.align },
          style: { flex: 1 },
          children: boards,
          // A bundle without Reels gets the four boards down a scroll. Less
          // precise, entirely usable, and the switch above still works — the
          // same way this screen degraded before KeyboardPreview shipped.
          fallback: {
            type: "Screen",
            style: { backgroundColor: "transparent", paddingBottom: 32 },
            children: boards,
          },
        },
      ],
    },
    cacheTtlSeconds: 180,
  };
}
