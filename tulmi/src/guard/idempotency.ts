/**
 * A DOUBLE TAP IS ONE REQUEST: IDEMPOTENCY, AND JOINING WHAT IS ALREADY RUNNING.
 *
 * A person taps twice, a flaky connection retries, a client sends the same thing again. Without this the second tap makes a second
 * artifact, a second job, a second model call, and pays for it. With it:
 *
 *   THE KEY       the Idempotency-Key header when the client sends one, scoped to the person and the route; otherwise a hash of (person,
 *                 route, body), so a double tap with no header is caught too. The same header with a DIFFERENT body is a mistake, not a
 *                 retry, and is refused (IdempotencyConflict, 409) rather than answered with the wrong thing.
 *   IN FLIGHT     a request whose key is already running JOINS it: it waits for the same answer, and sees the same events if the answer
 *                 streams. It never starts a second run.
 *   FINISHED      for 30 seconds after a run ends in success, the same key gets the same answer without running again. A run that failed
 *                 is forgotten at once, so trying again does try again.
 *   STOPPING      the run is stopped (its AbortSignal fires) only when EVERY request waiting on it has gone away. The first tap's connection
 *                 dropping, because the app sent the second, must not kill the run the second is waiting for. A request that goes away stops
 *                 waiting at once, whatever happens to the run.
 *
 * What `run` keeps is whatever the caller returns (a status and a body, say): decide with `keep` which results are worth replaying.
 * In memory, per process, bounded; a restart forgets, which only costs a repeat. Nothing here reads the environment or a store.
 */
import { createHash } from "node:crypto";

/** The same Idempotency-Key was used for a different request. */
export class IdempotencyConflict extends Error {
  readonly code = "idempotency_key_reuse";
  readonly status = 409;
  constructor() {
    super("That Idempotency-Key was already used for a different request. Use a new key for a new request.");
    this.name = "IdempotencyConflict";
  }
}

export const IDEMPOTENCY_TTL_MS = 30_000;
const MAX_ENTRIES = 2_000;
const MAX_EVENTS = 400;

interface Entry<R> {
  bodyHash: string;
  promise: Promise<R>;
  events: unknown[];
  listeners: Set<(ev: unknown) => void>;
  doneAt: number | null;
  ok: boolean;
  /** Fires when nobody is waiting on the run any more. */
  ctl: AbortController;
  waiting: number;
}

const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

export interface IdempotencyOptions {
  ttlMs?: number;
  max?: number;
  now?: () => number;
}

/** JSON with the keys in order, so the same body is the same text whichever way it was written. */
export function canonical(v: unknown): string {
  const seen = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(seen);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, val]) => [k, seen(val)]));
    return x;
  };
  return JSON.stringify(seen(v)) ?? "null";
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export type Replay = "joined" | "stored" | null;

export class Idempotency {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly ttl: number;
  private readonly max: number;
  private readonly now: () => number;
  private joinedCount = 0;
  private storedCount = 0;

  constructor(o: IdempotencyOptions = {}) {
    this.ttl = o.ttlMs ?? IDEMPOTENCY_TTL_MS;
    this.max = o.max ?? MAX_ENTRIES;
    this.now = o.now ?? Date.now;
  }

  /** The key for a request: the client's header, or a hash of what it is. */
  static keyOf(userId: string, route: string, body: unknown, header?: string | null): { key: string; bodyHash: string } {
    const bodyHash = sha(canonical(body));
    const h = typeof header === "string" ? header.trim().slice(0, 200) : "";
    return { key: h ? `h:${sha(`${userId}\0${route}\0${h}`)}` : `b:${sha(`${userId}\0${route}\0${bodyHash}`)}`, bodyHash };
  }

  private sweep(t: number): void {
    for (const [k, e] of this.entries) if (e.doneAt !== null && t - e.doneAt >= this.ttl) this.entries.delete(k);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
    }
  }

  /** Waits for a run as one of its callers; stops waiting, and lets the run know, when this caller's signal fires. */
  private async wait<R>(entry: Entry<R>, signal?: AbortSignal): Promise<R> {
    entry.waiting += 1;
    let left = false;
    const leave = (): void => {
      if (left) return;
      left = true;
      entry.waiting -= 1;
      if (entry.waiting <= 0 && entry.doneAt === null) entry.ctl.abort();
    };
    let off: (() => void) | undefined;
    try {
      if (!signal) return await entry.promise;
      if (signal.aborted) { leave(); throw abortError(); }
      const gone = new Promise<never>((_, reject) => {
        const f = (): void => { leave(); reject(abortError()); };
        signal.addEventListener("abort", f, { once: true });
        off = () => signal.removeEventListener("abort", f);
      });
      gone.catch(() => undefined);
      return await Promise.race([entry.promise, gone]);
    } finally {
      off?.();
      if (!left) { left = true; entry.waiting -= 1; }
    }
  }

  /**
   * Runs `fn` once for this key. A second caller while it runs, or within the ttl after it succeeded, gets the same result (and, through
   * `onEvent`, the same events in the same order). `fn` is given `emit` for the events a stream sends, and an AbortSignal that fires when
   * every caller waiting on the run has gone away. A caller's own `signal` ends its wait.
   */
  async run<R>(
    id: { key: string; bodyHash: string },
    fn: (emit: (ev: unknown) => void, signal: AbortSignal) => Promise<R>,
    o: { onEvent?: (ev: unknown) => void; keep?: (r: R) => boolean; signal?: AbortSignal } = {},
  ): Promise<{ result: R; replay: Replay }> {
    const t = this.now();
    this.sweep(t);
    const have = this.entries.get(id.key) as Entry<R> | undefined;
    if (have) {
      if (have.bodyHash !== id.bodyHash) throw new IdempotencyConflict();
      const finished = have.doneAt !== null;
      if (finished) this.storedCount += 1; else this.joinedCount += 1;
      if (o.onEvent) {
        for (const ev of have.events) o.onEvent(ev);
        if (!finished) have.listeners.add(o.onEvent);
      }
      try {
        return { result: finished ? await have.promise : await this.wait(have, o.signal), replay: finished ? "stored" : "joined" };
      } finally {
        if (o.onEvent) have.listeners.delete(o.onEvent);
      }
    }
    const entry: Entry<R> = { bodyHash: id.bodyHash, promise: undefined as unknown as Promise<R>, events: [], listeners: new Set(), doneAt: null, ok: false, ctl: new AbortController(), waiting: 0 };
    if (o.onEvent) entry.listeners.add(o.onEvent);
    const emit = (ev: unknown): void => {
      if (entry.events.length < MAX_EVENTS) entry.events.push(ev);
      for (const l of entry.listeners) { try { l(ev); } catch { /* a listener that has gone away must not stop the run */ } }
    };
    entry.promise = (async () => {
      try {
        const r = await fn(emit, entry.ctl.signal);
        entry.ok = true;
        entry.doneAt = this.now();
        // A result that is not worth replaying (an error answer) is forgotten now; the callers waiting on it still get it.
        if (o.keep && !o.keep(r)) this.entries.delete(id.key);
        return r;
      } catch (err) {
        entry.doneAt = this.now();
        this.entries.delete(id.key);
        throw err;
      } finally {
        entry.listeners.clear();
      }
    })();
    // Whoever started it awaits it below; a failure nobody else joined is not "unhandled".
    entry.promise.catch(() => undefined);
    this.entries.set(id.key, entry as Entry<unknown>);
    return { result: await this.wait(entry, o.signal), replay: null };
  }

  stats(): { entries: number; joined: number; replayed: number } {
    return { entries: this.entries.size, joined: this.joinedCount, replayed: this.storedCount };
  }

  clear(): void { this.entries.clear(); }
}
