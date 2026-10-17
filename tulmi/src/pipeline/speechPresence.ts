/**
 * IS ANYBODY SPEAKING IN THIS AUDIO? MEASURED, NOT ASKED OF THE RECOGNISER.
 *
 * Whisper-family recognisers answer a quiet clip with words: "Thank you.",
 * "जिंदगी में.", "Jhal". The desktop uploads every pause between sentences
 * as its own clip, so a breath, a click or a second of room tone arrived at
 * the recogniser on its own and came back as a sentence nobody said. The
 * recogniser's own confidence did not catch it — those phrases come back
 * with confidence to spare — so this listens to the audio itself.
 *
 * Two numbers, from 40 ms frames:
 *   voiced — louder than the room AND pitched (a periodic waveform between
 *            70 and 400 Hz). That is a voice: vowels, voiced consonants,
 *            in any language. Breath, hiss, fans, clicks and rumble are not
 *            periodic and never count, however loud.
 *   active — louder than the room at all. Covers what voicing misses
 *            (whispering, unvoiced consonants) so a caller can tell "nothing
 *            happened" from "something happened that was not a voice".
 *
 * "Louder than the room" is relative: the room is the quietest tenth of the
 * clip, so a noisy café and a silent bedroom are judged against themselves.
 * The voice threshold is also capped, so a clip that is speech from end to
 * end (no quiet tenth to find) still measures as speech.
 *
 * Pure TypeScript on PCM. WAV is decoded here; the other containers (webm,
 * ogg, m4a, mp3, flac) are decoded by ffmpeg, which the production image
 * installs. Without ffmpeg the measurement is "unknown" (null) and callers
 * fall back to the other signals — never to "silent".
 */
import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AudioFormat } from "../../../shared/types/api.js";

export interface SpeechMeasure {
  /** Seconds of audio analysed. */
  totalSeconds: number;
  /** Seconds louder than the room and pitched: a voice. */
  voicedSeconds: number;
  /** Seconds louder than the room at all (voice, breath, a knock). */
  activeSeconds: number;
  /** True when only the first MEASURE_MAX_S of a longer clip were analysed. */
  truncated: boolean;
}

/** One analysis frame. */
export interface Frame {
  /** RMS level, dBFS. */
  db: number;
  /** Strongest pitch-period autocorrelation, 0..1 (0 when not computed). */
  periodicity: number;
}

export const FRAME_S = 0.04;
/** Pitch analysis runs near 4 kHz: plenty for a 70–400 Hz voice, and cheap
 *  enough to run on the event loop (20 s of solid speech in about 10 ms). */
const ANALYSIS_RATE = 4000;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 400;
/** A voiced frame's pitch peak. White noise and breath peak around 0.4 in a
 *  40 ms frame now and then; a voice sits well above. */
const PERIODICITY_MIN = 0.5;
/** How far above the room a frame must be to count as sound. */
const ABOVE_ROOM_DB = 9;
/** Quieter than this is never sound, whatever the room. Low on purpose: a
 *  phone with no gain control at arm's length records speech around -45. */
const SOUND_MIN_DB = -55;
/** A pitched frame this loud is a voice even when there is no quiet room to
 *  compare against (a clip that is speech from end to end). */
const VOICE_CAP_DB = -32;
/** Only this much of a clip is decoded and measured. A pause stretch is a few
 *  seconds; past this a clip is a real dictation and the measure is moot. */
export const MEASURE_MAX_S = 20;
/** Nothing larger goes to disk for measuring. */
const MEASURE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Analyse mono PCM (floats in -1..1) into frames. Pitch is only computed for
 * frames loud enough that it could matter, which keeps a silent minute cheap.
 */
export function analyzeFrames(samples: Float32Array, sampleRate: number): Frame[] {
  const frameLen = Math.max(1, Math.round(FRAME_S * sampleRate));
  const out: Frame[] = [];
  for (let start = 0; start + frameLen <= samples.length; start += frameLen) {
    out.push(analyzeFrame(samples.subarray(start, start + frameLen), sampleRate));
  }
  return out;
}

function analyzeFrame(frame: Float32Array, sampleRate: number): Frame {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  const db = 10 * Math.log10(sum / frame.length + 1e-12);
  // Below the absolute floor it cannot be a voice; skip the pitch search.
  return { db, periodicity: db < SOUND_MIN_DB ? 0 : periodicity(frame, sampleRate) };
}

/**
 * The strongest pitch-period autocorrelation in the frame, 0..1.
 *
 * Decimated to ~4 kHz, pre-emphasised (so low rumble and mains hum do not
 * look periodic at short lags), and only INTERIOR peaks count: a slope that
 * is highest at the edge of the lag range is a low tone, not a pitch.
 * Returns as soon as one peak clears the voicing bar — the exact value above
 * it is never used, and stopping early halves the cost of speech.
 */
function periodicity(frame: Float32Array, sampleRate: number): number {
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
  const rate = sampleRate / factor;
  const n = Math.floor(frame.length / factor);
  const minLag = Math.max(2, Math.floor(rate / MAX_PITCH_HZ));
  const maxLag = Math.min(n - 8, Math.ceil(rate / MIN_PITCH_HZ));
  if (maxLag <= minLag + 1) return 0;

  // Box-filter decimation, then first-difference pre-emphasis, mean removed.
  const x = new Float32Array(n);
  let prev = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += frame[i * factor + k]!;
    s /= factor;
    x[i] = s - 0.95 * prev;
    prev = s;
    mean += x[i]!;
  }
  mean /= n;
  for (let i = 0; i < n; i++) x[i] = x[i]! - mean;

  const r = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = x[i]!, b = x[i + lag]!;
      xy += a * b; xx += a * a; yy += b * b;
    }
    r[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    // The lag before this one is now judgeable as a peak.
    const p = lag - 1;
    if (p >= minLag && p <= maxLag && r[p]! >= r[p - 1]! && r[p]! >= r[lag]! && r[p]! > best) {
      best = r[p]!;
      if (best >= PERIODICITY_MIN) return best;
    }
  }
  return best;
}

/** The room: the level of the quietest tenth of these frames. */
export function roomFloorDb(frames: Frame[]): number {
  if (!frames.length) return -120;
  const levels = frames.map((f) => f.db).sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.1)]!;
}

/** Voiced and active seconds in `frames`, judged against `floorDb`. */
export function summarizeFrames(frames: Frame[], floorDb = roomFloorDb(frames)): { voicedSeconds: number; activeSeconds: number } {
  const soundDb = Math.max(floorDb + ABOVE_ROOM_DB, SOUND_MIN_DB);
  // Capped: continuous speech has no quiet tenth, and its "room" is itself.
  const voiceDb = Math.min(soundDb, VOICE_CAP_DB);
  const pitched = frames.map((f) => f.db >= voiceDb && f.db >= SOUND_MIN_DB && f.periodicity >= PERIODICITY_MIN);
  let voiced = 0;
  let active = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]!.db >= soundDb) active++;
    // A voice holds its pitch for a vowel — 80 ms at the very least — so a
    // pitched frame counts only beside another. Noise throws up a lone
    // periodic-looking frame now and then; never two in a row.
    if (pitched[i] && (pitched[i - 1] || pitched[i + 1])) voiced++;
  }
  return { voicedSeconds: round2(voiced * FRAME_S), activeSeconds: round2(active * FRAME_S) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Measure mono PCM floats. */
export function measurePcm(samples: Float32Array, sampleRate: number, truncated = false): SpeechMeasure {
  const frames = analyzeFrames(samples, sampleRate);
  return {
    totalSeconds: round2(samples.length / sampleRate),
    ...summarizeFrames(frames),
    truncated,
  };
}

/**
 * Decode a PCM WAV (8/16/24/32-bit integer or 32-bit float, any channel
 * count) to mono floats, capped at MEASURE_MAX_S. null for anything else, so
 * the caller can hand it to ffmpeg instead.
 */
export function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number; truncated: boolean } | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let fmt = 0, channels = 0, sampleRate = 0, bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > buf.length) return null;
      fmt = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format's first word.
      if (fmt === 0xfffe && size >= 26 && body + 26 <= buf.length) fmt = buf.readUInt16LE(body + 24);
    } else if (id === "data") {
      if (!channels || !sampleRate || !bits) return null;
      const isFloat = fmt === 3 && bits === 32;
      if (!(fmt === 1 && [8, 16, 24, 32].includes(bits)) && !isFloat) return null;
      const bytes = bits / 8;
      // A streamed WAV can carry 0 or 0xFFFFFFFF here: read what is present.
      const end = size && body + size <= buf.length ? body + size : buf.length;
      const frameBytes = bytes * channels;
      let count = Math.floor((end - body) / frameBytes);
      const cap = Math.floor(MEASURE_MAX_S * sampleRate);
      const truncated = count > cap;
      if (truncated) count = cap;
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + i * frameBytes + c * bytes;
          s += isFloat ? buf.readFloatLE(p)
            : bits === 8 ? (buf.readUInt8(p) - 128) / 128
            : bits === 16 ? buf.readInt16LE(p) / 32768
            : bits === 24 ? buf.readIntLE(p, 3) / 8388608
            : buf.readInt32LE(p) / 2147483648;
        }
        out[i] = s / channels;
      }
      return { samples: out, sampleRate, truncated };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Little-endian 16-bit PCM → floats (mixing interleaved channels to mono). */
export function pcm16ToFloat(buf: Buffer, channels = 1): Float32Array {
  const ch = Math.max(1, channels);
  const count = Math.floor(buf.length / (2 * ch));
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += buf.readInt16LE((i * ch + c) * 2) / 32768;
    out[i] = s / ch;
  }
  return out;
}

/**
 * The demuxer ffmpeg is told to read each accepted container with.
 *
 * NAMED, NEVER PROBED, AND NEVER PART OF A PATH. `format` is request data,
 * and it used to become the temp file's extension — `clip.${format}` — so a
 * "format" carrying "../" wrote the upload wherever the process could write.
 * And a probing ffmpeg reads whatever the bytes say they are, including a
 * playlist naming other files or URLs to fetch. A fixed file name, a demuxer
 * chosen from this list and file-only protocols close all three.
 */
const DEMUXERS = new Map<AudioFormat, string>([
  ["wav", "wav"], ["mp3", "mp3"], ["m4a", "mov"], ["ogg", "ogg"], ["webm", "matroska"], ["flac", "flac"],
]);

/** ffmpeg decodes to this for measuring. */
const DECODE_RATE = 16000;

/** Decode any accepted container to 16 kHz mono PCM with ffmpeg. null when it cannot. */
async function decodeWithFfmpeg(audio: Buffer, format: AudioFormat): Promise<{ samples: Float32Array; truncated: boolean } | null> {
  const demuxer = DEMUXERS.get(format);
  if (!demuxer) return null;
  let dir = "";
  try {
    // Inside the try: a full disk is "cannot measure", not a failed dictation.
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tz-speech-"));
    const file = path.join(dir, "clip");
    await fsp.writeFile(file, audio);
    const { stdout } = await promisify(execFile)("ffmpeg", [
      "-hide_banner", "-nostats", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file",
      "-f", demuxer, "-i", file, "-t", String(MEASURE_MAX_S),
      "-ac", "1", "-ar", String(DECODE_RATE), "-f", "s16le", "pipe:1",
    ], { encoding: "buffer", timeout: 4000, maxBuffer: MEASURE_MAX_S * DECODE_RATE * 2 + 65536 });
    const pcm = stdout as unknown as Buffer;
    if (!pcm?.length) return null;
    const samples = pcm16ToFloat(pcm);
    // Hitting the cap means there was more; the measure covers the start only.
    return { samples, truncated: samples.length >= (MEASURE_MAX_S - 0.05) * DECODE_RATE };
  } catch {
    return null;
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * How much voice is in this clip. null when it cannot be measured (no
 * ffmpeg, an unreadable clip, an unknown format, a file too large to be a
 * pause) — which callers must read as "unknown", never as "silent".
 */
export async function measureSpeech(audio: Buffer, format: AudioFormat): Promise<SpeechMeasure | null> {
  if (!audio?.length || audio.length > MEASURE_MAX_BYTES || !DEMUXERS.has(format)) return null;
  try {
    if (format === "wav") {
      const wav = decodeWav(audio);
      if (wav) return measurePcm(wav.samples, wav.sampleRate, wav.truncated);
    }
    const decoded = await decodeWithFfmpeg(audio, format);
    return decoded ? measurePcm(decoded.samples, DECODE_RATE, decoded.truncated) : null;
  } catch {
    // A malformed header is "cannot measure", never a failed dictation.
    return null;
  }
}

/**
 * The same measurement for the LIVE socket, which receives raw 16-bit PCM in
 * arbitrary chunks. Frames accumulate as audio arrives; a committed segment
 * is judged on the frames of its own time window, against the room as heard
 * over the last minute.
 */
export class LiveSpeechMeter {
  private readonly frames: Frame[] = [];
  private pending = new Float32Array(0);
  private readonly frameLen: number;

  constructor(private readonly sampleRate: number, private readonly channels = 1) {
    this.frameLen = Math.max(1, Math.round(FRAME_S * sampleRate));
  }

  /** Seconds of audio received so far. */
  get seconds(): number {
    return (this.frames.length * this.frameLen + this.pending.length) / this.sampleRate;
  }

  /** Feed one chunk of interleaved little-endian 16-bit PCM. Never throws. */
  push(chunk: Buffer): void {
    try {
      const fresh = pcm16ToFloat(chunk, this.channels);
      const all = new Float32Array(this.pending.length + fresh.length);
      all.set(this.pending);
      all.set(fresh, this.pending.length);
      let start = 0;
      for (; start + this.frameLen <= all.length; start += this.frameLen) {
        this.frames.push(analyzeFrame(all.subarray(start, start + this.frameLen), this.sampleRate));
      }
      this.pending = all.slice(start);
    } catch { /* a malformed chunk only costs the measurement */ }
  }

  /**
   * Voice in [from, to) seconds of the stream. null when no audio covers the
   * window — the caller then has no measurement, which is not silence.
   */
  measure(from: number, to: number): SpeechMeasure | null {
    const a = Math.max(0, Math.floor(from / FRAME_S));
    const b = Math.min(this.frames.length, Math.ceil(to / FRAME_S));
    if (b <= a) return null;
    // The room as heard over the last minute up to this window.
    const room = this.frames.slice(Math.max(0, b - Math.round(60 / FRAME_S)), b);
    const window = this.frames.slice(a, b);
    return {
      totalSeconds: round2(window.length * FRAME_S),
      ...summarizeFrames(window, roomFloorDb(room)),
      truncated: false,
    };
  }
}
