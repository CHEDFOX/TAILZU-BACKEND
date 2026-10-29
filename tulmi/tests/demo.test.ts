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
// A site dir that does not exist: the published pages fall back to the
// built-in ones, and / goes to the site whatever is here.
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
import { sitePage, spendDemo } from "../src/routes/demo.js";
// eslint-disable-next-line import/first
import { askSite } from "../src/config.js";
// eslint-disable-next-line import/first
import { SITE_UI } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { logUrl } from "../src/observability.js";

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
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, origin: "https://x0bot.com" },
  };
}

describe("the landing page", () => {
  it("sends the API's / to the site, for good", async () => {
    // The page lives on x0bot.com with its /js, /media and /demo files
    // beside it; a copy served from here would 404 every one of them. A
    // 308, so a crawler folds the two addresses into the real one.
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("https://x0bot.com/");
  });

  it("hands the page every word it will show", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/site" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // THE WORDS UNDER THE RIVER. A headline short enough to be one, a line
    // under it, three steps, four tones, four drawn fields, a desk, a price
    // whose number is the server's, and questions that end in one.
    const c = body.copy;
    // The hero is a race: the two words that label its halves, the demo's
    // invitation and its three states, and nothing longer than there is
    // room for. No headline: the top screen puts two numbers next to each
    // other and lets the reader draw the conclusion.
    expect(c.hero.said.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
    expect(c.hero.title).toBeUndefined();
    for (const k of ["typed", "taps", "press", "invite", "listening", "writing", "again"]) {
      expect(typeof c.hero[k]).toBe("string");
      expect(c.hero[k].trim().length).toBeGreaterThan(0);
      expect(c.hero[k].trim().split(/\s+/).length).toBeLessThanOrEqual(4);
    }
    // THE MIC KEY, FOR THE PAGE TO DRAW: the phones' mark and program, so
    // the key on the site is the key on the keyboard.
    expect(body.mic.program.version).toBe(1);
    expect(body.mic.mark.shapes.some((sh: { kind: string }) => sh.kind === "bars")).toBe(true);
    expect(body.mic.inset).toBe(7);
    // No small title over any main title: the title is the title.
    for (const sec of [c.how, c.tone, c.llm, c.apps, c.desk, c.dev, c.faq]) expect(sec.kick).toBeUndefined();
    expect(c.how.steps.length).toBe(3);
    for (const s of c.how.steps) expect(s.title.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
    // The correction, when there is one: the cut word is in the title, and
    // the fix is one word. A title with nothing to strike sets neither.
    if (c.apps.cut) {
      expect(c.apps.title.toLowerCase()).toContain(c.apps.cut.toLowerCase());
      expect(c.apps.fix.trim().split(/\s+/).length).toBe(1);
    } else {
      expect(c.apps.fix).toBe("");
    }
    expect(c.apps.fields.length).toBeGreaterThanOrEqual(3);
    for (const f of c.apps.fields) {
      expect(["message", "mail", "memo", "search"]).toContain(f.kind);
      expect(f.text.length).toBeGreaterThan(0);
      // An instruction is something other than the sentence that lands.
      if (f.say !== undefined) { expect(f.say.length).toBeGreaterThan(0); expect(f.say).not.toBe(f.text); }
    }
    // Some of them are instructions, and more than one script is spoken.
    const spoken = c.apps.fields.filter((f) => f.say !== undefined);
    expect(spoken.length).toBeGreaterThanOrEqual(3);
    expect(spoken.some((f) => /[^\u0000-\u024F\s\p{P}]/u.test(f.say))).toBe(true);
    // The gesture on the page is the tray app's default way in: Ctrl, twice.
    // The keys drawn beside the title show it; the title no longer names it.
    expect(c.desk.keys).toEqual(["Ctrl", "Ctrl"]);
    expect(c.free.title.length).toBeGreaterThan(0);
    // The price screen is a title, a button and the three marks. Nothing
    // under the title tells the reader what upgrading is for.
    expect(c.free.lede).toBeUndefined();
    // The two stages: the machines and the editor. Each has a said line and
    // a written one that differ, and the machines have their tabs.
    for (const st of [c.llm, c.dev]) {
      expect(st.said.length).toBeGreaterThan(0);
      expect(st.wrote.length).toBeGreaterThan(0);
      expect(st.wrote).not.toBe(st.said);
    }
    // A few named machines and a note that there are more — not a directory.
    expect(c.llm.targets.length).toBeGreaterThanOrEqual(2);
    expect(c.llm.targets.length).toBeLessThanOrEqual(4);
    expect(c.llm.more.split(/\s+/).length).toBeLessThanOrEqual(2);
    // Each machine its own prompt, said one way and written another, and
    // no two the same.
    expect(c.llm.prompts.length).toBe(c.llm.targets.length);
    for (const p of c.llm.prompts) expect(p.wrote).not.toBe(p.said);
    expect(new Set(c.llm.prompts.map((p: { wrote: string }) => p.wrote)).size).toBe(c.llm.prompts.length);
    expect(typeof body.perMinute).toBe("number");
    // Readable from a page hosted anywhere, so a preview shows the real
    // copy rather than falling back to the one baked into the file.
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    // One button, and the two store links it needs.
    expect(c.download.get.length).toBeGreaterThan(0);
    expect(c.stores.ios).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(c.stores.android).toMatch(/^https:\/\/play\.google\.com\//);
    expect(c.faq.items.length).toBeGreaterThanOrEqual(3);
    expect(c.faq.items.length).toBeLessThanOrEqual(8);   // not bulky
    for (const q of c.faq.items) {
      expect(q.q.trim().endsWith("?")).toBe(true);
      expect(q.a.trim().split(/\s+/).length).toBeLessThanOrEqual(10);
    }
    // Nothing the page does not render, and nothing the product cannot
    // honour: no sign-up-optional claim anywhere in the copy.
    for (const dead of ["get", "morph", "reel", "facts", "eyebrow", "headline", "lede", "price", "proof", "steps"]) {
      expect(c[dead]).toBeUndefined();
    }
    expect(JSON.stringify(c).toLowerCase()).not.toMatch(/no sign[- ]?up/);
    // The river has to arrive with the page, and every case needs both sides:
    // a missing one puts a gap in a line that is meant never to break.
    expect(body.copy.cases.length).toBeGreaterThan(3);
    for (const c of body.copy.cases) {
      expect(c.said.length).toBeGreaterThan(0);
      expect(c.wrote.length).toBeGreaterThan(0);
      // A case whose two sides match demonstrates nothing.
      expect(c.wrote).not.toBe(c.said);
      // Each is named: the language is the page's proof, shown as a word.
      expect(c.lang.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
    }
    // The word the whole field pours into. A word or two and never more:
    // it is set at the size of a thing swallowing a hundred threads, so a
    // third word does not fit on a laptop. Set as text, so an angle bracket
    // in it would print rather than render.
    expect(body.copy.absorb.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
    expect(body.copy.absorb).not.toMatch(/[<>]/);
    // The story it cycles through: several words, each as short as the one
    // above, the first of them being that one.
    expect(body.copy.absorbs.length).toBeGreaterThanOrEqual(2);
    expect(body.copy.absorbs[0]).toBe(body.copy.absorb);
    for (const w of body.copy.absorbs) {
      expect(w.trim().split(/\s+/).length).toBeLessThanOrEqual(2);
      expect(w).not.toMatch(/[<>]/);
    }
    expect(body.copy.identity).toBeUndefined();
    // The old hero's words went with it: a string here is a string on the
    // page, and these render nowhere now.
    for (const gone of ["cta", "ctaHeld", "writing", "again"]) expect(c[gone], gone).toBeUndefined();
    expect(c.download.hero).toBeUndefined();
    expect(c.download.dev).toBeUndefined();
    // The tones are the keyboard's own, distinct in name and in sentence,
    // and none of them is the line as it was said.
    const tones: { name: string; text: string }[] = body.copy.tone.tones;
    expect(tones.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tones.map((t) => t.name)).size).toBe(tones.length);
    expect(new Set(tones.map((t) => t.text)).size).toBe(tones.length);
    for (const t of tones) expect(t.text).not.toBe(body.copy.tone.said);
    expect(typeof body.freeWords).toBe("number");
    expect(body.demo).toBe(true);
    expect(body.maxSeconds).toBe(15);
    // Installers are reported by presence, so an unpublished one shows as
    // "soon" rather than a dead link.
    expect(Object.keys(body.downloads).sort()).toEqual(["linux", "mac", "win"]);
    for (const v of Object.values(body.downloads)) expect(typeof v).toBe("boolean");
    // Ask is not shown until someone says so (ASK_SITE, or a console rule).
    expect(body.ask).toBe("off");
  });

  it("gives the redesigned page only true, real, short words", async () => {
    const body = (await app.inject({ method: "GET", url: "/v1/site" })).json();
    const c = body.copy;
    // A word has a letter or a digit in it: the receipt's "·" is not one.
    const words = (s: string) => s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    // A said → written pair the page shows is one the product really
    // wrote: a case, or a keyboard scene's instruction and what landed.
    const real = (said: string, wrote: string) =>
      c.cases.some((x: { said: string; wrote: string }) => x.said === said && x.wrote === wrote)
      || c.apps.fields.some((f: { say?: string; text: string }) => f.say === said && f.text === wrote);
    expect(c.lines.length).toBeGreaterThanOrEqual(3);
    expect(c.lines.length).toBeLessThanOrEqual(6);
    for (const l of c.lines) {
      expect(real(l.said, l.wrote), l.said).toBe(true);
      // The receipt is served, never computed, and short enough to read
      // in the time the line takes to land.
      expect(l.note.length).toBeGreaterThan(0);
      expect(words(l.note), l.note).toBeLessThanOrEqual(8);
    }
    // The first line is a case, so its language is known, and the page is
    // the same for every reader of it.
    expect(c.cases.some((x: { said: string }) => x.said === c.lines[0].said)).toBe(true);
    // The comb cleans a real sentence, and the race is typed against what
    // it was written as.
    const comb = c.cases.find((x: { said: string }) => x.said === c.comb.said);
    expect(comb, c.comb.said).toBeDefined();
    expect(c.race.line).toBe(comb.wrote);

    // Every italic half is part of the title it sits in.
    const humans: Array<[string, string, string]> = [];
    const walk = (o: unknown, at: string) => {
      if (!o || typeof o !== "object") return;
      const r = o as Record<string, unknown>;
      if (typeof r.human === "string") humans.push([at, r.human, String(r.title)]);
      for (const [k, v] of Object.entries(r)) walk(v, `${at}.${k}`);
    };
    walk(c, "copy");
    expect(humans.map(([at]) => at).sort()).toEqual(
      ["apps", "ask", "desk", "films", "free", "how", "phone", "river", "tone"].map((k) => `copy.${k}`).sort());
    for (const [at, human, title] of humans) {
      expect(human.length, at).toBeGreaterThan(0);
      expect(title, at).toContain(human);
    }
    // The h1 is the owner's product line, and the category is named over it.
    expect(c.apps.title).toBe("Talk instead of type.");
    expect(c.apps.kind.length).toBeGreaterThan(0);

    // "Free" on the page is the FAQ's own answer, whichever it is right now.
    // FREE_FOR_ALL is off in this suite's setup, so the served line is the
    // allowance, never "Every word" while words are counted
    // (free-for-all.test holds the free one).
    const served = c.faq.items.find((q: { q: string }) => q.q === "Is it free?");
    expect(served.a).toContain(c.download.free);
    expect(c.download.free).not.toMatch(/every word/i);
    expect(c.download.freeCapped).toBeUndefined();
    const free = SITE_UI.faq.items.find((q) => q.q === "Is it free?") as { aFree?: string } | undefined;
    expect(free?.aFree).toContain(SITE_UI.download.free);
    expect(free && "a" in free ? (free as { a: string }).a : "").toContain(SITE_UI.download.freeCapped);
    // Every button label fits on a button. (startedNote is the sentence
    // read out once a download starts, with the file's name put in; `free`
    // is the line under the button, a short sentence.)
    for (const [k, v] of Object.entries(c.download as Record<string, string>)) {
      if (k === "startedNote" || k === "free") continue;
      expect(words(v), k).toBeLessThanOrEqual(4);
    }
    expect(words(SITE_UI.download.free)).toBeLessThanOrEqual(4);
    expect(words(c.download.free)).toBeLessThanOrEqual(6);
    expect(c.download.startedNote).toContain("{file}");
    for (const k of ["get", "ios", "android", "win", "mac", "linux", "short", "free", "other", "starting", "started"]) {
      expect(typeof c.download[k], k).toBe("string");
    }
    expect(c.ui.platforms).toEqual(["iPhone", "Android", "Windows", "Mac", "Linux"]);

    // The saboteur's "fixes" are words it really typed, and saying it
    // instead gives something else.
    const sab = c.phone.saboteur;
    const typed = sab.typed.toLowerCase().split(/[^\p{L}]+/u);
    for (const w of Object.keys(sab.fixes)) expect(typed, w).toContain(w);
    expect(sab.wrote).not.toBe(sab.typed);

    // The polish round's keys: the page's own placeholders stay out of fill()'s way ({n} is the free
    // words), the typed secret says it was typed, every section has a name on the spine, and the
    // Full Access ask carries its reason and what happens to the audio (both in the facts and the FAQ).
    expect(c.river.more).toContain("{count}");
    expect(JSON.stringify([c.river, c.desk.share, c.desk.copied, c.ui.android, c.ui.spine, c.race.placeholder])).not.toContain("{n}");
    expect(c.free.typed.toLowerCase()).toContain("typed hi");
    for (const id of ["how", "river", "apps", "films", "tone", "desk", "llm", "dev", "ask", "questions", "free"]) expect(typeof c.ui.spine[id], id).toBe("string");
    expect(c.phone.lede).toContain("Full Access");
    expect(c.phone.lede).toContain("Audio is deleted once it's written.");
    expect(words(c.desk.share)).toBeLessThanOrEqual(5);

    // Ask's preview plays scenes the stand-in app has.
    expect(c.ask.runs.length).toBeGreaterThanOrEqual(1);
    expect(c.ask.runs.length).toBeLessThanOrEqual(4);
    for (const r of c.ask.runs) {
      expect(["export", "picture", "steps", "error", "send", "delete", "private", "dictate"]).toContain(r.id);
      expect(r.label.length).toBeGreaterThan(0);
    }
    // Films are named by their media file, and each has its line.
    const media = ["keyless", "said-written", "spanish", "to-him", "tones", "typed-vs-said", "languages", "autocorrect", "boss", "bleeped"];
    expect(new Set(c.films.items.map((f: { id: string }) => f.id)).size).toBe(c.films.items.length);
    for (const f of c.films.items) {
      expect(media).toContain(f.id);
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.line.length).toBeGreaterThan(0);
    }
    // The meeting's audio is CC BY: its credit is a condition of using it.
    expect(c.desk.credit).toMatch(/AMI/);
    expect(c.desk.credit).toMatch(/CC BY 4\.0/);
    expect(c.desk.meeting.length).toBeGreaterThan(2);

    // Blip says little: every line of his is twelve words at most. The
    // pirate lede is the hero's lede in a pirate's voice, not his line,
    // and it lands in the same apps the real one names.
    const blip: string[] = [];
    const lines = (o: unknown, at: string) => {
      if (at === "pirate.lede") return;
      if (typeof o === "string") blip.push(o);
      else if (Array.isArray(o)) o.forEach((v) => lines(v, at));
      else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) lines(v, at ? `${at}.${k}` : k);
    };
    lines(c.blip, "");
    expect(blip.length).toBeGreaterThan(20);
    for (const l of blip) expect(words(l), l).toBeLessThanOrEqual(12);
    const tail = (s: string) => s.slice(s.lastIndexOf(":") + 1).trim();
    expect(tail(c.blip.pirate.lede)).toBe(tail(c.apps.lede));

    // Nothing new quotes a price or claims sign-up is optional.
    const fresh = JSON.stringify([c.apps.kind, c.apps.lede, c.lines, c.listen, c.comb, c.river, c.phone, c.films,
      c.race, c.tone.more, c.tone.pirate, c.desk, c.llm.note, c.ask, c.free, c.download, c.blip, c.ui]);
    expect(fresh).not.toMatch(/\$|\bLite\b|\bElite\b|\bupgrade\b|per month|\ba year\b/i);
    expect(fresh.toLowerCase()).not.toMatch(/no sign[- ]?up/);
  });

  it("reads ASK_SITE as off, soon or live, and anything else as off", () => {
    // A typo in .env hides a section; it never stops the server.
    expect(askSite(undefined)).toBe("off");
    expect(askSite("")).toBe("off");
    expect(askSite("soon")).toBe("soon");
    expect(askSite(" LIVE ")).toBe("live");
    expect(askSite("yes")).toBe("off");
    // Served as-is, and served whatever the flag: the page decides whether
    // to paint it, so a console rule needs no copy deploy.
    expect(SITE_UI.ask.title.length).toBeGreaterThan(0);
  });
});

describe("Google sign-in's way back", () => {
  // What the app mints: 32 random bytes, base64url.
  const STATE = "q3Vh0tJx_9aZ-4bC7dE1fG2hI5jK6lM8nO0pQrStUvW";

  it("hands the session to the app on the scheme every build has claimed", async () => {
    const res = await app.inject({ method: "GET", url: `/auth/callback?state=${STATE}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    // A session is in the URL, so nothing about this page may be cached.
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("tulmi://auth/callback");
    // It forwards the query (the state, and the PKCE code beside it) and the
    // FRAGMENT, which is where the implicit flow puts the tokens.
    expect(res.body).toContain("location.search + location.hash");
  });

  it("refuses a return that carries no state of a sign-in the app started", async () => {
    // A link to this page carrying a session minted for the SENDER's account
    // would otherwise bounce straight into the app from a trusted address.
    for (const url of [
      "/auth/callback",
      "/auth/callback?code=attacker-code",
      "/auth/callback?state=short&code=x",
      "/auth/callback?state=has%20space%20and%20is%20long%20enough%20to%20pass",
      `/auth/callback?state=${STATE}&state=${STATE}`,
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(400);
      expect(res.body, url).not.toContain("tulmi://");
      expect(res.body, url).not.toContain("location");
      expect(res.headers["cache-control"], url).toBe("no-store");
      expect(res.headers["referrer-policy"], url).toBe("no-referrer");
    }
  });

  it("gives the store bundle's link a state of its own, so it still comes back", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/app/bootstrap", payload: { capabilities: { platform: "android" } } });
    const screen = JSON.stringify(res.json().flags["auth.screen"]);
    const m = /redirect_to=([^&"]+)/.exec(screen);
    expect(m).not.toBeNull();
    const redirect = new URL(decodeURIComponent(m![1]!));
    expect(`${redirect.origin}${redirect.pathname}`).toBe("https://api.test.tailzu/auth/callback");
    const state = redirect.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    // …and the page lets that return through.
    expect((await app.inject({ method: "GET", url: `/auth/callback?state=${state}` })).statusCode).toBe(200);
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
    // A desktop gets Apple's button on a Mac and not on the others: a window
    // says which it is, and a Windows machine is not offered a door to an
    // account almost nobody there has. A desktop that says nothing is
    // treated as not a Mac.
    expect(await boot({ platform: "ios", device: { formFactor: "desktop", os: "mac" } })).toContain("AppleSignIn");
    expect(await boot({ platform: "ios", device: { formFactor: "desktop", os: "windows" } })).not.toContain("AppleSignIn");
    expect(await boot({ platform: "ios", device: { formFactor: "desktop", os: "windows" } })).toContain("GoogleSignIn");
    expect(await boot({ platform: "ios", device: { formFactor: "desktop" } })).not.toContain("AppleSignIn");
  });

  it("interpolates nothing of the request into the page", async () => {
    // The tokens travel in the fragment and never reach the server, but the
    // query does — and a page that echoed it would be a page that could leak
    // a code. The page is a static string; the request must not change it.
    const res = await app.inject({ method: "GET", url: `/auth/callback?state=${STATE}&access_token=LEAK-ME&code=LEAK-TOO` });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("LEAK-ME");
    expect(res.body).not.toContain("LEAK-TOO");
    expect(res.body).not.toContain(STATE);
    const refused = await app.inject({ method: "GET", url: "/auth/callback?access_token=LEAK-ME&code=LEAK-TOO" });
    expect(refused.body).not.toContain("LEAK-ME");
    expect(refused.body).not.toContain("LEAK-TOO");
  });

  it("keeps the callback's query out of the request log", () => {
    expect(logUrl(`/auth/callback?state=${STATE}&code=secret`)).toBe("/auth/callback");
    expect(logUrl("/auth/callback")).toBe("/auth/callback");
    expect(logUrl("/auth/callbackish?x=1")).toBe("/auth/callbackish?x=1");
    expect(logUrl("/v1/site?x=1")).toBe("/v1/site?x=1");
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
    // Refused while it is read, with the demo's own words, rather than after
    // an anonymous upload has been buffered whole.
    const { payload, headers } = multipart(Buffer.alloc(900 * 1024), "clip.webm");
    const res = await app.inject({ method: "POST", url: "/v1/demo/transcribe", payload, headers });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("too_long");
  });

  it("asks for a file when none arrives", async () => {
    const boundary = "----empty";
    const res = await app.inject({
      method: "POST", url: "/v1/demo/transcribe",
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhi\r\n--${boundary}--\r\n`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, origin: "https://x0bot.com" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("is spent only from our own pages", async () => {
    // A form POST needs no CORS permission: without this any site could
    // embed the demo and spend it.
    for (const [i, origin] of [undefined, "https://evil.example", "https://x0bot.com.evil.example"].entries()) {
      const { payload, headers } = multipart(wav(4), "clip.wav");
      // Each from its own visitor, so the per-minute rate is not what refuses it.
      const h: Record<string, string> = { ...headers, "x-vercel-forwarded-for": `192.0.2.${i + 1}` };
      if (origin) h.origin = origin; else delete h.origin;
      const res = await app.inject({ method: "POST", url: "/v1/demo/transcribe", payload, headers: h });
      expect(res.statusCode, String(origin)).toBe(403);
    }
    // The API's own copy of the page counts as ours.
    const { payload, headers } = multipart(wav(4), "clip.wav");
    const res = await app.inject({ method: "POST", url: "/v1/demo/transcribe", payload,
      headers: { ...headers, origin: "https://api.test.tailzu", "x-vercel-forwarded-for": "198.51.100.9" } });
    expect(res.statusCode).toBe(200);
  });

  it("rates each visitor behind the site, not the site", async () => {
    // Through Vercel every call comes from Vercel's address; one visitor's
    // calls must not use up everyone's.
    const call = (visitor: string) => {
      const { payload, headers } = multipart(wav(2), "clip.wav");
      return app.inject({ method: "POST", url: "/v1/demo/transcribe", payload,
        headers: { ...headers, "x-vercel-forwarded-for": visitor } });
    };
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await call("203.0.113.7")).statusCode);
    expect(codes).toContain(429);
    expect((await call("203.0.113.8")).statusCode).toBe(200);
  });

  it("stops for the day at the budget, and starts again the next", () => {
    // The ceiling that bounds the bill whatever the per-visitor key says.
    const day = new Date("2031-01-01T12:00:00Z"), next = new Date("2031-01-02T00:00:01Z");
    expect([spendDemo(2, day), spendDemo(2, day), spendDemo(2, day)]).toEqual([true, true, false]);
    expect(spendDemo(2, next)).toBe(true);
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
