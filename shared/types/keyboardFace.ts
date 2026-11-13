/**
 * KEY FACES AND SKINS — what a key may PRINT, and what a skin may never do.
 *
 * The keyboard is already the most server-driven surface we have: GET /v1/keyboard/config sends the whole node tree, the
 * per-appearance themes, per-node style and effects, images on keys, the kb.* flags, layouts and languages. What it cannot do
 * today is PRINT on a key: a LetterKey sets a title and nothing else, and the drawn `mark` is read only inside the mic key.
 *
 * This file is the contract for that. It is deliberately NOT in sdui.ts: faces are a new, separately versioned promise
 * (KeySkin1) and the keyboard's two renderers gate on it.
 *
 * WHO DOES WHAT
 *   The server authors skins (shared/native/skins/*.json, server-only) and EXPANDS the person's pick into the key tree it
 *   already builds (tulmi/src/experience/keyboard/config.ts): into node `style`, `props.face` and `style.press`, into
 *   themeDark / themeLight, and into the existing kb.callout.* and kb.accentTray.* flags.
 *   The phone ships PRIMITIVES ONLY. There is no skin resolver and no precedence chain on the phone. It never sees a skin
 *   object, only the expanded tree plus the `skin` block below (its id, sha, budget and manifest).
 *
 * THE FOUR LAWS (App Review 4.4.1, and our own privacy promise)
 *   1. A key never changes what it does. A face is paint. It carries no `on`, no actions, no endpoints, no layout.
 *   2. No typed text ever leaves the device. The config request carries the platform, the build stamp, the can-list, the
 *      bad-skin id, the language and the person's token. Never the field, the host app, the keystrokes or their timing.
 *   3. Every fetch happens when the config arrives: the config, then ONE batch of every file in `skin.manifest`. Nothing is
 *      fetched on a key press or a layout switch, so no request can ever be tied to a keystroke. Missing art means the flat
 *      colour for that session.
 *   4. Art and fonts come by content hash from our own compiled-in host only. No cookies, no auth, no id in the URL, so a
 *      skin can never carry a tracking pixel. There is no per-key press counting, ever.
 */

import type { KeyboardConfigResponse } from "./sdui.js";

// ---------------------------------------------------------------------------
// Capability and build stamps
// ---------------------------------------------------------------------------

/**
 * The keyboard sends this header; the server gates its skin expansion on it. KeySkin1 promises exactly: `face` on any key,
 * the `path` mark shape, press fade / pop / glow, `style.fontFamily` and the font hook.
 * config.ts reads the can-list instead of doing arithmetic on build stamps.
 */
export const KEYBOARD_CAN_HEADER = "X-Tulmi-Keyboard-Can";
/** Sent when the crash guard has struck on a skinned config: the server answers with the unskinned tree. */
export const KEYBOARD_BAD_HEADER = "X-Tulmi-Keyboard-Bad";
/** The family a keyboard capability counts up in: KeySkin1, KeySkin2, … */
export const KEY_SKIN_FAMILY = "KeySkin";
export const KEY_SKIN_1 = "KeySkin1";

/** The build stamps that carry faces. Below these, the server sends today's unskinned tree. */
export const KEY_FACE_STAMPS = { ios: "K45", android: "A5" } as const;

// ---------------------------------------------------------------------------
// The mark: a drawn print, with the motion language that already ships
// ---------------------------------------------------------------------------

/**
 * Shape kinds a mark may hold. `rect`, `line`, `circle` and `bars` already ship (TulmiMarkView.parse). `path` is the one
 * addition in this build, in the grammar nlook and the bots' looks share: M L Q C Z O.
 */
export const MARK_SHAPE_KINDS = ["rect", "line", "circle", "bars", "path"] as const;
export type MarkShapeKind = (typeof MARK_SHAPE_KINDS)[number];

/** One shape of a mark. Numbers are in the mark's own viewBox units; an unknown kind is skipped, never shown. */
export interface KeyMarkShape {
  kind: MarkShapeKind;
  /** Named so `program` and the dispersal can address it. */
  id?: string;
  /** rect: x y w h. circle: cx cy r. line: x1 y1 x2 y2. path: `d`. bars: x y w plus `heights`. */
  x?: number; y?: number; w?: number; h?: number;
  cx?: number; cy?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  /** path only, in the shared grammar: "M 4 12 C 30 2 90 2 116 12". */
  d?: string;
  heights?: number[];
  dash?: number[];
  cap?: "butt" | "round" | "square";
  width?: number;
  color?: string;
  swell?: { thick?: number; height?: number };
}

/** A drawn print. `fit: "circle"` fits the artboard by its diagonal (a round key); "box" fits the sides. */
export interface KeyMark {
  viewBox: [number, number, number, number];
  shapes: KeyMarkShape[];
  fit?: "circle" | "box";
}

// ---------------------------------------------------------------------------
// The face: what a key prints
// ---------------------------------------------------------------------------

/** Where a second legend sits. */
export const SUB_POSITIONS = ["top-right", "top-left", "bottom-right", "bottom-left"] as const;
export type SubPosition = (typeof SUB_POSITIONS)[number];

/** The existing icon spec, unchanged (sdui.ts IconKey.props.icon). `url` must be in `skin.manifest` and on the art host. */
/**
 * An icon on a key: an SF Symbol (iOS; Android maps the name to a bundled drawable, else the legend draws), a bundled asset,
 * or an emoji. THERE IS NO `url` FORM. A picture goes through `art`, by content hash, from the compiled-in host: an icon
 * that could name a URL would be a skin that fetches from somewhere we do not own. The server's `checkSkin` refuses one.
 */
export type KeyFaceIcon = { sf: string } | { asset: string } | { emoji: string } | string;

/**
 * `props.face` on ANY key node. A face is a legend, a second legend, a corner glyph, an icon, art, or a mark — behind the
 * key's title (`layer: "behind"`) or instead of it. The key keeps insertKey, shift casing, the accent tray and the fast
 * in-place re-title: a face never touches behaviour.
 */
export interface KeyFace {
  /** The main legend. Default: the key's own character, and it follows shift and caps like the title does. */
  label?: string;
  /** A second legend (the symbol a long press would give). */
  sub?: string;
  subPos?: SubPosition;
  /** A small corner glyph. */
  corner?: string;
  icon?: KeyFaceIcon;
  /**
   * Art: the BARE manifest name, `<sha256>@<1|2|3>.png`, and nothing else — never a URL and never a path. Each phone builds
   * the address from its own compiled-in host (`api.x0bot.com` or `api.tailzu.space`, https only), so no host ever travels
   * in a config and a binary in the field cannot be pointed somewhere new. It must be listed in `skin.manifest.art`.
   */
  art?: string;
  mark?: KeyMark;
  /**
   * The existing numbers-only motion language, unchanged from the mic key: no I/O, bounded repeats, unknown means 0. It
   * already stops under Reduce Motion, is already capped in frames per second, and already turns a bad program into a still.
   * There is NO press position in its context (press.x, press.y, since.press): a key position is a letter.
   * A build may draw any program at its REST FRAME (Android A5 always does; iPhone moves at most `animatedKeys` keys and
   * draws the rest still). So a print must read complete at rest: motion is decoration, never the legend.
   */
  program?: Record<string, unknown>;
  layer?: "behind" | "instead";
  inset?: number;
  /** A type token (shared/types/nlook.ts TYPE_TOKENS) or a hooked font id. */
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  opacity?: number;
}

// ---------------------------------------------------------------------------
// The press effect
// ---------------------------------------------------------------------------

/**
 * Press effects are VISUAL ONLY. They run AFTER the commit (the kb.keyPlane.commitOnDown path) and never delay insertText.
 * An unknown kind, or Reduce Motion, falls back to `fade` — today's.
 *
 * A PRESSED STATE, not a release bounce, and the same on both phones:
 *   - the effect goes ON at finger-down and comes OFF at lift. `pop` eases to (scale, dy) over `ms` and HOLDS while the
 *     finger is down; `glow`'s wash is full at once. Both settle over `ms` from wherever they are at the lift.
 *   - a new down on the same key starts from the value it is at, so fast rollover never jumps.
 *   - the key's own view is never transformed: the paint moves and the hit rect does not.
 */
export const PRESS_KINDS = ["fade", "pop", "glow"] as const;
export type PressKind = (typeof PRESS_KINDS)[number];

export interface KeyPress {
  kind: PressKind;
  /** Both the rise and the settle, in milliseconds. Default 140, at most KEY_FACE_LIMITS.press.maxMs. */
  ms?: number;
  /** pop: how far it grows. Default 1.08, clamped to press.scale (0.9 to 1.12 — 0.9 is a press-in sink). */
  scale?: number;
  /** pop: how far it lifts, in points (iOS) or dp (Android). Default 0, clamped to press.dy (-6 to 6, about half a row gap). */
  dy?: number;
  /** glow: the colour it washes with. */
  color?: string;
  ease?: "linear" | "ease" | "spring";
}

/** `style.fontFamily` on a key node: a type token, or a hooked font id from the manifest. */
export type KeyFontFamily = string;

// ---------------------------------------------------------------------------
// The skin block: one per config
// ---------------------------------------------------------------------------

/** Every file the keyboard fetches, in ONE batch, right after the config arrives. The renderer reads only the cache. */
export interface KeySkinManifest {
  /** Content-addressed names, "<sha>@3.png", on the compiled-in art host. */
  art?: string[];
  fonts?: { id: string; sha256: string }[];
}

/** What the renderer enforces in the view, whatever the tree asks for. */
export interface KeySkinBudget {
  /** Bytes of images attached to LIVE key views, counted as width x height x 4. */
  decodedKB?: number;
  /** At most this many keys may run a display link. A non-animated faced key never starts one. */
  animatedKeys?: number;
}

/** The one skin block the phone sees. It is telemetry, the crash guard's key and the prefetch list — never a resolver input. */
export interface KeySkinInfo {
  id: string;
  sha: string;
  budget?: KeySkinBudget;
  manifest?: KeySkinManifest;
}

/**
 * What the skin expansion adds to the keyboard config for a build that said KeySkin1. Faces ride on the nodes themselves.
 *
 * It lives HERE and not in sdui.ts on purpose: sdui.ts importing KeySkinInfo would make a type-import cycle (this file
 * already imports from sdui.ts), and sdui.ts already has another hand in it this build.
 *
 * No call site changes for it. The expansion is a generic step of its own — withKeySkin<T extends KeyboardConfigResponse>
 * in tulmi/src/experience/keyboard/skin.ts, called between withKeybotKeyboard and withControl, both of which are already
 * generic — so buildKeyboardConfig keeps its return type and `ReturnType<typeof buildKeyboardConfig>` keeps working in the
 * tests and in export-keyboard-snapshots.ts.
 */
export interface KeyboardConfigSkinFields {
  skin?: KeySkinInfo;
}

/** The keyboard config as a KeySkin1 build receives it. */
export type KeyboardConfigWithSkin = KeyboardConfigResponse & KeyboardConfigSkinFields;

/** What a face adds to a key node's props, and a press to its style, for the renderers' type mirrors. */
export interface KeyNodeFaceProps { face?: KeyFace }
export interface KeyNodeFaceStyle { fontFamily?: KeyFontFamily; press?: KeyPress }

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Thirty animated keys is a different class of cost from one mic key, so the view enforces these whatever the config says.
 * Note on kb.images.maxEdgePx: that knob is in POINTS — TulmiImageLoader multiplies it by the screen scale or density, so 256
 * means 768 px on a 3x phone. Face art is decoded at the KEY's frame size instead, never at that knob.
 */
export const KEY_FACE_LIMITS = {
  /** Keys that may carry a face in one config. */
  facedKeys: 64,
  art: {
    /** Static PNG only. Animated raster is refused in a face in format 1 — use a mark with `program` for motion. */
    files: 24,
    fileBytes: 128 * 1024,
    /** Decoded at the key's frame size x scale, and never above this. */
    maxEdgePx: 160,
    animated: false,
  },
  /** Bytes of images attached to live key views (width x height x 4). The 12-image cache cap only evicts dictionary entries. */
  liveImageBytes: 6 * 1024 * 1024,
  /** Keys that may animate at once. The rest draw their mark at t = 0 and never start a display link. */
  animatedKeys: 3,
  fonts: {
    /** TTF or OTF, registered at runtime. */
    fileBytes: 300 * 1024,
    perConfig: 2,
  },
  /**
   * One press block goes to both phones, so one pair of clamps holds for both. A key about 32 pt wide with the usual 6 pt
   * gap grows about 1.9 pt a side at 1.12 and stays inside its half of the gap; 6 is about half the row gap.
   */
  press: { maxMs: 400, scale: { min: 0.9, max: 1.12 }, dy: { min: -6, max: 6 } },
  mark: { dChars: 900, shapes: 12 },
  /** What a printed legend may be. A face is paint on ONE key, so these are short on purpose; longer is a mistake, not a style. */
  text: { label: 16, sub: 8, corner: 8 },
  /** The numbers on a face, clamped the same on both phones. */
  size: { min: 4, max: 64 },
  weight: { min: 100, max: 900 },
  inset: { min: 0, max: 24 },
} as const;

/**
 * The ONLY kb.* flags a skin may set. A skin is paint: it may round the callout and the accent tray, and nothing else.
 * Without this an authored skin could overwrite kb.deepLink.openUrlSchemes, kb.deepLink.urlTemplate (where a tap goes) or
 * kb.keyPlane.commitOnDown (when the letter is typed) — the first law, broken by a file nobody reads as code.
 */
export const SKIN_FLAG_PREFIXES = ["kb.callout.", "kb.accentTray."] as const;

/** Every key of a face. Closed: anything else — `artKind`, `on`, `rows` — refuses the skin rather than riding along. */
export const KEY_FACE_KEYS = [
  "label", "sub", "subPos", "corner", "icon", "art", "mark", "program", "layer", "inset", "font", "size", "weight", "color", "opacity",
] as const;

/** Every key a skin may set on a theme side, and what kind of value each takes. */
export const SKIN_THEME_KEYS = {
  background: "colour", key: "colour", keyText: "colour", accent: "colour", keyPressed: "colour",
  keyRadius: "number", keyShadow: "boolean",
} as const;

/** Every field of a press block that travels. `kind` and `ms` are always written out; the rest only when the kind uses them. */
export const PRESS_KEYS = ["kind", "ms", "scale", "dy", "color", "ease"] as const;
export const PRESS_EASES = ["linear", "ease", "spring"] as const;

/**
 * WHAT config.ts STRIPS FROM SKIN INPUT, always, before anything reaches a phone. A skin that names any of these is rejected
 * by the server's lint, not quietly cleaned, because each one would be a 4.4.1 problem.
 */
export const SKIN_FORBIDDEN_KEYS = ["on", "actions", "action", "callEndpoint", "bind", "visibleIf", "rows", "layouts"] as const;

/** Plain mode: what the renderer ignores for one config sha after the crash guard strikes. The tree and colours stay. */
export const PLAIN_MODE_IGNORES = ["face", "press", "fontFamily", "art"] as const;
