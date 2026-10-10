/**
 * Synthetic audio for the no-speech tests, generated in the test rather than
 * committed as binaries. Each stands in for something a microphone really
 * picks up between two sentences.
 *
 *   silence  — digital zero
 *   noise    — white noise at a level (room tone, a fan, a breath close up)
 *   tone     — a pure tone (the classic stand-in for "sound")
 *   voice    — a harmonic series on a 4 Hz syllable envelope: pitched and
 *              articulated the way a voice is, which is what the measure keys on
 */

export const SR = 16000;

/** Deterministic noise, so a test cannot pass on one run and fail on the next. */
export function rng(seed = 7): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

export const clip = (seconds: number) => new Float32Array(Math.round(seconds * SR));
const span = (a: Float32Array, from: number, to: number) =>
  [Math.max(0, Math.round(from * SR)), Math.min(a.length, Math.round(to * SR))] as const;

/** Add white noise at `db` dBFS RMS over [from, to). */
export function noise(a: Float32Array, db: number, from = 0, to = a.length / SR, seed = 7): Float32Array {
  const r = rng(seed);
  const g = Math.pow(10, db / 20) * Math.sqrt(3);
  const [i0, i1] = span(a, from, to);
  for (let i = i0; i < i1; i++) a[i] += r() * g;
  return a;
}

/** Add a sine at `hz` and `db` dBFS RMS over [from, to). */
export function tone(a: Float32Array, hz: number, db: number, from: number, to: number): Float32Array {
  const g = Math.pow(10, db / 20) * Math.SQRT2;
  const [i0, i1] = span(a, from, to);
  for (let i = i0; i < i1; i++) a[i] += g * Math.sin((2 * Math.PI * hz * i) / SR);
  return a;
}

/** Add a voice-like signal: pitch `f0`, eight harmonics, syllables at 4 Hz. */
export function voice(a: Float32Array, f0: number, db: number, from: number, to: number): Float32Array {
  const g = Math.pow(10, db / 20) * 1.6;
  const [i0, i1] = span(a, from, to);
  for (let i = i0; i < i1; i++) {
    const t = i / SR;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f0 * h * t + h) / h;
    a[i] += g * s * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t));
  }
  return a;
}

/** A click: a few milliseconds of full-scale square wave at `at` seconds. */
export function click(a: Float32Array, at: number): Float32Array {
  const [i0, i1] = span(a, at, at + 0.01);
  for (let i = i0; i < i1; i++) a[i] += i % 2 ? 0.6 : -0.6;
  return a;
}

/** Floats → 16-bit little-endian PCM (what the live socket receives). */
export function pcm16(samples: Float32Array): Buffer {
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2);
  }
  return b;
}

/** Floats → a canonical 16-bit mono PCM WAV file. */
export function wav(samples: Float32Array, sampleRate = SR): Buffer {
  const data = pcm16(samples);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** The owner's case: 1.2 s of a quiet room with one breath in it. */
export const breathClip = () => noise(noise(clip(1.2), -65), -32, 0.35, 0.8, 11);
/** A second of someone talking, inside a 1.4 s clip of a quiet room. */
export const speechClip = () => voice(noise(clip(1.4), -62), 130, -22, 0.2, 1.2);
