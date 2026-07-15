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
  const raw = await (cfg.STT_PROVIDER === "groq"
    ? transcribeGroq(input)
    : transcribeOpenAI(input));

  // Belt-and-braces silence-hallucination scrub on EVERY provider path.
  // gpt-4o-transcribe (the default) shares Whisper's "silent audio →
  // 'Thank you.'" failure mode but returns no per-segment confidence, so this
  // flat-text pass is the only defense on that path — without it a keyboard
  // mic that captures no real audio inserts the same "Thank you." every tap.
  // Idempotent for Groq (sanitizeWhisperText already ran it).
  const text = sanitizePlainTranscript(raw.text);

  // Provider didn't report a duration (OpenAI gpt-4o-transcribe never does)
  // — fall back to a header/CBR probe of the buffer so metering isn't zeroed
  // out for every voice request.
  if (raw.durationSeconds > 0) return { ...raw, text };
  const estimated = estimateDurationSeconds(input.audio, input.format);
  return { text, durationSeconds: estimated };
}

/**
 * Probe an audio buffer for its length in seconds when the STT provider
 * didn't hand us one. Accurate for well-formed WAV; a rough CBR-128kbps
 * estimate for MP3; zero (with a once-per-boot warning) for containers we
 * don't parse yet (m4a/ogg/webm/flac). Never throws — a bad header just
 * returns 0 and lets metering under-count instead of failing the request.
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
      case "m4a":
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

// One-per-boot warning per format we can't yet probe, so ops sees a clear
// signal (rather than silence + zeroed metering) when a client starts sending
// a container we haven't wired up.
const warnedFormats = new Set<AudioFormat>();
function warnUnsupportedFormatOnce(format: AudioFormat): void {
  if (warnedFormats.has(format)) return;
  warnedFormats.add(format);
  console.warn(
    `[stt] provider returned no duration for ${format}; no header probe wired up ` +
      `→ audioSeconds will be 0 for ${format} until parser is added.`,
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

async function transcribeOpenAI(input: SttInput): Promise<SttResult> {
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
  };
}

async function transcribeGroq(input: SttInput): Promise<SttResult> {
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

  const cleaned = sanitizeWhisperText(res);
  return {
    text: cleaned,
    durationSeconds: typeof res.duration === "number" ? res.duration : 0,
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
  const NO_SPEECH_CEIL = 0.6;
  const AVG_LOGPROB_FLOOR = -1.0; // ln(p) — anything below this = coin flip

  let text = "";
  if (Array.isArray(res.segments) && res.segments.length > 0) {
    const kept = res.segments.filter((s) => {
      if (typeof s.no_speech_prob === "number" && s.no_speech_prob > NO_SPEECH_CEIL) return false;
      if (typeof s.avg_logprob === "number" && s.avg_logprob < AVG_LOGPROB_FLOOR) return false;
      return true;
    });
    text = kept.map((s) => (s.text ?? "").trim()).filter(Boolean).join(" ");
  } else {
    text = (res.text ?? "").trim();
  }

  return sanitizePlainTranscript(text);
}

/**
 * Flat-text sanitizer for a transcript we have no per-segment confidence for
 * (the OpenAI gpt-4o-transcribe path — and any other provider that returns
 * only text). Strips known silence-hallucination phrases and collapses
 * degenerate repetition. Idempotent, so the Groq path re-running it after its
 * segment-level filtering is a no-op on already-clean text.
 */
export function sanitizePlainTranscript(text: string): string {
  return collapseRepetitions(stripHallucinationPhrases(text)).trim();
}

/**
 * Whisper / gpt-4o-transcribe's known "silent audio → boilerplate"
 * hallucinations. On a near-silent or empty clip both models emit filler
 * lifted from their video training data — most infamously a bare
 * "Thank you." (the sign-off at the end of countless YouTube clips). This is
 * the exact symptom users hit when the keyboard mic captures no real audio:
 * every tap returns the same "Thank you." text.
 *
 * When the WHOLE transcript IS one of these, we return an empty string (the
 * anchored ^…$ scoping guarantees we only nuke standalone filler, never a
 * "thank you" buried inside a real sentence). A separate tail-trimmer below
 * strips the YouTube-outro tails off an otherwise-real transcript.
 *
 * Not exhaustive — add here as new patterns surface in the wild.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
  // Bare thanks — the #1 silence hallucination. Only fires as the whole
  // transcript, so a real "thank you" inside a sentence survives.
  /^\s*thank\s*you(\s+(so|very)\s+much)?(\s+(guys|all|everyone))?[!.\s]*$/i,
  /^\s*thanks(\s+(a\s+lot|so\s+much))?(\s+(guys|all|everyone))?[!.\s]*$/i,
  // Whisper's classic single-token drop-out on silence.
  /^\s*you[!.\s]*$/i,
  // YouTube-outro boilerplate.
  /^\s*thanks?\s+for\s+watching[!.\s]*$/i,
  /^\s*thank\s+you\s+for\s+watching[!.\s]*$/i,
  /^\s*please\s+subscribe[!.\s]*$/i,
  /^\s*subscribe\s+to\s+my\s+channel[!.\s]*$/i,
  /^\s*don'?t\s+forget\s+to\s+(like\s+and\s+)?subscribe[!.\s]*$/i,
  /^\s*see\s+you\s+(next\s+time|in\s+the\s+next\s+video)[!.\s]*$/i,
  /^\s*bye[!.\s]*$/i,
  /^\s*outro[!.\s]*$/i,
  /^\s*\[music\][!.\s]*$/i,
  /^\s*(um|uh|hmm|mm|ah)[!.\s]*$/i,
];

function stripHallucinationPhrases(text: string): string {
  const t = text.trim();
  if (!t) return "";
  for (const pat of HALLUCINATION_PATTERNS) {
    if (pat.test(t)) return "";
  }
  // Trim a hallucinated tail off an otherwise-real transcript.
  return t
    .replace(/\s*(thanks? for watching|thank you for watching|please subscribe|don'?t forget to (like and )?subscribe|see you next time)[!.\s]*$/i, "")
    .trim();
}

/**
 * Collapse degenerate repetition ("you you you you you", "the the the")
 * down to a single occurrence. Whisper does this when it loses signal
 * mid-utterance and starts generating filler; the fix is to notice a token
 * repeating 4+ times in a row and keep just one.
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
      if (repeat < 3) out.push(w); // allow up to "the the the" for emphasis
    } else {
      last = norm;
      repeat = 1;
      out.push(w);
    }
  }
  return out.join(" ");
}
