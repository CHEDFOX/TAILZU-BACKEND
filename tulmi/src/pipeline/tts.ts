/**
 * Text-to-speech (voice output). The "mouth": turns text into spoken audio for
 * features like the screen-bubble reading content aloud, or reading a draft
 * back to the user.
 *
 * Provider: OpenAI's OPENAI_TTS_MODEL — multilingual, cheap, and *steerable*
 * (the `instructions` field lets the user's personality shape how it speaks).
 */
import OpenAI from "openai";
import { getConfig } from "../config.js";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: getConfig().OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  return client;
}

export type TtsFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

const FORMAT_MIME: Record<TtsFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

export interface TtsInput {
  text: string;
  /** Voice name (e.g. "alloy", "nova", "marin"). Defaults to TTS_VOICE. */
  voice?: string;
  /** Output container. Defaults to TTS_FORMAT. */
  format?: TtsFormat;
  /** Optional style steer, e.g. "warm and upbeat" — derived from personality. */
  instructions?: string;
  /** How fast to read, 1 = normal (Keylessbord's Read aloud speed). See paceFor. */
  speed?: number;
}

/**
 * A reading speed in the form the model takes it. tts-1 and tts-1-hd take a rate (`speed`, 0.25 to 4); the gpt-4o
 * speech models ignore that field ("Does not work with gpt-4o-mini-tts"), so for them the pace goes into the
 * instructions, which they follow. Normal speed, or none, adds nothing.
 */
export function paceFor(model: string, speed: number | undefined, instructions?: string): { speed?: number; instructions?: string } {
  const keep = instructions ? { instructions } : {};
  if (speed === undefined || !Number.isFinite(speed) || speed === 1) return keep;
  const rate = Math.min(4, Math.max(0.25, speed));
  if (/^tts-1/.test(model)) return { ...keep, speed: rate };
  const how = rate < 1 ? "a little slower than usual" : rate <= 1.3 ? "a little faster than usual" : "much faster than usual";
  const pace = `Speak ${how}, at about ${rate}× your normal pace.`;
  return { instructions: instructions ? `${instructions} ${pace}` : pace };
}

export interface TtsResult {
  audio: Buffer;
  contentType: string;
}

export async function synthesize(input: TtsInput): Promise<TtsResult> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) {
    throw new Error("TTS requires OPENAI_API_KEY.");
  }
  const format = (input.format ?? cfg.TTS_FORMAT) as TtsFormat;

  const params = {
    model: cfg.OPENAI_TTS_MODEL,
    voice: input.voice ?? cfg.TTS_VOICE,
    input: input.text,
    response_format: format,
    ...paceFor(cfg.OPENAI_TTS_MODEL, input.speed, input.instructions),
  } as unknown as OpenAI.Audio.Speech.SpeechCreateParams;

  const res = await openai().audio.speech.create(params);
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, contentType: FORMAT_MIME[format] };
}
