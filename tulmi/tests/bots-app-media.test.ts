/**
 * THE BOTS APP'S MEDIA (experience/bots/media.ts, routes/voiceSample.ts; shared/types/sdui.ts section 3d):
 *
 *   - Ask sends a picked photo, file or screenshot (uploadFile into `attach`), shows it on its way and sent, and carries
 *     it in the ask; a build without FileUpload keeps the attach screen as before
 *   - the phone speaks into Ask (recordVoice into `ask`), starts listening when opened from a mic, and the window never
 *     gets it (it has Fn)
 *   - the Code bot's Add to chat sends a photo, a screenshot, a screen recording or a file, and the message carries it
 *   - Keybot's voices play their sample (playAudio, one at a time, the speed picked), and only for a build with AudioPlay
 *   - over HTTP: a sample is the person's to hear only when signed in, only an offered voice, made once
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const views = await import("../src/keybot/views.js");
const { registerVoiceSampleRoute, sampleLine } = await import("../src/routes/voiceSample.js");
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

const PROJECT = "55555555-5555-4555-8555-555555555555";
const ALL = ["BotsKit", "FileUpload", "AudioPlay", "VoiceRecord"];

const req = (screenId: string, client: "phone" | "desktop", params: Record<string, string | boolean> = {}, can = ALL) => ({
  screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(can), desk: { pages: client === "desktop", notes: false },
});

/** Every action in a tree, nested ones too (sequences, conditions, success and error branches). */
function actions(root: Node): ActionSpec[] {
  const out: ActionSpec[] = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const s = a as ActionSpec & Record<string, unknown>;
    if (typeof s.kind === "string") out.push(s);
    for (const v of Object.values(s)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  for (const n of walk(root)) for (const a of Object.values(n.on ?? {})) visit(a);
  return out;
}
const kinds = (root: Node) => new Set(actions(root).map((a) => a.kind));
const texts = (root: Node) => walk(root).map((n) => String(n.props?.content ?? "")).filter(Boolean);

async function build(screenId: string, client: "phone" | "desktop", params: Record<string, string | boolean> = {}, can = ALL, api: Record<string, unknown> = {}) {
  const s = await buildBotsScreen(req(screenId, client, params, can), fakeDeps({ api }));
  return s;
}

describe("Ask sends a picked file", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`picks and sends a photo, a file and a screenshot, and shows it (${client})`, async () => {
      const s = await build("bots.ask", client);
      expect(lintTree(s.root!)).toEqual([]);
      const ups = actions(s.root!).filter((a): a is Extract<ActionSpec, { kind: "uploadFile" }> => a.kind === "uploadFile");
      expect(ups.map((u) => u.pick).sort()).toEqual(["file", "photo", "screenshot"]);
      for (const u of ups) {
        expect(u).toMatchObject({ path: "/v1/files", assignTo: "sent", progressTo: "up", maxBytes: 50 * 1024 * 1024 });
        // The sent file's ref is the one the ask carries; a refusal is shown in the server's words.
        expect(JSON.stringify(u.onSuccess)).toContain('"appendState","path":"attach","value":"$state.sent.attachment"');
        expect(JSON.stringify(u.onError)).toContain("$event");
      }
      // On its way and sent: drawn from state.
      const binds = walk(s.root!).map((n) => n.bind?.content).filter(Boolean);
      expect(binds).toEqual(expect.arrayContaining(["up.name", "up.percent", "sent.name", "sent.size"]));
      expect(s.state).toMatchObject({ up: null, sent: null });
      // The ask carries it.
      const ask = actions(s.root!).find((a) => a.kind === "callEndpoint" && a.path === "/v1/shell/ask") as Extract<ActionSpec, { kind: "callEndpoint" }>;
      expect(ask.body).toMatchObject({ attachments: "$state.attach" });
    });
  }

  it("a build without FileUpload keeps the attach screen", async () => {
    const s = await build("bots.ask", "phone", {}, ["BotsKit"]);
    expect(kinds(s.root!).has("uploadFile")).toBe(false);
    expect(actions(s.root!).some((a) => a.kind === "navigate" && a.screenId === "bots.attach")).toBe(true);
    expect(lintTree(s.root!)).toEqual([]);
  });
});

describe("speaking in Ask (the phone)", () => {
  it("records in the app, writes the words into the field, then checks who answers", async () => {
    const s = await build("bots.ask", "phone");
    const rec = actions(s.root!).filter((a): a is Extract<ActionSpec, { kind: "recordVoice" }> => a.kind === "recordVoice");
    expect(rec.length).toBeGreaterThan(0);
    expect(rec[0]).toMatchObject({ assignTo: "ask", statePath: "voice", levelTo: "level", append: true });
    expect(JSON.stringify(rec[0]!.onDone)).toContain("/v1/shell/route");
    expect(rec[0]!.onBlocked).toEqual({ kind: "setState", path: "micBlocked", value: true });
    expect(s.state).toMatchObject({ voice: "idle", level: 0, micBlocked: false });
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Listening · Hinglish works", "Writing down what you said…", "The microphone is off for X0 Bot."]));
    // The bars follow the voice: a height that stands up as `level` grows.
    expect(JSON.stringify(s.root)).toContain('"height":{"gte":["level"');
    // Not started until asked.
    expect(walk(s.root!).some((n) => n.on?.onAppear)).toBe(false);
    expect(lintTree(s.root!)).toEqual([]);
  });

  it("starts listening at once when opened from a mic", async () => {
    const s = await build("bots.ask", "phone", { voice: true });
    expect(walk(s.root!).some((n) => (n.on?.onAppear as ActionSpec | undefined)?.kind === "recordVoice")).toBe(true);
  });

  it("not in the window, and not for a build without VoiceRecord", async () => {
    expect(kinds((await build("bots.ask", "desktop")).root!).has("recordVoice")).toBe(false);
    expect(kinds((await build("bots.ask", "phone", {}, ["BotsKit", "FileUpload"])).root!).has("recordVoice")).toBe(false);
  });
});

describe("Add to chat sends a picked file", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`a photo, a screenshot, a screen recording or a file (${client})`, async () => {
      const s = await build("bots.attach", client, { project: PROJECT }, ALL, { "GET /v1/files": { files: [] } });
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(s.root!)).toEqual(expect.arrayContaining(["Photo", "Screenshot", "Screen recording", "File", "Link", "Voice note"]));
      const ups = actions(s.root!).filter((a): a is Extract<ActionSpec, { kind: "uploadFile" }> => a.kind === "uploadFile");
      expect(ups.map((u) => u.pick).sort()).toEqual(["file", "photo", "screenshot", "video"]);
      // The file sent is the one the message carries, as a recent one is.
      expect(JSON.stringify(ups[0]!.onSuccess)).toContain('"path":"atts","value":"$state.sent.attachment"');
      expect(JSON.stringify(ups[0]!.onSuccess)).toContain('"path":"pick","value":"$state.sent.file.id"');
    });
  }

  it("the window's Screenshot says what it does there: a Mac's own picker, else a screenshot you saved", async () => {
    const s = await build("bots.attach", "desktop", { project: PROJECT }, ALL, { "GET /v1/files": { files: [] } });
    const lines = walk(s.root!).filter((n) => n.type === "Text" && /^Pick a (window or an area|screenshot you saved)$/.test(String(n.props?.content)));
    expect(lines.map((n) => [n.props?.content, n.visibleIf])).toEqual([
      ["Pick a window or an area", { eq: ["desktop.os", "mac"] }],
      ["Pick a screenshot you saved", { neq: ["desktop.os", "mac"] }],
    ]);
    // The phone has no line under it.
    const phone = await build("bots.attach", "phone", { project: PROJECT }, ALL, { "GET /v1/files": { files: [] } });
    expect(texts(phone.root!).some((t) => t.startsWith("Pick a "))).toBe(false);
  });

  it("a build without FileUpload: a link or a voice note, as before", async () => {
    const s = await build("bots.attach", "phone", { project: PROJECT }, ["BotsKit"], { "GET /v1/files": { files: [] } });
    expect(texts(s.root!)).not.toContain("Screenshot");
    expect(kinds(s.root!).has("uploadFile")).toBe(false);
  });
});

describe("Keybot's voices play their sample", () => {
  const api = { [`GET /v1/keybot/voices?tz=${IST}`]: views.voicesView({ ttsVoice: "sage" }, { read: { speed: "1.25" } }) };
  for (const client of ["phone", "desktop"] as const) {
    it(`one play button per voice, at the speed picked (${client})`, async () => {
      const s = await build("bots.keybot.voices", client, {}, ALL, api);
      expect(lintTree(s.root!)).toEqual([]);
      const plays = actions(s.root!).filter((a): a is Extract<ActionSpec, { kind: "playAudio" }> => a.kind === "playAudio");
      expect(plays.length).toBe(views.voicesView({}, {}).voices.length);
      expect(plays.find((p) => p.id === "sage")).toMatchObject({ url: "/v1/keybot/voices/sage/sample?speed=$state.read.speed", statePath: "playing" });
      // Pressed again while it plays, it stops.
      expect(kinds(s.root!).has("stopAudio")).toBe(true);
      expect(s.state).toMatchObject({ voice: "sage", playing: null });
      expect(JSON.stringify(s.root)).toContain('"bind":{"content":"playing.time"}');
      // Choosing a voice still saves it.
      expect(actions(s.root!).some((a) => a.kind === "callEndpoint" && a.path === "/v1/personality")).toBe(true);
    });
  }

  it("a build without AudioPlay: the voices to choose, no play button", async () => {
    const s = await build("bots.keybot.voices", "phone", {}, ["BotsKit"], api);
    expect(kinds(s.root!).has("playAudio")).toBe(false);
    expect(lintTree(s.root!)).toEqual([]);
  });
});

describe("GET /v1/keybot/voices/:id/sample", () => {
  async function served(speak: (i: { text: string; voice?: string; speed?: number }) => Promise<{ audio: Buffer; contentType: string }>) {
    const app = Fastify();
    registerVoiceSampleRoute(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, speak });
    await app.ready();
    return app;
  }

  it("the voice saying its line, made once per voice and speed, only when signed in", async () => {
    const said: Array<{ text: string; voice?: string; speed?: number }> = [];
    const app = await served(async (i) => { said.push(i); return { audio: Buffer.from("ID3audio"), contentType: "audio/mpeg" }; });
    expect((await app.inject({ method: "GET", url: "/v1/keybot/voices/sage/sample" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/keybot/voices/nobody/sample", headers: { authorization: "Bearer u1" } })).statusCode).toBe(400);

    const r = await app.inject({ method: "GET", url: "/v1/keybot/voices/sage/sample?speed=1.25", headers: { authorization: "Bearer u1" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("audio/mpeg");
    expect(r.body).toBe("ID3audio");
    expect(said).toEqual([{ text: sampleLine("Sage"), voice: "sage", format: "mp3", speed: 1.25 }]);

    // Twice, by someone else: the same sample, not a second call. An unknown speed is normal speed.
    await app.inject({ method: "GET", url: "/v1/keybot/voices/sage/sample?speed=1.25", headers: { authorization: "Bearer u2" } });
    await app.inject({ method: "GET", url: "/v1/keybot/voices/sage/sample?speed=9", headers: { authorization: "Bearer u2" } });
    expect(said).toHaveLength(2);
    expect(said[1]).toEqual({ text: sampleLine("Sage"), voice: "sage", format: "mp3" });
  });

  it("a failed one is said plainly and tried again next time", async () => {
    let n = 0;
    const app = await served(async () => { n += 1; if (n === 1) throw new Error("down"); return { audio: Buffer.from("ok"), contentType: "audio/mpeg" }; });
    const first = await app.inject({ method: "GET", url: "/v1/keybot/voices/nova/sample", headers: { authorization: "Bearer u1" } });
    expect(first.statusCode).toBe(503);
    expect(first.json().message).toBe("Couldn't play that voice right now. Try again.");
    const again = await app.inject({ method: "GET", url: "/v1/keybot/voices/nova/sample", headers: { authorization: "Bearer u1" } });
    expect(again.statusCode).toBe(200);
  });
});
