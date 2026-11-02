/**
 * How long a clip is, read from its container (WAV, MP4) or estimated from its size.
 */

import type { AudioFormat } from "../../../../shared/types/api.js";

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
      // NEVER MORE THAN ARRIVED. A WAV written as it is streamed (OpenAI's
      // speech, any encoder that does not seek back) cannot know its length
      // when it writes the header, so it writes the largest one there is:
      // 0xFFFFFFFF bytes, 27 hours at 22 kHz. Read as true, a three-second
      // clip was refused as "longer than 15 minutes". The bytes after the
      // header are the audio; there is no more of it than that.
      dataSize = Math.min(size, buf.length - bodyStart);
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
