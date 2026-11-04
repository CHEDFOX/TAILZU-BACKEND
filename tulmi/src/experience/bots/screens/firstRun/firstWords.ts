/**
 * The first run's firstWords screen.
 */

import type { Node, ActionRef, ScreenResponse, ActionSpec } from "../../../../../../shared/types/sdui.js";
import { row, box, meta, col, text, C, FACE, labelled, icon, when, type BotsCtx, SCREENS, button, grow, blip } from "../../kit.js";
import {
  type Words, CLAY, type Style, toast, go, fromApp, FROM_APP, leave, deskFrame, W, signedInAs, deskBlip, deskHeading, deskFoot, deskBack,
  phoneFrame, phoneBackLine, phoneHeading,
} from "./parts.js";

// ===================================================================== First words

/** "4", "4.5". */
const secs = (s: number): string => (s >= 10 || Number.isInteger(s) ? String(Math.round(s)) : s.toFixed(1));

/** What was said here, as the boards' numbers: words, the seconds it took, and typing it by comparison. Null until something was said. */
function spoken(w: Words | undefined, desk: boolean): Node | null {
  if (!w || w.words <= 0) return null;
  const words = w.words === 1 ? "1 word" : `${w.words.toLocaleString("en-IN")} words`;
  const typing = Math.max(1, w.typingSeconds);
  const bar = (label: string, pct: number, color: string, value: string) => row([
    box([meta(label, { size: 12 })], { width: desk ? 70 : 78, flexShrink: 0 }),
    box([box([], { width: `${Math.max(4, Math.min(100, pct)).toFixed(0)}%`, height: 6, borderRadius: 3, backgroundColor: color })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    box([meta(value, { size: 12, align: "right" })], { width: 40, flexShrink: 0, alignItems: "flex-end" }),
  ], { gap: 10 });
  const faster = w.seconds > 0 ? typing / w.seconds : 0;
  return col([
    row([text(words, { size: 34, weight: 700, tracking: -0.8, lineHeight: 41 }), ...(w.seconds > 0 ? [text(`in ${secs(w.seconds)} seconds`, { size: 15, color: C.grey70, lineHeight: 20 })] : [])], {
      gap: 8, alignItems: "baseline", flexWrap: "wrap",
    }),
    ...(w.seconds > 0 ? [
      bar("Speaking", (w.seconds / Math.max(typing, w.seconds)) * 100, CLAY, `${secs(w.seconds)} s`),
      bar("Typing", 100, C.track, `~${typing} s`),
    ] : []),
    meta(faster >= 1.5 ? `About ${Math.round(faster)}× faster than typing it.` : `Typing it would take about ${typing} seconds.`, { size: 13 }),
  ], { gap: 10 });
}

/** The practice box: whatever Keylessbord writes into it stays on this page. */
function practiceField(desk: boolean): Node {
  return {
    type: "TextField", id: "said", bind: { value: "said" },
    props: {
      placeholder: desk ? "Click here, then hold your key and speak" : "Tap the clay key and speak. Your words land here.", placeholderColor: C.idle,
      background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, multiline: true,
      minHeight: desk ? 86 : 54, minHeightMultiline: desk ? 86 : 54, color: C.ink,
    },
    style: {
      minHeight: desk ? 86 : 54, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 18, lineHeight: desk ? 28 : 27,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}

/**
 * The keyboard of the phone's board, with Keylessbord's clay key. On a phone that has it, the clay key IS the mic, and works
 * as the real keyboard's does: tap it and speak, tap it again (the app's own VoiceButton: /v1/transcribe-clean, which
 * counts the words and the seconds), and the words land in the box above; then the numbers are worked out again.
 */
function keyboardArt(mic: Node | null): Node {
  const key = (style: Style = {}): Node => box([], { height: 32, borderRadius: 7, backgroundColor: C.paper, flexGrow: 1, flexBasis: 0, ...style });
  const wave = [8, 16, 22, 12, 18, 9, 14, 6];
  return labelled(col([
    row(Array.from({ length: 10 }, () => key()), { gap: 5 }),
    row(Array.from({ length: 9 }, () => key()), { gap: 5, paddingHorizontal: 16 }),
    row([
      key({ height: 38, backgroundColor: C.track, flexGrow: 1.3 }),
      mic ?? box([icon("mic", { size: 18, color: C.paper })], { height: 38, borderRadius: 7, backgroundColor: CLAY, flexGrow: 1.1, flexBasis: 0, alignItems: "center", justifyContent: "center" }),
      row(wave.map((h) => box([], { width: 3, height: h, borderRadius: 2, backgroundColor: CLAY })), { height: 38, borderRadius: 7, backgroundColor: C.paper, flexGrow: 4, flexBasis: 0, gap: 3, justifyContent: "center" }),
      key({ height: 38, backgroundColor: C.track, flexGrow: 1.4 }),
    ], { gap: 5 }),
  ], { backgroundColor: C.surface, borderRadius: 22, paddingTop: 10, paddingHorizontal: 8, paddingBottom: 12, gap: 8 }), mic ? "Keyboard: tap the clay key to speak" : "Keyboard with the clay Keylessbord mic key");
}

/**
 * The clay key as the app's own speak button (a build that has one: it says "VoiceButton"). Tap to start, tap to stop,
 * as the keyboard's mic key is: the stop square while it listens.
 */
function clayMic(after: ActionRef): Node {
  return {
    type: "VoiceButton",
    bind: { value: "said", state: "mic" },
    props: { radius: 7, background: CLAY, recordingBackground: CLAY, paddingVertical: 0, label: "", stopLabel: "", transcribingLabel: "" },
    style: { height: 38, flexGrow: 1.1, flexBasis: 0, alignItems: "center", justifyContent: "center", paddingVertical: 0 },
    on: { onChange: after, onError: toast("Couldn't hear that. Tap the key and try again.") },
    children: [
      when({ neq: ["mic", "recording"] }, icon("mic", { size: 18, color: C.paper })),
      when({ eq: ["mic", "recording"] }, icon("stop", { size: 16, color: C.paper, weight: 2.4 })),
    ],
  };
}

export function firstWords(ctx: BotsCtx, w: Words | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const num = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));
  const baseW = num(ctx.params.w) ?? w?.totalWords;
  const baseS = num(ctx.params.s) ?? w?.totalSeconds;
  const said = typeof ctx.params.said === "string" ? ctx.params.said : "";
  // The numbers are worked out on the server from the account's own usage since this step opened; this asks again.
  const check: ActionSpec = go(SCREENS.firstWords, {
    ...(baseW !== undefined ? { w: baseW } : {}), ...(baseS !== undefined ? { s: baseS } : {}), said: "$state.said", ...(fromApp(ctx) ? FROM_APP : {}),
  }, true);
  const result = spoken(w, desk);
  const nothingYet = col([
    meta("Your words, and how long they took, show here once you've spoken.", { size: 13, lineHeight: 18 }),
    when({ truthy: "said" }, button("How fast was that?", check, { kind: "secondary", size: "md" })),
  ], { gap: 10 });
  // Out of the setup, to where it was opened from (Turn on Keylessbord is no longer under it), or Home.
  const next = button(result ? "Nice, done" : "Done", leave(ctx), { size: "lg", wide: !desk });
  const state = { said, mic: "idle" };

  if (desk) {
    return deskFrame(ctx, {
      title: W.wordsH, right: signedInAs(ctx), state,
      left: [
        deskBlip("listen", 140),
        deskHeading("Keylessbord", W.wordsH, "Hold your key and say anything, in any mix."),
        box([result ?? nothingYet], { maxWidth: 400 }),
      ],
      main: [col([
        row([
          row([0, 1, 2].map(() => box([], { width: 11, height: 11, borderRadius: 6, backgroundColor: C.outline })), { gap: 7 }),
          grow(), meta("Try it here", { size: 13 }), grow(), box([], { width: 47 }),
        ], { height: 40, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.divider }),
        col([
          meta("Just for practice. Keylessbord writes what you say here.", { size: 12 }),
          box([practiceField(true)], { borderWidth: 1.5, borderColor: C.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, minHeight: 118 }),
          ctx.can.has("DeskShell")
            ? row([{ type: "Keys", props: { source: "hotkey" } }, meta("Hold, speak, let go to drop the words in.", { size: 12 })], { gap: 8, justifyContent: "center", flexWrap: "wrap" })
            : meta("Hold your key, speak, let go to drop the words in.", { size: 12, align: "center" }),
          ...(result ? [when({ truthy: "said" }, row([button("Count again", check, { kind: "quiet", size: "md" })], { justifyContent: "center" }))] : []),
        ], { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }),
      ], { borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper })],
      foot: deskFoot(deskBack(leave(ctx)), [next]),
    });
  }
  return phoneFrame(ctx, {
    title: W.wordsH, state, gap: 16,
    body: [
      phoneBackLine(undefined, leave(ctx)),
      phoneHeading(W.wordsH, "Tap the clay key and say anything, in any mix. Tap it again when you're done.", 6),
      col([
        box([blip("listen", 140)], { position: "absolute", top: 0, right: 22 }),
        col([
          row([
            icon("mic", { size: 14, color: CLAY }),
            when({ eq: ["mic", "idle"] }, meta("Keylessbord writes here", { size: 12 })),
            when({ eq: ["mic", "recording"] }, meta("Listening. Tap the clay key again when you're done.", { size: 12, color: CLAY })),
            when({ eq: ["mic", "busy"] }, meta("Writing it down…", { size: 12 })),
          ], { gap: 8 }),
          practiceField(false),
        ], { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, gap: 8, zIndex: 1 }),
      ], { paddingTop: 72 }),
      result ? col([result, when({ truthy: "said" }, row([button("Count again", check, { kind: "quiet", size: "md" })]))], { gap: 6 }) : nothingYet,
      grow(),
      keyboardArt(ctx.can.has("VoiceButton") ? clayMic(check) : null),
    ],
    footer: [next],
  });
}
