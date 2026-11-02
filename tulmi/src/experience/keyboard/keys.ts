/**
 * The keyboard's keys: rows, fills, text colours and the grounds they sit on.
 */

import type { KeyboardNode } from "../../../../shared/types/sdui.js";

/**
 * The keyboard's own ground: 2% black. Not zero, because iOS delivers a touch to
 * a custom keyboard only where it has painted something (see the theme).
 */
export const KEYBOARD_GROUND = "#00000005";
/**
 * The same 2%, in white, for a light keyboard. Black there was a grey sheet:
 * with the key plane's tint on top it darkened the whole key area by 9 levels
 * against the strips iOS paints itself above and below it. White moves a
 * light backdrop by half a level. Same alpha, so touches land the same.
 */
export const LIGHT_KEYBOARD_GROUND = "#FFFFFF05";

// --- Keyboard config (server-driven keyboard; cached by the native shell) ----

// ---------------------------------------------------------------------------
// SDUI keyboard — the whole thing as a Node tree the native renderer walks.
// ---------------------------------------------------------------------------
//
// Design goals (in order):
//   1. Look and feel indistinguishable from Apple's stock dark keyboard until
//      the user notices the top bar + refine key.
//   2. Real iOS translucency via UIVisualEffectView(systemChromeMaterialDark) —
//      the ONE thing the previous hand-built path could never do because the
//      color parser was hex-only and there was no backing blur view.
//   3. Brand touch WITHOUT screaming: the Return key wears the brand accent,
//      the mic key wears the brand mark. Everything else stays system-neutral.
//   4. Every visible behavior is a data change here — new layouts, new colors,
//      new key shapes, new feature keys all ship as backend JSON.

/** Letter-key builder. Font size 23pt is Apple's actual letter-key size
 * (KeyboardKit unit tests). Weight regular; the shipped SDUI-renderer build
 * applies these to every LetterKey via applyStyle. */
export const kLetter = (char: string): KeyboardNode => ({
  type: "LetterKey",
  props: { char },
  style: { flex: 1, fontSize: 23, fontWeight: "regular" },
});

/** Punctuation key on the 123 / #+= pages — same visual + font weight as a
 * letter key but bigger font because these pages use flex-1 across fewer
 * items so each key is naturally wider. */
export const kPunct = (char: string): KeyboardNode => ({
  type: "LetterKey",
  props: { char },
  style: { flex: 1, fontSize: 20, fontWeight: "regular" },
});

/** Half-key row-2 indent (Apple pattern). flex:0.5 gives the letters in
 * a-l the exact same width as q-p on ANY screen size — was hardcoded to
 * width:13 before the shipped SDUI renderer supported proportional flex.
 * Post-rebuild, flex works properly and we can scale correctly. */
export const kHalfSpacer = (): KeyboardNode => ({ type: "Spacer", style: { flex: 0.5 } });

/**
 * Colors picked to match Apple's iOS 17 dark-mode system keyboard exactly.
 *
 * Native iOS uses TWO layers of hierarchy:
 *   - Letter keys sit LIGHTER + more transparent so the blur backdrop reads
 *     through them — this is where the "frosted glass" premium feel comes
 *     from. Fully opaque flat gray is what makes third-party keyboards look
 *     cheap.
 *   - Function keys (shift, backspace, 123, globe, return, etc.) sit DARKER
 *     + more opaque, creating a subtle "recessed" band that visually anchors
 *     the outer edges of the layout.
 *
 * The palette is deliberately restrained — Apple doesn't tint their return
 * key at all in typing fields, and the brand orange we tried before read
 * as "kids-app CTA button" against the muted gray hierarchy. Any brand
 * touch we add later should be far subtler (a colored glyph, not a filled
 * key).
 */
// Palette derived from cross-verified pixel-measurement research (archagon
// tasty-imitation-keyboard, KeyboardKit, sotto-voce). Apple's dark-mode
// keys are NOT semi-transparent dark gray — they're semi-transparent WHITE
// and GRAY over the blur backdrop. That inversion is what makes the keys
// look luminous against the frosted glass instead of dark blocks.
//
//   Letter key:   rgba(255,255,255,0.30)  → #FFFFFF4D
//   Function key: rgba(128,128,128,0.30)  → #8080804D
//   Pressed:      the two swap (letter → function color, and vice-versa)
// Comparing to freshly-captured screenshots of the native iOS dark keyboard:
// letter keys are luminous chips (~55% white over the chrome blur); function
// keys sit recessed (~20% white — darker/dimmer, not brighter). Pressed state
// on both flips brighter for visible touch feedback. Our previous #FFFFFF40
// (25%) letter fill was too thin — the blur swallowed it and everything read
// dimmer than native.

// ---------------------------------------------------------------------------
// Keyboard key rows — ONE definition, consumed by two things.
// ---------------------------------------------------------------------------
//
// The keyboard tree builds its rows from these, and so does the haptics picker.
// The picker has to BE the keyboard, not a list resembling it, and the only way
// that stays true as keys are added is if neither side owns the layout.
export const KB_ROW_LETTERS_1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
export const KB_ROW_LETTERS_2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
export const KB_ROW_LETTERS_3 = ["z", "x", "c", "v", "b", "n", "m"];
export const KB_ROW_NUM_1 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
export const KB_ROW_NUM_2 = ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""];
export const KB_ROW_SYM_1 = ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="];
export const KB_ROW_SYM_2 = ["_", "\\", "|", "~", "<", ">", "\u20ac", "\u00a3", "\u00a5", "\u00b7"];
/** Row 3's punctuation, shared by the 123 and #+= layers. */
export const KB_ROW_PUNCT_3 = [".", ",", "?", "!", "'"];

export const KEY_FILL_LETTER = "#FFFFFF8C";      // 55% white — luminous "floating chip" like native letter keys
export const KEY_FILL_FUNCTION = "#FFFFFF33";    // 20% white — recessed/dimmer than letter keys (matches native hierarchy)
export const KEY_FILL_SPACE = "#FFFFFF8C";       // matches letter fill
export const KEY_FILL_RETURN = "#FFFFFF33";      // matches function fill
export const KEY_TEXT = "#FFFFFF";
export const KEY_TEXT_FUNCTION = "#FFFFFF";
// Press color — every key (letter, function, shift, backspace, return)
// flashes this for ~120ms on tap. Fires on touch-down inside the Swift
// renderer's keyTouchDown handler (theme.keyPressed → this hex), then
// keyTouchUp animates back to the resting bg via UIView.animate. Neutral, not
// the brand amber: amber is reserved for what is live (listening), and a
// keystroke is not. Pale ink over a dark backdrop; ink over a light one
// (LIGHT_KEY_PRESSED). #RRGGBBAA, because the keyboards parse only hex.
export const KEY_PRESSED = "#F3E2C638";          // pale ink #F3E2C6 at 22%
export const LIGHT_KEY_PRESSED = "#1B171224";    // ink #1B1712 at 14%

// -------- Light-mode counterparts (used by the next SDUI build) -----------
//
// Apple's light-mode dark-keyboard-equivalent palette:
//   Letter key:   rgba(0,0,0,0.05)   → #0000000D  (near-transparent dark)
//   Function key: rgba(0,0,0,0.10)   → #0000001A  (slightly darker recess)
//   Key text:     #000000            (pure black)
//   Blur:         systemChromeMaterialLight
//
// The shipped keyboard renderer doesn't read these yet — until the next build
// adds trait-collection detection, the top-level `theme` (dark) is what's
// applied on every device regardless of mode. But by emitting the light
// palette NOW, the day the build lands the keyboard automatically flips
// with zero backend edit.
// Light-mode letter keys are near-solid WHITE (Apple's actual value has almost
// no transparency — very light chips on a light-gray keyboard region). Our
// previous 5% black was so translucent it dissolved into the app content.
// #FFFFFFE6 (90% white) is what native reads as against the light keyboard
// backdrop and holds up over any light-app content behind it.
export const LIGHT_KEY_FILL_LETTER = "#FFFFFFE6";     // 90% white — solid-white chips
export const LIGHT_KEY_TEXT = "#000000";
