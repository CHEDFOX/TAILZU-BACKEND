/**
 * AN ANSWER AS IT IS WRITTEN: the words and steps of an ask, to the one person who asked, over the live channel
 * (src/live/askStream.ts), the gateway that streams them (src/code/brain/gateway.ts `onText`), and the front door that carries them
 * (src/routes/front.ts, streamId; POST /v1/ask/stop).
 *
 * What these hold down:
 *   - words go out whole: a piece ends at a space, never inside a word (Devanagari, an emoji), numbered, in order;
 *   - nothing more goes once the words look like a secret, and what went is taken back; a reset starts over; `whole` only when nothing went;
 *   - the steps are a few words from real stages, each said once;
 *   - only the person's own ask can be stopped;
 *   - the gateway streams: each piece to onText, the answer whole as before; a model that fails after writing is reset before the next;
 *     a stopped stream is charged for what it used;
 *   - POST /v1/ask with a streamId: the words and the steps reach the asker's live events, the answer is the same; a stop answers 409
 *     `stopped` with what was written.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { openAskStream, stopAsk, sendable, stepWords, streamTopic, openAsks } = await import("../src/live/askStream.js");
const { LiveBus, live } = await import("../src/live/bus.js");
const { callModel } = await import("../src/code/brain/gateway.js");
const { buildTierTable } = await import("../src/code/brain/tiers.js");
const { registerFrontRoutes, FRONT_BODY_LIMIT } = await import("../src/routes/front.js");
const { createFront } = await import("../src/front/index.js");
const { MemoryFrontStore } = await import("../src/front/store.js");
const { AttachmentRegistry } = await import("../src/front/attachments.js");
const { Guard } = await import("../src/guard/index.js");
const { noModel, fakeHandlers } = await import("./front-rig.js");

type Piece = { n: number; text?: string; step?: string; reset?: true; end?: true };

/** A bus that keeps what it was given, and timers the test runs by hand. */
function rig(guard?: (t: string) => boolean) {
  const bus = new LiveBus();
  const got: Array<{ topic: string; data: Piece }> = [];
  bus.subscribe("asha", (e) => got.push({ topic: e.topic, data: e.data as Piece }));
  const timers: Array<() => void> = [];
  const tick = () => { while (timers.length) timers.shift()!(); };
  return { bus, got, tick, opts: { bus, setTimer: (fn: () => void) => { timers.push(fn); return fn; }, clearTimer: (h: unknown) => { const i = timers.indexOf(h as () => void); if (i >= 0) timers.splice(i, 1); }, ...(guard ? { guard } : {}) } };
}
const ID = "s_0123456789abcdefXYZ";
const words = (got: Array<{ data: Piece }>) => got.map((g) => g.data.text ?? "").join("");

describe("the stream of one ask", () => {
  it("sends whole words, in order, numbered; never half of a Devanagari word or an emoji", () => {
    const r = rig();
    const s = openAskStream("asha", ID, r.opts)!;
    expect(s).not.toBeNull();
    const hindi = "नमस्ते, आपका क्षेत्र कल सुबह ठीक रहेगा 🙂🙂 धन्यवाद।";
    // The model's pieces cut anywhere, inside a cluster too (code units, not graphemes).
    const cuts = [3, 7, 8, 15, 16, 22, 30, 31, 40, 41, 44];
    let at = 0;
    for (const c of [...cuts, hindi.length]) { s.text(hindi.slice(at, c)); at = c; r.tick(); }
    s.end();
    const texts = r.got.filter((g) => g.data.text).map((g) => g.data.text!);
    expect(texts.join("")).toBe(hindi);
    // Every piece but the last ends with a space: no word, conjunct or emoji is cut.
    for (const t of texts.slice(0, -1)) expect(t).toMatch(/\s$/);
    expect(r.got.map((g) => g.data.n)).toEqual(r.got.map((_g, i) => i));
    expect(r.got.every((g) => g.topic === streamTopic(ID))).toBe(true);
    expect(r.got.at(-1)!.data.end).toBe(true);
    expect(r.got.find((g) => g.data.step)?.data.step).toBe("Writing it up…");
  });

  it("lets a long run with no space go a grapheme short of its end", () => {
    expect(sendable("hello wor")).toBe(6);
    expect(sendable("nospace")).toBe(0);
    const long = "x".repeat(170) + "क्ष";
    const k = sendable(long);
    expect(k).toBe(170);
    expect(sendable("abc", true)).toBe(3);
  });

  it("stops sending, and takes back what went, once the words look like a secret; a reset starts over; whole only when nothing went", () => {
    const r = rig((t) => /tzb_[A-Za-z0-9_-]{16,}/.test(t));
    const s = openAskStream("asha", ID + "a", r.opts)!;
    s.text("Your key is ");
    r.tick();
    s.text("tzb_abcdefghijklmnopqrstu and more ");
    r.tick();
    expect(r.got.some((g) => g.data.reset)).toBe(true);
    expect(r.got.filter((g) => g.data.text).map((g) => g.data.text)).toEqual(["Your key is "]);
    s.text("nothing more goes ");
    r.tick();
    expect(r.got.filter((g) => g.data.text)).toHaveLength(1);
    s.reset();
    s.whole("Fresh and whole.");
    expect(words(r.got)).toBe("Your key is Fresh and whole.");
    s.whole("Not again.");
    s.end();
    expect(words(r.got)).toBe("Your key is Fresh and whole.");
  });

  it("says what it is doing in a few words, once each, from real stages only", () => {
    expect(stepWords("code:read:src/shop/cart.ts")).toBe("Looking at cart.ts…");
    expect(stepWords("code:locate")).toBe("Reading the project…");
    expect(stepWords("tool:web_search")).toBe("Searching the web…");
    expect(stepWords("something new")).toBeNull();
    const r = rig();
    const s = openAskStream("asha", ID + "b", r.opts)!;
    s.step("thinking"); s.step("thinking"); s.step("nonsense"); s.step("code:read:a/b.ts");
    expect(r.got.map((g) => g.data.step)).toEqual(["Thinking…", "Looking at b.ts…"]);
    s.end();
  });

  it("is stopped only by the person who asked, and only while it is out", () => {
    const r = rig();
    const s = openAskStream("asha", ID + "c", r.opts)!;
    expect(openAskStream("asha", ID + "c", r.opts)).toBeNull();
    expect(openAskStream("asha", "short", r.opts)).toBeNull();
    expect(stopAsk("ravi", ID + "c")).toBe(false);
    expect(s.stopped).toBe(false);
    expect(stopAsk("asha", ID + "c")).toBe(true);
    expect(s.stopped && s.signal.aborted).toBe(true);
    s.end();
    expect(stopAsk("asha", ID + "c")).toBe(false);
  });
});

// ------------------------------------------------------------------ the gateway

const table = buildTierTable({
  tiers: JSON.stringify({ cheap: { models: ["a/one", "b/two"], maxTokens: 400, reasoning: "none", timeoutMs: 5000, usdPerMIn: 2, usdPerMOut: 10 } }),
});

/** A stream of chunks, as the SDK hands one back; `fail` throws after that many chunks. */
function chunks(parts: string[], o: { fail?: number; usage?: Record<string, unknown>; signal?: AbortSignal; wait?: Promise<void> } = {}): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < parts.length; i++) {
        if (o.fail === i) throw Object.assign(new Error("terminated"), { status: 502 });
        if (o.wait && i === 1) await o.wait;
        if (o.signal?.aborted) throw Object.assign(new Error("Request was aborted."), { name: "AbortError" });
        yield { choices: [{ delta: { content: parts[i] } }] };
      }
      yield { choices: [{ delta: {}, finish_reason: "stop" }], usage: o.usage ?? { prompt_tokens: 50, completion_tokens: 10, cost: 0.0004 }, provider: "Test" };
    },
  };
}

describe("the gateway streams when asked", () => {
  const input = { tier: "cheap" as const, purpose: "test", budget: "none" as const, userId: "asha", messages: [{ role: "user" as const, content: "hi" }] };

  it("hands each piece on as it comes and answers whole, as before", async () => {
    const asked: any[] = [];
    const client = { chat: { completions: { create: async (body: any) => { asked.push(body); return chunks(["Hel", "lo ", "there."]); } } } };
    const pieces: string[] = [];
    const r = await callModel({ ...input, onText: (p) => pieces.push(p) }, { client, tiers: table, ledger: null, breakers: null, log: { info() {}, warn() {} } });
    expect(asked[0].stream).toBe(true);
    expect(pieces).toEqual(["Hel", "lo ", "there."]);
    expect(r.text).toBe("Hello there.");
    expect(r.costSource).toBe("reported");
    // Without onText: no stream asked for.
    const plain = { chat: { completions: { create: async (body: any) => { asked.push(body); return { choices: [{ message: { content: "Whole." } }], usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.0001 } }; } } } };
    await callModel(input, { client: plain, tiers: table, ledger: null, breakers: null, log: { info() {}, warn() {} } });
    expect(asked[1].stream).toBeUndefined();
  });

  it("takes back the words of a model that failed after writing, before the next one writes", async () => {
    let n = 0;
    const client = { chat: { completions: { create: async () => (n++ < 2 ? chunks(["Half ", "an ", "answer"], { fail: 2 }) : chunks(["A ", "whole ", "one."])) } } };
    const seen: string[] = [];
    const r = await callModel({ ...input, onText: (p) => seen.push(p), onReset: () => seen.push("<reset>") },
      { client, tiers: table, ledger: null, breakers: null, sleep: async () => {}, log: { info() {}, warn() {} } });
    expect(r.text).toBe("A whole one.");
    expect(seen.join("|")).toBe("Half |an |<reset>|Half |an |<reset>|A |whole |one.");
  });

  it("is charged for what it used when it is stopped while it streams", async () => {
    const ctrl = new AbortController();
    let release!: () => void;
    const wait = new Promise<void>((res) => { release = res; });
    const client = { chat: { completions: { create: async (_b: any, o: { signal: AbortSignal }) => chunks(["Some ", "words ", "more"], { signal: o.signal, wait }) } } };
    const lines: any[] = [];
    const run = callModel({ ...input, signal: ctrl.signal, onText: () => { if (!ctrl.signal.aborted) setTimeout(() => { ctrl.abort(); release(); }, 0); } },
      { client, tiers: table, ledger: null, breakers: null, log: { info: (o) => lines.push(o), warn() {} } });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    const charged = lines.find((l) => l.outcome === "stopped");
    expect(charged).toBeTruthy();
    expect(charged.paise).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ the front door

describe("POST /v1/ask with a streamId", () => {
  async function served(reply: Parameters<typeof fakeHandlers>[0]["reply"]) {
    const guard = new Guard();
    const h = fakeHandlers({ reply });
    const front = createFront({ force: true, handlers: h.handlers, store: new MemoryFrontStore(), guard, call: noModel().call, attachments: new AttachmentRegistry() });
    const app = Fastify({ bodyLimit: FRONT_BODY_LIMIT });
    const routes = registerFrontRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, front, guard });
    app.post("/v1/ask", async (req, rep) => routes.ask(req, rep, { id: String(req.headers.authorization).replace(/^Bearer\s+/, "") } as never));
    await app.ready();
    const got: Array<{ topic: string; data: Piece }> = [];
    const stop = live.subscribe("meera", (e) => got.push({ topic: e.topic, data: e.data as Piece }));
    const post = (url: string, payload: object, user = "meera") => app.inject({ method: "POST", url, headers: { authorization: `Bearer ${user}` }, payload });
    return { app, got, stop, post };
  }
  const BODY = { message: "what is the capital of France?", device: "phone", mode: "text" };

  it("sends the asker the words and what it is doing as they come; the answer is the same", async () => {
    const t = await served(async (c) => {
      for (const p of ["Paris ", "is ", "the ", "capital."]) c.onText?.(p);
      return { text: "Paris is the capital.", paise: 3 };
    });
    const id = "stream_abcdefghijklmnop1";
    const res = await t.post("/v1/ask", { ...BODY, streamId: id });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.text).toBe("Paris is the capital.");
    await vi.waitFor(() => expect(t.got.some((g) => g.data.end)).toBe(true));
    const mine = t.got.filter((g) => g.topic === `ask:${id}`);
    expect(words(mine)).toBe("Paris is the capital.");
    expect(mine.map((g) => g.data.step).filter(Boolean)).toContain("Thinking…");
    expect(openAsks()).toBe(0);
    // A bad id is refused before anything runs.
    expect((await t.post("/v1/ask", { ...BODY, streamId: "no" })).statusCode).toBe(400);
    t.stop();
  });

  it("stops when the person says so: 409 stopped, with what was written; another person cannot stop it", async () => {
    let letGo!: () => void;
    const held = new Promise<void>((r) => { letGo = r; });
    const t = await served(async (c) => {
      c.onText?.("Paris is ");
      await new Promise<void>((resolve, reject) => {
        c.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        void held.then(resolve);
      });
      return { text: "Paris is the capital.", paise: 3 };
    });
    const id = "stream_abcdefghijklmnop2";
    const out = t.post("/v1/ask", { ...BODY, message: "and Spain?", streamId: id });
    await vi.waitFor(() => expect(openAsks()).toBe(1));
    expect((await t.post("/v1/ask/stop", { id }, "ravi")).json()).toEqual({ stopped: false });
    expect((await t.post("/v1/ask/stop", { id })).json()).toEqual({ stopped: true });
    const res = await out;
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "stopped", text: "Paris is " });
    letGo();
    expect(openAsks()).toBe(0);
    t.stop();
  });
});
