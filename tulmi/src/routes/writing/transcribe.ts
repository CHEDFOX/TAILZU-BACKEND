/**
 * POST /v1/transcribe-clean: a recording in, the cleaned text out.
 */

import type { FastifyInstance } from "fastify";
import type { AudioFormat, TargetAppHint, LanguageHint, Personality, FieldKind } from "../../../../shared/types/api.js";
import { resolveUser } from "../../auth/supabase.js";
import { appendHistoryEntry } from "../../history/store.js";
import { learnFromUsage } from "../../personality/learn.js";
import { getPersonality } from "../../personality/store.js";
import { fieldKindOf, cleanLabel } from "../../pipeline/field.js";
import { runPipeline } from "../../pipeline/index.js";
import { capSurroundings } from "../../pipeline/sensitive.js";
import { recentDictations } from "../../pipeline/session.js";
import { estimateDurationSeconds } from "../../pipeline/stt.js";
import { effectiveLanguage } from "../../profile/language.js";
import { enforceQuota, recordUsage } from "../../usage/metering.js";
import { unauthorized, reqTz, countWords, desktopDictated } from "../../http/helpers.js";

export interface TranscribeRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  tooLong: (text: string | undefined) => string | null;
  personalityProblem: (p: Personality | undefined) => { status: 400 | 413; message: string } | null;
}

export function registerTranscribeRoutes(app: FastifyInstance, deps: TranscribeRouteDeps): void {
  const { rateLimit: AUTHED_RL, tooLong, personalityProblem } = deps;
  // --- Voice (REST): one-shot transcribe + clean ------------------------------

  const ALLOWED_FORMATS: AudioFormat[] = [
    "wav",
    "m4a",
    "webm",
    "mp3",
    "ogg",
    "flac",
  ];

  const MAX_CLIP_SECONDS = 15 * 60;

  function formatFromFilename(name: string | undefined): AudioFormat | null {
    const ext = name?.split(".").pop()?.toLowerCase() as AudioFormat | undefined;
    return ext && ALLOWED_FORMATS.includes(ext) ? ext : null;
  }

  app.post("/v1/transcribe-clean", { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    let audio: Buffer | null = null;
    let format: AudioFormat | null = null;
    let targetApp: TargetAppHint | undefined;
    let language: LanguageHint | undefined;
    let personalityOverride: Personality | undefined;
    let context: string | undefined; // whatever's already in the field, if any
    let fieldKind: FieldKind | undefined; // what kind of field, when the client read it
    let fieldLabel: string | undefined; // its label or placeholder, cleaned
    let surroundings: string | undefined; // what is on the screen around the field
    let privateField = false; // a private window or a sensitive app: screen off limits
    let tzOffsetMinutes: number | undefined; // the device's current UTC offset
    let tone: string | undefined; // active tone override from the client
    let tonePrompt: string | undefined; // the active tone's inline prompt text
    let selection: string | undefined; // the text selected in the field: what they say is about it
    let heldStop = false; // the desktop held back the full stop that ended `context` (a pause stretch)

    // Iterate multipart parts: one file ("audio") + optional text fields.
    for await (const part of req.parts()) {
      if (part.type === "file") {
        format = formatFromFilename(part.filename) ?? "m4a";
        audio = await part.toBuffer();
      } else if (part.fieldname === "targetApp") {
        targetApp = String(part.value);
      } else if (part.fieldname === "language") {
        language = String(part.value) as LanguageHint;
      } else if (part.fieldname === "context") {
        context = String(part.value);
      } else if (part.fieldname === "fieldKind") {
        fieldKind = fieldKindOf(part.value);
      } else if (part.fieldname === "fieldLabel") {
        fieldLabel = cleanLabel(part.value, 60);
      } else if (part.fieldname === "surroundings") {
        surroundings = capSurroundings(part.value);
      } else if (part.fieldname === "privateField") {
        privateField = part.value === "true" || part.value === "1";
      } else if (part.fieldname === "tzOffsetMinutes") {
        const n = Number(part.value); if (Number.isFinite(n)) tzOffsetMinutes = n;
      } else if (part.fieldname === "tone") {
        tone = String(part.value);
      } else if (part.fieldname === "tonePrompt") {
        tonePrompt = String(part.value);
      } else if (part.fieldname === "selection") {
        selection = String(part.value);
      } else if (part.fieldname === "heldStop") {
        heldStop = part.value === "true" || part.value === "1";
      } else if (part.fieldname === "personality") {
        try {
          personalityOverride = JSON.parse(String(part.value)) as Personality;
        } catch {
          /* ignore malformed personality field */
        }
      }
    }

    if (!audio || !format) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'audio' file" });
    }
    // The live route's ceiling (~15 minutes), for the same reason: past it the
    // recognisers refuse the file anyway (OpenAI's cap is 25 MB), and a clear
    // answer beats a failed pipeline after the upload. Read from the container
    // header where there is one (wav, m4a); others are bounded by the 50 MB
    // multipart cap alone.
    if (estimateDurationSeconds(audio, format) > MAX_CLIP_SECONDS) {
      return reply.code(413).send({
        code: "audio_too_long",
        message: "That recording is longer than 15 minutes. Record it in shorter parts.",
      });
    }

    // The multipart text fields feed the LLM prompt exactly like /v1/refine's
    // JSON body does — cap them the same way (multipart's own fieldSize limit is
    // ~1 MiB, far above MAX_TEXT_LENGTH).
    const fieldOver = tooLong(context) ?? tooLong(tonePrompt) ?? tooLong(selection);
    if (fieldOver) return reply.code(413).send({ code: "bad_request", message: fieldOver });
    const badPersonality = personalityProblem(personalityOverride);
    if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    const t0 = Date.now();
    try {
      // The session is read while everything else is: it waits on nothing.
      const recentRead = recentDictations(user);
      const personality = personalityOverride ?? await getPersonality(user);
      const lang = await effectiveLanguage(user, language, personality);
      const result = await runPipeline({
        audio,
        format,
        targetApp,
        fieldKind,
        fieldLabel,
        surroundings,
        privateField,
        language: lang,
        personality,
        tone: tone ?? personality.activeTone,
        tonePrompt,
        context,
        // Nothing off a private window or a sensitive app is read, and the
        // client sends no selection from one; a stray one is not used either.
        selection: privateField ? undefined : selection,
        variables: { email: user.email, phone: user.phone },
        recent: await recentRead,
        tzOffsetMinutes: reqTz(tzOffsetMinutes, personality.stylePortrait?.tzOffsetMinutes),
        heldStop,
      });
      await recordUsage({ user, source: "rest", ...result.usage });
      await appendHistoryEntry(
        user,
        personality,
        {
          kind: "voice",
          targetApp,
          language,
          input: result.transcript,
          output: result.cleanedText,
          durationMs: Date.now() - t0,
          wordsIn: countWords(result.transcript),
          wordsOut: result.usage.words,
          // Whose voice wrote it. Without these the Voices card could only ever
          // show the tone currently selected, which is a setting, not a habit.
          tone: tone ?? personality.activeTone,
          presetId: personality.activePresetId,
          // Read only to tell the next stretch of this dictation from a new
          // one, so a dictation written pause by pause is one History card.
          // A rewrite carries on from the selection it rewrote, as /v1/edit's do.
          context: result.replacedSelection ? selection : context,
        },
        result.usage.audioSeconds,
      );
      learnFromUsage(user, personality);
      desktopDictated(req, user, personality);
      // holdsStops: this server understands heldStop, so a desktop may hold back
      // the full stop that ends a pause stretch and let the next stretch decide
      // (assistPrompt's held stop). A desktop that is not told so holds nothing.
      return reply.send({ ...result, holdsStops: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Pipeline failed" });
    }
  });
}
