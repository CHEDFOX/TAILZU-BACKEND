/**
 * POST /v1/agent with a clip: Ask asked about something moving on screen.
 *
 * The desktop sends a few seconds of the window (a WebM from MediaRecorder,
 * with the computer's sound when it could hear it) as a `video` part, in
 * place of the picture. What is checked: the part and its caps, that it is
 * refused where a picture is (an off-limits screen, a sensitive app) and, as
 * a second lock, from a private window; what the model that watches is sent
 * (an OpenRouter `video_url` part with a data: URL, then the screen and what
 * they said); its ladder; that its marks name ids only; and that it is
 * counted against the day's pictures. The model is a fake that streams
 * whatever chunks a test gives it, as in agent-route.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
process.env.AGENT_TIMEOUT_MS = "500";
process.env.AGENT_VISION_TIMEOUT_MS = "500";
process.env.AGENT_VIDEO_TIMEOUT_MS = "700";
process.env.AGENT_IMAGE_MAX_BYTES = "50000";
process.env.AGENT_VIDEO_MAX_BYTES = "200000";
process.env.AGENT_RATE_LIMIT_MAX = "1000";
// The burn brake is a ceiling on one account's hour; this file is that hour (see agent-route.test.ts).
process.env.USAGE_BURN_TIMES = "0";

type Plan = string[] | "throw";
const llm = vi.hoisted(() => ({
  calls: [] as Array<{ body: Record<string, any>; opts: Record<string, any> | undefined }>,
  plans: new Map<string, Plan>(),
  plan: ["DONE"] as Plan,
}));
const quota = vi.hoisted(() => ({ asked: [] as Array<{ agentAudio?: boolean; picture?: boolean } | undefined>, pictures: 0 }));

vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (body: Record<string, any>, opts?: Record<string, any>) => {
          llm.calls.push({ body, opts });
          if (!body.stream) return { choices: [{ message: { content: "" } }] };
          const plan = llm.plans.get(body.model) ?? llm.plan;
          if (plan === "throw") throw Object.assign(new Error("upstream 503"), { status: 503 });
          return (async function* () {
            for (const c of plan) yield { choices: [{ delta: { content: c } }] };
            yield { choices: [], usage: { prompt_tokens: 1600, completion_tokens: 20 } };
          })();
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));
vi.mock("../src/usage/metering.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/usage/metering.js")>();
  return {
    ...real,
    enforceQuota: async (...args: Parameters<typeof real.enforceQuota>) => {
      quota.asked.push(args[1]);
      return real.enforceQuota(...args);
    },
    recordPicture: (...args: Parameters<typeof real.recordPicture>) => {
      quota.pictures += 1;
      return real.recordPicture(...args);
    },
  };
});

const { buildApp } = await import("../src/server.js");
const { readClip, readStepRequest, sniffClip } = await import("../src/agent/protocol.js");
const { videoLadder } = await import("../src/agent/llm.js");
const { stableBlock } = await import("../src/principles/roles.js");
const VISION = stableBlock("ask_vision");

type Ev = Record<string, any>;
const TERMINAL = new Set(["action", "ask", "look", "done", "error"]);
const ELEMENTS = [
  { id: "e1", role: "button", label: "Pause", region: "b" },
  { id: "e2", role: "slider", label: "Seek", region: "b" },
];
const step = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ runId: "run_clip01", step: 0, platform: "mac", app: "VLC", screen: { elements: ELEMENTS }, ...over });

/** A WebM's first bytes (the EBML header), then filler: nothing decodes it, the model is a fake. */
const webm = (size = 5000, fill = 3) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, fill)]);
/** An MP4's first box: a size, then `ftyp`. */
const mp4 = (size = 5000) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(size - 12, 1)]);
const jpeg = (size = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]);

interface FilePart { name: string; filename: string; type: string; data: Buffer }
const clipPart = (data = webm(), type = "video/webm;codecs=vp8,opus", filename = "clip.webm"): FilePart => ({ name: "video", filename, type, data });
const picturePart = (): FilePart => ({ name: "image", filename: "picture.jpg", type: "image/jpeg", data: jpeg() });

function form(request: string, files: FilePart[]): { payload: Buffer; headers: Record<string, string> } {
  const b = "----clip";
  const parts = [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="request"\r\n\r\n${request}\r\n`)];
  for (const f of files) {
    parts.push(
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`),
      f.data,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

function events(payload: string): Ev[] {
  const all = payload.trim().split("\n").map((l) => JSON.parse(l) as Ev);
  expect(all.filter((e) => TERMINAL.has(e.t))).toHaveLength(1);
  return all.filter((e) => e.t !== "receipt");
}

let app: FastifyInstance;
const logged: Array<{ obj: Record<string, any>; msg: string }> = [];
beforeAll(async () => {
  app = await buildApp();
  app.addHook("onRequest", async (req) => {
    const info = req.log.info.bind(req.log);
    req.log.info = ((obj: unknown, msg?: string) => {
      if (obj && typeof obj === "object") logged.push({ obj: obj as Record<string, any>, msg: String(msg ?? "") });
      return (info as (o: unknown, m?: string) => void)(obj, msg);
    }) as typeof req.log.info;
  });
  await app.ready();
  // The run needs a yes to AI services (privacy/aiGate.ts), as the desktop's person gives it.
  const consent = await app.inject({ method: "PUT", url: "/v1/you/ai-consent", payload: { agree: true } });
  expect(consent.statusCode).toBeLessThan(300);
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
  llm.calls.length = 0;
  llm.plans.clear();
  llm.plan = ["DONE"];
  logged.length = 0;
});

async function postClip(over: Record<string, unknown> = {}, files: FilePart[] = [clipPart()]) {
  const res = await app.inject({ method: "POST", url: "/v1/agent", ...form(JSON.stringify(step({ video: { seconds: 6, sound: true }, ...over })), files) });
  return { status: res.statusCode, payload: res.payload, evs: res.statusCode === 200 ? events(res.payload) : [] };
}
const streamCalls = () => llm.calls.filter((c) => c.body.stream);
const userParts = (i = 0) => streamCalls()[i]!.body.messages[1].content as Array<Record<string, any>>;

describe("the clip's part, as read", () => {
  it("a WebM or an MP4 by its bytes, whatever codecs the label names", () => {
    expect(sniffClip(webm())).toBe("video/webm");
    expect(sniffClip(mp4())).toBe("video/mp4");
    expect(sniffClip(jpeg())).toBeNull();
    expect(readClip("video/webm;codecs=vp9,opus", webm(), 10_000)).toEqual({ video: { mime: "video/webm", data: webm() } });
    // An MP4 labelled WebM arrives as what it is.
    expect(readClip("video/webm", mp4(), 10_000)).toMatchObject({ video: { mime: "video/mp4" } });
    expect(readClip("video/webm", null, 10_000)).toMatchObject({ refusal: { status: 413, code: "too_large" } });
    expect(readClip("video/quicktime", webm(), 10_000)).toMatchObject({ refusal: { status: 400 } });
    expect(readClip("video/webm", Buffer.from("not a video at all"), 10_000)).toMatchObject({ refusal: { status: 400 } });
  });

  it("the step says how long it is and whether it has sound; a clip is always of the whole window, and carries no page", () => {
    const caps = { maxElements: 250, screenMaxChars: 24_000 };
    const page = { text: "x".repeat(100), outline: [], where: "", source: "tree", truncated: false };
    const read = readStepRequest(step({ utterance: "what's happening?", video: { seconds: 6.4, sound: true }, picture: { region: "element" }, page }), caps, false, false, true);
    expect("req" in read && read.req.video).toEqual({ seconds: 6, sound: true });
    expect("req" in read && read.req.picture).toEqual({ region: "window" });
    expect("req" in read && read.req.page).toBeUndefined();
    // Anything odd is the plainer claim: a few seconds, no sound.
    const odd = readStepRequest(step({ utterance: "what's happening?", video: { seconds: 999, sound: "yes" } }), caps, false, false, true);
    expect("req" in odd && odd.req.video).toEqual({ seconds: 30, sound: false });
    // Without a clip, `video` describes nothing and is dropped.
    const none = readStepRequest(step({ utterance: "hi", video: { seconds: 6, sound: true } }), caps);
    expect("req" in none && none.req.video).toBeUndefined();
  });
});

describe("the clip path: what the model that watches is sent", () => {
  it("the clip as a video_url data URL, then what it is, the screen and what they said", async () => {
    llm.plan = ["SAY A cat jumps onto the table and knocks a glass off.\nSAY Someone laughs.\nPOINT e1 | Pause\nDONE"];
    const data = webm(6000, 9);
    const res = await postClip({ utterance: "what's happening in this video?" }, [clipPart(data)]);
    expect(res.status).toBe(200);
    expect(res.evs).toEqual([
      { t: "heard", text: "what's happening in this video?", mode: "show" },
      { t: "say", text: "A cat jumps onto the table and knocks a glass off." },
      { t: "say", text: "Someone laughs.", append: true },
      { t: "point", id: "e1", caption: "Pause" },
      { t: "done" },
    ]);
    expect(streamCalls()).toHaveLength(1);
    const call = streamCalls()[0]!;
    expect(call.body.model).toBe("google/gemini-3.8-flash");
    // The picture reader's system prompt, the same bytes: the message says it is a clip.
    expect(call.body.messages[0].content).toBe(VISION);
    const parts = userParts();
    expect(parts[0]).toEqual({ type: "video_url", video_url: { url: `data:video/webm;base64,${data.toString("base64")}` } });
    const text = String(parts[1]!.text);
    expect(text.split("\n")[0]).toBe(
      "App: VLC. The picture is a 6-second clip of the whole window, recorded just now while it played, with the computer's own sound. "
      + "Answer about what happens in it over those seconds, and what is heard in it, not about one frame.",
    );
    expect(text).toMatch(/mark only ids/);
    expect(text).not.toMatch(/Places in the picture/);
    expect(text).toContain('<screen>\ne1 button "Pause" @b');
    expect(text.endsWith("<said>what's happening in this video?</said>")).toBe(true);
    // Streamed, bounded, unretried, with the picture path's budget and provider preference, and the clip's own timeout.
    expect(call.body.stream).toBe(true);
    expect(call.body.max_tokens).toBeGreaterThanOrEqual(450);
    expect(call.body.provider).toEqual({ data_collection: "deny", sort: "latency" });
    expect(call.opts).toMatchObject({ maxRetries: 0, timeout: 700 });
  });

  it("says so when there was no sound to send", async () => {
    await postClip({ utterance: "what is this clip?", video: { seconds: 5, sound: false } });
    const first = String(userParts()[1]!.text).split("\n")[0];
    expect(first).toContain("5-second clip of the whole window");
    expect(first).toContain("without sound");
    expect(first).not.toContain("heard");
  });

  it("an MP4 goes as one", async () => {
    await postClip({ utterance: "what's going on?" }, [clipPart(mp4(), "video/mp4", "clip.mp4")]);
    expect(String(userParts()[0]!.video_url.url).startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("marks name ids only: a place in a moving picture is dropped", async () => {
    llm.plan = ["SAY The ball.\nDRAW CIRCLE [400,400,500,500] \"ball\"\nDRAW BOX e2 \"seek\"\nDONE"];
    const res = await postClip({ utterance: "what's happening?" });
    expect(res.evs.filter((e) => e.t === "draw")).toEqual([{ t: "draw", kind: "box", target: { id: "e2" }, text: "seek" }]);
  });

  it("climbs the clip ladder (models that take video, and no text-only model under them) on a failure before any output", async () => {
    expect(videoLadder()).toEqual(["google/gemini-3.8-flash", "google/gemini-2.5-flash"]);
    llm.plans.set("google/gemini-3.8-flash", "throw");
    llm.plan = ["SAY A goal is scored.\nDONE"];
    const res = await postClip({ utterance: "what just happened?" });
    expect(res.evs.map((e) => e.t)).toEqual(["heard", "say", "done"]);
    expect(streamCalls().map((c) => c.body.model)).toEqual(["google/gemini-3.8-flash", "google/gemini-2.5-flash"]);
    for (const c of streamCalls()) expect(c.body.messages[1].content[0].type).toBe("video_url");
  });

  it("every model down: said plainly, and nothing goes to a model that cannot watch", async () => {
    llm.plan = "throw";
    const res = await postClip({ utterance: "what's happening?" });
    expect(res.evs.at(-1)).toMatchObject({ t: "error", code: "model_unavailable" });
    expect(streamCalls().map((c) => c.body.model)).toEqual(["google/gemini-3.8-flash", "google/gemini-2.5-flash"]);
  });

  it("is checked against the day's pictures, counted once answered, and logged without the clip or what was said", async () => {
    quota.asked.length = 0;
    quota.pictures = 0;
    llm.plan = ["SAY A dog runs.\nDONE"];
    const data = webm(7000, 4);
    await postClip({ utterance: "what is the dog doing in this video?" }, [clipPart(data)]);
    expect(quota.asked).toEqual([{ agentAudio: false, picture: true }]);
    expect(quota.pictures).toBe(1);
    await vi.waitFor(() => expect(logged.some((l) => l.msg === "agent step")).toBe(true));
    const call = logged.find((l) => l.msg === "agent model call")!.obj.agent;
    expect(call).toMatchObject({ model: "google/gemini-3.8-flash", outcome: "ok", picture: true, video: true });
    const line = logged.find((l) => l.msg === "agent step")!.obj.agent;
    expect(line).toMatchObject({ path: "video", mode: "show", video: true, videoBytes: 7000, videoSeconds: 6, videoSound: true, ending: "done" });
    const all = JSON.stringify(logged.filter((l) => l.msg !== "incoming request" && l.msg !== "request completed"));
    expect(all).not.toContain(data.toString("base64").slice(0, 40));
    expect(all).not.toMatch(/dog doing/);
  });
});

describe("the clip path: refused where a picture is, and from a private window", () => {
  it("an off-limits screen or a sensitive app: one error event, and no model is asked", async () => {
    const off = await postClip({ privateField: true, utterance: "what's happening?" });
    expect(off.evs).toEqual([{ t: "error", code: "private", message: expect.any(String) }]);
    const bank = await postClip({ app: "Chase Bank", utterance: "what's happening?" });
    expect(bank.evs).toEqual([{ t: "error", code: "private", message: expect.any(String) }]);
    expect(llm.calls).toHaveLength(0);
  });

  it("a private window's clip: the second lock (the desktop never records one)", async () => {
    const res = await postClip({ app: "Chrome", privateWindow: true, utterance: "what's happening in this video?" });
    expect(res.evs).toEqual([{ t: "error", code: "private", message: expect.any(String) }]);
    expect(llm.calls).toHaveLength(0);
  });
});

describe("the clip part's caps", () => {
  it("413 above AGENT_VIDEO_MAX_BYTES, and nothing is asked", async () => {
    const res = await postClip({ utterance: "what's happening?" }, [clipPart(webm(200_001))]);
    expect(res.status).toBe(413);
    expect(JSON.parse(res.payload)).toMatchObject({ code: "too_large" });
    expect(llm.calls).toHaveLength(0);
  });

  it("a clip right at the cap is fine, though it is far past the picture's", async () => {
    const res = await postClip({ utterance: "what's happening?" }, [clipPart(webm(200_000))]);
    expect(res.status).toBe(200);
  });

  it.each([
    ["a QuickTime file", clipPart(webm(), "video/quicktime", "clip.mov")],
    ["a picture called a clip", clipPart(jpeg(), "video/webm", "clip.webm")],
    ["an empty part", clipPart(Buffer.alloc(0))],
  ])("400 for %s", async (_name, part) => {
    const res = await postClip({ utterance: "what's happening?" }, [part]);
    expect(res.status).toBe(400);
    expect(llm.calls).toHaveLength(0);
  });

  it("400 for a second clip, or a clip beside a picture", async () => {
    const two = await postClip({ utterance: "what's happening?" }, [clipPart(), clipPart()]);
    expect(two.status).toBe(400);
    expect(JSON.parse(two.payload).message).toMatch(/one clip/i);
    const both = await postClip({ utterance: "what's happening?" }, [picturePart(), clipPart()]);
    expect(both.status).toBe(400);
    expect(JSON.parse(both.payload).message).toMatch(/picture or a clip/i);
    const other = await postClip({ utterance: "what's happening?" }, [clipPart(), picturePart()]);
    expect(other.status).toBe(400);
    expect(llm.calls).toHaveLength(0);
  });
});
