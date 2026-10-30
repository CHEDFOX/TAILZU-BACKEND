/**
 * The live channel as the server runs it: a Keylessbord setting saved on one device reaches the other device's socket as a "keybot"
 * event, through server.ts's own wiring (routes/live.ts, live/writes.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

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

describe("WS /v1/live in the server", () => {
  it("hears a write made over HTTP, after its response", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/live`);
    const got: Array<Record<string, unknown>> = [];
    ws.on("message", (d) => got.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "auth", token: "dev" }));
    const end = Date.now() + 3000;
    while (!got.some((m) => m.type === "ready") && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(got[0]?.type).toBe("ready");

    const res = await app.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: { authorization: "Bearer dev" }, payload: { keyboard: { height: "tall" } } });
    expect(res.statusCode).toBeLessThan(300);
    while (!got.some((m) => m.type === "event") && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(got.filter((m) => m.type === "event").map((m) => m.topic)).toContain("keybot");
    ws.close();
  });
});
