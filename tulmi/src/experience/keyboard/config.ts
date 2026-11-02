/**
 * GET /v1/keyboard/config: everything the native keyboards draw and do, as data.
 */

import type { Personality } from "../../../../shared/types/api.js";
import { type KeyboardConfigResponse, type KeyboardNode, type KeyboardActionSpec, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { withKeyboardKnobs } from "../appKnobs.js";
import { keyboardLists } from "../appLists.js";
import { currentCacheVersion } from "../cacheVersion.js";
import { FLOW_IDLE_TIMEOUT_MS, FLOW_TRANSPORT } from "../flow.js";
import { getMediaRegistryFn } from "../mediaRegistry.js";
import { applyPresetOverrides, TONE_LABELS, DEFAULT_TONE, MAX_PINNED_PRESETS } from "../personalityPresets.js";
import { TAB_PALE } from "../phone/navigation.js";
import { freeForAll } from "../policy.js";
import { applyRollouts, activeRollouts } from "../rollout.js";
import { WORDS_GATE } from "../wordsGate.js";
import { HOUSE_TONE } from "./houseTone.js";
import {
  KB_ROW_LETTERS_1, KB_ROW_LETTERS_2, KB_ROW_LETTERS_3, kLetter, kHalfSpacer, KEY_FILL_FUNCTION, KEY_TEXT_FUNCTION, KB_ROW_NUM_1, kPunct,
  KB_ROW_NUM_2, KB_ROW_PUNCT_3, KB_ROW_SYM_1, KB_ROW_SYM_2, KEY_FILL_SPACE, KEY_FILL_RETURN, KEYBOARD_GROUND, KEY_FILL_LETTER, KEY_TEXT,
  KEY_PRESSED, LIGHT_KEYBOARD_GROUND, LIGHT_KEY_FILL_LETTER, LIGHT_KEY_TEXT, LIGHT_KEY_PRESSED,
} from "./keys.js";
import { makeToolsRow } from "./toolsRow.js";

/** Which keyboard is asking. Derived server-side from the request, never
 *  asserted by the client — see keyboardPlatform(). */
export type KeyboardPlatform = "ios" | "android";

export function buildKeyboardConfig(
  personality?: Personality,
  /** Stable id used to place this user in a rollout slice. Omit for anonymous
   *  callers — they get the baseline rather than a per-request coin flip. */
  userId?: string,
  opts: {
    platform?: KeyboardPlatform;
    /** What is left to spend. Absent for an anonymous or unreadable caller,
     *  and then the mic behaves as it always did and the 429 catches it. */
    quota?: { remaining: number; total: number; entitled: boolean };
    /** The keyboard binary's build number (the K-stamp), from the request
     *  header `X-Tulmi-Keyboard-Build`. Absent from builds before K37, which
     *  never sent one — and which must not be given the veil's blur. */
    kbBuild?: number;
  } = {},
): KeyboardConfigResponse {
  /** K37 is the first build that raises the recording veil above the keys and
   *  lets the mic through it. Only such a build may wear the blur: on an older
   *  one the veil sits buried behind the tree, where a material paints as a
   *  grey sheet through a transparent keyboard. */
  const veilBlurs = (opts.kbBuild ?? 0) >= 37;
  // English QWERTY. The physical layout arrays are also emitted (below) so
  // older keyboard binaries — the ones without the SDUI renderer — can still
  // render the legacy hand-built keyboard. `features.sdui: true` is the switch
  // the SDUI-capable binary flips to walk `root` instead.
  const letterRow1 = KB_ROW_LETTERS_1;
  const letterRow2 = KB_ROW_LETTERS_2;
  const letterRow3 = KB_ROW_LETTERS_3;

  // Emoji layer removed. Users can access the system emoji keyboard via the
  // globe key in the iOS extension bar below Tulmi, so shipping our own
  // grid was duplicating that at the cost of a keyboard slot.

  // The whole keyboard as a tree. Column of rows; suggestion bar + waveform
  // are conditionally visible via visibleIf against KBState the renderer maintains.
  //
  // IMPORTANT: the blur backdrop is set on theme.backgroundEffect (which the
  // renderer applies to the ENTIRE inputView — Apple's exact behavior). We do
  // NOT put a `blur` effect on this Container too, or we double up and the
  // whole thing reads slightly dimmer than native. Padding is also minimal
  // (3px each side) — Apple's own keyboard edges the keys almost to the screen
  // border; more inner padding is what was making our keyboard look boxed.
  const root: KeyboardNode = {
    type: "Container",
    // Geometry aligned to NATIVE iOS to minimise user discomfort (values from
    // measured Apple teardowns; Apple publishes none officially):
    //   • L/R margin 3pt, top 8pt, bottom 4pt — matches native padding; the 34pt
    //     home-indicator area sits below this on Face ID phones automatically,
    //     which is why native bottom padding is small.
    //   • Horizontal gap between keys 6pt (native constant) — set per-row below.
    //   • Vertical gap between rows 10pt — inside Apple's measured ~10–12pt.
    //   • Row/key height 44pt (set per-row below) — matches a modern iPhone's
    //     ~43–46pt key. (Was 50pt "for a roomier feel"; that read taller than
    //     native, especially on smaller phones.)
    //
    // ANDROID GETS NO SIDE OR BOTTOM PADDING. On iOS that 3pt edge is reclaimed
    // by kb.touch.edgeToMargin, which hands each row's outermost key its own
    // margin, so a touch in it types "a" rather than nothing. Android has no
    // such rule and its key plane works a row at a time, so it cannot reach
    // outside the row it belongs to: those 3pt strips run the full height of
    // the key stack and are the one place on that keyboard where a finger
    // truly lands on nothing. Android also drops `gap` entirely in the mode it
    // ships, so the inset was not buying the visual breathing room it buys
    // here — it was only shrinking the keys.
    style: {
      paddingLeft: opts.platform === "android" ? 0 : 3,
      paddingRight: opts.platform === "android" ? 0 : 3,
      paddingTop: 8,
      paddingBottom: opts.platform === "android" ? 0 : 4,
      gap: 10,
    },
    children: [
      // NOTE: no standalone suggestion bar row. The suggestion strip lives in
      // the middle of the tools row (see makeToolsRow) so predictions appear
      // without adding a whole 44pt band — the keyboard keeps its 272pt
      // height. (The old standalone node was gated on state.hasSuggestions,
      // which pre-K5 clients never exposed, so it never rendered anyway;
      // K5+ exposes it should a future tree want a dedicated row.)

      // Status label + waveform intentionally removed — the mic button's own
      // orange press state + the flash-across-keys animation on refined-text
      // arrival provide all the "is something happening?" feedback we need.
      // GUIDANCE BAND.
      //
      // This was left out on purpose, and the reason was right at the time: a
      // permanent status band turns "Error: 401" and "Listening…" into noise
      // over the keys, and the keyboard should feel calm.
      //
      // What that decision cost, once both keyboards stopped drawing status
      // text at all: every message telling the user how to unblock the thing
      // they just tapped became invisible. Full Access off, microphone denied,
      // session expired — the mic did nothing and said nothing, on the two
      // paths a brand-new user is most likely to hit first. An App Store
      // reviewer who installs the keyboard and does not grant Full Access sees
      // exactly that.
      //
      // Both clients now publish ONLY actionable text into state.status —
      // chatter resolves to empty — so this band is empty in the calm case and
      // present in the one case where silence was the bug.
      {
        type: "Row",
        visibleIf: { truthy: "state.status" },
        style: { height: 26, padding: 4, align: "center" },
        children: [
          {
            type: "LetterKey",
            bind: { content: "status" },
            on: { onPress: { kind: "openApp" } },
            style: {
              flex: 1,
              height: 22,
              bg: "#00000000",
              // The keyboard's own neutral grey (theme.accent) — reads on both
              // appearances. Amber is only for what is live.
              fg: "#8E8E93",
              fontSize: 12,
              fontWeight: "medium",
            },
          },
        ],
      },

      // Tulmi's tools bar — emitted twice: one dark palette variant and one
      // light palette variant, gated by state.appearance. The Swift renderer's
      // theme.key / theme.keyText auto-flip for letter keys, but style.bg hex
      // literals like KEY_FILL_FUNCTION don't — so a single tree using dark
      // hex reads as dark ovals on a light backdrop. Two variants means the
      // right palette shows up regardless of the OS trait.
      //
      // 44pt matches Apple's suggestion-bar height so tools reads as sitting
      // at the vertical rhythm the OS uses when its own predictive bar would be.
      // Dark-mode tools row — visible when appearance is dark. state.appearance
      // is initialized to "dark" in Swift, so the eq check handles the default
      // case; no need for a redundant `falsy` OR (which forced two evaluations
      // per remount for zero real benefit and added latency to every keystroke).
      // Dark-mode tools row. Mic at rest = the brand's pale (TAB_PALE, the
      // app's ink) as a solid key, with the mark in the app's ink-black
      // (#1B1712): the light-mode key, inverted. On the dark keyboard it is
      // the one bright key, so it reads as the keyboard's purpose at a
      // glance, and the mark sits on it at full contrast. (A malt-brown key
      // was tried and read as muddy.) Amber is only for what is live (the
      // dictation dots while listening), never the resting key. Tone pill =
      // solid dark gray with a 1pt subtle border for definition.
      makeToolsRow({
        micBg: TAB_PALE,
        micFg: "#1B1712",
        toneBg: "#2C2C2E",         // Apple systemGray5 dark — solid, no melt into blur
        toneFg: "#FFFFFF",
        toneBorderColor: "#FFFFFF29",  // 16% white — barely-there border for shape definition
        visibleIf: { neq: ["state.appearance", "light"] },
      }),
      // Light-mode tools row. Mic at rest = the same strong neutral, inverted
      // for a light backdrop: ink circle, white mark. Tone pill is solid white
      // with a light-gray border for definition against a light backdrop.
      makeToolsRow({
        micBg: "#1B1712",
        micFg: "#FFFFFF",
        toneBg: "#FFFFFF",
        toneFg: "#000000",
        toneBorderColor: "#00000029",   // 16% black — subtle border on light
        visibleIf: { eq: ["state.appearance", "light"] },
      }),

      // ============================ LETTER LAYER (en) =========================
      // Visible when state.layoutId is "en" (default). Prefixed with "state."
      // so Swift's condition evaluator actually resolves the value — bare
      // paths return null and everything reads as "always shown / never shown".

      // Row 1: q..p
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: letterRow1.map(kLetter),
      },
      // Row 2: a..l (indented half-key each side)
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [kHalfSpacer(), ...letterRow2.map(kLetter), kHalfSpacer()],
      },
      // Row 3: shift, z..m (7 letters), backspace.
      // Shift + backspace are a touch SMALLER (flex 1.1) than a full function
      // key and carry an extra inner spacer, so there's a clear gap between them
      // and the outer letter keys — the letter touch-plane's reach no longer
      // overlaps the shift/backspace hit area, so edge taps don't cross over.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          { type: "ShiftKey", style: { flex: 1.35, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
          { type: "Spacer", style: { flex: 0.22 } },
          ...letterRow3.map(kLetter),
          { type: "Spacer", style: { flex: 0.22 } },
          { type: "BackspaceKey", style: { flex: 1.35, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ NUMBER LAYER (123) ========================
      // Apple's iOS number page. Row 1 = digits; Row 2 = -/:;()$&@";
      // Row 3 = #+= · . , ? ! ' · backspace. Tapping "#+=" switches to the
      // symbol page; tapping "ABC" (from row 4) returns to letters.

      // Row 1: 1..0
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: KB_ROW_NUM_1.map(kPunct),
      },
      // Row 2: - / : ; ( ) $ & @ "
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: KB_ROW_NUM_2.map(kPunct),
      },
      // Row 3: [#+=] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "#+=" },
            on: { onPress: { kind: "switchLayout", language: "sym" } },
            style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 15, fontWeight: "regular" },
          },
          ...KB_ROW_PUNCT_3.map(kPunct),
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ SYMBOL LAYER (sym) ========================

      // Row 1: [ ] { } # % ^ * + =
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: KB_ROW_SYM_1.map(kPunct),
      },
      // Row 2: _ \ | ~ < > € £ ¥ ·
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: KB_ROW_SYM_2.map(kPunct),
      },
      // Row 3: [123] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 15, fontWeight: "regular" },
          },
          ...KB_ROW_PUNCT_3.map(kPunct),
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ BOTTOM ROW (all layers) ===================
      //
      // Row 4 is functionally shared across every layer, but the leftmost key
      // is a mode-switcher whose LABEL and TARGET LAYOUT depend on the current
      // state.layoutId. We emit one variant per mode with visibleIf gates.
      //
      // Flex ratios: the mode-switch key (123 / ABC) is set EQUAL to the return
      // key (2.75) so the space bar sits dead-center of the row — equal flex on
      // both flanks is what centers it — and the numbers key matches the size of
      // the return/search key. The SDUI renderer honors these proportionally on
      // every screen size (Pro / Plus / Pro Max scale correctly, no hardcoded widths).

      // Mode switcher — two variants, each visibleIf-gated:

      // Row 4 (LETTER page) — 123 · 🌐 · space · return.
      //
      // The globe key is REQUIRED, not optional: a keyboard extension has no
      // "system bar" — when needsInputModeSwitchKey is true (any device with
      // more than one keyboard, i.e. virtually all of them) the extension must
      // draw its own switcher, and App Review checks for it. Without it there
      // was no way to reach emoji or another keyboard without leaving the app.
      // visibleIf-gated on the OS signal so the rare single-keyboard setup
      // gets the wider space bar instead.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 2.4, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            type: "GlobeKey",
            visibleIf: { truthy: "state.hasMultipleKeyboards" },
            // Explicit width, NOT flex: a visibleIf-hidden child with flex
            // still gets a required proportional-width constraint from the
            // stack builder while UIStackView collapses it to zero — an
            // unsatisfiable-constraints break on single-keyboard devices.
            // Width children are excluded from the flex pass (like MicKey).
            style: { width: 44, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION },
          },
          // Period and at-sign flank the space bar. Both are constantly needed
          // and both were two taps away on the 123 page — an address or a
          // sentence end should not cost a layer switch.
          //
          // The widths are rebalanced rather than added to: 123 and return give
          // up 0.35 each and space gives up 1.88, so the row's flex total is
          // unchanged and every other key keeps the size it had. Nothing is
          // squeezed to make room.
          { type: "LetterKey", props: { char: "." },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "SpaceKey", style: { flex: 5.2, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "LetterKey", props: { char: "@" },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.4, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
      // Row 4 for the NUMBER or SYMBOL page — ABC returns to letters; same
      // globe placement as the letter page.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { any: [
          { eq: ["state.layoutId", "123"] },
          { eq: ["state.layoutId", "sym"] },
        ] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 2.4, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            type: "GlobeKey",
            visibleIf: { truthy: "state.hasMultipleKeyboards" },
            // Explicit width, NOT flex: a visibleIf-hidden child with flex
            // still gets a required proportional-width constraint from the
            // stack builder while UIStackView collapses it to zero — an
            // unsatisfiable-constraints break on single-keyboard devices.
            // Width children are excluded from the flex pass (like MicKey).
            style: { width: 44, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION },
          },
          // Period and at-sign flank the space bar. Both are constantly needed
          // and both were two taps away on the 123 page — an address or a
          // sentence end should not cost a layer switch.
          //
          // The widths are rebalanced rather than added to: 123 and return give
          // up 0.35 each and space gives up 1.88, so the row's flex total is
          // unchanged and every other key keeps the size it had. Nothing is
          // squeezed to make room.
          { type: "LetterKey", props: { char: "." },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "SpaceKey", style: { flex: 5.2, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "LetterKey", props: { char: "@" },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.4, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },

      // ========================= NUMBER-ONLY LAYER (num) ======================
      // Shown when the FIELD itself only accepts numbers — an OTP box, a phone
      // number, an amount. The client sets layoutId to "num" on focus and back
      // to "en" when it leaves; nothing switches to this layer by hand.
      //
      // A dialer grid, not our 123 page: a number field wants big targets in
      // the arrangement people already know, and the 123 page is a full QWERTY-
      // width row of tiny keys with punctuation the field will reject anyway.
      //
      // ABC is kept in the corner deliberately. If we ever misread a field as
      // numeric, the user must not be trapped in a pad that cannot type — the
      // same reason the globe key exists.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["1", "2", "3"].map(kPunct),
          { type: "BackspaceKey", style: { flex: 1, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["4", "5", "6"].map(kPunct),
          { type: "Spacer", style: { flex: 1 } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["7", "8", "9"].map(kPunct),
          { type: "Spacer", style: { flex: 1 } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 1, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          kPunct("0"),
          kPunct("."),
          { type: "ReturnKey", style: { flex: 1, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
    ],
  };

  // Named actions — referenced by node `on` handlers by string name. Lets us
  // change the bound behavior of a key (e.g. what the 123 key does) without
  // editing the tree, and keeps the tree readable.
  const actions: Record<string, KeyboardActionSpec> = {
    cycleLayout: { kind: "switchLayout" },      // no language = cycle
    showLangs: { kind: "showLanguageMenu" },
    dictateStart: { kind: "startDictation" },
    dictateStop: { kind: "stopDictation" },
    refine: { kind: "runRefine" },
  };

  return withKeyboardKnobs(opts.platform ?? "ios", {
    schemaVersion: SDUI_SCHEMA_VERSION,
    // Bump so warm keyboard sessions re-fetch on next open when we push a new
    // tree; the native cache respects this the same way SduiApp does.
    cacheVersion: currentCacheVersion(),
    theme: {
      // Legacy fields — read by the pre-SDUI binary as opaque hex. New builds
      // walk `root` and ignore these once features.sdui takes over.
      //
      // theme.key IS what SDUI LetterKey nodes use when they don't set an
      // explicit `bg` in their style — so wiring the new palette here is what
      // makes the letter keys actually pick up the lighter, more translucent
      // fill instead of the legacy #48484a opaque gray.
      // ALMOST transparent, and the "almost" is the fix for the dead gaps.
      //
      // iOS hands a custom keyboard a touch only where the keyboard has
      // painted something; a pixel it left fully clear goes nowhere. At
      // #00000000 the gaps between keys, the margins beside a and l and the
      // strip under the space bar painted nothing, so a tap there never
      // reached the keyboard at all, whatever its touch code said. That is
      // why the green debug sheet cured it every time: it painted the gaps.
      // Two per cent black does the same and cannot be seen over the OS
      // backdrop, which still shows through as it did. Works on every
      // installed build, no app update: the colour comes from here.
      background: KEYBOARD_GROUND,
      key: KEY_FILL_LETTER,
      keyText: KEY_TEXT,
      // Accent used ONLY by legacy path for the shift-active indicator dot.
      // The SDUI tree above doesn't reference this — return + refine keys
      // are plain function-key styled now.
      accent: "#8E8E93",
      keyPressed: KEY_PRESSED,
      // v2 fields — used only by the SDUI renderer:
      // No backgroundEffect. When set to null, the Swift renderer skips
      // installing the UIVisualEffectView backdrop entirely — the extension
      // is truly transparent and iOS's own region backdrop is the only
      // thing behind the keys.
      keyRadius: 5,     // Apple's letter-key radius on dark mode is 5, not 6
      keyShadow: true,  // hard 1pt drop shadow — matches Apple's key depth
    },
    // v3 adaptive palettes — the SDUI-renderer build picks between these
    // based on the current userInterfaceStyle and re-renders on trait change.
    themeDark: {
      background: KEYBOARD_GROUND,
      key: KEY_FILL_LETTER,
      keyText: KEY_TEXT,
      accent: "#8E8E93",
      keyPressed: KEY_PRESSED,
      keyRadius: 5,
      keyShadow: true,
    },
    themeLight: {
      // Fully transparent — no our-backdrop. Keys sit directly on whatever
      // iOS composits behind the keyboard region (usually a subtle light-gray
      // system chrome). This is the "no sheet, keys on the base surface"
      // pattern — same as themeDark. Removed backgroundEffect so we don't
      // paint our own blur that would double-tint the light system chrome.
      // Not quite clear, for the same reason as the dark one (see theme),
      // and white, not black: see LIGHT_KEYBOARD_GROUND.
      background: LIGHT_KEYBOARD_GROUND,
      key: LIGHT_KEY_FILL_LETTER,
      keyText: LIGHT_KEY_TEXT,
      accent: "#8E8E93",
      // The dark rows' neutral press, in ink for a light backdrop.
      keyPressed: LIGHT_KEY_PRESSED,
      keyRadius: 5,
      keyShadow: true,
    },
    // Layouts array stays populated for the legacy path. Adding a new language
    // here + shipping a matching { type: "LetterKey" } tree gets the new SDUI
    // keyboard when we generate per-language roots.
    // Every layout the mode-switcher on row 4 can jump to. The SDUI-renderer
    // build's switchLayout(language:) validates against this list; the legacy
    // path still renders the "en" entry (never sees the 123/sym metadata).
    layouts: [
      {
        language: "en",
        displayName: "English",
        rows: [
          letterRow1,
          letterRow2,
          ["{shift}", ...letterRow3, "{backspace}"],
          ["{globe}", "{mic}", "{refine}", "{space}", "{return}"],
        ],
      },
      { language: "123", displayName: "Numbers", rows: [] },
      { language: "sym", displayName: "Symbols", rows: [] },
      // Field-driven, never reached from the layer switcher — but it must be
      // listed or switchLayout("num") is rejected as an unknown language.
      { language: "num", displayName: "Number pad", rows: [] },
      // "emoji" removed: no tree rows are gated on it, so switching to it
      // rendered a keyboard with no keys and no way back — a live trap now
      // that the globe key exists (its long-press language menu lists every
      // layout here). System emoji is reached via the globe instead.
    ],
    features: {
      voice: true,
      refine: true,
      streaming: false,
      // Android ONLY: record + live-stream the mic directly IN the keyboard
      // (an Android IME can hold the mic in-process, unlike an iOS extension).
      // So Android needs no Flow Session and no arming screen — tap the mic and
      // dictate, words appear live. iOS ignores this and uses kb.mic.mode="flow"
      // (the background-audio path) since iOS forbids extension recording.
      liveVoice: true,
      // The switch: capable binaries walk root+actions; older ones fall through
      // to the hand-built layout.
      sdui: true,
    },
    labels: {
      refine: "Refine",
      listening: "Listening…",
      transcribing: "Transcribing…",
      refining: "Refining…",
      // Blank by owner decision: the bar's size says what it is. Both
      // keyboards honour "" as a label, not as a missing one.
      space: "",
      return: "return",
      needFullAccess: "Allow Full Access to speak with X0. Tap to set it up.",
      // The iOS keyboard reads the same message under this key.
      full_access_required: "Allow Full Access to speak with X0. Tap to set it up.",
      // The words-out line, under the key both keyboards read it by.
      // While Tailzu is free there are no free words to run out of: a 429 is the usage meter (src/you/usage.ts).
      // Read safely: the keyboard's config is also built where no server config is loaded.
      words_out_status: (() => { try { return freeForAll(); } catch { return false; } })() ? "Paused for now. Open X0 Bot to see when it starts again." : WORDS_GATE.keyboardStatus,
      language: "Language",
      // Branded, non-technical status text (both keyboards fall back to these
      // exact strings if the backend omits them — editing here re-words them
      // over-the-air, no rebuild). 444 = mic/capture failed ("not listening");
      // 222 = backend/processing failed ("we'll be back").
      voice_not_listening: "Not listening — tap the mic to try again.",
      voice_unavailable: "Voice is unavailable right now — try again soon.",
      // Flow Session (kb.mic.mode="flow", iOS). Wispr-style copy — but the mic
      // button should read as a clean, native, ICON-ONLY control (bolt → mic →
      // ✓), so ALL three flow status strings are blanked. Blank ("") means the
      // keyboard shows no hint text at all in that state — the glyph is the only
      // cue. Put any string back here (OTA, no rebuild) to reintroduce guidance:
      //   flow_start_hint → shown under the "Start Flow" (no-session) state
      //   flow_arming     → shown after the first tap opens the app to arm
      //   flow_arm_manual → shown when iOS refused the auto-open (open by hand)
      // Blank by owner decision: the keyboard stays icon-only — no Flow hint
      // text over the keys, no "Start Flow" state. The background-mic story
      // is carried by the App Review notes, the mic purpose string, the
      // privacy policy's Flow Session section, and the Settings off switch.
      // Any string here re-introduces on-keyboard guidance OTA if ever wanted.
      flow_start_hint: "",
      flow_arming: "",
      flow_arm_manual: "",
    },
    root,
    actions,
    // Backend-tunable knobs. Every value here has a Swift-side default so
    // this can stay empty and everything still works; overriding any key
    // changes that specific behavior without a rebuild.
    //
    // Uncomment / add entries as needed. See shared/types/sdui.ts for the
    // full authoritative list of keys and their defaults.
    flags: (() => {
      // Assemble the flag bag. Static entries first; then splice in the mic
      // media if there's one in the media registry so the keyboard's mic
      // matches the main app's without a rebuild.
      const flags: Record<string, unknown> = {
        // Example overrides (uncomment to try):
        //
        // "kb.press.fadeMs": 120,
        // "kb.dictation.dots.color": "#E8A23C",
        // "kb.dictation.dots.birthRate": 7,
        // "kb.dictation.dots.decayMs": 2500,
        // "kb.dictation.dim.alpha": 0.45,
        // "kb.mic.recordingIcon": { sf: "pause.fill" },
        // "kb.mic.recordingIcon": { sf: "waveform" },
        // "kb.mic.recordingIcon": { emoji: "⏹" },
        // "kb.mic.recordingIcon": { url: "https://cdn.x0bot.com/kb/stop.png" },
        // "kb.mic.idleIcon": { asset: "TailzuMark" },
        // Recording particle swarm (iOS), OTA-tuned — takes effect on the
        // CURRENT installed build (these keys are read live). Tiny dots (radius
        // in pt), fewer + a larger play area (smaller inset) so they read as
        // very tiny wandering specks, not a compact blob.
        "kb.mic.particles.radius": 0.55,
        "kb.mic.particles.count": 42,
        "kb.mic.particles.inset": 4,
        // Kill the flowing dot-stream that rises off the mic while recording —
        // birthRate 0 emits nothing. Only the in-button swarm remains.
        "kb.dictation.dots.birthRate": 0,
        // While the mic is recording, the keys go behind frosted glass AND stop
        // taking touches.
        //
        // The blur is the signal — the keys are still there, they are just not
        // yours for the moment — and blocksTouches is what makes it true rather
        // than decorative. Without it the keyboard looked disabled and typed
        // anyway, so a stray thumb mid-utterance inserted a character into the
        // very text the refine pass was about to rewrite.
        //
        // The tools row is deliberately NOT covered: the mic that stops the
        // recording lives there, and blurring the way out of a state is how you
        // strand someone in it.
        // OFF until the build that has the BLUR ships.
        //
        // This was already false, with a comment saying so, and turning it on
        // ahead of the native work was a regression: the shipped binary has
        // only the flat black scrim, and over a transparent keyboard sitting on
        // iOS's pale light-mode region that is a grey sheet behind the whole
        // keyboard, not a dim. The keyboard looked fine during recording before
        // and looked broken after, for no gain at all.
        //
        // THE KEYS GO BEHIND GLASS WHILE THE MIC IS LIVE.
        //
        // The overlay has two jobs and only one of them was ever wanted: it
        // swallows the keys' touches, which is what stops a stray thumb
        // inserting a character into the middle of a sentence being dictated.
        // The other was a flat veil, and a flat veil over a deliberately
        // transparent keyboard sitting on iOS's pale light-mode region is a
        // grey sheet behind the whole thing rather than a dim. So it was
        // turned all the way down and the keyboard said nothing at all about
        // being inert.
        //
        // A blur is the honest form of the same signal: the keys are still
        // there, still legible as keys, and plainly not for touching. It is a
        // material on iOS and a RenderEffect on Android, so neither is a
        // rectangle of paint over the top.
        //
        // The tint stays a whisper. The blur carries this on its own; the
        // tint only has to keep it from disappearing on a pale ground, and
        // anything more is the grey sheet again.
        //
        // OFF ON iPHONE. The iOS keyboard builds the frost by photographing
        // every key (~38 synchronous snapshots, each forcing the screen to
        // render first) and blurring each one — on the mic tap, before the
        // microphone can start, and again on every redraw while dictating.
        // That was the mic feeling slow to start and stop. Even "blur off"
        // still takes the photographs; only this switch skips them. The keys
        // simply stay as they are while you dictate. Android's blur is a
        // RenderEffect on the rows, which costs nothing like it.
        "kb.dictation.dim.enabled": opts.platform === "android",
        /**
         * ON FOR THE BUILDS THAT CARRY THE RAISE (K37 and later, which say so
         * in a header), OFF for the rest — see veilBlurs. This flag was the
         * whole reason a grey sheet appeared on the mic tap.
         *
         * The shipped binary buries the overlay behind the fresh tree on every
         * remount, and tapping the mic schedules exactly such a remount. With
         * blur OFF the overlay is a transparent view, so buried it paints
         * nothing and nobody sees it. Turning it ON gave that same buried view
         * a material to paint — one with nothing in front of it left to blur,
         * which is a flat sheet showing through a transparent keyboard.
         *
         * So this cannot be true before the build that raises the overlay
         * again. It is one backend edit on the day that ships, and everything
         * else in this block is already tuned for it.
         */
        "kb.dictation.dim.blur": veilBlurs,     // iOS UIVisualEffectView — see veilBlurs
        // WHICH MATERIAL. Every system material carries a fill as well as a
        // blur, and "thin" carries enough of one to read as a sheet laid over
        // the keyboard rather than the keyboard seen through something. Ultra
        // thin is nearly all blur, which is the signal we actually want.
        "kb.dictation.dim.material": "ultraThin",
        "kb.dictation.dim.blurRadius": 14,      // Android RenderEffect, API 31+
        // iOS from K38: each KEY is photographed on its own, blurred this many
        // POINTS, faded to iosKeyAlpha and drawn iosKeyScale smaller in its
        // own place while the key is hidden — the keys go soft, key by key,
        // and nothing is laid over the rows. The tools row with the mic is
        // never touched. The system material (kb.dictation.dim.material) sat
        // over the whole keyboard, hid the mic, and turned dark keys into fog;
        // it is no longer read.
        "kb.dictation.dim.iosBlurRadius": 2.5,
        "kb.dictation.dim.iosKeyAlpha": 0.6,
        "kb.dictation.dim.iosKeyScale": 0.985,
        // Zero while the blur is off: the veil's only job then is to swallow
        // touches, and a tint with nothing to tint is the grey sheet again.
        // Raise it to 0.06 on the day the blur goes on.
        // The TINT is now nearly nothing, and that is the fix for "the whole
        // keyboard sits on a grey sheet".
        //
        // Our background is deliberately transparent so iOS's own keyboard
        // region shows through. In LIGHT appearance that region is pale, so
        // black at 45% over it did not read as "dimmed" — it read as a grey
        // slab dropped behind the entire keyboard, which is a different and
        // much worse thing.
        //
        // The blur carries the "not now" signal on its own. The tint only has
        // to nudge it, so it is a whisper; raise it only for builds with no
        // blur to fall back on.
        "kb.dictation.dim.alpha": veilBlurs ? 0.06 : 0,
        // Android fades the rows a little under the blur — RenderEffect alone
        // keeps every key at full contrast, which reads as a rendering fault
        // rather than as a surface that is out of play.
        "kb.dictation.dim.keyAlpha": 0.72,
        // Builds with no blur to fall back on still need a real veil — that
        // one is served separately so lowering the blur tint cannot silently
        // leave an older binary showing nothing at all during recording.
        // The flat veil's opacity, and the one that produced the grey sheet.
        // Zero: the view is still there and still swallows touches, it just
        // paints nothing.
        "kb.dictation.dim.fallbackAlpha": 0,
        "kb.dictation.dim.blocksTouches": true,
        // "kb.shift.lockedColor": "#8E8E93",
        // "kb.shift.longPressMs": 350,
        // "kb.shift.iconLowerOutlined": "arrowtriangle.down",
        // Double-tap shift → caps lock (system-keyboard behavior). Window in ms
        // for the second tap; hold-to-lock still works too. Default 300.
        // "kb.shift.doubleTapMs": 300,
        // "kb.delete.repeatIntervalMs": 90,
        // "kb.autoCap.enabled": true,
        // "kb.smartPunctuation": true,
        // Key-pop callout — the native magnified bubble above a pressed letter.
        // On by default; every value below has a native default in Swift, so
        // these only need setting to OVERRIDE. iOS-only.
        //   kb.callout.enabled  (bool, default true) — set false to disable the pop
        //   kb.callout.bg       (hex) — balloon fill; default white (light theme)
        //                         / lighter-than-key gray (dark theme)
        //   kb.callout.text     (hex) — glyph color; default near-black / white
        // "kb.callout.enabled": true,
        // "kb.callout.bg": "#FFFFFF",
        // "kb.callout.text": "#111111",
        // Multi-touch / rolling key plane (iOS). Routes the character keys
        // through the custom KeyPlaneView for true rolling + two-thumb typing +
        // gap routing (the fast-typing gap vs the system keyboard). iOS-only —
        // Android ignores this flag.
        // Re-enabled after hardening the plane's key detection: it now re-derives
        // the key rects at the start of every touch (touchesBegan → refreshFrames)
        // instead of trusting a layout-time cache that could go stale and
        // mis-detect keys — the earlier "only a dead-center tap types" cause.
        // The same build also carries the hit-slop per-button grid, so this flag
        // is a clean OTA A/B switch: false falls straight back to that grid
        // (which also restores accent long-press trays) if a device ever shows
        // trouble — no rebuild needed.
        "kb.keyPlane.enabled": true,

        // Space, return and backspace take part in the touch partition.
        //
        // Without this the plane owned only the LETTER grid, and its
        // nearest-key fallback was gated on that grid's bounding box — so the
        // bottom row, and every gap between its keys, was refused by the plane
        // and left to each button's own small hit area. That is the dead zone
        // the user reported, and it is why raising the slops changed nothing:
        // the plane was never asked about those points.
        //
        // Off falls back to that behaviour exactly, so this is a clean switch
        // if the wider ownership ever mis-targets.
        //
        // The globe key is deliberately NOT in the partition, in the app or
        // here: it opens the system keyboard switcher, and a near-miss
        // silently swapping the user's keyboard is worse than one doing
        // nothing.
        "kb.keyPlane.actionKeys": true,

        // ------------------------------------------------------------------
        // Every remaining native knob, served at its COMPILED DEFAULT.
        //
        // 110 values were read by the keyboards and never sent, so each was
        // frozen at whatever the binary was built with — tuning any of them
        // meant a store round. They are emitted here at exactly the value the
        // native code already used, so nothing changes behaviour today and
        // every one of them becomes adjustable without a build.
        //
        // The ONE deliberate change is kb.touch.holdMultiplier: iOS defaulted
        // to 1.0, which switches the drift tolerance OFF, while Android used
        // 1.35. A finger that rolls a millimetre while pressing was retargeting
        // to the neighbour on iOS — the exact "it did not register my key"
        // failure the key plane exists to prevent. Both platforms now get 1.35.
        // ------------------------------------------------------------------
        // accentTray
        "kb.accentTray.chipActiveBg": "#007AFF",
        "kb.accentTray.chipFontSize": 22,
        "kb.accentTray.chipRadius": 6,
        "kb.accentTray.chipWidth": 40,
        "kb.accentTray.gap": 4,
        "kb.accentTray.height": 48,
        // 300, Gboard's own hold. A tap is under 120 ms, so nothing
        // deliberate is caught by it.
        "kb.accentTray.longPressMs": 300,
        // Any other hold (a key's alternates), on the same clock.
        "kb.longPress.ms": 300,
        // How often an open may refetch this config. Every 3 s was a refetch
        // on almost every open; both keyboards now drop identical bytes
        // before parsing, and a setting changed in the app still arrives
        // within half a minute.
        "kb.config.minRefetchMs": 30000,
        // Which backend errors the keyboard explains, and with which label.
        // 5xx is left out on purpose: those stay silent until voice_unavailable
        // says something users should read.
        "kb.errors.statusByCode": { "401": "auth_expired", "429": "words_out_status" },
        // The long-press alternates, per key. Both keyboards read this; the
        // iOS built-in map is only its fallback. Change a language's set here
        // or per user from the control console.
        "kb.accents": {"a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"], "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"], "i": ["î", "ï", "í", "ī", "į", "ì"], "o": ["ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"], "u": ["û", "ü", "ù", "ú", "ū"], "y": ["ÿ"], "s": ["ß", "ś", "š"], "l": ["ł"], "z": ["ž", "ź", "ż"], "c": ["ç", "ć", "č"], "n": ["ñ", "ń"], "d": ["ď"], "h": ["ĥ", "ħ"], "0": ["°"], "-": ["–", "—", "•"], "/": ["\\"], "$": ["€", "£", "¥", "₹", "¢"], "&": ["§"], "\"": ["“", "”", "„", "«", "»"], ".": ["…"], "?": ["¿"], "!": ["¡"], "'": ["‘", "’", "‚", "`"], "%": ["‰"], "=": ["≠", "≈"]},
        "kb.accentTray.offsetY": -52,
        "kb.accentTray.padding": 4,
        "kb.accentTray.radius": 8,
        // autoCap
        "kb.autoCap.enabled": true,
        // autocorrect
        "kb.autocorrect.lang": "",
        "kb.autocorrect.neighborCost": 0.5,
        "kb.autocorrect.punctCost": 0.5,
        // callout
        "kb.callout.bg": "",
        "kb.callout.enabled": true,
        "kb.callout.text": "",
        // confetti
        "kb.confetti.birthRate": 6,
        "kb.confetti.burstMs": 400,
        "kb.confetti.lifetimeMs": 3000,
        "kb.confetti.scale": 0.06,
        "kb.confetti.spin": 3,
        "kb.confetti.teardownMs": 3500,
        "kb.confetti.velocity": 200,
        // delete — Gboard's cadence: a short wait, then fast. 500/90 was
        // slower than either native keyboard; and 20 characters before whole
        // words go, at 90 ms a word, was a machine gun after two seconds.
        "kb.delete.initialDelayMs": 320,
        "kb.delete.repeatIntervalMs": 45,
        "kb.delete.wordAfterChars": 30,
        // dictation
        "kb.dictation.dim.fadeMs": 250,
        "kb.dictation.dots.alphaSpeed": -0.55,
        "kb.dictation.dots.color": "#E8A23C",
        "kb.dictation.dots.decayMs": 2500,
        "kb.dictation.dots.enabled": true,
        "kb.dictation.dots.lifetimeMs": 1800,
        "kb.dictation.dots.scale": 0.35,
        "kb.dictation.dots.scaleRange": 0.1,
        "kb.dictation.dots.size": 14,
        "kb.dictation.dots.spread": 0.08,
        "kb.dictation.dots.velocityJitter": 0.05,
        // flow
        "kb.flow.armGlyph.enabled": false,
        "kb.flow.glyphSize": 16,
        // haptics
        "kb.haptics.enabled": true,
        "kb.haptics.style": "selection",
        // key
        // 3, not 2 — half the 6pt inter-key gap, so two neighbours meet exactly
        // in the middle of it.
        //
        // The letter grid never needed this: the touch plane routes its gaps by
        // nearest-key. The BOTTOM row does — 123 / . / space / @ / return sit
        // outside the grid band, so each key covers only its own rect plus this
        // slop. At 2 that left a 2pt dead strip in every 6pt gap, four times
        // over, on the row thumbs use most. At 3 the row is continuous.
        //
        // Not 4: that would overlap neighbours, and in an overlap UIKit gives
        // the touch to whichever key is on top rather than to the nearer one —
        // trading dead space for a silent bias, which is worse.
        /**
         * ZERO, AND THAT IS WHAT HANDS THE GAPS TO THE PLANE.
         *
         * This slop does two things and they pull opposite ways. It widens
         * what a button ACCEPTS — the forgiveness it was added for — and it
         * widens what that button VETOES on the touch plane, because
         * refreshObstacleRects grows every key's rect by its own slop before
         * adding it to the veto list. A veto is checked before the plane
         * resolves anything.
         *
         * At y:10, clipped to its row, a letter vetoed the full height of its
         * column. At x:3, two neighbours' halos met across a five-point gap
         * with a point to spare. So the plane owned almost none of its own
         * keyboard, and every fix written for it — filling the gaps, resolving
         * every claimed point, warming the geometry — was landing on slivers.
         *
         * Zero gives each key a veto the size of what it paints. Everything
         * between and around them goes to the plane, which resolves a claimed
         * point to the nearest key and never drops one. That is strictly more
         * forgiveness than the halo bought, and it comes from the component
         * built for it rather than from thirty overlapping rectangles.
         *
         * The trade, stated: shift and the layer key lose their own halo too —
         * one factory makes every key — so a near miss on those now resolves
         * to the nearest letter instead. Raise these two numbers to undo all
         * of it in one cache bump.
         */
        "kb.key.hitSlop.x": 0,
        "kb.key.hitSlop.y": 0,
        // K39: space, return and the other plain-tap keys keep a tap that
        // lifts this many POINTS outside the key (a fast thumb drifts), and a
        // tap the system cancels early (the home-indicator band) — both used
        // to type nothing. Letters are the plane's and were already kept.
        "kb.key.liftSlop": 14,
        "kb.key.cancelMs": 250,
        // K40: a key landing fires space / return still held by the other
        // thumb first, so "hello world" typed fast stops coming out
        // "hellow orld". false = lift-only, as K39 and before.
        "kb.key.liftRollover": true,
        // K40: shift and 123 own the gap beside them up to the midpoint
        // with the next key, within this many points.
        //
        // 32, so the strip under 123 is 123's rather than the nearest letter's,
        // now that the space row reaches the bottom edge.
        "kb.touch.roleReach": 32,
        "kb.key.shadow.color": "#000000",
        "kb.key.shadow.offsetY": 1,
        "kb.key.shadow.opacity": 0.4,
        "kb.key.shadow.radius": 0,
        // layer
        "kb.layer.lettersId": "en",
        "kb.layer.symbolIds": "123,sym",
        // mic
        "kb.mic.particles": true,
        // network
        "kb.network.timeoutMs": 15000,
        // press
        "kb.press.fadeMs": 120,
        // returnKey
        "kb.returnKey.actionBg": "#007AFF",
        "kb.returnKey.actionFg": "#FFFFFF",
        // row
        "kb.row.expandHitTargets": true,
        // shift
        "kb.shift.doubleTapMs": 300,
        "kb.shift.iconLowerLocked": "arrowtriangle.down.fill",
        "kb.shift.iconLowerOutlined": "arrowtriangle.down",
        "kb.shift.iconSize": 16,
        "kb.shift.iconUpperLocked": "arrowtriangle.up.fill",
        "kb.shift.iconUpperOutlined": "arrowtriangle.up",
        "kb.shift.iconWeight": "semibold",
        // Neutral, not amber: caps lock is a mode, not something live. The
        // keyboard's own grey (theme.accent, the legacy shift-active dot),
        // one value that reads on both appearances; the filled arrow is what
        // says "locked".
        "kb.shift.lockedColor": "#8E8E93",
        "kb.shift.longPressMs": 350,
        // smartPeriod
        "kb.smartPeriod.windowMs": 500,
        // suggestion
        "kb.suggestion.chipBorderWidth": 1,
        "kb.suggestion.chipPadH": 12,
        "kb.suggestion.chipPadV": 4,
        "kb.suggestion.chipRadius": 12,
        "kb.suggestion.dividerHeight": 18,
        "kb.suggestion.edgeInset": 8,
        "kb.suggestion.emphasizeFirst": true,
        "kb.suggestion.fontSize": 15,
        "kb.suggestion.gap": 8,
        "kb.suggestion.height": 36,
        // The lead chip: a solid neutral (pale ink, ink text), not amber —
        // one flag serves both appearances, so it is solid rather than a
        // translucent tint whose text could only suit one of them.
        "kb.suggestion.leadBg": "#F3E2C6",
        "kb.suggestion.leadFg": "#1B1712",
        "kb.suggestion.style": "chips",
        // toast
        "kb.toast.color.error": "#FF3B30E6",
        "kb.toast.color.info": "#000000D9",
        "kb.toast.color.success": "#34C759E6",
        "kb.toast.durationMs": 2000,
        "kb.toast.fadeInMs": 180,
        "kb.toast.fadeOutMs": 250,
        "kb.toast.fontSize": 13,
        "kb.toast.height": 32,
        "kb.toast.offsetY": -18,
        // tone
        // The chosen row: the keyboard's neutral grey (reads on the dark and
        // the light sheet alike); the tick and the weight mark it. Not amber.
        "kb.tone.sheet.accent": "#8E8E93",
        "kb.tone.sheet.enabled": true,
        "kb.tone.sheet.longPressMs": 300,
        // touch
        // Widened. A light tap that iOS cancels instead of ending is only
        // rescued when it was short and still; "hard touches register, light
        // ones don't" is exactly the shape of taps falling just outside these
        // bounds. The rescue acts only on touches iOS already cancelled and
        // that have not committed, so it can never type twice — widening it
        // only risks committing a cancelled gesture that was still, brief and
        // a tap in every measurable way.
        "kb.touch.cancelCommit.maxDriftPt": 24,
        "kb.touch.cancelCommit.maxMs": 700,
        "kb.touch.fillGaps": true,

        // ANDROID: how far inside its row a key is PAINTED. Its touch area

        // keeps the row's full height either way, so setting this and

        // removing the same amount from the column's row gap makes the

        // band between rows belong to the rows instead of to nobody — the

        // structural dead zone iOS spent six builds on. 0 = unchanged.

        // Try it on a device before moving the gap; both are values here.

        "kb.touch.vInsetPx": 0,
        // K30's two fixes, both switchable from here.
        //
        // This problem has cost six builds, five of them chasing a wrong
        // diagnosis, and native Swift cannot be OTA'd — so every wrong guess
        // was another build. These exist so the NEXT adjustment, in either
        // direction, is a value in this file instead.
        //
        // alwaysRefresh: rebuild key geometry on every layout pass, which is
        // what the debug overlay was doing by accident and why the keyboard
        // measurably worked with it on.
        //
        // BACK ON, and staying on. It was turned off with the overlay on the
        // theory that K31's per-row witnesses made it redundant. The dead gaps
        // came straight back, which says the cheap check is not equivalent —
        // and the likely reason is ordering, not correctness: the plane lays
        // out before the key buttons settle, so every witness compares a stale
        // rect against the stale rect it recorded, agrees with itself, and
        // reports a grid that has not moved. Rebuilding unconditionally cannot
        // be fooled that way.
        //
        // The cost is real and it is small: forty-odd coordinate conversions
        // per layout pass. A keyboard with dead gaps is not cheaper.
        "kb.touch.alwaysRefresh": true,
        // totalResolve: a point the plane claimed always resolves to a key.
        // OFF restores the old behaviour, where a claimed point the resolver
        // could not place was dropped in silence.
        "kb.touch.totalResolve": true,
        "kb.touch.holdMultiplier": 1.35,
        // waveform
        "kb.waveform.barCount": 24,
        "kb.waveform.baselineMax": 0.6,
        "kb.waveform.baselineMin": 0.2,
        "kb.waveform.color": "#999999",
        "kb.waveform.fps": 30,
        "kb.waveform.height": 24,
        "kb.waveform.levelMultiplier": 0.6,
        "kb.waveform.radius": 1.5,
        "kb.waveform.spacing": 3,
        // Draw the key rows instead of building a Button per key.
        //
        // This is the one structural difference left between us and the system
        // keyboards: they paint every key into a single surface, we built ~30
        // views and paid a measure/layout pass for each. Drawn mode collapses a
        // row to ONE view whose keys are geometry.
        //
        // OFF until it has been used on a real device. Both renderers are in
        // the binary and the touch resolution is shared, so this is a flip in
        // either direction with NO rebuild — which is the whole point of
        // shipping it behind a flag rather than swapping the renderer outright.
        // Rows the drawn path does not fully reproduce (anything with a globe,
        // mic or suggestion strip) fall back to views on their own.
        "kb.render.drawnKeys": false,
        // --- K18: the last compiled-in choices, now data ------------------
        // Functional-key glyphs. Full icon-spec vocabulary, so a symbol can
        // become an emoji or a hosted image without a rebuild:
        //   { "sf": "delete.left" } | { "emoji": "⌫" } | { "url": "https://…" }
        // A per-key override can also ride in the tree as props.icon.
        // "kb.icon.backspace": { "sf": "delete.left" },
        // "kb.icon.globe": { "sf": "globe" },
        // "kb.icon.refine": { "sf": "sparkles" },
        //
        // Suggestion bar SHAPE (not just its colours):
        //   "chips" (default) — rounded pills, a solid neutral lead chip
        //   "flat"            — the native three-slot strip: no surfaces, thin
        //                       dividers, lead distinguished by weight/colour
        // "kb.suggestion.style": "chips",
        // "kb.suggestion.dividerColor": "#FFFFFF24",
        // "kb.suggestion.dividerHeight": 18,
        // --- K12 knobs: everything below was hardcoded in the binary until
        // now, and each is a value real-world use is likely to argue with.
        //
        // Key haptics — the most polarizing keyboard setting there is.
        // enabled=false silences them entirely; style is "selection"
        // (default, the crisp native tick) | light | medium | heavy | rigid |
        // soft. iOS still requires Full Access for any of it.
        // ---- Per-key haptics -------------------------------------------
        // Two ways to be on, because "all keys" and "the keys I chose" are
        // different preferences and neither should erase the other:
        //
        //   kb.haptics.all   — every key buzzes. The card's master toggle.
        //   kb.haptics.keys  — a set of individual keys the user picked. A key
        //                      listed here buzzes even when .all is off.
        //
        // Default is silence on both. A keyboard that buzzes on every letter
        // out of the box is a setting people go looking for how to turn OFF,
        // so it is opt-in in either direction.
        //
        // Keys are named by what they insert (" ", ".", "a") or by role
        // ("shift", "backspace", "return", "space", "mic", "refine"), so the
        // picker in the app and the keyboard agree without a shared table.
        "kb.haptics.all": false,
        "kb.haptics.keys": {},
        // "kb.haptics.style": "selection",
        //
        // Touch feel (K11). holdMultiplier is how far a finger may drift off
        // the pressed key before the press cancels, as a multiple of the key's
        // own size — native keeps a key held through a lot of drift, so 1.0
        // means "one key-width of slack". Lower = twitchier, higher =
        // stickier, 0 = the old behavior where any drift onto dead space
        // dropped the keystroke.
        // holdMultiplier is served live above at 1.35. It used to be commented
        // out here at 1.0, which is the value that DISABLES the drift slack —
        // and iOS was compiled with exactly that, so a finger rolling a
        // millimetre retargeted to the neighbour.
        // cancelCommit rescues taps iOS CANCELS rather than ends — the
        // home-indicator band overlaps the bottom row and steals quick light
        // taps there. A cancelled touch shorter than maxMs that moved less
        // than maxDriftPt is treated as a real tap. maxMs 0 disables the
        // rescue.
        // "kb.touch.cancelCommit.maxMs": 300,
        // "kb.touch.cancelCommit.maxDriftPt": 12,
        //
        // Autocorrect aggressiveness. Together with maxDistance these ARE the
        // dial: a neighbor-key substitution ("gome"→"home") costs
        // neighborCost, a missing apostrophe/space ("dont"→"don't") costs
        // punctCost, everything else costs 1. LOWER = more words get
        // "fixed". A wrong correction costs far more trust than a missed one,
        // so raise these to make it more conservative.
        // "kb.autocorrect.neighborCost": 0.5,
        // "kb.autocorrect.punctCost": 0.5,
        // Debug build stamp (orange "K1" in the keyboard's corner). The Swift
        // default is FALSE so store builds never show it. To verify a fresh
        // binary + live OTA delivery in one shot: flip this to true + cache
        // bump — the stamp appearing proves both — then flip back off.
        // ON, temporarily. Every recent keyboard fix is a
        // FLAG — holdMultiplier, hitSlop, fillGaps — and a flag only does
        // anything if the config actually reaches the keyboard. The keyboard
        // needs Full Access and a valid token to fetch it; without either it
        // runs entirely on compiled defaults, including holdMultiplier 1.0,
        // which disables the drift slack.
        //
        // The stamp settles that in one glance: a version means config is
        // arriving and the touch values with it; nothing means every fix has
        // been sitting on the server doing nothing. Turn back off once known.
        // ON, TEMPORARILY. The gaps still read as dead and there are two
        // candidate causes that look identical from the outside — the plane
        // refusing the point, or the plane not running at all. The stamp says
        // which in one glance: "NOPLANE" means it never mounted; otherwise
        // k/a/r are the keys, action keys and role keys it partitioned, v the
        // obstacles, y/h the band's top and height, and t(x,y)Y|N whether the
        // LAST touch was claimed. Tap a dead gap and read the letter.
        //
        // Off. It did its job — the stamp is how we learned build 60 was
        // running its embedded bundle and had never taken an update.
        "kb.buildStamp.enabled": false,
        // Cold-open field diagnostics (K3+ binaries). With this on, tapping the
        // keyboard mic shows "<stamp> · <path>" in the status bar — e.g.
        // "K3 · app✓@2 open=NO" (found UIApplication, iOS refused the open) or
        // "K3 · app✗ legacy=YES" (no UIApplication in the chain, legacy path
        // claimed a hit). A console-log substitute readable on the phone.
        // Flip OFF (with the deploy's automatic cache bump) once diagnosed.
        "kb.coldOpen.debugStatus": false,
        // Mic mark inset (points on iOS, dp on Android). The mark fits the key
        // by its diagonal, so 0 has its corners on the rim; 7 on a 36pt key
        // leaves it small in the middle with clear space around it — the
        // owner's call: a small mark, nice negative space. The recording state
        // lives in the same inset frame. OTA-tunable — takes effect on the
        // current build without a rebuild.
        "kb.mic.idleIconInset": 7,
        // The mic key as a tiny bot in a round window (iOS PeekBotView,
        // Android TulmiPeekBot): it peeks in now and then, pops up to listen,
        // thinks while the words are cleaned up, smiles when they land. ""
        // keeps the mark. Builds before the bot ignore this and draw the mark.
        "kb.mic.bot": "peek",
        // The status line is drawn once: by the tree's own band above the
        // tools row (which a tap on opens the app). Both keyboards also float
        // their native copy of it over the top of the keyboard, for a tree
        // without a band; over this tree that is the same words twice, a
        // little apart. Clear, it draws nothing and takes no touch.
        "kb.status.overlay.bg": "#00000000",
        "kb.status.overlay.fg": "#00000000",
        // Mic mode (iOS only — Android reads `liveVoice` and records in-process,
        // which iOS extensions CANNOT do). iOS blocks microphone recording
        // inside a keyboard extension: even with Full Access,
        // AVAudioRecorder.record() returns false ("doesn't have entitlements to
        // record audio"). So the working iOS path is a background-audio "Flow
        // Session" (the Wispr Flow model): the first mic tap opens the app,
        // which holds the mic alive in the BACKGROUND; the user swipes back and
        // then dictations run from the keyboard without leaving it, until the
        // session idles out. See FlowSessionManager / TulmiFlow. Requires the
        // native flow code in the build. OTA-flippable to "handoff" (open app
        // per dictation) / "local" / "stream".
        // iOS only — the Android keyboard has its own capture path and does
        // not read this flag. Changing it has no effect on Android.
        "kb.mic.mode": "flow",
        // Show ONLY the finished sentence. Both engines still stream while the
        // user speaks — transcription is done by the time they stop, so this
        // costs no real time — but nothing reaches the cursor until the text is
        // written properly. Watching "whats up" appear and turn into "WhatsApp"
        // makes the product look like it is correcting its own mistakes;
        // landing one finished sentence makes it look like it understood.
        // Set false to paint the raw transcript live and rewrite it on stop.
        "kb.mic.deferUntilStop": true,
        // How long a Flow Session stays live (mic held in the background) with
        // no dictation before it must be re-armed by re-opening the app.
        // Wispr's default is 5 min; raise for fewer app hops.
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
        // Flow mic button glyphs (SF Symbol names). Wispr's exact model:
        //   startGlyph → shown when NO session is live (the "Start Flow" state;
        //                first tap opens the app to arm).
        //   stopGlyph  → shown WHILE recording (tap it to finish — Wispr's ✓).
        // The armed-idle state uses the normal mic/brand mark. OTA-tunable.
        "kb.flow.startGlyph": "bolt.fill",
        "kb.flow.stopGlyph": "checkmark",
        // TRANSPORT — how a dictated utterance reaches the server. Flippable
        // per cohort, no rebuild (build 53+).
        //   "stream"  → PCM goes up a socket as the user speaks. Transcription
        //               finishes as they stop, so the written sentence lands
        //               fastest. Cost: a dropped socket loses the words
        //               outright — they existed nowhere but in flight.
        //   "oneshot" → the app buffers the utterance and POSTs it once to
        //               /v1/transcribe-clean, the same endpoint (and the same
        //               Sarvam+Whisper fusion) the in-app mic uses. The audio
        //               still exists on the phone afterwards, so a failed
        //               request retries instead of losing the dictation, and
        //               the two surfaces stop diverging. Cost: transcription
        //               starts at stop, so the wait is longer on long
        //               utterances.
        // Streaming stays the default: it is faster, and it is the path with
        // real usage behind it.
        // Set this globally (FLOW_TRANSPORT), NOT as a cohort rollout: the app
        // reads it from /v1/app/bootstrap and the keyboard from
        // /v1/keyboard/config, and only the latter runs rollouts — so a
        // targeted rule would put the two halves of one dictation into
        // different modes.
        "kb.flow.transport": FLOW_TRANSPORT,
        // How long to wait after the mic stops before writing what was said —
        // the tail of an utterance is usually still in flight. Also the poll
        // interval while waiting for a one-shot upload to come back.
        //
        // The keyboard writes once this long passes with no new words, and
        // words that land after it are written ON THEIR OWN: a second
        // refine, a second History card, and a capital and full stop in the
        // middle of what was one sentence ("…call you. Tomorrow."). At 450
        // the recogniser's last words, flushed after stop (up to ~1.5 s,
        // transcribe-stream's fallback), often came after it. 900 catches
        // nearly all of them for under half a second more.
        "kb.flow.settleMs": 900,
        // Dictation "button logic" — WHEN the words hit the field. This is the
        // one knob that flips live-vs-after-stop without a rebuild (once the
        // reader is in the build; build 39+):
        //   true  → words paint the field LIVE as you speak (streaming feel)
        //   false → nothing shows until you STOP; then the whole utterance lands
        //           in one block (cleaner, no half-formed words on the typepad)
        // Governs iOS Flow, the iOS in-keyboard stream, and Android liveVoice
        // alike. Note a batch provider (Groq) has no interim partials to begin
        // with, so it already behaves as after-stop; this flag is what lets a
        // STREAMING provider (Deepgram) ALSO defer to after-stop. Default here is
        // false to match "don't show text while recording — wait for stop".
        "kb.mic.liveText": false,

        // WHAT IS LEFT TO SPEND, so the mic can say so before the user does.
        //
        // The 429 on the transcribe route is the authority and stays the
        // backstop; this is here because being refused AFTER saying a sentence
        // is a worse way to learn it than being told when you reach for the
        // button. Absent for an anonymous caller, and then the mic behaves
        // exactly as it always did.
        //
        // `exhausted` is the only one the keyboard has to act on: true means
        // send them to the words screen instead of opening the microphone.
        // `low` is for a quieter mark on the key — a warning, not a stop.
        ...(opts.quota
          ? {
              // The numbers only while they mean something. While Tailzu is
              // free, nothing reads them — and they changed after every
              // dictation, so the config's bytes changed, and both keyboards
              // tore themselves down and rebuilt on the next open, often as
              // the first key went down.
              ...(freeForAll() ? {} : {
                "kb.quota.remaining": Math.max(0, Math.round(opts.quota.remaining)),
                "kb.quota.total": Math.max(0, Math.round(opts.quota.total)),
              }),
              "kb.quota.exhausted": !freeForAll() && !opts.quota.entitled && opts.quota.remaining <= 0,
              // A share of the ceiling with a fixed floor, both tunable in
              // WORDS_GATE — see the note there on why "nearly out" needs to
              // be worth about one message rather than a flat percentage.
              "kb.quota.low":
                !freeForAll() && !opts.quota.entitled
                && opts.quota.remaining > 0
                && opts.quota.remaining <= Math.max(
                  WORDS_GATE.lowFloor,
                  Math.round(opts.quota.total * WORDS_GATE.lowShare),
                ),
              /** Where to send them when it is gone. A screen id the app
               *  deep-links to, so changing the destination needs no build. */
              "kb.quota.screenId": WORDS_GATE.outScreenId,
              /** What the keyboard says when it cannot open the app at all. */
              "kb.quota.status": WORDS_GATE.keyboardStatus,
            }
          : {}),

        // ------- Typing engine (K4+ binaries; older builds ignore all of it) --
        //
        // These are the "close the native-keyboard gap" knobs. Every one has a
        // conservative Swift default (autocorrect/suggestions/bias default OFF
        // in the binary), so THIS block is the rollout switch — flip any of
        // them off here to kill the feature OTA, no rebuild.
        //
        // Press-order rollover: a second finger down commits the still-held
        // key immediately, so overlapped two-thumb presses land in press order
        // ("the", not "teh"). Matches the system keyboard's rollover.
        "kb.keyPlane.rolloverCommit": true,
        // COMMIT ON TOUCH-DOWN. The letter is inserted when the finger lands,
        // not when it lifts.
        //
        // Everything else about a press already happened on the way down — the
        // key lights, the click sounds, the haptic fires — and only the
        // character waited for the lift. A tap holds a key for 60 to 120 ms,
        // so the letter trailed its own keypress by three to seven frames on
        // every single press. That is the lag, and no work taken out of the
        // keystroke path could ever have closed it, because the delay was the
        // user's own finger.
        //
        // Keys with an accent tray are excluded client-side: there the hold has
        // to be ruled out before anything can be typed.
        //
        // Sent true, read with a false default, so old binaries are untouched
        // and a bad one can be taken back by changing this word.
        "kb.keyPlane.commitOnDown": true,
        // THE SHEET, WITHOUT ITS PAINT (K36 binaries; older ones ignore it).
        //
        // The one thing measured rather than reasoned about this keyboard: with
        // kb.debug.showTouchRects on it has worked every time, with it off some
        // spots stay dead. The binary now keeps every runtime side effect of
        // that overlay — a display pass after each hit test, layout, rebind and
        // commit, with the geometry re-checked at that pass — and draws
        // nothing. False restores the K34 path, over the air.
        //
        // OFF NOW. The sheet's cure was never its display passes, it was its
        // paint: the gaps get touches because the ground is painted (see the
        // theme's background). Its passes cost a full redraw on every hit test,
        // i.e. every keystroke, which is exactly what fast typing cannot afford.
        "kb.keyPlane.sheet": false,
        // The same on K42+, under its own key (the plane there is tinted too).
        "kb.keyPlane.redrawOnTouch": false,
        // That tint, on the builds that read one colour for light and dark
        // (newer ones read touchColorLight / touchColorDark, white and black).
        // Their own default, 2% black, stacked on the ground and showed as a
        // grey sheet on a light keyboard. 2% of a middle grey moves either
        // backdrop by about one level, light or dark: no one sees it, and the
        // alpha is the same, so the gaps still get their touches.
        "kb.keyPlane.touchColor": "#8A8A8A05",
        // Accent long-press trays routed through the multi-touch plane (the
        // v1 plane dropped them; K4 restores them plane-side).
        "kb.keyPlane.accentTrays": true,
        // On-device autocorrect at word boundaries (space/return/punctuation):
        // UITextChecker guesses re-ranked by PHYSICAL key adjacency from the
        // live layout — a candidate that differs only by neighbor-key
        // substitutions is a fat-finger, not a different word. The typed
        // original shows as a suggestion chip for one-tap revert.
        "kb.autocorrect.enabled": true,
        "kb.autocorrect.minLen": 3,
        "kb.autocorrect.maxDistance": 2,
        // The word-suggestion strip is OFF by owner decision: autocorrect
        // stays exactly as it is, the row of guesses above the keys goes.
        //
        // Android keeps it for now, and only for now. Its autocorrect fed off
        // the same spell-check request the strip triggered, so hiding the
        // strip there silently turned autocorrect off as well; that is fixed
        // in the Android keyboard but needs a build to reach devices. Until
        // that build ships, Android is served the strip; then this becomes a
        // plain `false` for both.
        "kb.suggestions.enabled": opts.platform === "android",
        "kb.suggestions.max": 3,
        // Language-model hit-target bias — the cheap version of Apple's
        // dynamic key resizing. After typing a character, the letters likely
        // to FOLLOW it (table below) claim lmBias.pt extra points of the
        // ambiguous gap/slop zone around them. Direct hits inside a key's
        // real bounds are never stolen.
        //
        // OFF. The table below is ENGLISH bigram frequency, and it is the only
        // table there is — so for anyone typing Hinglish, Hindi, Tamil or any
        // of the other languages this product exists to serve, it biases
        // ambiguous taps toward letters that are not likely at all. It is also
        // unproven: nothing in the telemetry says it ever helped, and it can
        // only ever change which letter an uncertain tap produces. That is the
        // exact shape of "the keyboard typed something I didn't press".
        //
        // Both flags stay live, so this is one backend edit to re-enable — and
        // the honest way to turn it back on is per-language tables plus the
        // revert counter showing it wins, not an assumption that it does.
        "kb.touch.lmBias.enabled": false,
        "kb.touch.lmBias.pt": 0,
        // prev-char → likely next letters, most likely first (top-6, English
        // corpus bigram frequencies). The " " row is word-START letter
        // frequency, so the bias works on the first letter of every word too.
        "kb.touch.bigrams": {
          " ": "taoswcbp",
          "a": "ntsrlc",
          "b": "elouar",
          "c": "oheatk",
          "d": "eioasu",
          "e": "rnsdal",
          "f": "oierau",
          "g": "ehoari",
          "h": "eaiotu",
          "i": "nstocl",
          "j": "uoaei",
          "k": "einsal",
          "l": "eiloay",
          "m": "eaoiup",
          "n": "gdetos",
          "o": "nurfmt",
          "p": "eroali",
          "q": "u",
          "r": "eoiast",
          "s": "teosai",
          "t": "heioar",
          "u": "rnstlp",
          "v": "eiaoyu",
          "w": "aiheon",
          "x": "ptcaie",
          "y": "oestia",
          "z": "eaioyz",
        },
        // ------- Touch spaces (K5+ binaries) — native-style key reach -------
        //
        // Every key owns the space AROUND it, not just its painted rect, and
        // real controls (shift/delete/space/return/mic/tone/chips) veto that
        // reach so nothing is ever stolen from them.
        //
        // Vertical reach beyond each key's rect. The 10pt row gaps are fully
        // covered from both sides; the nearest row wins (dx+dy scoring).
        // Paint what the plane owns, on the device, in colour. Off by default.
        // Four rounds of reasoning about this geometry produced four wrong
        // answers; "it feels dead here" and "the rect does not reach here"
        // cannot be reconciled by argument, only by looking.
        // ON, temporarily. A build carrying the touch partition is installed
        // and reports feeling unchanged — which either means the partition is
        // not in that binary, or it is and the geometry is still wrong. Those
        // two look identical from the outside and no amount of reading the
        // code separates them. The overlay does, in one screenshot:
        //
        //   green   what each key owns (the partition)
        //   white   the key's painted rect
        //   red     controls that veto the plane
        //   orange  shift / layer keys
        //   blue    the outer band the fallback is bounded by
        //
        // If the bottom row has green boxes, the partition is live and we are
        // arguing about geometry. If it does not, the binary predates it.
        // Back to false once we know.
        // Draws the partition: obstacles filled, role keys stroked, the band
        // stroked. A dead gap sitting inside a filled obstacle is the veto; a
        // dead gap outside the band is the band being too short.
        //
        // Off. Beyond being visible to users, this one is not free: it marks
        // setNeedsDisplay() on every layout, draw() calls ensureFrames(), and
        // with alwaysRefresh that was a full geometry rebuild per frame in a
        // process iOS keeps on a short leash.
        "kb.debug.showTouchRects": false,
        // Raised from 8. Each side of a 10pt row gap contributed 8, so the gap
        // was covered — IF both neighbours' boxes are what govern it. 12 means
        // one side alone covers the whole gap, so the coverage no longer
        // depends on that assumption holding.
        "kb.touch.vSlop": 12,
        // The TOP letter row (q..p) reaches further UP toward the tools row —
        // overshooting the top row still types.
        //
        // 52, not 16, because 16 left a 46pt band across the whole keyboard
        // that belonged to no key at all. The server puts 52pt above the first
        // letter row — 8pt of container padding plus the 44pt tools row — and
        // the letter grid's touch band began 16pt above q, so everything from
        // the top edge down to 46pt resolved to nothing. That band is the
        // width of the keyboard and it is exactly where a thumb reaching for
        // the number row lands.
        //
        // Nothing is stolen by this. It is a touch-only value, so the keyboard
        // looks identical, and the mic, the tone pill and every other control
        // in the tools row are protected by the obstacle veto that runs before
        // the grid is consulted. What changes is the leftovers: the space
        // BETWEEN those controls used to type nothing and now types the letter
        // above which it sits.
        "kb.touch.topRowUpSlop": 52,
        // The BOTTOM letter row (z..m) reaches further DOWN toward the space
        // row; the space/return/123 keys themselves are veto-protected.
        //
        // 40: the bottom row is the space row, and the strip under it, down to
        // the keyboard's edge, was nobody's. K42 also owns it by rule
        // (kb.touch.bottomToEdge); this covers the builds installed now.
        "kb.touch.bottomRowDownSlop": 40,
        // Each row's outermost key owns its side margin to the keyboard edge —
        // the dead corners beside "a" and "l" on the indented middle row now
        // type "a" / "l", exactly like native.
        "kb.touch.edgeToMargin": true,
        // Space-bar trackpad (native hold-for-cursor). These are the Swift
        // defaults, pinned here so the behavior is explicit + OTA-tunable.
        // K5 fixed the bug where entering trackpad mode remounted the tree and
        // cancelled its own gesture — hold-space now scrubs the cursor like
        // the system keyboard, with keys dimming while active.
        "kb.trackpad.enabled": true,
        "kb.trackpad.longPressMs": 300,
        "kb.trackpad.ptPerChar": 7,
        // Space/return on the 123/#+= layer flips back to letters (native
        // behavior; K6+). false = stay on the symbol layer.
        "kb.layer.returnAfterSpace": true,

        // ------- K7: swipe typing + role keys + smarter corrections --------
        //
        // QuickPath-style glide typing. Both binaries default OFF; this is the
        // rollout switch, and it drives BOTH platforms. Trail is the fading ink
        // line behind the finger.
        //
        // OFF until it is measured. It was reported wrong on iOS, and the fix —
        // decode by path geometry against a real dictionary — has never run on
        // a device. Shipping it on while the same feature is held back on
        // Android for being unproven was not a judgement, it was an oversight:
        // the unproven one was the one users had.
        //
        // A swipe that guesses wrong costs far more trust than no swipe. Turn it
        // on for a cohort once a build has been used and swipeCommitted /
        // autocorrectReverted say it earns its place.
        "kb.swipe.enabled": false,
        "kb.swipe.minKeys": 3,
        "kb.swipe.maxAlternates": 3,
        "kb.swipe.trail.color": "#E8A23CD9",   // brand amber, mostly opaque
        "kb.swipe.trail.width": 7,
        "kb.swipe.trail.fadeMs": 260,
        // The core lexicon and its extension (product names, Hinglish), and the
        // key click said for everyone: appLists.ts keyboardLists.
        ...keyboardLists(opts.platform === "android" ? "android" : "ios"),
        // Shift + layer keys ride the touch plane (K7): shift arms on touch-
        // down and supports slide-to-letter one-shot capitals; 123/#+=/ABC
        // switch instantly on touch-down and support press-slide-release
        // layer-peek. Both individually OTA-reversible.
        "kb.keyPlane.shift": true,
        "kb.layerPeek.enabled": true,
        // Backspace immediately after an autocorrect restores the original.
        "kb.autocorrect.backspaceRevert": true,
        // Real-word confusion pairs — the word is spelled correctly, so the
        // alternatives are OFFERED as chips (tap swaps in place), never
        // auto-applied. Both directions listed explicitly.
        "kb.autocorrect.confusables": {
          "their": ["there", "they're"],
          "there": ["their", "they're"],
          "theyre": ["they're"],
          "your": ["you're"],
          "youre": ["you're"],
          "its": ["it's"],
          "whose": ["who's"],
          "were": ["we're", "where"],
          "where": ["were", "wear"],
          "then": ["than"],
          "than": ["then"],
          "to": ["too", "two"],
          "too": ["to", "two"],
          "affect": ["effect"],
          "effect": ["affect"],
          "lose": ["loose"],
          "loose": ["lose"],
          "weather": ["whether"],
          "whether": ["weather"],
          "accept": ["except"],
          "except": ["accept"],
          "advice": ["advise"],
          "advise": ["advice"],
        },

        // How often the keyboard re-reads host-field traits (return-key label,
        // language, multi-keyboard) from textDidChange. They only change on
        // focus switches, yet the reads are host-process round-trips that were
        // firing per keystroke. 0 restores per-keystroke reads.
        "kb.host.traitRefreshMs": 500,
        // Explicit keyboard height (pt). Locks the height the current tree
        // already renders at (spec: docs/keyboard-spec.md) instead of
        // inheriting whatever the system picks. Remove to fall back to the
        // system default sizing.
        "kb.height.pt": 272,
        // Native scales the keyboard with the phone; one constant cannot. This
        // table is what K17+ binaries actually use — first bucket whose
        // maxWidth >= the screen width wins, kb.height.pt above is the
        // fallback for older builds.
        //
        // Derived from the row arithmetic in the tree below:
        //   height = padTop + toolsRow + 4×(rowGap + rowHeight) + padBottom
        // so if you change kb.geometry.* you must re-derive these, or the
        // rows and the frame stop agreeing and the bottom row gets clipped.
        //   ≤375  (SE, mini)      8 + 44 + 4×(9+40)  + 4 = 252
        //   ≤413  (13/14/15, Pro) 8 + 44 + 4×(10+42) + 4 = 264
        //   >413  (Plus, Max)     8 + 44 + 4×(11+44) + 4 = 276
        "kb.height.byWidth": [
          { maxWidth: 375, height: 252 },
          { maxWidth: 413, height: 264 },
          { maxWidth: 9999, height: 276 },
        ],
      };

      // Mic media: OWNER DECISION — the keyboard's IDLE mic is always the
      // static brand mark baked into the binary. The media-registry
      // mic.animation upload is for the in-app mic only and is deliberately
      // NOT exported as kb.mic.idleIcon / kb.mic.idleIcon.url (doing so made
      // the keyboard mic play the GIF at idle). Only the recording art is
      // still pushed; it shows exclusively while audio is being captured.
      const reg = getMediaRegistryFn?.() ?? {};
      const micRecording = reg["mic.animation.recording"];
      if (micRecording?.url) {
        flags["kb.mic.recordingIcon"] = { url: micRecording.url };
        flags["kb.mic.recordingIcon.url"] = micRecording.url;
      }

      // Personality quick-swap: the user's pinned presets (max 6) render as
      // a chip row above the keyboard rows. Each chip carries the preset id
      // + a display emoji + a short name; tapping it sets the active
      // preset for subsequent refine calls. The active preset id is passed
      // through too so the current chip can highlight without an extra
      // fetch.
      //
      // NOBODY PINNED YET GETS EXACTLY ONE TONE, and it is Zu.
      //
      // The row used to be empty until the first pin, which handed the
      // keyboard back to its own built-in tone cycle — a set of names nobody
      // chose, on a control that is supposed to be the user's. A new keyboard
      // now carries one voice: ours, doing the ordinary thing. Adding a voice
      // in Voices replaces it with what they picked, which is the moment the
      // control becomes theirs and reads as an answer to something they did.
      const pinnedIds = Array.isArray(personality?.pinnedPresetIds)
        ? personality!.pinnedPresetIds!
        : [];
      // ZU IS ALWAYS FIRST, and is not something the user adds or removes.
      // The keyboard's tone row is how you change voice mid-sentence, so the
      // way back to your own writing has to be on it whatever else is pinned
      // — Voices manages the styles, and your own voice is not a style.
      //
      // Resolved against the user's own presets — renamed built-ins and the
      // voices they created — not the stock list, which dropped every custom
      // voice they had put on the keyboard. Each carries `label`, what the
      // pill shows: "ZU" for Zu (the pill's own word for it), the name for
      // the rest.
      const presets = applyPresetOverrides(personality?.presetOverrides);
      const houseChip = { ...HOUSE_TONE, label: TONE_LABELS[DEFAULT_TONE] };
      const chips = [
        houseChip,
        ...pinnedIds
          .filter((id) => id !== HOUSE_TONE.id)
          .map((id) => presets.find((p) => p.id === id))
          .filter((p): p is (typeof presets)[number] => !!p)
          .map((p) => ({ id: p.id, name: p.name, tone: p.defaultTone, label: p.name })),
      ].slice(0, MAX_PINNED_PRESETS);
      // A pin list of ids that no longer resolve — voices deleted since —
      // would otherwise send an empty row and drop the keyboard back to its
      // own cycle. One tone is the floor, whatever the reason for the gap.
      flags["kb.personality.pinned"] = chips.length ? chips : [houseChip];
      if (personality?.activePresetId) {
        flags["kb.personality.activeId"] = personality.activePresetId;
      }
      // The tone the keyboard writes in is the ACTIVE VOICE's — the keyboard
      // offers voices, not a separate tone list. A tone picked on an older
      // keyboard (Formal, Casual…) would otherwise stay stuck on it: those
      // builds keep the last pick until the server names a tone they offer.
      const activeChip = chips.find((c) => c.id === personality?.activePresetId) ?? houseChip;
      flags["kb.personality.activeTone"] = activeChip.tone || DEFAULT_TONE;
      // The user's own dictionary — names, brands, jargon. The keyboard biases
      // swipe decoding and autocorrect toward these; a generic lexicon will
      // never contain a colleague's name, and "fixing" it is exactly the kind
      // of wrong correction that costs trust.
      if (personality?.vocabulary?.trim()) {
        flags["kb.personality.vocabulary"] = personality.vocabulary.trim().slice(0, 4000);
      }
      // Haptics the user chose, in the shape the keyboards read: a master
      // switch and a set of individual keys. Kept INDEPENDENT — turning the
      // master off must not discard the keys someone picked one by one.
      if (personality?.hapticsAll) flags["kb.haptics.all"] = true;
      if (personality?.hapticKeys?.length) {
        const keys: Record<string, boolean> = {};
        for (const k of personality.hapticKeys.slice(0, 128)) {
          const id = String(k).toLowerCase();
          if (id) keys[id] = true;
        }
        flags["kb.haptics.keys"] = keys;
      }
      // THE KEYBOARD OFFERS ZU AND THE VOICES THE USER PUT ON IT — nothing
      // else. It used to add the whole tone list (Formal, Casual, Very Casual,
      // Excited) to every keyboard, so a user who had added nothing still got
      // four options they never chose, beside a Voices screen that says "Zu is
      // always on it. Add a style from below."
      //
      // kb.personality.keyboardTones puts the tone list back, for builds that
      // read it (a console switch; off). What older builds get is what makes
      // them show only Zu: iOS through K40 cycles THIS list and falls back to
      // a built-in one when it is empty, so it gets Zu's tone alone; Android
      // shows its voices plus this list, so it gets nothing here.
      const keyboardTones = (
        Object.keys(TONE_LABELS) as Array<keyof typeof TONE_LABELS>
      ).map((id) => ({ id, label: TONE_LABELS[id] }));
      flags["kb.personality.keyboardTones"] = false;
      flags["kb.personality.tones"] = opts.platform === "android"
        ? []
        : keyboardTones.filter((t) => t.id === DEFAULT_TONE);
      // Staged rollout LAST, so an experiment can override anything above.
      // Keyed on the user id, so a user's slice is stable across requests —
      // settings must never flip under their fingers mid-sentence.
      return applyRollouts(flags, userId, activeRollouts());
    })(),
    // Was 600 (10 min). A live theme fix couldn't reach users mid-session.
    // 60 s keeps cost negligible and lets themed rollouts hit within a minute.
    cacheTtlSeconds: 60,
  });
}
