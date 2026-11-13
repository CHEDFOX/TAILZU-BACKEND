/**
 * POST /v1/speak: text in, spoken audio out.
 *
 * speakFor() is the body of it, for anything else on the server that reads words aloud in the person's voice and at their speed, under
 * their quota — except a call's voice for a person the live call is switched on for (routes/bots/planCalls.ts), which passes
 * `call: true` and is never held to money at all. With that switch off, a call's voice is read under their quota like any other.
 */

import type { FastifyInstance } from "fastify";
import type { SpeakRequest } from "../../../../shared/types/api.js";
import { resolveUser, type AuthedUser } from "../../auth/supabase.js";
import type { AppConfig } from "../../config.js";
import { isValidTtsVoice, DEFAULT_TTS_VOICE } from "../../experience/ttsVoices.js";
import { getPrefs, type KeybotPrefs, readSpeed } from "../../keybot/prefs.js";
import { getPersonality } from "../../personality/store.js";
import { synthesize } from "../../pipeline/tts.js";
import { addCostUsd, ttsUsd } from "../../usage/cost.js";
import { enforceQuota, recordUsage } from "../../usage/metering.js";
import { unauthorized, countWords } from "../../http/helpers.js";

export interface SpeakRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  tooLong: (text: string | undefined) => string | null;
  cfg: AppConfig;
}

export function registerSpeakRoutes(app: FastifyInstance, deps: SpeakRouteDeps): void {
  const { rateLimit: AUTHED_RL, tooLong, cfg } = deps;
  // --- Text-to-speech (REST): text → spoken audio -----------------------------

  app.post("/v1/speak", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const body = (req.body ?? {}) as SpeakRequest;
    if (!body.text || !body.text.trim()) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
    }
    const over = tooLong(body.text) ?? tooLong(body.instructions);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });

    const out = await speakFor(user, body.text, cfg, {
      voice: body.voice, format: body.format, instructions: body.instructions, onError: (err) => req.log.error(err),
    });
    if ("status" in out) return reply.code(out.status).send({ code: out.code, message: out.message });
    return reply.header("content-type", out.contentType).send(out.audio);
  });
}

/** What reading aloud gave: the audio and what it cost, or why not (429 over the quota, 500 the voice service failed). */
export type SpokenAudio = { audio: Buffer; contentType: string; usd: number } | { status: 429 | 500; code: string; message: string };

/**
 * Words read aloud for this person: their quota first, at the speed they chose on Keylessbord's Read aloud page, in `o.voice` when it
 * is one of the curated voices, else theirs (else the default). What it cost goes on the request's tally and the usage row.
 *
 * `o.call` is a call's voice where the live call is switched on for the person (routes/bots/planCalls.ts): such a call is never
 * refused, shortened or charged for money, so that path asks no quota, writes no usage row and adds nothing to the request's tally.
 * What it cost still comes back as `usd`, and the caller records it on the call's own row for the owner to read. False, the read is
 * an ordinary one: the quota is asked and the usage row is written.
 */
export async function speakFor(
  user: AuthedUser, text: string, cfg: Pick<AppConfig, "OPENAI_TTS_MODEL">,
  o: { voice?: string; format?: SpeakRequest["format"]; instructions?: string; call?: boolean; onError?: (err: unknown) => void } = {},
): Promise<SpokenAudio> {
  // How fast to read: the speed they chose on Keylessbord's Read aloud page (normal when none).
  const [quota, prefs] = await Promise.all([
    o.call ? null : enforceQuota(user),
    getPrefs(user).catch(() => ({} as KeybotPrefs)),
  ]);
  if (quota) return { status: 429, code: "quota_exceeded", message: quota };
  const speed = readSpeed(prefs);

  // Which voice to speak in. A voice the client sent is honoured only if it is
  // one of the curated set; anything else (a typo, an unknown OpenAI voice, or
  // nothing at all) falls back to the user's stored voice, then the default.
  // An unknown id is NEVER forwarded to OpenAI — that would 400 mid-sentence.
  // The personality is only read when it is actually needed (no valid body
  // voice), so an ordinary speak with a good voice stays a single call.
  let voice: string;
  if (isValidTtsVoice(o.voice)) {
    voice = o.voice;
  } else {
    const personality = await getPersonality(user);
    voice = isValidTtsVoice(personality.ttsVoice) ? personality.ttsVoice : DEFAULT_TTS_VOICE;
  }

  try {
    const out = await synthesize({
      text,
      voice,
      format: o.format,
      instructions: o.instructions,
      ...(speed !== 1 ? { speed } : {}),
    });
    // What the read really cost when the voice service said (the realtime path), else what its characters cost.
    const usd = out.usd ?? ttsUsd(text.length + (o.instructions?.length ?? 0));
    if (!o.call) {
      // On the request's tally for the usage meter (usage/cost.ts): the row below writes it. A call does neither.
      addCostUsd(usd);
      await recordUsage({
        user,
        source: "rest",
        audioSeconds: 0,
        words: countWords(text),
        model: cfg.OPENAI_TTS_MODEL,
      });
    }
    return { audio: out.audio, contentType: out.contentType, usd };
  } catch (err) {
    o.onError?.(err);
    return { status: 500, code: "internal", message: "TTS failed" };
  }
}
