/**
 * THE OVERLOAD GUARDS: NOTHING IN THE PIPELINE GETS OVERLOADED, AND NOTHING DOES THE WRONG THING SILENTLY. The story is in docs/front-door.md.
 *
 *   limiter.ts      ConcurrencyLimiter: global and per-person permits, a bounded queue, plan priority, fair interleaving; Overloaded (429)
 *   idempotency.ts  Idempotency: a double tap is one request (the header, or a hash of the request); joins what is in flight
 *   coalesce.ts     Coalescer: identical cheap reads in flight at once (search, page read, kit, brain query) share one promise
 *   breaker.ts      Breakers: per model slug and per provider; open at half failing over 8 calls in 60 s, one probe after a cooldown
 *   timing.ts       withTimeout, withFallback, retryJitter: the deadline and the retry wait, said once
 *   index.ts        Guard: the above for the routes, built from the config; and the daily cap a person's front-door spend is held to
 *
 * A guarded route does:   guard.run({ userId, plan, route, body, header, lane }, (emit) => work)   and the guard takes the idempotency key, lets
 * a double tap join the run that is out, takes a permit (waiting in line, or turning the request away with Overloaded), runs the work, and
 * gives the permit back. The routes turn Overloaded into 429 with Retry-After and IdempotencyConflict into 409 (guardFail in routes/guarded.ts).
 *
 * All of it is in memory, per process. Nothing here reads a store; the config is read once, when the default guard is made.
 */
import { SpendMeter } from "../artifacts/limits.js";
import { getConfig } from "../config.js";
import { Breakers, sharedBreakers, type BreakerOptions } from "./breaker.js";
import { Coalescer } from "./coalesce.js";
import { Idempotency, type Replay } from "./idempotency.js";
import { ConcurrencyLimiter, type LimiterConfig, type LimiterOptions, type Plan } from "./limiter.js";

export * from "./breaker.js";
export * from "./coalesce.js";
export * from "./idempotency.js";
export * from "./limiter.js";
export * from "./timing.js";

/** Where a guarded request stands, for the log and the admin's health route. */
export type Lane = "ask" | "artifact" | "research" | "job" | "code";

export interface GuardOptions {
  limiter?: Partial<LimiterConfig>;
  limiterPorts?: LimiterOptions;
  /** Breakers of its own (a test's), or their settings. Left out: the process's shared ones, which the brain's gateway uses. */
  breakers?: Breakers | BreakerOptions;
  /** What the front door itself may spend on one person in a day, in paise. */
  dailyPaise?: number;
  idempotencyTtlMs?: number;
  now?: () => number;
}

export interface GuardRequest {
  userId: string;
  plan: Plan;
  /** The route, for the key: "POST /v1/ask". */
  route: string;
  /** The body, for the key and for telling a retry from a different request. */
  body: unknown;
  /** The Idempotency-Key header, if the client sent one. */
  header?: string | null;
  lane: Lane;
  /** The caller's: when it fires this request stops waiting, and the run is stopped too if nobody else is waiting on it. */
  signal?: AbortSignal;
  /** Called with each event the work emits, in order: a joined request sees the ones it missed first. */
  onEvent?: (ev: unknown) => void;
  /** Results worth replaying to a repeat of the request. All of them when not given. */
  keep?: (result: never) => boolean;
  /**
   * Whether the same request sent again after the first finished is shown the first's answer (default true). False for a request whose meaning
   * depends on what the server holds, which the body does not say (an edit, "build it", the next step of an intake): a double tap while it is
   * running still joins it, but a repeat after it is a new request. A request that came with an Idempotency-Key is always replayed: the
   * client said it is the same one.
   */
  replayUnkeyed?: boolean;
}

export class Guard {
  readonly limiter: ConcurrencyLimiter;
  readonly idempotency: Idempotency;
  readonly coalescer: Coalescer;
  readonly breakers: Breakers;
  /** What the front door has spent on each person in the last day. */
  readonly daily: SpendMeter;

  constructor(o: GuardOptions = {}) {
    const now = o.now ?? Date.now;
    this.limiter = new ConcurrencyLimiter(o.limiter ?? {}, { now, ...(o.limiterPorts ?? {}) });
    this.idempotency = new Idempotency({ now, ...(o.idempotencyTtlMs !== undefined ? { ttlMs: o.idempotencyTtlMs } : {}) });
    this.coalescer = new Coalescer();
    this.breakers = o.breakers instanceof Breakers ? o.breakers : o.breakers ? new Breakers({ now, ...o.breakers }) : sharedBreakers();
    this.daily = new SpendMeter(o.dailyPaise ?? 1500, { now });
  }

  /**
   * The work, once per request, under a permit. Throws Overloaded when there is no room (and no one waiting would get it in time),
   * IdempotencyConflict for a reused key, and whatever the work throws.
   */
  async run<R>(req: GuardRequest, work: (emit: (ev: unknown) => void, signal: AbortSignal) => Promise<R>): Promise<{ result: R; replay: Replay }> {
    const id = Idempotency.keyOf(req.userId, req.route, req.body, req.header);
    return this.idempotency.run<R>(id, async (emit, stop) => {
      // `stop` fires when every request waiting on this run has gone: a queued request leaves the line, a running one is told to stop.
      const permit = await this.limiter.acquire(req.userId, req.plan, { signal: stop });
      try {
        return await work(emit, stop);
      } finally {
        permit.release();
      }
    }, {
      ...(req.onEvent ? { onEvent: req.onEvent } : {}), ...(req.signal ? { signal: req.signal } : {}),
      keep: (r: R) => (!!req.header?.trim() || req.replayUnkeyed !== false) && (req.keep ? (req.keep as (x: R) => boolean)(r) : true),
    });
  }

  /** Everything an admin wants to see at once. */
  health(): GuardHealth {
    return {
      limiter: this.limiter.stats(),
      idempotency: this.idempotency.stats(),
      coalescing: this.coalescer.stats(),
      breakers: this.breakers.snapshot(),
      open: this.breakers.snapshot().filter((b) => b.state !== "closed").length,
    };
  }
}

export interface GuardHealth {
  limiter: ReturnType<ConcurrencyLimiter["stats"]>;
  idempotency: ReturnType<Idempotency["stats"]>;
  coalescing: ReturnType<Coalescer["stats"]>;
  breakers: ReturnType<Breakers["snapshot"]>;
  /** Breakers that are open or half-open. */
  open: number;
}

/** A guard from the config's limits (GUARD_*, FRONT_DAILY_PAISE). */
export function guardFromConfig(): Guard {
  const c = getConfig();
  return new Guard({
    limiter: {
      global: c.GUARD_GLOBAL_CONCURRENCY, perUser: c.GUARD_USER_CONCURRENCY, perUserFree: Math.min(c.GUARD_USER_CONCURRENCY_FREE, c.GUARD_USER_CONCURRENCY),
      queueMax: c.GUARD_QUEUE_MAX, queuePerUser: c.GUARD_QUEUE_PER_USER, waitMs: c.GUARD_QUEUE_WAIT_MS,
    },
    dailyPaise: c.FRONT_DAILY_PAISE,
  });
}

let current: Guard | null = null;

/** The process's guard: what the routes use unless they are given another. Its breakers are the ones the brain's gateway consults. */
export function defaultGuard(): Guard {
  if (!current) current = guardFromConfig();
  return current;
}

export function resetGuardForTests(): void { current = null; }
