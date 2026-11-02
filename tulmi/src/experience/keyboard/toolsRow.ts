/**
 * The keyboard's tools row: the mic and the actions beside it.
 */

import type { KeyboardNode } from "../../../../shared/types/sdui.js";
import { MIC_MARK, MIC_MOTION, MIC_PROGRAM } from "./mic.js";

/** Emits one variant of the tools row (mic / tone pill / refine). Called
 * twice — once with dark palette, once with light — each gated by a
 * visibleIf on state.appearance. Style hex literals don't auto-flip on
 * trait change, so we can't just pass one row and hope the renderer knows.
 */
/** Two-toggle tools row — mic (left, orange) and tone pill (right, defined
 * dark oval). No refine key: stopping the mic auto-runs refinement via the
 * sequence action on tap (needs the queued MicKey Swift patch to fire runRefine
 * inside stopDictation; the sequence-based fallback below handles it TODAY
 * whether or not the patch has landed).
 */
export const makeToolsRow = (opts: {
  micBg: string;
  micFg: string;
  toneBg: string;
  toneFg: string;
  toneBorderColor: string;
  visibleIf: any;
}): KeyboardNode => ({
  type: "Row",
  // Compact 44pt row — the two toggles read as accents, not "here's the tools
  // bar you must respect". The 4pt sides match the container L/R so the mic
  // sits flush with the keyboard's own left edge and the tone pill flush right.
  //
  // THE MIC IS THE BIGGER OF THE TWO. The row centres its children instead
  // of stretching them, so the mic can be 42 while the suggestions and the
  // tone pill stay 36 — under .fill every child had to be exactly the inner
  // height, or iOS broke a constraint on every mount. Top and bottom give up
  // 3pt each to make the room, so the keyboard is no taller. `padding` stays
  // for any build that reads only that.
  style: { gap: 8, height: 44, padding: 4, paddingTop: 1, paddingBottom: 1, align: "center" },
  visibleIf: opts.visibleIf,
  children: [
    // Mic — LEFT side. Solid neutral circle (see the rows' micBg). When idle it starts
    // dictation; when recording it stops + immediately fires runRefine so the
    // captured text moves straight into the refinement pipeline.
    //
    // NO explicit `on.onPress` here. The Swift MicKey renderer has a
    // built-in fallback that handles the exact same "tap-to-toggle-and-
    // refine" behavior when no backend action is supplied. This shape works
    // on every client version — new AND old — because it doesn't depend on
    // the client understanding a `condition` action node. Older TestFlight
    // builds without the `condition` action handler were silently no-op-ing
    // on tap; this restores start/stop for them.
    {
      type: "MicKey",
      // Not in a password box.
      //
      // iOS never sees one — the system takes secure fields away from
      // third-party keyboards — but Android hands them over like any other
      // field, and the mic there would record into a field the user filled in
      // with dots and send it to us. The native side refuses it either way;
      // this stops the key being drawn at all, because a key that would be
      // refused is a key that reads as broken.
      //
      // `falsy` on a state key an older client does not publish evaluates
      // true, so every existing build keeps showing the mic exactly as now.
      visibleIf: { falsy: "state.secured" },
      // The mark and its motion, as data. A build that understands them draws
      // the mark from here; one that does not draws its bundled asset.
      props: { mark: MIC_MARK, motion: MIC_MOTION, program: MIC_PROGRAM },
      style: {
        flex: 0,
        width: 42,
        height: 42,
        bg: opts.micBg,
        fg: opts.micFg,
        radius: 21,          // circular
      },
    },
    // Middle slot — the suggestion strip (autocorrect revert chip + word
    // completions, K4+ binaries). Replaces the plain spacer: when empty it
    // renders as clear space exactly like the spacer did (and pre-K4 builds
    // never populate it), so the row reads identical until chips appear
    // between the mic and the tone pill. Height 36, centred in the row
    // beside the larger mic. kb.suggestion.height must agree (it defaults
    // to 36).
    { type: "SuggestionBar", style: { flex: 1, height: 36 } },
    // Tone pill — RIGHT side. Compact oval with a subtle border for shape
    // definition against the transparent keyboard region.
    {
      type: "LetterKey",
      props: { char: "ZU" },
      bind: { content: "tone" },
      on: { onPress: { kind: "cycleTone" } },
      style: {
        flex: 0,
        width: 96,
        // 36, centred in the row (align: "center"), level with the
        // suggestions; only the mic is larger.
        height: 36,
        bg: opts.toneBg,
        fg: opts.toneFg,
        radius: 18,
        fontSize: 13,
        fontWeight: "medium",
        borderColor: opts.toneBorderColor,
        borderWidth: 1,
      },
    },
  ],
});
