/**
 * CIRCUIT BREAKERS: STOP ASKING A MODEL THAT IS FAILING, AND LET IT BACK WITH ONE TRIAL.
 *
 * A model or a provider that is down costs every call that tries it a timeout or an error before the ladder moves on. A breaker
 * remembers, per key, how the last calls went, and when a key is clearly failing it says "skip me" so the next call goes straight to
 * the next rung.
 *
 *   CLOSED     calls go through. Every call's outcome is written down; calls older than the window (60 s) are forgotten.
 *   OPEN       at least 8 calls in the window and at least half of them failed: the key is skipped for the cooldown (30 s).
 *   HALF-OPEN  the cooldown is over: exactly ONE call, the probe, may go. If it works, the breaker closes with a clean slate; if it
 *              fails, the breaker opens again for another cooldown. While the probe is out, every other call is still skipped.
 *
 * A probe that never reports (the caller was stopped, the process was busy) would hold the breaker shut for good, so a probe older
 * than `probeTimeoutMs` is given up and the next caller becomes the probe.
 *
 * The gateway (code/brain/gateway.ts) keeps one breaker per MODEL SLUG and one per PROVIDER (the slug's vendor prefix), asks both before
 * a model is tried and tells both how the call went; a model whose slug OR whose provider is open is skipped and the ladder climbs.
 *
 * Keys are strings the caller chooses ("model:openai/gpt-6-luna", "provider:openai"). The state is in this process only. Nothing here
 * reads the environment, a store or a clock but the one it is given.
 */

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  /** Calls in the window before the failure rate counts. */
  minCalls?: number;
  /** The share of those calls that failed at which the breaker opens (0 to 1). */
  failureRate?: number;
  windowMs?: number;
  /** How long an open breaker skips its key before it lets one probe through. */
  cooldownMs?: number;
  /** A probe that has not reported in this long is given up. */
  probeTimeoutMs?: number;
  now?: () => number;
}

export const BREAKER_DEFAULTS = { minCalls: 8, failureRate: 0.5, windowMs: 60_000, cooldownMs: 30_000, probeTimeoutMs: 60_000 } as const;

export interface BreakerStat {
  key: string;
  state: BreakerState;
  /** Calls in the window, and how many of them failed. */
  calls: number;
  failures: number;
  /** When it last opened (epoch ms), if it is not closed. */
  openedAt?: number;
  /** Milliseconds until a probe is allowed, while it is open. */
  retryInMs?: number;
  /** Times it has opened since the process started. */
  opens: number;
}

/** What a call was told when it asked: go, go as the one probe, or stay away. */
export type Gate = "go" | "probe" | "blocked";

type Settings = Required<Omit<BreakerOptions, "now">>;

export class CircuitBreaker {
  private events: Array<{ at: number; ok: boolean }> = [];
  private openedAt: number | null = null;
  private probeSince: number | null = null;
  private opened = 0;

  constructor(readonly key: string, private readonly s: Settings) {}

  private prune(now: number): void {
    const from = now - this.s.windowMs;
    if (this.events.length && this.events[0]!.at < from) this.events = this.events.filter((e) => e.at >= from);
  }

  state(now: number): BreakerState {
    if (this.openedAt === null) return "closed";
    return now - this.openedAt >= this.s.cooldownMs ? "half_open" : "open";
  }

  /** Whether a call may go now. "probe" claims the half-open breaker's one trial. */
  gate(now: number, claim: boolean): Gate {
    const st = this.state(now);
    if (st === "closed") return "go";
    if (st === "open") return "blocked";
    // Half-open: one probe at a time.
    if (this.probeSince !== null && now - this.probeSince < this.s.probeTimeoutMs) return "blocked";
    if (claim) this.probeSince = now;
    return "probe";
  }

  success(now: number, probe: boolean): void {
    if (probe) {
      // The trial worked: closed, with a clean slate.
      this.openedAt = null;
      this.probeSince = null;
      this.events = [];
      return;
    }
    if (this.openedAt !== null) return; // a late success from before it opened says nothing now
    this.events.push({ at: now, ok: true });
    this.prune(now);
  }

  failure(now: number, probe: boolean): void {
    if (probe) {
      this.probeSince = null;
      this.open(now);
      return;
    }
    if (this.openedAt !== null) return;
    this.events.push({ at: now, ok: false });
    this.prune(now);
    const failures = this.events.filter((e) => !e.ok).length;
    if (this.events.length >= this.s.minCalls && failures / this.events.length >= this.s.failureRate) this.open(now);
  }

  /** A probe that came to nothing (the caller was stopped): the next caller may try. */
  releaseProbe(): void { this.probeSince = null; }

  private open(now: number): void {
    this.openedAt = now;
    this.opened += 1;
    this.events = [];
  }

  stat(now: number): BreakerStat {
    this.prune(now);
    const state = this.state(now);
    return {
      key: this.key, state, calls: this.events.length, failures: this.events.filter((e) => !e.ok).length, opens: this.opened,
      ...(this.openedAt !== null ? { openedAt: this.openedAt, retryInMs: Math.max(0, this.s.cooldownMs - (now - this.openedAt)) } : {}),
    };
  }
}

/** The pass a call carries from "may I?" to "how did it go?": which of its keys it is the probe for. */
export interface Ticket {
  keys: string[];
  /** The keys this call is the half-open probe for. Cleared once the call has said how it went: a second report is an ordinary call. */
  probes: Set<string>;
}

export type Admission = { ok: true; ticket: Ticket } | { ok: false; by: string; retryInMs: number };

/** A set of breakers by key, asked about several keys at once (a model and its provider). */
export class Breakers {
  private readonly all = new Map<string, CircuitBreaker>();
  private readonly s: Settings;
  private readonly now: () => number;

  constructor(o: BreakerOptions = {}) {
    this.s = {
      minCalls: o.minCalls ?? BREAKER_DEFAULTS.minCalls, failureRate: o.failureRate ?? BREAKER_DEFAULTS.failureRate, windowMs: o.windowMs ?? BREAKER_DEFAULTS.windowMs,
      cooldownMs: o.cooldownMs ?? BREAKER_DEFAULTS.cooldownMs, probeTimeoutMs: o.probeTimeoutMs ?? BREAKER_DEFAULTS.probeTimeoutMs,
    };
    this.now = o.now ?? Date.now;
  }

  private of(key: string): CircuitBreaker {
    let b = this.all.get(key);
    if (!b) { b = new CircuitBreaker(key, this.s); this.all.set(key, b); }
    return b;
  }

  /**
   * May a call to a thing with these keys go? Every key must say yes; the first that says no is named. A half-open key lets the call
   * through as its probe only if every other key lets it through too, so a refusal never leaves a probe claimed.
   */
  admit(keys: readonly string[]): Admission {
    const now = this.now();
    const gates = keys.map((k) => [k, this.of(k).gate(now, false)] as const);
    const no = gates.find(([, g]) => g === "blocked");
    if (no) {
      const stat = this.of(no[0]).stat(now);
      return { ok: false, by: no[0], retryInMs: stat.retryInMs ?? 0 };
    }
    const probes = new Set<string>();
    for (const [k, g] of gates) if (g === "probe") { this.of(k).gate(now, true); probes.add(k); }
    return { ok: true, ticket: { keys: [...keys], probes } };
  }

  success(t: Ticket): void {
    const now = this.now();
    for (const k of t.keys) this.of(k).success(now, t.probes.has(k));
    t.probes.clear();
  }

  failure(t: Ticket): void {
    const now = this.now();
    for (const k of t.keys) this.of(k).failure(now, t.probes.has(k));
    t.probes.clear();
  }

  /** The call did not happen or was stopped: it says nothing about the keys, and a probe it held is free again. */
  release(t: Ticket): void {
    for (const k of t.probes) this.of(k).releaseProbe();
  }

  state(key: string): BreakerState { return this.of(key).state(this.now()); }

  /** Every breaker that has been asked about, open ones first. */
  snapshot(): BreakerStat[] {
    const now = this.now();
    const rank: Record<BreakerState, number> = { open: 0, half_open: 1, closed: 2 };
    return [...this.all.values()].map((b) => b.stat(now)).sort((a, b) => rank[a.state] - rank[b.state] || (a.key < b.key ? -1 : 1));
  }

  reset(): void { this.all.clear(); }
}

/** The process's breakers: the ones the brain's gateway consults and the admin's health route reports. */
const shared = new Breakers();
export const sharedBreakers = (): Breakers => shared;
export function resetBreakersForTests(): void { shared.reset(); }
