/**
 * POST /v1/edit: a selection rewritten as the person said.
 */

import type { FastifyInstance } from "fastify";
import type { EditRequest, EditResponse, Personality } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import type { AppConfig } from "../../config.js";
import { appendHistoryEntry } from "../../history/store.js";
import { learnFromUsage } from "../../personality/learn.js";
import { getPersonality } from "../../personality/store.js";
import { editSelection } from "../../pipeline/cleanup.js";
import { fieldKindOf, cleanLabel } from "../../pipeline/field.js";
import { capSurroundings } from "../../pipeline/sensitive.js";
import { effectiveLanguage } from "../../profile/language.js";
import { enforceQuota, recordUsage } from "../../usage/metering.js";
import { unauthorized, countWords } from "../../http/helpers.js";

export interface EditRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  tooLong: (text: string | undefined) => string | null;
  personalityProblem: (p: Personality | undefined) => { status: 400 | 413; message: string } | null;
  cfg: AppConfig;
}

export function registerEditRoutes(app: FastifyInstance, deps: EditRouteDeps): void {
  const { rateLimit: AUTHED_RL, tooLong, personalityProblem, cfg } = deps;
  // --- Selection (REST): voice-edit the selected text -------------------------
  //
  // The desktop's "edit the selection out loud": the user highlights some text
  // and says what to do with it. editSelection() rewrites the TEXT to follow the
  // INSTRUCTION and returns only the rewritten text, to replace the selection in
  // place. It produces user-facing written text, so — like /v1/refine — it meters
  // the output words, writes a typing-history row (the instruction as input, the
  // original selection as context) and learns from the use.
  app.post("/v1/edit", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const body = (req.body ?? {}) as EditRequest;
    // BOTH are required: nothing to rewrite, or nothing to do, is a bad request.
    if (!body.text || !body.text.trim() || !body.instruction || !body.instruction.trim()) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'text' and 'instruction'" });
    }
    // Cap every prompt-bound field, same as /v1/refine: text + instruction +
    // context + surroundings + tonePrompt all reach the prompt, and uncapped
    // they would smuggle up to the 1 MB bodyLimit of unmetered input tokens.
    const over = tooLong(body.text) ?? tooLong(body.instruction) ?? tooLong(body.context)
      ?? tooLong(body.surroundings) ?? tooLong(body.tonePrompt);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    const override = body.personality;
    const badPersonality = personalityProblem(override);
    if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    const t0 = Date.now();
    try {
      const personality = override ?? await getPersonality(user);
      const tone = body.tone ?? personality.activeTone;
      const lang = await effectiveLanguage(user, body.language, personality);
      const editedText = await editSelection(body.text, body.instruction, {
        tone,
        tonePrompt: body.tonePrompt,
        context: body.context,
        targetApp: body.targetApp,
        fieldKind: fieldKindOf(body.fieldKind),
        fieldLabel: cleanLabel(body.fieldLabel, 60),
        surroundings: capSurroundings(body.surroundings),
        privateField: body.privateField === true,
        language: lang,
        personality,
        variables: { email: user.email, phone: user.phone },
      });
      // The rewritten text is user-facing written words, like a refine — so it
      // is metered by its word count and recorded.
      const usage = { audioSeconds: 0, words: countWords(editedText), model: cfg.CLEANUP_MODEL };
      await recordUsage({ user, source: "rest", ...usage });
      await appendHistoryEntry(user, personality, {
        kind: "typing",
        targetApp: body.targetApp,
        language: body.language,
        // The instruction is what they said; the rewritten text is what they get;
        // the original selection is the context it carried on from.
        input: body.instruction,
        output: editedText,
        durationMs: Date.now() - t0,
        wordsIn: countWords(body.instruction),
        wordsOut: usage.words,
        tone,
        presetId: personality.activePresetId,
        context: body.text,
      });
      learnFromUsage(user, personality);
      const res: EditResponse = { editedText, usage };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Edit failed" });
    }
  });
}
