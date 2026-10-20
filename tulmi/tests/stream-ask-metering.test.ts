/**
 * A question to Ask, spoken over the live stream, is metered as Ask is.
 *
 * Ask's questions record on the live stream so their partials can ring a
 * button while the person is still talking. The stream route billed every
 * socket as dictation, so a question spent the month's word allowance as if
 * its words had been written somewhere. The recorder marks a question's
 * start message with purpose "ask": its audio is then metered under the
 * "agent" source with no words, the way an Ask step that carries the audio
 * itself always was.
 *
 * A question is also held to what a question is, or "ask" would make any
 * stream free transcription: the socket ends at AGENT_STREAM_MAX_SECONDS,
 * and its start is checked against Ask's own monthly seconds.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { pcm16, speechClip } from "./audio-fixtures.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
process.env.AGENT_STREAM_MAX_SECONDS = "2";

type Timing = { start: number; duration: number };
type H = { onReady(): void; onFinal(t: string, timing?: Timing): void; onClose(c?: number): void };
const engines: { primary?: H; heard: number } = { heard: 0 };

vi.mock("../src/routes/live-engines.js", () => ({
  liveEngineConfigured: () => true,
  openLiveEngine: (_o: unknown, h: H) => {
    engines.primary = h;
    engines.heard = 0;
    setTimeout(() => h.onReady(), 0);
    return {
      label: "test:primary",
      send: (b: Buffer) => { engines.heard += b.length; },
      close: () => setTimeout(() => h.onClose(), 0),
    };
  },
  openShadowEngine: () => ({ label: "test:shadow", send: () => {}, close: () => {} }),
}));

const metered: Array<{ source: string; words: number; audioSeconds: number }> = [];
const quotaAsked: Array<{ agentAudio?: boolean } | undefined> = [];
vi.mock("../src/usage/metering.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/usage/metering.js")>();
  return {
    ...real,
    recordUsage: async (u: { source: string; words: number; audioSeconds: number }) => {
      metered.push({ source: u.source, words: u.words, audioSeconds: u.audioSeconds });
    },
    enforceQuota: async (...args: Parameters<typeof real.enforceQuota>) => {
      quotaAsked.push(args[1]);
      return real.enforceQuota(...args);
    },
  };
});

const { buildApp } = await import("../src/server.js");

let app: FastifyInstance;
let port: number;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
});
afterAll(async () => { await app.close(); });

const tick = () => new Promise((r) => setTimeout(r, 25));

/** One socket: start (with whatever extra the start message carries), some
 *  speech, a final, stop, and the meter's one line for it. */
async function speak(extra: Record<string, unknown>) {
  const before = metered.length;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000, ...extra }));
  await tick(); await tick();
  const audio = pcm16(speechClip());
  for (let i = 0; i < audio.length; i += 3200) ws.send(audio.subarray(i, i + 3200));
  await tick();
  engines.primary!.onFinal("where is the export button", { start: 0.1, duration: 1.2 });
  await tick();
  ws.send(JSON.stringify({ type: "stop" }));
  for (let i = 0; i < 40 && metered.length === before; i++) await tick();
  ws.close();
  return metered.slice(before);
}

describe("metering a live stream", () => {
  it("a question is Ask's: its audio, no words", async () => {
    const got = await speak({ purpose: "ask" });
    expect(got).toHaveLength(1);
    expect(got[0].source).toBe("agent");
    expect(got[0].words).toBe(0);
    expect(got[0].audioSeconds).toBeGreaterThan(0);
  });

  it("dictation is metered as it always was", async () => {
    const got = await speak({});
    expect(got).toHaveLength(1);
    expect(got[0].source).toBe("stream");
    expect(got[0].words).toBeGreaterThan(0);
  });

  it("any other purpose is dictation", async () => {
    const got = await speak({ purpose: "ASK " });
    expect(got[0].source).toBe("stream");
  });

  it("a question's start is checked against Ask's own seconds; dictation's is not", async () => {
    quotaAsked.length = 0;
    await speak({ purpose: "ask" });
    await speak({});
    expect(quotaAsked).toEqual([{ agentAudio: true }, { agentAudio: false }]);
  });
});

/** A socket that streams `seconds` of speech and never says stop: what the
 *  client was sent, what the engine heard and what was metered. */
async function runOn(extra: Record<string, unknown>, seconds: number) {
  const before = metered.length;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
  const got: Array<{ type: string; text?: string }> = [];
  ws.on("message", (m) => got.push(JSON.parse(String(m))));
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000, ...extra }));
  await tick(); await tick();
  const audio = pcm16(speechClip());
  for (let sent = 0; sent < seconds; sent += 1.4) {
    for (let i = 0; i < audio.length; i += 3200) ws.send(audio.subarray(i, i + 3200));
    await tick();
    engines.primary!.onFinal("and more words", { start: sent, duration: 1.2 });
    await tick();
  }
  for (let i = 0; i < 10 && !got.some((g) => g.type === "done"); i++) await tick();
  const heard = engines.heard / (16000 * 2);
  ws.close();
  for (let i = 0; i < 40 && metered.length === before; i++) await tick();
  return { got, heard, metered: metered.slice(before) };
}

describe("a question is short", () => {
  it("an ask stream ends at AGENT_STREAM_MAX_SECONDS, with what it heard, then done", async () => {
    const { got, heard, metered: m } = await runOn({ purpose: "ask" }, 6);
    expect(got.at(-1)).toEqual({ type: "done" });
    expect(got.some((g) => g.type === "final" && g.text)).toBe(true);
    // Nothing past the cap reaches the engine, or the meter.
    expect(heard).toBeLessThanOrEqual(2);
    expect(m).toHaveLength(1);
    expect(m[0].audioSeconds).toBeLessThanOrEqual(2);
  });

  it("dictation is not held to it", async () => {
    const { got, heard, metered: m } = await runOn({}, 6);
    expect(got.some((g) => g.type === "done")).toBe(false);
    expect(heard).toBeGreaterThan(5);
    expect(m[0].audioSeconds).toBeGreaterThan(5);
  });
});
