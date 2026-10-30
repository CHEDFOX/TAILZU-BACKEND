/**
 * A VOICE'S SAMPLE: what Keylessbord's Read aloud page plays when a voice's play button is pressed.
 *
 *   GET /v1/keybot/voices/:id/sample?speed=1.25   -> the voice saying one short line (audio/mpeg)
 *
 * The line is the same for everyone (the voice says its own name), so it is made once per voice and speed and kept in
 * memory: a sample costs one speech call per server for its life, not one per tap, and it is never counted against the
 * person's words. Only the offered voices (experience/ttsVoices.ts) and the page's four speeds; anything else is 400.
 * Signed in only, and rate limited like the rest of the app's routes.
 */
import type { FastifyInstance } from "fastify";
import { resolveUser } from "../auth/supabase.js";
import { isValidTtsVoice, ttsVoiceById } from "../experience/ttsVoices.js";
import { synthesize, type TtsInput, type TtsResult } from "../pipeline/tts.js";

/** The speeds Read aloud offers (keybot.ts SPEEDS); a sample is made at the one the person picked. */
export const SAMPLE_SPEEDS: readonly string[] = ["0.8", "1", "1.25", "1.5"];

/** What a voice says when it is tried: its name, and what it is for. Short, so it plays in about five seconds. */
export const sampleLine = (name: string): string => `Namaste, I'm ${name}. This is how I'll read your messages and drafts to you.`;

export interface VoiceSampleDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  /** The speech call (tests give their own). */
  speak?: (input: TtsInput) => Promise<TtsResult>;
}

export function registerVoiceSampleRoute(app: FastifyInstance, deps: VoiceSampleDeps): void {
  const speak = deps.speak ?? synthesize;
  /** voice:speed → the sample, or the call making it (two taps at once make one). A failed call is not kept. */
  const made = new Map<string, Promise<TtsResult>>();

  app.get<{ Params: { id: string }; Querystring: { speed?: string } }>("/v1/keybot/voices/:id/sample", { config: deps.rateLimit }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Sign in first" });
    const id = req.params.id;
    if (!isValidTtsVoice(id)) return reply.code(400).send({ code: "bad_request", message: "No voice by that name" });
    const speedText = SAMPLE_SPEEDS.includes(String(req.query.speed ?? "1")) ? String(req.query.speed ?? "1") : "1";
    const speed = Number(speedText);
    const key = `${id}:${speedText}`;
    let job = made.get(key);
    if (!job) {
      job = speak({ text: sampleLine(ttsVoiceById(id)?.label ?? id), voice: id, format: "mp3", ...(speed !== 1 ? { speed } : {}) });
      made.set(key, job);
      job.catch(() => { if (made.get(key) === job) made.delete(key); });
    }
    try {
      const { audio, contentType } = await job;
      return reply.header("content-type", contentType).header("cache-control", "private, max-age=86400").send(audio);
    } catch (err) {
      req.log.warn({ err: (err as Error)?.message, voice: id }, "voice sample: not made");
      return reply.code(503).send({ code: "tts_failed", message: "Couldn't play that voice right now. Try again." });
    }
  });
}
