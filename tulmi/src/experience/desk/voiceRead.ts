/**
 * The voice that reads answers aloud.
 */

import type { ScreenResponse } from "../../../../shared/types/sdui.js";
import { isValidTtsVoice, DEFAULT_TTS_VOICE, TTS_VOICES } from "../ttsVoices.js";
import type { DeskContext } from "./context.js";
import { defRow, text, link, screen, page, stack, row } from "./kit.js";

/**
 * READ-ALOUD VOICE — the desk's picker for the voice /v1/speak reads in.
 *
 * The same curated set the phone offers (experience/ttsVoices.ts), one row
 * each: the name, how it sounds, and — for every voice but the one in use — a
 * link that writes it to personality.ttsVoice and refreshes. The active voice
 * carries "In use" instead of a link, the way the Voices page marks the voice
 * that is writing. No preview: nothing in the window plays audio from an
 * endpoint, and the voice is heard where it is used.
 */
export function deskVoiceRead(ctx: DeskContext): ScreenResponse {
  const current = isValidTtsVoice(ctx.personality.ttsVoice) ? ctx.personality.ttsVoice : DEFAULT_TTS_VOICE;
  const rows = TTS_VOICES.map((v) => defRow(
    v.label,
    v.blurb,
    v.id === current
      ? text("In use", "d-margin")
      : link("Use", {
          kind: "callEndpoint", method: "PUT", path: "/v1/personality",
          body: { ttsVoice: v.id },
          onSuccess: { kind: "refresh" },
          onError: { kind: "toast", message: "Couldn't save that voice. Try again." },
        }),
  ));
  return screen("desk_voice_read", "Read-aloud voice", [page([
    text("Read-aloud voice", "d-eyebrow"),
    text("The voice that reads answers back to you.", "d-h1", { marginTop: 6, marginBottom: 26 }),
    stack(rows),
    row([link("Back to Settings", { kind: "navigate", screenId: "desk_settings" })], { marginTop: 28 }, "d-tools"),
  ], { maxWidth: 820 })]);
}
