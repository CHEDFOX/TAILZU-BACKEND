/**
 * DISPATCH (src/front/dispatch.ts): a Decision carried out on its road, with fakes for every road.
 *
 * What these hold down:
 *   - each route calls its own road, with the money it may spend and the person's words (a follow-up with the earlier turn's in front);
 *   - the visual goes beside the answer, made from the answer, and a visual that fails does not fail the answer: `notes` say what was left out;
 *   - an offer is a one-tap button in the result, not a thing made;
 *   - the self-check: a job or a deep research run needs 0.7, else the question goes back and nothing starts;
 *   - what streams is streamed, and the events are the same ones a repeat is shown;
 *   - the money: the road's share of the budget, the person's day, what the front door's own calls add to it;
 *   - time: a road that takes too long is a 504, a caller who goes away stops it;
 *   - the log: one row, no words; a similar message within a minute marks the one before as rephrased; a log that is down is a warning.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { decide } = await import("../src/front/decide.js");
const { dispatch, needsSelfCheck, SELF_CHECK_MIN, DEADLINES } = await import("../src/front/dispatch.js");
const { MemoryFrontStore } = await import("../src/front/store.js");
const { RephraseWatch, Learning } = await import("../src/front/learn.js");
const { AttachmentRegistry } = await import("../src/front/attachments.js");
const { FrontError } = await import("../src/front/types.js");
const { SpendMeter } = await import("../src/artifacts/limits.js");
const { buildTierTable } = await import("../src/code/brain/tiers.js");
const { ctx, inProject, model, noModel, decideJson, fakeHandlers, artifactRef, fileInput, PNG } = await import("./front-rig.js");
type Decision = import("../src/front/types.js").Decision;
type FrontEvent = import("../src/front/types.js").FrontEvent;

const tiers = buildTierTable();
const rules = (message: string, c = ctx()) => decide(message, c, { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000 });

/** The pieces dispatch is given, with a store and a watch of its own. */
function rig(over: Record<string, unknown> = {}) {
  const store = new MemoryFrontStore();
  const h = fakeHandlers(over.handlers as never);
  const events: FrontEvent[] = [];
  const daily = new SpendMeter(1500);
  const watch = new RephraseWatch();
  const deps = { handlers: h.handlers, store, watch, daily, learning: new Learning(store), ...over, ...{ handlers: h.handlers } } as Parameters<typeof dispatch>[3];
  const run = (d: Decision, message: string, c = ctx(), o: Parameters<typeof dispatch>[4] = {}) => dispatch(d, message, c, deps, { emit: (e) => events.push(e), ...o });
  return { store, h, events, daily, watch, run, deps };
}

describe("the roads", () => {
  it("replies for small talk and answers, with its share of the budget and the person's words, and says nothing it did not do", async () => {
    const t = rig();
    const d = await rules("what is the capital of France?");
    const { id, result } = await t.run(d, "what is the capital of France?");
    expect(t.h.calls.reply).toHaveLength(1);
    expect(t.h.calls.reply[0]).toMatchObject({ userId: "alice", message: "what is the capital of France?", files: [], maxPaise: d.budgetPaise });
    expect(result).toMatchObject({ text: "A reply.", artifacts: [], offers: [], notes: [], paise: 3 });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("puts a follow-up's earlier words in front of it, for the roads that make something of it", async () => {
    const t = rig();
    const c = ctx({ recent: [{ said: "show me a pricing page", did: "design" }] });
    const d = await decide("make it darker", c, { call: model(() => decideJson({ intent: "design", confidence: 0.8 })).call, tiers, fx: 88, jobBudgetPaise: 3000 });
    await t.run(d, "make it darker", c);
    expect(t.h.calls.artifact[0]!.message).toBe("show me a pricing page. make it darker");
  });

  it("answers a question about a project through the code-answer hook, and draws its flow beside it from the answer", async () => {
    const t = rig();
    const c = inProject();
    const d = await rules("how does the login flow work", c);
    const { result } = await t.run(d, "how does the login flow work", c);
    expect(t.h.calls.codeAnswer).toHaveLength(1);
    expect(result.text).toBe("It lives in src/auth/login.ts:12.");
    expect(t.h.calls.artifact).toHaveLength(1);
    expect(t.h.calls.artifact[0]).toMatchObject({ basis: "It lives in src/auth/login.ts:12.", visual: { kind: "diagram" } });
    expect(result.artifacts).toEqual([artifactRef("diagram")]);
    expect(result.paise).toBe(5 + 20);
  });

  it("starts a job for a change, on a branch, with the decision's budget; the reply says where", async () => {
    const t = rig();
    const c = inProject();
    const d = await rules("change the button color to red", c);
    const { result } = await t.run(d, "change the button color to red", c);
    expect(t.h.calls.codeJob).toHaveLength(1);
    expect(t.h.calls.codeJob[0]).toMatchObject({ message: "change the button color to red", maxPaise: d.budgetPaise });
    expect(result.job).toEqual({ id: "job-1", branch: "tailzu/fix-1a2b", state: "queued", budgetPaise: d.budgetPaise });
    expect(result.text).toContain("tailzu/fix-1a2b");
    expect(t.h.calls.reply).toHaveLength(0);
  });

  it("shows a design: the artifact is the answer, and the words say so", async () => {
    const t = rig();
    const c = inProject();
    const d = await rules("add a pricing card", c);
    const { result } = await t.run(d, "add a pricing card", c);
    expect(t.h.calls.artifact).toHaveLength(1);
    expect(t.h.calls.artifact[0]).toMatchObject({ visual: { kind: "component", isAnswer: true }, maxPaise: d.budgetPaise });
    expect(result.artifacts.map((a) => a.kind)).toEqual(["component"]);
    expect(result.text).toBe("Here it is. Tell me what you would change.");
    expect(t.events.find((e) => e.t === "artifact")).toBeDefined();
  });

  it("researches at the depth the decision named, and says what is missing or cut short", async () => {
    const t = rig({ handlers: { research: async (c: { depth: string }) => ({ text: `deep ${c.depth} [1]`, paise: 80, sources: [{ n: 1, title: "Docs", url: "https://d.example" }], confidence: 0.6, gaps: ["no benchmark", "no price"], partial: true }) } });
    const d = await rules("research vector databases with sources");
    const { result } = await t.run(d, "research vector databases with sources");
    expect(result.text).toBe("deep standard [1]");
    expect(result.sources).toEqual([{ n: 1, title: "Docs", url: "https://d.example" }]);
    expect(result.notes.join(" ")).toMatch(/incomplete: the research stopped early/);
    expect(result.notes.join(" ")).toMatch(/Still missing or unsure: no benchmark; no price/);
  });

  it("keeps a flow the chat drew from the import graph as it is: no model call to make the diagram, and the thread reaches the road", async () => {
    const flow = "flowchart TD\n  N1[\"routes/login.ts\"]\n  N2[\"auth/session.ts\"]\n  N1 --> N2";
    const seen: Array<{ threadId?: string }> = [];
    const t = rig({ handlers: { codeAnswer: async (c: { ctx: { threadId?: string } }) => { seen.push({ threadId: c.ctx.threadId }); return { text: "Login starts a session: src/routes/login.ts:4.", paise: 7, diagram: flow }; } } });
    const c = inProject({ threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const d = await rules("how does the login flow work", c);
    const { result } = await t.run(d, "how does the login flow work", c);
    expect(t.h.calls.artifact).toHaveLength(1);
    expect(t.h.calls.artifact[0]!.mermaid).toBe(flow);
    expect(result.artifacts).toHaveLength(1);
    expect(result.paise).toBe(7);
    expect(seen).toEqual([{ threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]);
  });

  it("hands the code roads the person's own words, whatever earlier words the decision folded in", async () => {
    const t = rig();
    const c = inProject({ recent: [{ said: "where is the session cookie set?", did: "code_question" }], threadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const d = await rules("ok, change it", c);
    expect(d).toMatchObject({ intent: "code_task", handoff: true });
    await t.run(d, "ok, change it", c);
    expect(t.h.calls.codeJob[0]).toMatchObject({ said: "ok, change it", message: "where is the session cookie set?. ok, change it" });
    expect(t.h.calls.codeJob[0]!.ctx.threadId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("plans, and draws the plan from its steps with no model: the diagram is handed to the artifact road as it is", async () => {
    const t = rig();
    const d = await rules("plan my week");
    expect(d.shape.visual).toMatchObject({ kind: "diagram", estPaise: 0 });
    const { result } = await t.run(d, "plan my week");
    expect(t.h.calls.plan).toHaveLength(1);
    expect(t.h.calls.artifact[0]!.mermaid).toMatch(/^flowchart TD/);
    expect(result.text).toBe("1. Start\n2. Finish");
    expect(result.artifacts).toHaveLength(1);
    expect(result.paise).toBe(6);
  });
});

describe("a visual beside the answer", () => {
  it("is part of the reply when it is a table: no second road", async () => {
    const t = rig();
    const d = await rules("compare Postgres vs MySQL for a small online shop");
    const { result } = await t.run(d, "compare Postgres vs MySQL for a small online shop");
    expect(t.h.calls.artifact).toEqual([]);
    expect(result.artifacts).toEqual([]);
    expect(t.h.calls.reply[0]!.decision.shape.visual).toMatchObject({ kind: "table", via: "inline" });
  });

  it("does not fail the answer when it cannot be made: the answer goes out, and the notes say what was left out", async () => {
    const t = rig({ handlers: { artifact: async () => { throw new FrontError("model_down", "No model could be reached just now.", 503); } } });
    const c = inProject();
    const d = await rules("how does the login flow work", c);
    const { result } = await t.run(d, "how does the login flow work", c);
    expect(result.text).toBe("It lives in src/auth/login.ts:12.");
    expect(result.artifacts).toEqual([]);
    expect(result.notes).toEqual(["I left out the diagram: No model could be reached just now."]);
  });

  it("does fail a design when the design cannot be made: the design is the answer", async () => {
    const t = rig({ handlers: { artifact: async () => { throw new FrontError("model_down", "No model could be reached just now.", 503); } } });
    const c = inProject();
    const d = await rules("add a pricing card", c);
    await expect(t.run(d, "add a pricing card", c)).rejects.toMatchObject({ code: "model_down", status: 503 });
  });

  it("is offered, one tap, when spoken or when the person likes to be asked: nothing is made, and the offer says how to take it", async () => {
    for (const c of [ctx({ mode: "voice" }), ctx({ visuals: "ask" })]) {
      const t = rig();
      const d = await rules("compare Postgres vs MySQL for a small online shop", c);
      const { result } = await t.run(d, "compare Postgres vs MySQL for a small online shop", c);
      expect(result.offers, JSON.stringify(c)).toEqual([{ kind: "table", label: "Show this as a table", request: { visual: "table" } }]);
      expect(t.h.calls.reply[0]!.decision.shape.visual?.offer).toBe(true);
    }
    const t = rig();
    const c = inProject({ visuals: "ask" });
    const d = await rules("explain the request flow of a web server in detail how it works step by step", c);
    const { result } = await t.run(d, "explain the request flow of a web server", c);
    expect(t.h.calls.artifact).toEqual([]);
    expect(result.offers.map((o) => o.kind)).toEqual([d.shape.visual!.kind]);
  });

  it("is offered in the person's language", async () => {
    const t = rig();
    const c = ctx({ mode: "voice" });
    const d = await rules("iPhone aur Samsung ka comparison karo", c);
    const { result } = await t.run(d, "iPhone aur Samsung ka comparison karo", c);
    expect(result.offers[0]!.label).toBe("Ise table mein dikhao");
  });
});

describe("the self-check", () => {
  const unsure = (d: Decision, confidence: number): Decision => ({ ...d, confidence });

  it("sends a job only when the decision is 0.7 sure; under that the question goes back and nothing starts", async () => {
    expect(SELF_CHECK_MIN).toBe(0.7);
    const c = inProject();
    const base = await rules("change the button color to red", c);
    expect(needsSelfCheck(base)).toBe(true);

    const t = rig();
    const asked = await t.run(unsure(base, 0.69), "change the button color to red", c);
    expect(asked.result.clarify).toBeDefined();
    expect(asked.result.clarify!.options.length).toBeGreaterThanOrEqual(2);
    expect(t.h.calls.codeJob).toEqual([]);
    expect(asked.result.paise).toBe(0);
    expect(asked.result.text).toBeUndefined();

    const go = await t.run(unsure(base, 0.7), "change the button color to red", c);
    expect(go.result.clarify).toBeUndefined();
    expect(t.h.calls.codeJob).toHaveLength(1);
  });

  it("asks before a deep research run, but not before a quick or a standard one", async () => {
    const deep = await rules("do a thorough, in-depth research on vector databases with sources");
    expect(deep.depth).toBe("deep");
    expect(needsSelfCheck(deep)).toBe(true);
    const t = rig();
    const asked = await t.run(unsure(deep, 0.6), "x");
    expect(asked.result.clarify?.question).toMatch(/quick answer/i);
    expect(t.h.calls.research).toEqual([]);

    const standard = await rules("research vector databases with sources");
    expect(needsSelfCheck(standard)).toBe(false);
    await t.run(unsure(standard, 0.5), "research vector databases with sources");
    expect(t.h.calls.research).toHaveLength(1);
    const quick = await rules("what's the latest version of React?");
    expect(needsSelfCheck(quick)).toBe(false);
  });

  it("does not make cheap answers wait for it", async () => {
    const t = rig();
    const d = await rules("what is the capital of France?");
    await t.run(unsure(d, 0.3), "what is the capital of France?");
    expect(t.h.calls.reply).toHaveLength(1);
  });

  it("asks what the decision asked, and in its language, without starting a road", async () => {
    const t = rig();
    const c = inProject();
    const d = await decide("fix it", c, { call: model(() => decideJson({ intent: "code_task", confidence: 0.2 })).call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(d.clarify).toBeDefined();
    const { result } = await t.run(d, "fix it", c);
    expect(result.clarify).toEqual(d.clarify);
    expect(Object.values(t.h.calls).flat()).toEqual([]);
    expect(t.events.map((e) => e.t)).toEqual(["decision", "result"]);
  });
});

describe("streaming", () => {
  it("sends the decision, a status for each stage, the text, the artifacts and the result, in that order", async () => {
    const t = rig();
    const c = inProject();
    const d = await rules("how does the login flow work", c);
    const { id } = await t.run(d, "how does the login flow work", c);
    expect(t.events.map((e) => (e.t === "status" ? `status:${e.stage}` : e.t))).toEqual(["decision", "status:reading_code", "text", "status:visual", "artifact", "result"]);
    const last = t.events.at(-1)!;
    expect(last).toMatchObject({ t: "result", decisionId: id });
  });

  it("passes on the pieces of a road that streams, and sends the text whole only when it did not", async () => {
    const streaming = rig({ handlers: { reply: async (c: { onText?: (p: string) => void }) => { c.onText?.("Hel"); c.onText?.("lo"); return { text: "Hello", paise: 1 }; } } });
    await streaming.run(await rules("what is the capital of France?"), "what is the capital of France?");
    expect(streaming.events.filter((e) => e.t === "text")).toEqual([{ t: "text", text: "Hel" }, { t: "text", text: "lo" }]);
    expect((streaming.events.at(-1) as { result: { text: string } }).result.text).toBe("Hello");

    const whole = rig();
    await whole.run(await rules("what is the capital of France?"), "what is the capital of France?");
    expect(whole.events.filter((e) => e.t === "text")).toEqual([{ t: "text", text: "A reply." }]);
  });
});

describe("money", () => {
  it("hands each road its share: the budget less the picture's, and never more than is left of the day", async () => {
    const t = rig();
    const c = inProject();
    const d = await rules("how does the login flow work", c);
    await t.run(d, "how does the login flow work", c);
    expect(t.h.calls.codeAnswer[0]!.maxPaise).toBe(d.budgetPaise - 150);
    expect(t.h.calls.artifact[0]!.maxPaise).toBe(150);
    const low = rig();
    low.daily.add("alice", 1500 - 20);
    const d2 = await rules("what is the capital of France?");
    await low.run(d2, "what is the capital of France?");
    expect(low.h.calls.reply[0]!.maxPaise).toBe(20);
  });

  it("adds what the front door's own calls cost to the person's day, and leaves the artifact's cost to the artifact core", async () => {
    const t = rig();
    const c = inProject();
    const d = await rules("how does the login flow work", c);
    await t.run(d, "how does the login flow work", c);
    expect(t.daily.usedPaise("alice")).toBe(5);
  });

  it("refuses to start once the day is spent: 429 daily_limit, no road called", async () => {
    const t = rig();
    t.daily.add("alice", 1500);
    const d = await rules("what is the capital of France?");
    await expect(t.run(d, "what is the capital of France?")).rejects.toMatchObject({ code: "daily_limit", status: 429 });
    expect(Object.values(t.h.calls).flat()).toEqual([]);
    // but a question back is free
    const c = inProject();
    const unsure = { ...(await rules("change the button color to red", c)), confidence: 0.5 };
    expect((await t.run(unsure, "x", c)).result.clarify).toBeDefined();
  });
});

describe("time and stopping", () => {
  it("answers 504 for a road that takes too long, and says nothing was changed", async () => {
    const never = rig({ handlers: { reply: () => new Promise(() => undefined) }, deadlines: { reply: 20 } });
    const err = await never.run(await rules("what is the capital of France?"), "what is the capital of France?").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FrontError);
    expect(err).toMatchObject({ code: "timeout", status: 504 });
    expect((err as Error).message).toMatch(/Nothing was changed/);
    expect(Object.keys(DEADLINES).sort()).toEqual(["artifact", "attachments", "code_answer", "code_job", "file", "plan", "reply", "research", "visual"]);
  });

  it("stops a road when the caller goes away, and a road's own abort is passed up, not swallowed", async () => {
    const seen: AbortSignal[] = [];
    const t = rig({ handlers: { reply: (c: { signal: AbortSignal }) => new Promise((_, reject) => { seen.push(c.signal); c.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); }) } });
    const ctl = new AbortController();
    const p = t.run(await rules("what is the capital of France?"), "what is the capital of France?", ctx(), { signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 5));
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(seen[0]!.aborted).toBe(true);
    // nothing is logged for a message that was never answered
    expect(await t.store.recent("alice")).toEqual([]);
  });
});

describe("what is attached", () => {
  it("reads a text file once and hands the reply the part that matters; a follow-up with only the ref is served from what was read", async () => {
    const reg = new AttachmentRegistry();
    const t = rig({ attachments: reg });
    const body = Array.from({ length: 200 }, (_, i) => (i === 120 ? "the refund policy lasts thirty days" : `line ${i} of filler text about nothing`)).join("\n");
    const f = fileInput("notes.txt", body);
    const c = ctx({ attachments: [f.ref] });
    const d = await rules("how long is the refund policy?", c);
    expect(d.route).toBe("file");
    const first = await t.run(d, "how long is the refund policy?", c, { attachmentData: new Map([[f.ref.id, f.data!]]) });
    const files = t.h.calls.reply[0]!.files as Array<{ name: string; text: string }>;
    expect(files).toHaveLength(1);
    expect(files[0]!.text).toContain("refund policy lasts thirty days");
    expect(files[0]!.text.length).toBeLessThan(body.length / 2);
    expect(first.result.files).toEqual([{ id: f.ref.id, name: "notes.txt", kind: "text", status: "read" }]);
    // the follow-up sends no bytes
    const second = await t.run(d, "and what about shipping?", c);
    expect(second.result.files![0]).toMatchObject({ status: "cached" });
    expect((t.h.calls.reply[1]!.files as Array<{ text: string }>)[0]!.text.length).toBeGreaterThan(0);
  });

  it("sends an image to the vision tier once, and answers from its description", async () => {
    const vision = model((s) => (s.purpose === "front.look" ? "A login screen with a blue button." : "unused"));
    const t = rig({ attachments: new AttachmentRegistry(), call: vision.call });
    const f = fileInput("shot.png", PNG);
    const c = ctx({ attachments: [f.ref] });
    const d = await rules("what is on this screen?", c);
    expect(d).toMatchObject({ route: "file", tier: "vision" });
    const first = await t.run(d, "what is on this screen?", c, { attachmentData: new Map([[f.ref.id, f.data!]]) });
    expect(vision.sent.map((s) => s.purpose)).toEqual(["front.look"]);
    expect(vision.sent[0]).toMatchObject({ tier: "vision" });
    expect(vision.sent[0]!.system).toContain("You describe a picture someone sent");
    expect((t.h.calls.reply[0]!.files as Array<{ text: string; kind: string }>)[0]).toMatchObject({ kind: "image", text: "A login screen with a blue button." });
    expect(first.result.files![0]).toMatchObject({ status: "described" });
    // the picture's description (4, by the scripted model) and the reply (3, by the fake road)
    expect(first.result.paise).toBe(7);
    // the same picture again: read once
    await t.run(d, "is the button blue?", c, { attachmentData: new Map([[f.ref.id, f.data!]]) });
    expect(vision.sent).toHaveLength(1);
  });

  it("says plainly that a PDF, audio or video is coming soon, without asking a model, in the person's language", async () => {
    const m = noModel();
    const t = rig({ attachments: new AttachmentRegistry(), call: m.call });
    const f = fileInput("report.pdf", Buffer.from("%PDF-1.4 ..."));
    const c = ctx({ attachments: [f.ref] });
    const { result } = await t.run(await rules("is isme kya likha hai?", c), "is isme kya likha hai?", c, { attachmentData: new Map([[f.ref.id, f.data!]]) });
    expect(result.files).toEqual([{ id: f.ref.id, name: "report.pdf", kind: "pdf", status: "coming_soon", note: expect.stringContaining("padhna jaldi aa raha hai") }]);
    expect(result.text).toMatch(/jaldi aa raha hai/);
    expect(t.h.calls.reply).toEqual([]);
    expect(m.sent).toEqual([]);
    const en = await t.run(await rules("what does this say?", c), "what does this say?", c, { attachmentData: new Map([[f.ref.id, f.data!]]) });
    expect(en.result.text).toBe("Reading PDFs is coming soon. For now I can read images and text or code files.");
  });

  it("tells a file it no longer has, and does not guess", async () => {
    const t = rig({ attachments: new AttachmentRegistry() });
    const f = fileInput("gone.txt", "hello there friend");
    const c = ctx({ attachments: [f.ref] });
    const { result } = await t.run(await rules("what is in it?", c), "what is in it?", c);
    expect(result.files![0]).toMatchObject({ status: "missing" });
    expect(result.text).toBe("I no longer have that file. Attach it again.");
    expect(t.h.calls.reply).toEqual([]);
  });
});

describe("the log", () => {
  it("writes one row of categories and numbers, and no word of the message", async () => {
    const t = rig();
    const d = await rules("compare Postgres vs MySQL for a small online shop");
    t.h.handlers.reply = async () => ({ text: "| a | b |\n|---|---|\n| 1 | 2 |", paise: 4 });
    const { id } = await t.run(d, "compare Postgres vs MySQL for a small online shop");
    const rows = await t.store.recent("alice");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, userId: "alice", intent: "answer", route: "reply", tier: "cheap", visual: "table", confidence: d.confidence, costPaise: 4, outcome: "ok", via: "rules" });
    expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(rows)).not.toMatch(/Postgres|MySQL|shop/);
  });

  it("records a table as the visual only when the reply has one", async () => {
    const t = rig();
    await t.run(await rules("compare Postgres vs MySQL for a small online shop"), "compare Postgres vs MySQL for a small online shop");
    expect((await t.store.recent("alice"))[0]!.visual).toBeNull();
  });

  it("records the artifact made, an offer as none, and a question back as a row too", async () => {
    const t = rig();
    const c = inProject();
    await t.run(await rules("how does the login flow work", c), "how does the login flow work", c);
    const offered = await rules("compare Postgres vs MySQL for a small online shop", ctx({ visuals: "ask" }));
    await t.run(offered, "compare Postgres vs MySQL for a small online shop", ctx({ visuals: "ask" }));
    await t.run({ ...(await rules("change the button color to red", c)), confidence: 0.5 }, "something quite different", c);
    const rows = await t.store.recent("alice");
    expect(rows.map((r) => [r.intent, r.visual])).toEqual([["code_task", null], ["answer", null], ["code_question", "diagram"]]);
  });

  it("marks the message before as rephrased when a similar one follows within a minute, and not when it is a different question", async () => {
    let now = 1_000_000;
    const store = new MemoryFrontStore(() => now);
    const t = rig({ store, watch: new RephraseWatch(() => now), now: () => now });
    const ask = async (m: string) => (await t.run(await rules(m), m)).id!;
    const first = await ask("what is the best way to learn Python quickly");
    now += 20_000;
    const second = await ask("how can I learn Python quickly, what is the best way");
    now += 5_000;
    const third = await ask("what is the capital of France?");
    const rows = Object.fromEntries((await store.recent("alice")).map((r) => [r.id, r.outcome]));
    expect(rows[first]).toBe("rephrased");
    expect(rows[second]).toBe("ok");
    expect(rows[third]).toBe("ok");
    // after a minute it is a new conversation
    now += 61_000;
    const fourth = await ask("what is the best way to learn Python quickly");
    expect((await store.recent("alice")).find((r) => r.id === second)!.outcome).toBe("ok");
    expect(fourth).toBeDefined();
  });

  it("is a warning in the server's log when it cannot be written, never a failed message", async () => {
    const warned: Array<{ o: object; msg: string }> = [];
    const store = { add: async () => { throw new Error("db down"); }, setOutcome: async () => false, summary: async () => ({ rows: 0, visual: { kept: 0, closed: 0 }, byIntent: {} }), recent: async () => [] };
    const t = rig({ store, log: { warn: (o: object, msg: string) => warned.push({ o, msg }) } });
    const { id, result } = await t.run(await rules("what is the capital of France?"), "what is the capital of France?");
    expect(id).toBeNull();
    expect(result.text).toBe("A reply.");
    expect(warned).toEqual([{ o: { error: "Error" }, msg: "front door: decision not logged" }]);
    // and the event stream still ends with its result
    expect(t.events.at(-1)).toMatchObject({ t: "result", decisionId: null });
  });
});
