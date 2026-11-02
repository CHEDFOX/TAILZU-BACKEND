/**
 * POST /v1/draft: a reply to what is on screen, in the person's voice.
 */

import type { FastifyInstance } from "fastify";
import type { DraftRequest, DraftResponse, Personality } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import type { AppConfig } from "../../config.js";
import { appendHistoryEntry } from "../../history/store.js";
import { resolvePersonality } from "../../personality/store.js";
import { draftReply } from "../../pipeline/cleanup.js";
import { effectiveLanguage } from "../../profile/language.js";
import { enforceQuota, recordUsage } from "../../usage/metering.js";
import { unauthorized, countWords } from "../../http/helpers.js";

export interface DraftRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  tooLong: (text: string | undefined) => string | null;
  personalityProblem: (p: Personality | undefined) => { status: 400 | 413; message: string } | null;
  cfg: AppConfig;
}

export function registerDraftRoutes(app: FastifyInstance, deps: DraftRouteDeps): void {
  const { rateLimit: AUTHED_RL, tooLong, personalityProblem, cfg } = deps;
  // --- Screen (REST): draft a personalized reply ------------------------------

  app.post("/v1/draft", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const body = (req.body ?? {}) as DraftRequest;
    if (!body.intent || !body.intent.trim()) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'intent'" });
    }
    const tooBig = tooLong(body.intent) ?? tooLong(body.screenContent) ?? tooLong(body.recipient);
    if (tooBig) return reply.code(413).send({ code: "bad_request", message: tooBig });
    const badPersonality = personalityProblem(body.personality);
    if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    const t0 = Date.now();
    try {
      const personality = await resolvePersonality(user, body.personality);
      const lang = await effectiveLanguage(user, body.language, personality);
      const draftText = await draftReply(
        body.screenContent ?? "",
        body.intent,
        {
          targetApp: body.targetApp,
          language: lang,
          personality,
          variables: { email: user.email, phone: user.phone },
        },
        body.recipient,
      );
      const usage = {
        audioSeconds: 0,
        words: countWords(draftText),
        model: cfg.CLEANUP_MODEL,
      };
      await recordUsage({ user, source: "rest", ...usage });
      await appendHistoryEntry(user, personality, {
        kind: "draft",
        targetApp: body.targetApp,
        language: body.language,
        input: body.intent,
        output: draftText,
        durationMs: Date.now() - t0,
        wordsIn: countWords(body.intent),
        wordsOut: usage.words,
        tone: personality.activeTone,
        presetId: personality.activePresetId,
      });
      const res: DraftResponse = { draftText, usage };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Draft failed" });
    }
  });
}
