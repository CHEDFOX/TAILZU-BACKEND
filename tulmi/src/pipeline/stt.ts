/**
 * Speech-to-text. Provider-pluggable so we can serve a global audience:
 *  - "openai" (default): gpt-4o-transcribe — ~100 languages, strong multilingual.
 *  - "groq": whisper-large-v3-turbo — fast + cheap fallback.
 *
 * Hindi/Hinglish remains the flagship, but language is open-ended: any
 * ISO-639-1 code is passed through; "auto"/"hinglish" let the model detect (best
 * for spontaneous code-switching).
 */
import OpenAI, { toFile as toOpenAIFile } from "openai";
import Groq, { toFile as toGroqFile } from "groq-sdk";
import { getConfig } from "../config.js";
import type { AudioFormat, LanguageHint } from "../../../shared/types/api.js";

let openaiClient: OpenAI | null = null;
function openai(): OpenAI {
  // 60s timeout (transcription of a short clip is fast, but leave headroom),
  // one retry — so a stuck Whisper call can't hold the request open for the
  // SDK default ~10 min.
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: getConfig().OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  return openaiClient;
}

let groqClient: Groq | null = null;
function groq(): Groq {
  if (!groqClient) groqClient = new Groq({ apiKey: getConfig().GROQ_API_KEY });
  return groqClient;
}

/**
 * Map our language hint to an ISO-639-1 code, or undefined for auto-detect.
 * "auto" and "hinglish" → undefined (let the model detect; it handles
 * code-switching better than being pinned to one language). Anything else is
 * assumed to be a valid language code and passed through.
 */
function sttLanguage(hint: LanguageHint | undefined): string | undefined {
  if (!hint || hint === "auto" || hint === "hinglish") return undefined;
  return hint;
}

export interface SttResult {
  text: string;
  /** Audio length in seconds (0 when the provider doesn't report it). */
  durationSeconds: number;
}

/**
 * Internal provider result — carries a `speechConfidence` signal alongside the
 * public fields so `transcribe()` can decide whether to trust short filler
 * ("thank you"/"you") as a real one-word dictation or strip it as a silence
 * hallucination. Not exposed on the public SttResult.
 *   "high"    — provider confidence says this is real speech (keep it).
 *   "low"     — provider flagged it as non-speech/silence (safe to strip).
 *   "unknown" — no per-segment confidence (OpenAI path); fall back to duration.
 */
interface RawSttResult extends SttResult {
  speechConfidence?: "high" | "low" | "unknown";
}

/**
 * A clip at least this long is assumed to contain a real word, so we DON'T
 * strip a standalone "thank you"/"you" from it (that would be nuking a
 * legitimate one-word dictation). Only shorter/near-empty captures — the
 * actual silence-hallucination case — fall through to the short-phrase nuke.
 */
const SPEECH_MIN_DURATION_S = 0.45;

export interface SttInput {
  audio: Buffer;
  format: AudioFormat;
  language?: LanguageHint;
  /** Personal dictionary (names/jargon) to bias recognition toward. */
  vocabulary?: string;
}

const CODE_SWITCH_HINT = "The speaker may mix multiple languages in one sentence.";

/** Whisper's prompt biases spelling/vocabulary — fold the user's dictionary in. */
function sttPrompt(vocabulary?: string): string {
  const terms = vocabulary?.replace(/\s*\n\s*/g, ", ").trim();
  return terms ? `${CODE_SWITCH_HINT} Likely names/terms: ${terms}.` : CODE_SWITCH_HINT;
}

export async function transcribe(input: SttInput): Promise<SttResult> {
  const cfg = getConfig();
  const raw: RawSttResult = await (cfg.STT_PROVIDER === "groq"
    ? transcribeGroq(input)
    : transcribeOpenAI(input));

  // Resolve duration first: the provider's own number, else a header probe of
  // the buffer (WAV/MP3/m4a) so metering isn't zeroed out for every voice
  // request — AND so the transcript scrub below has a real length to reason
  // about.
  const duration =
    raw.durationSeconds > 0
      ? raw.durationSeconds
      : estimateDurationSeconds(input.audio, input.format);

  // Silence-hallucination scrub on EVERY provider path. gpt-4o-transcribe (the
  // default) shares Whisper's "silent audio → 'Thank you.'" failure mode, so
  // this flat-text pass is the only defense there.
  //
  // BUT: a bare "thank you"/"you" is ALSO a legitimate one-word dictation.
  // Nuking it unconditionally swallowed real short utterances (the reported
  // bug). So we only apply the aggressive short-phrase nuke when the clip is
  // actually silence — either the provider flagged it low-confidence, or it's
  // too short to hold a real word. A confident or long-enough clip is trusted
  // and its "thank you" survives. Multi-word YouTube boilerplate ("thanks for
  // watching") is stripped regardless — nobody dictates that into a keyboard.
  const trustSpeech =
    raw.speechConfidence === "high" ||
    (raw.speechConfidence !== "low" && duration >= SPEECH_MIN_DURATION_S);
  const text = sanitizePlainTranscript(raw.text, { trustSpeech });

  return { text, durationSeconds: duration };
}

/**
 * Probe an audio buffer for its length in seconds when the STT provider
 * didn't hand us one. Accurate for well-formed WAV and m4a/MP4 (mvhd box); a
 * rough CBR-128kbps estimate for MP3; zero (with a once-per-boot warning) for
 * containers we don't parse yet (ogg/webm/flac). Never throws — a bad header
 * just returns 0 and lets metering under-count instead of failing the request.
 */
export function estimateDurationSeconds(
  audio: Buffer,
  format: AudioFormat,
): number {
  try {
    switch (format) {
      case "wav":
        return probeWavDuration(audio);
      case "mp3":
        // Approximate at CBR 128 kbps: bytes / 16_000 = seconds.
        // 128000 bits/s ÷ 8 = 16000 bytes/s. Real files vary (VBR, ID3v2 tag,
        // other bitrates) — the goal is "non-zero and vaguely honest", not
        // sample-accurate. Truth-in-metering: this can be off by ±25%.
        return audio.length / 16_000;
      case "m4a": {
        // m4a is an MP4 container — read the exact duration out of the movie
        // header (moov/mvhd). This is what the keyboard's batch-record path
        // sends, so without it every batch dictation metered audioSeconds=0.
        const d = probeMp4Duration(audio);
        if (d > 0) return d;
        warnUnsupportedFormatOnce(format);
        return 0;
      }
      case "ogg":
      case "webm":
      case "flac":
        warnUnsupportedFormatOnce(format);
        return 0;
    }
  } catch {
    // Fall through — a corrupt header shouldn't reject the whole request.
  }
  return 0;
}

/**
 * Read the audio length out of an MP4/m4a container's movie header. MP4 is a
 * tree of length-prefixed boxes [size(4) type(4) …]; we walk down to
 * `moov > mvhd` and read `duration / timescale`. Handles the 32-bit (v0) and
 * 64-bit (v1) mvhd layouts and 64-bit box sizes. Returns 0 on any mismatch so
 * a truncated/streamed file just under-meters instead of throwing.
 */
export function probeMp4Duration(buf: Buffer): number {
  const moov = findMp4Box(buf, 0, buf.length, "moov");
  if (!moov) return 0;
  const mvhd = findMp4Box(buf, moov.start, moov.end, "mvhd");
  if (!mvhd) return 0;

  let p = mvhd.start;
  if (p + 4 > buf.length) return 0;
  const version = buf.readUInt8(p);
  p += 4; // version (1) + flags (3)

  let timescale = 0;
  let duration = 0;
  if (version === 1) {
    if (p + 28 > buf.length) return 0;
    p += 16; // creation (8) + modification (8)
    timescale = buf.readUInt32BE(p);
    p += 4;
    duration = Number(buf.readBigUInt64BE(p));
  } else {
    if (p + 16 > buf.length) return 0;
    p += 8; // creation (4) + modification (4)
    timescale = buf.readUInt32BE(p);
    p += 4;
    duration = buf.readUInt32BE(p);
  }
  if (timescale <= 0 || duration <= 0) return 0;
  return duration / timescale;
}

/** Find a direct child box named `type` within [start, end). Returns the
 *  box's CONTENT range (header stripped), or null. */
function findMp4Box(
  buf: Buffer,
  start: number,
  end: number,
  type: string,
): { start: number; end: number } | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const boxType = buf.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit largesize follows the type.
      if (offset + 16 > end) break;
      size = Number(buf.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      // Box extends to the end of the buffer.
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    if (boxType === type) {
      return { start: offset + headerSize, end: offset + size };
    }
    offset += size;
  }
  return null;
}

// One-per-boot warning per format we can't yet probe, so ops sees a clear
// signal (rather than silence + zeroed metering) when a client starts sending
// a container we haven't wired up.
const warnedFormats = new Set<AudioFormat>();
function warnUnsupportedFormatOnce(format: AudioFormat): void {
  if (warnedFormats.has(format)) return;
  warnedFormats.add(format);
  console.warn(
    `[stt] no usable duration for ${format} (provider reported none and the ` +
      `buffer couldn't be probed) → audioSeconds will be 0 for this clip.`,
  );
}

/**
 * Parse a canonical PCM WAV header (RIFF/WAVE) and return the audio length in
 * seconds. We walk the chunk table so files with a "LIST"/"bext" chunk before
 * "data" (broadcast-WAV variants) still work. Returns 0 on any parse mismatch.
 */
function probeWavDuration(buf: Buffer): number {
  if (buf.length < 44) return 0;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return 0;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return 0;

  let offset = 12;
  let sampleRate = 0;
  let numChannels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;

    if (id === "fmt ") {
      if (bodyStart + 16 > buf.length) return 0;
      numChannels = buf.readUInt16LE(bodyStart + 2);
      sampleRate = buf.readUInt32LE(bodyStart + 4);
      bitsPerSample = buf.readUInt16LE(bodyStart + 14);
    } else if (id === "data") {
      dataSize = size;
      break; // stop at data — later chunks are metadata
    }

    // WAV chunks are word-aligned; odd sizes get a pad byte.
    offset = bodyStart + size + (size % 2);
  }

  if (sampleRate <= 0 || numChannels <= 0 || bitsPerSample <= 0 || dataSize <= 0) {
    return 0;
  }
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  return byteRate > 0 ? dataSize / byteRate : 0;
}

async function transcribeOpenAI(input: SttInput): Promise<RawSttResult> {
  const cfg = getConfig();
  const file = await toOpenAIFile(input.audio, `audio.${input.format}`);

  // gpt-4o-transcribe returns { text } (no duration). Audio-seconds for metering
  // is reported by the client recorder; words are the reliable meter here.
  const res = await openai().audio.transcriptions.create({
    file,
    model: cfg.OPENAI_STT_MODEL,
    language: sttLanguage(input.language),
    prompt: sttPrompt(input.vocabulary),
    response_format: "json",
  });

  return {
    text: (res.text ?? "").trim(),
    durationSeconds: 0,
    // No per-segment confidence on this model — let transcribe() fall back to
    // clip duration to decide whether a bare "thank you" is real speech.
    speechConfidence: "unknown",
  };
}

async function transcribeGroq(input: SttInput): Promise<RawSttResult> {
  const cfg = getConfig();
  const file = await toGroqFile(input.audio, `audio.${input.format}`);

  // verbose_json gives us the audio duration for metering AND the
  // per-segment confidence signals (no_speech_prob, avg_logprob) we use to
  // drop hallucinated segments before they land at the cursor.
  const res = (await groq().audio.transcriptions.create({
    file,
    model: cfg.GROQ_STT_MODEL,
    language: sttLanguage(input.language),
    response_format: "verbose_json",
    prompt: sttPrompt(input.vocabulary),
    // Temperature 0 makes Whisper deterministic and much less likely to
    // "hallucinate" on silent / low-signal chunks. The provider only accepts
    // the field on some SDK versions; ignore the cast if TS complains.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    temperature: 0 as any,
  })) as GroqVerboseResponse;

  // Only the CONFIDENCE FILTER runs here — the phrase-level scrub is deferred to
  // transcribe() so it can be gated on the clip's real duration (a confident
  // "thank you" must survive; a silent-clip hallucination must not).
  const filtered = filterConfidentSegments(res);
  return {
    text: filtered.text,
    durationSeconds: typeof res.duration === "number" ? res.duration : 0,
    speechConfidence: filtered.speechConfidence,
  };
}

interface GroqSegment {
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}
interface GroqVerboseResponse {
  text: string;
  duration?: number;
  segments?: GroqSegment[];
}

/**
 * Post-process Whisper's transcript to strip:
 *   1. Segments with no_speech_prob > threshold (silent / non-speech audio
 *      that Whisper invented words for)
 *   2. Segments with very low avg_logprob (Whisper wasn't confident enough)
 *   3. Known hallucination phrases — Whisper has a well-documented failure
 *      mode where near-silent audio produces boilerplate like "Thanks for
 *      watching!" from its YouTube training data.
 *   4. Repetition loops — e.g. "you you you you" from mic drop-outs.
 *
 * If segments come back, we rebuild the text from the survivors. Otherwise
 * we run the phrase + repetition filters on the flat text.
 */
export function sanitizeWhisperText(res: GroqVerboseResponse): string {
  // Strict path (exported utility): confidence-filter, then the full phrase
  // scrub with no speech-trust. The production Groq path (transcribeGroq) does
  // NOT use this — it defers the phrase scrub to transcribe() so it can be
  // duration-gated — but callers wanting the aggressive one-shot keep it.
  return sanitizePlainTranscript(filterConfidentSegments(res).text);
}

/**
 * Drop Whisper segments that read as silence/non-speech and report how
 * confident we are that what's left is real speech:
 *   1. no_speech_prob > ceiling  → silence/non-speech Whisper invented.
 *   2. avg_logprob   < floor     → model wasn't confident enough.
 * `speechConfidence` is "high" when confident segments survived, "low" when
 * segments existed but all were dropped (a silence signal), "unknown" when the
 * response carried no segments to judge.
 */
function filterConfidentSegments(res: GroqVerboseResponse): {
  text: string;
  speechConfidence: "high" | "low" | "unknown";
} {
  const NO_SPEECH_CEIL = 0.6;
  const AVG_LOGPROB_FLOOR = -1.0; // ln(p) — anything below this = coin flip

  if (Array.isArray(res.segments) && res.segments.length > 0) {
    const kept = res.segments.filter((s) => {
      if (typeof s.no_speech_prob === "number" && s.no_speech_prob > NO_SPEECH_CEIL) return false;
      if (typeof s.avg_logprob === "number" && s.avg_logprob < AVG_LOGPROB_FLOOR) return false;
      return true;
    });
    const text = kept.map((s) => (s.text ?? "").trim()).filter(Boolean).join(" ");
    return { text, speechConfidence: kept.length > 0 ? "high" : "low" };
  }
  return { text: (res.text ?? "").trim(), speechConfidence: "unknown" };
}

/**
 * Flat-text sanitizer for a transcript. Strips known silence-hallucination
 * phrases and collapses degenerate repetition. Idempotent.
 *
 * `trustSpeech` (default false): when the caller has a positive signal that the
 * clip is real speech (confident segments, or long enough to hold a word), the
 * aggressive short-phrase nuke is skipped so a legitimate one-word "thank
 * you"/"you" dictation survives. Multi-word YouTube boilerplate is stripped
 * either way.
 */
export function sanitizePlainTranscript(
  text: string,
  opts: { trustSpeech?: boolean } = {},
): string {
  return collapseRepetitions(
    stripHallucinationPhrases(text, opts.trustSpeech ?? false),
  ).trim();
}

/**
 * Multi-word boilerplate Whisper / gpt-4o-transcribe lift from their video
 * training data on near-silent clips ("thanks for watching", "please
 * subscribe", "[music]"). Nobody dictates these standalone into a keyboard, so
 * we strip them on ANY path regardless of confidence. Anchored ^…$ so we only
 * nuke a standalone occurrence, never one buried in a real sentence.
 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^\s*thanks?\s+for\s+watching[!.\s]*$/i,
  /^\s*thank\s+you\s+for\s+watching[!.\s]*$/i,
  /^\s*please\s+subscribe[!.\s]*$/i,
  /^\s*subscribe\s+to\s+my\s+channel[!.\s]*$/i,
  /^\s*don'?t\s+forget\s+to\s+(like\s+and\s+)?subscribe[!.\s]*$/i,
  /^\s*see\s+you\s+(next\s+time|in\s+the\s+next\s+video)[!.\s]*$/i,
  /^\s*outro[!.\s]*$/i,
  /^\s*\[music\][!.\s]*$/i,
];

/**
 * Short phrases that are BOTH a common silence hallucination AND a legitimate
 * one-word dictation ("thank you", "you", "bye"). These are only stripped when
 * `trustSpeech` is false — i.e. we have a positive silence signal. With trust,
 * they're kept, so a real short utterance isn't swallowed (the reported bug).
 */
const AMBIGUOUS_SILENCE_PATTERNS: RegExp[] = [
  /^\s*thank\s*you(\s+(so|very)\s+much)?(\s+(guys|all|everyone))?[!.\s]*$/i,
  /^\s*thanks(\s+(a\s+lot|so\s+much))?(\s+(guys|all|everyone))?[!.\s]*$/i,
  /^\s*you[!.\s]*$/i,
  /^\s*bye[!.\s]*$/i,
  /^\s*(um|uh|hmm|mm|ah)[!.\s]*$/i,
];

function stripHallucinationPhrases(text: string, trustSpeech: boolean): string {
  const t = text.trim();
  if (!t) return "";
  // Always kill unambiguous video boilerplate.
  for (const pat of BOILERPLATE_PATTERNS) {
    if (pat.test(t)) return "";
  }
  // Only kill ambiguous short filler when we DON'T trust the clip as speech.
  if (!trustSpeech) {
    for (const pat of AMBIGUOUS_SILENCE_PATTERNS) {
      if (pat.test(t)) return "";
    }
  }
  // Trim a hallucinated outro tail off an otherwise-real transcript (safe:
  // only strips a known outro appended to real text, never the whole thing).
  return t
    .replace(/\s*(thanks? for watching|thank you for watching|please subscribe|don'?t forget to (like and )?subscribe|see you next time)[!.\s]*$/i, "")
    .trim();
}

/**
 * Collapse a degenerate repetition loop ("you you you you you") that Whisper
 * emits when it loses signal mid-utterance. We keep at most TWO in a row and
 * drop the rest — two survives natural emphasis ("no no", "very very") while a
 * runaway loop of 3+ identical tokens collapses to "no no". (Not down to a
 * single token: that would flatten legitimate doubled words.)
 */
function collapseRepetitions(text: string): string {
  if (!text) return "";
  const words = text.split(/\s+/);
  const out: string[] = [];
  let last = "";
  let repeat = 0;
  for (const w of words) {
    const norm = w.toLowerCase();
    if (norm === last) {
      repeat += 1;
      if (repeat < 3) out.push(w); // keep the 1st + 2nd, drop the 3rd onward
    } else {
      last = norm;
      repeat = 1;
      out.push(w);
    }
  }
  return out.join(" ");
}
