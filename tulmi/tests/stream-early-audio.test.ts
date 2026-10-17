/**
 * The first words of a dictation arrive while the session is still being
 * verified. The keyboard streams the moment the socket opens, right behind
 * `start`, and the sign-in check is a round trip — slowest on the first
 * dictation after a pause. Those frames were dropped, so a first dictation
 * lost its opening words and the same sentence said again came through whole.
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

type H = { onReady(): void; onClose(c?: number): void };
const heard: string[] = [];
const opened: Array<{ sampleRate: number; channels: number; prompt?: string }> = [];

vi.mock("../src/routes/live-engines.js", () => ({
  liveEngineConfigured: () => true,
  openLiveEngine: (o: { sampleRate: number; channels: number; prompt?: string }, h: H) => {
    opened.push(o);
    setTimeout(() => h.onReady(), 0);
    return { label: "test:primary", send: (b: Buffer) => heard.push(b.toString()), close: () => setTimeout(() => h.onClose(), 0) };
  },
  openShadowEngine: () => null,
}));

// A sign-in check that takes as long as a real first one can.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    resolveUser: async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { id: "11111111-2222-3333-4444-555555555555", token: "t" };
    },
  };
});

// A Gujarati speaker, with a word of their own.
vi.mock("../src/personality/store.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getPersonality: async () => ({ languages: ["gu", "en"], vocabulary: "Tailzu" }) };
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
beforeEach(() => { heard.length = 0; opened.length = 0; });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function open(): Promise<{ ws: WebSocket; got: Array<Record<string, unknown>> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
  const got: Array<Record<string, unknown>> = [];
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));
  return { ws, got };
}

describe("audio sent while the session is being verified", () => {
  it("reaches the engine, in the order it was said", async () => {
    const { ws, got } = await open();
    ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000 }));
    // Straight behind start, as the Android keyboard sends it.
    for (const w of ["kal", "subah", "milte"]) ws.send(Buffer.from(w));
    await wait(250);
    expect(got.some((m) => m.type === "ready")).toBe(true);
    ws.send(Buffer.from("hain"));
    await wait(50);
    expect(heard).toEqual(["kal", "subah", "milte", "hain"]);
    ws.close();
  });

  it("is still refused before any start", async () => {
    const { ws } = await open();
    ws.send(Buffer.from("nobody-asked"));
    await wait(20);
    ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000 }));
    await wait(250);
    ws.send(Buffer.from("after"));
    await wait(50);
    expect(heard).toEqual(["after"]);
    ws.close();
  });

  it("tells the recognizer who is talking: their languages and their words", async () => {
    const { ws } = await open();
    ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000 }));
    await wait(250);
    expect(opened[0]!.prompt).toContain("હા, કાલે સવારે મળીએ.");
    expect(opened[0]!.prompt).toContain("Tailzu");
    ws.close();
  });
});
