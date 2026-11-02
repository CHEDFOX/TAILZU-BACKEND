/**
 * Speech-to-text. Provider-pluggable so we can serve a global audience:
 *  - "openai" (default): OPENAI_STT_MODEL — ~100 languages, strong multilingual.
 *  - "groq": GROQ_STT_MODEL — fast + cheap fallback.
 *
 * Hindi/Hinglish remains the flagship, but language is open-ended: any
 * ISO-639-1 code is passed through; "auto"/"hinglish" let the model detect (best
 * for spontaneous code-switching).
 *
 * This module is the way in: transcribe() and the engines it runs. Each engine,
 * the prompt, the duration probes and the transcript checks are files in ./stt/.
 */

import type { AudioFormat } from "../../../shared/types/api.js";
import { getConfig } from "../config.js";
import { detectScript } from "./script.js";
import { isKnownHallucination, isFillerOnly, type SpeechEvidence, spokenWords, type GateResult, gateTranscript } from "./speechGate.js";
import { measureSpeech } from "./speechPresence.js";
import { isIndicResult, transcriptsAgree, isUsableAlternative } from "./stt/compare.js";
import { transcribeDeepgram } from "./stt/deepgram.js";
import { estimateDurationSeconds } from "./stt/duration.js";
import { transcribeGroq } from "./stt/groq.js";
import { transcribeOpenAI } from "./stt/openai.js";
import { sanitizePlainTranscript } from "./stt/sanitize.js";
import { transcribeSarvam } from "./stt/sarvam.js";
import type { SttInput, SttResult } from "./stt/types.js";
export { INDIC_SCRIPTS, detectScript, romanHindiHits, type DetectedScript } from "./script.js";
export { type SttResult, type SttInput } from "./stt/types.js";
export { englishShare, mixesEnglishAndRomanHindi, romanHindiScore, transliterated, readsAsRomanHindi, leadsOnScript } from "./stt/language.js";
export { transcriptsAgree, isUsableAlternative } from "./stt/compare.js";
export { portraitTerms, sttPrompt } from "./stt/prompt.js";
export { estimateDurationSeconds, probeMp4Duration } from "./stt/duration.js";
export { sanitizeWhisperText, filterConfidentSegments } from "./stt/groq.js";
export { sanitizePlainTranscript, isAmbiguousPhrase, speechSeconds } from "./stt/sanitize.js";

/** The generalist (Whisper family) — strong across ~100 languages. */
function transcribeGeneralist(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  return cfg.STT_PROVIDER === "openai" || !cfg.GROQ_API_KEY
    ? transcribeOpenAI(input)
    : transcribeGroq(input);
}

/**
 * Provider dispatch.
 *
 * "auto" (recommended) is NOT single-provider: it runs the Indic specialist
 * and the global generalist CONCURRENTLY and keeps the better transcript.
 * That's the only way to serve a worldwide audience without asking the user
 * what they're about to speak — you cannot route by language before you know
 * the language, and asking is exactly what we refuse to do.
 *
 *   • Sarvam wins when the result is Indic (detected language or native
 *     script) — including romanized Hinglish, which it is specifically built
 *     for and the generalist handles worst.
 *   • The generalist wins otherwise, so French/Japanese/Spanish keep
 *     ~100-language quality instead of being forced through an India-tuned
 *     model.
 *   • Either failing alone is survivable — the other's result is used.
 *
 * Cost is two STT calls per dictation (STT is cents-per-hour and far cheaper
 * than the LLM call that follows); latency is the SLOWER of the two, not the
 * sum, because they run in parallel. Pin STT_PROVIDER to a single provider if
 * you'd rather trade quality for that cost.
 */
async function transcribeWithProvider(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();

  if (cfg.STT_PROVIDER === "auto" && cfg.SARVAM_API_KEY) {
    // Every configured file-based engine hears the same clip CONCURRENTLY.
    // Deepgram joins when STT_AUTO_INCLUDE_DEEPGRAM is on and a key exists —
    // a third opinion costs a third call and no extra latency (they run in
    // parallel), but it's opt-in because the gain is smaller than the first
    // two and it widens the failure surface.
    // Mirrors transcribeGeneralist's choice so the label names the engine that
    // actually ran. (In "auto" the configured provider is "auto", so the
    // generalist is Groq whenever its key exists.)
    const legNames: string[] = ["sarvam", cfg.GROQ_API_KEY ? "groq" : "openai"];
    const legs: Array<Promise<SttResult>> = [
      transcribeSarvam(input),
      transcribeGeneralist(input),
    ];
    if (cfg.STT_AUTO_INCLUDE_DEEPGRAM && cfg.DEEPGRAM_API_KEY) {
      legNames.push("deepgram");
      legs.push(transcribeDeepgram(input));
    }
    const settled = await Promise.allSettled(legs);
    // A leg that keeps failing is INVISIBLE otherwise: its result is filtered
    // out, the other engine's transcript is used, and everything looks fine
    // while the specialist never actually runs. That is exactly how a
    // misconfigured Sarvam silently degrades Indic dictation to Whisper. Log
    // every rejection with the provider that produced it.
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[stt] ${legNames[i]} leg failed:`, (r.reason as Error)?.message);
      }
    });
    const heard = settled
      .filter((s): s is PromiseFulfilledResult<SttResult> => s.status === "fulfilled")
      .map((s) => s.value);
    const ok = heard.filter((r) => r.text.trim());

    if (!ok.length) {
      const rejected = settled.filter(
        (s): s is PromiseRejectedResult => s.status === "rejected",
      );
      if (rejected.length) {
        // EVERY PROVIDER REFUSING THE AUDIO IS NOT AN OUTAGE.
        //
        // Recognizers answer a clip with nothing in it with a 4xx — too
        // short, no speech, unsupported. Throwing turned that into HTTP 500
        // "Pipeline failed", so stopping a recording before saying anything
        // answered with an error instead of writing nothing. The byte-length
        // guard added earlier catches an empty buffer; it does not catch a
        // real recording of a quiet room, which is the common case.
        //
        // A 4xx is the provider looking at the audio and refusing it — that
        // is an answer, and the answer is silence. A 5xx or a network failure
        // is nobody looking at all, and that must still travel: swallowing it
        // would hide an outage and leave someone thinking their words
        // vanished.
        //
        // AND ONLY FOR A CLIP THAT COULD BE SILENT. A 4xx does not always
        // mean "nothing here" — it can mean "I cannot process this", for a
        // language or an encoding a provider does not handle. Believing that
        // on a ten-second recording would eat somebody's dictation and report
        // nothing, which is the worst outcome this product has. A quiet room
        // is short; a sentence is not.
        if (rejected.every((r) => isAudioRejection(r.reason)) && plausiblySilent(input.audio, input.format)) {
          console.error("[stt] every provider refused a short clip — treating as silence");
          return { text: "", durationSeconds: 0, speechConfidence: "low" };
        }
        console.error("[stt] every provider failed:", (rejected[0]!.reason as Error)?.message);
        throw rejected[0]!.reason;
      }
      // All succeeded but every transcript was empty — a genuinely silent
      // clip. Return one so the existing silence handling applies.
      const anyResult = settled.find((s) => s.status === "fulfilled") as
        | PromiseFulfilledResult<SttResult>
        | undefined;
      return anyResult?.value ?? { text: "", durationSeconds: 0, speechConfidence: "low" };
    }

    // The Indic specialist leads when the speech IS Indic; otherwise the
    // generalist does. Losers aren't discarded — the closest one rides along
    // as a second opinion so the writing model can reconcile a disagreement
    // (see SttResult.alternative). Engines fail in different places, so each
    // usually holds part of the truth.
    //
    // A READING THAT IS ONLY WHAT RECOGNISERS SAY TO SILENCE NEVER LEADS.
    // Script used to decide alone, so a generalist that answered a breath
    // with "जिंदगी में." beat the engine that heard the real words, purely
    // for being in Devanagari. When another engine heard something that is
    // not one of those phrases, that reading is the candidate pool.
    const real = ok.filter((r) => !isKnownHallucination(r.text) && !isFillerOnly(r.text));
    const pool = real.length ? real : ok;
    const primary = pool.find((r) => isIndicResult(r)) ?? pool[0]!;
    const other = pool.find(
      (r) =>
        r !== primary &&
        !transcriptsAgree(primary.text, r.text) &&
        isUsableAlternative(primary.text, r.text),
    );
    // Every other engine's reading — including the ones that heard NOTHING —
    // goes to the gate in transcribe(): silence from one engine is evidence
    // against a short clip's words from another.
    const otherReadings = heard.filter((r) => r !== primary).map((r) => r.text.trim());
    return other ? { ...primary, alternative: other.text, otherReadings } : { ...primary, otherReadings };
  }

  if (cfg.STT_PROVIDER === "sarvam") {
    try {
      return await transcribeSarvam(input);
    } catch (err) {
      // Never fail a dictation because one provider blipped — fall back to the
      // Whisper path rather than handing the user an error toast.
      console.error("[stt] sarvam failed, falling back:", (err as Error).message);
      return transcribeGeneralist(input);
    }
  }
  return cfg.STT_PROVIDER === "groq" ? transcribeGroq(input) : transcribeOpenAI(input);
}

/**
 * One engine, by name, with no provider selection in the way.
 *
 * `transcribe()` reads STT_PROVIDER and decides for itself, which is right for
 * the product and useless for measuring: you cannot compare two engines through
 * a function whose whole job is to hide which one ran. The bench
 * (scripts/stt-bench.ts) needs to address each leg directly, so the legs are
 * named here rather than reached for through config.
 *
 * "generalist" is whichever of Groq/OpenAI the environment is set up for —
 * the same choice transcribeGeneralist makes for the real path, so the bench
 * measures what production would actually run.
 */
export const STT_ENGINES = {
  sarvam: transcribeSarvam,
  generalist: transcribeGeneralist,
  deepgram: transcribeDeepgram,
  openai: transcribeOpenAI,
  groq: transcribeGroq,
} as const;

export type SttEngineName = keyof typeof STT_ENGINES;

/**
 * Below this, there is no speech to find and every provider says so with an
 * error. A tenth of a second of audio is not a word in any language.
 */
const MIN_USABLE_AUDIO_BYTES = 1024;

/**
 * Did the provider look at this audio and refuse it, or did it never look?
 *
 * A 4xx is a verdict on the clip: too short, no speech, unsupported codec.
 * Every provider returning one means there is nothing to hear, and silence is
 * the right answer. A 5xx, a timeout or a socket error is nobody answering,
 * which has to stay an error — a user whose dictation vanished into a shrug
 * would never know the difference, and we would never hear about the outage.
 *
 * Read from whichever shape the provider threw: the OpenAI SDK sets `status`,
 * and the hand-rolled fetch paths put it in the message ("sarvam stt failed:
 * 400 …"). 429 is excluded deliberately — being rate limited says nothing
 * about the audio.
 */
/** Longest a clip can be and still plausibly hold no speech at all. */
const SILENCE_PLAUSIBLE_S = 2;
/** Fallback ceiling for containers whose duration we cannot read (ogg, webm,
 *  flac): roughly two seconds of 16 kHz 16-bit mono, and far more than two
 *  seconds of anything compressed. */
const QUIET_CLIP_BYTES = 64_000;

/**
 * Could this clip genuinely contain nothing?
 *
 * The gate on treating a universal 4xx as silence. Every provider refusing a
 * two-second recording is a quiet room; every provider refusing a ten-second
 * one is a failure to process it, and reporting that as "you said nothing"
 * loses the words and the error at once.
 */
export function plausiblySilent(audio: Buffer, format: AudioFormat): boolean {
  const seconds = estimateDurationSeconds(audio, format);
  if (seconds > 0) return seconds <= SILENCE_PLAUSIBLE_S;
  return audio.length <= QUIET_CLIP_BYTES;
}

export function isAudioRejection(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const code = typeof status === "number"
    ? status
    : Number(/\b(\d{3})\b/.exec(String((err as Error)?.message ?? ""))?.[1]);
  return Number.isFinite(code) && code >= 400 && code < 500 && code !== 429;
}

export async function transcribe(input: SttInput): Promise<SttResult> {
  // A CLIP WITH NOTHING IN IT NEVER REACHES A PROVIDER.
  //
  // Recognisers reject audio that is empty or too short with a 4xx, which
  // threw, which the route turned into a 500. So recording silence and
  // stopping — a thing people do by accident constantly — answered "Pipeline
  // failed" instead of writing nothing. Measured on the deployed server:
  // dictation/silence-writes-nothing, two runs in three.
  //
  // Decided locally, before any network call, so it stays a statement about
  // the AUDIO. Swallowing a provider's 5xx as "you said nothing" would hide a
  // real outage behind a shrug and leave the user thinking their words
  // vanished; that error still travels.
  if (!input.audio || input.audio.length < MIN_USABLE_AUDIO_BYTES) {
    return {
      text: "",
      durationSeconds: estimateDurationSeconds(input.audio, input.format),
      script: "unknown",
      detectedLanguage: undefined,
      engine: "none",
      alternative: undefined,
    };
  }
  // THE AUDIO IS MEASURED ON EVERY CLIP, WHILE THE RECOGNISERS RUN.
  //
  // It used to be measured only when the transcript was one of a handful of
  // ENGLISH phrases and the clip's length was unknown, so a breath the
  // recogniser wrote as "जिंदगी में." or "Jhal" was never measured at all.
  // Started before the provider call and awaited after it, so it adds no
  // time; it never rejects (null = could not measure).
  const measuring = measureSpeech(input.audio, input.format);
  // Provider selection (and its fallback) lives in transcribeWithProvider.
  const raw: SttResult = await transcribeWithProvider(input);
  const measure = await measuring;

  // Resolve duration first: the provider's own number, else a header probe of
  // the buffer (WAV/MP3/m4a) so metering isn't zeroed out for every voice
  // request — AND so the gate below has a length to reason about when the
  // audio could not be measured.
  const duration =
    raw.durationSeconds > 0
      ? raw.durationSeconds
      : estimateDurationSeconds(input.audio, input.format);

  // NO SPEECH IN, NO TEXT OUT — on every provider path (speechGate.ts).
  //
  // The recogniser's confidence used to decide this, and on the clips that
  // matter it is wrong: Whisper answers a breath with "Thank you." and calls
  // it confident, and "high" skipped every check. The measured voice decides
  // now; the recognisers' own signals and each other's readings are what is
  // left when the audio cannot be measured.
  const evidence: SpeechEvidence = {
    measure,
    clipSeconds: duration,
    clipBytes: input.audio.length,
    confidence: raw.speechConfidence,
    others: raw.otherReadings,
  };
  const gate = scrubAndGate(raw.text, evidence);
  const text = gate.text;
  if (gate.dropped) {
    // The reason and the size, never the words: this is somebody's dictation.
    console.info(`[stt] withheld ${spokenWords(raw.text)} word(s) from ${raw.engine ?? "stt"}: ${gate.dropped}`
      + ` (voice ${measure ? `${measure.voicedSeconds}s of ${measure.totalSeconds}s` : "not measured"})`);
  }
  // The second opinion passes the same gate. A hallucinated candidate handed
  // to the writer as "candidate 2" is how an invented phrase gets merged
  // into a real sentence.
  let alternative: string | undefined;
  if (text && raw.alternative) {
    const alt = scrubAndGate(raw.alternative, evidence).text;
    if (alt && !transcriptsAgree(text, alt) && isUsableAlternative(text, alt)) alternative = alt;
  }

  return {
    text,
    durationSeconds: duration,
    script: detectScript(text),
    detectedLanguage: raw.detectedLanguage,
    engine: raw.engine ?? getConfig().STT_PROVIDER,
    // Only forward a second opinion when the chosen transcript survived the
    // gate — offering an alternative to an empty result would resurrect text
    // we just decided was a hallucination.
    alternative,
    // Forwarded now rather than discarded. A low reading here does not mean
    // silence — that was already handled above — it means the words that came
    // back are a guess, which is exactly what the writing step needs to know
    // before deciding how hard to repair them.
    speechConfidence: raw.speechConfidence,
    voicedSeconds: measure?.voicedSeconds,
    dropped: gate.dropped,
  };
}

/**
 * The flat-text scrub (outros, repetition loops) and then the no-speech gate.
 * Exported for the live socket, which judges each committed segment the same
 * way against its own measured window.
 */
export function scrubAndGate(text: string, evidence: SpeechEvidence): GateResult {
  const scrubbed = sanitizePlainTranscript(text, { trustSpeech: true });
  if (!scrubbed) return text.trim() ? { text: "", dropped: "boilerplate" } : { text: "" };
  // The operator's valve (SPEECH_MEASURE): without the measure the gate still
  // runs on the phrase lists and the other engine's reading.
  return gateTranscript(scrubbed, getConfig().SPEECH_MEASURE ? evidence : { ...evidence, measure: undefined });
}
