/**
 * POST /v1/speak: text in, spoken audio out.
 */

import type { FastifyInstance } from "fastify";
import type { SpeakRequest } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
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

    // How fast to read: the speed they chose on Keylessbord's Read aloud page (normal when none).
    const [quota, prefs] = await Promise.all([enforceQuota(user), getPrefs(user).catch(() => ({} as KeybotPrefs))]);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    const speed = readSpeed(prefs);

    // Which voice to speak in. A voice the client sent is honoured only if it is
    // one of the curated set; anything else (a typo, an unknown OpenAI voice, or
    // nothing at all) falls back to the user's stored voice, then the default.
    // An unknown id is NEVER forwarded to OpenAI — that would 400 mid-sentence.
    // The personality is only read when it is actually needed (no valid body
    // voice), so an ordinary speak with a good voice stays a single call.
    let voice: string;
    if (isValidTtsVoice(body.voice)) {
      voice = body.voice;
    } else {
      const personality = await getPersonality(user);
      voice = isValidTtsVoice(personality.ttsVoice) ? personality.ttsVoice : DEFAULT_TTS_VOICE;
    }

    try {
      const { audio, contentType } = await synthesize({
        text: body.text,
        voice,
        format: body.format,
        instructions: body.instructions,
        ...(speed !== 1 ? { speed } : {}),
      });
      // What reading it aloud cost, on the request's tally for the usage meter (usage/cost.ts): the row below writes it.
      addCostUsd(ttsUsd(body.text.length + (body.instructions?.length ?? 0)));
      await recordUsage({
        user,
        source: "rest",
        audioSeconds: 0,
        words: countWords(body.text),
        model: cfg.OPENAI_TTS_MODEL,
      });
      return reply.header("content-type", contentType).send(audio);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "TTS failed" });
    }
  });
}
