/**
 * THE PHONE'S QUESTION BACK OUTLIVES THE PROCESS (routes/assistant.ts over
 * src/runs).
 *
 * A question asked on one server is answered on another, as after a restart
 * or behind a second instance: each test runs two registerAssistantRoutes,
 * each with a ledger of its own, over one store. What these hold down:
 *   - the answer is read with the question, wherever it lands, and the two
 *     runs are linked (follows, followed_by);
 *   - the question is in the store by the time the phone has it, so an
 *     answer a moment later cannot miss it;
 *   - a question older than FOLLOW_UP_MS is not read, and is closed;
 *   - the chain of FOLLOW_UPS_CHAIN, then a fresh start, across servers;
 *   - two answers at once: one of them reads the question.
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

const { registerAssistantRoutes, FOLLOW_UP_MS, FOLLOW_UPS_CHAIN } = await import("../src/routes/assistant.js");
const { ALWAYS_ON } = await import("../src/connectors/catalog.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { LEDGER_WAIT_MS, MemoryRunStore, RunLedger } = await import("../src/runs/index.js");
type RunStore = import("../src/runs/index.js").RunStore;

/** One planner for both servers, as one model behind both: each call answers the next line, and what it was sent is kept. */
function planner(answers: string[]) {
  const sent: string[] = [];
  const plan = (_system: unknown, user: unknown) => {
    sent.push(String(user));
    const text = answers.shift() ?? "DONE";
    return (async function* () { yield { model: "test-model", delta: `${text}\n` }; })();
  };
  return { sent, plan };
}

/** Two servers over one store, on one clock. */
async function pair(answers: string[], o: { store?: RunStore; now?: () => number } = {}) {
  const store = o.store ?? new MemoryRunStore(o.now ? { now: o.now } : {});
  const p = planner(answers);
  const connectors = createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] });
  const server = async () => {
    const app = Fastify();
    registerAssistantRoutes(app, {
      rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } },
      connectors,
      plan: p.plan as never,
      ledger: new RunLedger({ store, ...(o.now ? { now: o.now } : {}) }),
      ...(o.now ? { now: o.now } : {}),
    });
    await app.ready();
    return (text: string, who = "u1") =>
      app.inject({ method: "POST", url: "/v1/assistant/ask", headers: { authorization: `Bearer ${who}` }, payload: { text, platform: "android" } })
        .then((r) => r.json() as { say: string; open?: { url: string }; receipt: { runId: string; outcome: string; reason?: string } });
  };
  return { a: await server(), b: await server(), sent: p.sent, store };
}

describe("a question back, answered on another server", () => {
  it("is read with the answer there, and the two runs are linked", async () => {
    const s = await pair(["ASK What's Rahul's UPI ID?", 'USE upi.pay {"vpa":"rahul@okhdfcbank","amount":"500","name":"Rahul"}']);
    const q = await s.a("pay rahul 500 on upi");
    expect(q.receipt).toMatchObject({ outcome: "needs_you", reason: "question" });
    // Written before the phone had the question: there now, with no waiting.
    expect(await s.store.get("u1", q.receipt.runId)).toMatchObject({ turns: [{ said: "pay rahul 500 on upi", did: "ASK", note: "What's Rahul's UPI ID?" }] });

    const r = await s.b("rahul@okhdfcbank");
    expect(r.open?.url).toBe("upi://pay?pa=rahul@okhdfcbank&pn=Rahul&am=500.00&cu=INR");
    expect(r.receipt).toMatchObject({ outcome: "done", reason: "handoff" });
    expect(s.sent[1]).toContain("<history>\n1. said: pay rahul 500 on upi | did: ASK | note: What's Rahul's UPI ID?\n</history>");
    expect(await s.store.get("u1", q.receipt.runId)).toMatchObject({ followedBy: r.receipt.runId, turns: null });
    await vi.waitFor(async () => expect(await s.store.get("u1", r.receipt.runId)).toMatchObject({ follows: q.receipt.runId, title: "pay rahul 500 on upi" }));
    // Read once: the next request on either server starts afresh.
    await s.a("thanks");
    expect(s.sent[2]).not.toContain("<history>");
  });

  it("is someone else's to answer only if it is theirs", async () => {
    const s = await pair(["ASK Which Rahul?", "SAY ok\nDONE"]);
    await s.a("pay rahul", "u1");
    await s.b("the first one", "u2");
    expect(s.sent[1]).not.toContain("<history>");
  });

  it("is not read after FOLLOW_UP_MS, and is closed as unanswered", async () => {
    let t = 1_000_000;
    const s = await pair(["ASK Which Rahul?", "SAY ok\nDONE"], { now: () => t });
    const q = await s.a("pay rahul");
    t += FOLLOW_UP_MS + 1;
    await s.b("the first one");
    expect(s.sent[1]).not.toContain("<history>");
    expect(await s.store.get("u1", q.receipt.runId)).toMatchObject({ outcome: "cancelled", reason: "unanswered", turns: null, followedBy: null });
  });

  it("runs to FOLLOW_UPS_CHAIN questions across servers, then starts afresh", async () => {
    const s = await pair(Array.from({ length: 8 }, (_, i) => `ASK And then? ${i}`));
    for (let i = 0; i < 8; i++) await (i % 2 ? s.b : s.a)(`step ${i}`);
    expect(s.sent.map((u) => (u.match(/^\d+\. said: /gm) ?? []).length)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(FOLLOW_UPS_CHAIN).toBe(3);
  });

  it("answered twice at once, on both servers: one of them reads it", async () => {
    const s = await pair(["ASK Which Rahul?", "SAY ok\nDONE", "SAY ok\nDONE"]);
    await s.a("pay rahul");
    await Promise.all([s.a("the first one"), s.b("the first one")]);
    expect(s.sent.slice(1).filter((u) => u.includes("<history>"))).toHaveLength(1);
  });

  it("with the store too slow, the ask still answers in time: it waits LEDGER_WAIT_MS at most, twice", async () => {
    const never = () => new Promise<never>(() => {});
    const stuck = { saveStep: never, addCalls: never, get: never, recent: never, sweep: never, takeFollowUp: never } as unknown as RunStore;
    const p = planner(["ASK Which Rahul?"]);
    const app = Fastify();
    registerAssistantRoutes(app, {
      rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } },
      connectors: createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] }),
      plan: p.plan as never,
      ledger: new RunLedger({ store: stuck, waitMs: 40 }),
    });
    const t0 = Date.now();
    const r = await app.inject({ method: "POST", url: "/v1/assistant/ask", headers: { authorization: "Bearer u1" }, payload: { text: "pay rahul" } });
    expect(r.json()).toMatchObject({ say: "Which Rahul?", receipt: { outcome: "needs_you", reason: "question" } });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(LEDGER_WAIT_MS).toBe(2000);
  });

  it("with the store failing, the ask still answers: the question is simply not kept", async () => {
    const broken = {
      saveStep: async () => { throw new Error("relation agent_runs does not exist"); },
      addCalls: async () => {}, get: async () => null, recent: async () => [], sweep: async () => ({ closed: 0, emptied: 0 }),
      takeFollowUp: async () => { throw new Error("relation agent_runs does not exist"); },
    } as RunStore;
    const s = await pair(["ASK Which Rahul?", "SAY ok\nDONE"], { store: broken });
    expect((await s.a("pay rahul")).say).toBe("Which Rahul?");
    expect((await s.b("the first one")).say).toBe("ok");
    expect(s.sent[1]).not.toContain("<history>");
  });
});
