/**
 * A DOUBLE TAP IS ONE REQUEST, AND IDENTICAL READS SHARE A TRIP (src/guard/idempotency.ts, coalesce.ts, and the Guard that puts the key,
 * the permit and the work together): the key from the header or from a hash of the request, joining a run that is out, replaying a
 * finished one for 30 seconds, forgetting a failure, refusing a reused key; and the coalescer for the cheap reads.
 */
import { describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { Idempotency, IdempotencyConflict, canonical, IDEMPOTENCY_TTL_MS } = await import("../src/guard/idempotency.js");
const { Coalescer, coalescer, resetCoalescerForTests } = await import("../src/guard/coalesce.js");
const { Guard, Overloaded, guardFromConfig, defaultGuard, resetGuardForTests } = await import("../src/guard/index.js");
const { resetConfigForTests } = await import("../src/config.js");

/** A promise settled by hand. */
function gate<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

describe("the key", () => {
  it("is the same for the same request however its keys are ordered, and differs by person, route and body", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(canonical({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
    const k = (u: string, r: string, b: unknown, h?: string) => Idempotency.keyOf(u, r, b, h).key;
    expect(k("u", "r", { a: 1, b: 2 })).toBe(k("u", "r", { b: 2, a: 1 }));
    expect(k("u", "r", { a: 1 })).not.toBe(k("v", "r", { a: 1 }));
    expect(k("u", "r", { a: 1 })).not.toBe(k("u", "s", { a: 1 }));
    expect(k("u", "r", { a: 1 })).not.toBe(k("u", "r", { a: 2 }));
  });

  it("is the client's header when it sends one: the body does not matter to the key, only to whether it is a retry", () => {
    const a = Idempotency.keyOf("u", "r", { a: 1 }, "tap-1");
    const b = Idempotency.keyOf("u", "r", { a: 2 }, "tap-1");
    expect(a.key).toBe(b.key);
    expect(a.bodyHash).not.toBe(b.bodyHash);
    expect(Idempotency.keyOf("v", "r", { a: 1 }, "tap-1").key).not.toBe(a.key);
    expect(Idempotency.keyOf("u", "r", { a: 1 }, "  ").key).toBe(Idempotency.keyOf("u", "r", { a: 1 }).key);
  });
});

describe("a double tap", () => {
  it("joins the run that is out: the work runs once and both get the same answer", async () => {
    const idem = new Idempotency();
    const id = Idempotency.keyOf("u", "POST /v1/ask", { message: "hi" });
    const g = gate<string>();
    const work = vi.fn(async () => g.promise);
    const first = idem.run(id, work);
    const second = idem.run(id, work);
    await tick();
    expect(work).toHaveBeenCalledTimes(1);
    g.resolve("answer");
    expect(await first).toEqual({ result: "answer", replay: null });
    expect(await second).toEqual({ result: "answer", replay: "joined" });
    expect(idem.stats()).toMatchObject({ joined: 1, replayed: 0 });
  });

  it("gets the same answer again, without the work, for 30 seconds after it finished", async () => {
    let t = 0;
    const idem = new Idempotency({ now: () => t });
    const id = Idempotency.keyOf("u", "r", { n: 1 });
    const work = vi.fn(async () => ({ status: 201, n: 7 }));
    expect((await idem.run(id, work)).replay).toBeNull();
    t += IDEMPOTENCY_TTL_MS - 1;
    const again = await idem.run(id, work);
    expect(again).toEqual({ result: { status: 201, n: 7 }, replay: "stored" });
    expect(work).toHaveBeenCalledTimes(1);
    t += 2;
    expect((await idem.run(id, work)).replay).toBeNull();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure: the next try runs again, and one that joined heard the failure too", async () => {
    const idem = new Idempotency();
    const id = Idempotency.keyOf("u", "r", {});
    const g = gate<string>();
    const a = idem.run(id, async () => g.promise);
    const b = idem.run(id, async () => "never");
    const heardA = a.catch((e: Error) => e.message);
    const heardB = b.catch((e: Error) => e.message);
    g.reject(new Error("model down"));
    expect(await heardA).toBe("model down");
    expect(await heardB).toBe("model down");
    expect((await idem.run(id, async () => "second try")).result).toBe("second try");
  });

  it("forgets a result the caller says is not worth replaying (an error answer), but the ones waiting still get it", async () => {
    const idem = new Idempotency();
    const id = Idempotency.keyOf("u", "r", {});
    const g = gate<{ status: number }>();
    const keep = (r: { status: number }) => r.status < 400;
    const a = idem.run(id, async () => g.promise, { keep });
    const b = idem.run(id, async () => ({ status: 200 }), { keep });
    g.resolve({ status: 422 });
    expect((await a).result.status).toBe(422);
    expect((await b).result.status).toBe(422);
    const c = await idem.run(id, async () => ({ status: 200 }), { keep });
    expect(c).toEqual({ result: { status: 200 }, replay: null });
  });

  it("refuses a key that was used for a different request", async () => {
    const idem = new Idempotency();
    await idem.run(Idempotency.keyOf("u", "r", { a: 1 }, "k"), async () => 1);
    await expect(idem.run(Idempotency.keyOf("u", "r", { a: 2 }, "k"), async () => 2)).rejects.toBeInstanceOf(IdempotencyConflict);
    // the same key and the same body is the retry it was meant for
    expect((await idem.run(Idempotency.keyOf("u", "r", { a: 1 }, "k"), async () => 3)).replay).toBe("stored");
    expect(new IdempotencyConflict().status).toBe(409);
  });

  it("shows a late joiner the events that went by, in order, and then the live ones", async () => {
    const idem = new Idempotency();
    const id = Idempotency.keyOf("u", "r", { s: 1 });
    const g = gate<string>();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const a = idem.run(id, async (emit) => { emit({ t: "text", n: 1 }); emit({ t: "text", n: 2 }); const r = await g.promise; emit({ t: "result", r }); return r; }, { onEvent: (e) => seenA.push(e) });
    await tick();
    const b = idem.run(id, async () => "unused", { onEvent: (e) => seenB.push(e) });
    await tick();
    g.resolve("done");
    await Promise.all([a, b]);
    expect(seenA).toEqual([{ t: "text", n: 1 }, { t: "text", n: 2 }, { t: "result", r: "done" }]);
    expect(seenB).toEqual(seenA);
    // and a repeat after it ended is shown the same stream
    const seenC: unknown[] = [];
    const c = await idem.run(id, async () => "unused", { onEvent: (e) => seenC.push(e) });
    expect(c.replay).toBe("stored");
    expect(seenC).toEqual(seenA);
  });

  it("is bounded: the oldest entries go when there are too many", async () => {
    const idem = new Idempotency({ max: 3 });
    for (let i = 0; i < 6; i += 1) await idem.run(Idempotency.keyOf("u", "r", { i }), async () => i);
    expect(idem.stats().entries).toBeLessThanOrEqual(4);
    expect((await idem.run(Idempotency.keyOf("u", "r", { i: 0 }), async () => 0)).replay).toBeNull();
  });
});

describe("stopping", () => {
  it("stops the run only when every request waiting on it has gone: the first tap's connection dropping does not kill the second tap's run", async () => {
    const idem = new Idempotency();
    const id = Idempotency.keyOf("u", "r", { n: 1 });
    const g = gate<string>();
    let stopSignal!: AbortSignal;
    const first = new AbortController();
    const second = new AbortController();
    const a = idem.run(id, async (_emit, stop) => { stopSignal = stop; return g.promise; }, { signal: first.signal });
    const b = idem.run(id, async () => "never", { signal: second.signal });
    const heardA = a.catch((e: Error) => e.name);
    await tick();
    first.abort();
    // the one that went away stops waiting at once; the run goes on for the one that stayed
    expect(await heardA).toBe("AbortError");
    expect(stopSignal.aborted).toBe(false);
    g.resolve("done");
    expect(await b).toEqual({ result: "done", replay: "joined" });
  });

  it("stops it when the last one goes, so a queued or running request does not go on for nobody", async () => {
    const idem = new Idempotency();
    const id = Idempotency.keyOf("u", "r", { n: 2 });
    let stopSignal!: AbortSignal;
    const one = new AbortController();
    const two = new AbortController();
    const a = idem.run(id, async (_e, stop) => { stopSignal = stop; return new Promise<string>((_, reject) => stop.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { name: "AbortError" })))); }, { signal: one.signal });
    const b = idem.run(id, async () => "never", { signal: two.signal });
    const heard = Promise.allSettled([a, b]);
    await tick();
    one.abort();
    expect(stopSignal.aborted).toBe(false);
    two.abort();
    expect(stopSignal.aborted).toBe(true);
    expect((await heard).map((r) => r.status)).toEqual(["rejected", "rejected"]);
    // and a stopped run is forgotten: the next tap runs
    expect((await idem.run(id, async () => "again")).result).toBe("again");
  });

  it("does not start for a caller who has already gone", async () => {
    const idem = new Idempotency();
    const gone = new AbortController();
    gone.abort();
    const work = vi.fn(async () => "x");
    await expect(idem.run(Idempotency.keyOf("u", "r", {}), work, { signal: gone.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("takes a queued request out of the line when nobody is waiting on it", async () => {
    const guard = new Guard({ limiter: { global: 1, perUser: 1, perUserFree: 1 } });
    const hold = gate<string>();
    const first = guard.run({ userId: "a", plan: "paid", route: "r", body: { m: 1 }, lane: "ask" }, async () => hold.promise);
    await tick();
    const ctl = new AbortController();
    const queued = guard.run({ userId: "b", plan: "paid", route: "r", body: { m: 2 }, lane: "ask", signal: ctl.signal }, async () => "b");
    const heard = queued.catch((e: Error) => e.name);
    await tick();
    expect(guard.limiter.stats().queued).toBe(1);
    ctl.abort();
    expect(await heard).toBe("AbortError");
    await tick();
    expect(guard.limiter.stats().queued).toBe(0);
    hold.resolve("a");
    await first;
  });
});

describe("the guard around the work", () => {
  const req = (over: Record<string, unknown> = {}) => ({ userId: "u1", plan: "paid" as const, route: "POST /v1/ask", body: { message: "hello" }, lane: "ask" as const, ...over });

  it("takes a permit for the work and gives it back, and a double tap shares the one run and the one permit", async () => {
    const guard = new Guard({ limiter: { global: 4, perUser: 3, perUserFree: 1 } });
    const g = gate<string>();
    let running = 0;
    let peak = 0;
    const work = async () => { running += 1; peak = Math.max(peak, running); const r = await g.promise; running -= 1; return r; };
    const a = guard.run(req(), work);
    const b = guard.run(req(), work);
    await tick();
    expect(guard.limiter.stats().active).toBe(1);
    g.resolve("x");
    expect((await a).result).toBe("x");
    expect((await b).replay).toBe("joined");
    expect(peak).toBe(1);
    expect(guard.limiter.stats().active).toBe(0);
  });

  it("does not store a request the limiter turned away: it can be tried again", async () => {
    const guard = new Guard({ limiter: { global: 1, perUser: 1, perUserFree: 1, queueMax: 0, queuePerUser: 0 } });
    const hold = gate<string>();
    const first = guard.run(req({ userId: "a", body: { m: 1 } }), async () => hold.promise);
    await tick();
    await expect(guard.run(req({ userId: "b", body: { m: 2 } }), async () => "b")).rejects.toBeInstanceOf(Overloaded);
    hold.resolve("a");
    await first;
    expect((await guard.run(req({ userId: "b", body: { m: 2 } }), async () => "b")).result).toBe("b");
  });

  it("passes the events of a stream to whoever asked, once each", async () => {
    const guard = new Guard();
    const seen: unknown[] = [];
    const out = await guard.run(req({ onEvent: (e: unknown) => seen.push(e) }), async (emit) => { emit("a"); emit("b"); return "done"; });
    expect(out.result).toBe("done");
    expect(seen).toEqual(["a", "b"]);
  });

  it("reports its health: the limiter, the idempotency store, the coalescer and the breakers", async () => {
    const guard = new Guard();
    await guard.run(req(), async () => 1);
    const h = guard.health();
    expect(h.limiter).toMatchObject({ active: 0, queued: 0 });
    expect(h.idempotency.entries).toBe(1);
    expect(h.coalescing).toMatchObject({ inflight: 0 });
    expect(h.breakers).toEqual([]);
    expect(h.open).toBe(0);
  });

  it("is built from the config: 64 at once, 3 a person (1 on the free plan), and the front door's daily cap", async () => {
    resetConfigForTests();
    resetGuardForTests();
    const g = guardFromConfig();
    expect(g.limiter.config).toMatchObject({ global: 64, perUser: 3, perUserFree: 1, queueMax: 256, queuePerUser: 4, waitMs: 8000 });
    expect(g.daily.leftPaise("u")).toBe(1500);
    process.env.GUARD_GLOBAL_CONCURRENCY = "7";
    process.env.GUARD_USER_CONCURRENCY = "2";
    process.env.GUARD_USER_CONCURRENCY_FREE = "5";
    process.env.FRONT_DAILY_PAISE = "99";
    resetConfigForTests();
    try {
      const h = guardFromConfig();
      // a free person is never allowed more than a paid one
      expect(h.limiter.config).toMatchObject({ global: 7, perUser: 2, perUserFree: 2 });
      expect(h.daily.leftPaise("u")).toBe(99);
      expect(defaultGuard()).toBe(defaultGuard());
    } finally {
      for (const k of ["GUARD_GLOBAL_CONCURRENCY", "GUARD_USER_CONCURRENCY", "GUARD_USER_CONCURRENCY_FREE", "FRONT_DAILY_PAISE"]) delete process.env[k];
      resetConfigForTests();
      resetGuardForTests();
    }
  });
});

describe("coalescing", () => {
  it("makes one trip for identical reads that are out at the same moment, and gives each its own copy of the news", async () => {
    const co = new Coalescer();
    const g = gate<string>();
    const trip = vi.fn(async () => g.promise);
    const all = [co.run("page:a", trip), co.run("page:a", trip), co.run("page:a", trip)];
    expect(trip).toHaveBeenCalledTimes(1);
    expect(co.stats()).toMatchObject({ inflight: 1, started: 1, joined: 2 });
    g.resolve("body");
    expect(await Promise.all(all)).toEqual(["body", "body", "body"]);
    expect(co.stats().inflight).toBe(0);
  });

  it("keeps different reads apart, and keeps nothing once a read has finished", async () => {
    const co = new Coalescer();
    const trip = vi.fn(async (n: number) => n);
    expect(await Promise.all([co.run("a", () => trip(1)), co.run("b", () => trip(2))])).toEqual([1, 2]);
    expect(await co.run("a", () => trip(3))).toBe(3);
    expect(trip).toHaveBeenCalledTimes(3);
  });

  it("shares a failure with everyone who joined, and the next caller tries afresh", async () => {
    const co = new Coalescer();
    const g = gate<string>();
    const a = co.run("k", () => g.promise);
    const b = co.run("k", () => g.promise);
    const heard = Promise.allSettled([a, b]);
    g.reject(new Error("503"));
    const r = await heard;
    expect(r.map((x) => x.status)).toEqual(["rejected", "rejected"]);
    expect(await co.run("k", async () => "fine")).toBe("fine");
  });

  it("does not let a stopped leader cancel the others' read: a joiner whose own caller is still there reads it again", async () => {
    const co = new Coalescer();
    const g = gate<string>();
    const leader = co.run("k", () => g.promise);
    const mine = new AbortController();
    const joiner = co.run("k", async () => "read again", { signal: mine.signal });
    g.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(leader).rejects.toMatchObject({ name: "AbortError" });
    expect(await joiner).toBe("read again");
    // a joiner that was stopped itself hears the abort
    const g2 = gate<string>();
    const l2 = co.run("k2", () => g2.promise);
    const stopped = new AbortController();
    const j2 = co.run("k2", async () => "never", { signal: stopped.signal });
    stopped.abort();
    g2.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(l2).rejects.toBeDefined();
    await expect(j2).rejects.toMatchObject({ name: "AbortError" });
  });

  it("has one for the process, for the web layer, the kit and the brain's searches", () => {
    resetCoalescerForTests();
    expect(coalescer()).toBe(coalescer());
    expect(coalescer().stats()).toMatchObject({ started: 0, joined: 0 });
  });
});
