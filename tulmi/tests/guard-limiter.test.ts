/**
 * THE CONCURRENCY LIMITER (src/guard/limiter.ts): global and per-person permits, a bounded queue, plan priority, fair interleaving, and
 * the 429 that says where in the queue the request stood and when to come back. A fake clock and fake timers drive it: nothing waits.
 */
import { describe, expect, it } from "vitest";

const { ConcurrencyLimiter, Overloaded, LIMITER_DEFAULTS } = await import("../src/guard/limiter.js");
type Permit = import("../src/guard/limiter.js").Permit;

/** A clock and the timers that go with it, moved by hand. */
function clock() {
  let t = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { id += 1; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h: unknown) => { timers.delete(h as number); },
    advance(ms: number) {
      const to = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = Math.max(t, due[1].at);
        timers.delete(due[0]);
        due[1].fn();
      }
      t = to;
    },
    pending: () => timers.size,
  };
}

const make = (cfg: Partial<import("../src/guard/limiter.js").LimiterConfig> = {}) => {
  const c = clock();
  const limiter = new ConcurrencyLimiter(cfg, { now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  return { limiter, c };
};

/** What a promise has come to by now, without waiting on one that has not settled. */
async function settled<T>(p: Promise<T>): Promise<{ state: "pending" } | { state: "ok"; value: T } | { state: "error"; error: unknown }> {
  let r: { state: "pending" } | { state: "ok"; value: T } | { state: "error"; error: unknown } = { state: "pending" };
  p.then((value) => { r = { state: "ok", value }; }, (error) => { r = { state: "error", error }; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return r;
}

describe("the defaults", () => {
  it("are 64 at once for everyone, 3 for one person and 1 for a free one", () => {
    expect(LIMITER_DEFAULTS).toMatchObject({ global: 64, perUser: 3, perUserFree: 1 });
  });
});

describe("permits", () => {
  it("are given at once while there is room, and given back with release (twice is once)", async () => {
    const { limiter } = make({ global: 2, perUser: 2 });
    const a = await limiter.acquire("u1", "paid");
    const b = await limiter.acquire("u2", "paid");
    expect(limiter.stats()).toMatchObject({ active: 2, queued: 0, people: 2 });
    a.release();
    a.release();
    expect(limiter.stats().active).toBe(1);
    b.release();
    expect(limiter.stats().active).toBe(0);
  });

  it("hold one person to their own limit, and a free person to one", async () => {
    const { limiter } = make({ global: 10, perUser: 3, perUserFree: 1 });
    const held: Permit[] = [];
    for (let i = 0; i < 3; i += 1) held.push(await limiter.acquire("paid", "paid"));
    const fourth = limiter.acquire("paid", "paid");
    expect((await settled(fourth)).state).toBe("pending");
    // another person is not held up by it
    const other = await limiter.acquire("someone", "paid");
    expect(other.waitedMs).toBe(0);

    const free = await limiter.acquire("free", "free");
    const second = limiter.acquire("free", "free");
    expect((await settled(second)).state).toBe("pending");
    free.release();
    expect((await settled(second)).state).toBe("ok");
    held[0]!.release();
    expect((await settled(fourth)).state).toBe("ok");
  });

  it("hold everyone to the global limit, then go on in the order of the queue as permits come back", async () => {
    const { limiter } = make({ global: 2, perUser: 5 });
    const a = await limiter.acquire("a", "paid");
    await limiter.acquire("b", "paid");
    const waiting = limiter.acquire("c", "paid");
    expect((await settled(waiting)).state).toBe("pending");
    expect(limiter.stats()).toMatchObject({ active: 2, queued: 1 });
    a.release();
    const got = await waiting;
    expect(got.waitedMs).toBe(0);
    expect(limiter.stats()).toMatchObject({ active: 2, queued: 0 });
  });

  it("run() gives the permit back however the work ends", async () => {
    const { limiter } = make({ global: 1, perUser: 1 });
    await expect(limiter.run("u", "paid", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(limiter.stats().active).toBe(0);
    expect(await limiter.run("u", "paid", async () => 7)).toBe(7);
    expect(limiter.stats().active).toBe(0);
  });
});

describe("the queue", () => {
  it("is bounded in all: past queueMax the answer is Overloaded, 429, with a place and a Retry-After", async () => {
    const { limiter } = make({ global: 1, perUser: 9, queueMax: 2, queuePerUser: 9 });
    await limiter.acquire("a", "paid");
    const q1 = limiter.acquire("b", "paid");
    const q2 = limiter.acquire("c", "paid");
    void q1; void q2;
    const err = await limiter.acquire("d", "paid").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Overloaded);
    const o = err as InstanceType<typeof Overloaded>;
    expect(o.status).toBe(429);
    expect(o.reason).toBe("queue_full");
    expect(o.position).toBe(3);
    expect(o.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(o.retryAfterSec).toBeLessThanOrEqual(60);
    expect(limiter.stats().rejected).toBe(1);
  });

  it("is bounded for one person: their fifth waiting request is turned away while others still queue", async () => {
    const { limiter } = make({ global: 1, perUser: 1, queueMax: 50, queuePerUser: 2 });
    await limiter.acquire("busy", "paid");
    const w1 = limiter.acquire("busy", "paid");
    const w2 = limiter.acquire("busy", "paid");
    void w1; void w2;
    const err = await limiter.acquire("busy", "paid").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Overloaded);
    expect((err as InstanceType<typeof Overloaded>).reason).toBe("user_queue_full");
    expect((err as InstanceType<typeof Overloaded>).position).toBeGreaterThanOrEqual(1);
    // someone else can still wait
    const other = limiter.acquire("other", "paid");
    expect((await settled(other)).state).toBe("pending");
  });

  it("gives up on a request that waited too long: Overloaded with the place it had", async () => {
    const { limiter, c } = make({ global: 1, perUser: 9, waitMs: 5_000 });
    await limiter.acquire("a", "paid");
    const first = limiter.acquire("b", "paid");
    const second = limiter.acquire("c", "paid");
    first.catch(() => undefined);
    c.advance(4_999);
    expect((await settled(second)).state).toBe("pending");
    c.advance(2);
    const r = await settled(second);
    expect(r.state).toBe("error");
    const o = (r as { error: InstanceType<typeof Overloaded> }).error;
    expect(o).toBeInstanceOf(Overloaded);
    expect(o.reason).toBe("waited_too_long");
    expect(o.position).toBeGreaterThanOrEqual(1);
    expect(limiter.stats().queued).toBe(0);
  });

  it("lets a waiting request go when its caller is stopped, and takes no permit for it", async () => {
    const { limiter, c } = make({ global: 1, perUser: 9 });
    const a = await limiter.acquire("a", "paid");
    const ctl = new AbortController();
    const waiting = limiter.acquire("b", "paid", { signal: ctl.signal });
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(limiter.stats().queued).toBe(0);
    expect(c.pending()).toBe(0);
    a.release();
    expect(limiter.stats().active).toBe(0);
    await expect(limiter.acquire("c", "paid", { signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("suggests a longer wait the further back the place, and learns how long a permit is held", async () => {
    const { limiter, c } = make({ global: 1, perUser: 9, queueMax: 1, holdGuessMs: 4_000 });
    const held = await limiter.acquire("a", "paid");
    limiter.acquire("b", "paid").catch(() => undefined);
    const turned = await limiter.acquire("c", "paid").catch((e: unknown) => e as InstanceType<typeof Overloaded>);
    // position 2 with one permit to give: two rounds and one more, at about 4 s a round
    expect((turned as InstanceType<typeof Overloaded>).position).toBe(2);
    expect((turned as InstanceType<typeof Overloaded>).retryAfterSec).toBe(12);
    c.advance(30_000);
    held.release();
    // a long hold pulls the estimate up for the next to be turned away
    expect(limiter.stats().holdMs).toBe(Math.round(4_000 * 0.8 + 30_000 * 0.2));
  });
});

describe("who is next", () => {
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  /** Takes the one permit, queues the requests in order, then frees it and each one granted after it, and says who was granted when. */
  async function order(requests: Array<[string, "free" | "paid"]>, o: { advanceMs?: number; cfg?: Partial<import("../src/guard/limiter.js").LimiterConfig> } = {}) {
    const { limiter, c } = make({ global: 1, perUser: 9, perUserFree: 9, queueMax: 50, queuePerUser: 20, waitMs: 1_000_000, ...(o.cfg ?? {}) });
    const holder = await limiter.acquire("holder", "paid");
    const got: string[] = [];
    const permits = new Map<string, Permit>();
    const all = requests.map(([user, plan], i) => limiter.acquire(user, plan).then((p) => { got.push(`${user}${i}`); permits.set(`${user}${i}`, p); }));
    if (o.advanceMs) c.advance(o.advanceMs);
    holder.release();
    for (let n = 0; n < requests.length; n += 1) {
      await flush();
      expect(got.length, `after release ${n}`).toBe(n + 1);
      permits.get(got[n]!)!.release();
    }
    await Promise.all(all);
    return got;
  }

  it("serves a paid person before a free one who asked first", async () => {
    const got = await order([["f1", "free"], ["f2", "free"], ["p1", "paid"]]);
    expect(got).toEqual(["p12", "f10", "f21"]);
  });

  it("does not leave a free person behind for ever: after agingMs they go as if paid", async () => {
    // Without ageing the paid ones go first; with the free request old enough it is first, being the earliest.
    const young = await order([["f1", "free"], ["p1", "paid"], ["p2", "paid"]]);
    expect(young).toEqual(["p11", "p22", "f10"]);
    const aged = await order([["f1", "free"], ["p1", "paid"], ["p2", "paid"]], { advanceMs: 10_000, cfg: { agingMs: 10_000 } });
    expect(aged[0]).toBe("f10");
  });

  it("interleaves people: one person with many waiting does not run them all before another's one", async () => {
    const got = await order([["a", "paid"], ["a", "paid"], ["a", "paid"], ["b", "paid"], ["c", "paid"]]);
    // a is first in line, then the people not yet served take their turn before a's second and third
    expect(got).toEqual(["a0", "b3", "c4", "a1", "a2"]);
  });

  it("takes turns among equals in the order they arrived", async () => {
    const got = await order([["x", "paid"], ["y", "paid"], ["z", "paid"]]);
    expect(got).toEqual(["x0", "y1", "z2"]);
  });

  it("skips a person who is at their own limit for one who is not", async () => {
    const { limiter } = make({ global: 3, perUser: 1, perUserFree: 1, queueMax: 10, queuePerUser: 10 });
    const a1 = await limiter.acquire("a", "paid");
    const hold2 = await limiter.acquire("h2", "paid");
    const hold3 = await limiter.acquire("h3", "paid");
    const a2 = limiter.acquire("a", "paid");
    const b1 = limiter.acquire("b", "paid");
    // a freed slot goes to b: a is at their limit (a1 is still out) even though a2 asked first
    hold2.release();
    expect((await settled(b1)).state).toBe("ok");
    expect((await settled(a2)).state).toBe("pending");
    a1.release();
    expect((await settled(a2)).state).toBe("ok");
    hold3.release();
  });
});
