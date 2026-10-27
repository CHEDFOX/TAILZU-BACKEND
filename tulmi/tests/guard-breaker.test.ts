/**
 * THE CIRCUIT BREAKERS (src/guard/breaker.ts) AND THE GATEWAY THAT OBEYS THEM (code/brain/gateway.ts):
 * a key that fails half of 8 or more calls in 60 seconds opens; an open key is skipped and the ladder climbs without a call; after a cooldown ONE
 * probe is let through, and it closes the breaker or opens it again; a model is behind both its own slug and its provider; the trail and the
 * log say what was skipped; every model skipped is an immediate ModelUnavailable. A fake clock moves time, a fake router answers.
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { Breakers, BREAKER_DEFAULTS, CircuitBreaker, sharedBreakers, resetBreakersForTests } = await import("../src/guard/breaker.js");
const { callModel, ModelUnavailable } = await import("../src/code/brain/gateway.js");
const { buildTierTable, resetTierTableForTests } = await import("../src/code/brain/tiers.js");
const { Guard } = await import("../src/guard/index.js");
type GatewayDeps = import("../src/code/brain/gateway.js").GatewayDeps;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** Calls to a key: n failures then m successes, one per second so they stay in the window. */
function feed(b: InstanceType<typeof Breakers>, c: ReturnType<typeof clock>, key: string, outcomes: boolean[]) {
  for (const ok of outcomes) {
    const a = b.admit([key]);
    if (!a.ok) continue;
    if (ok) b.success(a.ticket); else b.failure(a.ticket);
    c.advance(1000);
  }
}

describe("the defaults", () => {
  it("are 50% of 8 calls in 60 seconds, a 30 second cooldown", () => {
    expect(BREAKER_DEFAULTS).toMatchObject({ minCalls: 8, failureRate: 0.5, windowMs: 60_000, cooldownMs: 30_000 });
  });
});

describe("a breaker", () => {
  it("stays closed below 8 calls, however badly they went", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "m", Array(7).fill(false));
    expect(b.state("m")).toBe("closed");
    expect(b.admit(["m"]).ok).toBe(true);
  });

  it("opens at half failing over 8 or more calls, and not at less than half", () => {
    const c = clock();
    const mostlyFine = new Breakers({ now: c.now });
    feed(mostlyFine, c, "m", [true, true, true, true, false, false, false, true, true, true]);
    expect(mostlyFine.state("m")).toBe("closed");
    const half = new Breakers({ now: c.now });
    feed(half, c, "m", [true, false, true, false, true, false, true, false]);
    expect(half.state("m")).toBe("open");
    const a = half.admit(["m"]);
    expect(a).toMatchObject({ ok: false, by: "m" });
    expect((a as { retryInMs: number }).retryInMs).toBeGreaterThan(0);
  });

  it("forgets calls older than the window, so slow trouble over many minutes does not open it", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    for (let i = 0; i < 12; i += 1) { feed(b, c, "m", [false]); c.advance(20_000); }
    expect(b.state("m")).toBe("closed");
  });

  it("half-opens after the cooldown and lets exactly ONE call through; the rest wait for its answer", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "m", Array(8).fill(false));
    expect(b.state("m")).toBe("open");
    c.advance(BREAKER_DEFAULTS.cooldownMs);
    expect(b.state("m")).toBe("half_open");
    const probe = b.admit(["m"]);
    expect(probe.ok).toBe(true);
    expect(b.admit(["m"]).ok).toBe(false);
    expect(b.admit(["m"]).ok).toBe(false);
    if (probe.ok) b.success(probe.ticket);
    expect(b.state("m")).toBe("closed");
    expect(b.admit(["m"]).ok).toBe(true);
  });

  it("opens again, for another cooldown, when the probe fails", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "m", Array(8).fill(false));
    c.advance(BREAKER_DEFAULTS.cooldownMs);
    const probe = b.admit(["m"]);
    if (probe.ok) b.failure(probe.ticket);
    expect(b.state("m")).toBe("open");
    c.advance(BREAKER_DEFAULTS.cooldownMs - 1);
    expect(b.state("m")).toBe("open");
    c.advance(1);
    expect(b.state("m")).toBe("half_open");
    expect(b.snapshot().find((s) => s.key === "m")!.opens).toBe(2);
  });

  it("starts clean once closed: a few failures after a good probe do not open it at once", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "m", Array(8).fill(false));
    c.advance(BREAKER_DEFAULTS.cooldownMs);
    const probe = b.admit(["m"]);
    if (probe.ok) b.success(probe.ticket);
    feed(b, c, "m", [false, false, false]);
    expect(b.state("m")).toBe("closed");
  });

  it("is not held shut by a probe that never reports: the next caller becomes the probe after probeTimeoutMs, and a released probe frees it at once", () => {
    const c = clock();
    const b = new Breakers({ now: c.now, probeTimeoutMs: 10_000 });
    feed(b, c, "m", Array(8).fill(false));
    c.advance(BREAKER_DEFAULTS.cooldownMs);
    const lost = b.admit(["m"]);
    expect(lost.ok).toBe(true);
    expect(b.admit(["m"]).ok).toBe(false);
    c.advance(10_000);
    const next = b.admit(["m"]);
    expect(next.ok).toBe(true);
    if (next.ok) b.release(next.ticket);
    expect(b.admit(["m"]).ok).toBe(true);
  });

  it("counts a ticket's later reports as ordinary calls: a probe that worked, then a retry that failed, does not reopen it as a failed probe", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "m", Array(8).fill(false));
    c.advance(BREAKER_DEFAULTS.cooldownMs);
    const probe = b.admit(["m"]);
    if (!probe.ok) throw new Error("no probe");
    b.success(probe.ticket);
    b.failure(probe.ticket);
    expect(b.state("m")).toBe("closed");
  });

  it("asks a model's slug and its provider together: either open skips the call, and a refusal claims no probe", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "provider:acme", Array(8).fill(false));
    const a = b.admit(["model:acme/one", "provider:acme"]);
    expect(a).toMatchObject({ ok: false, by: "provider:acme" });
    // the slug is half-open and the provider is open: the slug's probe must not be spent on a call that cannot go
    const d = new Breakers({ now: c.now });
    feed(d, c, "model:acme/two", Array(8).fill(false));
    feed(d, c, "provider:acme", Array(8).fill(false));
    c.advance(BREAKER_DEFAULTS.cooldownMs - 5_000);
    feed(d, c, "x", []); // nothing
    // slug cooldown is over (it opened earlier); the provider's is not
    const both = d.admit(["model:acme/two", "provider:acme"]);
    expect(both.ok).toBe(false);
    c.advance(BREAKER_DEFAULTS.cooldownMs);
    const now = d.admit(["model:acme/two", "provider:acme"]);
    expect(now.ok).toBe(true);
    if (now.ok) expect([...now.ticket.probes].sort()).toEqual(["model:acme/two", "provider:acme"]);
  });

  it("lists every breaker for the admin, open ones first, with how long until a probe", () => {
    const c = clock();
    const b = new Breakers({ now: c.now });
    feed(b, c, "model:ok/a", [true, true]);
    feed(b, c, "model:bad/b", Array(8).fill(false));
    const list = b.snapshot();
    expect(list.map((s) => s.key)).toEqual(["model:bad/b", "model:ok/a"]);
    expect(list[0]).toMatchObject({ state: "open", opens: 1 });
    expect(list[0]!.retryInMs).toBeGreaterThan(0);
    expect(list[1]).toMatchObject({ state: "closed", calls: 2, failures: 0 });
    b.reset();
    expect(b.snapshot()).toEqual([]);
  });

  it("is a CircuitBreaker underneath, with the settings it was given", () => {
    const c = clock();
    const one = new CircuitBreaker("k", { minCalls: 2, failureRate: 1, windowMs: 1000, cooldownMs: 50, probeTimeoutMs: 100 });
    one.failure(c.now(), false);
    expect(one.state(c.now())).toBe("closed");
    one.failure(c.now(), false);
    expect(one.state(c.now())).toBe("open");
    expect(one.state(c.now() + 50)).toBe("half_open");
  });
});

// ----------------------------------------------------------------------------------------------- the gateway

type Reply = unknown | Error | ((body: { model: string }) => unknown);
const answer = (text: string) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 }, provider: "Test" });
const httpError = (status: number) => Object.assign(new Error(`${status}`), { status });

/** A router that answers by model: a reply, or an error, for each slug. */
function router(by: Record<string, Reply>) {
  const calls: string[] = [];
  return {
    calls,
    chat: { completions: { create: async (body: { model: string }) => {
      calls.push(body.model);
      const r = by[body.model];
      const v = typeof r === "function" ? (r as (b: { model: string }) => unknown)(body) : r;
      if (v instanceof Error) throw v;
      return v ?? answer("ok");
    } } },
  };
}

const table = buildTierTable({
  tiers: JSON.stringify({ code: { models: ["a/one", "b/two", "a/three"], maxTokens: 100, reasoning: "none", timeoutMs: 5000, usdPerMIn: 1, usdPerMOut: 5 } }),
});

function rig(by: Record<string, Reply>, c: ReturnType<typeof clock>, more: Partial<GatewayDeps> = {}) {
  const r = router(by);
  const lines: Array<{ o: Record<string, unknown>; msg: string }> = [];
  const breakers = new Breakers({ now: c.now });
  const deps: GatewayDeps = {
    client: r, tiers: table, fx: 88, ledger: null, random: () => 0.5, now: c.now, sleep: async () => undefined, breakers,
    log: { info: (o, msg) => lines.push({ o: o as Record<string, unknown>, msg }), warn: (o, msg) => lines.push({ o: o as Record<string, unknown>, msg }) },
    ...more,
  };
  const ask = () => callModel({ tier: "code", messages: [{ role: "user", content: "hi" }], purpose: "t", budget: "none" }, deps);
  return { r, deps, breakers, lines, ask };
}

beforeEach(() => { resetTierTableForTests(); resetBreakersForTests(); });

describe("the gateway and an open breaker", () => {
  it("tries a failing model until its breaker opens, then skips it without a call and climbs", async () => {
    const c = clock();
    const t = rig({ "a/one": httpError(400), "b/two": answer("from b") }, c);
    // each call: a/one fails (400: no retry), the ladder moves on to b/two. Eight failures in a window open a/one and the provider "a".
    for (let i = 0; i < 8; i += 1) { expect((await t.ask()).model).toBe("b/two"); c.advance(500); }
    expect(t.breakers.state("model:a/one")).toBe("open");
    expect(t.r.calls.filter((m) => m === "a/one")).toHaveLength(8);
    t.r.calls.length = 0;
    const res = await t.ask();
    expect(res.model).toBe("b/two");
    expect(t.r.calls).toEqual(["b/two"]);
    expect(res.trail[0]).toEqual({ model: "a/one", outcome: "skipped", skipped: "breaker" });
    expect(res.trail[1]).toMatchObject({ model: "b/two", outcome: "ok" });
    const skip = t.lines.filter((l) => l.msg.includes("skipping a model whose breaker is open"));
    expect(skip.length).toBeGreaterThan(0);
    expect(skip.at(-1)!.o).toMatchObject({ model: "a/one", purpose: "t", breaker: "model:a/one" });
    // what was sent or received is not in any line
    expect(JSON.stringify(t.lines)).not.toContain('"hi"');
  });

  it("skips every model of a provider whose breaker is open, not just the one that failed", async () => {
    const c = clock();
    // Provider "a" fails half its calls (a/one fails, a/three answers). Over 8 calls, at its next failure, it opens, though no single slug of it has had 8.
    const t = rig({ "a/one": httpError(400), "b/two": httpError(400), "a/three": answer("three") }, c);
    for (let i = 0; i < 4; i += 1) { expect((await t.ask()).model).toBe("a/three"); c.advance(300); }
    expect(t.breakers.state("provider:a")).toBe("closed");
    // the fifth call's a/one failure opens the provider in the middle of the ladder, and a/three, behind it, is skipped
    const fifth = await t.ask().catch((e: unknown) => e);
    expect(fifth).toBeInstanceOf(ModelUnavailable);
    expect((fifth as InstanceType<typeof ModelUnavailable>).trail.map((e) => `${e.model}:${e.outcome}`)).toEqual(["a/one:failed", "b/two:failed", "a/three:skipped"]);
    expect(t.breakers.state("provider:a")).toBe("open");
    expect(t.breakers.state("model:a/one")).toBe("closed");
    expect(t.breakers.state("model:a/three")).toBe("closed");
    t.r.calls.length = 0;
    const err = await t.ask().catch((e: unknown) => e);
    // a/three would have worked, but its provider is cooling off, so only b/two was asked
    expect(t.r.calls).toEqual(["b/two"]);
    expect((err as InstanceType<typeof ModelUnavailable>).trail.map((e) => `${e.model}:${e.outcome}`)).toEqual(["a/one:skipped", "b/two:failed", "a/three:skipped"]);
  });

  it("goes back to a model after the cooldown with one probe, and keeps it if the probe works", async () => {
    const c = clock();
    let healthy = false;
    const t = rig({ "a/one": () => (healthy ? answer("a is back") : httpError(400)), "b/two": answer("b") }, c);
    for (let i = 0; i < 8; i += 1) { await t.ask(); c.advance(300); }
    expect(t.breakers.state("model:a/one")).toBe("open");
    c.advance(30_000);
    healthy = true;
    t.r.calls.length = 0;
    const probe = await t.ask();
    expect(probe.model).toBe("a/one");
    expect(t.r.calls).toEqual(["a/one"]);
    expect(t.breakers.state("model:a/one")).toBe("closed");
    expect((await t.ask()).model).toBe("a/one");
  });

  it("opens again when the probe fails, and goes on to the next model in the same call", async () => {
    const c = clock();
    const t = rig({ "a/one": httpError(400), "b/two": answer("b") }, c);
    for (let i = 0; i < 8; i += 1) { await t.ask(); c.advance(300); }
    c.advance(30_000);
    t.r.calls.length = 0;
    const res = await t.ask();
    expect(t.r.calls).toEqual(["a/one", "b/two"]);
    expect(res.model).toBe("b/two");
    expect(t.breakers.state("model:a/one")).toBe("open");
  });

  it("fails at once, without a call, when every model on the ladder is cooling off", async () => {
    const c = clock();
    const t = rig({ "a/one": httpError(500), "b/two": httpError(500), "a/three": httpError(500) }, c, { sleep: async () => undefined });
    for (let i = 0; i < 6; i += 1) { await t.ask().catch(() => undefined); c.advance(100); }
    t.r.calls.length = 0;
    const err = await t.ask().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailable);
    expect(t.r.calls).toEqual([]);
    expect((err as InstanceType<typeof ModelUnavailable>).trail.map((e) => e.outcome)).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("does not count an answer that was bad JSON, a refusal for the budget or a stopped caller against the model", async () => {
    const c = clock();
    const t = rig({ "a/one": answer("not json at all") }, c);
    for (let i = 0; i < 10; i += 1) {
      await callModel({ tier: "code", messages: [{ role: "user", content: "hi" }], purpose: "t", budget: "none", json: true }, t.deps).catch(() => undefined);
    }
    expect(t.breakers.state("model:a/one")).toBe("closed");
    const stopped = new AbortController();
    stopped.abort();
    for (let i = 0; i < 10; i += 1) await callModel({ tier: "code", messages: [{ role: "user", content: "hi" }], purpose: "t", budget: "none", signal: stopped.signal }, t.deps).catch(() => undefined);
    expect(t.breakers.state("model:a/one")).toBe("closed");
    for (let i = 0; i < 10; i += 1) await callModel({ tier: "code", messages: [{ role: "user", content: "hi" }], purpose: "t", budget: { maxPaise: 0 } }, t.deps).catch(() => undefined);
    expect(t.breakers.state("model:a/one")).toBe("closed");
  });

  it("counts an empty answer and a timeout as the model failing", async () => {
    const c = clock();
    const t = rig({ "a/one": { choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: {} }, "b/two": answer("b") }, c);
    for (let i = 0; i < 8; i += 1) { await t.ask(); c.advance(100); }
    expect(t.breakers.state("model:a/one")).toBe("open");
  });

  it("uses the process's shared breakers unless it is given its own or told none, and a probe stopped in the middle frees the breaker", async () => {
    const c = clock();
    const none = rig({ "a/one": httpError(400), "b/two": answer("b") }, c, { breakers: null });
    for (let i = 0; i < 12; i += 1) await none.ask();
    expect(none.r.calls.filter((m) => m === "a/one")).toHaveLength(12);
    expect(sharedBreakers().snapshot()).toEqual([]);

    const shared = rig({ "a/one": httpError(400), "b/two": answer("b") }, c);
    delete (shared.deps as { breakers?: unknown }).breakers;
    await callModel({ tier: "code", messages: [{ role: "user", content: "hi" }], purpose: "t", budget: "none" }, shared.deps);
    expect(sharedBreakers().snapshot().map((s) => s.key).sort()).toEqual(["model:a/one", "model:b/two", "provider:a", "provider:b"]);
    expect(new Guard().breakers).toBe(sharedBreakers());
    expect(new Guard({ breakers: { minCalls: 2 } }).breakers).not.toBe(sharedBreakers());
  });
});
