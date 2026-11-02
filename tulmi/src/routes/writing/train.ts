/**
 * Training the person's voice: variants to pick from, a picked one, a conversation, and the portrait it leaves.
 */

import type { FastifyInstance } from "fastify";
import { resolveUser } from "../../auth/supabase.js";
import { getConfig, type AppConfig } from "../../config.js";
import { applyPresetOverrides } from "../../experience/personalityPresets.js";
import { getPersonality, updatePersonality } from "../../personality/store.js";
import { refineVariants, updateStylePortrait, type ConverseTurn, converseTurn, spokenLanguage, portraitFromTranscript } from "../../pipeline/cleanup.js";
import { mergePortraitWords } from "../../pipeline/portraitDimensions.js";
import { enforceQuota, recordUsage } from "../../usage/metering.js";
import { unauthorized, countWords } from "../../http/helpers.js";

export interface TrainRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  tooLong: (text: string | undefined) => string | null;
  cfg: AppConfig;
}

export function registerTrainRoutes(app: FastifyInstance, deps: TrainRouteDeps): void {
  const { rateLimit: AUTHED_RL, tooLong, cfg } = deps;
  // --- Training (REST): variant generation + style-portrait learning ----------
  //
  // The Train tab's loop: /variants turns one input into three differently-
  // styled refinements; the user taps the one that sounds most like them and
  // /pick absorbs that choice into the evolving style portrait
  // (personality.stylePortrait), which every refine path then injects into its
  // prompt. Tone-scoped picks also train that tone's note.

  app.post("/v1/train/variants", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as { text?: string; tone?: string; language?: string };
    const textIn = (body.text ?? "").trim();
    if (!textIn) return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
    const over = tooLong(textIn);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    try {
      const personality = await getPersonality(user);
      const tone = body.tone && body.tone !== "none" ? String(body.tone).slice(0, 120) : undefined;
      // The Train sheet sends a VOICE id (built-in or custom preset). When it
      // matches one, the variants speak in that voice's promptStyle — and the
      // voice id doubles as the portrait key, so its learned note flows into
      // generation too. A plain LLM tone id still works for legacy callers.
      const voice = tone
        ? applyPresetOverrides(personality.presetOverrides).find((p) => p.id === tone)
        : undefined;
      const variants = await refineVariants(textIn, {
        tone,
        tonePrompt: voice?.promptStyle,
        personality,
        language: body.language,
        targetApp: "Generic",
      });
      if (!variants.length) {
        return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't generate variants" });
      }
      await recordUsage({
        user,
        source: "rest",
        audioSeconds: 0,
        words: variants.reduce((s, v) => s + countWords(v.text), 0),
        model: getConfig().CLEANUP_MODEL,
      });
      return reply.send({ variants });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't generate variants" });
    }
  });

  app.post("/v1/train/pick", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as {
      input?: string;
      chosen?: string;
      rejectedA?: string;
      rejectedB?: string;
      tone?: string;
    };
    const input = (body.input ?? "").trim();
    const chosen = (body.chosen ?? "").trim();
    if (!input || !chosen) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'input' or 'chosen'" });
    }
    const over = tooLong(input) ?? tooLong(chosen) ?? tooLong(body.rejectedA) ?? tooLong(body.rejectedB);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    // A model call like its siblings, so behind the same gate: without it an
    // account past its allowance could keep the model busy through this route.
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    try {
      const personalityNow = await getPersonality(user);
      const current = personalityNow.stylePortrait;
      // `tone` may be a VOICE id (the Train sheet lists the voice library) or a
      // plain LLM tone id. The portrait note is KEYED by the raw id; the LLM
      // prompt sees the human name so "custom_<uuid>" never leaks into it.
      const toneKey = body.tone && body.tone !== "none" ? String(body.tone).slice(0, 120) : undefined;
      const toneLabel = toneKey
        ? applyPresetOverrides(personalityNow.presetOverrides).find((p) => p.id === toneKey)?.name ?? toneKey
        : undefined;
      const rejected = [body.rejectedA, body.rejectedB]
        .map((r) => (r ?? "").trim())
        .filter((r) => r && r !== chosen);
      const next = await updateStylePortrait(current, {
        input,
        chosen,
        rejected,
        tone: toneLabel,
        currentToneNote: toneKey ? current?.tones?.[toneKey] : undefined,
      });
      // Merge under the per-user lock; the tones map merges per-key so training
      // one tone never wipes the notes learned for the others.
      const merged = await updatePersonality(user, (existing) => ({
        ...existing,
        stylePortrait: {
          ...existing.stylePortrait,
          core: next.core,
          words: mergePortraitWords(existing.stylePortrait?.words, next.words),
          ...(next.styles?.length ? { styles: next.styles } : {}),
          tones: {
            ...(existing.stylePortrait?.tones ?? {}),
            ...(toneKey && next.toneNote ? { [toneKey]: next.toneNote } : {}),
          },
          examples: (existing.stylePortrait?.examples ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        },
      }));
      const examples = merged.stylePortrait?.examples ?? 1;
      // The thread's next two rows come back with the pick: what was taken from
      // it, and the next thing to answer. Sent from here rather than held on the
      // client so the prompts are one server-side list — the app never runs out
      // of them, and changing them is a deploy rather than a release.
      return reply.send({
        ok: true,
        examples,
        learned: `Learned${toneLabel ? ` · ${toneLabel}` : ""}`,
        next: TRAIN_PROMPTS[examples % TRAIN_PROMPTS.length],
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Couldn't save your pick" });
    }
  });

  /**
   * What the Train thread asks next, after a pick.
   *
   * Everyday moments with a real decision in them about how to say something —
   * that is where a person's own register actually shows. Deliberately not
   * generated: an LLM asked for "a texting scenario" writes prompts that all
   * sound the same, and this list costs nothing and never fails.
   */
  const TRAIN_PROMPTS = [
    "A friend asks how your week's going. One line.",
    "You're running late. What do you send?",
    "Someone you barely know asks for a favour you'd rather not do.",
    "A friend got good news. First thing you'd write back.",
    "You need to say no to a work thing without making it a whole conversation.",
    "Someone apologises for something small. What do you say?",
    "You're double-booked and have to move a plan. How do you put it?",
    "A friend is having a bad day and hasn't asked for anything.",
    "You forgot to reply for three days. What do you open with?",
    "Someone asks what you did at the weekend.",
  ];

  // --- Training by conversation ----------------------------------------------
  //
  // The spoken half of the Train tab. /converse answers one turn out loud;
  // /portrait reads the whole exchange once, at the end, and rewrites the style
  // portrait from it. Split that way on purpose: the reply has a person waiting
  // on it and must be fast, the portrait does not and can take the better model.
  //
  // The transcript is never stored. It arrives in the request body, is used, and
  // is gone — what survives a conversation is the portrait it produced.

  const TRANSCRIPT_MAX_CHARS = 4 * cfg.MAX_TEXT_LENGTH;

  /** Read and bound a transcript from a request body. Shared by both routes. */
  function readTurns(raw: unknown): { turns: ConverseTurn[] } | { error: string } {
    if (!Array.isArray(raw)) return { error: "Missing 'turns'" };
    // A cap on count, on each turn, and on the whole: this body is
    // user-controlled, every character of it reaches an LLM prompt, and none of
    // it is metered. 200 turns of 2,000 used to be 400,000 characters a call.
    if (raw.length > 200) return { error: "Too many turns" };
    const turns: ConverseTurn[] = [];
    for (const t of raw) {
      if (!t || typeof t !== "object") continue;
      const { role, text } = t as { role?: unknown; text?: unknown };
      if (role !== "user" && role !== "assistant") continue;
      if (typeof text !== "string") continue;
      const trimmed = text.trim();
      if (trimmed) turns.push({ role, text: trimmed.slice(0, 2000) });
    }
    // Past the whole-transcript ceiling the OLDEST turns go: the reply answers
    // the latest ones, and a portrait has plenty to read in what is left.
    let total = turns.reduce((n, t) => n + t.text.length, 0);
    while (total > TRANSCRIPT_MAX_CHARS && turns.length > 1) total -= turns.shift()!.text.length;
    return turns.length ? { turns } : { error: "Missing 'turns'" };
  }

  /** Said when the conversation model has nothing usable to say twice running. */
  const CONVERSE_KEEP_GOING = "Go on, I'm listening.";

  app.post("/v1/train/converse", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const body = (req.body ?? {}) as { turns?: unknown; language?: string };
    const read = readTurns(body.turns);
    if ("error" in read) return reply.code(400).send({ code: "bad_request", message: read.error });
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    try {
      const personality = await getPersonality(user);
      // A reply the meta filter drops ("could you say that again?") used to be
      // a 500, and a 500 ends the spoken session: the person talks into a
      // screen that has stopped. One more try, then a line that keeps them
      // talking — a conversation that pauses is better than one that dies.
      const text = (await converseTurn(read.turns, { personality, language: body.language }))
        || (await converseTurn(read.turns, { personality, language: body.language }))
        || CONVERSE_KEEP_GOING;
      // The MODEL's words are not the person's: nothing they dictated is in
      // this reply, so none of it comes off their allowance. Recorded at zero
      // words so the call still shows in usage.
      await recordUsage({
        user,
        source: "rest",
        audioSeconds: 0,
        words: 0,
        model: getConfig().CLEANUP_MODEL,
      });
      // The voice to say it in, read from the reply itself: a Bengali answer
      // spoken by the English voice the screen opened with is not an answer.
      // Older clients ignore the field and keep the screen's voice.
      const speak = spokenLanguage(text)?.locale;
      return reply.send(speak ? { reply: text, speak } : { reply: text });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't answer that" });
    }
  });

  app.post("/v1/train/portrait", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);
    const read = readTurns((req.body as { turns?: unknown } | undefined)?.turns);
    if ("error" in read) return reply.code(400).send({ code: "bad_request", message: read.error });
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    try {
      const personalityNow = await getPersonality(user);
      const next = await portraitFromTranscript(personalityNow.stylePortrait, read.turns);
      // Core only. A conversation is not held in any one voice, so it has
      // nothing to say about a specific tone's note — and merging under the lock
      // keeps the notes the picking loop learned exactly as they were.
      // Over the portrait that is there, not in place of it: this used to write
      // a new object with four fields, and every word, style, rhythm, session
      // count and timezone the rest of the app had learned was gone after one
      // spoken session.
      const merged = await updatePersonality(user, (existing) => ({
        ...existing,
        stylePortrait: {
          ...(existing.stylePortrait ?? {}),
          core: next.core,
          tones: existing.stylePortrait?.tones ?? {},
          examples: (existing.stylePortrait?.examples ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        },
      }));
      return reply.send({ ok: true, examples: merged.stylePortrait?.examples ?? 1 });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Couldn't save what it heard" });
    }
  });
}
