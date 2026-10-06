/**
 * Is anybody speaking? Measured on the audio, not asked of the recogniser.
 *
 * The owner's desktop pasted "जिंदगी में.", "Thank you." and "Jhal" for the
 * breaths between sentences: each pause is uploaded as its own clip and a
 * recogniser answers near-silence with words. These pin the measurement the
 * no-speech gate stands on — on generated audio, so it runs everywhere; the
 * ffmpeg path for compressed clips is covered where ffmpeg exists.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  decodeWav, LiveSpeechMeter, measurePcm, measureSpeech,
} from "../src/pipeline/speechPresence.js";
import {
  SR, breathClip, click, clip, noise, pcm16, rng, speechClip, tone, voice, wav,
} from "./audio-fixtures.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe("what is not a voice measures as none", () => {
  it("silence, room tone and a loud steady noise hold no voice and nothing above the room", () => {
    for (const [name, a] of [
      ["digital silence", clip(1.2)],
      ["quiet room", noise(clip(1.2), -60)],
      ["noisy room", noise(clip(1.2), -45)],
      ["a fan up close", noise(clip(1.2), -22)],
    ] as const) {
      const m = measurePcm(a, SR);
      expect(m.voicedSeconds, name).toBe(0);
      expect(m.activeSeconds, name).toBe(0);
    }
  });

  it("a breath is sound, but not a voice", () => {
    const m = measurePcm(breathClip(), SR);
    expect(m.voicedSeconds).toBe(0);
    expect(m.activeSeconds).toBeGreaterThan(0.3);
    expect(m.activeSeconds).toBeLessThan(1);
  });

  it("a click is a frame of sound and no voice", () => {
    const m = measurePcm(click(noise(clip(1.2), -65), 0.6), SR);
    expect(m.voicedSeconds).toBe(0);
    expect(m.activeSeconds).toBeLessThanOrEqual(0.08);
  });

  it("mains hum and low rumble are not a pitch", () => {
    expect(measurePcm(tone(noise(clip(1.2), -65), 50, -30, 0, 1.2), SR).voicedSeconds).toBe(0);
    const rumble = clip(1.2);
    const r = rng(3);
    let y = 0;
    for (let i = 0; i < rumble.length; i++) { y = 0.995 * y + r() * 0.02; rumble[i] = y; }
    expect(measurePcm(rumble, SR).voicedSeconds).toBe(0);
  });
});

describe("a voice measures as voice", () => {
  it("a second of speech-like sound measures close to its length", () => {
    const m = measurePcm(speechClip(), SR);
    expect(m.voicedSeconds).toBeGreaterThan(0.7);
    expect(m.voicedSeconds).toBeLessThanOrEqual(1.1);
    expect(m.totalSeconds).toBeCloseTo(1.4, 1);
  });

  it("a short word is still a word", () => {
    const m = measurePcm(voice(noise(clip(1.2), -55), 220, -25, 0.4, 0.8), SR);
    expect(m.voicedSeconds).toBeGreaterThanOrEqual(0.3);
  });

  it("holds up in a noisy room, from a quiet mic, and with no quiet moment at all", () => {
    expect(measurePcm(voice(noise(clip(1.5), -35), 150, -24, 0.2, 1.2), SR).voicedSeconds).toBeGreaterThan(0.3);
    expect(measurePcm(voice(noise(clip(1.5), -70), 140, -45, 0.3, 1.2), SR).voicedSeconds).toBeGreaterThan(0.4);
    // Speech from end to end has no quiet tenth to call the room.
    expect(measurePcm(voice(clip(2), 130, -20, 0, 2), SR).voicedSeconds).toBeGreaterThan(1.2);
  });

  it("a tone burst stands in for sound in either direction", () => {
    const m = measurePcm(tone(noise(clip(1.2), -65), 300, -20, 0.3, 0.9), SR);
    expect(m.voicedSeconds).toBeGreaterThan(0.5);
    expect(m.voicedSeconds).toBeLessThan(0.75);
  });

  it("is cheap enough to run on every clip", () => {
    const long = voice(noise(clip(20), -55), 130, -22, 0, 20);
    const t0 = Date.now();
    measurePcm(long, SR);
    expect(Date.now() - t0).toBeLessThan(400);
  });
});

describe("WAV is decoded without ffmpeg", () => {
  it("measures a WAV upload directly", async () => {
    expect((await measureSpeech(wav(breathClip()), "wav"))?.voicedSeconds).toBe(0);
    expect((await measureSpeech(wav(speechClip()), "wav"))?.voicedSeconds).toBeGreaterThan(0.7);
  });

  it("reads float, 8-bit and stereo WAVs", () => {
    const mk = (fmt: number, bits: number, channels: number, body: Buffer) => {
      const h = Buffer.alloc(44);
      h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + body.length, 4); h.write("WAVE", 8, "ascii");
      h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16); h.writeUInt16LE(fmt, 20); h.writeUInt16LE(channels, 22);
      h.writeUInt32LE(8000, 24); h.writeUInt32LE(8000 * channels * bits / 8, 28);
      h.writeUInt16LE(channels * bits / 8, 32); h.writeUInt16LE(bits, 34);
      h.write("data", 36, "ascii"); h.writeUInt32LE(body.length, 40);
      return Buffer.concat([h, body]);
    };
    const f32 = Buffer.alloc(8 * 4); f32.writeFloatLE(0.5, 0);
    expect(decodeWav(mk(3, 32, 1, f32))?.samples[0]).toBeCloseTo(0.5, 5);
    const u8 = Buffer.from([255, 128, 0, 128]);
    expect(Array.from(decodeWav(mk(1, 8, 1, u8))!.samples).map((v) => Math.round(v))).toEqual([1, 0, -1, 0]);
    const st = Buffer.alloc(8); st.writeInt16LE(16384, 0); st.writeInt16LE(-16384, 2);
    expect(decodeWav(mk(1, 16, 2, st))?.samples[0]).toBeCloseTo(0, 5);   // L and R cancel
  });

  it("says unknown for anything it cannot read — never silent", async () => {
    expect(decodeWav(Buffer.from("not a wav at all, not even close to one"))).toBeNull();
    expect(await measureSpeech(Buffer.alloc(0), "wav")).toBeNull();
    expect(await measureSpeech(Buffer.from("x"), "constructor" as never)).toBeNull();
  });
});

describe("the live stream measures as it listens", () => {
  it("judges each window against the room, whatever the chunk sizes", () => {
    const meter = new LiveSpeechMeter(SR, 1);
    const audio = pcm16(Float32Array.from([...breathClip(), ...speechClip()]));
    // Odd chunk sizes, as a socket delivers them.
    for (let i = 0; i < audio.length; i += 1234) meter.push(audio.subarray(i, i + 1234));
    expect(meter.seconds).toBeCloseTo(2.6, 1);
    expect(meter.measure(0, 1.2)!.voicedSeconds).toBe(0);
    expect(meter.measure(1.2, 2.6)!.voicedSeconds).toBeGreaterThan(0.7);
  });

  it("has no measurement for audio it never received", () => {
    const meter = new LiveSpeechMeter(SR, 1);
    expect(meter.measure(0, 1)).toBeNull();
    meter.push(pcm16(clip(0.5)));
    expect(meter.measure(3, 4)).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)("compressed clips go through ffmpeg", () => {
  const enc = (src: string, seconds = 1.2): Buffer => execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", src, "-t", String(seconds),
    "-c:a", "libopus", "-f", "webm", "pipe:1",
  ]);

  it("measures desktop webm: room tone and a breath as no voice, a tone as voice", async () => {
    expect((await measureSpeech(enc("anullsrc=r=16000:cl=mono"), "webm"))?.voicedSeconds).toBe(0);
    expect((await measureSpeech(enc("anoisesrc=r=16000:a=0.02:c=white"), "webm"))?.voicedSeconds).toBe(0);
    expect((await measureSpeech(enc("sine=frequency=220:sample_rate=16000"), "webm"))?.voicedSeconds).toBeGreaterThan(0.8);
  });

  it("returns unknown for bytes it cannot decode", async () => {
    expect(await measureSpeech(Buffer.from("definitely not audio"), "webm")).toBeNull();
  });
});
