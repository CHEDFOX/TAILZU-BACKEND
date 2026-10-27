/**
 * THE FRONT DOOR IN THE REAL SERVER (src/server.ts): POST /v1/ask is two routes in one path, and the switch decides which of them is there.
 *
 *   - the desktop's old ask ({ question, screenContent }) is as it always was, with the flag off or on, and keeps its 1 MB body;
 *   - a body with a `message` and no `question` is the front door's: 404 front_door_off while FRONT_DOOR is off, the front door's own
 *     checks (400) when it is on, and room for a picture's base64 in the body only while it is on;
 *   - the feedback route and the admin's view of the guards are there either way (the guards protect the brain whatever the switch says).
 *
 * The roads themselves are in front-routes.test.ts, with fakes; nothing here reaches a model or a network.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { noNetwork } from "./no-network.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
process.env.ADMIN_SECRET = "s3cret-admin-value-0123456789abcdef";
noNetwork();

const { buildApp } = await import("../src/server.js");
const { resetConfigForTests } = await import("../src/config.js");

const ADMIN = { "x-admin-secret": "s3cret-admin-value-0123456789abcdef" };
const MB = 1024 * 1024;
const open: FastifyInstance[] = [];

async function app(frontDoor: boolean): Promise<FastifyInstance> {
  if (frontDoor) process.env.FRONT_DOOR = "true"; else delete process.env.FRONT_DOOR;
  resetConfigForTests();
  const a = await buildApp();
  await a.ready();
  open.push(a);
  return a;
}
afterAll(async () => { for (const a of open) await a.close(); delete process.env.FRONT_DOOR; resetConfigForTests(); });

const BODY = { message: "what is the capital of France?", device: "web", mode: "text" };

describe("with the switch off", () => {
  it("answers a message 404 front_door_off, and leaves the old ask as it was", async () => {
    const a = await app(false);
    const front = await a.inject({ method: "POST", url: "/v1/ask", payload: BODY });
    expect(front.statusCode).toBe(404);
    expect(front.json()).toMatchObject({ code: "front_door_off" });
    // the old route: a body with neither is its own 400, a question is its own business
    const neither = await a.inject({ method: "POST", url: "/v1/ask", payload: {} });
    expect(neither.statusCode).toBe(400);
    expect(neither.json().message).toBe("Missing 'question'");
    const both = await a.inject({ method: "POST", url: "/v1/ask", payload: { question: "", message: "hello" } });
    expect(both.statusCode).toBe(400);
    expect(both.json().message).toBe("Missing 'question'");
  });

  it("keeps the 1 MB body limit for everyone", async () => {
    const a = await app(false);
    const big = await a.inject({ method: "POST", url: "/v1/ask", payload: { message: "x".repeat(MB + 1000), device: "web", mode: "text" } });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
  });

  it("has no feedback to take, and shows the guards to the admin only", async () => {
    const a = await app(false);
    const fb = await a.inject({ method: "POST", url: "/v1/ask/feedback", payload: { id: "11111111-1111-4111-8111-111111111111", outcome: "thumbs_up" } });
    expect(fb.statusCode).toBe(404);
    expect(fb.json()).toMatchObject({ code: "front_door_off" });
    expect((await a.inject({ method: "GET", url: "/v1/admin/guard" })).statusCode).toBe(401);
    const seen = await a.inject({ method: "GET", url: "/v1/admin/guard", headers: ADMIN });
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ frontDoor: false, open: 0, limiter: { active: 0 }, breakers: expect.any(Array) });
  });
});

describe("with the switch on", () => {
  it("checks a message before it asks anything: the device, the mode, the length", async () => {
    const a = await app(true);
    const noDevice = await a.inject({ method: "POST", url: "/v1/ask", payload: { message: "hello", mode: "text" } });
    expect(noDevice.statusCode).toBe(400);
    expect(noDevice.json()).toMatchObject({ code: "bad_request" });
    expect(noDevice.json().message).toContain("device");
    const long = await a.inject({ method: "POST", url: "/v1/ask", payload: { message: "x".repeat(9000), device: "web", mode: "text" } });
    expect(long.statusCode).toBe(413);
    expect(long.json()).toMatchObject({ code: "bad_request" });
  });

  it("takes a body bigger than 1 MB for a message (a picture's base64), and still refuses it for the old ask", async () => {
    const a = await app(true);
    // 1.5 MB reaches the front door's own checks (a message of 1.5 MB characters is its 413 in words), not the server's body limit
    const message = await a.inject({ method: "POST", url: "/v1/ask", payload: { message: "x".repeat(MB + MB / 2), device: "web", mode: "text" } });
    expect(message.statusCode).toBe(413);
    expect(message.json()).toMatchObject({ code: "bad_request" });
    expect(message.json().message).toContain("8000");
    // the old ask keeps its 1 MB, as a plain refusal
    const old = await a.inject({ method: "POST", url: "/v1/ask", payload: { question: "what is this?", screenContent: "x".repeat(MB + MB / 2) } });
    expect(old.statusCode).toBe(413);
    expect(old.json().message).toBe("Request body is too large");
  });

  it("is still the old ask for a question", async () => {
    const a = await app(true);
    const res = await a.inject({ method: "POST", url: "/v1/ask", payload: { question: "   " } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("Missing 'question'");
  });

  it("takes feedback only for an answer that is the person's own, and shows the guards with the door open", async () => {
    const a = await app(true);
    expect((await a.inject({ method: "POST", url: "/v1/ask/feedback", payload: { id: "11111111-1111-4111-8111-111111111111", outcome: "thumbs_up" } })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/v1/ask/feedback", payload: { id: "nope", outcome: "thumbs_up" } })).statusCode).toBe(400);
    const seen = await a.inject({ method: "GET", url: "/v1/admin/guard", headers: ADMIN });
    expect(seen.json()).toMatchObject({ frontDoor: true });
  });
});
