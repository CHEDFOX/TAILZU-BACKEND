/**
 * NEAR-LIVE DICTATION THROUGH OPENROUTER (routes/writing/live-engines.ts openOpenRouter). OpenRouter has no streaming socket for speech,
 * so the engine makes the stream: the line so far is transcribed every so often as the caption, and a pause commits it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { openOpenRouter, pcmToWav, loudness, liveProvider, ROUTER_RATE } = await import("../src/routes/writing/live-engines.js");
const { resetConfigForTests } = await import("../src/config.js");

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

/** `ms` of 16 kHz mono: a loud tone, or silence. */
const tone = (ms: number, loud = true): Buffer => {
  const n = Math.round((ms / 1000) * ROUTER_RATE), b = Buffer.alloc(n * 2);
  if (loud) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 3)), i * 2);
  return b;
};
const TUNE = { partialEveryMs: 400, pauseMs: 300, lineMaxMs: 3000, quiet: 500 };

function run() {
  const ev: string[] = [];
  let calls = 0;
  const transcribe = vi.fn(async (wav: Buffer) => { calls++; return `heard ${(wav.length - 44) / 2 / ROUTER_RATE}s`; });
  let closed!: () => void; const done = new Promise<void>((r) => (closed = r));
  const eng = openOpenRouter({ sampleRate: ROUTER_RATE, channels: 1 }, {
    onReady: () => ev.push("ready"), onPartial: (t) => ev.push(`partial ${t}`), onFinal: (t, tm) => ev.push(`final ${t} @${tm?.start}`),
    onError: (m) => ev.push(`error ${m}`), onClose: () => { ev.push("close"); closed(); },
  }, { transcribe, tuning: TUNE });
  return { ev, eng, done, transcribe, calls: () => calls };
}
const feed = (eng: { send(b: Buffer): void }, pcm: Buffer, frameMs = 40) => {
  const f = Math.round((frameMs / 1000) * ROUTER_RATE) * 2;
  for (let i = 0; i < pcm.length; i += f) eng.send(pcm.subarray(i, i + f));
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("near-live through OpenRouter", () => {
  it("says it is ready, captions the line as it grows, and a pause commits it", async () => {
    const { ev, eng, done } = run();
    await tick();
    feed(eng, tone(1000));
    await tick();
    feed(eng, tone(400, false));
    eng.close();
    await done;
    expect(ev[0]).toBe("ready");
    expect(ev.some((e) => e.startsWith("partial "))).toBe(true);
    expect(ev.filter((e) => e.startsWith("final "))).toHaveLength(1);
    expect(ev[ev.length - 1]).toBe("close");
  });

  it("two sentences with a pause between are two finals, in order, each saying where it lies", async () => {
    const { ev, eng, done } = run();
    feed(eng, Buffer.concat([tone(800), tone(400, false), tone(800), tone(400, false)]));
    eng.close();
    await done;
    const finals = ev.filter((e) => e.startsWith("final "));
    expect(finals).toHaveLength(2);
    expect(finals[0]).toMatch(/@0$/);
    expect(Number(finals[1]!.split("@")[1])).toBeGreaterThan(1);
  });

  it("silence alone is never sent to be transcribed, and the close still comes", async () => {
    const { ev, eng, done, calls } = run();
    feed(eng, tone(2000, false));
    eng.close();
    await done;
    expect(calls()).toBe(0);
    expect(ev.filter((e) => e.startsWith("final "))).toHaveLength(0);
    expect(ev).toContain("close");
  });

  it("a line never runs past its longest: a long breathless stretch is cut into finals", async () => {
    const { ev, eng, done } = run();
    feed(eng, tone(7000));
    eng.close();
    await done;
    expect(ev.filter((e) => e.startsWith("final ")).length).toBeGreaterThanOrEqual(2);
  });

  it("a recogniser that fails says so as an error, and the session still closes", async () => {
    const ev: string[] = [];
    let closed!: () => void; const done = new Promise<void>((r) => (closed = r));
    const eng = openOpenRouter({ sampleRate: ROUTER_RATE, channels: 1 }, {
      onReady: () => undefined, onPartial: () => undefined, onFinal: () => undefined,
      onError: (m) => ev.push(`error ${m}`), onClose: () => { ev.push("close"); closed(); },
    }, { transcribe: async () => { throw new Error("transcription 429"); }, tuning: TUNE });
    feed(eng, Buffer.concat([tone(600), tone(400, false)]));
    eng.close();
    await done;
    expect(ev).toEqual(["error transcription 429", "close"]);
  });

  it("the wav and the loudness it is built on", () => {
    const wav = pcmToWav(tone(100));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(ROUTER_RATE);
    expect(loudness(tone(100))).toBeGreaterThan(1000);
    expect(loudness(tone(100, false))).toBe(0);
  });
});

describe("which live engine", () => {
  it("openai means OpenAI's model through OpenRouter while that is on, and openrouter means it outright", () => {
    vi.stubEnv("STT_LIVE_PROVIDER", "openai"); resetConfigForTests();
    expect(liveProvider()).toBe("openrouter");
    vi.stubEnv("STT_LIVE_PROVIDER", "openrouter"); resetConfigForTests();
    expect(liveProvider()).toBe("openrouter");
  });
  it("sent to OpenAI itself, openai is OpenAI's realtime socket when there is a key", () => {
    vi.stubEnv("STT_LIVE_PROVIDER", "openai"); vi.stubEnv("OPENAI_STT_VIA_OPENROUTER", "false"); vi.stubEnv("OPENAI_API_KEY", "k"); resetConfigForTests();
    expect(liveProvider()).toBe("openai");
  });
});
