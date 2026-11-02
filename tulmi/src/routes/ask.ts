/**
 * POST /v1/ask: a question about what is on screen, answered.
 */

import type { FastifyInstance } from "fastify";
import type { AskRequest, AskResponse, Personality } from "../../../shared/types/api.js";
import { resolveUser } from "../auth/supabase.js";
import type { AppConfig } from "../config.js";
import { isValidTtsVoice, DEFAULT_TTS_VOICE } from "../experience/ttsVoices.js";
import { getPersonality } from "../personality/store.js";
import { answerAbout, spokenLanguage } from "../pipeline/cleanup.js";
import { effectiveLanguage } from "../profile/language.js";
import { enforceQuota, recordUsage } from "../usage/metering.js";
import { FRONT_BODY_LIMIT, type FrontRoutes } from "./front.js";
import { unauthorized } from "./http.js";

export interface AskRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  cfg: AppConfig;
  frontRoutes: FrontRoutes;
  tooLong: (text: string | undefined) => string | null;
  personalityProblem: (p: Personality | undefined) => { status: 400 | 413; message: string } | null;
}

export function registerAskRoutes(app: FastifyInstance, deps: AskRouteDeps): void {
  const { rateLimit: AUTHED_RL, cfg, frontRoutes, tooLong, personalityProblem } = deps;
  // --- Screen (REST): answer a question about what is on screen ---------------
  //
  // The desktop's "ask about the screen": the app captured the visible text on
  // device (`screenContent`, reference only) and the user asks a question about
  // it. answerAbout() answers concisely in the question's language. The answer is
  // the MODEL's words, not the user's dictation — so, exactly like
  // /v1/train/converse, it is metered at zero words and written to NO dictation
  // history. `speak` is the read-aloud locale, derived from the answer the same
  // way converse derives it.
  app.post("/v1/ask", { config: AUTHED_RL, ...(cfg.FRONT_DOOR || cfg.BOTS ? { bodyLimit: FRONT_BODY_LIMIT } : {}) }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    // A `message` and no `question` is the front door's (routes/front.ts). The old ask keeps its 1 MB, whatever the door's limit is.
    if (frontRoutes.owns(req.body)) return frontRoutes.ask(req, reply, user);
    if (Number(req.headers["content-length"] ?? 0) > 1024 * 1024) return reply.code(413).send({ code: "bad_request", message: "Request body is too large" });

    const body = (req.body ?? {}) as AskRequest;
    if (!body.question || !body.question.trim()) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'question'" });
    }
    // Every prompt-bound field capped: the question, the captured screen, and any
    // surroundings a client sends along with it.
    const over = tooLong(body.question) ?? tooLong(body.screenContent) ?? tooLong(body.surroundings);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    const badPersonality = personalityProblem(body.personality);
    if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    try {
      const personality = body.personality ?? await getPersonality(user);
      const lang = await effectiveLanguage(user, body.language, personality);
      const answer = await answerAbout(body.screenContent ?? "", body.question, {
        targetApp: body.targetApp,
        language: lang,
        personality,
      });
      // The MODEL's words are not the person's: nothing they dictated is in this
      // answer, so none of it comes off their allowance. Recorded at zero words
      // (and zero seconds) so the call still shows in usage — exactly like
      // /v1/train/converse — and NO dictation-history row is appended.
      await recordUsage({ user, source: "rest", audioSeconds: 0, words: 0, model: cfg.CLEANUP_MODEL });
      // The voice to read it in, derived from the answer itself: a Hindi answer
      // read aloud by an English voice is not the answer. Older clients ignore
      // the field and keep the screen's voice.
      const speak = spokenLanguage(answer)?.locale;
      // AND THE VOICE TO READ IT IN. The locale decides the language; this
      // decides whose voice — the one the user picked (personality.ttsVoice), or
      // the default when they have not. Sent so the desktop's ask feature can
      // hand it straight to /v1/speak. Only ever a voice from the curated set.
      const voice = isValidTtsVoice(personality.ttsVoice) ? personality.ttsVoice : DEFAULT_TTS_VOICE;
      const res: AskResponse = { answer, ...(speak ? { speak } : {}), voice };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't answer that" });
    }
  });
}
