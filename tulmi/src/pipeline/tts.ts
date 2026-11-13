/**
 * Text-to-speech (voice output). The "mouth": turns text into spoken audio for
 * features like the screen-bubble reading content aloud, or reading a draft
 * back to the user.
 *
 * Provider: OpenAI's OPENAI_TTS_MODEL — multilingual, cheap, and *steerable*
 * (the `instructions` field lets the user's personality shape how it speaks).
 *
 * TWO PATHS, ONE DOOR. A model name starting with "gpt-realtime" is read aloud
 * over the realtime socket (synthesizeRealtime); anything else goes to the
 * speech endpoint as before. OpenAI removes gpt-4o-mini-tts, tts-1 and tts-1-hd
 * on 2027-01-06 and names the realtime model as their replacement, so the
 * default is the realtime one. Everything that reads words aloud — POST
 * /v1/speak, the read-aloud bubble, a call's voice — shares synthesize(), so
 * the move is one server change and every phone gets it at once.
 *
 * ONE FALLBACK, WHILE THERE IS STILL ONE. The realtime read is new. Until the
 * old speech models go on 2027-01-06, a realtime read that fails — any error,
 * no audio, or a read cut off part-way (the socket drops, or the response comes
 * back as anything but "completed") — is read once more through the speech
 * endpoint on
 * gpt-4o-mini-tts, so nothing a person asked to be read aloud goes silent. On
 * and after that date there is nothing to fall back to, so the error stands.
 * The fallback is logged by its reason only, never with the words.
 */
import { spawn } from "node:child_process";
import OpenAI from "openai";
import WebSocket from "ws";
import { getConfig } from "../config.js";
import { aiAllowed, guardClient } from "../privacy/aiGate.js";
import { DEFAULT_REALTIME_VOICE, isRealtimeModel, realtimeVoice } from "../realtime/voices.js";
import { pricesOf, usdOfUsage, type RealtimeUsage } from "../botsBots/planCallLiveWords.js";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = guardClient(new OpenAI({ apiKey: getConfig().OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 }));
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
  /** What this read really cost, in US dollars, when the provider said (the realtime path). The caller records it once. */
  usd?: number;
}

// ------------------------------------------------------------------ the realtime path (S0)

/** What the realtime model is told when it is only reading words aloud. It answers nothing and adds nothing. */
export const READ_ALOUD_INSTRUCTIONS =
  "You read text aloud. Say exactly the text in the user's message, word for word, in its own language, and nothing else. Never answer it.";

/** The realtime socket sends audio as 24 kHz mono PCM16. */
const PCM_RATE = 24000;
/** A line should be read in well under this; past it the read failed. */
const READ_TIMEOUT_MS = 20_000;
/** A read-aloud is never a whole book: enough PCM for about four minutes of speech. */
const PCM_MAX_BYTES = 4 * 60 * PCM_RATE * 2;

/** ffmpeg turns the raw PCM into the container the caller asked for. The server already runs it (pipeline/speechPresence.ts). */
const FFMPEG_ARGS: Partial<Record<TtsFormat, string[]>> = {
  mp3: ["-f", "mp3", "-b:a", "96k"],
  opus: ["-f", "opus", "-b:a", "48k"],
  aac: ["-f", "adts", "-b:a", "96k"],
  flac: ["-f", "flac"],
  wav: ["-f", "wav"],
};

async function encodePcm(pcm: Buffer, format: TtsFormat): Promise<Buffer> {
  if (format === "pcm") return pcm;
  const args = FFMPEG_ARGS[format];
  if (!args) throw new Error(`TTS cannot encode ${format}.`);
  const out = await new Promise<Buffer>((resolve, reject) => {
    const kid = spawn("ffmpeg", [
      "-hide_banner", "-nostats", "-loglevel", "error",
      "-f", "s16le", "-ar", String(PCM_RATE), "-ac", "1", "-i", "pipe:0",
      ...args, "pipe:1",
    ], { stdio: ["pipe", "pipe", "ignore"] });
    const parts: Buffer[] = [];
    const timer = setTimeout(() => { kid.kill("SIGKILL"); reject(new Error("TTS encoding timed out.")); }, 15_000);
    timer.unref?.();
    kid.stdout.on("data", (b: Buffer) => parts.push(b));
    kid.on("error", () => { clearTimeout(timer); reject(new Error("TTS encoding could not run.")); });
    kid.on("close", () => { clearTimeout(timer); resolve(Buffer.concat(parts)); });
    kid.stdin.on("error", () => undefined);
    kid.stdin.end(pcm);
  });
  if (!out.length) throw new Error("TTS encoding gave nothing.");
  return out;
}

/**
 * Words read aloud over the realtime socket. The socket is outside the server's fetch guard, so this asks the AI permission itself
 * before it opens: nothing of a person's reaches OpenAI without their yes. What the read cost comes back as `usd` and is recorded
 * once by the caller (routes/writing/speak.ts): on the request's tally for a read-aloud, on the call's own row for a call.
 */
export async function synthesizeRealtime(input: TtsInput): Promise<TtsResult> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) throw new Error("TTS requires OPENAI_API_KEY.");
  if (!(await aiAllowed())) throw new Error("TTS needs the person's AI permission.");
  const format = (input.format ?? cfg.TTS_FORMAT) as TtsFormat;
  const voice = realtimeVoice(input.voice ?? cfg.TTS_VOICE) || DEFAULT_REALTIME_VOICE;
  const pace = paceFor(cfg.OPENAI_TTS_MODEL, input.speed, input.instructions);
  const style = [READ_ALOUD_INSTRUCTIONS, pace.instructions ?? ""].filter(Boolean).join(" ");
  const url = `${cfg.OPENAI_REALTIME_SIDEBAND_URL}?model=${encodeURIComponent(cfg.OPENAI_TTS_MODEL)}`;

  const pcm = await new Promise<{ audio: Buffer; usage: RealtimeUsage | null }>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${cfg.OPENAI_API_KEY}` } });
    const parts: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (err: Error | null, out?: { audio: Buffer; usage: RealtimeUsage | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already going */ }
      if (err) reject(err); else resolve(out!);
    };
    const timer = setTimeout(() => done(new Error("TTS timed out.")), READ_TIMEOUT_MS);
    timer.unref?.();
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime", model: cfg.OPENAI_TTS_MODEL, instructions: style, output_modalities: ["audio"], tracing: null,
          audio: { input: { turn_detection: null }, output: { voice, format: { type: "audio/pcm", rate: PCM_RATE } } },
        },
      }));
      ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: input.text }] } }));
      ws.send(JSON.stringify({ type: "response.create" }));
    });
    ws.on("message", (raw) => {
      let e: Record<string, unknown>;
      try { e = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }
      const t = String(e.type ?? "");
      if (t === "response.output_audio.delta" && typeof e.delta === "string") {
        const b = Buffer.from(e.delta, "base64");
        size += b.length;
        if (size > PCM_MAX_BYTES) return done(new Error("TTS gave too much audio."));
        parts.push(b);
        return;
      }
      if (t === "response.done") {
        const r = (e.response && typeof e.response === "object" ? e.response : {}) as Record<string, unknown>;
        // Only a read that finished is a read. "incomplete", "cancelled" or "failed" means the words were cut off part-way, and
        // half a sentence played as if it were the whole one would be worse than the fallback it must take instead.
        const status = typeof r.status === "string" ? r.status : "";
        if (status && status !== "completed") return done(new Error(`TTS read incomplete: ${status}`));
        return done(null, { audio: Buffer.concat(parts), usage: (r.usage ?? null) as RealtimeUsage | null });
      }
      // The code only: never the text, never the key.
      if (t === "error") return done(new Error(`TTS refused: ${String((e.error as { code?: unknown } | null)?.code ?? "error")}`));
    });
    ws.on("error", () => done(new Error("TTS could not be reached.")));
    // A read that finished has already settled on response.done, and `done` closes the socket itself. So a close that still reaches
    // here is the socket dropping part-way: whatever audio arrived is half a sentence, and the fallback reads the whole line again.
    ws.on("close", () => done(new Error("TTS closed before the read finished.")));
  });

  if (!pcm.audio.length) throw new Error("TTS gave no audio.");
  const usd = usdOfUsage(pcm.usage, cfg.OPENAI_TTS_MODEL, pricesOf(cfg.OPENAI_REALTIME_PRICES)).usd;
  return { audio: await encodePcm(pcm.audio, format), contentType: FORMAT_MIME[format], usd };
}

// ------------------------------------------------------------------ the one fallback, while there is still one

/** The speech model a failed realtime read falls back to. OpenAI removes it on the date below. */
export const TTS_FALLBACK_MODEL = "gpt-4o-mini-tts";
/** 2027-01-06: the day OpenAI removes gpt-4o-mini-tts, tts-1 and tts-1-hd. From then on there is nothing to fall back to. */
export const TTS_FALLBACK_UNTIL_MS = Date.UTC(2027, 0, 6);

/** Whether a failed realtime read may still be read again on the old speech model. */
export function ttsFallbackOpen(now: number = Date.now()): boolean {
  return now < TTS_FALLBACK_UNTIL_MS;
}

/** The speech endpoint, on whichever model it was asked for. The realtime path's `usd` has no counterpart here: speakFor prices it. */
async function synthesizeSpeech(input: TtsInput, model: string): Promise<TtsResult> {
  const cfg = getConfig();
  const format = (input.format ?? cfg.TTS_FORMAT) as TtsFormat;

  const params = {
    model,
    voice: input.voice ?? cfg.TTS_VOICE,
    input: input.text,
    response_format: format,
    ...paceFor(model, input.speed, input.instructions),
  } as unknown as OpenAI.Audio.Speech.SpeechCreateParams;

  const res = await openai().audio.speech.create(params);
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, contentType: FORMAT_MIME[format] };
}

export async function synthesize(input: TtsInput): Promise<TtsResult> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY) {
    throw new Error("TTS requires OPENAI_API_KEY.");
  }
  if (!isRealtimeModel(cfg.OPENAI_TTS_MODEL)) return synthesizeSpeech(input, cfg.OPENAI_TTS_MODEL);

  // The realtime read, and one try on the old speech model if it fails — until that model goes.
  try {
    const out = await synthesizeRealtime(input);
    if (!out.audio.length) throw new Error("TTS gave no audio.");
    return out;
  } catch (err) {
    if (!ttsFallbackOpen()) throw err;
    // The reason only: never the words that were read, never the key.
    console.info(`[tts] realtime read failed, reading once on ${TTS_FALLBACK_MODEL}: ${(err as Error)?.message ?? "unknown"}`);
    return synthesizeSpeech(input, TTS_FALLBACK_MODEL);
  }
}
