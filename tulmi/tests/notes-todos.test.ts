/**
 * A MEETING'S TO-DOS AND DECISIONS (src/notes/extract.ts, routes/notes.ts), against a fake OpenRouter behind the real
 * model gateway. Nothing here reaches a network.
 *
 *   - read once per meeting when it stops, beside the writer, on the cheap tier (the indic tier for a meeting mostly in
 *     Devanagari), with a short prompt that keeps the meeting's language;
 *   - never twice for one transcript: a second finish, organising again, the page asking, two asks at once;
 *   - the answer cut to shape: labels kept as labels, "none" is nobody, duplicates gone, at most twenty;
 *   - a failed read is kept as failed, and tried again only after a while;
 *   - ticking a to-do off is kept, survives a new read of the same to-do, counts in the list and the week's numbers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

const heard: { text: string } = { text: "" };
vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({ text: heard.text, durationSeconds: 30 })),
  estimateDurationSeconds: () => 0,
}));
vi.mock("../src/notes/organise.js", async (orig) => ({
  ...(await orig<typeof import("../src/notes/organise.js")>()),
  organise: vi.fn(async () => ({
    title: "Salon booking app review", summary: "Reminders move to WhatsApp.",
    highlights: [{ speaker: "Speaker 1", text: "Weekends have the most no-shows." }],
    people: [{ label: "Speaker 1", name: "Kavya" }],
  })),
}));

// eslint-disable-next-line import/first
import { MAX_TODOS, findWork, needsFinding, resetFindForTests, RETRY_AFTER_MS, setFindGateway, shapeFound, tierFor, transcriptHash } from "../src/notes/extract.js";
// eslint-disable-next-line import/first
import { notesStats } from "../src/notes/stats.js";
// eslint-disable-next-line import/first
import { resetNotesForTests } from "../src/notes/store.js";
// eslint-disable-next-line import/first
import { notesWork, resetNotesRoutesForTests } from "../src/routes/notes.js";
// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";

/** An OpenRouter that answers every call with `reply()`, and writes down what it was asked. */
function fakeRouter(reply: () => unknown) {
  const calls: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  return {
    calls,
    chat: { completions: { create: async (body: any) => {
      calls.push({ model: body.model, messages: body.messages });
      const r = reply();
      if (r instanceof Error) throw r;
      return { choices: [{ message: { content: typeof r === "string" ? r : JSON.stringify(r) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0002 } };
    } } },
  };
}

const quiet = { info: () => {}, warn: () => {} };
const use = (router: ReturnType<typeof fakeRouter>) => setFindGateway({ client: router, breakers: null, ledger: null, log: quiet, sleep: async () => {} });

const ANSWER = {
  todos: [
    { text: "Move booking reminders to WhatsApp", who: "you", when: "" },
    { text: "Check how deposit refunds reach the bank", who: "Rohan", when: "by Friday" },
    { text: "move booking reminders to WhatsApp.", who: "You", when: "" },
    { text: "Pick a date for the launch shoot", who: "none", when: "N/A" },
  ],
  decisions: ["Weekend slots need a ₹200 UPI deposit", "Launch on Saturday, 8 November"],
};

describe("what a read gives back", () => {
  it("is cut to shape: labels stay labels, nobody is nobody, the same to-do once, at most twenty", () => {
    const f = shapeFound([ANSWER as never], new Set(["You", "Speaker 1"]));
    expect(f.todos).toEqual([
      { id: "t1", text: "Move booking reminders to WhatsApp", who: "You", done: false },
      { id: "t2", text: "Check how deposit refunds reach the bank", who: "Rohan", when: "by Friday", done: false },
      { id: "t3", text: "Pick a date for the launch shoot", done: false },
    ]);
    expect(f.decisions).toEqual(["Weekend slots need a ₹200 UPI deposit", "Launch on Saturday, 8 November"]);
    const many = shapeFound([{ todos: Array.from({ length: 40 }, (_, i) => ({ text: `Task ${i}` })), decisions: [{ text: "- Ship it" }, "", "ship it"] } as never], new Set());
    expect(many.todos).toHaveLength(MAX_TODOS);
    expect(many.decisions).toEqual(["Ship it"]);
    expect(shapeFound([{} as never], new Set())).toEqual({ todos: [], decisions: [] });
  });
  it("goes to the indic tier when the meeting is mostly in an Indian script; Hinglish stays on the cheap one", () => {
    expect(tierFor(["[0:01] You: कल तक रिपोर्ट भेज देना, ठीक है?"])).toBe("indic");
    expect(tierFor(["[0:01] You: Kal tak report bhej dena, theek hai?"])).toBe("cheap");
    expect(tierFor(["[0:01] You: Send the report by tomorrow."])).toBe("cheap");
  });
  it("is kept against the transcript's hash, and a failed read waits before it is tried again", () => {
    const t = [{ at: 0, text: "Send it", speaker: "You" }];
    const h = transcriptHash(t);
    expect(transcriptHash([...t, { at: 5, text: "  " }])).toBe(h);
    expect(transcriptHash([{ at: 0, text: "Send it today", speaker: "You" }])).not.toBe(h);
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(needsFinding({ status: "ready", transcript: t }, now)).toBe(true);
    expect(needsFinding({ status: "recording", transcript: t }, now)).toBe(false);
    expect(needsFinding({ status: "ready", transcript: [] }, now)).toBe(false);
    expect(needsFinding({ status: "ready", transcript: t, found: { hash: h, at: new Date(now).toISOString(), ok: true } }, now)).toBe(false);
    expect(needsFinding({ status: "ready", transcript: t, found: { hash: "old", at: new Date(now).toISOString(), ok: true } }, now)).toBe(true);
    expect(needsFinding({ status: "ready", transcript: t, found: { hash: h, at: new Date(now - 60_000).toISOString(), ok: false } }, now)).toBe(false);
    expect(needsFinding({ status: "ready", transcript: t, found: { hash: h, at: new Date(now - RETRY_AFTER_MS).toISOString(), ok: false } }, now)).toBe(true);
  });
  it("counts the week: meetings, time, the people named once each, and every open to-do", () => {
    const now = Date.parse("2026-10-28T10:00:00Z");
    const base = { status: "ready" as const, words: 1, title: "", summary: "", organised: true };
    const s = notesStats([
      { ...base, id: "a", startedAt: new Date(now - 3_600_000).toISOString(), durationSeconds: 2520, people: [{ label: "Speaker 1", name: "Kavya" }, { label: "Speaker 2", name: "Rohan" }], todos: 4, openTodos: 3 },
      { ...base, id: "b", startedAt: new Date(now - 86_400_000).toISOString(), durationSeconds: 960, people: [{ label: "Speaker 1", name: "kavya" }], openTodos: 1, todos: 2 },
      { ...base, id: "c", status: "recording", startedAt: new Date(now - 60_000).toISOString(), durationSeconds: 60, people: [] },
      { ...base, id: "d", startedAt: new Date(now - 9 * 86_400_000).toISOString(), durationSeconds: 600, people: [{ label: "Speaker 1", name: "Meera" }], openTodos: 2, todos: 2 },
    ], now);
    expect(s).toEqual({ week: { meetings: 3, seconds: 3540, people: 2 }, openTodos: 6, recording: true, organising: 0 });
  });
});

describe("a meeting's to-dos, through the routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { resetNotesForTests(); resetNotesRoutesForTests(); resetFindForTests(); });

  const upload = (id: string, at: number) => {
    const b = "----notes";
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="track"\r\n\r\nmic\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="at"\r\n\r\n${at}\r\n`),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      Buffer.from("audio".padEnd(2048, ".")),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    return app.inject({ method: "POST", url: `/v1/notes/${id}/audio`, payload: body, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
  };
  const meeting = async (words = "Reminders go on WhatsApp. Rohan will check the refunds by Friday.") => {
    const id = (await app.inject({ method: "POST", url: "/v1/notes" })).json().note.id as string;
    heard.text = words;
    await upload(id, 0);
    return id;
  };
  const finish = async (id: string, path = "finish") => {
    await app.inject({ method: "POST", url: `/v1/notes/${id}/${path}`, payload: {} });
    await notesWork(id);
  };
  const get = async (id: string) => (await app.inject({ method: "GET", url: `/v1/notes/${id}` })).json();

  it("reads the to-dos and decisions once when the meeting stops, on the cheap tier, in a short prompt that keeps its language", async () => {
    const router = fakeRouter(() => ANSWER);
    use(router);
    const id = await meeting();
    await finish(id);
    expect(router.calls).toHaveLength(1);
    expect(router.calls[0]!.model).toBe("deepseek/deepseek-v4.1-flash");
    const system = router.calls[0]!.messages[0]!.content;
    expect(system.length).toBeLessThan(2000);
    expect(system).toContain("Do not translate");
    expect(router.calls[0]!.messages[1]!.content).toContain("<transcript>");
    const { note, finding } = await get(id);
    expect(finding).toBe(false);
    expect(note.title).toBe("Salon booking app review");
    expect(note.todos.map((t: { text: string }) => t.text)).toEqual(["Move booking reminders to WhatsApp", "Check how deposit refunds reach the bank", "Pick a date for the launch shoot"]);
    expect(note.decisions).toHaveLength(2);
    expect(note.found).toMatchObject({ ok: true, hash: transcriptHash(note.transcript) });

    // Never twice for the same transcript: organising again, the page asking, two asks at once.
    await finish(id, "organise");
    const asks = await Promise.all([1, 2].map(() => app.inject({ method: "POST", url: `/v1/notes/${id}/find` })));
    expect(asks.map((a) => a.json())).toEqual([{ finding: false }, { finding: false }]);
    expect(router.calls).toHaveLength(1);
  });

  it("ticks a to-do off (and back), and the list and the week's numbers count what is open", async () => {
    use(fakeRouter(() => ANSWER));
    const id = await meeting();
    await finish(id);
    const t = await app.inject({ method: "POST", url: `/v1/notes/${id}/todos/t2`, payload: { done: true } });
    expect(t.statusCode).toBe(200);
    expect(t.json().todo).toMatchObject({ id: "t2", done: true });
    expect(t.json().todo.doneAt).toBeTruthy();
    expect((await get(id)).note.todos[1]).toMatchObject({ done: true });
    const list = (await app.inject({ method: "GET", url: "/v1/notes" })).json().notes;
    expect(list[0]).toMatchObject({ todos: 3, openTodos: 2, decisions: 2 });
    expect(list[0].transcript).toBeUndefined();
    const stats = (await app.inject({ method: "GET", url: "/v1/notes/stats" })).json();
    expect(stats).toMatchObject({ openTodos: 2, recording: false, week: { meetings: 1 } });
    const back = await app.inject({ method: "POST", url: `/v1/notes/${id}/todos/t2`, payload: { done: false } });
    expect(back.json().todo).toEqual({ id: "t2", text: "Check how deposit refunds reach the bank", who: "Rohan", when: "by Friday", done: false });
    expect((await app.inject({ method: "POST", url: `/v1/notes/${id}/todos/t9`, payload: { done: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/notes/${id}/todos/t1`, payload: { done: "yes" } })).statusCode).toBe(400);
  });

  it("a read that fails is kept as failed, not tried on every ask, and the meeting is still written up", async () => {
    const router = fakeRouter(() => Object.assign(new Error("400 bad"), { status: 400 }));
    use(router);
    const id = await meeting();
    await finish(id);
    const { note } = await get(id);
    expect(note.status).toBe("ready");
    expect(note.found).toMatchObject({ ok: false });
    expect(note.todos).toBeUndefined();
    const tried = router.calls.length;
    expect(tried).toBeGreaterThan(0);
    expect((await app.inject({ method: "POST", url: `/v1/notes/${id}/find` })).json()).toEqual({ finding: false });
    expect(router.calls).toHaveLength(tried);
  });

  it("an older meeting with nothing read yet is read when its page asks, once", async () => {
    use(fakeRouter(() => Object.assign(new Error("400 bad"), { status: 400 })));
    const id = await meeting();
    await finish(id);
    // Pretend the failed read was long ago: the next ask may try again.
    const router = fakeRouter(() => ({ todos: [{ text: "Send Meera the price list", who: "You" }], decisions: [] }));
    use(router);
    vi.useFakeTimers({ now: Date.now() + RETRY_AFTER_MS + 1000, toFake: ["Date"] });
    try {
      const r = await app.inject({ method: "POST", url: `/v1/notes/${id}/find` });
      expect(r.statusCode).toBe(202);
      expect(r.json()).toEqual({ finding: true });
      await findWork(id);
    } finally { vi.useRealTimers(); }
    const { note } = await get(id);
    expect(note.todos).toEqual([{ id: "t1", text: "Send Meera the price list", who: "You", done: false }]);
    expect(router.calls).toHaveLength(1);
  });

  it("a meeting mostly in Devanagari goes to the indic tier, and its words come back as they were written", async () => {
    const router = fakeRouter(() => ({ todos: [{ text: "कल तक रिपोर्ट भेजना", who: "You", when: "कल तक" }], decisions: ["लॉन्च शनिवार को"] }));
    use(router);
    const id = await meeting("कल तक रिपोर्ट भेज देना, और लॉन्च शनिवार को होगा।");
    await finish(id);
    const { note } = await get(id);
    expect(note.todos[0]).toMatchObject({ text: "कल तक रिपोर्ट भेजना", when: "कल तक" });
    expect(note.decisions).toEqual(["लॉन्च शनिवार को"]);
    expect(router.calls).toHaveLength(1);
  });
});
