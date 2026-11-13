/**
 * nlook ("native look") format 1 — THE CONTRACT for server-drawn Home Screen widgets and the iOS Live Activity.
 *
 * A design is DATA, never code (App Review 2.5.2, Play's same rule): a closed vocabulary of node types, style keys, colour and
 * type tokens, bind paths, condition keys and transition names, all compiled into the store build. There are no expressions.
 * Every action a design can name already exists in the binary (AnswerNeedIntent, AnswerBotsActivityIntent, vetted links).
 *
 * Four sides read this one file, so it is framework-free and holds no logic beyond lookups:
 *   server   shared/native/looks.json is the catalog; tulmi/src/experience/native/clean.ts validates against these limits,
 *            catalog.ts serves the per-capability projection, bind.ts fills `vars`.
 *   phone JS src/native/looksCore.ts cleans the same way before it writes anything native.
 *   iOS      targets/widgets/NLook/* decode leniently and clamp again.
 *   Android  modules/tulmi-bridge/android/.../NLook*.kt plan and paint, and clamp again.
 *
 * THREE RULES THAT NEVER BEND:
 *   1. Unknown degrades, never throws. An unknown node draws its `fallback`, then nothing. An unknown style key is ignored. An
 *      unknown colour becomes `ink`. A design whose `format` is too new is skipped ALONE, never the whole catalog.
 *   2. Checked three times: the server cleans on publish, the phone cleans before writing, native code clamps again.
 *   3. Anything missing, too new, too big or broken falls back to today's hand-written native view. A limit is never a crash
 *      and never a blank widget.
 *
 * The keyboard is NOT here: it keeps its own server-built key tree (shared/types/sdui.ts) and its faces live in
 * shared/types/keyboardFace.ts. It shares only the colour grammar and the path grammar with nlook.
 */

// ---------------------------------------------------------------------------
// Versions and capability names
// ---------------------------------------------------------------------------

/** The format this build of the contract describes. A design with a higher `format` is skipped by a binary that draws 1. */
export const NLOOK_FORMAT = 1 as const;

/**
 * THE CAPABILITY NAMES for everything in this build, as the bridge declares them (binaryFeatures) and the server reads them.
 * A name is said only by a binary that carries the native code behind it, so a name here is a promise about the BINARY, never
 * about the JavaScript. The server sends a design, a skin or a push only to a build that says the matching name.
 *
 *   NativeLook1     nlook format 1: widget designs on iOS and (API 31+) Android; on iOS also the Live Activity roots and the
 *                   ContentState `look` / `vars` fields; art, bot stills, palettes and the font hook.
 *   KeySkin1        the keyboard in this binary draws faces: `face` on any key, `path` marks, press fade/pop/glow,
 *                   `style.fontFamily` and the font hook. Also told by the main app, so the Keybot skin picker can show.
 *   ActivityPushStart  iOS 17.2+: push-to-start tokens are registered, so "Bots at work" can start while the app is shut.
 *   LiveUpdate1     Android: the ongoing "Bots at work" notice (promoted to a status-bar chip on API 36).
 *   WidgetBoard1    the spare "X0 Board" widget kind is in the build, so the server may offer boards for it.
 *
 * Later formats count up (NativeLook2, KeySkin2). `drawsFormat` on the server mirrors `playsFormat` for the bots' looks.
 */
export const NLOOK_CAPS = {
  /** The family name a capability counts up in: NativeLook1, NativeLook2, … */
  nativeLook: "NativeLook",
  keySkin: "KeySkin",
  look1: "NativeLook1",
  keySkin1: "KeySkin1",
  activityPushStart: "ActivityPushStart",
  liveUpdate1: "LiveUpdate1",
  widgetBoard1: "WidgetBoard1",
} as const;

/** Every capability name this build can declare, for the server's lists and the phone's tests. */
export const NLOOK_CAP_NAMES = [
  NLOOK_CAPS.look1, NLOOK_CAPS.keySkin1, NLOOK_CAPS.activityPushStart, NLOOK_CAPS.liveUpdate1, NLOOK_CAPS.widgetBoard1,
] as const;
export type NLookCapName = (typeof NLOOK_CAP_NAMES)[number];

// ---------------------------------------------------------------------------
// Surfaces and roots
// ---------------------------------------------------------------------------

/** Where a design is drawn. `liveupdate` is Android's ongoing notice: a template fill, not a canvas. */
export type NLookSurface = "widget" | "activity" | "liveupdate";

/** The widget roots. iOS draws all six; Android (API 31+) draws the three sizes. */
export const WIDGET_ROOTS = ["small", "medium", "large", "inline", "rect", "circle"] as const;
export type WidgetRoot = (typeof WIDGET_ROOTS)[number];

/** The Live Activity roots. Each missing root falls back to today's hand-drawn region, one region at a time. */
export const ACTIVITY_ROOTS = [
  "lock", "island.leading", "island.trailing", "island.center", "island.bottom",
  "compact.leading", "compact.trailing", "minimal",
] as const;
export type ActivityRoot = (typeof ACTIVITY_ROOTS)[number];

export type NLookRoot = WidgetRoot | ActivityRoot;

/** What each surface may use. Anything outside its subset is dropped on publish and again on the phone. */
export const NLOOK_SURFACES: Readonly<Record<NLookSurface, {
  readonly roots: readonly string[];
  /** Node types this surface cannot draw. */
  readonly without: readonly NLookType[];
  /** The hardest `Each.max` this surface allows, whatever the design asks for. */
  readonly eachMax: number;
  readonly platforms: readonly ("ios" | "android")[];
}>> = {
  widget: { roots: WIDGET_ROOTS, without: [], eachMax: 8, platforms: ["ios", "android"] },
  // No Grid in a Live Activity region, and a list of at most 3.
  activity: { roots: ACTIVITY_ROOTS, without: ["Grid"], eachMax: 3, platforms: ["ios"] },
  // Android's notice has no roots at all: it is the `fill` object below.
  liveupdate: { roots: [], without: [], eachMax: 0, platforms: ["android"] },
};

/** The Android widget draws only these roots: RemoteViews has no accessory families. */
export const ANDROID_WIDGET_ROOTS: readonly WidgetRoot[] = ["small", "medium", "large"];

// ---------------------------------------------------------------------------
// The node tree
// ---------------------------------------------------------------------------

/** Every node type format 1 knows. A type outside this list draws the node's `fallback`, then nothing. */
export const NLOOK_TYPES = [
  "V", "H", "Z", "Spacer", "Grid", "Text", "Image", "Bot", "Shape", "Bar", "Ring", "Kit", "Each", "Button",
] as const;
export type NLookType = (typeof NLOOK_TYPES)[number];

/**
 * One node: the same shape as KeyboardNode, so the two renderers read alike.
 * `props` and `style` are open bags on purpose — an unknown key is IGNORED, which is how an older build survives a design
 * written for a newer one. The per-type props are documented in NLOOK_PROPS below.
 */
export interface NLookNode {
  type: NLookType | (string & {});
  props?: Record<string, unknown>;
  style?: NLookStyle;
  children?: NLookNode[];
  /** Drawn only when every key matches (AND over keys, OR over each key's values). */
  if?: NLookCondition;
  /** Drawn instead, when this node cannot be: unknown type, over a limit, missing art, too deep on Android. */
  fallback?: NLookNode;
}

/** Style keys format 1 promises. An unknown key is ignored. */
export interface NLookStyle {
  /** Padding: one number, or [top, right, bottom, left]. */
  pad?: number | [number, number, number, number];
  w?: number | "fill" | "fit";
  h?: number | "fill" | "fit";
  /** Android: carried on `Text` and timers only (TextView.setMaxWidth/setMaxHeight are remotable); ignored on every other node. */
  maxW?: number;
  maxH?: number;
  bg?: NLookColor;
  corner?: number;
  /**
   * Android: drawn as ONE extra RemoteViews level — a wrapper filled with the border colour, the node inset by `width` on all
   * four sides. No ring is drawn when that level does not fit under the level cap, or when the fill under it is missing or not
   * fully opaque in either scheme; the node then draws without its ring rather than not at all.
   */
  border?: { color: NLookColor; width: number };
  opacity?: number;
  /** Where this node's CONTENT sits inside its own frame, when `w`/`h`/`maxW`/`maxH` make the frame bigger. See NLookAlign. */
  align?: NLookAlign;
  /** iOS only; the Android planner ignores it (RemoteViews has no free offset). */
  offset?: [number, number];
  /** iOS 18 tinted Home Screens: how this node takes the tint (widgetAccentedRenderingMode). */
  accent?: "full" | "desat" | "tint";
  /** Words that may be private: redacted on a locked phone, and swapped for the lock-safe fill on accessory and lock roots. */
  sensitive?: true;
}

export const NLOOK_STYLE_KEYS = [
  "pad", "w", "h", "maxW", "maxH", "bg", "corner", "border", "opacity", "align", "offset", "accent", "sensitive",
] as const;

/**
 * Three values, and what each one means wherever `align` appears. Format 1 is frozen into the binary, so this is the rule
 * every renderer follows rather than each one guessing. Mirrors the app's own SDUI, where `align` is across the stack
 * (shared/types/sdui.ts StyleProps). nlook has no `justify`: spacing ALONG a stack is `gap` and `Spacer`, nothing else,
 * which is why `between` and `around` are not values here. Adding them later would cost a NativeLook2.
 *
 *   V `align`      ACROSS the stack (horizontal): start = leading, center = centred, end = trailing.
 *   H `align`      ACROSS the stack (vertical): start = top, center = centred, end = bottom.
 *                  Boxes, not baselines — Android must set android:baselineAligned="false", since iOS never baselines.
 *   Z `align`      one value for both axes: start = top-leading, center = centred, end = bottom-trailing.
 *                  Android: `center` and `end` cost ONE RemoteViews level per child; a child that does not fit under the
 *                  level cap draws `start`.
 *   style.align    where a node's content sits in its own frame when `w`/`h`/`maxW`/`maxH` leave spare room. Read like Z:
 *                  ONE value for both axes, on whichever axis has spare room (start = top-leading, end = bottom-trailing).
 *   Text `align`   the usual text alignment inside the text box: start = leading, center, end = trailing.
 *
 * The server's `clean` refuses any other value, so no catalog carries one. A phone that meets one anyway draws `start`.
 */
export type NLookAlign = "start" | "center" | "end";

/**
 * THE COLOUR OF WORDS (`tint` on `Text`). One rule, the same in all three renderers, because format 1 is frozen into the
 * binary and today's views draw secondary words in `meta` or `dim` in two dozen places:
 *   - `tint` given: that colour, in the usual NLookColor grammar. A value that is not a colour is an issue and draws `ink`.
 *   - `tint` missing: `ground` when the NEAREST `bg` at or above this node (its own `style.bg`, else its closest ancestor's)
 *     is the ROLE `ink` or `accent` (with or without an `@alpha` suffix). Otherwise `ink`.
 * Roles, never luma, so light and dark give the same answer on every platform. The same rule applies to the timer props
 * (`timer`, `countdown`, `relative`) and to a `sym:` Image with no `tint` — an icon in a filled pill.
 */

/**
 * THE PROGRESS BAR (`Bar`). One rule, the same in all three renderers, because format 1 is frozen into the binary and the
 * three of them had drifted apart: iOS drew stage names, Android drew none and capped at 12, the preview drew one plain fill.
 *   - One segment per stage, `of` clamped to 1-8 (a bigger `of` draws 8 segments, not a hairline each).
 *   - Done segments are filled with `color`, the current one is striped, the rest are `track`.
 *   - `segments` names a list (an `Each` list key, e.g. "job.stages"). When that list holds EXACTLY `of` names, the names go
 *     under the bar, one per segment, 11pt: the current one bold in `ink`, the done ones `meta`, the rest `dim`. Any other
 *     count (fewer, more, or no list at all) draws the segments alone, never a half-labelled bar.
 *   - `color` defaults to `ink` and `track` to `line`.
 * `value` is 1-based: the stage being worked on. The accessibility label is the current stage's name when there is one.
 */

/** The props each type reads. Everything else on a node is ignored. */
export const NLOOK_PROPS: Readonly<Record<NLookType, readonly string[]>> = {
  V: ["gap", "align"],
  H: ["gap", "align"],
  Z: ["align"],
  Spacer: ["min"],
  Grid: ["cols", "gap"],
  Text: ["text", "font", "size", "weight", "track", "lines", "minScale", "align", "case", "digits", "tint",
    "timer", "countdown", "relative", "change"],
  Image: ["src", "fit", "size", "tint", "alt"],
  Bot: ["who", "moment", "at", "size"],
  Shape: ["kind", "fill", "stroke", "width", "d", "viewBox", "grid", "spacing", "dot"],
  Bar: ["value", "of", "segments", "color", "track"],
  Ring: ["value", "of", "width"],
  Kit: ["name", "props"],
  Each: ["of", "max", "as"],
  Button: ["act", "open"],
};

/** Shape kinds. `path` and `dots` are drawn as alpha masks on Android and tinted, so they cost one bitmap each. */
export const SHAPE_KINDS = ["rect", "capsule", "circle", "ring", "path", "dots"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** The named parts today's native views already draw (X0Parts.swift and the Android equivalents). */
export const KIT_NAMES = ["askBar", "stripes", "beads", "pill", "mark"] as const;
export type KitName = (typeof KIT_NAMES)[number];

/** How a `Text` changes when a timeline entry replaces it (iOS 17+ contentTransition). No other motion exists in a widget. */
export const TEXT_CHANGES = ["numeric", "fade", "push", "none"] as const;
export type TextChange = (typeof TEXT_CHANGES)[number];

/** How an `Image` fits its box. */
export const IMAGE_FITS = ["fill", "fit", "stretch"] as const;

/**
 * What an `Image` may point at. Nothing else is fetched, ever, and the widget extension has no network at all:
 *   art:<key>    a file the app preloaded by content hash (catalog `art`)
 *   face:<slug>  a bot head the app already keeps (faces/<slug>.png)
 *   pose:<name>  a bundled Blip pose, compiled into the build
 *   sym:<name>   an SF Symbol on iOS; on Android a mapping table to bundled drawables, else `alt`
 */
export const IMAGE_SRC_PREFIXES = ["art:", "face:", "pose:", "sym:"] as const;

/** A bot still becomes an art key of this shape: bot:<avatar>.<moment>@<t>.<scheme>.<px>. The phone renders it (botArt.ts). */
export const BOT_ART_PREFIX = "bot:";

// ---------------------------------------------------------------------------
// Colour and type
// ---------------------------------------------------------------------------

/**
 * A colour is one of:
 *   "#RRGGBB" or "#RRGGBBAA"
 *   a palette role (below)
 *   "$color" (the bound bot's own ink, as the bots' looks spells it) or "$bot.<slug>"
 * Any of them may carry an alpha suffix: "ink@0.6".
 * Raw colours are lifted for contrast natively (BotInk / WidgetInk.readable already do this). On accessory families and in
 * Always-On the system ignores or dims colour, and the preview shows that.
 */
export type NLookColor = string;

/**
 * The palette roles. `paper` is a second name for `ground`. An unknown role becomes `ink`.
 *
 * `outline` and `hollow` are roles of their own, not shades of `line`: today's views already keep all three apart — a
 * secondary pill's ring is outline, the week's open bead and the island's future stages are hollow, and a rule is line
 * (TailzuWidgets.swift X0Palette, TailzuWidgetInk.kt). Format 1 is frozen into the binary, so a role left out now could only
 * come back with NativeLook2 and another store build.
 */
export const PALETTE_ROLES = [
  "ground", "ink", "paper", "meta", "dim", "line", "surface", "accent", "outline", "hollow",
] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

/** One scheme of a palette. Every role but `paper` is spelled out; `paper` resolves to `ground`. */
export interface NLookScheme {
  ground: string;
  ink: string;
  meta: string;
  line: string;
  surface: string;
  accent: string;
  /** Optional: a role of its own, else it is derived from `meta` the way today's views do. */
  dim?: string;
  /** Optional: the ring of a secondary button. Missing means `line`, on every platform. */
  outline?: string;
  /** Optional: an unfilled bead or stage segment. Missing means `line`, on every platform. */
  hollow?: string;
}

/** The roles that fall back to another role when a scheme leaves them out. Every renderer resolves them the same way. */
export const ROLE_FALLBACK: Readonly<Partial<Record<PaletteRole, PaletteRole>>> = {
  paper: "ground",
  dim: "meta",
  outline: "line",
  hollow: "line",
};

/** A palette by name: the dark and light schemes, and the two alphas today's widgets already use. */
export interface NLookPalette {
  dark: NLookScheme;
  light: NLookScheme;
  alpha?: { dim?: number; rule?: number };
  note?: string;
}

/**
 * The type tokens format 1 promises in EVERY target. A font that fails to register falls to the design's next font, then
 * `sans`. Android widgets are the one build-locked case (setTypeface is not remotable), so only res/font faces work there.
 *   sans     the system face, weights 400 to 800
 *   brand    Geist (Medium, SemiBold)
 *   display  Bricolage Grotesque SemiBold
 *   dots     a dot-matrix face (Doto, OFL), which suits the dotted bot
 *   mono     the system monospace
 */
export const TYPE_TOKENS = ["sans", "brand", "display", "dots", "mono"] as const;
export type TypeToken = (typeof TYPE_TOKENS)[number];

/** Text weights a design may ask for. */
export const TEXT_WEIGHTS = [400, 500, 600, 700, 800] as const;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * `if` is an AND over keys; each key is an OR over its allowed values. There are no expressions, ever.
 *   "if": { "family": ["medium","large"], "appearance": "dark", "mode": ["full"], "reduced": false }
 */
export interface NLookCondition {
  /** The widget family or activity region being drawn. */
  family?: NLookRoot | NLookRoot[];
  appearance?: "dark" | "light" | ("dark" | "light")[];
  /** iOS widgetRenderingMode. */
  mode?: NLookRenderMode | NLookRenderMode[];
  /** Always-On (isLuminanceReduced). */
  reduced?: boolean;
  /** The glance's case. */
  case?: string | string[];
  /** The activity's phase. */
  phase?: string | string[];
  /** A bind path that resolves to something non-empty. */
  has?: string;
  platform?: "ios" | "android";
  /** Whether the widget token can answer a needs item right here. */
  canAnswer?: boolean;
  /** The Lock Screen / StandBy case: !showsWidgetContainerBackground. */
  standby?: boolean;
}

export const CONDITION_KEYS = [
  "family", "appearance", "mode", "reduced", "case", "phase", "has", "platform", "canAnswer", "standby",
] as const;

export type NLookRenderMode = "full" | "accented" | "vibrant";

// ---------------------------------------------------------------------------
// Buttons: only actions the binary already has
// ---------------------------------------------------------------------------

/**
 * A button either answers a needs item with the widget's own token, or opens a vetted link. A design can never widen the
 * token's scope and can never name a new kind of action: both App Intent types are compiled in.
 */
export type NLookAct =
  | { item: string; action: string }
  ;

/** Link schemes a design may open. Checked on the server AND again natively. */
export const LINK_ALLOW = {
  /** Our own scheme, the only one a widget, an Activity or a key may open. */
  scheme: "tulmi",
  /** The one https shape today's allow-list permits. */
  httpsPrefix: "https://github.com/",
} as const;

// ---------------------------------------------------------------------------
// Bind paths: the closed table
// ---------------------------------------------------------------------------

/** What a bound value is, so a renderer knows how to draw it without guessing. */
export type BindKind = "text" | "number" | "bool" | "date" | "color" | "list" | "link";

export interface BindPath {
  readonly on: readonly NLookSurface[];
  readonly kind: BindKind;
  /**
   * Words that can be private. On accessory families and on `activity.lock` a sensitive path resolves to the lock-safe fill
   * when the item is `private`; on iOS the text is also wrapped in privacySensitive(). A design cannot opt out.
   */
  readonly sensitive?: true;
  /** For `kind: "list"`: the `it.*` names a child of `Each` may bind, and that an index may reach. */
  readonly items?: readonly string[];
  /** Which of those item names carry words that can be private. They stay sensitive through an index or an `it.`. */
  readonly sensitiveItems?: readonly string[];
  /** Item names that are themselves lists, and the EACH_LISTS key each one is. */
  readonly itemLists?: Readonly<Record<string, string>>;
  /** For a list of plain strings: a child binds `{{it}}`, not `{{it.something}}`. */
  readonly scalar?: true;
}

/**
 * EVERY path a design may bind, and nothing else. An unknown path gives an empty string, and a Text that resolves to empty
 * hides itself, so an older build degrades quietly rather than drawing a hole.
 *
 * Widget paths mirror glance v2's own field names (tulmi/src/widgets/glance.ts GlanceV2). The renderer evaluates them against
 * the glance AS OF the current timeline step (`asOf`), so today's `steps` keep working with no new glance.
 * Activity paths are ContentState's own field names (tulmi/src/widgets/activity.ts).
 *
 * A key ending in ".*" is a PREFIX: any one further segment is allowed under it (words.step, vars.eta).
 */
export const BIND_PATHS: Readonly<Record<string, BindPath>> = {
  // ---- the glance (widget) ----
  "case": { on: ["widget"], kind: "text" },
  "greeting.hello": { on: ["widget"], kind: "text" },
  "greeting.line": { on: ["widget"], kind: "text" },
  "greeting.part": { on: ["widget"], kind: "text" },
  "summary": { on: ["widget"], kind: "text" },
  "week.done": { on: ["widget"], kind: "number" },
  "week.minutesSaved": { on: ["widget"], kind: "number" },
  "week.dots": { on: ["widget"], kind: "number" },
  "week.line": { on: ["widget"], kind: "text" },
  "bots": {
    on: ["widget"], kind: "list",
    items: ["slug", "name", "color", "face", "faceUrl", "state", "needs", "working", "line", "link"],
  },
  "more": { on: ["widget"], kind: "number" },
  "needs.count": { on: ["widget"], kind: "number" },
  "needs.items": {
    on: ["widget"], kind: "list",
    items: ["id", "kind", "bot", "botName", "face", "question", "choices", "decideLink", "private", "answerable", "link", "at"],
    // A bot's question can say anything the person wrote or the bot read, so it stays private through an index or an `it.`.
    sensitiveItems: ["question"],
    itemLists: { choices: "needs.items[].choices" },
  },
  "needs.items[].choices": {
    on: ["widget"], kind: "list",
    items: ["id", "label", "primary"],
  },
  "job.id": { on: ["widget"], kind: "text" },
  "job.bot": { on: ["widget"], kind: "text" },
  "job.task": { on: ["widget"], kind: "text", sensitive: true },
  "job.stage": { on: ["widget"], kind: "number" },
  "job.of": { on: ["widget"], kind: "number" },
  "job.stageName": { on: ["widget"], kind: "text" },
  // A list of plain stage names: a child of an Each binds "{{it}}", not "{{it.something}}".
  "job.stages": { on: ["widget"], kind: "list", scalar: true },
  "job.startedAt": { on: ["widget"], kind: "date" },
  "job.phase": { on: ["widget"], kind: "text" },
  "job.link": { on: ["widget"], kind: "link" },
  "lastDone.id": { on: ["widget"], kind: "text" },
  "lastDone.bot": { on: ["widget"], kind: "text" },
  "lastDone.botName": { on: ["widget"], kind: "text" },
  "lastDone.face": { on: ["widget"], kind: "text" },
  "lastDone.result": { on: ["widget"], kind: "text", sensitive: true },
  "lastDone.endedAt": { on: ["widget"], kind: "date" },
  "lastDone.minutes": { on: ["widget"], kind: "number" },
  "lastDone.failed": { on: ["widget"], kind: "bool" },
  "lastDone.pr.number": { on: ["widget"], kind: "number" },
  "lastDone.pr.url": { on: ["widget"], kind: "link" },
  "lastDone.link": { on: ["widget"], kind: "link" },
  "counts.working": { on: ["widget"], kind: "number" },
  "counts.needs": { on: ["widget"], kind: "number" },
  // The lock-safe words the server already writes for a locked phone.
  "lock.inline": { on: ["widget"], kind: "text" },
  "lock.title": { on: ["widget"], kind: "text" },
  "lock.line": { on: ["widget"], kind: "text" },
  "links.ask": { on: ["widget"], kind: "link" },
  "links.home": { on: ["widget"], kind: "link" },
  "links.mic": { on: ["widget"], kind: "link" },

  // ---- the Live Activity (ContentState) ----
  "bot": { on: ["activity", "liveupdate"], kind: "text" },
  "botName": { on: ["activity", "liveupdate"], kind: "text" },
  "face": { on: ["activity", "liveupdate"], kind: "text" },
  "task": { on: ["activity", "liveupdate"], kind: "text", sensitive: true },
  "stage": { on: ["activity", "liveupdate"], kind: "number" },
  "of": { on: ["activity", "liveupdate"], kind: "number" },
  "stageName": { on: ["activity", "liveupdate"], kind: "text" },
  "stages": { on: ["activity", "liveupdate"], kind: "list", scalar: true },
  "startedAt": { on: ["activity", "liveupdate"], kind: "date" },
  "phase": { on: ["activity", "liveupdate"], kind: "text" },
  "question": { on: ["activity"], kind: "text", sensitive: true },
  "choices": { on: ["activity"], kind: "list", items: ["id", "label", "primary"] },
  "itemId": { on: ["activity"], kind: "text" },
  "itemKind": { on: ["activity"], kind: "text" },
  "decideLink": { on: ["activity", "liveupdate"], kind: "link" },
  "private": { on: ["activity"], kind: "bool" },
  "result": { on: ["activity"], kind: "text", sensitive: true },
  "failed": { on: ["activity"], kind: "bool" },
  "minutes": { on: ["activity"], kind: "number" },
  "pr.number": { on: ["activity"], kind: "number" },
  "pr.url": { on: ["activity"], kind: "link" },
  "link": { on: ["activity", "liveupdate"], kind: "link" },

  // ---- open-ended prefixes ----
  /**
   * The widget knobs' words, in the person's language, exactly as the widget fills them today.
   *
   * On `activity` and `liveupdate` the words come from the LAST GLANCE THE APP STORED, not from the push: the App Group on
   * iOS (BotsWords already reads X0Glance this way) and the x0.glance prefs on Android. A push carries no words, so a word
   * is the one thing a design may bind on those surfaces that is not in ContentState.
   *
   * A word may carry slots ({n}, {stage}, {of}). WORD_SLOTS below says what fills each one, per surface.
   */
  "words.*": { on: ["widget", "activity", "liveupdate"], kind: "text" },
  /**
   * The free map the server fills (bind.ts), and the ONE way a future design binds new data without changing the frozen
   * ContentState struct. Free strings cannot be classified, so vars is SENSITIVE BY DEFAULT: on lock and accessory roots it
   * resolves to the lock-safe fill when the item is private.
   */
  "vars.*": { on: ["widget", "activity", "liveupdate"], kind: "text", sensitive: true },
};

/**
 * WHAT FILLS A WORD'S SLOTS. A word from the knobs may hold slots — "Step {stage} of {of}", "{n} working" — and "filled as
 * today" is not one rule: today's views fill `working`'s {n} with three different numbers depending on the root
 * (X0Widget.swift:171, :815). So format 1 pins it here, closed, and every renderer reads this table.
 *
 * `widget` names a glance path; `state` names a ContentState field, used by both `activity` and `liveupdate`.
 * `minutesSince` is the ONE computed fill format 1 allows: whole minutes from that date to the entry's own date.
 *
 * THE RULE THAT MATTERS: a word whose slot has no fill on this surface resolves to EMPTY, and an empty Text hides. A raw
 * "{n}" never prints. That is why `working` is a widget word only — the Activity has no running count to put in it.
 */
export type WordSlotFill =
  | { readonly path: string }
  | { readonly minutesSince: string }
  | null;

export interface WordSlot {
  /** The fill on a widget root, from the glance. */
  readonly widget: WordSlotFill;
  /** The fill on the Live Activity and the Android notice, from ContentState. */
  readonly state: WordSlotFill;
}

export const WORD_SLOTS: Readonly<Record<string, Readonly<Record<string, WordSlot>>>> = {
  step: {
    stage: { widget: { path: "job.stage" }, state: { path: "stage" } },
    of: { widget: { path: "job.of" }, state: { path: "of" } },
  },
  working: {
    n: { widget: { path: "counts.working" }, state: null },
  },
  minIn: {
    n: { widget: { minutesSince: "job.startedAt" }, state: { minutesSince: "startedAt" } },
  },
  min: {
    n: { widget: { path: "lastDone.minutes" }, state: { path: "minutes" } },
  },
  pr: {
    n: { widget: { path: "lastDone.pr.number" }, state: { path: "pr.number" } },
  },
};

/** Which half of a WordSlot a surface reads. */
export function wordSlotSideFor(surface: NLookSurface): "widget" | "state" {
  return surface === "widget" ? "widget" : "state";
}

/** What fills one slot of one word on one surface, or null when nothing on this surface does. */
export function wordSlotFill(word: string, slot: string, surface: NLookSurface): WordSlotFill {
  const slots = Object.prototype.hasOwnProperty.call(WORD_SLOTS, word) ? WORD_SLOTS[word] : undefined;
  if (!slots || !Object.prototype.hasOwnProperty.call(slots, slot)) return null;
  return slots[slot][wordSlotSideFor(surface)];
}

/**
 * Whether a word can be drawn at all on this surface: every slot it declares has a fill here. A word with no slots always
 * can. False means the Text resolves to empty and hides, rather than printing a bare "{n}".
 */
export function wordResolvesOn(word: string, surface: NLookSurface): boolean {
  const slots = Object.prototype.hasOwnProperty.call(WORD_SLOTS, word) ? WORD_SLOTS[word] : undefined;
  if (!slots) return true;
  const side = wordSlotSideFor(surface);
  return Object.keys(slots).every((slot) => slots[slot][side] !== null);
}

/** The lists `Each.of` may walk. A bounded repeat over data, never a loop. */
export const EACH_LISTS = ["bots", "needs.items", "needs.items[].choices", "job.stages", "stages", "choices"] as const;
export type EachList = (typeof EACH_LISTS)[number];

/** Inside an `Each`, a child binds `it.<name>`; the names come from the list's `items`. A scalar list binds plain `it`. */
export const EACH_ITEM_PREFIX = "it.";

/**
 * A list may also be reached by a LITERAL index, 0 to 7: "needs.items[0].question". That is still a closed form — a number
 * written in the design, never computed — and it is how a widget leads with the first question, the way today's views do.
 */
export const INDEXED_PATH = /^([a-z][a-zA-Z.]*)\[([0-7])\]\.(.+)$/;

/** A template slot: "{{job.task}}" or "{{words.step}}". Slots inside a word ({n}, {stage}, {of}) are filled by WORD_SLOTS. */
export const BIND_OPEN = "{{";
export const BIND_CLOSE = "}}";

/**
 * The path a `{{…}}` names, or null when it is not one this build knows (and so resolves to an empty string).
 * Four shapes resolve: an exact path; a prefix path (words.*, vars.*) with one segment under it; a literal index into a list
 * ("needs.items[0].question"); and an item of a list already reached ("needs.items[0].choices[1].label").
 * A sensitive item name stays sensitive through every one of them: the privacy rule lives here, not in each design.
 */
export function bindPathInfo(path: string): BindPath | null {
  if (Object.prototype.hasOwnProperty.call(BIND_PATHS, path)) return BIND_PATHS[path];

  const indexed = INDEXED_PATH.exec(path);
  if (indexed) {
    const [, listPath, , rest] = indexed;
    const list = Object.prototype.hasOwnProperty.call(BIND_PATHS, listPath) ? BIND_PATHS[listPath] : undefined;
    if (!list || list.kind !== "list") return null;
    return itemInfo(list, rest);
  }

  const dot = path.indexOf(".");
  if (dot <= 0) return null;
  const prefix = `${path.slice(0, dot)}.*`;
  if (!Object.prototype.hasOwnProperty.call(BIND_PATHS, prefix)) return null;
  // One segment only: "vars.eta" yes, "vars.a.b" no.
  return path.indexOf(".", dot + 1) === -1 ? BIND_PATHS[prefix] : null;
}

/** One field of a list's item, by name. `rest` may itself index a nested list ("choices[1].label"). */
function itemInfo(list: BindPath, rest: string): BindPath | null {
  const nested = INDEXED_PATH.exec(rest);
  if (nested) {
    const [, name, , deeper] = nested;
    const key = list.itemLists?.[name];
    if (!key || !Object.prototype.hasOwnProperty.call(BIND_PATHS, key)) return null;
    return itemInfo(BIND_PATHS[key], deeper);
  }
  if (rest.includes(".")) return null;
  if (!list.items?.includes(rest)) return null;
  const sensitive = list.sensitive === true || list.sensitiveItems?.includes(rest) === true;
  return { on: list.on, kind: "text", ...(sensitive ? { sensitive: true as const } : {}) };
}

/**
 * The EACH_LISTS key an `Each.of` names, or null when it names no list this build knows.
 * `of` may carry a literal index ("needs.items[0].choices"); the key is the same list either way ("needs.items[].choices"),
 * because an index picks WHICH item, not which list.
 */
export function eachListKey(of: string): EachList | null {
  const key = of.replace(/\[[0-7]\]/g, "[]");
  return (EACH_LISTS as readonly string[]).includes(key) ? (key as EachList) : null;
}

/** What a child of an `Each` may bind: `it` for a list of plain strings, `it.<name>` otherwise. Null when it cannot. */
export function eachItemInfo(listPath: string, binding: string): BindPath | null {
  const list = Object.prototype.hasOwnProperty.call(BIND_PATHS, listPath) ? BIND_PATHS[listPath] : undefined;
  if (!list || list.kind !== "list") return null;
  if (binding === "it") return list.scalar ? { on: list.on, kind: "text" } : null;
  if (!binding.startsWith(EACH_ITEM_PREFIX)) return null;
  return list.scalar ? null : itemInfo(list, binding.slice(EACH_ITEM_PREFIX.length));
}

/** Whether this path's words may be private, so the renderer redacts them on a lock or accessory root. */
export function isSensitivePath(path: string): boolean {
  return bindPathInfo(path)?.sensitive === true;
}

/** Whether a build may bind this path on this surface at all. */
export function bindsOn(path: string, surface: NLookSurface): boolean {
  const info = bindPathInfo(path);
  return !!info && info.on.includes(surface);
}

// ---------------------------------------------------------------------------
// The path grammar (shared with the bots' looks and the keyboard's marks)
// ---------------------------------------------------------------------------

/**
 * `M L Q C Z O` — the bots' looks format 1 grammar plus `C` (the animation spec's format-2 cubic) and `O` (a circle: cx cy r).
 * Every native parser accepts this superset from day one (NLookPath.swift, KBPath.swift, KbPath.kt, NLookPaint.kt), so a path
 * written for an animation scene stays drawable as a widget shape or a key print. An unknown command drops only that path.
 */
export const PATH_COMMANDS = ["M", "L", "Q", "C", "Z", "O"] as const;
export type PathCommand = (typeof PATH_COMMANDS)[number];

// ---------------------------------------------------------------------------
// Limits — clamped by the server's clean, the phone's clean, and native code
// ---------------------------------------------------------------------------

/**
 * When a limit is passed, the node, image or design is DROPPED and its fallback is used. A limit never means a crash and never
 * a blank widget. On Android that holds only because the planner counts RemoteViews levels itself: the launcher's own nesting
 * error ("Too many nested views.", MAX_NESTED_VIEWS = 10) cannot be caught by our code.
 */
export const NLOOK_LIMITS = {
  /** Design ids: [a-z0-9._-], 1 to 40 characters. */
  idPattern: /^[a-z0-9._-]{1,40}$/,

  /** The whole catalog as sent to one phone, raw (it is gzipped on the wire). */
  catalogBytes: 256 * 1024,

  widget: {
    designBytes: 16 * 1024,
    nodes: 150,
    nodesPerRoot: 80,
    /** iOS tree depth. Android counts RemoteViews levels instead (see `android`). */
    depth: 10,
  },
  activity: {
    designBytes: 8 * 1024,
    nodesPerRoot: { lock: 50, island: 20, compact: 6, minimal: 3 } as Readonly<Record<string, number>>,
  },
  android: {
    /** RemoteViews levels COUNTED BY THE PLANNER, including the size-map level and every wrapper fragment. */
    levels: 8,
    eachCopies: 8,
    viewsPerSize: 60,
    /** nlook needs API 31: setViewLayoutWidth/Height/Margin, setColorStateList with a night variant, outline radius. */
    minSdk: 31,
    /** Share of the launcher's RemoteViews bitmap budget we may use, summed across every listed size. */
    bitmapBudgetShare: 0.7,
  },

  /** Apple's cap is 4 KB. The server, BotsLiveActivity.parse() and the JS activity plan all stop at this. */
  activityBodyBytes: 3.5 * 1024,
  vars: { keys: 12, keyChars: 24, valueChars: 120 },
  textChars: 200,
  eachMax: 8,
  path: { commands: PATH_COMMANDS, dChars: 900, perShape: 12 },

  art: {
    /** On disk: PNG only, checked by magic bytes, sha256 and these caps before the file is moved into place. */
    fileBytes: 512 * 1024,
    longEdgePx: 1200,
    files: 64,
    totalBytes: 6 * 1024 * 1024,
    /** Bot stills have their own budget: they are drawn on the phone, only for what is shown. */
    stillFiles: 24,
    stillBytes: 2 * 1024 * 1024,
    /** Decoded art per render. The iOS widget extension has about 30 MB in all. */
    decodedIosBytes: 12 * 1024 * 1024,
    /** Live Activity per-region caps, applied at load: one art key can be used in both the island and the banner. */
    regionMaxPx: { island: 135, lock: 252 } as Readonly<Record<string, number>>,
  },

  fonts: { fileBytes: 300 * 1024, inCatalog: 4 },
} as const;

/** The `activity` node cap for a root: island.* and compact.* share theirs. */
export function activityNodeCap(root: string): number {
  const caps = NLOOK_LIMITS.activity.nodesPerRoot;
  if (root === "lock") return caps.lock;
  if (root === "minimal") return caps.minimal;
  if (root.startsWith("island.")) return caps.island;
  if (root.startsWith("compact.")) return caps.compact;
  return caps.minimal;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/**
 * ONE FILE of one art entry: the @1, @2 and @3 copies are DIFFERENT BYTES, so each carries its own hash. The phone checks what
 * it downloaded against the hash of that file, which is also its name: GET /v1/native/art/<sha256>@<scale>.png.
 */
export interface NLookArtFile {
  scale: 1 | 2 | 3;
  sha256: string;
  bytes: number;
}

/**
 * One art entry: a picture a design names as `art:<key>`, served content-addressed and immutable. The server refuses to
 * publish a catalog whose files are not on disk under their own hash (shared/native/art/<sha256>@<scale>.png).
 */
export interface NLookArt {
  key: string;
  /** Pixels of the LARGEST file (the long-edge cap is read from these). */
  w: number;
  h: number;
  /** One entry per scale served, each with the hash of that one file. At least one, at most three, scales unique. */
  files: NLookArtFile[];
}

/**
 * One hooked font: TTF or OTF, registered at runtime (CTFontManagerRegisterFontsForURL / Typeface.createFromFile).
 * Served at GET /v1/native/font/<sha256> — the file on disk is named by its hash with NO extension.
 */
export interface NLookFont {
  id: string;
  sha256: string;
  bytes: number;
  platforms: ("ios" | "android")[];
}

/** Android's ongoing notice is a template fill, not a canvas: Android 16 Live Updates refuse custom layouts. */
export interface LiveUpdateFill {
  title?: string;
  text?: string;
  sub?: string;
  /** The status-bar chip (and Always-On). Non-sensitive paths only. */
  chip?: string;
  progress?: { segments?: string; at?: string; color?: NLookColor; track?: NLookColor };
  /** Art keys. */
  tracker?: string;
  large?: string;
  color?: NLookColor;
  /** At most 3, each from the allow-list: answer the item, or open a vetted link. */
  actions?: { label: string; act?: NLookAct; open?: string }[];
}

/** One design. Its `format` is its own: a design too new for this build is skipped alone, and the rest are kept. */
export interface NLookDesign {
  id: string;
  format: number;
  surface: NLookSurface;
  /** The design to use where this one cannot be (format, platform, budget, marked bad). Then the native view. */
  fallback?: string;
  /** Which palette its role colours resolve against. */
  palette?: string;
  /** widget / activity: one node tree per root. A missing root falls back to today's view for that root alone. */
  roots?: Partial<Record<NLookRoot, NLookNode>>;
  /** liveupdate only. */
  fill?: LiveUpdateFill;
  /** Every art key it uses, so the phone preloads and the server can check they exist. */
  art?: string[];
  note?: string;
  /** The first catalog `v` that held this content. COMPUTED BY THE SERVER at publish, never written by an author. */
  since?: number;
}

/**
 * The surfaces a targeting rule may name. Lives here, not in the server, so the rule's shape and the catalog's types are read
 * from one file: `experience/native/target.ts` imports it as `TargetSurface`. "widget:board" is the spare "X0 Board" kind and
 * "notice:bots" is the Android ongoing notice, which is what Android has instead of a Live Activity.
 */
export type NLookTargetSurface = "widget:x0" | "widget:board" | "activity:bots" | "notice:bots" | "keyboard";

/**
 * The design `surface` each targeting surface draws, so a rule can never name an Activity design for a widget. `keyboard` is
 * null because a key skin is not a design at all (it is a skin file; see keyboardFace.ts). Lives here so the publish check
 * (experience/native/catalog.ts) and the picker (experience/native/target.ts) read the same map without importing each other.
 */
export const NLOOK_TARGET_SURFACES: Readonly<Record<NLookTargetSurface, NLookSurface | null>> = {
  "widget:x0": "widget", "widget:board": "widget", "activity:bots": "activity", "notice:bots": "liveupdate", keyboard: null,
};

/** A server-only targeting rule. Stripped before anything is sent to a phone. */
export interface NLookTarget {
  surface: NLookTargetSurface;
  design: string;
  when?: { users?: string[] };
}

/** shared/native/looks.json. One file, one version. */
export interface NLookCatalog {
  /** Content version. NEVER repeats: the server keeps a high-water mark, so a rollback re-serves under a higher `v`. */
  v: number;
  /** The catalog's own shape. Each design carries its own `format` too. */
  format: number;
  note?: string;
  /** Role maps. THE source for widget colour: it replaces the widgets.look literals, X0Palette and WidgetInk. */
  palettes: Record<string, NLookPalette>;
  designs: Record<string, NLookDesign>;
  art?: NLookArt[];
  fonts?: NLookFont[];
  /** Server-only (§5.3). Stripped from everything a phone receives. */
  targets?: NLookTarget[];
}

/** What the phone writes next to its designs, so a widget can find one by id without parsing the catalog. */
export interface NLookIndex {
  v: number;
  /** The highest design format this build draws, so a later OTA can raise it and force a refetch. */
  drawsFormat: number;
  palettes: Record<string, NLookPalette>;
  /** design id to the file that holds it, inside the same version folder. */
  designs: Record<string, string>;
  /** art key to the file on disk (nlook/art/<sha>@<scale>.png). */
  art: Record<string, string>;
  fonts?: Record<string, string>;
}

/** What the glance adds for a build that says NativeLook1 and sent its `nl`. */
export interface GlanceLook {
  /**
   * Surface to design id: { "x0": "x0.dusk" }. The keys are
   *   x0      the X0 widget
   *   board   the spare "X0 Board" widget kind (WidgetBoard1 builds only)
   *   bots    "Bots at work" on THIS phone: the Live Activity's design on iOS (needs NATIVE_ACTIVITY), the ongoing
   *           notice's on Android (needs ANDROID_BOTS_NOTICE and a LiveUpdate1 build). One surface per platform, so one key.
   * An older app ignores a key it does not know, and a widget reads only `x0` and `board`.
   */
  look?: Record<string, string>;
  palette?: string;
  vars?: Record<string, string>;
  /**
   * The boards the "X0 Board" widget offers in its own settings, already in this person's language and already filtered to
   * what THIS phone can draw. At most 12; a board with no name is left out. Nobody makes a name out of an id.
   */
  boards?: { id: string; name: string }[];
}
