/**
 * TIME, SAID ONCE (src/guard/timing.ts): a deadline on a promise, a fallback after a wait, and the jittered wait before a retry; and the places
 * that used to have their own copy (the run ledger's `within`, the brain's wait for a build, the gateway's retry) now using these.
 */
import { describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { withTimeout, withFallback, retryJitter, TimeoutError } = await import("../src/guard/timing.js");
const { within } = await import("../src/runs/ledger.js");

/** Timers moved by hand. */
function timers() {
  let id = 0;
  const live = new Map<number, { at: number; fn: () => void }>();
  let t = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { id += 1; live.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h: unknown) => { live.delete(h as number); },
    advance(ms: number) { t += ms; for (const [k, v] of [...live]) if (v.at <= t) { live.delete(k); v.fn(); } },
    count: () => live.size,
  };
}
const gate = <T = void>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe("withTimeout", () => {
  it("gives the work's answer when it is in time, and lets go of the timer", async () => {
    const tm = timers();
    const g = gate<string>();
    const p = withTimeout(g.promise, 1000, tm);
    expect(tm.count()).toBe(1);
    g.resolve("done");
    expect(await p).toBe("done");
    expect(tm.count()).toBe(0);
  });

  it("rejects with a TimeoutError at the deadline, saying what and how long, and aborts the work it started", async () => {
    const tm = timers();
    let signal!: AbortSignal;
    const p = withTimeout((s) => { signal = s; return new Promise<string>(() => undefined); }, 500, { ...tm, what: "the search" });
    tm.advance(499);
    expect(signal.aborted).toBe(false);
    tm.advance(1);
    const err = await p.catch((e: unknown) => e as InstanceType<typeof TimeoutError>);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toMatchObject({ code: "timeout", ms: 500, what: "the search", name: "TimeoutError" });
    expect((err as Error).message).toBe("the search did not finish in 500 ms");
    expect(signal.aborted).toBe(true);
  });

  it("passes the work's own failure through, and leaves a late answer alone (no unhandled rejection)", async () => {
    const tm = timers();
    const g = gate<string>();
    const p = withTimeout(g.promise, 100, tm);
    const heard = p.catch((e: Error) => e.name);
    tm.advance(100);
    expect(await heard).toBe("TimeoutError");
    g.reject(new Error("too late to matter"));
    await Promise.resolve();
    await expect(withTimeout(Promise.reject(new Error("boom")), 100, timers())).rejects.toThrow("boom");
    await expect(withTimeout(() => { throw new Error("sync"); }, 100, timers())).rejects.toThrow("sync");
  });

  it("has no deadline for a number that is not a positive, finite one", async () => {
    const tm = timers();
    expect(await withTimeout(Promise.resolve(1), 0, tm)).toBe(1);
    expect(await withTimeout(Promise.resolve(2), Infinity, tm)).toBe(2);
    expect(await withTimeout(Promise.resolve(3), Number.NaN, tm)).toBe(3);
    expect(tm.count()).toBe(0);
  });

  it("really waits, with the real timers", async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise<string>(() => undefined), 50).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(50);
      expect(await p).toBeInstanceOf(TimeoutError);
    } finally { vi.useRealTimers(); }
  });
});

describe("withFallback", () => {
  it("gives the answer in time, the fallback after the wait, and leaves the work going", async () => {
    const tm = timers();
    const quick = gate<string>();
    const a = withFallback(quick.promise, 100, "late", tm);
    quick.resolve("fast");
    expect(await a).toBe("fast");
    expect(tm.count()).toBe(0);

    const slow = gate<string>();
    const b = withFallback(slow.promise, 100, "late", tm);
    tm.advance(100);
    expect(await b).toBe("late");
    slow.resolve("eventually");
    expect(await slow.promise).toBe("eventually");
  });

  it("passes the work's failure on", async () => {
    await expect(withFallback(Promise.reject(new Error("no")), 100, "x", timers())).rejects.toThrow("no");
  });

  it("is what the run ledger's within() is", async () => {
    vi.useFakeTimers();
    try {
      const p = within(new Promise<string>(() => undefined), 2000, "gave up");
      await vi.advanceTimersByTimeAsync(2000);
      expect(await p).toBe("gave up");
      expect(await within(Promise.resolve("ok"), 2000, "gave up")).toBe("ok");
    } finally { vi.useRealTimers(); }
  });
});

describe("retryJitter", () => {
  it("spreads the wait from half to one and a half times the base", () => {
    expect(retryJitter(1000, () => 0)).toBe(500);
    expect(retryJitter(1000, () => 0.5)).toBe(1000);
    expect(retryJitter(1000, () => 0.999)).toBe(1499);
    expect(retryJitter(0, () => 0.5)).toBe(0);
    expect(retryJitter(-5, () => 0.5)).toBe(0);
  });

  it("is spread with the real dice: never outside the range, and not always the same", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const w = retryJitter(400);
      expect(w).toBeGreaterThanOrEqual(200);
      expect(w).toBeLessThanOrEqual(600);
      seen.add(w);
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});
