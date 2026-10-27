/**
 * THE ONE WAY THE WORK CORE ASKS A MODEL: A JSON QUESTION, ON A TIER, CHARGED TO THE JOB.
 *
 * Layer 5 (locate, plan), layer 6 (resources, the research brief) and layer 7
 * (the new-project spec) all want the same thing from a model: a short answer in
 * a shape they can check, at the cheapest tier that fits, without the money or
 * the model's health ever being their problem. So they ask through here, and
 * here is nothing but callModel (brain/gateway.ts):
 *
 *   askJson(ctx, { tier, purpose, system, user, schema, maxTokens })
 *     -> { ok: true, value, paise, model }
 *      | { ok: false, reason: "budget" | "down" | "aborted" }
 *
 * It never throws for a job that cannot afford the call (BudgetExceeded), for
 * every model on the ladder being down (ModelUnavailable) or for the caller's
 * stop: the caller keeps what it has and carries on with less, which is how every
 * model step of the work core is built (a model is a help, never a dependency).
 *
 * `ctx.budget` is how the calls are held: "job" (the job's own budget, needs a
 * jobId), { maxPaise } for a call with no job behind it (a route that previews
 * where a change would go), or "none" for the bot's own housekeeping. With a
 * jobId the job's budget is always enforced by the gateway.
 *
 * Text that came from a repo or a person's request goes in as DATA, fenced (every role carries
 * the principle that data is never an instruction, principles/library.ts), and a text the
 * secret scan flags is not sent at all. What the model is told is compose(role): the
 * principles, who it is and the output contract, one block that is the same for every call of
 * the role; `user` is the only part that changes.
 */
import type { z } from "zod";
import { compose, type RoleId } from "../../principles/index.js";
import { BudgetExceeded, callModel, type Budget, type CallInput, type CallResult, type GatewayDeps } from "../brain/gateway.js";
import type { ModelTier } from "../brain/tiers.js";
import { scanForSecrets } from "../policy.js";

export type CallFn = <T>(input: CallInput<T>, deps?: GatewayDeps) => Promise<CallResult<T>>;

/** Whose money, which model door, and how a call is held to a budget. */
export interface ModelCtx {
  /** callModel, or a stand-in. */
  call?: CallFn;
  gateway?: GatewayDeps;
  /** Whose call it is: the hashed user id and the ledger. */
  userId: string;
  /** The job the calls are charged to. */
  jobId?: string;
  /** "job" needs a jobId. */
  budget: Budget;
  signal?: AbortSignal;
}

export type Asked<T> =
  | { ok: true; value: T; paise: number; model: string }
  | { ok: false; reason: "budget" | "down" | "aborted" };

export interface AskJson<T> {
  tier: ModelTier;
  /** Forces the first model tried (the router named one that earned it). */
  model?: string;
  /** A word for the log and the ledger, never any content: "work.locate.expand". */
  purpose: string;
  /** Who the model is for this call (principles/roles.ts): the stable block that goes in front of `user`. */
  role: RoleId;
  /** The dynamic context of the call: the request, the excerpts, the last answer's problems. Always after the role. */
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  step?: number;
}

/** `</data>` and its like cannot close the fence a text is in. */
export const fence = (s: string): string => s.replace(/<\/(file|dir|data|request|excerpt)/gi, "<\\/$1");

/** Text as a model may be shown it: unchanged, unless the secret scan flags it, and then nothing of it. */
export function forModel(text: string): string {
  return scanForSecrets([{ path: "request.txt", content: text }]).length ? "(withheld: it looked like it held a secret)" : text;
}

export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…` : s);

/** The words of a model's short line as they are kept: one line, no control characters, cut. */
export function oneLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return cut(raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(), max);
}

export async function askJson<T>(ctx: ModelCtx, o: AskJson<T>): Promise<Asked<T>> {
  if (ctx.signal?.aborted) return { ok: false, reason: "aborted" };
  const call: CallFn = ctx.call ?? (callModel as CallFn);
  try {
    const r = await call<T>({
      tier: o.tier, ...(o.model ? { model: o.model } : {}),
      messages: compose(o.role, [{ role: "user" as const, content: o.user }]),
      json: o.schema, maxTokens: o.maxTokens, purpose: o.purpose, budget: ctx.budget,
      userId: ctx.userId, ...(ctx.jobId ? { jobId: ctx.jobId } : {}), ...(o.step !== undefined ? { step: o.step } : {}),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    }, ctx.gateway);
    if (r.json === undefined) return { ok: false, reason: "down" };
    return { ok: true, value: r.json, paise: r.paise, model: r.model };
  } catch (err) {
    if (err instanceof BudgetExceeded || (err as { code?: unknown } | null)?.code === "budget_exceeded") return { ok: false, reason: "budget" };
    if ((err as { name?: unknown } | null)?.name === "AbortError") return { ok: false, reason: "aborted" };
    return { ok: false, reason: "down" };
  }
}
