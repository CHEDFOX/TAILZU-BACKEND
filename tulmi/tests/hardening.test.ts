/**
 * The server's own edges: what a failure says, what an HTML page carries,
 * how fast an admin secret can be guessed, what a client-sent personality may
 * put in a prompt, and which model routes sit behind the quota.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ADMIN = "hardening-admin-secret-0123456789abcdef";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tailzu-hardening-media-"));
process.env.CONTROL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tailzu-hardening-control-"));
process.env.ADMIN_SECRET = ADMIN;
// Small, so a limit can be reached in a test. Per route, per address.
process.env.RATE_LIMIT_MAX = "4";

vi.mock("../src/pipeline/cleanup.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assist: vi.fn(async (s: string) => `assisted:${s}`),
  updateStylePortrait: vi.fn(async () => ({ core: "c" })),
  portraitFromTranscript: vi.fn(async () => ({ core: "c" })),
  converseTurn: vi.fn(async () => "Go on."),
}));

/** What enforceQuota answers; null lets the request through. */
let quota: string | null = null;
vi.mock("../src/usage/metering.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceQuota: vi.fn(async () => quota),
}));

const { buildApp } = await import("../src/server.js");
const cleanup = await import("../src/pipeline/cleanup.js");

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  app.get("/test/boom", async () => {
    throw new Error("EACCES: permission denied, open '/data/control/control.json'");
  });
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("what a failure tells the caller", () => {
  it("a 5xx says something failed, never what", async () => {
    const res = await app.inject({ method: "GET", url: "/test/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/EACCES|\/data\/|control\.json|at .*\.ts/);
    expect(res.json().code).toBe("internal");
  });

  it("a 4xx keeps the message written for the caller", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/refine", payload: "{not json", headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().message).toBe("string");
  });
});

describe("HTML pages", () => {
  it("cannot be framed or content-sniffed", async () => {
    // The callback page with the state a sign-in the app started carries —
    // without one it refuses (tests/demo.test.ts), headers and all.
    const callback = `/auth/callback?state=${"s".repeat(43)}`;
    for (const url of ["/privacy", "/terms", "/pay", "/faq", callback, "/admin"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["x-frame-options"], url).toBe("DENY");
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      expect(res.headers["referrer-policy"], url).toBeTruthy();
    }
    // The callback page's own, stricter referrer policy is kept.
    expect((await app.inject({ method: "GET", url: "/auth/callback" })).headers["referrer-policy"]).toBe("no-referrer");
  });

  it("leaves JSON alone", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });
});

describe("the admin secret cannot be guessed at line rate", () => {
  const spend = async (method: "GET" | "POST", url: string, headers: Record<string, string>) => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await app.inject({ method, url, headers })).statusCode);
    return codes;
  };

  it("on the media processing routes, which carried no limit", async () => {
    for (const url of ["/v1/media/compress", "/v1/media/retime"]) {
      const codes = await spend("POST", url, { "x-admin-secret": "guess" });
      expect(codes.slice(0, 4), url).toEqual([401, 401, 401, 401]);
      expect(codes.slice(4), url).toEqual([429, 429]);
    }
  });

  it("on /v1/site's admin preview, without ever counting a visitor", async () => {
    expect(await spend("GET", "/v1/site", {})).toEqual([200, 200, 200, 200, 200, 200]);
    const guessed = await spend("GET", "/v1/site", { "x-admin-secret": "guess" });
    expect(guessed.slice(4)).toEqual([429, 429]);
  });

  it("refuses a near miss exactly like a wild guess", async () => {
    const near = await app.inject({ method: "GET", url: "/v1/media/list", headers: { "x-admin-secret": ADMIN.slice(0, -1) } });
    expect(near.statusCode).toBe(401);
    const right = await app.inject({ method: "GET", url: "/v1/media/list", headers: { "x-admin-secret": ADMIN } });
    expect(right.statusCode).toBe(200);
  });
});

describe("an admin upload cannot become a page on this origin", () => {
  it("stores a declared text/html file under .bin", async () => {
    const boundary = "----tailzu-hardening";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.html"\r\n` +
      `Content-Type: text/html\r\n\r\n<script>alert(1)</script>\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: "POST", url: "/v1/media/upload?key=hardening.html", payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "x-admin-secret": ADMIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/\.bin$/);
  });
});

describe("a personality the client sends", () => {
  const long = "x".repeat(10_001);

  it("is held to the same ceilings as a saved one", async () => {
    const over = await app.inject({
      method: "POST", url: "/v1/refine", payload: { text: "hi", personality: { customInstructions: long } },
    });
    expect(over.statusCode).toBe(413);
    const bad = await app.inject({
      method: "POST", url: "/v1/draft", payload: { intent: "reply", personality: { languages: "en" } },
    });
    expect(bad.statusCode).toBe(400);
    const saved = await app.inject({ method: "PUT", url: "/v1/personality", payload: { snippets: long } });
    expect(saved.statusCode).toBe(413);
  });

  it("is still used when it is within them", async () => {
    const ok = await app.inject({
      method: "POST", url: "/v1/refine/none", payload: { text: "hi" },
    });
    expect(ok.statusCode).toBe(200);
    const withOverride = await app.inject({
      method: "POST", url: "/v1/refine", payload: { text: "hi", personality: { languages: ["EN", 3, "hi"] } },
    });
    expect(withOverride.statusCode).toBe(200);
  });
});

describe("every model route sits behind the quota", () => {
  it("training's pick and portrait refuse an account past its allowance", async () => {
    quota = "You've used your 800 words this month.";
    try {
      const pick = await app.inject({ method: "POST", url: "/v1/train/pick", payload: { input: "a", chosen: "b" } });
      expect(pick.statusCode).toBe(429);
      expect(pick.json().code).toBe("quota_exceeded");
      const portrait = await app.inject({
        method: "POST", url: "/v1/train/portrait", payload: { turns: [{ role: "user", text: "hello" }] },
      });
      expect(portrait.statusCode).toBe(429);
    } finally {
      quota = null;
    }
  });
});

describe("a one-shot clip", () => {
  it("is refused past the live route's fifteen minutes, before any recogniser runs", async () => {
    // Sixteen real minutes of 8 kHz 8-bit mono (7.7 MB). It used to be a
    // header CLAIMING sixteen minutes over a few bytes — but a header's length
    // is not believed past the bytes that arrived any more (a streamed WAV
    // writes the largest length there is), so the minutes have to be there.
    const dataSize = 16 * 60 * 8_000;
    const b = Buffer.alloc(44 + dataSize, 0x80);
    b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + dataSize, 4); b.write("WAVE", 8, "ascii");
    b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(8000, 24); b.writeUInt32LE(8_000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
    b.write("data", 36, "ascii"); b.writeUInt32LE(dataSize, 40);
    const boundary = "----tailzu-clip";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`),
      b,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: "POST", url: "/v1/transcribe-clean", payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("audio_too_long");
  });
});

describe("a training transcript", () => {
  it("reaches the model bounded as a whole, oldest turns first to go", async () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `${i} ${"x".repeat(1990)}` }));
    const res = await app.inject({ method: "POST", url: "/v1/train/converse", payload: { turns } });
    expect(res.statusCode).toBe(200);
    const sent = vi.mocked(cleanup.converseTurn).mock.calls.at(-1)![0] as Array<{ text: string }>;
    expect(sent.reduce((n, t) => n + t.text.length, 0)).toBeLessThanOrEqual(40_000);
    expect(sent.at(-1)!.text.startsWith("29 ")).toBe(true);
  });
});
