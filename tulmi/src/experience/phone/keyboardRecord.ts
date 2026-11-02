/**
 * Recording from the keyboard: the app's side of a dictation the keyboard started.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import type { ScreenContext } from "../screens.js";

/**
 * The main app's landing screen when the keyboard extension hands off a
 * mic tap. `params.session` (from the deep link) is threaded into
 * state.handoffSessionId so the completeKeyboardHandoff action knows which
 * session to write back to the App Group.
 *
 * The user sees the recording UI, speaks, and taps Send — the SDUI
 * VoiceToggle already records + uploads to /v1/transcribe-clean and puts
 * the cleaned text in state.dictationSample. Send fires
 * completeKeyboardHandoff, which writes the text to the App Group +
 * fires a Darwin notification the keyboard observes to insert.
 *
 * Fully backend-designed: swap the media, copy, layout, any which way,
 * without a rebuild. Add hero art, a Lottie, whatever — it's just SDUI.
 */
export function keyboardRecordScreen(ctx: ScreenContext): ScreenResponse {
  const sessionId = String(ctx.params?.session ?? "");
  const hostApp = String(ctx.params?.host ?? "");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "keyboard_record",
    title: "",
    state: {
      handoffSessionId: sessionId,
      hostApp,
      dictationSample: "",
      sending: false,
    },
    actions: {
      // Fired by VoiceToggle when transcription fails.
      err: { kind: "toast", tone: "error", message: "Voice failed. Check your connection." },
      // Called by the Send button — writes the text back through the native
      // module and shows a "swipe back" hint. Backend can localize the toast
      // or swap it for a full-screen "Sent" card by editing this action.
      send: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "sending", value: true },
          { kind: "completeKeyboardHandoff" },
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "success", message: "Sent to X0 Bot keyboard — swipe back to your app." },
        ],
      },
      // User bailed — cancel the pending handoff so the keyboard doesn't
      // sit in "listening" forever.
      cancel: {
        kind: "sequence",
        actions: [
          { kind: "cancelKeyboardHandoff" },
          { kind: "navigateBack" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 20, paddingTop: 40, paddingBottom: 24 },
      children: [
        { type: "Overline", props: { content: "Voice keyboard" } },
        { type: "Heading", props: { content: "Speak, then swipe back" }, style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginTop: 6, marginBottom: 6 } },
        { type: "Paragraph", props: { content: "We'll clean it up and drop the text into your keyboard. Nothing gets sent from here — the keyboard inserts it into whatever app you were in." }, style: { marginBottom: 28 } },
        // Big centered mic. VoiceToggle handles record → upload →
        // dictationSample.
        //
        // Media on the mic:
        //   iconIdle       — media for the idle (not-recording) state
        //   iconRecording  — media for the recording state
        //
        // Each accepts EITHER the simple shape:
        //     { key: "mic.idle" }                             ← MediaSpec
        // OR the rich playback shape:
        //     {
        //       source: { key: "mic.recording" },             ← required
        //       autoplay: true,                                ← play on show
        //       loop: true,                                    ← loop forever
        //       speed: 1.0,                                    ← Lottie / video
        //       muted: true,                                   ← video (default)
        //       maxDurationMs: 4000,                           ← hard cap
        //       tint: "#FFCC00",                               ← PNG tint
        //       playing: true,                                 ← controlled play
        //       fireOnEnd: true,                               ← ⇢ node.onComplete
        //     }
        //
        // When fireOnEnd is true, the VoiceToggle's onComplete NodeEvent
        // fires when the media's playback ends (natural end OR after
        // maxDurationMs). Wire an SDUI action in `on.onComplete` on the
        // VoiceToggle node to react — the payload is
        // { state: "idle" | "recording" } so one action can handle both.
        //
        // Supported source formats (auto-detected):
        //   PNG · JPG · WebP · SVG · GIF · APNG · Lottie JSON · MP4 / MOV / WebM
        //
        // Uploading:
        //   POST /v1/media/upload?key=mic.idle       (any of the above)
        //   POST /v1/media/upload?key=mic.recording  (any of the above)
        //
        // Missing keys fall back to the built-in Tailzu-mark → line morph,
        // so a fresh deploy without uploaded assets still works.
        { type: "Stack", style: { alignItems: "center", justifyContent: "center", marginBottom: 20 }, children: [
          {
            type: "VoiceToggle",
            bind: { value: "dictationSample" },
            props: {
              targetApp: hostApp || "Generic",
              language: "auto",
              size: 128,
              autoStart: true,
              // Backend-owned mic art with full playback control.
              //
              // Single-media mode: supply ONLY iconIdle → the mic uses the
              // same asset in both states and the client auto-binds `playing`
              // to the recording state. tap → play, tap → pause (holds the
              // current frame), tap → resume from that frame. Works for
              // Lottie + video; GIF/APNG can't pause so the visual just
              // keeps looping while recording state does its own thing.
              //
              // Two-media mode: also supply iconRecording → the two swap on
              // state change (see the commented block below to re-enable).
              //
              // Voice-reactive playback:
              //   voiceReactive:true → media speed is driven by mic level
              //                         while recording (loud → fast, quiet
              //                         → slow). Amplitude-based, not
              //                         fundamental-pitch, but visually
              //                         reads the same.
              //   speedRange:[a,b]   → min/max playback multiplier
              //   levelRange:[a,b]   → dB window mapped into speedRange
              //   speedSmoothing:0..1 → higher = laggier attack/release
              //
              //   NOTE: only Lottie + MP4 can be retimed at runtime. GIF/APNG
              //   ignore live speed changes and keep their baked-in rate.
              iconIdle: {
                source: { key: "mic.animation" },
                loop: true,
                speed: 1,
                muted: true,
                voiceReactive: true,
                speedRange: [0.5, 2.5],
                levelRange: [-45, -5],
                speedSmoothing: 0.7,
              },
              // iconRecording: { source: { key: "mic.recording" }, loop: true },
              background: "#ffffff",
              contentScale: 0.72,
            },
            on: { onError: "err" },
            fallback: {
              type: "VoiceButton",
              bind: { value: "dictationSample" },
              props: { targetApp: hostApp || "Generic", language: "auto" },
              on: { onError: "err" },
            },
          },
        ] },
        // Live transcription preview so the user can trust what's being sent.
        { type: "Card", style: { marginBottom: 20 }, children: [
          { type: "Paragraph", visibleIf: { falsy: "dictationSample" }, props: { content: "Tap the mic to start. Tap again to stop." }, style: { color: "$color.muted" } },
          { type: "TextField", visibleIf: { truthy: "dictationSample" }, bind: { value: "dictationSample" }, props: { multiline: true } },
        ] },
        // Send + Cancel row.
        { type: "Button", visibleIf: { truthy: "dictationSample" }, props: { label: "Send to keyboard", variant: "primary" }, on: { onPress: "send" } },
        { type: "Spacer", style: { height: 10 } },
        { type: "Button", props: { label: "Cancel", variant: "secondary" }, on: { onPress: "cancel" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}
