/**
 * Sarvam, the engine that reads Indian languages, threw away every frame sent
 * before its socket opened — the first words of the sentence. It now holds
 * them and sends them, in order, once it is connected.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";

const frames: Array<Record<string, any>> = [];
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((r) => server.once("listening", r));
server.on("connection", (ws) => ws.on("message", (d) => frames.push(JSON.parse(String(d)))));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.DEEPGRAM_API_KEY = "k";
process.env.SARVAM_API_KEY = "k";
process.env.SARVAM_WS_URL = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const { openShadowEngine } = await import("../src/routes/live-engines.js");

beforeAll(() => { frames.length = 0; });
afterAll(() => new Promise<void>((r) => {
  for (const c of server.clients) c.terminate();
  server.close(() => r());
}));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noop = { onReady() {}, onPartial() {}, onFinal() {}, onError() {}, onClose() {} };

describe("the Sarvam engine", () => {
  it("sends what it heard before it connected, in order, after its start", async () => {
    const engine = openShadowEngine({ sampleRate: 16000, channels: 1 }, noop)!;
    expect(engine.label).toMatch(/^sarvam:/);
    // Sent before the socket can possibly be open.
    engine.send(Buffer.from("one"));
    engine.send(Buffer.from("two"));
    await wait(150);
    engine.send(Buffer.from("three"));
    await wait(50);
    expect(frames[0]!.event).toBe("start");
    expect(frames.slice(1).map((f) => Buffer.from(f.audio.data, "base64").toString())).toEqual(["one", "two", "three"]);
    engine.close();
    await wait(400);
  });

  it("stopped before it connected, still sends what it held, then stops", async () => {
    frames.length = 0;
    const engine = openShadowEngine({ sampleRate: 16000, channels: 1 }, noop)!;
    engine.send(Buffer.from("quick"));
    engine.close();
    await wait(150);
    expect(frames.map((f) => f.event)).toEqual(["start", "audio", "stop"]);
  });
});
