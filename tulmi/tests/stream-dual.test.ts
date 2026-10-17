/**
 * Two engines, one cursor: nothing is typed twice.
 *
 * Every client appends each final it is sent. The stream used to "correct"
 * the cursor by sending the second engine's whole line as one more final, and
 * when that engine took the lead mid-sentence it sent its reading of audio the
 * first had already typed. Both put the sentence at the cursor twice, and the
 * refine step was handed it twice.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

type H = { onReady(): void; onPartial(t: string): void; onFinal(t: string): void; onError(m: string): void; onClose(c?: number): void };
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

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("the dual live stream", () => {
  it("types each stretch of speech once, and hands the whole line over in done", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
    const got: Array<Record<string, unknown>> = [];
    ws.on("message", (d) => got.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000 }));
    await tick(); await tick();

    // The primary types its reading of the first stretch.
    engines.primary!.onFinal("mujhe kal jaldi");
    // The shadow's reading of the SAME stretch comes back in Devanagari and
    // takes the lead. Those words are already at the cursor.
    engines.shadow!.onFinal("मुझे कल जल्दी");
    // From here the shadow is watched; the primary's next stretch is not typed.
    engines.primary!.onFinal("uthna hai");
    engines.shadow!.onFinal("उठना है");
    await tick();
    ws.send(JSON.stringify({ type: "stop" }));
    await tick(); await tick();

    const finals = got.filter((m) => m.type === "final" && m.text).map((m) => m.text);
    expect(finals).toEqual(["mujhe kal jaldi", "उठना है"]);
    // The whole line in a reading the cursor does not hold, for the refine
    // step to reconcile. Readings in two scripts are never candidates to each
    // other (isUsableAlternative), so it is the full line in the cursor's.
    const done = got.find((m) => m.type === "done");
    expect(done?.alternative).toBe("mujhe kal jaldi uthna hai");
    ws.close();
  });
});
