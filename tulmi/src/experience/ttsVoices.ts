/**
 * THE READ-ALOUD VOICES — one curated set, defined once.
 *
 * TTS (pipeline/tts.ts) can speak in any of OpenAI's gpt-4o-mini-tts voices,
 * but a free-text voice id is a free-text voice id: a typo, or a voice the
 * model does not know, reaches OpenAI and 400s mid-sentence. So the product
 * offers a hand-picked handful, and everything that touches the choice — the
 * phone's picker, the desk's picker, the /v1/speak fallback and the
 * /v1/personality save — reads it from HERE, so the set never drifts between
 * what a user can pick, what is stored, and what is forwarded to OpenAI.
 *
 * The ids are the voice names OpenAI expects, lowercase and exactly as sent;
 * the label and blurb are ours, for the picker. `nova` is the default — warm
 * and bright, the one a new user hears before they have chosen anything.
 */

export interface TtsVoice {
  /** The OpenAI gpt-4o-mini-tts voice id — sent verbatim, so lowercase. */
  id: string;
  /** Friendly name for the picker. */
  label: string;
  /** One line on how it sounds. */
  blurb: string;
}

/**
 * The offered voices, in the order the picker shows them. The default (nova)
 * leads; the rest follow from warm to cool, with the original Tailzu voice
 * (alloy) last so it stays reachable without being the first thing offered.
 */
export const TTS_VOICES: TtsVoice[] = [
  { id: "nova", label: "Nova", blurb: "Warm and bright" },
  { id: "sage", label: "Sage", blurb: "Calm and soft" },
  { id: "onyx", label: "Onyx", blurb: "Deep and steady" },
  { id: "shimmer", label: "Shimmer", blurb: "Clear and upbeat" },
  { id: "fable", label: "Fable", blurb: "Expressive storyteller" },
  { id: "coral", label: "Coral", blurb: "Friendly and light" },
  { id: "ash", label: "Ash", blurb: "Natural and even" },
  { id: "echo", label: "Echo", blurb: "Measured and cool" },
  { id: "alloy", label: "Alloy", blurb: "Neutral and balanced" },
];

/** The voice a new user hears, and the fallback for any invalid choice. */
export const DEFAULT_TTS_VOICE = "nova";

/** Every offered id, for a quick membership check. */
export const TTS_VOICE_IDS: ReadonlySet<string> = new Set(TTS_VOICES.map((v) => v.id));

/**
 * Is this one of the offered voices? The one gate every voice passes before it
 * is stored or sent to OpenAI — an unknown id is never forwarded, so a bad
 * value can never 400 a synthesis call.
 */
export function isValidTtsVoice(id: unknown): id is string {
  return typeof id === "string" && TTS_VOICE_IDS.has(id);
}

/** The offered voice for an id, or undefined — for a picker that labels the
 *  current pick. */
export function ttsVoiceById(id: string | undefined): TtsVoice | undefined {
  return id === undefined ? undefined : TTS_VOICES.find((v) => v.id === id);
}
