/**
 * THE MODEL DOOR OF A RUN: THE REAL ONE (OpenRouter, through the product's own callModel), A SCRIPTED ONE THAT FAILS ON PURPOSE, OR THE ORACLE.
 *
 *   real     callModel() exactly as the server calls it: tiers, ladder, retries, circuit breakers, JSON repair, the job's budget, the run ledger. Needs
 *            OPENROUTER_API_KEY. The tier table is the product's (CODE_MODEL_TIERS) unless the bake-off hands one in.
 *   fake     a persona (adapters/personas.ts) that gets the task wrong in a known way, so scoring and failure attribution can be checked
 *   oracle   the persona that knows the answer: it applies the known-correct patch through the same agent loop, so the pipeline is proven
 *
 * All three are a `CallFn` the agent loop is given (`AgentDeps.call`), wrapped to write down every call: purpose, tier, model, time, tokens, paise,
 * what the ladder did, how many JSON answers had to be repaired. The scripted ones charge the job the way the gateway does: a call whose worst case
 * would pass the budget throws BudgetExceeded before it is made.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ZodTypeAny } from "zod";
import { callModel, BudgetExceeded, type CallInput, type CallResult, type ChatClient, type GatewayDeps, type TrailEntry } from "../../src/code/brain/gateway.js";
import { addJobSpend } from "../../src/code/brain/spend.js";
import type { ModelTier, TierSettings } from "../../src/code/brain/tiers.js";
import type { JobStore } from "../../src/code/jobs/store.js";
import type { CallFn } from "../../src/code/work/model.js";
import { MemoryRunStore } from "../../src/runs/index.js";
import type { Task } from "../tasks/schema.js";
import { NO_TASK, bindBase, oracle, truthJson, type Persona, type Turn } from "./personas.js";

export type ModelMode = "real" | "fake" | "oracle";

export interface CallLog {
  at: number;
  purpose: string;
  tier: string | undefined;
  model: string;
  ms: number;
  paise: number;
  promptTokens: number;
  completionTokens: number;
  ok: boolean;
  error?: string;
  /** JSON answers that had to be repaired, or could not be. */
  repaired: number;
  invalidJson: number;
  /** Models the ladder skipped or failed over before this one answered. */
  fallbacks: number;
  toolCalls: number;
  /** Calls of this answer whose tool name is not one the loop has, or whose arguments are not JSON. */
  badToolCalls: number;
}

export interface ModelKit {
  mode: ModelMode;
  /** The CallFn the agent loop, the classifier and the work core use. */
  call: CallFn;
  gateway: GatewayDeps | undefined;
  logs: CallLog[];
  ledger: MemoryRunStore;
  persona: Persona | null;
  /** Work turns taken so far, and hooks around each (a person's message, a crash). */
  turns: number;
  beforeTurn?: (turn: number) => void | Promise<void>;
  afterTurn?: (turn: number) => void | Promise<void>;
  /** The scripted model is told about the task it is working on. */
  bind(task: Task, base: Record<string, string>): void;
  /** Paise a scripted call costs (work turn, small JSON question). */
  prices: { work: number; json: number };
}

/** What the model door knows about the call in flight (the wire has no purpose): a scripted model behind a client reads it, and so do the cassettes. */
export const callContext = new AsyncLocalStorage<{ purpose: string; jobId?: string; tier?: string }>();

const TOOL_NAMES = new Set(["read_file", "list_dir", "grep", "glob", "search_code", "edit_file", "write_file", "delete_file", "run", "web_search", "read_page", "research", "find_resources", "flag_finding", "note", "ask_user", "done"]);

function logOf(input: CallInput<unknown>, r: CallResult<unknown> | null, err: unknown, t0: number): CallLog {
  const trail: TrailEntry[] = r?.trail ?? (err as { trail?: TrailEntry[] } | null)?.trail ?? [];
  const calls = r?.toolCalls ?? [];
  let bad = 0;
  for (const c of calls) {
    let ok = TOOL_NAMES.has(c.name);
    if (ok) { try { JSON.parse(c.arguments || "{}"); } catch { ok = false; } }
    if (!ok) bad += 1;
  }
  return {
    at: t0, purpose: input.purpose, tier: input.tier, model: r?.model ?? input.model ?? trail.find((x) => x.outcome === "ok")?.model ?? trail[0]?.model ?? "?",
    ms: Date.now() - t0, paise: r?.paise ?? 0, promptTokens: r?.promptTokens ?? 0, completionTokens: r?.completionTokens ?? 0,
    ok: !!r, ...(err ? { error: (err as { name?: string }).name ?? "Error" } : {}),
    repaired: trail.filter((x) => x.repaired).length, invalidJson: trail.filter((x) => x.outcome === "invalid_json").length,
    fallbacks: trail.filter((x) => x.outcome !== "ok" || x.retried).length, toolCalls: calls.length, badToolCalls: bad,
  };
}

// ------------------------------------------------------------------ real

export interface RealKitOptions {
  jobs: Pick<JobStore, "getJobById" | "casJob">;
  tiers?: Record<ModelTier, TierSettings>;
  /** An OpenAI-shaped client instead of OpenRouter's (the load test's fake, with latency and faults). */
  client?: ChatClient;
  breakers?: GatewayDeps["breakers"];
  fx?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** The most any call may write, whatever the caller asks for (the smoke suite: 800). */
  maxTokensCap?: number;
}

export function realKit(o: RealKitOptions): ModelKit {
  const ledger = new MemoryRunStore();
  const logs: CallLog[] = [];
  const gateway: GatewayDeps = {
    jobs: o.jobs, ledger, log: { info: () => undefined, warn: () => undefined },
    ...(o.tiers ? { tiers: o.tiers } : {}), ...(o.client ? { client: o.client } : {}), ...(o.breakers !== undefined ? { breakers: o.breakers } : {}),
    ...(o.fx ? { fx: o.fx } : {}), ...(o.random ? { random: o.random } : {}), ...(o.sleep ? { sleep: o.sleep } : {}),
  };
  const kit: ModelKit = {
    mode: "real", logs, ledger, gateway, persona: null, turns: 0, prices: { work: 0, json: 0 },
    bind: () => undefined,
    call: (async <T>(given: CallInput<T>, gw?: GatewayDeps): Promise<CallResult<T>> => {
      const t0 = Date.now();
      const input: CallInput<T> = o.maxTokensCap ? { ...given, maxTokens: Math.min(given.maxTokens ?? o.maxTokensCap, o.maxTokensCap) } : given;
      if (input.purpose === "agent.work") {
        kit.turns += 1;
        await kit.beforeTurn?.(kit.turns);
      }
      try {
        const r = await callContext.run({ purpose: input.purpose, ...(input.jobId ? { jobId: input.jobId } : {}), ...(input.tier ? { tier: input.tier } : {}) }, () => callModel(input, { ...gateway, ...(gw ?? {}) }));
        logs.push(logOf(input as CallInput<unknown>, r as CallResult<unknown>, null, t0));
        if (input.purpose === "agent.work") await kit.afterTurn?.(kit.turns);
        return r;
      } catch (err) {
        if (process.env.E2E_DEBUG) console.error("MODEL CALL FAILED", input.purpose, (err as Error).name, JSON.stringify(err).slice(0, 400));
        logs.push(logOf(input as CallInput<unknown>, null, err, t0));
        throw err;
      }
    }) as CallFn,
  };
  return kit;
}

// ---------------------------------------------------------- scripted modes

export interface ScriptedKitOptions {
  mode: "fake" | "oracle";
  jobs: Pick<JobStore, "getJobById" | "casJob">;
  persona?: Persona;
  /** Paise a work turn and a JSON question cost. */
  prices?: { work?: number; json?: number };
  /** The worst case the budget check assumes for a call. */
  need?: number;
  /** A pause per call, in ms, to look like a model (the load test). */
  latencyMs?: number | ((purpose: string) => number);
}

export interface BrainAnswer {
  text: string;
  json?: unknown;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  paise: number;
  promptTokens: number;
  completionTokens: number;
}

/** What a persona says to a call, without any of the plumbing: shared by the CallFn-level kit and the scripted wire client. */
export class ScriptedBrain {
  task: Task | null = null;
  base: Record<string, string> = {};
  readonly persona: Persona;
  readonly prices: { work: number; json: number };
  private readonly perJob = new Map<string, { turn: number; scratch: Record<string, unknown> }>();
  private nCall = 0;
  private readonly ordinals = new Map<string, number>();

  constructor(o: { persona?: Persona; prices?: { work?: number; json?: number } }) {
    this.persona = o.persona ?? oracle;
    this.prices = { work: o.prices?.work ?? 4, json: o.prices?.json ?? 2 };
  }

  bind(t: Task, b: Record<string, string>): void { this.task = t; this.base = b; bindBase(t, b); this.perJob.clear(); this.ordinals.clear(); }

  /** Which job of the task this is (0 for the first one it hears from, 1 for the next...): a long-horizon task has one job per milestone. */
  ordinalOf(jobId: string): number {
    let n = this.ordinals.get(jobId);
    if (n === undefined) { n = this.ordinals.size; this.ordinals.set(jobId, n); }
    return n;
  }

  /** One turn of the agent: the persona's tool calls. */
  work(jobId: string, messages: ReadonlyArray<{ role: string; content: unknown }>): BrainAnswer {
    const st = this.perJob.get(jobId) ?? { turn: 0, scratch: {} };
    this.perJob.set(jobId, st);
    st.turn += 1;
    const users = messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const turn: Turn = this.task
      ? this.persona.work({ task: this.task, turn: st.turn, scratch: st.scratch, base: this.base, prompt: users[users.length - 1] ?? "", job: this.ordinalOf(jobId) })
      : { calls: [{ name: "done", args: { summary: "No task." } }] };
    const toolCalls = turn.calls.map((c, i) => ({ id: `call_${(this.nCall += 1)}_${i}`, name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) }));
    return { text: turn.text ?? "", toolCalls, paise: this.prices.work, promptTokens: 1500, completionTokens: 200 };
  }

  /** One small JSON question (or a line of prose, for the picture reader). Throws as a model that has no answer would. */
  json(purpose: string, input: unknown, schema?: ZodTypeAny, jobId?: string): BrainAnswer {
    const task = this.task ?? NO_TASK;
    const ordinal = jobId ? this.ordinalOf(jobId) : 0;
    const given = { ...(input as object), ordinal } as unknown as CallInput<unknown>;
    const answer = this.persona.json(purpose, given, task) ?? (this.task ? truthJson(purpose, task, ordinal) : undefined);
    if (answer === undefined) throw Object.assign(new Error(`the scripted model has no answer for ${purpose}`), { name: "ModelUnavailable", trail: [] });
    if (schema) {
      const parsed = schema.safeParse(answer);
      if (!parsed.success) throw Object.assign(new Error(`the scripted answer for ${purpose} does not fit its schema: ${parsed.error.issues[0]?.message}`), { name: "ModelUnavailable", trail: [] });
    }
    return { text: typeof answer === "string" ? answer : JSON.stringify(answer), json: answer, toolCalls: [], paise: this.prices.json, promptTokens: 400, completionTokens: 60 };
  }
}

export function scriptedKit(o: ScriptedKitOptions): ModelKit {
  const ledger = new MemoryRunStore();
  const logs: CallLog[] = [];
  const brain = new ScriptedBrain({ ...(o.persona ? { persona: o.persona } : {}), ...(o.prices ? { prices: o.prices } : {}) });
  const need = o.need ?? 10;

  const kit: ModelKit = {
    mode: o.mode, logs, ledger, gateway: undefined, persona: brain.persona, turns: 0, prices: brain.prices,
    bind: (t, b) => brain.bind(t, b),
    call: (async <T>(input: CallInput<T>): Promise<CallResult<T>> => {
      const t0 = Date.now();
      let userId = input.userId;
      if (input.jobId) {
        const job = await o.jobs.getJobById(input.jobId);
        if (!job) throw new Error("no such job");
        userId ??= job.userId;
        if (job.spentPaise + need > job.budgetPaise) {
          throw new BudgetExceeded({ needPaise: need, spentPaise: job.spentPaise, budgetPaise: job.budgetPaise, scope: "job", purpose: input.purpose, ...(input.tier ? { tier: input.tier } : {}) });
        }
      }
      const lat = typeof o.latencyMs === "function" ? o.latencyMs(input.purpose) : o.latencyMs ?? 0;
      if (lat) await new Promise((r) => setTimeout(r, lat));
      const modelName = `${o.mode}/${brain.persona.name}`;
      let a: BrainAnswer;
      if (input.purpose === "agent.work") {
        kit.turns += 1;
        await kit.beforeTurn?.(kit.turns);
        a = brain.work(input.jobId ?? "", input.messages);
        await kit.afterTurn?.(kit.turns);
      } else {
        a = brain.json(input.purpose, input, input.json && input.json !== true ? input.json : undefined, input.jobId);
      }
      const result = {
        text: a.text, json: a.json as T, toolCalls: a.toolCalls, model: modelName, ...(input.tier ? { tier: input.tier } : {}), promptTokens: a.promptTokens, completionTokens: a.completionTokens,
        costUsd: a.paise / 88 / 100, paise: a.paise, costSource: "reported", truncated: false, ms: Date.now() - t0, calls: 1, trail: [{ model: modelName, outcome: "ok" }],
      } as CallResult<T>;
      if (input.jobId) await addJobSpend(o.jobs, input.jobId, result.paise);
      if (userId) void ledger.addCalls(userId, [{ runId: input.jobId ? `code:${input.jobId}` : `code:${input.purpose}`, step: input.step ?? 0, surface: "desktop", at: Date.now(), model: result.model, outcome: "ok", ms: result.ms, promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd }]);
      logs.push(logOf(input as CallInput<unknown>, result as CallResult<unknown>, null, t0));
      return result;
    }) as CallFn,
  };
  return kit;
}

// ------------------------------------------------------------------ a scripted model behind the wire

/**
 * A scripted model that speaks OpenAI's chat-completions shape, so the REAL gateway (ladder, retries, JSON repair, budgets, ledger) runs on top of it and
 * the cassettes (adapters/cassette.ts) can record what it said and replay it. Which question it is answering comes from `callContext`, set by realKit.
 */
export function scriptedWire(o: { persona?: Persona; prices?: { work?: number; json?: number }; latencyMs?: number }): { client: ChatClient; brain: ScriptedBrain } {
  const brain = new ScriptedBrain({ ...(o.persona ? { persona: o.persona } : {}), ...(o.prices ? { prices: o.prices } : {}) });
  const client: ChatClient = {
    chat: {
      completions: {
        async create(body: Record<string, unknown>): Promise<unknown> {
          const ctx = callContext.getStore();
          if (!ctx) throw Object.assign(new Error("the scripted wire client was called outside a model call"), { status: 500 });
          if (o.latencyMs) await new Promise((r) => setTimeout(r, o.latencyMs));
          const messages = (body.messages ?? []) as Array<{ role: string; content: unknown }>;
          let a: BrainAnswer;
          try {
            a = ctx.purpose === "agent.work" ? brain.work(ctx.jobId ?? "", messages) : brain.json(ctx.purpose, { purpose: ctx.purpose, messages }, undefined, ctx.jobId);
          } catch (err) { throw Object.assign(err as Error, { status: 503 }); }
          const model = String(body.model ?? "scripted/model");
          return {
            id: `gen-${Math.abs(hash(JSON.stringify(messages).slice(-400))).toString(36)}`, model, provider: "scripted",
            choices: [{ index: 0, finish_reason: a.toolCalls.length ? "tool_calls" : "stop", message: { role: "assistant", content: a.text, ...(a.toolCalls.length ? { tool_calls: a.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) } : {}) } }],
            usage: { prompt_tokens: a.promptTokens, completion_tokens: a.completionTokens, total_tokens: a.promptTokens + a.completionTokens, cost: a.paise / 88 / 100 },
          };
        },
      },
    },
  };
  return { client, brain };
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
