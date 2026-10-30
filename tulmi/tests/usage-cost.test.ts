/**
 * What a use really cost us, for the usage meter (src/usage/cost.ts): OpenRouter's reported charge (usage.cost) for the calls made outside
 * the brain's gateway, an estimate only when it is missing (logged rarely); the speech engines and the voice at their list prices, for every
 * engine that heard the audio; one tally per request, written with the request's usage row, or charged when the response goes; dollars
 * written as paise at CODE_USD_INR, rounded up once per person and never per use; and the refusal before the next paid call once the
 * month (or the stretch) is used.
 */
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

/** OpenRouter, as cleanup.ts and the notes reach it: answers from a script and writes down what it was asked. */
const router = vi.hoisted(() => {
  const asked: Array<Record<string, unknown>> = [];
  let reply: (body: Record<string, unknown>) => unknown = () => ({});
  return {
    asked,
    answer(f: (body: Record<string, unknown>) => unknown) { reply = f; },
    client: { chat: { completions: { create: async (body: Record<string, unknown>) => { asked.push(body); return reply(body); } } } },
  };
});
vi.mock("../src/pipeline/openrouter.js", () => ({ openrouter: () => router.client }));

import { callModel } from "../src/code/brain/gateway.js";
import { buildTierTable, resetTierTableForTests } from "../src/code/brain/tiers.js";
import { resetConfigForTests } from "../src/config.js";
import { draftReply } from "../src/pipeline/cleanup.js";
import {
  addCostUsd, chargedTo, costTallyHook, engineOf, FALLBACK_PRICES, fileEngines, inCostTally, logEstimated, noteCostUser, openRouterUsd, setCostSink,
  settleCostTally, STT_USD_PER_MINUTE, sttPrices, sttUsd, takeCostUsd, ttsUsd,
} from "../src/usage/cost.js";
import { enforceQuota, recordUsage, setUsageGate } from "../src/usage/metering.js";
import { Spending } from "../src/you/limits.js";
import { MemoryYouStore } from "../src/you/store.js";

const UID = "00000000-0000-4000-8000-00000000c0de";
const user = { id: UID };

let charged: Array<{ userId: string; usd: number; bot: string }> = [];
beforeEach(() => { charged = []; setCostSink((userId, usd, bot) => charged.push({ userId, usd, bot })); router.asked.length = 0; });
afterEach(() => { setCostSink(null); setUsageGate(null); vi.unstubAllEnvs(); resetConfigForTests(); });

const total = () => charged.reduce((n, c) => n + c.usd, 0);

describe("OpenRouter's charge", () => {
  it("is what it reports; only without it, its tokens at the worst-case prices; nothing when it says nothing", () => {
    expect(openRouterUsd({ usage: { cost: 0.000412, prompt_tokens: 900, completion_tokens: 40 } }, { where: "t", model: "m" })).toBe(0.000412);
    const warned: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((l: string) => { warned.push(l); });
    try {
      const est = openRouterUsd({ usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }, { where: "test-est", model: "x/y" });
      expect(est).toBe(FALLBACK_PRICES.usdPerMIn);
      expect(openRouterUsd({}, { where: "test-est", model: "x/y" })).toBe(0);
      expect(openRouterUsd({ usage: { cost: "0.1" } }, { where: "test-est", model: "x/z" })).toBe(0);
    } finally { spy.mockRestore(); }
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/did not say what it charged/);
  });

  it("an estimate is logged once an hour per place and model, never per call", () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    logEstimated("here", "a/b", 0, log);
    logEstimated("here", "a/b", 30 * 60_000, log);
    logEstimated("here", "c/d", 30 * 60_000, log);
    logEstimated("here", "a/b", 61 * 60_000, log);
    expect(lines).toHaveLength(3);
  });

  it("Keybot's rewrites ask for it and put it on the request's tally", async () => {
    router.answer(() => ({ choices: [{ message: { content: "Sounds good, see you at 6." }, finish_reason: "stop" }], usage: { prompt_tokens: 800, completion_tokens: 12, cost: 0.00021 } }));
    const usd = await inCostTally(async () => {
      await draftReply("Are we still on for 6?", "say yes");
      return takeCostUsd();
    });
    expect(router.asked.length).toBeGreaterThan(0);
    for (const body of router.asked) expect(body.usage).toEqual({ include: true });
    expect(usd).toBeCloseTo(0.00021 * router.asked.length, 10);
  });

  it("the gateway reads the charge it reports, and logs rarely when it has to estimate", async () => {
    resetTierTableForTests();
    const tiers = buildTierTable({ tiers: JSON.stringify({ code: { models: ["a/one"], maxTokens: 100, reasoning: "low", timeoutMs: 5000, usdPerMIn: 2, usdPerMOut: 10 } }) });
    const warns: string[] = [];
    let cost: number | undefined = 0.002;
    const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, ...(cost !== undefined ? { cost } : {}) } }) } } };
    const deps = { client, tiers, fx: 88, ledger: null, breakers: null, log: { info: () => undefined, warn: (_o: object, m: string) => { warns.push(m); } } };
    const ask = { tier: "code" as const, messages: [{ role: "user" as const, content: "hi" }], purpose: "test", budget: "none" as const };
    const reported = await callModel(ask, deps);
    expect(reported).toMatchObject({ costUsd: 0.002, costSource: "reported" });
    cost = undefined;
    const a = await callModel(ask, deps);
    await callModel(ask, deps);
    expect(a.costSource).toBe("estimated");
    expect(a.costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1_000_000, 10);
    expect(warns.filter((w) => /did not say what it charged/.test(w))).toHaveLength(1);
  });
});

describe("speech and the voice, at their list prices", () => {
  it("every engine that heard the audio is counted; Groq bills at least ten seconds", () => {
    const p = { ...STT_USD_PER_MINUTE };
    expect(sttUsd(60, ["deepgram", "sarvam"], p)).toBeCloseTo(0.0058 + 0.0058, 10);
    expect(sttUsd(120, ["openai"], p)).toBeCloseTo(0.006, 10);
    expect(sttUsd(3, ["groq"], p)).toBeCloseTo((10 / 60) * (0.04 / 60), 12);
    expect(sttUsd(0, ["groq"], p)).toBe(0);
    expect(sttUsd(60, [null], p)).toBe(0);
  });

  it("the engines a recorded clip goes to, as stt.ts picks them, and an engine by its label", () => {
    const base = { STT_PROVIDER: "groq" as const, GROQ_API_KEY: "k", SARVAM_API_KEY: undefined, DEEPGRAM_API_KEY: undefined, STT_AUTO_INCLUDE_DEEPGRAM: false };
    expect(fileEngines(base)).toEqual(["groq"]);
    expect(fileEngines({ ...base, STT_PROVIDER: "openai" })).toEqual(["openai"]);
    expect(fileEngines({ ...base, STT_PROVIDER: "auto" })).toEqual(["groq"]);
    expect(fileEngines({ ...base, STT_PROVIDER: "auto", SARVAM_API_KEY: "s" })).toEqual(["sarvam", "groq"]);
    expect(fileEngines({ ...base, STT_PROVIDER: "auto", SARVAM_API_KEY: "s", DEEPGRAM_API_KEY: "d", STT_AUTO_INCLUDE_DEEPGRAM: true })).toEqual(["sarvam", "groq", "deepgram"]);
    expect(fileEngines({ ...base, STT_PROVIDER: "sarvam" })).toEqual(["sarvam"]);
    expect(["deepgram:general", "sarvam:indic", "openai:transcribe", "live:unknown", undefined].map(engineOf)).toEqual(["deepgram", "sarvam", "openai", null, null]);
  });

  it("USAGE_STT_USD_PER_MINUTE changes a price; a name or a price that is not one is ignored", () => {
    expect(sttPrices('{"deepgram": 0.0043, "nobody": 1, "sarvam": -1}')).toEqual({ ...STT_USD_PER_MINUTE, deepgram: 0.0043 });
    expect(sttPrices("not json")).toEqual(STT_USD_PER_MINUTE);
    expect(ttsUsd(1_000_000, 15)).toBe(15);
    expect(ttsUsd(0, 15)).toBe(0);
  });
});

describe("the request's tally, written to the meter", () => {
  it("a dictation's row writes what its rewrite was charged and what its speech cost, under Keybot", async () => {
    await inCostTally(async () => {
      addCostUsd(0.0003);
      await recordUsage({ user, source: "rest", audioSeconds: 30, words: 40, model: "m" });
      // The tally was taken: a second row in the same request does not count it again.
      await recordUsage({ user, source: "rest", audioSeconds: 0, words: 3, model: "m" });
    });
    expect(charged).toHaveLength(1);
    expect(charged[0]).toMatchObject({ userId: UID, bot: "keybot" });
    expect(charged[0]!.usd).toBeCloseTo(0.0003 + (30 / 60) * (0.04 / 60), 12);
  });

  it("live dictation counts both engines that heard it; an Ask step counts under Tailzu; a note's other track is heard too", async () => {
    await recordUsage({ user, source: "stream", audioSeconds: 120, words: 300, model: "deepgram:general", sttEngines: ["deepgram:general", "sarvam:indic"] });
    expect(charged.pop()!.usd).toBeCloseTo(2 * (0.0058 + 0.0058), 10);
    await recordUsage({ user, source: "agent", audioSeconds: 6, words: 0, model: "deepgram:general", sttEngines: ["deepgram:general", null] });
    expect(charged.pop()).toMatchObject({ bot: "tailzu" });
    await recordUsage({ user, source: "rest", audioSeconds: 0, sttSeconds: 60, words: 10, model: "notes" });
    expect(charged.pop()!.usd).toBeCloseTo(0.04 / 60, 12);
  });

  it("what a request spent and never wrote down (it failed after the model answered) is charged to whose request it was", async () => {
    const app = Fastify();
    app.addHook("preHandler", costTallyHook);
    app.addHook("onResponse", async (req) => { await settleCostTally(req); });
    app.post("/rewrite", async () => {
      await enforceQuota(user);
      await new Promise((r) => setTimeout(r, 5));
      addCostUsd(0.004);
      throw new Error("the rewrite came back empty");
    });
    app.get("/nobody", async () => { addCostUsd(1); return {}; });
    expect((await app.inject({ method: "POST", url: "/rewrite", payload: { text: "x" } })).statusCode).toBe(500);
    expect((await app.inject({ method: "GET", url: "/nobody" })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(charged).toEqual([{ userId: UID, usd: 0.004, bot: "keybot" }]);
    await app.close();
  });

  it("work that goes on after the request (a note organised) is charged when it is done; outside any tally nothing is counted twice", async () => {
    await chargedTo(UID, "keybot", async () => { addCostUsd(0.01); await Promise.resolve(); addCostUsd(0.02); });
    expect(total()).toBeCloseTo(0.03, 10);
    addCostUsd(5);
    noteCostUser(UID);
    expect(takeCostUsd()).toBe(0);
    expect(total()).toBeCloseTo(0.03, 10);
  });
});

describe("on the meter, and refused before the next paid call", () => {
  it("dollars are written as paise at CODE_USD_INR, rounded up once per person, never per use", async () => {
    const store = new MemoryYouStore();
    const s = new Spending({ store, jobs: null, entitlement: async () => null });
    // A dictation at a hundredth of a cent is 0.88 paise: ten of them are 8.8, written as 9, not 10.
    for (let i = 0; i < 10; i += 1) s.recordUsd(UID, "keybot", 0.0001);
    const rows = await store.spendSince(UID, 0);
    expect(rows.reduce((n, r) => n + r.paise, 0)).toBe(9);
    s.recordUsd(UID, "keybot", 0);
    s.recordUsd(UID, "keybot", -1);
    expect((await store.spendSince(UID, 0)).reduce((n, r) => n + r.paise, 0)).toBe(9);
  });

  it("a free account is refused once its $3 month is used, with the month's words, before Keybot calls anything", async () => {
    vi.stubEnv("FREE_FOR_ALL", "false");
    resetConfigForTests();
    const store = new MemoryYouStore();
    const s = new Spending({ store, jobs: null, entitlement: async () => null, now: () => Date.UTC(2026, 9, 28, 12) });
    setCostSink((userId, usd, bot) => s.recordUsd(userId, bot, usd));
    setUsageGate(async (id) => (await s.refusal(id))?.message ?? null);
    await inCostTally(async () => {
      addCostUsd(2.99);
      await recordUsage({ user, source: "rest", audioSeconds: 0, words: 10, model: "m" });
    });
    s.forget(UID);
    expect(await enforceQuota(user)).toBeNull();
    expect((await s.usage(UID, { fresh: true })).plan).toMatchObject({ id: "free", windows: false });
    s.recordUsd(UID, "keybot", 0.02);
    s.forget(UID);
    const refused = await enforceQuota(user);
    expect(refused).toBe("You've reached this month's limit. It resets Sun.");
    expect(refused).not.toMatch(/stretch|₹|\$|paise/);
  });
});
