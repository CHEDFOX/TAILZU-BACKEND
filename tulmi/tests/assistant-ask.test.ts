/**
 * The phone's Ask (POST /v1/assistant/ask, routes/assistant.ts) with the
 * planner faked: one command in, one { say, open?, taskId?, receipt } out, from
 * the same planner and connected apps as the desktop's Ask, with no screen.
 * Every answer carries the run's receipt (src/runs), and every ask is a row
 * in the run ledger with its planner calls.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  resolveUser: async (h: string | undefined) => {
    const id = h?.replace(/^Bearer\s+/i, "").trim();
    return id ? { id } : null;
  },
}));

const { registerAssistantRoutes, answerOf, phoneOf, FOLLOW_UP_MS, FOLLOW_UPS_CHAIN } = await import("../src/routes/assistant.js");
const { ALWAYS_ON } = await import("../src/connectors/catalog.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { stableBlock } = await import("../src/principles/roles.js");
const { PlannerUnavailable } = await import("../src/agent/llm.js");
const { EN, HG, wordsFor } = await import("../src/connectors/words.js");
const { MemoryRunStore, RunLedger } = await import("../src/runs/index.js");
const { RUN_EN, RUN_HG } = await import("../src/runs/words.js");
type Connectors = import("../src/connectors/index.js").Connectors;
type CallRecord = import("../src/agent/llm.js").CallRecord;

/** The connector addendum's own line: at the head of every message that offers apps, and of no other (desktop or phone). The system prompt is the planner's one stable block either way. */
const USE_LINE = "USE <connector>.<tool>";
const PLANNER = stableBlock("ask_planner");
const RUN_ID = /^ask_[0-9a-f]{32}$/;
/** A receipt as the phone gets it, with the times it took. */
const receipt = (over: Record<string, unknown>) => ({ runId: expect.stringMatching(RUN_ID), effects: 0, steps: 1, ms: expect.any(Number), firstMs: expect.any(Number), ...over });

const auth = { authorization: "Bearer u1" };

/**
 * The planner, scripted: each call answers the next of `answers`, and what it
 * was sent is kept. "THROW" is every model failing; "CRASH" a bug. Each call
 * is logged, as planStream logs it, with what it cost.
 */
function planner(...answers: string[]) {
  const sent: Array<{ system: string; user: string }> = [];
  const plan = (system: unknown, user: unknown, _signal?: unknown, _picture?: unknown, log?: (c: CallRecord) => void) => {
    sent.push({ system: String(system), user: String(user) });
    const text = answers.shift() ?? "DONE";
    return (async function* () {
      log?.({ model: "test-model", outcome: "ok", ms: 7, firstMs: 3, promptTokens: 900, completionTokens: 14, costUsd: 0.00012 });
      if (text === "THROW") throw new PlannerUnavailable(new Error("upstream 503"));
      if (text === "CRASH") throw new Error("a bug");
      yield { model: "test-model", delta: `${text}\n` };
    })();
  };
  return { sent, plan };
}

async function app(o: { answers?: string[]; connectors?: Connectors | null; quota?: string | null; profile?: string; now?: () => number; runs?: InstanceType<typeof MemoryRunStore> } = {}) {
  const p = planner(...(o.answers ?? []));
  // The ledger's clock is the route's: a test that moves time moves both.
  const runs = o.runs ?? (o.now ? new MemoryRunStore({ now: o.now }) : undefined);
  const connectors = o.connectors === undefined
    ? createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] })
    : o.connectors;
  const recorded: unknown[] = [];
  const server = Fastify();
  registerAssistantRoutes(server, {
    rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } },
    connectors,
    plan: p.plan as never,
    profileLanguage: async () => o.profile,
    quota: async () => o.quota ?? null,
    record: async (_u, r) => { recorded.push(r); },
    ...(o.now ? { now: o.now } : {}),
    ...(runs ? { ledger: new RunLedger({ store: runs, ...(o.now ? { now: o.now } : {}) }) } : {}),
  });
  await server.ready();
  const ask = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    server.inject({ method: "POST", url: "/v1/assistant/ask", headers: { ...auth, ...headers }, payload });
  return { server, ask, sent: p.sent, recorded };
}

describe("POST /v1/assistant/ask", () => {
  it("is for a signed-in person, while connected apps are on, with something to do", async () => {
    const a = await app();
    expect((await a.server.inject({ method: "POST", url: "/v1/assistant/ask", payload: { text: "hi" } })).statusCode).toBe(401);
    expect((await a.ask({ text: "  " })).statusCode).toBe(400);
    expect((await a.ask({})).statusCode).toBe(400);
    const off = await app({ connectors: null });
    const r = await off.ask({ text: "call papa" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ code: "connectors_off", message: "Connected apps are not switched on." });
    const out = await app({ quota: "You've used this month's words." });
    expect((await out.ask({ text: "call papa" })).statusCode).toBe(429);
    expect(out.sent).toEqual([]);
  });

  it("a hand-off: its one line, and the link to open", async () => {
    const a = await app({ answers: ['USE whatsapp.send_message {"text":"I\'m on my way","name":"Mom"}'] });
    const r = await a.ask({ text: "Tell Mom I'm on my way on WhatsApp", platform: "ios" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      say: "WhatsApp is open with your message for Mom. Pick their chat and hit Send.",
      open: { url: "https://wa.me/?text=I'm%20on%20my%20way", label: "Open WhatsApp" },
      // Opened for them to finish: a change in the world, and the run is done.
      receipt: receipt({ outcome: "done", reason: "handoff", line: RUN_EN.handoff, effects: 1 }),
    });
    // The same planner and apps as the desktop's Ask, told it is a command on a phone with no screen.
    expect(a.sent[0]!.system).toBe(PLANNER);
    expect(a.sent[0]!.system).not.toContain(USE_LINE);
    expect(a.sent[0]!.user.split("\n")[0]).toMatch(/^Connected apps\./);
    expect(a.sent[0]!.user).toContain(USE_LINE);
    expect(a.sent[0]!.user).toContain("whatsapp.send_message");
    expect(a.sent[0]!.user).toContain("Platform: ios. App: X0 Bot. Mode: do. Step 1 of at most 1.");
    expect(a.sent[0]!.user).toContain("(no controls could be read)");
    expect(a.sent[0]!.user).toContain("<said>Tell Mom I'm on my way on WhatsApp</said>");
    expect(a.recorded).toHaveLength(1);
  });

  it("a phone's own link opens on the phone: a call, a text, a payment", async () => {
    const a = await app({ answers: ['USE phone.call {"number":"9876543210","name":"Papa"}', 'USE upi.pay {"vpa":"rahul@okhdfcbank","amount":"500","name":"Rahul"}'] });
    const call = (await a.ask({ text: "call papa on 9876543210" }, { "user-agent": "okhttp/4.12.0" })).json();
    expect(call).toEqual({ say: "Ready to call Papa. Just tap Call.", open: { url: "tel:+919876543210", label: "Call now" }, receipt: receipt({ outcome: "done", reason: "handoff", line: RUN_EN.handoff, effects: 1 }) });
    expect(a.sent[0]!.user).toContain("Platform: android.");
    const pay = (await a.ask({ text: "pay rahul 500 on gpay, rahul@okhdfcbank" })).json();
    expect(pay.open.url).toBe("upi://pay?pa=rahul@okhdfcbank&pn=Rahul&am=500.00&cu=INR");
    expect(pay.say).toBe(EN["upi.done"].replace("{amount}", "500").replace("{name}", "Rahul"));
  });

  it("speaks Hinglish to a Hinglish phone or profile", async () => {
    const a = await app({ answers: ['USE whatsapp.send_message {"text":"aa raha hoon","phone":"9876543210"}', 'USE maps.directions {"destination":"airport"}'], profile: "hinglish" });
    expect((await a.ask({ text: "papa ko whatsapp karo aa raha hoon, 9876543210" })).json().say).toBe(HG["wa.done"]);
    const viaHeader = await app({ answers: ['USE maps.directions {"destination":"airport"}'] });
    const r = (await viaHeader.ask({ text: "airport ka raasta" }, { "x-app-language": "hinglish" })).json();
    expect(r).toEqual({
      say: "airport ka raasta Google Maps mein khul gaya.", open: { url: "https://www.google.com/maps/dir/?api=1&destination=airport", label: HG["maps.open"] },
      receipt: receipt({ outcome: "done", reason: "handoff", line: RUN_HG.handoff, effects: 1 }),
    });
    expect(viaHeader.sent[0]!.user).toContain("Their language: hinglish.");
  });

  it("an answer is said as it is, with nothing to open", async () => {
    const a = await app({ answers: ["SAY It's 4pm in London.\nDONE"] });
    expect((await a.ask({ text: "what time is it in london" })).json()).toEqual({ say: "It's 4pm in London.", receipt: receipt({ outcome: "done", line: RUN_EN.done }) });
    // Nothing relevant connected: the planner gets the prompt it always gets, with no apps in it.
    expect(a.sent[0]!.system).toBe(PLANNER);
    expect(a.sent[0]!.user).not.toContain(USE_LINE);
  });

  it("a line that would act on a computer's screen is never sent to the phone", async () => {
    const a = await app({ answers: ["TYPE hello there", "LOOK the chart"] });
    const typed = (await a.ask({ text: "type hello there" })).json();
    expect(typed).toMatchObject({ say: EN["ask.none"], receipt: { effects: 0 } });
    expect(Object.keys(typed).sort()).toEqual(["receipt", "say"]);
    // Nothing usable: failed / nothing_usable once the step says so (StepResult.code), plainly done before it does.
    expect(typed.receipt.outcome === "done" || (typed.receipt.outcome === "failed" && typed.receipt.reason === "nothing_usable")).toBe(true);
    // A look is something only a computer's screen can answer: the run failed here, and says so.
    expect((await a.ask({ text: "what does this chart say" })).json()).toEqual({
      say: EN["ask.desk"], receipt: receipt({ outcome: "failed", reason: "desk_only", line: RUN_EN.desk_only }),
    });
  });

  it("asks back, and reads their answer with the question", async () => {
    let t = 1_000_000;
    const a = await app({
      answers: ["ASK What's Rahul's UPI ID?", 'USE upi.pay {"vpa":"rahul@okhdfcbank","amount":"500","name":"Rahul"}', "SAY Done.\nDONE"],
      now: () => t,
    });
    expect((await a.ask({ text: "pay rahul 500 on upi" })).json()).toEqual({
      say: "What's Rahul's UPI ID?", receipt: receipt({ outcome: "needs_you", reason: "question", line: RUN_EN.question }),
    });
    const r = (await a.ask({ text: "rahul@okhdfcbank" })).json();
    expect(r.open.url).toBe("upi://pay?pa=rahul@okhdfcbank&pn=Rahul&am=500.00&cu=INR");
    expect(a.sent[1]!.user).toContain("<history>\n1. said: pay rahul 500 on upi | did: ASK | note: What's Rahul's UPI ID?\n</history>");
    expect(a.sent[1]!.user).toContain("Step 2 of at most 2.");
    // An answer that is not a question clears it; and a question too old is not read.
    await a.ask({ text: "thanks" });
    expect(a.sent[2]!.user).not.toContain("<history>");
    const late = await app({ answers: ["ASK Which Rahul?", "SAY ok\nDONE"], now: () => t });
    await late.ask({ text: "pay rahul" });
    t += FOLLOW_UP_MS + 1;
    await late.ask({ text: "the first one" });
    expect(late.sent[1]!.user).not.toContain("<history>");
  });

  it("a question asked back again and again keeps each turn to /v1/agent's limits, and starts afresh after a few", async () => {
    const asks = Array.from({ length: 12 }, () => `ASK Tell me more? ${"q".repeat(400)}`);
    const a = await app({ answers: asks });
    const long = (i: number) => `ask me something first ${i} ${"w".repeat(1100)}`;
    for (let i = 0; i < 8; i++) expect((await a.ask({ text: long(i) })).statusCode).toBe(200);
    const sizes = a.sent.map((x) => x.user.length);
    // The first ask has no history; each answer after it carries one more turn, up to the chain; then it starts afresh.
    const turns = a.sent.map((x) => (x.user.match(/^\d+\. said: /gm) ?? []).length);
    expect(turns).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(FOLLOW_UPS_CHAIN).toBe(3);
    for (const x of a.sent) {
      for (const said of x.user.match(/said: [^|]*\|/g) ?? []) expect(said.length).toBeLessThanOrEqual("said: ".length + 1000 + 2);
      for (const note of x.user.match(/note: [^\n]*/g) ?? []) expect(note.length).toBeLessThanOrEqual("note: ".length + 200);
    }
    // Bounded: the longest prompt is no more than a few turns longer than the first.
    expect(Math.max(...sizes)).toBeLessThan(sizes[0]! + FOLLOW_UPS_CHAIN * 1300);
  });

  it("a tool's question back is kept like the planner's: the UPI ID is read with the request it answers", async () => {
    const a = await app({ answers: ['USE upi.pay {"vpa":"","amount":"500","name":"Rahul"}', 'USE upi.pay {"vpa":"rahul@okhdfcbank","amount":"500","name":"Rahul"}'] });
    expect((await a.ask({ text: "pay rahul 500 on upi", platform: "android" })).json()).toEqual({
      say: "What's their UPI ID, like name@bank?", receipt: receipt({ outcome: "needs_you", reason: "question", line: RUN_EN.question }),
    });
    const r = (await a.ask({ text: "rahul@okhdfcbank", platform: "android" })).json();
    expect(r.open.url).toBe("upi://pay?pa=rahul@okhdfcbank&pn=Rahul&am=500.00&cu=INR");
    expect(a.sent[1]!.user).toContain("<history>\n1. said: pay rahul 500 on upi | did: ASK | note: What's their UPI ID, like name@bank?\n</history>");
    expect(a.sent[1]!.user).toContain("upi.pay");
  });

  it("an approval comes back as the task, with a line to go with it", async () => {
    const fake = {
      runtimeFor: () => ({
        cards: async () => ({ system: PLANNER, message: (base: string) => `${base}\n<tools>\nnotion.add_comment — Add a comment. {"text":"string"}\n</tools>` }),
        use: async () => ({ kind: "approval", taskId: "task-1", approval: { id: "ap1", connector: "notion", tool: "add_comment", risk: "send", preview: "Add comment in Notion" } }),
        settle: async () => {},
      }),
    } as unknown as Connectors;
    const a = await app({ connectors: fake, answers: ['USE notion.add_comment {"text":"Shipped"}'] });
    expect((await a.ask({ text: "comment shipped on the launch page in notion" })).json()).toEqual({
      say: EN["ask.approve"], taskId: "task-1", receipt: receipt({ outcome: "needs_you", reason: "approval", line: RUN_EN.approval, taskId: "task-1" }),
    });
  });

  it("writes every ask down: how it ended, its title, and each planner call with what it cost", async () => {
    const runs = new MemoryRunStore();
    const a = await app({ runs, answers: ['USE whatsapp.send_message {"text":"I\'m on my way","name":"Mom"}'] });
    const r = (await a.ask({ text: "  Tell Mom   I'm on my way on WhatsApp", platform: "android" })).json();
    await vi.waitFor(async () => expect(await runs.get("u1", r.receipt.runId)).not.toBeNull());
    const row = (await runs.get("u1", r.receipt.runId))!;
    expect(row).toMatchObject({
      surface: "phone", platform: "android", outcome: "done", reason: "handoff", steps: 1, effects: 1, path: "model", mode: "do",
      title: "Tell Mom I'm on my way on WhatsApp", said: null, turns: null, follows: null, followedBy: null,
    });
    await vi.waitFor(() => expect(runs.callsOf("u1", r.receipt.runId)).toHaveLength(1));
    expect(runs.callsOf("u1", r.receipt.runId)[0]).toMatchObject({ step: 0, surface: "phone", model: "test-model", outcome: "ok", promptTokens: 900, completionTokens: 14, costUsd: 0.00012 });
    // The ledger keeps how it went, never what an app or the planner said.
    expect(JSON.stringify(runs.callsOf("u1", r.receipt.runId))).not.toMatch(/Mom|way/);
  });

  it("an ask that failed having changed nothing may be asked again, with their words kept for it; a crash is a 500 and a failed row", async () => {
    const runs = new MemoryRunStore();
    const a = await app({ runs, answers: ["THROW", "CRASH"] });
    const r = (await a.ask({ text: "what's on my calendar tomorrow" })).json();
    expect(r).toEqual({
      say: "Ask can't think right now. Try again in a moment.",
      receipt: receipt({ outcome: "failed", reason: "model_unavailable", line: RUN_EN.model_unavailable, retry: true, firstMs: expect.any(Number) }),
    });
    await vi.waitFor(async () => expect((await runs.get("u1", r.receipt.runId))?.said).toBe("what's on my calendar tomorrow"));
    expect((await runs.recent("u1", 5))[0]).toMatchObject({ outcome: "failed", reason: "model_unavailable", retry: "what's on my calendar tomorrow" });
    const crash = await a.ask({ text: "and the day after" });
    expect(crash.statusCode).toBe(500);
    expect(crash.json()).not.toHaveProperty("receipt");
    await vi.waitFor(async () => expect((await runs.recent("u1", 5))[0]).toMatchObject({ outcome: "failed", reason: "internal", title: "and the day after" }));
  });
});

describe("the answer, from the run's events", () => {
  const w = wordsFor("en");
  it("joins what was said, keeps the link and the task, and says why when there is nothing", () => {
    expect(answerOf([
      { t: "heard", text: "x", mode: "do" }, { t: "say", text: "First." }, { t: "say", text: "Second.", append: true }, { t: "done" },
    ], w)).toEqual({ say: "First. Second." });
    expect(answerOf([{ t: "heard", text: "x", mode: "do" }, { t: "error", code: "model_unavailable", message: "Ask can't think right now. Try again in a moment." }], w))
      .toEqual({ say: "Ask can't think right now. Try again in a moment." });
    expect(answerOf([{ t: "done", text: "All set." }], w)).toEqual({ say: "All set." });
    expect(answerOf([], w)).toEqual({ say: EN["ask.none"] });
    expect(answerOf([{ t: "say", text: "Here." }, { t: "open", url: "https://wa.me/?text=hi", label: "Open WhatsApp", fallback: "mailto:x" }, { t: "done" }], w))
      .toEqual({ say: "Here.", open: { url: "https://wa.me/?text=hi", label: "Open WhatsApp", fallback: "mailto:x" } });
  });

  it("passes over a receipt in the events, as it passes over any event it does not read", () => {
    const r = { runId: "ask_1", outcome: "done" as const, line: "Done.", effects: 0, steps: 1, ms: 5 };
    expect(answerOf([{ t: "heard", text: "x", mode: "do" }, { t: "say", text: "Hi." }, { t: "receipt", receipt: r }, { t: "done" }], w)).toEqual({ say: "Hi." });
  });

  it("knows the phone by what the screen said, else by its HTTP client", () => {
    expect(phoneOf("android", "")).toBe("android");
    expect(phoneOf(undefined, "okhttp/4.12.0")).toBe("android");
    expect(phoneOf(undefined, "Tailzu/37 CFNetwork/1568 Darwin/24.0.0")).toBe("ios");
    expect(phoneOf("mac", undefined)).toBe("ios");
  });
});
