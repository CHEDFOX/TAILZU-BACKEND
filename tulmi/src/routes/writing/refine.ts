/**
 * POST /v1/refine (and /v1/refine/<tone>): typed text in, the text written the best way out.
 *
 * `privateField`: the screen is off limits (a sensitive app): written from what was said alone. `privateWindow`: said in a private
 * (incognito) window: written like any other, and nothing of it is kept (no History entry, nothing learned from it).
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import type { RefineRequest, RefineResponse, Personality } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import type { AppConfig } from "../../config.js";
import { appendHistoryEntry } from "../../history/store.js";
import { learnFromUsage } from "../../personality/learn.js";
import { getPersonality } from "../../personality/store.js";
import { editSelection, assist, LLM_TONES } from "../../pipeline/cleanup.js";
import { fieldKindOf, cleanLabel } from "../../pipeline/field.js";
import { joinWithSpace } from "../../pipeline/join.js";
import { capSurroundings } from "../../pipeline/sensitive.js";
import { recentDictations } from "../../pipeline/session.js";
import { effectiveLanguage } from "../../profile/language.js";
import { enforceQuota, recordUsage } from "../../usage/metering.js";
import { unauthorized, reqTz, countWords, desktopDictated } from "../../http/helpers.js";

export interface RefineRouteDeps {
  tooLong: (text: string | undefined) => string | null;
  personalityProblem: (p: Personality | undefined) => { status: 400 | 413; message: string } | null;
  cfg: AppConfig;
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
}

export function registerRefineRoutes(app: FastifyInstance, deps: RefineRouteDeps): void {
  const { tooLong, personalityProblem, cfg, rateLimit: AUTHED_RL } = deps;
  // --- Typing (REST): refine typed text ---------------------------------------
  //
  //   POST /v1/refine          body.tone (else the active tone), and optionally a
  //                            whole `personality` to use in place of the saved one
  //   POST /v1/refine/<tone>   the route IS the tone; the saved personality
  //
  // One per tone so the client can pick the endpoint from the user's active
  // tone; /v1/refine stays for legacy callers. All of them share one brain,
  // assist(): it separates any embedded instruction ("…make it shorter, in
  // bullet points") from the message, writes in the tone, and uses body.context
  // (whatever is already in the field) as the draft or conversation to continue
  // or reply to. An inline tonePrompt still wins on the per-tone routes, so a
  // custom tone can reuse them and the route's tone is just the label/default.
  // "none" does not restyle: it keeps the user's own voice and repairs only what
  // speaking or thumb-typing cost them.
  const refineRoute = (routeTone?: string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = await resolveUser(req.headers["authorization"]);
      if (!user) return unauthorized(reply);

      const body = (req.body ?? {}) as RefineRequest;
      if (!body.text || !body.text.trim()) {
        return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
      }
      // Cap EVERY prompt-bound field, not just body.text — context, tonePrompt
      // and `alternative` (a second recognizer's reading, forwarded by the live
      // path) reach the prompt too, and uncapped they let one request smuggle up
      // to the 1 MB bodyLimit of unmetered input tokens past MAX_TEXT_LENGTH.
      const over =
        tooLong(body.text) ?? tooLong(body.context) ?? tooLong(body.tonePrompt) ?? tooLong(body.alternative) ?? tooLong(body.selection);
      if (over) return reply.code(413).send({ code: "bad_request", message: over });
      const override = routeTone ? undefined : body.personality;
      const badPersonality = personalityProblem(override);
      if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

      const quota = await enforceQuota(user);
      if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

      const t0 = Date.now();
      try {
        const recentRead = recentDictations(user);
        const personality = override ?? await getPersonality(user);
        const tone = routeTone ?? body.tone ?? personality.activeTone;
        const lang = await effectiveLanguage(user, body.language, personality);
        const writerOpts = {
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
          tzOffsetMinutes: reqTz(body.tzOffsetMinutes, personality.stylePortrait?.tzOffsetMinutes),
        };
        // TEXT WAS SELECTED (the live path's dictation, said with a selection):
        // what they said is about it, so the selection is rewritten, the same
        // as /v1/transcribe-clean does with one. Never from an off-limits screen.
        const selection = body.privateField !== true && typeof body.selection === "string" && body.selection.trim() ? body.selection : "";
        const refinedText = selection
          ? await editSelection(selection, body.text, writerOpts, { spoken: true })
          : await assist(body.text, {
            ...writerOpts,
            // A second engine's reading of the same speech, when the live path saw
            // the two disagree — reconciled before the writing task.
            alternative: body.alternative,
            // What they dictated in the last few minutes, read by the server
            // (never sent by a client), with where and when.
            recent: await recentRead,
          });
        const usage = { audioSeconds: 0, words: countWords(refinedText), model: cfg.CLEANUP_MODEL };
        await recordUsage({ user, source: "rest", ...usage });
        // A private window's writing is not remembered: no History card, nothing learned from it.
        const keep = body.privateWindow !== true;
        if (keep) await appendHistoryEntry(user, personality, {
          kind: "typing",
          targetApp: body.targetApp || (routeTone ? "Generic" : undefined),
          language: body.language,
          input: body.text,
          output: refinedText,
          durationMs: Date.now() - t0,
          wordsIn: countWords(body.text),
          wordsOut: usage.words,
          tone,
          presetId: personality.activePresetId,
          // A late tail of a dictation already written arrives with that text
          // as its context; it joins the same History card (see coalesce). A
          // rewrite carries on from the selection it rewrote.
          context: selection || body.context,
        });
        if (keep) learnFromUsage(user, personality);
        desktopDictated(req, user, personality);
        // The same join hint /v1/transcribe-clean gives: the live path pastes
        // this after what the field already holds (`context`). A rewrite takes
        // the selection's place, so nothing joins it.
        const res: RefineResponse = selection
          ? { refinedText, usage, joinWithSpace: false, replacedSelection: true }
          : { refinedText, usage, joinWithSpace: joinWithSpace(body.context, refinedText) };
        return reply.send(res);
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({ code: "cleanup_failed", message: "Refine failed" });
      }
    };

  app.post("/v1/refine", { config: AUTHED_RL }, refineRoute());
  app.post("/v1/refine/none", { config: AUTHED_RL }, refineRoute("none"));
  for (const toneId of LLM_TONES) {
    app.post(`/v1/refine/${toneId}`, { config: AUTHED_RL }, refineRoute(toneId));
  }
}
