/**
 * HOW MANY AT ONCE: A CONCURRENCY LIMIT WITH A FAIR, PRIORITISED, BOUNDED QUEUE.
 *
 * A request that costs a model call (or several) must not be able to starve the rest of the server, or the rest of the people on it. So the
 * guarded routes take a permit before they start and give it back when they end:
 *
 *   GLOBAL     at most `global` permits out at once, all people together (64)
 *   PER PERSON at most `perUser` out at once for one person (3), `perUserFree` on the free plan (1)
 *
 * A request that finds no permit WAITS, in a queue that is bounded three ways: `queueMax` waiting in all, `queuePerUser` waiting for one
 * person, and `waitMs` for how long any one waits. Past any of those the answer is Overloaded: 429, with the place the request would have had in the
 * queue and a Retry-After worked out from how long permits have been held lately. A bounded wait is the point: a server that queues
 * without limit answers every request eventually and none of them in time.
 *
 * WHO IS NEXT when a permit comes free, among the people who are under their own limit:
 *   1. PRIORITY BY PLAN. A paid person's waiting request goes before a free person's. Not for ever: a free request that has waited
 *      `agingMs` counts as paid, so a busy hour of paid people cannot keep a free person out indefinitely.
 *   2. FAIR INTERLEAVING. Within a priority, the person served LEAST RECENTLY goes first, then the one who has waited longest. A person
 *      with four requests waiting does not run all four before another person's one: they take turns.
 *
 * It is IN MEMORY, per process. With several workers or servers each has its own count, so the real ceiling is their number times the
 * limits here; docs/front-door.md says how to size and route for that. Nothing here reads the environment or a store; the clock and the
 * timers are passed in, so every rule above is a test.
 */

export type Plan = "free" | "paid";

export interface LimiterConfig {
  /** Permits out at once, all people. */
  global: number;
  /** Permits out at once for one person; the free plan's is `perUserFree`. */
  perUser: number;
  perUserFree: number;
  /** Requests waiting in all, and for one person. */
  queueMax: number;
  queuePerUser: number;
  /** The longest one request waits for a permit. */
  waitMs: number;
  /** A free request that has waited this long goes as if it were paid. */
  agingMs: number;
  /** How long a permit is held, before there is any history to learn it from. */
  holdGuessMs: number;
}

export const LIMITER_DEFAULTS: Readonly<LimiterConfig> = {
  global: 64, perUser: 3, perUserFree: 1, queueMax: 256, queuePerUser: 4, waitMs: 8_000, agingMs: 10_000, holdGuessMs: 6_000,
};

/** The most people whose last turn is remembered for the interleaving. */
const SERVED_MAX = 20_000;

export type OverloadReason ="queue_full" | "user_queue_full" | "waited_too_long";

/** Turned away: 429. `position` is the place the request had, or would have had, in the queue; `retryAfterSec` when to try again. */
export class Overloaded extends Error {
  readonly code = "overloaded";
  readonly status = 429;
  constructor(readonly reason: OverloadReason, readonly position: number, readonly retryAfterSec: number) {
    super(reason === "user_queue_full"
      ? "You have several of these running already. Wait for one to finish, then try again."
      : "X0 Bot is busy right now. Try again in a moment.");
    this.name = "Overloaded";
  }
}

/** A permit: give it back with release() (more than once is the same as once). */
export interface Permit {
  release(): void;
  /** How long the request waited for it, in milliseconds. */
  waitedMs: number;
}

export interface LimiterStats {
  active: number;
  queued: number;
  /** People with a permit out or a request waiting. */
  people: number;
  /** About how long a permit is held, in milliseconds. */
  holdMs: number;
  rejected: number;
  config: LimiterConfig;
}

interface Waiter {
  seq: number;
  userId: string;
  plan: Plan;
  at: number;
  grant: (p: Permit) => void;
  fail: (e: Error) => void;
  timer: unknown;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface LimiterOptions {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class ConcurrencyLimiter {
  readonly config: LimiterConfig;
  private active = 0;
  private readonly byUser = new Map<string, number>();
  private queue: Waiter[] = [];
  private readonly served = new Map<string, number>();
  private tick = 0;
  private seq = 0;
  private holdMs: number;
  private rejected = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(config: Partial<LimiterConfig> = {}, o: LimiterOptions = {}) {
    this.config = { ...LIMITER_DEFAULTS, ...config };
    this.holdMs = this.config.holdGuessMs;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h; });
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  private capFor(plan: Plan): number { return plan === "paid" ? this.config.perUser : this.config.perUserFree; }

  private canRun(userId: string, plan: Plan): boolean {
    return this.active < this.config.global && (this.byUser.get(userId) ?? 0) < this.capFor(plan);
  }

  /** Waits for a permit; Overloaded when the queue cannot take the request or it waited too long. */
  acquire(userId: string, plan: Plan, o: { signal?: AbortSignal } = {}): Promise<Permit> {
    if (o.signal?.aborted) return Promise.reject(abortError());
    if (this.canRun(userId, plan)) return Promise.resolve(this.take(userId, 0));
    const mine = this.queue.filter((w) => w.userId === userId).length;
    if (this.queue.length >= this.config.queueMax || mine >= this.config.queuePerUser) {
      this.rejected += 1;
      const user = mine >= this.config.queuePerUser;
      const position = user ? this.positionOfUser(userId) : this.queue.length + 1;
      return Promise.reject(new Overloaded(user ? "user_queue_full" : "queue_full", position, this.retryAfter(position, user)));
    }
    return new Promise<Permit>((resolve, reject) => {
      const w: Waiter = {
        seq: (this.seq += 1), userId, plan, at: this.now(), grant: resolve, fail: reject, timer: undefined,
        ...(o.signal ? { signal: o.signal } : {}),
      };
      w.timer = this.setTimer(() => {
        if (!this.remove(w)) return;
        this.rejected += 1;
        const position = this.positionOf(w);
        w.fail(new Overloaded("waited_too_long", position, this.retryAfter(position, false)));
      }, this.config.waitMs);
      if (o.signal) {
        w.onAbort = () => { if (this.remove(w)) { this.clearTimer(w.timer); w.fail(abortError()); } };
        o.signal.addEventListener("abort", w.onAbort, { once: true });
      }
      this.queue.push(w);
    });
  }

  /** Runs `fn` under a permit, and gives the permit back however it ends. */
  async run<T>(userId: string, plan: Plan, fn: () => Promise<T>, o: { signal?: AbortSignal } = {}): Promise<T> {
    const permit = await this.acquire(userId, plan, o);
    try { return await fn(); } finally { permit.release(); }
  }

  private take(userId: string, waitedMs: number): Permit {
    this.active += 1;
    this.byUser.set(userId, (this.byUser.get(userId) ?? 0) + 1);
    // Most recently served last, so the oldest can be forgotten when there are very many people.
    this.served.delete(userId);
    this.served.set(userId, (this.tick += 1));
    if (this.served.size > SERVED_MAX) this.served.delete(this.served.keys().next().value!);
    const started = this.now();
    let released = false;
    return {
      waitedMs,
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        const n = (this.byUser.get(userId) ?? 1) - 1;
        if (n <= 0) this.byUser.delete(userId); else this.byUser.set(userId, n);
        // What a permit is held for, learned slowly, for the Retry-After of the ones turned away.
        this.holdMs = Math.round(this.holdMs * 0.8 + Math.max(1, this.now() - started) * 0.2);
        this.pump();
      },
    };
  }

  /** Gives the free permits to the people waiting, in order. */
  private pump(): void {
    while (this.active < this.config.global) {
      const next = this.best();
      if (!next) return;
      this.remove(next);
      this.clearTimer(next.timer);
      if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
      next.grant(this.take(next.userId, this.now() - next.at));
    }
  }

  /** The waiter to serve next: of those whose person is under their own limit, by priority, then least recently served, then longest waiting. */
  private best(): Waiter | null {
    const now = this.now();
    let best: Waiter | null = null;
    for (const w of this.queue) {
      if ((this.byUser.get(w.userId) ?? 0) >= this.capFor(w.plan)) continue;
      if (!best || this.before(w, best, now)) best = w;
    }
    return best;
  }

  private rank(w: Waiter, now: number): number { return w.plan === "paid" || now - w.at >= this.config.agingMs ? 0 : 1; }

  private before(a: Waiter, b: Waiter, now: number): boolean {
    const ra = this.rank(a, now);
    const rb = this.rank(b, now);
    if (ra !== rb) return ra < rb;
    const sa = this.served.get(a.userId) ?? 0;
    const sb = this.served.get(b.userId) ?? 0;
    if (sa !== sb) return sa < sb;
    return a.seq < b.seq;
  }

  private remove(w: Waiter): boolean {
    const i = this.queue.indexOf(w);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  /** Where a waiting request stands: 1 is next. */
  private positionOf(w: Waiter): number {
    const now = this.now();
    return 1 + this.queue.filter((o) => o !== w && this.before(o, w, now)).length;
  }

  private positionOfUser(userId: string): number {
    const mine = this.queue.filter((w) => w.userId === userId);
    return mine.length ? Math.min(...mine.map((w) => this.positionOf(w))) : this.queue.length + 1;
  }

  /** Seconds to wait before trying again: the places ahead, over the permits that can be given, at about how long a permit is held. */
  private retryAfter(position: number, userLimited: boolean): number {
    const rounds = userLimited ? 1 : Math.ceil(position / Math.max(1, this.config.global)) + 1;
    return Math.min(60, Math.max(1, Math.ceil((rounds * this.holdMs) / 1000)));
  }

  stats(): LimiterStats {
    const people = new Set<string>([...this.byUser.keys(), ...this.queue.map((w) => w.userId)]);
    return { active: this.active, queued: this.queue.length, people: people.size, holdMs: this.holdMs, rejected: this.rejected, config: this.config };
  }
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}
