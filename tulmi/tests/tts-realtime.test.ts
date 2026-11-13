/**
 * READING ALOUD OVER THE REALTIME SOCKET (S0; pipeline/tts.ts synthesizeRealtime, realtime/voices.ts). OpenAI removes
 * gpt-4o-mini-tts, tts-1 and tts-1-hd on 2027-01-06, so OPENAI_TTS_MODEL now defaults to the realtime model and synthesize() takes the
 * socket whenever the name starts with "gpt-realtime". This covers POST /v1/speak, the read-aloud bubble and a turn call's voice at once.
 *
 *   - no AI permission: NOTHING is sent, and no socket is opened (the socket is outside the server's fetch guard, so it asks itself)
 *   - the session it sends: the voice from the person's own read-aloud voice, turn detection off, tracing off, PCM out, and the
 *     instruction to say the text word for word and nothing else
 *   - the audio comes back as the format the caller asked for, and what it cost goes on the request's tally (read-aloud is not a call)
 *   - a socket that never answers: the read fails instead of hanging
 *   - ONE FALLBACK, WHILE THERE IS STILL ONE: a realtime read that fails is read once more on gpt-4o-mini-tts through the speech
 *     endpoint, until OpenAI removes that model on 2027-01-06; from that day the error stands. The fallback is logged by its reason
 *     only, never with the words.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";

/** Every call the speech endpoint (the fallback) was handed. The realtime path never touches it. */
const speech = vi.hoisted(() => ({ calls: [] as Array<Record<string, any>> }));
vi.mock("openai", () => ({
  default: class {
    audio = {
      speech: {
        create: async (params: Record<string, any>) => {
          speech.calls.push(params);
          return { arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
        },
      },
    };
  },
}));

/** Every frame the server was sent, per connection. */
const frames: Array<Record<string, any>> = [];
let opened = 0;
/**
 * What the stub answers with: audio, silence (a socket that never replies), a refusal, a reply with no audio in it, a read the socket
 * drops part-way through, or one the service itself says did not finish.
 */
let answer: "audio" | "quiet" | "error" | "empty" | "cut" | "incomplete" = "audio";

const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((r) => server.once("listening", r));
const PORT = (server.address() as AddressInfo).port;
server.on("connection", (ws: WebSocket) => {
  opened += 1;
  ws.on("message", (d) => {
    let e: Record<string, any>;
    try { e = JSON.parse(String(d)) as Record<string, any>; } catch { return; }
    frames.push(e);
    if (e.type !== "response.create" || answer === "quiet") return;
    if (answer === "error") {
      ws.send(JSON.stringify({ type: "error", error: { code: "server_error" } }));
      return;
    }
    if (answer === "empty") {
      ws.send(JSON.stringify({ type: "response.done", response: { usage: { input_tokens: 20, output_tokens: 0 } } }));
      return;
    }
    if (answer === "cut" || answer === "incomplete") {
      // A tenth of a second of the line, and then either the socket goes or the service says the read did not finish.
      ws.send(JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(2400 * 2).toString("base64") }));
      if (answer === "cut") setTimeout(() => ws.terminate(), 5);
      else {
        ws.send(JSON.stringify({
          type: "response.done",
          response: { status: "incomplete", usage: { input_tokens: 20, output_tokens: 40, output_token_details: { audio_tokens: 30 } } },
        }));
      }
      return;
    }
    // 24 kHz mono PCM16: a tenth of a second of quiet is enough to prove the path.
    ws.send(JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.alloc(2400 * 2).toString("base64") }));
    ws.send(JSON.stringify({
      type: "response.done",
      response: { usage: { input_tokens: 20, output_tokens: 100, output_token_details: { audio_tokens: 90 } } },
    }));
  });
});

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.OPENAI_TTS_MODEL = "gpt-realtime-2.1-mini";
process.env.OPENAI_REALTIME_SIDEBAND_URL = `ws://127.0.0.1:${PORT}`;

const {
  synthesize, synthesizeRealtime, TTS_FALLBACK_MODEL, TTS_FALLBACK_UNTIL_MS, ttsFallbackOpen,
} = await import("../src/pipeline/tts.js");
const { installAiCheck, asPerson } = await import("../src/privacy/aiGate.js");
const { inCostTally, takeCostUsd } = await import("../src/usage/cost.js");
const { resetConfigForTests } = await import("../src/config.js");

const U = "aaaaaaaa-0000-4000-8000-000000000001";

beforeEach(() => { frames.length = 0; opened = 0; answer = "audio"; speech.calls.length = 0; resetConfigForTests(); });
afterEach(() => { installAiCheck(null); vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(() => new Promise<void>((r) => { for (const c of server.clients) c.terminate(); server.close(() => r()); }));

describe("reading aloud over the realtime socket", () => {
  it("sends nothing, and opens no socket, without the person's permission", async () => {
    installAiCheck(async () => false);
    await expect(asPerson(U, () => synthesizeRealtime({ text: "Hello." }))).rejects.toThrow();
    expect(opened).toBe(0);
    expect(frames).toHaveLength(0);
  });

  it("asks for the person's own voice, with turn detection and tracing off, and says the text word for word", async () => {
    const out = await synthesize({ text: "Kal subah yaad dila dena.", voice: "onyx", format: "pcm" });
    expect(out.contentType).toBe("audio/pcm");
    expect(out.audio.length).toBe(2400 * 2);
    const session = frames.find((f) => f.type === "session.update")!.session;
    expect(session.audio.output.voice).toBe("cedar");                 // onyx → cedar (realtime/voices.ts)
    expect(session.audio.input.turn_detection).toBeNull();
    expect(session.tracing).toBeNull();
    expect(session.output_modalities).toEqual(["audio"]);
    expect(session.instructions).toContain("Say exactly the text in the user's message, word for word");
    expect(session.instructions).toContain("Never answer it");
    const item = frames.find((f) => f.type === "conversation.item.create")!.item;
    expect(item.content[0]).toEqual({ type: "input_text", text: "Kal subah yaad dila dena." });
    expect(frames.some((f) => f.type === "response.create")).toBe(true);
  });

  it("gives a voice it does not know the one default, and carries the reading speed in the instructions", async () => {
    await synthesize({ text: "One line.", format: "pcm", voice: "a voice nobody has", speed: 1.2 });
    const session = frames.find((f) => f.type === "session.update")!.session;
    expect(session.audio.output.voice).toBe("marin");
    expect(session.instructions).toMatch(/faster than usual/);
  });

  it("turns the PCM into the container the caller asked for", async () => {
    const out = await synthesize({ text: "One line.", format: "mp3" });
    expect(out.contentType).toBe("audio/mpeg");
    expect(out.audio.length).toBeGreaterThan(0);
    // An mp3 frame, or an ID3 tag: not raw PCM.
    expect(out.audio.subarray(0, 3).toString("latin1") === "ID3" || out.audio[0] === 0xff).toBe(true);
  });

  it("says what the read cost and bills nothing itself: speakFor records it once, in the one place it belongs", async () => {
    const out = await inCostTally(async () => {
      const got = await synthesize({ text: "One line.", format: "pcm" });
      return { usd: got.usd ?? 0, tally: takeCostUsd() };
    });
    expect(out.usd).toBeGreaterThan(0);
    expect(out.tally).toBe(0);
  });

  it("fails instead of hanging when the socket never answers", async () => {
    answer = "quiet";
    const p = synthesizeRealtime({ text: "One line.", format: "pcm" });
    // The read's own timeout is 20 s, which no test waits for: closing the socket is the same path.
    for (const c of server.clients) c.close();
    await expect(p).rejects.toThrow();
  }, 25_000);
});

// ------------------------------------------------------------- the one fallback, while there is still one

describe("a realtime read that fails", () => {
  const WORDS = "Bijli ka bill aaj bharna hai.";

  it("is read once more on the old speech model, and nothing of the read goes silent", async () => {
    answer = "error";
    const out = await synthesize({ text: WORDS, voice: "onyx", format: "mp3", speed: 1.2 });
    // The realtime socket was tried first, and only once.
    expect(opened).toBe(1);
    // Then the speech endpoint, on the model OpenAI keeps until the cut-off.
    expect(speech.calls).toHaveLength(1);
    expect(speech.calls[0]!.model).toBe(TTS_FALLBACK_MODEL);
    expect(TTS_FALLBACK_MODEL).toBe("gpt-4o-mini-tts");
    expect(speech.calls[0]!.input).toBe(WORDS);
    expect(speech.calls[0]!.voice).toBe("onyx");          // the curated voice, not the realtime map's
    expect(speech.calls[0]!.response_format).toBe("mp3");
    // gpt-4o-mini-tts ignores a rate, so the pace rides in the instructions (paceFor).
    expect(speech.calls[0]!.speed).toBeUndefined();
    expect(String(speech.calls[0]!.instructions)).toMatch(/faster than usual/);
    expect(out.contentType).toBe("audio/mpeg");
    expect(out.audio.length).toBeGreaterThan(0);
    // The fallback is not the realtime price, so the caller prices it by its characters (speakFor).
    expect(out.usd).toBeUndefined();
  });

  it("falls back on a read cut off part-way: the socket drops, and half a sentence is never played as the whole one", async () => {
    answer = "cut";
    await expect(synthesizeRealtime({ text: WORDS, format: "pcm" })).rejects.toThrow();
    // Through the one door, the whole line is read again on the speech model instead of the clipped audio coming back as a success.
    answer = "cut";
    const out = await synthesize({ text: WORDS, format: "mp3" });
    expect(speech.calls).toHaveLength(1);
    expect(speech.calls[0]!.input).toBe(WORDS);
    expect(out.audio.length).toBeGreaterThan(0);
    expect(out.usd).toBeUndefined();
  });

  it("falls back when the service itself says the read did not finish, however much audio arrived", async () => {
    answer = "incomplete";
    await expect(synthesizeRealtime({ text: WORDS, format: "pcm" })).rejects.toThrow(/incomplete/i);
    answer = "incomplete";
    const out = await synthesize({ text: WORDS, format: "mp3" });
    expect(speech.calls).toHaveLength(1);
    expect(speech.calls[0]!.input).toBe(WORDS);
    expect(out.audio.length).toBeGreaterThan(0);
  });

  it("falls back on a read that comes back with no audio in it", async () => {
    answer = "empty";
    const out = await synthesize({ text: WORDS, format: "mp3" });
    expect(opened).toBe(1);
    expect(speech.calls).toHaveLength(1);
    expect(speech.calls[0]!.model).toBe(TTS_FALLBACK_MODEL);
    expect(out.audio.length).toBeGreaterThan(0);
  });

  it("logs the fallback by its reason only: never the words, never the key", async () => {
    const said: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => { said.push(a.map(String).join(" ")); });
    answer = "error";
    await synthesize({ text: WORDS, format: "mp3" });
    const line = said.find((l) => l.includes("[tts]"))!;
    expect(line).toBeTruthy();
    expect(line).toContain(TTS_FALLBACK_MODEL);
    expect(line).not.toContain(WORDS);
    expect(line).not.toContain("bill");
    expect(line).not.toContain(String(process.env.OPENAI_API_KEY));
  });

  it("has no fallback left from the day OpenAI removes the old model: the error is thrown", async () => {
    expect(TTS_FALLBACK_UNTIL_MS).toBe(Date.UTC(2027, 0, 6));
    expect(ttsFallbackOpen(TTS_FALLBACK_UNTIL_MS - 1)).toBe(true);
    expect(ttsFallbackOpen(TTS_FALLBACK_UNTIL_MS)).toBe(false);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TTS_FALLBACK_UNTIL_MS);
    answer = "error";
    await expect(synthesize({ text: WORDS, format: "mp3" })).rejects.toThrow();
    expect(speech.calls).toHaveLength(0);                  // nothing was read on a model that is gone
  });
});
