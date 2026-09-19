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
// Google-on-Android by way of Supabase's page: on, at a known origin, so the
// flag the app reads can be checked to the character.
process.env.AUTH_GOOGLE_WEB = "true";
process.env.PUBLIC_ORIGIN = "https://api.test.tailzu";
// The URL only, no key: enough to build the authorize link, not enough to
// turn real auth on for these tests.
process.env.SUPABASE_URL = "https://test-project.supabase.co";

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
    // ONE TITLE, FOUR WORDS AT MOST. It sits over the buttons; there is
    // nothing over the river and no second viewport under it. The limit is
    // the point of the test.
    expect(typeof body.copy.get).toBe("string");
    expect(body.copy.get.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
    // And nothing the page does not render: a string here that renders
    // nowhere is a claim nobody can check. The card and its three claims
    // are gone with the second viewport.
    for (const dead of ["eyebrow", "headline", "lede", "price", "proof", "steps"]) {
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
    // The word the whole field pours into. A word or two and never more:
    // it is set at the size of a thing swallowing a hundred threads, so a
    // third word does not fit on a laptop. Set as text, so an angle bracket
    // in it would print rather than render.
    expect(body.copy.absorb.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
    expect(body.copy.absorb).not.toMatch(/[<>]/);
    expect(body.copy.identity).toBeUndefined();
    // BELOW THE RIVER. Every case names its language, because it is a chip
    // now; the two titles are short enough to be titles; the tones are the
    // keyboard's own, distinct in name and in sentence, and none of them is
    // the line as it was said; the facts are few and each is a few words.
    for (const c of body.copy.cases) {
      expect(typeof c.lang).toBe("string");
      expect(c.lang.length).toBeGreaterThan(0);
    }
    for (const t of [body.copy.reel.title, body.copy.tone.title]) {
      expect(t.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
    }
    const tones: { name: string; text: string }[] = body.copy.tone.tones;
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tones.map((t) => t.name)).size).toBe(tones.length);
    expect(new Set(tones.map((t) => t.text)).size).toBe(tones.length);
    for (const t of tones) expect(t.text).not.toBe(body.copy.tone.said);
    expect(body.copy.facts.length).toBeGreaterThanOrEqual(3);
    expect(body.copy.facts.length).toBeLessThanOrEqual(6);
    for (const f of body.copy.facts) expect(f.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(typeof body.freeWords).toBe("number");
    expect(body.demo).toBe(true);
    expect(body.maxSeconds).toBe(15);
    // Installers are reported by presence, so an unpublished one shows as
    // "soon" rather than a dead link.
    expect(Object.keys(body.downloads).sort()).toEqual(["linux", "mac", "win"]);
    for (const v of Object.values(body.downloads)) expect(typeof v).toBe("boolean");
  });
});

describe("Google sign-in's way back", () => {
  it("hands the session to the app on the scheme every build has claimed", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/callback" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    // A session is in the URL, so nothing about this page may be cached.
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("tulmi://auth/callback");
    // It forwards the FRAGMENT, which is where Supabase puts the tokens.
    expect(res.body).toContain("location.hash");
  });

  it("tells the app where to go and where to come back, when switched on", async () => {
    // The app is a renderer: it reads both halves from the bootstrap and
    // invents neither. The callback is a page THIS server serves, on the same
    // origin the media URLs are built on, and the resume is the one scheme
    // every build has claimed.
    const res = await app.inject({ method: "POST", url: "/v1/app/bootstrap", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().flags["auth.googleWeb"]).toEqual({
      callback: "https://api.test.tailzu/auth/callback",
      resume: "tulmi://auth/callback",
    });
  });

  it("leaves the Google button out for an Android bundle that cannot come back", async () => {
    // The store binary's own bundle never claimed the scheme the native client
    // returns on and has no web path either, so on a fresh install the button
    // would strand the user on google.com. That bundle cannot be changed —
    // but it draws whatever screen it is handed, and it is handed one with
    // no Google button. New JavaScript declares `googleWeb` and gets it back.
    const boot = async (capabilities: Record<string, unknown>) => {
      const res = await app.inject({ method: "POST", url: "/v1/app/bootstrap", payload: { capabilities } });
      expect(res.statusCode).toBe(200);
      return JSON.stringify(res.json().flags["auth.screen"]);
    };
    const old = await boot({ platform: "android" });
    expect(old).not.toContain("GoogleSignIn");
    // What it gets instead: Supabase's sign-in as a link, coming back on the
    // callback page, and a reload to finish — the two things that bundle CAN
    // do. Google on a fresh install's first open without a new binary.
    expect(old).toContain(
      "https://test-project.supabase.co/auth/v1/authorize?provider=google"
      + "&redirect_to=https%3A%2F%2Fapi.test.tailzu%2Fauth%2Fcallback",
    );
    expect(old).toContain('"kind":"reloadApp"');
    expect(old).toContain('"googleStarted"');
    expect(await boot({ platform: "android", bundle: "embedded" })).not.toContain("GoogleSignIn");
    // A bundle that can come back gets the real button and no bridge.
    const fresh = await boot({ platform: "android", googleWeb: true });
    expect(fresh).toContain("GoogleSignIn");
    expect(fresh).not.toContain("/auth/v1/authorize");
    expect(fresh).not.toContain("reloadApp");
    // iOS never had the problem: its scheme was registered from the start.
    expect(await boot({ platform: "ios" })).toContain("GoogleSignIn");
    // And the button that is drawn still sits beside Apple's, not instead of it.
    expect(await boot({ platform: "ios" })).toContain("AppleSignIn");
  });

  it("interpolates nothing of the request into the page", async () => {
    // The tokens travel in the fragment and never reach the server, but the
    // query does — and a page that echoed it would be a page that could leak
    // a code. The page is a static string; the request must not change it.
    const res = await app.inject({ method: "GET", url: "/auth/callback?access_token=LEAK-ME&code=LEAK-TOO" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("LEAK-ME");
    expect(res.body).not.toContain("LEAK-TOO");
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
