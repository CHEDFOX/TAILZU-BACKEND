import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
// A site dir that does not exist, so / has nothing to serve and must redirect.
process.env.SITE_DIR = "/tmp/tailzu-test-site-that-is-not-there";
process.env.DEMO_ENABLED = "true";
process.env.DEMO_MAX_SECONDS = "15";

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

// The recogniser answers the same thing whatever it is handed; the duration
// probe reads the WAV header for real so the length cap is exercised.
vi.mock("../src/pipeline/stt.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/pipeline/stt.js")>();
  return {
    ...real,
    transcribe: vi.fn(async () => ({ text: "hey there", durationSeconds: 3, script: "latin" })),
  };
});

// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { sitePage } from "../src/routes/demo.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

/** A PCM WAV of `seconds` at 16 kHz mono — enough header for the probe. */
function wav(seconds: number): Buffer {
  const byteRate = 16000 * 2;
  const dataSize = Math.round(byteRate * seconds);
  const b = Buffer.alloc(44 + dataSize);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + dataSize, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(byteRate, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(dataSize, 40);
  return b;
}

/** Hand-rolled multipart, the way the page really uploads. */
function multipart(blob: Buffer, filename: string): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----tailzu-demo-test";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, blob, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("the landing page", () => {
  it("sends / to /download until a site is published", async () => {
    // The apex must never be a blank page or a 404 — the one page that
    // already exists is the right answer until the site lands.
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/download");
  });

  it("hands the page every word it will show", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/site" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // NOTHING THE PAGE DOES NOT RENDER. The page has no headline, eyebrow,
    // lede or price any more — it argues by showing rather than by claiming.
    // A string here that renders nowhere is a claim nobody can check, so the
    // absence is the thing worth testing: adding one back means adding the
    // element that shows it.
    for (const dead of ["eyebrow", "headline", "lede", "price"]) {
      expect(body.copy[dead]).toBeUndefined();
    }
    // The river has to arrive with the page, and every case needs both sides:
    // a missing one puts a gap in a line that is meant never to break.
    expect(body.copy.cases.length).toBeGreaterThan(3);
    for (const c of body.copy.cases) {
      expect(c.said.length).toBeGreaterThan(0);
      expect(c.wrote.length).toBeGreaterThan(0);
      // A case whose two sides match demonstrates nothing.
      expect(c.wrote).not.toBe(c.said);
    }
    // The one line going the other way has to arrive with the page, and it
    // is set as text — an angle bracket in it would print, not render.
    expect(body.copy.identity.length).toBeGreaterThan(3);
    for (const line of body.copy.identity as string[]) {
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/[<>]/);
    }
    expect(typeof body.freeWords).toBe("number");
    expect(body.demo).toBe(true);
    expect(body.maxSeconds).toBe(15);
    // Installers are reported by presence, so an unpublished one shows as
    // "soon" rather than a dead link.
    expect(Object.keys(body.downloads).sort()).toEqual(["linux", "mac", "win"]);
    for (const v of Object.values(body.downloads)) expect(typeof v).toBe("boolean");
  });

  it("gives every claim a line it can actually mark", async () => {
    // The card strikes out `cut` and highlights `keep` by matching letters and
    // digits, lowercased. A word listed but absent from the line it belongs to
    // marks nothing — a silent animation that quietly stops making the claim.
    const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const res = await app.inject({ method: "GET", url: "/v1/site" });
    const steps = res.json().copy.steps as Array<{
      tab: string; note: string; said: string; wrote: string;
      pill: string; cut?: string[]; keep?: string[];
    }>;
    expect(steps.length).toBeGreaterThan(1);
    for (const s of steps) {
      for (const k of [s.tab, s.note, s.said, s.wrote, s.pill]) expect(k.length).toBeGreaterThan(0);
      expect(s.wrote).not.toBe(s.said);
      // The pill is copy, and copy is never markup: the page sets it as text.
      expect(s.pill).not.toMatch(/[<>]/);
      const inSaid = new Set(s.said.split(/\s+/).map(bare));
      for (const w of s.cut ?? []) expect(inSaid.has(bare(w))).toBe(true);
      // A kept word has to survive into the written line — that is the claim.
      const inWrote = new Set(s.wrote.split(/\s+/).map(bare));
      for (const w of s.keep ?? []) {
        expect(inSaid.has(bare(w))).toBe(true);
        expect(inWrote.has(bare(w))).toBe(true);
      }
      // A word cannot both go and stay.
      for (const w of s.cut ?? []) expect((s.keep ?? []).map(bare)).not.toContain(bare(w));
    }
  });
});

describe("the live demo", () => {
  it("writes a short clip clean, and remembers nothing", async () => {
    const { payload, headers } = multipart(wav(4), "clip.wav");
    const res = await app.inject({ method: "POST", url: "/v1/demo/transcribe", payload, headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transcript).toBe("hey there");
    expect(body.cleanedText).toBe("assisted:hey there");
    expect(typeof body.ms).toBe("number");
    // No account, no history: nothing in the response points at storage.
    expect(body.usage).toBeUndefined();
  });

  it("refuses a clip longer than the cap", async () => {
    // A pitch, not a dictation. Twenty seconds of WAV at 16 kHz is 640 KB —
    // under the byte cap — so this is the DURATION cap being exercised.
    const { payload, headers } = multipart(wav(20), "clip.wav");
    const res = await app.inject({ method: "POST", url: "/v1/demo/transcribe", payload, headers });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("too_long");
  });

  it("refuses a clip too big to be short, whatever the container", async () => {
    // webm cannot be measured, so bytes are the only guard that reaches it.
    const { payload, headers } = multipart(Buffer.alloc(900 * 1024), "clip.webm");
    const res = await app.inject({ method: "POST", url: "/v1/demo/transcribe", payload, headers });
    expect(res.statusCode).toBe(413);
  });

  it("asks for a file when none arrives", async () => {
    const boundary = "----empty";
    const res = await app.inject({
      method: "POST", url: "/v1/demo/transcribe",
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhi\r\n--${boundary}--\r\n`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("the published site wins over the built-in pages", () => {
  // /privacy, /terms and /download have lived in this repo as HTML strings
  // since before there was a site. Once a file of the same name is published
  // they become the fallback — which is what makes the whole site editable in
  // one place without the legal text ever being unreachable.
  const dir = "/tmp/tailzu-test-site-live";

  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "privacy.html"), "<!doctype html><title>published privacy</title>");
    fs.writeFileSync(path.join(dir, "site.css"), ":root { --amber: #E8A23C; }");
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("serves the published file when one is there", () => {
    expect(sitePage(dir, "privacy")).toContain("published privacy");
  });

  it("falls back to null — and so to the built-in — when one is not", () => {
    // terms.html was never written in this test's directory.
    expect(sitePage(dir, "terms")).toBeNull();
  });

  it("refuses a name that could climb out of the site directory", () => {
    // The names are ours today. A path join with something that climbs is the
    // kind of thing that only stays safe while nobody edits it.
    expect(sitePage(dir, "../../etc/passwd")).toBeNull();
    expect(sitePage(dir, "..")).toBeNull();
    expect(sitePage(dir, "a/b")).toBeNull();
  });

  it("serves the shared stylesheet, and 404s when there is none", async () => {
    const live = await buildApp();
    await live.ready();
    try {
      // This app was built with the empty SITE_DIR from the top of the file.
      const res = await live.inject({ method: "GET", url: "/site.css" });
      expect(res.statusCode).toBe(404);
    } finally { await live.close(); }
  });
});
