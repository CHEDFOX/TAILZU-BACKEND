import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
// DEMO_ENABLED deliberately unset: this file is about the default.

vi.mock("../src/pipeline/cleanup.js", () => ({
  assist: vi.fn(async (input: string) => `assisted:${input}`),
  clean: vi.fn(async (input: string) => `cleaned:${input}`),
  cleanBasic: vi.fn(async (input: string) => `basic:${input}`),
  cleanStream: async function* () { /* unused */ },
  draftReply: vi.fn(async () => "drafted"),
  inferStyle: vi.fn(async () => ({})),
  refineWithTone: vi.fn(async (input: string) => input),
  LLM_TONES: ["formal", "casual", "very-casual", "excited"],
  expandSnippets: (s: string) => s,
}));
vi.mock("../src/pipeline/stt.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/pipeline/stt.js")>();
  return { ...real, transcribe: vi.fn(async () => ({ text: "hey there", durationSeconds: 3 })) };
});

// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("the live demo is off unless someone turns it on", () => {
  // It is an unauthenticated route that spends real recogniser and model
  // calls. Turning it on is a decision about money and belongs in .env.
  it("answers 404 with no line in the env", async () => {
    const boundary = "----off";
    const res = await app.inject({
      method: "POST", url: "/v1/demo/transcribe",
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\n\r\nxx\r\n--${boundary}--\r\n`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("demo_off");
  });

  it("tells the page so, before it shows a microphone", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/site" });
    expect(res.json().demo).toBe(false);
  });
});
