/**
 * ONE STREAMED PLANNER CALL, WITH A LADDER UNDER IT.
 *
 * The models are AGENT_MODEL, then each of AGENT_FALLBACK_MODELS, then
 * CLEANUP_MODEL. The next is tried only when a call fails before it has
 * written anything: an HTTP error, a refused parameter, or AGENT_TIMEOUT_MS
 * passing in silence. Once a model has written a line, that line may already
 * be on the user's screen, and a second model starting over would contradict
 * it; so from then on the step belongs to that model, and a failure or the
 * timeout just ends its answer where it is.
 *
 * Each call is bounded by this module, not the SDK: the client's own timeout
 * stops at the response headers, and a stream that then stalls would hold the
 * guide open forever. No retries either (maxRetries: 0). The ladder is the
 * retry, and it moves on to a different model rather than waiting on the same
 * one twice.
 *
 * Reasoning is off on every call, in OpenRouter's own form, whatever
 * LLM_REASONING_EFFORT says for the writer: a step is one line of protocol,
 * and a model that thinks first spends seconds the user watches go by. For
 * anthropic/* the system prompt is marked for caching, because there it is
 * opt-in; the other providers cache a repeated prefix on their own.
 */
import { getConfig } from "../config.js";
import { openrouter } from "../pipeline/cleanup.js";

export const AGENT_MAX_TOKENS = 300;

export interface PlanChunk {
  model: string;
  delta: string;
}

/** What one model call did, for the log. Never any of the prompt. */
export interface CallRecord {
  model: string;
  outcome: "ok" | "stopped" | "failed" | "timeout";
  ms: number;
  /** Time to the first written character. */
  firstMs?: number;
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  status?: number;
}

export interface PlanOptions {
  signal?: AbortSignal;
  models?: string[];
  timeoutMs?: number;
  log?: (call: CallRecord) => void;
}

/** Thrown when every model in the ladder failed before writing anything. */
export class PlannerUnavailable extends Error {
  constructor(readonly causeError: unknown) {
    super("every agent model failed");
  }
}

export function modelLadder(): string[] {
  const cfg = getConfig();
  const all = [cfg.AGENT_MODEL, ...cfg.AGENT_FALLBACK_MODELS.split(","), cfg.CLEANUP_MODEL].map((m) => m.trim()).filter(Boolean);
  return all.filter((m, i) => all.indexOf(m) === i);
}

export const isAnthropic = (model: string) => model.startsWith("anthropic/");

/**
 * The request body for one model. Exported so the tests can hold it to the
 * contract: the same system bytes for every request, cache marking where it
 * is opt-in, and reasoning off.
 *
 * No temperature for anthropic/*: its newest models refuse a sampling setting
 * other than the default with a 400, which on this ladder would make every
 * step pay for a failed call before the fallback.
 */
export function plannerRequest(model: string, system: string, user: string): Record<string, unknown> {
  const anthropic = isAnthropic(model);
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: AGENT_MAX_TOKENS,
    // cleanup.common()'s way of saying none, and for Anthropic also
    // OpenRouter's explicit off switch, since its models think by default.
    reasoning: anthropic ? { effort: "none", enabled: false } : { effort: "none" },
    ...(anthropic ? {} : { temperature: 0 }),
    messages: [
      {
        role: "system",
        content: anthropic ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
      },
      { role: "user", content: user },
    ],
  };
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/**
 * The planner's text as it is written, chunk by chunk, each tagged with the
 * model writing it. Stopping the iteration early (the step has its action)
 * aborts the upstream call, so the tokens after it are never paid for.
 */
export async function* planStream(system: string, user: string, opts: PlanOptions = {}): AsyncGenerator<PlanChunk> {
  const cfg = getConfig();
  const models = opts.models ?? modelLadder();
  const timeoutMs = opts.timeoutMs ?? cfg.AGENT_TIMEOUT_MS;
  let lastError: unknown = new Error("no agent model configured");

  for (const model of models) {
    if (opts.signal?.aborted) return;
    const ctrl = new AbortController();
    const cancel = () => ctrl.abort();
    opts.signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const t0 = Date.now();
    const call: CallRecord = { model, outcome: "stopped", ms: 0 };
    let wrote = false;
    try {
      const stream = (await openrouter().chat.completions.create(
        plannerRequest(model, system, user) as never,
        { signal: ctrl.signal, maxRetries: 0, timeout: timeoutMs },
      )) as unknown as AsyncIterable<StreamChunk>;
      for await (const chunk of stream) {
        if (chunk.usage) {
          call.promptTokens = chunk.usage.prompt_tokens;
          call.completionTokens = chunk.usage.completion_tokens;
          call.cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          if (!wrote) call.firstMs = Date.now() - t0;
          wrote = true;
          yield { model, delta };
        }
      }
      call.outcome = "ok";
      return;
    } catch (err) {
      call.outcome = timedOut ? "timeout" : "failed";
      const status = (err as { status?: unknown })?.status;
      if (typeof status === "number") call.status = status;
      // Written to, or cancelled by the device: there is nothing to fall back for.
      if (wrote || opts.signal?.aborted) return;
      lastError = err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", cancel);
      ctrl.abort();
      call.ms = Date.now() - t0;
      opts.log?.(call);
    }
  }
  throw new PlannerUnavailable(lastError);
}
