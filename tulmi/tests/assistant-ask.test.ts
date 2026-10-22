/**
 * The phone's Ask (POST /v1/assistant/ask, routes/assistant.ts) with the
 * planner faked: one command in, one { say, open?, taskId? } out, from the same
 * planner and connected apps as the desktop's Ask, with no screen.
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
const { AGENT_SYSTEM_CONNECTORS } = await import("../src/connectors/index.js");
const { AGENT_SYSTEM } = await import("../src/agent/prompt.js");
const { EN, HG, wordsFor } = await import("../src/connectors/words.js");
type Connectors = import("../src/connectors/index.js").Connectors;

const auth = { authorization: "Bearer u1" };

/** The planner, scripted: each call answers the next of `answers`, and what it was sent is kept. */
function planner(...answers: string[]) {
  const sent: Array<{ system: string; user: string }> = [];
  const plan = (system: unknown, user: unknown) => {
    sent.push({ system: String(system), user: String(user) });
    const text = answers.shift() ?? "DONE";
    return (async function* () { yield { model: "test-model", delta: `${text}\n` }; })();
  };
  return { sent, plan };
}

async function app(o: { answers?: string[]; connectors?: Connectors | null; quota?: string | null; profile?: string; now?: () => number } = {}) {
  const p = planner(...(o.answers ?? []));
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
    });
    // The same planner and apps as the desktop's Ask, told it is a command on a phone with no screen.
    expect(a.sent[0]!.system).toBe(AGENT_SYSTEM_CONNECTORS);
    expect(a.sent[0]!.user).toContain("whatsapp.send_message");
    expect(a.sent[0]!.user).toContain("Platform: ios. App: Tailzu. Mode: do. Step 1 of at most 1.");
    expect(a.sent[0]!.user).toContain("(no controls could be read)");
    expect(a.sent[0]!.user).toContain("<said>Tell Mom I'm on my way on WhatsApp</said>");
    expect(a.recorded).toHaveLength(1);
  });

  it("a phone's own link opens on the phone: a call, a text, a payment", async () => {
    const a = await app({ answers: ['USE phone.call {"number":"9876543210","name":"Papa"}', 'USE upi.pay {"vpa":"rahul@okhdfcbank","amount":"500","name":"Rahul"}'] });
    const call = (await a.ask({ text: "call papa on 9876543210" }, { "user-agent": "okhttp/4.12.0" })).json();
    expect(call).toEqual({ say: "Ready to call Papa. Just tap Call.", open: { url: "tel:+919876543210", label: "Call now" } });
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
    expect(r).toEqual({ say: "airport ka raasta Google Maps mein khul gaya.", open: { url: "https://www.google.com/maps/dir/?api=1&destination=airport", label: HG["maps.open"] } });
    expect(viaHeader.sent[0]!.user).toContain("Their language: hinglish.");
  });

  it("an answer is said as it is, with nothing to open", async () => {
    const a = await app({ answers: ["SAY It's 4pm in London.\nDONE"] });
    expect((await a.ask({ text: "what time is it in london" })).json()).toEqual({ say: "It's 4pm in London." });
    // Nothing relevant connected: the planner gets the prompt it always gets.
    expect(a.sent[0]!.system).toBe(AGENT_SYSTEM);
  });

  it("a line that would act on a computer's screen is never sent to the phone", async () => {
    const a = await app({ answers: ["TYPE hello there", "LOOK the chart"] });
    expect((await a.ask({ text: "type hello there" })).json()).toEqual({ say: EN["ask.none"] });
    expect((await a.ask({ text: "what does this chart say" })).json()).toEqual({ say: EN["ask.desk"] });
  });

  it("asks back, and reads their answer with the question", async () => {
    let t = 1_000_000;
    const a = await app({
      answers: ["ASK What's Rahul's UPI ID?", 'USE upi.pay {"vpa":"rahul@okhdfcbank","amount":"500","name":"Rahul"}', "SAY Done.\nDONE"],
      now: () => t,
    });
    expect((await a.ask({ text: "pay rahul 500 on upi" })).json()).toEqual({ say: "What's Rahul's UPI ID?" });
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
    expect((await a.ask({ text: "pay rahul 500 on upi", platform: "android" })).json()).toEqual({ say: "What's their UPI ID, like name@bank?" });
    const r = (await a.ask({ text: "rahul@okhdfcbank", platform: "android" })).json();
    expect(r.open.url).toBe("upi://pay?pa=rahul@okhdfcbank&pn=Rahul&am=500.00&cu=INR");
    expect(a.sent[1]!.user).toContain("<history>\n1. said: pay rahul 500 on upi | did: ASK | note: What's their UPI ID, like name@bank?\n</history>");
    expect(a.sent[1]!.user).toContain("upi.pay");
  });

  it("an approval comes back as the task, with a line to go with it", async () => {
    const fake = {
      runtimeFor: () => ({
        cards: async () => ({ system: AGENT_SYSTEM_CONNECTORS, message: (base: string) => `${base}\n<tools>\nnotion.add_comment — Add a comment. {"text":"string"}\n</tools>` }),
        use: async () => ({ kind: "approval", taskId: "task-1", approval: { id: "ap1", connector: "notion", tool: "add_comment", risk: "send", preview: "Add comment in Notion" } }),
        settle: async () => {},
      }),
    } as unknown as Connectors;
    const a = await app({ connectors: fake, answers: ['USE notion.add_comment {"text":"Shipped"}'] });
    expect((await a.ask({ text: "comment shipped on the launch page in notion" })).json()).toEqual({ say: EN["ask.approve"], taskId: "task-1" });
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

  it("knows the phone by what the screen said, else by its HTTP client", () => {
    expect(phoneOf("android", "")).toBe("android");
    expect(phoneOf(undefined, "okhttp/4.12.0")).toBe("android");
    expect(phoneOf(undefined, "Tailzu/37 CFNetwork/1568 Darwin/24.0.0")).toBe("ios");
    expect(phoneOf("mac", undefined)).toBe("ios");
  });
});
