/**
 * THE ONE DOOR TO A MODEL: callModel().
 *
 * Everything the Code bot's brain asks of a model goes through this function
 * and nowhere else, so that the rules about money, privacy and failure are
 * written once:
 *
 * WHICH MODEL. By TIER (tiers.ts) or by a named model. A tier is a ladder: the
 * models are tried in order, and the next is tried only when a call fails before
 * it has answered (an HTTP error, a refused parameter, the tier's timeout, an
 * answer with nothing in it, JSON that could not be made valid). The review
 * tier takes the writer's model too and never picks a model of the writer's own
 * family. Unlike the planner's ladder (agent/llm.ts), nothing here is shown to
 * anyone while it is written, so ANY failure may move on: there is no half a
 * line on a screen to contradict. The answer is read whole, not streamed.
 *
 * ONE TRANSIENT RETRY. A 429 or a 5xx is tried once more on the same model, after
 * a short random wait (jittered, so a burst of jobs does not come back in step).
 * Only then does the ladder climb. A timeout is not retried: the wait was already
 * the tier's whole allowance.
 *
 * JSON. With `json` the answer is parsed (a code fence or a line of preamble
 * is tolerated) and, given a zod schema, checked against it. A bad answer gets
 * ONE repair: the same model is shown what it wrote and what was wrong with it
 * and asked again. If that fails too the ladder moves on.
 *
 * MONEY. Before every call, even a retry or a repair, the worst case is
 * estimated (money.ts) and the call is REFUSED with BudgetExceeded if the job's
 * spend plus that estimate would pass its budget_paise, or if this call's own
 * maxPaise would be passed. A caller that catches BudgetExceeded can ask for
 * less, or stop. After a call, what it cost is read off OpenRouter's answer
 * (usage.cost, in dollars), else estimated from the tokens it reports and the
 * tier's prices, converted to paise at CODE_USD_INR, and added to the job's
 * spent_paise. A call that was billed and then thrown away (an empty answer, a
 * JSON answer that did not hold up) is still added: it cost what it cost.
 *
 * PRIVACY. Requests ask OpenRouter for providers that neither keep nor train on
 * what they are sent (data_collection: "deny"), and carry the person as a
 * HASH, never their id. NOTHING THAT WAS SENT OR RECEIVED IS EVER LOGGED OR
 * KEPT: a log line has the model, the purpose, the tokens, the milliseconds and
 * the paise, and an error is logged by its status and kind, never its message.
 *
 * THE LEDGER. When the run ledger is on (AGENT_RUN_LEDGER) every call, failed
 * ones too, is written to agent_calls as a CallRecord under the run id
 * `code:<jobId>`, the same rows the Ask runs write. The column for the surface
 * only allows phone and desktop, so these say desktop; the run id is what tells
 * them apart.
 *
 * Every dependency is injectable (the client, the job store, the ledger, the
 * clock, the wait, the dice), so the tests run it all against a fake OpenRouter.
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { temperatureFor, type CallRecord } from "../../agent/llm.js";
import { getConfig } from "../../config.js";
import { openrouter } from "../../pipeline/openrouter.js";
import { principleText } from "../../principles/library.js";
import { callRowOf, runStore, type RunStore } from "../../runs/index.js";
import { jobStore, type JobStore } from "../jobs/store.js";
import { DEFAULT_USD_INR, charsOf, tokensOfChars, usdFor, usdToPaise, worstCasePaise } from "./money.js";
import { addJobSpend, readJobMoney } from "./spend.js";
import {
  UNLISTED_MODEL, ladderOf, reasoningParam, tierOfModel, tierTable,
  type ModelTier, type TierSettings,
} from "./tiers.js";
import type { ChatMessage, ToolCall, ToolDef } from "./types.js";

export type { ChatMessage, ToolCall, ToolDef } from "./types.js";

// ---------------------------------------------------------------- the shapes

/**
 * How a call is held to a budget.
 *   "job"         the job's own budget_paise (needs jobId): no extra ceiling
 *   { maxPaise }  this call, all its attempts and repairs together, may cost no
 *                 more than that; with a jobId the job's budget applies as well
 *   "none"        no ceiling, for the bot's own housekeeping with no job behind it
 * With a jobId the job's budget is ALWAYS enforced: it is the person's money.
 */
export type Budget = "job" | "none" | { maxPaise: number };

export interface CallInput<T = unknown> {
  /** A tier, or a model, or both (the model first, then the rest of the tier). */
  tier?: ModelTier;
  model?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: "auto" | "none" | "required";
  /** A zod schema to validate against, or true for any JSON. Not together with tools. */
  json?: z.ZodType<T> | true;
  /** The tier's maxTokens when not given. */
  maxTokens?: number;
  /** The job this call is for: its spend grows by what the call costs, and its budget bounds it. */
  jobId?: string;
  /** Whose call it is, when there is no job to say: for the hashed user id and the ledger. */
  userId?: string;
  /** Which step of the job, for the ledger. */
  step?: number;
  /** Why, in a word ("classify", "plan"): for the log and the ledger. Never any of the content. */
  purpose: string;
  budget: Budget;
  /** For the review tier: the model that wrote what is being reviewed. A reviewer of its family is never picked. */
  writerModel?: string;
  /** Instead of the tier's. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CallResult<T = unknown> {
  text: string;
  /** The parsed (and, given a schema, validated) JSON. Undefined without `json`. */
  json: T | undefined;
  toolCalls: ToolCall[];
  /** The model that answered. */
  model: string;
  tier?: ModelTier;
  /** Everything this callModel spent: tokens, dollars and paise over all its calls, retries and repairs included. */
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  paise: number;
  /** "reported" only when OpenRouter named the charge for every call that was billed. */
  costSource: "reported" | "estimated";
  /** The answer stopped because it ran out of maxTokens. */
  truncated: boolean;
  ms: number;
  /** Calls made, failed ones not counted. */
  calls: number;
  /** What happened, model by model. Never any content. */
  trail: TrailEntry[];
}

export interface TrailEntry {
  model: string;
  outcome: "ok" | "failed" | "timeout" | "empty" | "invalid_json";
  status?: number;
  /** A transient retry was made on this model. */
  retried?: boolean;
  /** The JSON was repaired on this model. */
  repaired?: boolean;
}

/** The job's budget, or this call's own, would be passed by the next call. Catch it to ask for less or to stop. */
export class BudgetExceeded extends Error {
  readonly code = "budget_exceeded";
  readonly needPaise: number;
  readonly spentPaise: number;
  readonly budgetPaise: number;
  readonly scope: "job" | "call";
  readonly purpose: string;
  readonly tier?: ModelTier;
  readonly model?: string;

  constructor(o: { needPaise: number; spentPaise: number; budgetPaise: number; scope: "job" | "call"; purpose: string; tier?: ModelTier; model?: string }) {
    super(`The ${o.scope === "job" ? "job's" : "call's"} budget cannot cover ${o.purpose}: ${o.needPaise} paise needed in the worst case, ${Math.max(0, o.budgetPaise - o.spentPaise)} left.`);
    this.name = "BudgetExceeded";
    this.needPaise = o.needPaise;
    this.spentPaise = o.spentPaise;
    this.budgetPaise = o.budgetPaise;
    this.scope = o.scope;
    this.purpose = o.purpose;
    if (o.tier) this.tier = o.tier;
    if (o.model) this.model = o.model;
  }

  get leftPaise(): number { return Math.max(0, this.budgetPaise - this.spentPaise); }
}

/** Every model on the ladder failed before it answered (or there was none to try). */
export class ModelUnavailable extends Error {
  readonly code = "model_unavailable";
  constructor(readonly trail: TrailEntry[], readonly causeError: unknown) {
    super("every model for this call failed");
    this.name = "ModelUnavailable";
  }
}

/** The log the gateway writes to: pino's shape, as the rest of the server uses it. */
export interface BrainLog {
  info(o: object, msg: string): void;
  warn(o: object, msg: string): void;
}

const consoleLog: BrainLog = {
  info: (o, msg) => console.info(`[code-brain] ${msg} ${JSON.stringify(o)}`),
  warn: (o, msg) => console.warn(`[code-brain] ${msg} ${JSON.stringify(o)}`),
};
let theLog: BrainLog = consoleLog;

/** Where the brain's lines go: the server passes its logger. Null puts it back on the console. */
export function setBrainLog(log: BrainLog | null): void { theLog = log ?? consoleLog; }

/** The part of an OpenAI-shaped client the gateway uses. */
export interface ChatClient {
  chat: {
    completions: {
      create(body: Record<string, unknown>, opts?: { signal?: AbortSignal; timeout?: number; maxRetries?: number }): Promise<unknown>;
    };
  };
}

export interface GatewayDeps {
  /** OpenRouter's client; openrouter() when not given. */
  client?: ChatClient;
  /** The jobs' store; jobStore() when not given. Read only when a jobId is. */
  jobs?: Pick<JobStore, "getJobById" | "casJob">;
  /** Where calls are written: the run ledger's store when AGENT_RUN_LEDGER is on, else nowhere. Null for nowhere. */
  ledger?: Pick<RunStore, "addCalls"> | null;
  log?: BrainLog;
  now?: () => number;
  /** The wait before a transient retry. */
  sleep?: (ms: number) => Promise<void>;
  /** In [0, 1): the jitter. */
  random?: () => number;
  /** Rupees to the dollar, instead of CODE_USD_INR. */
  fx?: number;
  /** The tier table, instead of the one the config makes. */
  tiers?: Record<ModelTier, TierSettings>;
}

// ---------------------------------------------------------------- the pieces

const JSON_NOTE = "Answer with one JSON value only: no prose, no code fences.";
/** The library's own line for it: a prompt that has it needs no second note. */
const JSON_ASKED = principleText("out.json");
/** The longest a retry waits on a 429's Retry-After, whatever it says. */
const RETRY_AFTER_MAX_MS = 5_000;
const RETRY_BASE_MS = 500;
/** The most of a model's JSON problem that is shown back to it. */
const PROBLEM_MAX = 300;

class CallFailure extends Error {
  constructor(readonly kind: "http" | "timeout" | "empty", readonly status?: number, readonly retryAfterMs?: number) {
    super(`model call failed (${kind}${status === undefined ? "" : ` ${status}`})`);
    this.name = "CallFailure";
  }
}

class JsonInvalid extends Error {
  constructor() {
    super("the model's answer was not the JSON asked for");
    this.name = "JsonInvalid";
  }
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The status an SDK error carries, or undefined for one with none (a dropped connection). */
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; response?: { status?: unknown } } | null;
  const s = e?.status ?? e?.response?.status;
  return typeof s === "number" ? s : undefined;
}

function retryAfterOf(err: unknown): number | undefined {
  const h = (err as { headers?: unknown } | null)?.headers as { get?: (k: string) => string | null } & Record<string, unknown> | undefined;
  const raw = typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"];
  const secs = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(secs) && secs >= 0 ? Math.min(RETRY_AFTER_MAX_MS, secs * 1000) : undefined;
}

const transient = (status: number | undefined): boolean => status !== undefined && (status === 429 || status >= 500);

/** The person as OpenRouter sees them: a hash, so their id never leaves. */
export function hashedUser(id: string): string {
  return createHash("sha256").update(`tailzu-code:${id}`).digest("hex").slice(0, 32);
}

/** Our messages in the wire's shape: a tool call is {id, type, function}. */
function toWire(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant", content: m.content,
        tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })),
      };
    }
    return m;
  });
}

/**
 * The JSON note, once: a system block composed from a role with a JSON contract already carries the library's out.json line
 * (principles/library.ts), and is sent as it is, so the stable block stays the same bytes on every call.
 */
function withJsonNote(messages: readonly ChatMessage[]): ChatMessage[] {
  const i = messages.findIndex((m) => m.role === "system");
  if (i < 0) return [{ role: "system", content: JSON_NOTE }, ...messages];
  const sys = messages[i] as { role: "system"; content: string };
  if (sys.content.includes(JSON_ASKED)) return [...messages];
  const out = [...messages];
  out[i] = { role: "system", content: `${sys.content}\n\n${JSON_NOTE}` };
  return out;
}

/** The first JSON value in a model's answer: the whole text, or what is in a code fence, or from the first brace or bracket to its last partner. */
export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const tries: string[] = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) tries.push(fence[1].trim());
  const open = text.search(/[{[]/);
  if (open >= 0) {
    const close = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (close > open) tries.push(text.slice(open, close + 1));
  }
  let last = "it is empty";
  for (const t of tries) {
    if (!t) continue;
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch (err) {
      last = (err as Error).message;
    }
  }
  return { ok: false, error: `it is not valid JSON (${last.slice(0, 120)})` };
}

function checkJson<T>(text: string, schema: z.ZodType<T> | true): { ok: true; value: T } | { ok: false; error: string } {
  const parsed = parseJsonLoose(text);
  if (!parsed.ok) return parsed;
  if (schema === true) return { ok: true, value: parsed.value as T };
  const checked = schema.safeParse(parsed.value);
  if (checked.success) return { ok: true, value: checked.data };
  const why = checked.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return { ok: false, error: `it does not fit the schema (${why})`.slice(0, PROBLEM_MAX) };
}

interface Completion {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  provider?: string;
  served?: string;
}

/** What came back, read defensively: a field that is not what it should be is as good as absent. */
function readCompletion(raw: unknown, asked: string): Completion {
  const r = (raw ?? {}) as Record<string, any>;
  if (r.error && typeof r.error === "object") {
    // OpenRouter sometimes answers 200 with the upstream's error in the body.
    const code = Number(r.error.code);
    throw new CallFailure("http", Number.isFinite(code) ? code : 502);
  }
  const choice = Array.isArray(r.choices) ? r.choices[0] : undefined;
  const msg = (choice?.message ?? {}) as Record<string, any>;
  const text = typeof msg.content === "string" ? msg.content : "";
  const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.flatMap((t: any) =>
      typeof t?.function?.name === "string"
        ? [{ id: String(t.id ?? ""), name: t.function.name as string, arguments: typeof t.function.arguments === "string" ? t.function.arguments : "" }]
        : [])
    : [];
  const u = (r.usage ?? {}) as Record<string, any>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  return {
    text, toolCalls,
    ...(typeof choice?.finish_reason === "string" ? { finishReason: choice.finish_reason as string } : {}),
    ...(num(u.prompt_tokens) !== undefined ? { promptTokens: num(u.prompt_tokens)! } : {}),
    ...(num(u.completion_tokens) !== undefined ? { completionTokens: num(u.completion_tokens)! } : {}),
    ...(num(u.prompt_tokens_details?.cached_tokens) !== undefined ? { cachedTokens: num(u.prompt_tokens_details.cached_tokens)! } : {}),
    ...(num(u.completion_tokens_details?.reasoning_tokens) !== undefined ? { reasoningTokens: num(u.completion_tokens_details.reasoning_tokens)! } : {}),
    // A charge that is not a plain amount is no charge at all, not a guess (agent/llm.ts).
    ...(num(u.cost) !== undefined ? { costUsd: num(u.cost)! } : {}),
    ...(typeof r.provider === "string" && r.provider ? { provider: r.provider as string } : {}),
    ...(typeof r.model === "string" && r.model && r.model !== asked ? { served: r.model as string } : {}),
  };
}

// --------------------------------------------------------------- the gateway

interface Plan {
  ladder: string[];
  settings: TierSettings;
}

function planOf(input: CallInput, tiers: Record<ModelTier, TierSettings>): Plan {
  const pinned = input.model?.trim() || undefined;
  if (input.tier) {
    const rest = ladderOf(input.tier, { writerModel: input.writerModel, table: tiers });
    // A pinned model of the writer's own family is no reviewer.
    const fine = pinned && !(input.tier === "review" && input.writerModel && sameFamily(pinned, input.writerModel));
    const ladder = fine ? [pinned, ...rest.filter((m) => m !== pinned)] : rest;
    return { ladder, settings: tiers[input.tier] };
  }
  if (pinned) {
    const t = tierOfModel(pinned, tiers);
    return { ladder: [pinned], settings: t ? tiers[t] : UNLISTED_MODEL };
  }
  throw new TypeError("callModel needs a tier or a model");
}

const sameFamily = (a: string, b: string): boolean => a.split("/")[0]!.toLowerCase() === b.split("/")[0]!.toLowerCase();

export async function callModel<T = unknown>(input: CallInput<T>, deps: GatewayDeps = {}): Promise<CallResult<T>> {
  if (input.json && input.tools?.length) throw new TypeError("callModel: json and tools cannot be used together");
  if (input.budget === "job" && !input.jobId) throw new TypeError('callModel: budget "job" needs a jobId');
  const clock = deps.now ?? Date.now;
  const log = deps.log ?? theLog;
  const fx = deps.fx ?? getConfig().CODE_USD_INR ?? DEFAULT_USD_INR;
  const tiers = deps.tiers ?? tierTable();
  const sleep = deps.sleep ?? sleepFor;
  const random = deps.random ?? Math.random;
  const plan = planOf(input, tiers);
  const { settings } = plan;
  const maxTokens = input.maxTokens ?? settings.maxTokens;
  const timeoutMs = input.timeoutMs ?? settings.timeoutMs;
  const cap = typeof input.budget === "object" ? input.budget.maxPaise : null;
  const jobs = input.jobId ? deps.jobs ?? jobStore() : null;
  const ledger = deps.ledger !== undefined ? deps.ledger : getConfig().AGENT_RUN_LEDGER ? runStore() : null;
  const t0 = clock();
  let userId = input.userId;

  const trail: TrailEntry[] = [];
  const total = { promptTokens: 0, completionTokens: 0, costUsd: 0, paise: 0, calls: 0, allReported: true };

  if (!plan.ladder.length) {
    throw new ModelUnavailable(trail, new Error(input.tier === "review" ? "no reviewer of a different family from the writer" : "no model to try"));
  }

  /** The job's spend and budget now, read fresh before every call. */
  async function jobMoney(): Promise<{ spent: number; budget: number } | null> {
    if (!jobs) return null;
    const m = await readJobMoney(jobs, input.jobId!);
    if (!m) throw new Error("callModel: no such job");
    userId ??= m.job.userId;
    return { spent: m.spentPaise, budget: m.budgetPaise };
  }

  /** Refuses the call if its worst case would pass the job's budget or this call's own. */
  async function guard(model: string, messages: readonly ChatMessage[]): Promise<void> {
    const need = worstCasePaise({ chars: charsOf(messages, input.tools), maxTokens, usdPerMIn: settings.usdPerMIn, usdPerMOut: settings.usdPerMOut }, fx);
    const money = await jobMoney();
    const who = { needPaise: need, purpose: input.purpose, ...(input.tier ? { tier: input.tier } : {}), model };
    if (money && money.spent + need > money.budget) {
      throw new BudgetExceeded({ ...who, spentPaise: money.spent, budgetPaise: money.budget, scope: "job" });
    }
    if (cap !== null && total.paise + need > cap) {
      throw new BudgetExceeded({ ...who, spentPaise: total.paise, budgetPaise: cap, scope: "call" });
    }
  }

  /** A call settled: the line, the ledger row, and (when it was billed) the job's spend. */
  async function settle(rec: CallRecord, paise: number): Promise<void> {
    log.info({
      model: rec.model, ...(input.tier ? { tier: input.tier } : {}), purpose: input.purpose, outcome: rec.outcome,
      ...(rec.promptTokens !== undefined ? { promptTokens: rec.promptTokens } : {}),
      ...(rec.completionTokens !== undefined ? { completionTokens: rec.completionTokens } : {}),
      ...(rec.status !== undefined ? { status: rec.status } : {}),
      ms: rec.ms, paise, ...(input.jobId ? { job: input.jobId } : {}),
    }, "code brain call");
    if (ledger && userId) {
      try {
        const row = callRowOf(rec, { runId: input.jobId ? `code:${input.jobId}` : `code:${input.purpose}`, step: input.step ?? 0, surface: "desktop", at: clock() });
        void Promise.resolve(ledger.addCalls(userId, [row])).catch((err: unknown) => log.warn({ error: (err as Error)?.name }, "code brain: call not written to the ledger"));
      } catch (err) {
        log.warn({ error: (err as Error)?.name }, "code brain: call not written to the ledger");
      }
    }
    if (paise > 0 && jobs) {
      try {
        if ((await addJobSpend(jobs, input.jobId!, paise)) === null) log.warn({ job: input.jobId, paise }, "code brain: spend not added to the job");
      } catch (err) {
        log.warn({ job: input.jobId, paise, error: (err as Error)?.name }, "code brain: spend not added to the job");
      }
    }
  }

  /** One request to one model. Throws CallFailure (climb), BudgetExceeded, or an AbortError. */
  async function oneCall(model: string, messages: readonly ChatMessage[]): Promise<Completion> {
    if (input.signal?.aborted) throw abortError();
    await guard(model, messages);
    const body = requestBody(model, messages);
    const ctrl = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => { callerAborted = true; ctrl.abort(); };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const clockOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new CallFailure("timeout")); ctrl.abort(); }, timeoutMs);
    });
    const started = clock();
    const rec: CallRecord = { model, outcome: "failed", ms: 0 };
    try {
      const pending = (deps.client ?? (openrouter() as unknown as ChatClient)).chat.completions
        .create(body, { signal: ctrl.signal, timeout: timeoutMs, maxRetries: 0 });
      // If the clock wins, this one may reject later and nobody is waiting.
      Promise.resolve(pending).catch(() => undefined);
      const raw = await Promise.race([pending, clockOut]);
      const done = readCompletion(raw, model);
      rec.ms = clock() - started;
      if (done.provider) rec.provider = done.provider;
      if (done.served) rec.served = done.served;
      if (done.promptTokens !== undefined) rec.promptTokens = done.promptTokens;
      if (done.completionTokens !== undefined) rec.completionTokens = done.completionTokens;
      if (done.cachedTokens !== undefined) rec.cachedTokens = done.cachedTokens;
      if (done.reasoningTokens !== undefined) rec.reasoningTokens = done.reasoningTokens;
      // What it cost: OpenRouter's own figure, else the tokens it reports at the tier's prices, else the characters.
      let usd: number;
      let reported = false;
      if (done.costUsd !== undefined) {
        usd = done.costUsd;
        reported = true;
        rec.costUsd = usd;
      } else if (done.promptTokens !== undefined || done.completionTokens !== undefined) {
        usd = usdFor(
          done.promptTokens ?? tokensOfChars(charsOf(messages, input.tools)),
          done.completionTokens ?? tokensOfChars(done.text.length + done.toolCalls.reduce((n, t) => n + t.arguments.length, 0)),
          settings,
        );
      } else {
        usd = usdFor(tokensOfChars(charsOf(messages, input.tools)), tokensOfChars(done.text.length + done.toolCalls.reduce((n, t) => n + t.arguments.length, 0)), settings);
      }
      const paise = usdToPaise(usd, fx);
      total.promptTokens += done.promptTokens ?? 0;
      total.completionTokens += done.completionTokens ?? 0;
      total.costUsd += usd;
      total.paise += paise;
      total.calls += 1;
      if (!reported) total.allReported = false;
      const empty = !done.text.trim() && done.toolCalls.length === 0;
      rec.outcome = empty ? "empty" : "ok";
      await settle(rec, paise);
      if (empty) throw new CallFailure("empty");
      return done;
    } catch (err) {
      if (rec.outcome === "empty" || err instanceof BudgetExceeded) throw err;
      rec.ms = clock() - started;
      if (callerAborted || (input.signal?.aborted && !timedOut)) {
        throw abortError();
      }
      const failure = err instanceof CallFailure ? err
        : new CallFailure(timedOut ? "timeout" : "http", statusOf(err), transient(statusOf(err)) ? retryAfterOf(err) : undefined);
      rec.outcome = failure.kind === "timeout" ? "timeout" : "failed";
      if (failure.status !== undefined) rec.status = failure.status;
      await settle(rec, 0);
      throw failure;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      ctrl.abort();
    }
  }

  function requestBody(model: string, messages: readonly ChatMessage[]): Record<string, unknown> {
    const temperature = temperatureFor(model);
    return {
      model,
      // Only providers that neither keep nor train on what they are sent: a job's
      // messages carry the person's code.
      provider: { data_collection: "deny" },
      // OpenRouter's usage accounting: the charge in dollars comes back with the answer.
      usage: { include: true },
      max_tokens: maxTokens,
      reasoning: reasoningParam(model, settings.reasoning),
      ...(temperature === undefined ? {} : { temperature }),
      ...(userId ? { user: hashedUser(userId) } : {}),
      messages: toWire(messages),
      ...(input.tools?.length
        ? {
          tools: input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
          tool_choice: input.toolChoice ?? "auto",
        }
        : {}),
      ...(input.json ? { response_format: { type: "json_object" } } : {}),
    };
  }

  /** One model, start to end: a transient retry, a JSON repair. Throws what makes the ladder climb. */
  async function tryModel(model: string): Promise<CallResult<T>> {
    const entry: TrailEntry = { model, outcome: "failed" };
    trail.push(entry);
    let retried = false;

    const attempt = async (messages: readonly ChatMessage[]): Promise<Completion> => {
      try {
        return await oneCall(model, messages);
      } catch (err) {
        if (err instanceof CallFailure && err.kind === "http" && transient(err.status) && !retried) {
          retried = true;
          entry.retried = true;
          const base = err.retryAfterMs ?? RETRY_BASE_MS;
          await sleep(Math.round(base * (0.5 + random())));
          return await oneCall(model, messages);
        }
        throw err;
      }
    };

    try {
      const base = input.json ? withJsonNote(input.messages) : input.messages;
      let answer = await attempt(base);
      let value: T | undefined;
      if (input.json) {
        let checked = checkJson<T>(answer.text, input.json);
        if (!checked.ok) {
          entry.repaired = true;
          const again: ChatMessage[] = [
            ...base,
            { role: "assistant", content: answer.text },
            { role: "user", content: `That answer cannot be used: ${checked.error}. Answer again with only the corrected JSON.` },
          ];
          answer = await attempt(again);
          checked = checkJson<T>(answer.text, input.json);
          if (!checked.ok) {
            entry.outcome = "invalid_json";
            throw new JsonInvalid();
          }
        }
        value = checked.value;
      }
      entry.outcome = "ok";
      return {
        text: answer.text, json: value, toolCalls: answer.toolCalls, model,
        ...(input.tier ? { tier: input.tier } : {}),
        promptTokens: total.promptTokens, completionTokens: total.completionTokens, costUsd: total.costUsd, paise: total.paise,
        costSource: total.allReported ? "reported" : "estimated",
        truncated: answer.finishReason === "length",
        ms: clock() - t0, calls: total.calls, trail,
      };
    } catch (err) {
      if (err instanceof CallFailure) {
        entry.outcome = err.kind === "timeout" ? "timeout" : err.kind === "empty" ? "empty" : "failed";
        if (err.status !== undefined) entry.status = err.status;
      }
      throw err;
    }
  }

  let lastError: unknown = new Error("no model was tried");
  for (const model of plan.ladder) {
    if (input.signal?.aborted) throw abortError();
    try {
      return await tryModel(model);
    } catch (err) {
      // Only a model failing moves the ladder on. A budget, an abort, a job that is not there, a store that is down
      // (the budget cannot be checked, so no call is made) and a bug are the caller's to hear about.
      if (!(err instanceof CallFailure || err instanceof JsonInvalid)) throw err;
      lastError = err;
      log.info({ model, purpose: input.purpose, ...(err instanceof CallFailure ? { kind: err.kind, ...(err.status !== undefined ? { status: err.status } : {}) } : { kind: "invalid_json" }) }, "code brain: moving on to the next model");
    }
  }
  throw new ModelUnavailable(trail, lastError);
}
