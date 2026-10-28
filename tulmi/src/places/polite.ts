/**
 * ONE POLITE LINE TO ONE PROVIDER: requests go out one at a time, at least `minGapMs` apart, with our own User-Agent; a server that says
 * "slow down" (429, 503) or "go away" (403) is left alone for a while; a queue that has grown too long is not added to.
 *
 *   const line = new Polite({ name: "photon", minGapMs: 1100, userAgent })
 *   const res = await line.get(url)              // a Response, or throws PlacesBusy / an Error
 *
 * Why: the public servers these default to ask for at most one request a second and a User-Agent that names the app (Nominatim,
 * FOSSGIS' OSRM, Photon's fair use, MET Norway). A server we run ourselves can have `minGapMs: 0`.
 *
 * Addresses here are the operator's (config), never a person's, so this is a plain fetch: a self-hosted server on the private
 * network must be reachable. What a person typed only ever goes in the query string. Nothing is logged: not the address, not the query.
 */
import { PlacesBusy } from "./types.js";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface PoliteOpts {
  name: string;
  /** Least time between the start of two requests. */
  minGapMs: number;
  userAgent: string;
  /** Per request (default 8 s). */
  timeoutMs?: number;
  /** Requests waiting beyond this are refused at once (default 20). */
  queueMax?: number;
  /** How long to leave the server alone after a 429, 503 or 403 (default 10 min). */
  coolDownMs?: number;
  fetchFn?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Polite {
  private tail: Promise<void> = Promise.resolve();
  private lastAt = 0;
  private waiting = 0;
  private quietUntil = 0;
  readonly name: string;

  constructor(private readonly o: PoliteOpts) {
    this.name = o.name;
  }

  private get now(): number { return (this.o.now ?? Date.now)(); }

  /** Standing aside right now (cooling down). */
  get resting(): boolean { return this.now < this.quietUntil; }

  async get(url: string, init: { headers?: Record<string, string>; method?: "GET" | "POST"; body?: string } = {}): Promise<Response> {
    if (this.resting) throw new PlacesBusy(this.name);
    if (this.waiting >= (this.o.queueMax ?? 20)) throw new PlacesBusy(this.name);
    this.waiting += 1;
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    const before = this.tail;
    this.tail = before.then(() => mine);
    try {
      await before;
      if (this.resting) throw new PlacesBusy(this.name);
      const wait = this.lastAt + this.o.minGapMs - this.now;
      if (wait > 0) await (this.o.sleep ?? pause)(wait);
      this.lastAt = this.now;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 8_000);
      try {
        const res = await (this.o.fetchFn ?? (globalThis.fetch as FetchFn))(url, {
          method: init.method ?? "GET",
          headers: { "user-agent": this.o.userAgent, accept: "application/json", ...(init.headers ?? {}) },
          ...(init.body !== undefined ? { body: init.body } : {}),
          signal: ctl.signal,
        });
        if (res.status === 429 || res.status === 503 || res.status === 403) {
          this.quietUntil = this.now + (this.o.coolDownMs ?? 10 * 60_000);
          throw new PlacesBusy(this.name);
        }
        return res;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      this.waiting -= 1;
      release();
    }
  }
}

/** Our User-Agent: the app and how to reach us, as the providers' terms ask ("Tailzu/1.0 (+https://tailzu.space)"). */
export function userAgentFor(contact: string): string {
  const c = contact.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 120) || "https://tailzu.space";
  return `Tailzu/1.0 (+${c})`;
}
