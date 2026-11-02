/**
 * The phone app's theme: type sizes and roles, colours, and the typefaces it downloads.
 */

import type { TypeRole, ThemeTokens } from "../../../../shared/types/sdui.js";
import { PHONE_FONT } from "../phoneLook.js";

// --- Global theme -----------------------------------------------------------

// Ladder pairs: 13/21 captions, 15 body, 21 lg, 26/34 h1, 34 brand display.
const TYPE_SIZES = { overline: 11, caption: 13, label: 13, body: 15, lg: 21, h1: 26, brand: 34 };

/**
 * The type scale. Every run of text the app sets on its own is one of these:
 * a Text variant, a content block, a button label, a settings row, the title
 * bar, the error and update cards, the native onboarding screens. The
 * renderer reads a role by name and adds nothing — no size, weight, leading,
 * tracking or margin is decided on the device.
 *
 * `family` is a slot: "display" is filled by THEME.font.display, "body" by
 * THEME.font.family. Values mirror what the renderer shipped with, so this
 * moves ownership, not the look. Change a number here and the app follows on
 * the next cache bump.
 */
const S = TYPE_SIZES;

/**
 * The You tab's greeting, whole — every value it has, in one place.
 *
 * It sits up here rather than beside the rest of the You tab because its two
 * lines are part of the type scale, and the scale is built below. Splitting it
 * would have put the sizes in one section, the colours in another and the
 * position in a third, and a three-line greeting is not worth reading three
 * places to change.
 *
 * NOTHING HERE IS SHARED. The sizes start on the golden ladder (13 and 26 are
 * its label and h1 rungs) but they are the greeting's own numbers now, not
 * references to them — so moving the ladder does not move the greeting, and
 * balancing the greeting does not move the app. Same for the two colours.
 * Every value can be set alone, which is what makes the pair adjustable
 * against each other: a name that reads, and a hello that stays behind it.
 */
export const GREET = {
  /** Where the block sits. Top left, on the settings gear's line. */
  top: 56,
  left: 18,
  /** Air between the hello and the name. Two points read as one block of
   *  type set badly; the hello is a label ON the name, not a line of it. */
  gap: 7,
  /**
   * How much width the name may take before it is cut short.
   *
   * The gear is 34pt at 16pt from the right edge, so the name has the screen
   * less about 66pt before the two meet. A long name is trimmed with an
   * ellipsis rather than wrapped: a second line would push the greeting into
   * the deck, and the deck is the thing this screen is for.
   */
  nameMaxWidth: 240,
  nameLines: 1,
  /** How long a hello is held before it turns over. */
  intervalMs: 2600,
  /** The turn itself. Half out, half in. */
  flipMs: 620,
  /**
   * HOW ONE WORD BECOMES THE NEXT — and it is a performance decision here as
   * much as a visual one.
   *
   * "turn" is the 3D flip and it is the better effect. It is also expensive:
   * a rotateX with a perspective makes its parent composite in 3D, and on
   * Android every blurred view beneath re-renders when that happens. This tab
   * carries five of them — a full-screen backdrop and one per card — so the
   * turn showed up as the whole screen flickering on every word: the name,
   * the settings icon, the note under the deck, none of them near the
   * greeting.
   *
   * "fade" is a crossfade. Opacity alone, no transform, no offscreen pass,
   * nothing else disturbed. A caption quietly changing language does not need
   * the more expensive gesture.
   */
  flip: "fade" as "fade" | "turn",
  /** The small tracked line. A label, not a sentence. */
  hello: {
    size: 13,
    weight: "300",
    tracking: 1.6,
    color: "rgba(255,255,255,0.42)",
    /**
     * A FIXED BOX FOR THE WORD, and this is the whole reason it is here.
     *
     * The words are not one script. "Hello" is Latin and sits inside the
     * ascender and descender of its own face; नमस्ते hangs a headline above the
     * letters and drops matras below them; Thai stacks tone marks a second
     * storey up. Each measures a different height, so a line left to size
     * itself grew and shrank as the greeting turned over — and the name, which
     * is laid out under it, stepped down and back up with every word. The one
     * still thing on the screen was moving, and it was moving because of a
     * decoration above it.
     *
     * So the line is given a height once and never asked again. It is set from
     * the tallest script rather than from "Hello", which means a little air
     * under the Latin word and no movement anywhere.
     */
    lineHeight: 22,
  },
  /** The one proper noun on the screen, so it gets the display face. */
  name: {
    family: "display" as const,
    size: 26,
    weight: "300",
    tracking: 0.2,
    color: "rgba(255,255,255,0.96)",
  },
};

export const TYPE_ROLES: Record<string, TypeRole> = {
  // Text variants — `{ type: "Text", props: { variant } }`.
  brand:    { family: "display", size: S.brand, lineHeight: 38, letterSpacing: 0.2, color: "text" },
  h1:       { family: "display", size: S.h1, lineHeight: 34, letterSpacing: 0.3, color: "text" },
  overline: { size: S.overline, weight: "500", letterSpacing: 3, transform: "uppercase", color: "label", marginBottom: 10 },
  quote:    { family: "display", size: S.lg, lineHeight: 28, italic: true, color: "muted" },
  label:    { size: S.label, letterSpacing: 1, color: "label", marginBottom: 8 },
  muted:    { size: S.body, lineHeight: 22, color: "muted" },
  caption:  { size: S.caption, color: "muted" },
  body:     { size: S.body, lineHeight: 26, weight: "300", color: "body" },

  // Content blocks — the same voices with their rhythm attached.
  heading:    { family: "display", size: S.h1, lineHeight: 34, letterSpacing: 0.3, color: "text", marginBottom: 24 },
  paragraph:  { size: S.body, lineHeight: 26, weight: "300", color: "body", marginBottom: 18 },
  quoteBlock: { family: "display", size: S.lg, lineHeight: 28, italic: true, color: "muted", align: "center", marginVertical: 16 },
  badge:      { size: S.overline, weight: "500", letterSpacing: 2.5, transform: "uppercase" },

  // Controls and lists.
  button:          { size: 16, weight: "700", letterSpacing: 0.4 },
  buttonSecondary: { size: 16, weight: "600", letterSpacing: 0.4 },
  chip:            { size: 14 },
  chipSelected:    { size: 14, weight: "700" },
  mic:             { size: S.body, weight: "700" },
  row:             { size: 16, color: "text" },
  rowValue:        { size: S.body, color: "muted" },
  rowChevron:      { size: 20, color: "muted" },
  keyValueLabel:   { size: S.body, color: "muted" },
  keyValueValue:   { size: S.body, weight: "600", color: "text" },
  heroTitle:       { size: S.h1, weight: "800", color: "text" },
  heroSubtitle:    { size: S.body, color: "muted", marginTop: 4 },
  icon:            { size: 20, color: "text" },

  // Greeting grid — the big hello and the language pills under it.
  greeting:     { family: "display", size: 46, weight: "300", letterSpacing: 0.2, align: "center", marginBottom: 40 },
  greetingPill: { size: S.body, weight: "300", letterSpacing: 0.5 },

  // Charts. The ring's one big number, the word under it, and the legend
  // rows beside it. Small and quiet: a chart that shouts is a chart you read
  // instead of the thing it is about.
  chartValue:       { size: 24, weight: "700", color: "text" },
  chartCenterLabel: { size: 9, letterSpacing: 0.8, color: "label" },
  chartLegend:      { size: 11.5, color: "body" },
  chartLegendValue: { size: 11.5, weight: "600", color: "text" },

  // The You tab's greeting. Both lines come off GREET above — the one place
  // that owns this block — so the roles here are a view of it, never a second
  // set of numbers to keep in step.
  /**
   * The portrait sentence on the You tab, and the one live word in it.
   *
   * Sized by value rather than off YOU_UI.portrait, which is declared further
   * down the file — this table is read while the module is still being
   * evaluated, and a reference to a `const` that does not exist yet throws on
   * the first bootstrap, for every user at once. Keep the two in step by hand.
   */
  /** The voice's own name on its card. Sized by value — see the note above. */
  voiceName: { family: "display", size: 34, lineHeight: 38, weight: "800", color: "text" },
  portraitText: { family: "display", size: 21, lineHeight: 26, color: "text" },
  portraitLive: { family: "display", size: 21, lineHeight: 26, italic: true, color: "primary" },
  greetHello: {
    size: GREET.hello.size,
    lineHeight: GREET.hello.lineHeight,
    weight: GREET.hello.weight,
    letterSpacing: GREET.hello.tracking,
    color: "greetHello",
  },
  greetName: {
    family: GREET.name.family,
    size: GREET.name.size,
    weight: GREET.name.weight,
    letterSpacing: GREET.name.tracking,
    color: "greetName",
  },

  // The shell: title bar, error card, refresh banner, update gate, toast.
  title:        { size: 22, weight: "800", color: "text" },
  headerIcon:   { size: 24, weight: "700", color: "text" },
  toast:        { size: 14 },
  errorTitle:   { size: 18, weight: "700", color: "text", marginBottom: 8 },
  errorBody:    { size: 14, color: "muted", align: "center", marginBottom: 20 },
  errorAction:  { size: 14, weight: "700" },
  banner:       { size: 14, weight: "600" },
  updateTitle:  { size: 22, weight: "800", color: "text", align: "center", marginBottom: 10 },
  updateBody:   { size: S.body, lineHeight: 22, color: "muted", align: "center", marginBottom: 22 },
  updateAction: { size: S.body, weight: "700" },
  updateLater:  { size: 14, color: "muted" },

  // The sign-in screen's own chrome. The brand and tagline sizes live in
  // AUTH_UI (that screen's contract); these are the rest of its type.
  authField:    { size: S.body, weight: "300", letterSpacing: 0.3 },
  authPrompt:   { size: S.body, weight: "300", letterSpacing: 0.3 },
  authCode:     { size: 17, weight: "300" },
  authNote:     { size: 12, align: "center" },
  authSearch:   { size: S.body },
  authPickName: { size: S.body, weight: "300" },
  authPickDial: { size: 14 },

  // Native onboarding — the language picker and the name card draw before
  // any screen JSON exists, but after bootstrap, so they read the scale too.
  langGreeting:  { size: 52, weight: "300", align: "center" },
  langPill:      { size: S.body, weight: "300", letterSpacing: 0.5 },
  profileHello:  { family: "display", size: 32, weight: "700", marginBottom: 18 },
  profileName:   { size: 22, weight: "300", align: "center" },
  profileLabel:  { size: 12 },
  profileAction: { size: 16, weight: "700" },
};

export const THEME: ThemeTokens = {
  color: {
    bg: "#000000",
    surface: "#000000",
    card: "#0b0b0f",
    inputBg: "#0e0e12",
    border: "rgba(255,255,255,0.10)",
    // WHITE primary — matches the original Plutto-style design (black
    // surface with white primary CTAs). The brand accent is the warm amber
    // sampled from mic.animation, and it is reserved for what is live right
    // now (recording, listening, a live voice session). See ACCENT_AMBER.
    primary: "#FFFFFF",
    text: "rgba(255,255,255,0.96)",
    body: "rgba(255,255,255,0.74)",
    muted: "rgba(255,255,255,0.55)",
    label: "rgba(255,255,255,0.42)",
    danger: "#e0556b",
    success: "#4caf50",
    // The app reads these; until now they fell back to values in its code.
    // primaryText is the label ON a primary (white) button — the update
    // gate's button text was white on white without it.
    primaryText: "#000000",
    errorBanner: "#3a1417",
    errorBannerText: "#FFFFFF",
    toastError: "#3a1417",
    toastSuccess: "#13301a",
    toastInfo: "#1c1c25",
    toastText: "#FFFFFF",
    tabBar: "transparent",
    updateOverlay: "rgba(8,8,12,0.96)",
    hairline: "rgba(255,255,255,0.12)",
    // The You tab's greeting, one token per line, both owned by GREET. Kept
    // apart from `label` and `text` on purpose: those two carry most of the
    // app's type, so the pair could not be balanced against each other
    // without dragging every caption and heading along.
    greetHello: GREET.hello.color,
    greetName: GREET.name.color,
  },
  // GOLDEN SCALE (φ via the Fibonacci ladder 5·8·13·21·34·55): every spacing
  // step and type size in the app comes off this ladder, so screens compose
  // on one ratio instead of ad-hoc values.
  space: { xs: 5, sm: 8, md: 13, lg: 21, xl: 34, content: 21, contentTop: 34 },
  radius: { sm: 8, md: 13, card: 18, pill: 999 },
  font: {
    sizes: TYPE_SIZES,
    weights: { light: "300", regular: "400", medium: "500", bold: "700", heavy: "800" },
    // The two faces. Any name in FONTS below, or one the OS already has.
    // Unset: body is the system font, display is the platform serif.
    // family: "Tailzu Sans",
    // display: "Tailzu Display",
    roles: TYPE_ROLES,
  },
};

/**
 * Typefaces the app downloads and registers at boot.
 *
 * The app bundles no fonts and until now could only name what the OS already
 * had, so changing the product's typeface meant adding a file to the repo and
 * shipping a build — the one design change that should never need one.
 *
 * Add an entry and every screen can use it: THEME.font.family for the running
 * text, THEME.font.display for headings, or style.fontFamily on one node.
 *
 *   "Tailzu Display": "https://api.x0bot.com/media/display.ttf"
 *
 * Serve the file from the media registry (upload it like any other asset) or
 * any https host. The client refuses anything that is not https and does not
 * end in .ttf/.otf/.woff/.woff2, loads them in the background, and falls back
 * to the system font for any that fail — a dead URL costs a fallback, never a
 * blank screen.
 */
const FONT_BASE = `${process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"}/fonts/`;
export const FONTS: Record<string, string> = {
  // Tailzu's four voices on paper (tulmi/fonts, served by server.ts): the
  // written line, what was said in a hand, the small labels, and the UI.
  // One family per face: a custom font's weight is its file, not fontWeight.
  [PHONE_FONT.writtenLight]: `${FONT_BASE}written-light.ttf?v=1`,
  [PHONE_FONT.writtenLightItalic]: `${FONT_BASE}written-light-italic.ttf?v=1`,
  [PHONE_FONT.written]: `${FONT_BASE}written.ttf?v=1`,
  [PHONE_FONT.writtenItalic]: `${FONT_BASE}written-italic.ttf?v=1`,
  [PHONE_FONT.said]: `${FONT_BASE}said.ttf?v=1`,
  [PHONE_FONT.label]: `${FONT_BASE}label.ttf?v=1`,
  [PHONE_FONT.ui]: `${FONT_BASE}ui.ttf?v=1`,
  [PHONE_FONT.uiMedium]: `${FONT_BASE}ui-medium.ttf?v=1`,
  // The titles: Instrument Sans and Newsreader at 700, cut the same way.
  [PHONE_FONT.uiBold]: `${FONT_BASE}ui-bold.ttf?v=1`,
  [PHONE_FONT.writtenBold]: `${FONT_BASE}written-bold.ttf?v=1`,
  // The new onboarding's two: Bricolage Grotesque at 800 for its headings and
  // the code's digits, Kalam for what Blip says.
  [PHONE_FONT.grotesk]: `${FONT_BASE}grotesk.ttf?v=1`,
  [PHONE_FONT.hand]: `${FONT_BASE}hand.ttf?v=1`,
};
