/**
 * THE VPS'S WAY TO THE JOBS WORKER (CODE_JOBS_MODE=cloudflare).
 *
 * `JobsHandoff` posts the three messages of protocol.ts to the Worker, each signed afresh (sign.ts: a new
 * timestamp and nonce on every attempt, so a retry is not mistaken for a replay), with a time limit on
 * every try. Up to three attempts, with a short wait between; what makes a try worth repeating is a
 * network failure, a timeout or a 408, 425, 429 or 5xx from the Worker. Any other answer (a 400, a 401
 * for a bad signature, a 404) is final: asking again would only be told the same.
 *
 * It is the VPS's `RemoteJobs` (agent/orchestrator.ts) and `BrainRemote` (project/index.ts):
 *
 *   start(jobId)    must succeed: if the Worker cannot be reached in three attempts it throws, and the caller fails the
 *                   job with a reason the person can read. An existing Workflow for that job is fine (the Worker's answer
 *                   says "exists"): the call is idempotent
 *   wake(jobId, k)  never throws: the person's word is already in the database, and the Worker's cron looks again at a job
 *                   that nobody woke
 *   build(...)      throws like start: the caller marks the brain's build failed
 *
 * The fetch, the clock, the sleep and the nonce are injectable; nothing here reads the environment.
 */
import type { RemoteJobs } from "../../agent/orchestrator.js";
import type { BrainRemote } from "../../project/index.js";
import { signRequest } from "./sign.js";
import { BRAIN_PATH, EVENT_PATH, MESSAGE_PATH, START_PATH, type BrainBody, type EventBody, type MessageBody, type StartBody, type WakeKind } from "./protocol.js";

export const HANDOFF_ATTEMPTS = 3;
/** Each attempt gets this long, answer included. */
export const HANDOFF_TIMEOUT_MS = 10_000;
/** Waits before the second and the third attempt. */
export const HANDOFF_BACKOFF_MS = [500, 2_000] as const;

export class HandoffError extends Error {
  constructor(readonly code: "unreachable" | "rejected" | "not_configured", message: string, readonly status?: number) {
    super(message);
    this.name = "HandoffError";
  }
}

export interface HandoffOptions {
  /** CODE_JOBS_URL: where the Worker is. */
  url: string;
  /** CODE_JOBS_SECRET. */
  secret: string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
  log?: { warn(o: object, m: string): void };
}

const RETRYABLE = new Set([408, 425, 429]);

export class JobsHandoff implements RemoteJobs, BrainRemote {
  private readonly base: string;
  private readonly call: (url: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;
  private readonly timeoutMs: number;

  constructor(private readonly o: HandoffOptions) {
    this.base = o.url.trim().replace(/\/+$/, "");
    this.call = o.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.attempts = Math.max(1, o.attempts ?? HANDOFF_ATTEMPTS);
    this.timeoutMs = o.timeoutMs ?? HANDOFF_TIMEOUT_MS;
  }

  /** Whether a Worker is set up to be called at all. */
  get configured(): boolean {
    return /^https:\/\//i.test(this.base) && this.o.secret.length > 0;
  }

  async start(jobId: string): Promise<void> {
    await this.post(START_PATH, { jobId } satisfies StartBody);
  }

  async wake(jobId: string, kind: WakeKind): Promise<void> {
    try {
      await this.post(EVENT_PATH, { jobId, kind } satisfies EventBody);
    } catch (err) {
      this.o.log?.warn({ jobId, kind, error: (err as HandoffError)?.code ?? "error" }, "code jobs: the Worker could not be told");
    }
  }

  /** The person's word to a working job: kept in the job's room, and the job's Workflow woken. Throws when it could not be handed over. */
  async message(jobId: string, text: string): Promise<void> {
    await this.post(MESSAGE_PATH, { jobId, text } satisfies MessageBody);
  }

  async build(b: { userId: string; projectId: string; mode: "full" | "incremental"; headSha: string }): Promise<void> {
    await this.post(BRAIN_PATH, { userId: b.userId, projectId: b.projectId, mode: b.mode, headSha: b.headSha } satisfies BrainBody);
  }

  /** One signed POST, tried up to `attempts` times. Resolves with the Worker's JSON answer. */
  async post(path: string, payload: object): Promise<Record<string, unknown>> {
    if (!this.configured) throw new HandoffError("not_configured", "CODE_JOBS_URL and CODE_JOBS_SECRET are not set.");
    const url = `${this.base}${path}`;
    const signedPath = new URL(url).pathname;
    const body = JSON.stringify(payload);
    let last: HandoffError = new HandoffError("unreachable", "The jobs Worker could not be reached.");
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const res = await this.call(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...signRequest({ secret: this.o.secret, method: "POST", path: signedPath, body, now: this.now() }) },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          return json && typeof json === "object" ? json : {};
        }
        await res.body?.cancel().catch(() => undefined);
        if (res.status < 500 && !RETRYABLE.has(res.status)) throw new HandoffError("rejected", `The jobs Worker answered ${res.status}.`, res.status);
        last = new HandoffError("unreachable", `The jobs Worker answered ${res.status}.`, res.status);
      } catch (err) {
        if (err instanceof HandoffError && err.code === "rejected") throw err;
        last = err instanceof HandoffError ? err : new HandoffError("unreachable", "The jobs Worker could not be reached.");
      }
      if (attempt < this.attempts) await this.sleep(HANDOFF_BACKOFF_MS[Math.min(attempt - 1, HANDOFF_BACKOFF_MS.length - 1)]!);
    }
    throw last;
  }
}
