/**
 * The live socket's control frames, at their edges: a second `start`, a
 * declared audio format nobody sends, and frames that are JSON but not an
 * object. Each used to be a way to leave a paid engine session running, meter
 * speech as nothing, or throw inside a handler nothing awaits.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

type Opts = { sampleRate: number; channels: number };
type H = { onReady(): void; onClose(c?: number): void };
const opened: Opts[] = [];

vi.mock("../src/routes/live-engines.js", () => ({
  liveEngineConfigured: () => true,
  openLiveEngine: (o: Opts, h: H) => {
    opened.push(o);
    setTimeout(() => h.onReady(), 0);
    return { label: "test:primary", send: () => {}, close: () => setTimeout(() => h.onClose(), 0) };
  },
  openShadowEngine: () => null,
}));

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
beforeEach(() => { opened.length = 0; });

const tick = () => new Promise((r) => setTimeout(r, 30));

async function open(): Promise<{ ws: WebSocket; got: Array<Record<string, unknown>> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
  const got: Array<Record<string, unknown>> = [];
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));
  return { ws, got };
}

describe("the live socket's control frames", () => {
  it("opens one engine however many times start is sent", async () => {
    const { ws, got } = await open();
    const start = JSON.stringify({ type: "start", token: "t", sampleRate: 16000 });
    ws.send(start); ws.send(start); ws.send(start);
    await tick(); await tick();
    expect(opened.length).toBe(1);
    expect(got.filter((m) => m.type === "ready").length).toBe(1);
    ws.close();
  });

  it("clamps a declared format to what an engine can hear", async () => {
    for (const [sent, want] of [
      [{ sampleRate: 1e9, channels: 7 }, { sampleRate: 48000, channels: 2 }],
      [{ sampleRate: 10, channels: 0 }, { sampleRate: 8000, channels: 1 }],
      [{ sampleRate: "fast" }, { sampleRate: 16000, channels: 1 }],
      [{}, { sampleRate: 16000, channels: 1 }],
    ] as const) {
      opened.length = 0;
      const { ws } = await open();
      ws.send(JSON.stringify({ type: "start", token: "t", ...sent }));
      await tick();
      expect(opened[0]).toEqual(want);
      ws.close();
    }
  });

  it("closes on a frame far larger than any client sends, before buffering it", async () => {
    const { ws } = await open();
    const code = new Promise<number>((r) => ws.once("close", (c) => r(c)));
    ws.send(Buffer.alloc(5 * 1024 * 1024));
    expect(await code).toBe(1009); // "message too big"
  });

  it("shrugs off frames that are JSON but not a message", async () => {
    const { ws, got } = await open();
    for (const f of ["null", "42", '"start"', "[]"]) ws.send(f);
    ws.send(JSON.stringify({ type: "start", token: "t" }));
    await tick(); await tick();
    expect(got.some((m) => m.type === "ready")).toBe(true);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
