/**
 * THE REALTIME VOICES. OpenAI's realtime models speak in their own set of voices, not the read-aloud set the person picks from
 * (experience/ttsVoices.ts). This maps one to the other, so a person who chose Onyx hears the nearest realtime voice whether the words
 * come from a read-aloud (pipeline/tts.ts) or from a live call (botsBots/planCallLive.ts), and a call that falls back keeps it.
 *
 * Pure: no imports. Anyone who never picked a voice, and any name we do not know, gets `marin` — one default for everyone, in every
 * language (there is no per-language default: the model follows whatever the person speaks).
 */

/** The realtime voice for each curated read-aloud voice. */
export const REALTIME_VOICE: Readonly<Record<string, string>> = {
  nova: "marin",
  sage: "sage",
  onyx: "cedar",
  shimmer: "shimmer",
  fable: "verse",
  coral: "coral",
  ash: "ash",
  echo: "echo",
  alloy: "alloy",
};

/** The one voice everyone else hears. */
export const DEFAULT_REALTIME_VOICE = "marin";

/** The realtime voice to speak a person's words in, from the read-aloud voice they chose (or nothing at all). */
export function realtimeVoice(ttsVoice: string | null | undefined): string {
  const k = String(ttsVoice ?? "").trim().toLowerCase();
  return REALTIME_VOICE[k] ?? DEFAULT_REALTIME_VOICE;
}

/** Whether a model name means the realtime service (`gpt-realtime-2.1-mini`, `gpt-realtime-2.1`, …). */
export function isRealtimeModel(model: string | null | undefined): boolean {
  return String(model ?? "").trim().toLowerCase().startsWith("gpt-realtime");
}
