/**
 * The voice that reads answers aloud.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../../shared/types/sdui.js";
import { t, PHONE_LOOK } from "../../phoneLook.js";
import type { ScreenContext } from "../../screens.js";
import { isValidTtsVoice, DEFAULT_TTS_VOICE, TTS_VOICES } from "../../ttsVoices.js";
import { YOU_UI, youHead } from "./copy.js";

/**
 * READ-ALOUD VOICE — the voice /v1/speak reads answers back in.
 *
 * A single pick from the curated set (experience/ttsVoices.ts), on the same
 * pill the Languages screen uses, so it is learnt once. No Save button: each
 * tap writes the choice to personality.ttsVoice and refreshes, so the tick
 * moves to the row just chosen.
 *
 * The tick is computed here, from the stored voice (or the default when none
 * is set), rather than carried in screen state and matched live: the phones
 * resolve a `visibleIf` operand against screen state, where a voice id is not,
 * so a server-drawn tick is the one that shows. The refresh after each save is
 * what keeps it current.
 *
 * No preview button: nothing in the renderer plays audio from an endpoint, so
 * there is nothing to wire a "play a sample" control to. The voice is heard
 * where it is used — the ask feature reading an answer aloud.
 */
export function voiceReadScreen(ctx: ScreenContext): ScreenResponse {
  const current = isValidTtsVoice(ctx.personality.ttsVoice) ? ctx.personality.ttsVoice : DEFAULT_TTS_VOICE;
  const up = YOU_UI.pill;
  const row = (v: (typeof TTS_VOICES)[number]): Node => ({
    type: "Stack",
    props: { pressOpacity: 0.7 },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: up.gap,
      backgroundColor: up.background,
      borderRadius: up.radius,
      paddingLeft: up.paddingLeft,
      paddingRight: 18,
      paddingVertical: up.paddingVertical,
      minHeight: up.minHeight,
      marginBottom: up.marginBottom,
    },
    on: {
      onPress: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "selection" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: { ttsVoice: v.id },
            onSuccess: "saved",
            onError: "err",
          },
        ],
      },
    },
    children: [
      {
        type: "Stack",
        style: { flex: 1, gap: 1 },
        children: [
          t(v.label, "uiMedium", 15),
          { type: "Text", props: { content: v.blurb },
            style: { fontSize: 13, lineHeight: 21, color: PHONE_LOOK.ink2 } },
        ],
      },
      // The tick is the whole state display. Drawn on the stored voice; a tap
      // writes a new one and refreshes, and the tick comes back on that row.
      // Pale ink, heavy — not amber: a chosen voice is a setting, not live.
      ...(v.id === current
        ? [{
            type: "Text",
            props: { content: "✓" },
            style: { fontSize: 17, fontWeight: "800", color: PHONE_LOOK.ink },
          } as Node]
        : []),
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "voice_read",
    title: "",
    state: {},
    actions: {
      // The write landed: redraw so the tick sits on the new voice.
      saved: { kind: "refresh" },
      err: { kind: "sequence", actions: [
        { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" },
        { kind: "refresh" },
      ] },
    },
    hideHeader: true,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: YOU_UI.ground },
      children: [
        youHead("Read-aloud voice", "The voice that reads answers back to you."),
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            paddingHorizontal: PHONE_LOOK.side, paddingTop: 8, paddingBottom: 40,
          },
          children: TTS_VOICES.map(row),
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}
