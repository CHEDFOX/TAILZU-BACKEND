/**
 * THE ARTIFACT CORE'S OWN BRAKES: HOW OFTEN, AND HOW MUCH.
 *
 * Two small things kept in this process's memory, as the other rate limits of the server are (a restart
 * forgets a window at most, and a ceiling against running up a bill needs no more):
 *
 *   Limiter    "at most `max` of these in `windowMs`", per key. The routes use it for saved data, for an
 *              artifact asking the bot, and for edits, on top of the app's own per-route limit, because an
 *              artifact is code a stranger may have written and a share link puts it in front of anyone: what
 *              it may do to our storage and our models is bounded here, per person (or per link when there is
 *              no person), not only per address
 *   SpendMeter paise spent by a person in a day, against a daily cap. `ask` is metered against the person who
 *              asked, never the owner of the artifact: opening a link must not spend someone else's money
 *
 * Nothing here reaches a network or a store.
 */

export interface LimiterOptions {
  now?: () => number;
}

/** A sliding window: the times of the last `max` allowed hits per key. */
export class Limiter {
  private hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly max: number, private readonly windowMs: number, o: LimiterOptions = {}) {
    this.now = o.now ?? Date.now;
  }

  /** Counts one hit for `key` and says whether it is allowed. A refused hit is not counted. */
  allow(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((at) => t - at < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) this.sweep(t);
    return true;
  }

  /** Seconds until `key` may try again (0 when it may now). */
  retryAfterSec(key: string): number {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((at) => t - at < this.windowMs);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[0]! + this.windowMs - t) / 1000));
  }

  private sweep(t: number): void {
    for (const [k, list] of this.hits) if (!list.some((at) => t - at < this.windowMs)) this.hits.delete(k);
  }

  clear(): void { this.hits.clear(); }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Paise spent per person over the last day. */
export class SpendMeter {
  private spent = new Map<string, Array<{ at: number; paise: number }>>();
  private readonly now: () => number;

  constructor(private readonly dailyCapPaise: number, o: LimiterOptions = {}) {
    this.now = o.now ?? Date.now;
  }

  private list(userId: string): Array<{ at: number; paise: number }> {
    const t = this.now();
    const list = (this.spent.get(userId) ?? []).filter((e) => t - e.at < DAY_MS);
    this.spent.set(userId, list);
    return list;
  }

  /** What this person has spent in the last day. */
  usedPaise(userId: string): number { return this.list(userId).reduce((n, e) => n + e.paise, 0); }

  /** What is left of the day's cap. */
  leftPaise(userId: string): number { return Math.max(0, this.dailyCapPaise - this.usedPaise(userId)); }

  add(userId: string, paise: number): void {
    if (!(paise > 0)) return;
    this.list(userId).push({ at: this.now(), paise });
    if (this.spent.size > 20_000) for (const [k, l] of this.spent) if (!l.length) this.spent.delete(k);
  }

  clear(): void { this.spent.clear(); }
}
