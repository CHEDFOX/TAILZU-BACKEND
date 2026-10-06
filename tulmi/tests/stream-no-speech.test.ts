/**
 * No speech in, no text out — on the live stream too.
 *
 * Finals used to be trusted outright, on the theory that the engine's own
 * voice detection had gated them already. It gates on sound: a breath or a
 * cough between two sentences committed as "Thank you." and went to the
 * cursor. Each final is now judged against the voice measured in its own
 * window of the audio the socket received.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { breathClip, pcm16, speechClip } from "./audio-fixtures.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

type Timing = { start: number; duration: number };
type H = { onReady(): void; onFinal(t: string, timing?: Timing): void; onClose(c?: number): void };
const engines: { primary?: H; shadow?: H } = {};

vi.mock("../src/routes/live-engines.js", () => ({
  liveEngineConfigured: () => true,
  openLiveEngine: (_o: unknown, h: H) => {
    engines.primary = h;
    setTimeout(() => h.onReady(), 0);
    return { label: "test:primary", send: () => {}, close: () => setTimeout(() => h.onClose(), 0) };
  },
  openShadowEngine: (_o: unknown, h: H) => {
    engines.shadow = h;
    return { label: "test:shadow", send: () => {}, close: () => {} };
  },
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

const tick = () => new Promise((r) => setTimeout(r, 25));

async function session() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
  const got: Array<Record<string, unknown>> = [];
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000 }));
  await tick(); await tick();
  const send = async (audio: Buffer) => {
    for (let i = 0; i < audio.length; i += 3200) ws.send(audio.subarray(i, i + 3200));
    await tick();
  };
  return { ws, got, send };
}

describe("the live stream's finals", () => {
  it("a breath between sentences commits nothing, whatever the engine wrote", async () => {
    const { ws, got, send } = await session();
    await send(pcm16(breathClip()));                                 // 0.0–1.2 s
    engines.primary!.onFinal("Thank you.", { start: 0, duration: 1.2 });
    await send(pcm16(speechClip()));                                 // 1.2–2.6 s
    engines.primary!.onFinal("thank you", { start: 1.3, duration: 1.1 });
    await tick();
    const finals = got.filter((m) => m.type === "final").map((m) => m.text);
    // The first final is still SENT, empty, so the client clears its partial.
    expect(finals).toEqual(["", "thank you"]);
    ws.close();
  });

  it("judges an engine that gives no timing on everything since its last final", async () => {
    const { ws, got, send } = await session();
    await send(pcm16(breathClip()));
    engines.primary!.onFinal("जिंदगी में.");
    await send(pcm16(speechClip()));
    engines.primary!.onFinal("kal milte hain");
    await tick();
    expect(got.filter((m) => m.type === "final").map((m) => m.text)).toEqual(["", "kal milte hain"]);
    ws.close();
  });

  it("with no audio to measure, trusts the engine as it always did", async () => {
    const { ws, got } = await session();
    engines.primary!.onFinal("Okay.");
    await tick();
    expect(got.filter((m) => m.type === "final").map((m) => m.text)).toEqual(["Okay."]);
    ws.close();
  });
});
