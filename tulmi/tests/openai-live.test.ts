import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "sk-test";
process.env.STT_PROVIDER = "openai";
process.env.STT_LIVE_PROVIDER = "openai";
process.env.STT_LIVE_DUAL = "false";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.OPENAI_LIVE_FLUSH_MS = "50";

// eslint-disable-next-line import/first
import { OPENAI_RATE, createResampler, liveEngineConfigured, liveProvider, openOpenAI } from "../src/routes/live-engines.js";

/** Stands in for OpenAI's realtime socket: records what is sent, replays events. */
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  closedWith: number | undefined;
  url = "";
  headers: Record<string, string> = {};
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    setImmediate(() => this.emit("close", code));
  }
  event(m: object) { this.emit("message", Buffer.from(JSON.stringify(m))); }
}

function harness() {
  const sock = new FakeSocket();
  const log = { ready: 0, partials: [] as string[], finals: [] as Array<{ text: string; timing?: { start: number; duration: number } }>, errors: [] as string[], closed: [] as Array<number | undefined> };
  const engine = openOpenAI({ sampleRate: 16000, channels: 1 }, {
    onReady: () => { log.ready++; },
    onPartial: (t) => log.partials.push(t),
    onFinal: (text, timing) => log.finals.push({ text, timing }),
    onError: (m) => log.errors.push(m),
    onClose: (c) => log.closed.push(c),
  }, (url, headers) => { sock.url = url; sock.headers = headers; return sock as never; });
  return { sock, log, engine };
}

const pcm16 = (samples: number[]) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
};

describe("resampling to OpenAI's 24 kHz", () => {
  it("16 kHz becomes half again as many samples, split across chunks without a seam", () => {
    const r = createResampler(16000, OPENAI_RATE, 1);
    const ramp = Array.from({ length: 1600 }, (_, i) => i * 10);
    const whole = Buffer.concat([r(pcm16(ramp.slice(0, 777))), r(pcm16(ramp.slice(777)))]);
    const out = Array.from({ length: whole.length / 2 }, (_, i) => whole.readInt16LE(i * 2));
    expect(Math.abs(out.length - 2400)).toBeLessThanOrEqual(2);
    // A straight line stays straight: every step is two thirds of the input's.
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i]! - out[i - 1]! - 10 * (2 / 3))).toBeLessThanOrEqual(1);
  });

  it("stereo is folded to mono, and an odd byte waits for its partner", () => {
    const r = createResampler(24000, OPENAI_RATE, 2);
    const a = r(Buffer.from([0x10, 0x00, 0x30]));          // a frame and a half
    const b = r(Buffer.from([0x00]));                        // the rest of the frame
    expect(a.length + b.length).toBe(2);
    expect((a.length ? a : b).readInt16LE(0)).toBe(0x20);    // (0x10 + 0x30) / 2
  });
});

describe("OpenAI live dictation", () => {
  it("is chosen and configured from the one OpenAI key", () => {
    expect(liveProvider()).toBe("openai");
    expect(liveEngineConfigured()).toBe(true);
  });

  it("asks for a transcription session with the efficient model, and waits for it", () => {
    const { sock, log, engine } = harness();
    expect(sock.url).toBe("wss://api.openai.com/v1/realtime?intent=transcription");
    expect(sock.headers.Authorization).toBe("Bearer sk-test");
    expect(engine.label).toBe("openai:gpt-4o-mini-transcribe");
    sock.emit("open");
    expect(sock.sent[0]).toMatchObject({
      type: "session.update",
      session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "gpt-4o-mini-transcribe" } } } },
    });
    // Audio before the session is ready is held, then sent in order.
    engine.send(pcm16(new Array(160).fill(100)));
    expect(sock.sent.filter((m) => m.type === "input_audio_buffer.append")).toHaveLength(0);
    sock.event({ type: "session.updated" });
    expect(log.ready).toBe(1);
    expect(sock.sent.filter((m) => m.type === "input_audio_buffer.append")).toHaveLength(1);
  });

  it("shows partials, and releases turns in the order they were said, with where they lie", () => {
    const { sock, log } = harness();
    sock.emit("open");
    sock.event({ type: "session.updated" });
    sock.event({ type: "input_audio_buffer.speech_started", item_id: "a", audio_start_ms: 200 });
    sock.event({ type: "input_audio_buffer.speech_stopped", item_id: "a", audio_end_ms: 1700 });
    sock.event({ type: "input_audio_buffer.committed", item_id: "a" });
    sock.event({ type: "input_audio_buffer.committed", item_id: "b" });
    sock.event({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "kal ka " });
    sock.event({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "plan" });
    expect(log.partials.at(-1)).toBe("kal ka plan");
    // The second turn finishes first; it waits for the first.
    sock.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "b", transcript: "WhatsApp pe bhej dena." });
    expect(log.finals).toHaveLength(0);
    sock.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "a", transcript: "Kal ka plan" });
    expect(log.finals.map((f) => f.text)).toEqual(["Kal ka plan", "WhatsApp pe bhej dena."]);
    expect(log.finals[0]!.timing).toEqual({ start: 0.2, duration: 1.5 });
  });

  it("on stop, commits the last words, waits for them, then closes cleanly", async () => {
    const { sock, log, engine } = harness();
    sock.emit("open");
    sock.event({ type: "session.updated" });
    engine.send(pcm16(new Array(1600).fill(500)));
    engine.close();
    expect(sock.sent.at(-1)).toEqual({ type: "input_audio_buffer.commit" });
    expect(sock.closedWith).toBeUndefined();
    sock.event({ type: "input_audio_buffer.committed", item_id: "z" });
    sock.event({ type: "conversation.item.input_audio_transcription.completed", item_id: "z", transcript: "Done." });
    await new Promise((r) => setTimeout(r, 10));
    expect(log.finals.map((f) => f.text)).toEqual(["Done."]);
    expect(sock.closedWith).toBe(1000);
    expect(log.closed).toEqual([undefined]);
  });

  it("an empty commit at the end is not an error, and a silent engine cannot hold the session open", async () => {
    const { sock, log, engine } = harness();
    sock.emit("open");
    sock.event({ type: "session.updated" });
    engine.send(pcm16(new Array(160).fill(0)));
    engine.close();
    sock.event({ type: "error", error: { code: "input_audio_buffer_commit_empty", message: "empty" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(log.errors).toEqual([]);
    expect(sock.closedWith).toBe(1000);

    const second = harness();
    second.sock.emit("open");
    second.sock.event({ type: "session.updated" });
    second.engine.send(pcm16(new Array(1600).fill(500)));
    second.engine.close();
    await new Promise((r) => setTimeout(r, 80));   // the flush deadline (50 ms here)
    expect(second.sock.closedWith).toBe(1000);
  });

  it("a real error reaches the route", () => {
    const { sock, log } = harness();
    sock.emit("open");
    sock.event({ type: "error", error: { code: "invalid_api_key", message: "Incorrect API key" } });
    expect(log.errors).toEqual(["Incorrect API key"]);
  });
});

// eslint-disable-next-line import/first
import { diarize } from "../src/notes/speakers.js";

describe("telling a note's speakers apart with OpenAI", () => {
  it("is used when Deepgram is not there, and numbers speakers in the order they speak", async () => {
    const real = globalThis.fetch;
    const seen: Array<{ url: string; body: FormData }> = [];
    globalThis.fetch = (async (url: string, init: { body: FormData }) => {
      seen.push({ url, body: init.body });
      return new Response(JSON.stringify({ segments: [
        { speaker: "B", start: 0, end: 2, text: "Let's start." },
        { speaker: "A", start: 2.5, end: 4, text: "Ready." },
        { speaker: "B", start: 4.2, end: 5, text: "" },
      ] }), { status: 200 });
    }) as never;
    try {
      const us = await diarize(Buffer.alloc(4096), "webm");
      expect(seen[0]!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(seen[0]!.body.get("model")).toBe("gpt-4o-transcribe-diarize");
      expect(seen[0]!.body.get("response_format")).toBe("diarized_json");
      expect(us).toEqual([
        { speaker: 0, start: 0, end: 2, text: "Let's start." },
        { speaker: 1, start: 2.5, end: 4, text: "Ready." },
      ]);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("a refusal leaves the live labels standing", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("too big", { status: 413 })) as never;
    try {
      expect(await diarize(Buffer.alloc(4096), "webm")).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
  });
});
