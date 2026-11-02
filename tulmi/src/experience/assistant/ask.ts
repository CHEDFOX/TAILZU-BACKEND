/**
 * Ask on the phone: a field, the mic, Do it, and examples to tap.
 */

import type { ActionSpec, Node, ScreenResponse } from "../../../../shared/types/sdui.js";
import { en, wordsFor } from "../../connectors/words.js";
import { PHONE_FONT, label } from "../phoneLook.js";
import { blipBox } from "../touches.js";
import { seq, haptic, setState, call, toast, type You, fromState, word, pill, page, ASK, cannotReach, GAP } from "./kit.js";
import type { AssistantScreenCtx, Ctx } from "./screens.js";

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

/**
 * What one tap of Do it runs, from actions every build has: the ask, then its
 * answer acted on. The line is drawn from state (ask.res.say); a hand-off is
 * opened (openUrl resolves the state reference and, with `handoff`, holds it
 * to the phone's own copy of the hand-off list; a build without that list
 * holds it to the links it opens at all); an approval goes to the confirm sheet. The
 * sheet is opened without the task's id, since `navigate` does not fill state
 * into its params: with none it shows the newest waiting task, which is the
 * one this ask just made.
 */
export function askAction(ctx: Pick<AssistantScreenCtx, "platform" | "tzOffsetMinutes">): ActionSpec {
  return {
    kind: "condition", if: { truthy: "ask.text" },
    then: seq(
      haptic("selection"), setState("ask.busy", true), setState("ask.res", {}),
      call("POST", "/v1/assistant/ask", {
        body: {
          text: "$state.ask.text", ...(ctx.platform ? { platform: ctx.platform } : {}),
          ...(typeof ctx.tzOffsetMinutes === "number" ? { tzOffsetMinutes: ctx.tzOffsetMinutes } : {}),
        },
        assignTo: "ask.res",
        onSuccess: seq(
          setState("ask.busy", false),
          setState("ask.text", ""),
          { kind: "condition", if: { truthy: "ask.res.open.url" }, then: { kind: "openUrl", url: "$state.ask.res.open.url", handoff: true } },
          { kind: "condition", if: { truthy: "ask.res.taskId" }, then: { kind: "navigate", screenId: "assistant_approve" } },
        ),
        onError: seq(setState("ask.busy", false), toast(en("err.generic"), "error")),
      }),
    ),
    else: toast(en("ask.empty")),
  };
}

/** The three examples, in their voice. They live in state (ask.ex), so a chip shows exactly what it fills in: a translated node would not match its value. */
export function askExamples(language?: string): string[] {
  const w = wordsFor(language);
  return [w("ask.ex1"), w("ask.ex2"), w("ask.ex3")];
}

/** One example to tap: it fills the field with the very words it shows. */
function askChip(ui: You, examples: readonly string[], i: number, paper = false): Node {
  return {
    type: "Stack",
    on: { onPress: seq(haptic("selection"), setState("ask.text", examples[i])) },
    props: { pressOpacity: 0.7 },
    style: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: paper ? PAPER.line : "rgba(255,255,255,0.22)" },
    children: [fromState(`ask.ex.${i}`, "ui", 13.5, { color: ui.text })],
  };
}

/**
 * THE ONBOARDING'S PAPER (onboard.ts OB), for the You tab's card. The tab is
 * dark and the card was a darker box on it, in the tab's own words and
 * colours, which read as one more setting. The onboarding is where the app
 * shows what it can do, so the card takes its look: paper, ink, the heading
 * face, solid ink buttons, Blip with a handwritten bubble. Copied, not
 * imported: onboard.ts reads the phone screens, which read this file.
 */
export const PAPER = {
  ground: "#EFEDE8", surf: "#FCFBF8", ink: "#1C1A17", ink2: "rgba(28,26,23,0.7)", muted: "rgba(28,26,23,0.56)",
  hair: "rgba(28,26,23,0.13)", line: "rgba(28,26,23,0.2)", tile: "rgba(28,26,23,0.08)",
} as const;

/** What Ask is made of, for the Ask screen and for the You tab's card: one builder, so the two cannot drift apart. `paper` sets them on the card's paper. */
export const askParts = {
  field: (paper = false): Node => ({
    type: "TextField", bind: { value: "ask.text" },
    props: {
      placeholder: en("ask.ph"), multiline: true,
      ...(paper ? {
        background: PAPER.surf, borderColor: PAPER.hair, borderWidth: 1, color: PAPER.ink, placeholderColor: PAPER.muted,
        radius: 16, paddingHorizontal: 16, paddingVertical: 14, minHeightMultiline: 52,
      } : {}),
    },
  }),
  /** The mic that writes into the field, and Do it. */
  controls: (ctx: Pick<AssistantScreenCtx, "platform" | "tzOffsetMinutes">, ui: You, paper = false): Node => ({
    type: "Stack", style: { flexDirection: "row", gap: 8, alignItems: "center" },
    children: [
      paper ? {
        // On paper: an ink outline beside the solid ink Do it, the
        // onboarding's two buttons.
        type: "VoiceButton", bind: { value: "ask.text" },
        props: {
          targetApp: "X0 Bot", language: "auto", label: en("ask.mic"), stopLabel: en("ask.stop"),
          background: PAPER.surf, recordingColor: "#FFFFFF",
          fontFamily: PHONE_FONT.uiMedium, fontSize: 16, color: PAPER.ink, radius: 16, paddingVertical: 15,
        },
        style: { flex: 1, borderWidth: 1.5, borderColor: PAPER.ink },
      } : {
        type: "VoiceButton", bind: { value: "ask.text" },
        // Set like the pill beside it: its face and size, on one line, the
        // same height. While it listens it says "■ Stop": the app's own "■ Stop
        // & transcribe" wrapped to two lines in half a row and stood taller
        // than Do it. Listening stays the app's red; amber is a streak's.
        // (fontFamily, fontSize and color are drawn by builds from the
        // keyboard-fix update on; an older build keeps its own face.)
        props: {
          targetApp: "X0 Bot", language: "auto", label: en("ask.mic"), stopLabel: en("ask.stop"),
          background: ui.pill.background, recordingColor: "#FFFFFF",
          fontFamily: PHONE_FONT.uiMedium, fontSize: 15, color: ui.text, radius: 999, paddingVertical: 14,
        },
        style: { flex: 1 },
      },
      paper ? {
        type: "Stack",
        on: { onPress: askAction(ctx) },
        props: { pressOpacity: 0.7 },
        style: { height: 52, borderRadius: 16, paddingHorizontal: 26, alignItems: "center", justifyContent: "center", backgroundColor: PAPER.ink },
        children: [word(en("ask.go"), "uiMedium", 16, { color: PAPER.surf })],
      } : pill(ui, en("ask.go"), askAction(ctx), "primary", true),
    ],
  }),
  /** The answer: its words are the server's and theirs, from state, never reworded. */
  answer: (ui: You, fill: string, top: number): Node => ({
    type: "Stack",
    visibleIf: { truthy: "ask.res.say" },
    style: { padding: 14, borderRadius: 16, marginTop: top, backgroundColor: fill },
    children: [fromState("ask.res.say", "ui", 15.5, { lineHeight: 23, color: ui.text })],
  }),
  chips: (ui: You, examples: readonly string[], paper = false): Node =>
    ({ type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, children: examples.map((_, i) => askChip(ui, examples, i, paper)) }),
  state: (examples: readonly string[]) => ({ ask: { text: "", busy: false, res: {}, ex: examples } }),
};

export function askScreen(ctx: Ctx, ui: You): ScreenResponse {
  if (!ctx.connectorsOn) {
    return page(ctx, ASK, ui, en("ask.h"), en("ask.p"), [cannotReach(ui)], { state: {} });
  }
  const examples = askExamples(ctx.language);
  const body: Node[] = [
    GAP(18),
    askParts.field(),
    GAP(12),
    askParts.controls(ctx, ui),
    // WORKING: Blip thinking, beside the line that was always here. The one Blip here.
    {
      type: "Stack",
      visibleIf: { truthy: "ask.busy" },
      style: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
      children: [blipBox("think-s", 0.5), word(en("ask.busy"), "ui", 13.5, { color: ui.textDim, flex: 1 })],
    },
    askParts.answer(ui, ui.pill.background, 16),
    label(en("ask.try"), { marginTop: 28, marginBottom: 12 }),
    askParts.chips(ui, examples),
  ];
  return page(ctx, ASK, ui, en("ask.h"), en("ask.p"), body, { state: askParts.state(examples) });
}
