/**
 * A CALL IS NEVER HELD TO MONEY WHERE THE LIVE CALL IS SWITCHED ON FOR THE PERSON, ITS VOICE INCLUDED (`realtimeFor`,
 * routes/writing/speak.ts speakFor with `call: true`, routes/bots/planCalls.ts, botsBots/planCall.ts bumpCost; docs/plan-ease.md
 * "Calls"). WITH THE SWITCH OFF — every build today — the turn call is held to the meter exactly as it always has been.
 *
 *   - POST /v1/speak is unchanged: the usage meter is asked, and a person whose meter is out gets 429
 *   - a read-aloud's cost goes on the request's tally exactly ONCE, with the dollars the voice service gave
 *   - a call's voice, with the very same meter out: the audio plays, no usage row is written, nothing goes on the tally, and what
 *     the read cost lands on the call's own row (a record for the owner, never a cap)
 *   - a turn by voice, with the usage meter out: 200, and the turn's own paise land on the row too
 *   - PLAN_CALL_REALTIME off: the call's voice answers 429 over a used-up meter again, and the turn asks the chat with no flag, so
 *     the day budget and the spend gate hold it as they hold any chat turn
 *   - the `call: true` flag really reaches the chat, and what it switches off further in: the spend gate (you/limits.ts wrapBots) and
 *     the bot's own day budget (bots/service.ts ask)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  // The money bypass rides on the live call's own switch, so these tests turn it on for everyone.
  process.env.PLAN_CALL_REALTIME = "true";
  process.env.PLAN_CALL_RT_ALLOW = "*";
});

// Whoever the test says is calling: the token is the user id.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { PlanCalls, memoryCallTable, setPlanCalls, RING_MS, TALK_IDLE_MS, CALLS } = await import("../src/botsBots/planCall.js");
const { registerPlanCallRoutes } = await import("../src/routes/bots/planCalls.js");
const { registerSpeakRoutes } = await import("../src/routes/writing/speak.js");
const { defaultGuard } = await import("../src/guard/index.js");
const { installAiCheck } = await import("../src/privacy/aiGate.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");
const { setCallHook } = await import("../src/push/engine.js");
const { wrapBots } = await import("../src/you/limits.js");
const { ALICE, def, rig } = await import("./bots-rig.js");
const metering = await import("../src/usage/metering.js");
const cost = await import("../src/usage/cost.js");
const tts = await import("../src/pipeline/tts.js");

type CallRow = import("../src/botsBots/planCall.js").CallRow;
type CallTable = import("../src/botsBots/planCall.js").CallTable;
type CallSeed = import("../src/botsBots/planCallWords.js").CallSeed;

const MIN = 60_000;
const IST = 330;
const NOW = Date.UTC(2026, 10, 12, 16, 55) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const as = (u: string) => ({ authorization: `Bearer ${u}` });
/** What the stubbed voice service says one read cost. */
const READ_USD = 0.004;
/** What the chat says the turn's answer cost, in paise (₹0.44 ÷ 88 = $0.005). */
const TURN_PAISE = 44;

const SEED: CallSeed = {
  source: "leave", item: "pe:ev1:2026-11-12", eventId: "ev1", day: "2026-11-12", tz: IST, title: "Parent-teacher meeting",
  place: "Green Valley School", start: NOW + 35 * MIN, leaveBy: NOW + 10 * MIN, minutes: 25, mode: "drive",
};

describe("a call's voice and the usage meter", () => {
  let app: FastifyInstance;
  let table: CallTable;
  let record: ReturnType<typeof vi.spyOn>;
  let tally: ReturnType<typeof vi.spyOn>;

  const send = vi.fn(async () => ({ answer: { text: "Done. I moved it to 6 pm.", paise: TURN_PAISE, opens: [], approvals: [] }, turns: [] }));
  const chat = { send, note: async () => undefined };

  beforeEach(async () => {
    resetConfigForTests();
    send.mockClear();
    installAiCheck(async () => true);
    vi.spyOn(tts, "synthesize").mockImplementation(async (i: { text: string }) => ({
      audio: Buffer.from(`audio:${i.text}`), contentType: "audio/mpeg", usd: READ_USD,
    }));
    record = vi.spyOn(metering, "recordUsage").mockResolvedValue(undefined);
    tally = vi.spyOn(cost, "addCostUsd");
    table = memoryCallTable();
    setPlanCalls(new PlanCalls({ table, engine: () => null, now: () => NOW, name: async () => "Zara", consent: async () => true }));
    app = Fastify();
    registerPlanCallRoutes(app, { rateLimit: RL }, { chat: chat as never, guard: defaultGuard() });
    registerSpeakRoutes(app, { rateLimit: RL, tooLong: () => null, cfg: getConfig() });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    metering.setUsageGate(null); setPlanCalls(null); setCallHook(null); installAiCheck(null);
    vi.restoreAllMocks(); resetConfigForTests();
  });

  const put = async (o: Partial<CallRow> = {}): Promise<CallRow> => {
    const r: CallRow = {
      id: randomUUID(), user_id: U, source: "leave", source_key: `leave:ev1:${SEED.start}`, origin: "server", parent_id: null,
      state: "answered", why: null, name: "Zara", item: SEED.item, seed: SEED, line: "Leave by 5:05 pm", more: "25 min drive",
      opening: "It's time to leave.", turns: [], tz_min: IST, ring_at_ms: NOW, ring_until_ms: NOW + RING_MS,
      next_ms: NOW + TALK_IDLE_MS, rings: 1, rang: [], answered_ms: NOW, ended_ms: null,
      rt_call: null, rt_state: null, rt_sec: 0, cost_usd: 0, acted: [], judged: false, ...o,
    };
    await table.insert(r);
    return r;
  };
  const rowOf = async (id: string) => (await table.select({ id }))[0]!;
  const costOf = (id: string, want: number) => vi.waitFor(async () => expect((await rowOf(id)).cost_usd).toBeCloseTo(want, 6), { timeout: 3_000, interval: 10 });
  /** The usage meter with nothing left on it, for everyone. */
  const meterOut = () => metering.setUsageGate(async () => "You've used today's words. It starts again tomorrow.");

  it("POST /v1/speak still answers 429 when the meter is out, and bills one read once when it isn't", async () => {
    meterOut();
    const out = await app.inject({ method: "POST", url: "/v1/speak", headers: as(U), payload: { text: "Read this back.", voice: "nova" } });
    expect([out.statusCode, out.json().code]).toEqual([429, "quota_exceeded"]);
    expect(record).not.toHaveBeenCalled();
    expect(tally).not.toHaveBeenCalled();

    metering.setUsageGate(null);
    const ok = await app.inject({ method: "POST", url: "/v1/speak", headers: as(U), payload: { text: "Read this back.", voice: "nova" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("audio:Read this back.");
    // Once, with what the voice service itself said: never the characters' price on top of it.
    expect(tally.mock.calls).toEqual([[READ_USD]]);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("a call's voice plays with the meter out: no 429, no usage row, nothing on the tally, the cost on the call's row", async () => {
    meterOut();
    const c = await put();
    const v = await app.inject({ method: "GET", url: `${CALLS}/${c.id}/voice/0`, headers: as(U) });
    expect(v.statusCode).toBe(200);
    expect(v.headers["content-type"]).toBe("audio/mpeg");
    expect(v.body).toBe("audio:It's time to leave.");
    expect(record).not.toHaveBeenCalled();
    expect(tally).not.toHaveBeenCalled();
    await costOf(c.id, READ_USD);
  });

  it("a turn by voice with the usage meter out: 200, the flag reaches the chat, and the turn and its voice both land on the row", async () => {
    meterOut();
    const c = await put();
    const r = await app.inject({ method: "POST", url: `${CALLS}/${c.id}/say`, headers: as(U), payload: { words: "Move it to 6" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ spoken: "Done. I moved it to 6 pm.", ended: false, turn: 1 });
    expect(record).not.toHaveBeenCalled();
    // The flag the chat is asked with: without it the bot's day budget and the spend gate would hold the turn (the two tests below).
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]!.at(-1)).toEqual({ call: true });
    // The answer's own paise as dollars, plus the voice made ahead for it.
    await costOf(c.id, TURN_PAISE / 100 / getConfig().CODE_USD_INR + READ_USD);
  });

  describe("with PLAN_CALL_REALTIME off, which is every build today", () => {
    beforeEach(() => { vi.stubEnv("PLAN_CALL_REALTIME", "false"); resetConfigForTests(); });
    afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

    it("a call's voice is held to the meter again: 429 over a used-up one, and no cost of its own on the row", async () => {
      meterOut();
      const c = await put();
      const v = await app.inject({ method: "GET", url: `${CALLS}/${c.id}/voice/0`, headers: as(U) });
      expect([v.statusCode, v.json().code]).toEqual([429, "quota_exceeded"]);
      expect((await rowOf(c.id)).cost_usd).toBe(0);
    });

    it("and the read that does happen is written down as any read-aloud is, on the tally and in a usage row", async () => {
      const c = await put();
      const v = await app.inject({ method: "GET", url: `${CALLS}/${c.id}/voice/0`, headers: as(U) });
      expect(v.statusCode).toBe(200);
      expect(v.body).toBe("audio:It's time to leave.");
      await vi.waitFor(() => expect(tally.mock.calls).toEqual([[READ_USD]]), { timeout: 3_000, interval: 10 });
      expect(record).toHaveBeenCalledTimes(1);
      // The call's row still keeps the record for the owner; it is only ever a record, and holds nothing back either way.
      await costOf(c.id, READ_USD);
    });

    it("a turn asks the chat with no call flag, so Plan Ease's day budget and the spend gate hold it as they hold any chat turn", async () => {
      const c = await put();
      const r = await app.inject({ method: "POST", url: `${CALLS}/${c.id}/say`, headers: as(U), payload: { words: "Move it to 6" } });
      expect(r.statusCode).toBe(200);
      expect(send.mock.calls[0]!.at(-1)).toEqual({ call: false });
      // The turn's own paise are NOT taken off the request's tally here: a metered turn's dollars belong to its own usage row, and
      // taking the tally would empty it before that row is written. Only the voice made ahead leaves its record on the call.
      await costOf(c.id, READ_USD);
    });
  });
});

/**
 * WHAT THE FLAG SWITCHES OFF further in, where /say's own 429s used to come from. Both are the call's bypass, and nothing else's.
 */
describe("the call's turn, past the meter", () => {
  it("the spend gate is never asked, and never written to, for a call's turn (you/limits.ts wrapBots)", async () => {
    const answer = { bot: { slug: "plan" }, paise: 120 };
    const ask = vi.fn(async () => answer);
    const bots = { ask, test: async () => answer, askWithKey: async () => ({ answer }), ownerOfKey: async () => U };
    const spending = {
      gate: vi.fn(async () => { throw new Error("the stretch is used up"); }),
      record: vi.fn(),
    };
    wrapBots(bots as never, spending as never);
    await expect(bots.ask(U, "plan", { message: "move it to 6", call: true } as never)).resolves.toBe(answer);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(spending.gate).not.toHaveBeenCalled();
    expect(spending.record).not.toHaveBeenCalled();
    // And an ordinary chat turn is still held to it.
    await expect(bots.ask(U, "plan", { message: "move it to 6" } as never)).rejects.toThrow();
  });

  it("an answer dearer than the bot's per-answer figure still comes back on a call: no 402 mid-call", async () => {
    // THE OWNER'S ANSWER: no ₹ cap on a call. Plan Ease's per-answer figure is ₹1.50, and a turn that costs more used to come back
    // as a 402 in the middle of a spoken sentence. The engine still meters the run, but against a runaway loop, not a budget.
    const r = await rig(() => "ok", { paise: 400 });
    await r.bots.create(ALICE, def({ slug: "buddy", budgets: { perRequestPaise: 150, dailyPaise: 5_000 } }));
    // A chat turn is still held to the bot's own figure.
    await expect(r.bots.ask(ALICE, "buddy", { message: "a long one" })).rejects.toMatchObject({ code: "budget", status: 402 });
    await expect(r.bots.ask(ALICE, "buddy", { message: "a long one", call: true })).resolves.toMatchObject({ text: "ok" });
  });

  it("the bot's own day budget is not asked either, and nothing is added to it (bots/service.ts ask)", async () => {
    const r = await rig(() => "ok", { paise: 5 });
    await r.bots.create(ALICE, def({ slug: "buddy", budgets: { perRequestPaise: 5, dailyPaise: 10 } }));
    await r.bots.ask(ALICE, "buddy", { message: "one" });
    await r.bots.ask(ALICE, "buddy", { message: "two" });
    // The day is spent: a chat turn is refused, a call's turn still answers, and it leaves the day where it was.
    await expect(r.bots.ask(ALICE, "buddy", { message: "three" })).rejects.toMatchObject({ code: "bot_daily_limit", status: 429 });
    await expect(r.bots.ask(ALICE, "buddy", { message: "three", call: true })).resolves.toMatchObject({ text: "ok" });
    await expect(r.bots.ask(ALICE, "buddy", { message: "four", call: true })).resolves.toMatchObject({ text: "ok" });
  });
});
