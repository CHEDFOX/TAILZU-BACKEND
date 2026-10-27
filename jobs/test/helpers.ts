/**
 * What the Worker's tests share: signed requests as the VPS would make them, and a scripted world.
 */
import { env } from "cloudflare:workers";
import { signRequest } from "../../tulmi/src/code/jobs/handoff/sign.js";
import type { Advance } from "../../tulmi/src/code/agent/loop.js";
import type { BrainBody } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import { handleRequest } from "../src/http.js";
import type { Env } from "../src/env.js";
import type { AgentPort, BrainPort, TickPort, TickSummary, World } from "../src/world.js";

export const testEnv = env as unknown as Env;
/** The secret in vitest.config.ts. */
export const SECRET = String(testEnv.CODE_JOBS_SECRET);

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SHA = "a".repeat(40);

/** A request signed the way the VPS signs one. */
export function signed(path: string, payload: object | string, o: { secret?: string; now?: number; nonce?: string; method?: string } = {}): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = signRequest({ secret: o.secret ?? SECRET, method: o.method ?? "POST", path, body, ...(o.now !== undefined ? { now: o.now } : {}), ...(o.nonce ? { nonce: o.nonce } : {}) });
  return new Request(`https://jobs.example${path}`, { method: o.method ?? "POST", headers: { "content-type": "application/json", ...headers }, body });
}

export async function call(path: string, payload: object | string, o?: Parameters<typeof signed>[2]): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handleRequest(signed(path, payload, o), testEnv);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A script of advances per job, and a record of what was asked. */
export class ScriptedAgent implements AgentPort {
  readonly calls: Array<{ jobId: string; holder: string; turns?: number }> = [];
  readonly abandoned: Array<{ jobId: string; why: string }> = [];
  private readonly scripts = new Map<string, Array<Advance | Error | Promise<Advance>>>();

  /** What each advance of a job answers, in order. A promise holds that advance until it settles. Past the end: the job is over. */
  script(jobId: string, steps: Array<Advance | Error | Promise<Advance>>): void { this.scripts.set(jobId, [...steps]); }

  async advance(jobId: string, o: { holder: string; turns?: number }): Promise<Advance> {
    this.calls.push({ jobId, holder: o.holder, ...(o.turns !== undefined ? { turns: o.turns } : {}) });
    const next = await this.scripts.get(jobId)?.shift();
    if (next === undefined) return { next: "end", why: "over" };
    if (next instanceof Error) throw next;
    return next;
  }

  async abandon(jobId: string, why: string): Promise<void> { this.abandoned.push({ jobId, why }); }
}

export class ScriptedBrain implements BrainPort {
  readonly checked: BrainBody[] = [];
  readonly built: BrainBody[] = [];
  skip = false;
  failBuild: Error | null = null;
  async check(b: BrainBody) { this.checked.push(b); return this.skip ? { skip: true, reason: "The brain is already built from this commit." } : { skip: false, reason: "" }; }
  async build(b: BrainBody) {
    this.built.push(b);
    if (this.failBuild) throw this.failBuild;
    return { status: "ready", headSha: b.headSha, spentPaise: 12 };
  }
}

export class ScriptedTicker implements TickPort {
  ticks = 0;
  idleAsked: Array<{ idleMs: number; limit: number }> = [];
  idleIds: string[] = [];
  summary: TickSummary = { expired: 1, moved: 0, failed: 0, woken: 2, handedBack: 3 };
  fail = false;
  async tick() { this.ticks += 1; if (this.fail) throw new Error("db away"); return this.summary; }
  async idle(idleMs: number, limit: number) { this.idleAsked.push({ idleMs, limit }); return this.idleIds; }
}

export function scriptedWorld(): { world: World; agent: ScriptedAgent; brain: ScriptedBrain; ticker: ScriptedTicker } {
  const agent = new ScriptedAgent();
  const brain = new ScriptedBrain();
  const ticker = new ScriptedTicker();
  return { world: { agent, brain, ticker }, agent, brain, ticker };
}

/** A promise settled from outside. */
export function gate<T>(): { promise: Promise<T>; open(v: T): void } {
  let open!: (v: T) => void;
  const promise = new Promise<T>((r) => { open = r; });
  return { promise, open };
}

export async function until(what: () => boolean | Promise<boolean>, ms = 4_000): Promise<void> {
  const t0 = Date.now();
  while (!(await what())) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 15));
  }
}
