/**
 * ONE STREAMED PLANNER CALL, WITH A LADDER UNDER IT.
 *
 * The models are AGENT_MODEL, then each of AGENT_FALLBACK_MODELS, then
 * CLEANUP_MODEL. The next is tried only when a call fails before it has
 * written anything: an HTTP error, a refused parameter, AGENT_TIMEOUT_MS
 * passing in silence, or an answer that ends with nothing in it. Once a model has written a line, that line may already
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
 *
 * The picture path climbs its own ladder: AGENT_VISION_MODEL, then each of
 * AGENT_VISION_FALLBACK_MODELS, then CLEANUP_MODEL, by the same rule. Asked
 * for the long answer ("step by step", "in detail") it starts one rung
 * higher, at AGENT_VISION_DEEP_MODEL, with more room to write. Its timeout
 * runs to the first character and then from chunk to chunk, not over the
 * whole call, because a worked answer that is still arriving is not a stall;
 * a ceiling over the whole call still ends one that never stops.
 */
import { getConfig } from "../config.js";
import { openrouter } from "../pipeline/cleanup.js";

export const AGENT_MAX_TOKENS = 300;
/** About 90 words of answer, a line each, with room for its points. */
export const VISION_MAX_TOKENS = 450;
/** About 250 words, a step a line, in maths that tokenizes densely. */
export const VISION_DEEP_MAX_TOKENS = 1000;
/** One vision call, however steadily it writes. The device gives a whole run
 *  a minute, and an answer this long has long since been read. */
export const VISION_CALL_MAX_MS = 45_000;

export interface PlanChunk {
  model: string;
  delta: string;
}

/** One part of a user message that carries a picture. */
export type UserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A user message: text, or parts when it carries a picture. */
export type UserContent = string | UserPart[];

/** The picture path's call: which ladder, and how much it may write. */
export interface PictureCall {
  deep: boolean;
}

/** What one model call did, for the log. Never any of the prompt. */
export interface CallRecord {
  model: string;
  outcome: "ok" | "stopped" | "failed" | "timeout" | "empty";
  ms: number;
  /** Time to the first written character. */
  firstMs?: number;
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  status?: number;
  /** A picture path call: one picture went with it. */
  picture?: true;
  /** On the deep ladder. */
  deep?: true;
}

export interface PlanOptions {
  signal?: AbortSignal;
  models?: string[];
  timeoutMs?: number;
  log?: (call: CallRecord) => void;
  /** The picture path: the vision ladder, its timeout and its budget. */
  picture?: PictureCall;
}

/** Thrown when every model in the ladder failed before writing anything. */
export class PlannerUnavailable extends Error {
  constructor(readonly causeError: unknown) {
    super("every agent model failed");
  }
}

const ladder = (models: string[]) => {
  const all = models.map((m) => m.trim()).filter(Boolean);
  return all.filter((m, i) => all.indexOf(m) === i);
};

export function modelLadder(): string[] {
  const cfg = getConfig();
  return ladder([cfg.AGENT_MODEL, ...cfg.AGENT_FALLBACK_MODELS.split(","), cfg.CLEANUP_MODEL]);
}

/** The picture path's models, the deep one first when they asked for depth. */
export function visionLadder(deep = false): string[] {
  const cfg = getConfig();
  return ladder([
    ...(deep ? [cfg.AGENT_VISION_DEEP_MODEL] : []),
    cfg.AGENT_VISION_MODEL,
    ...cfg.AGENT_VISION_FALLBACK_MODELS.split(","),
    cfg.CLEANUP_MODEL,
  ]);
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
export function plannerRequest(
  model: string,
  system: string,
  user: UserContent,
  maxTokens = AGENT_MAX_TOKENS,
): Record<string, unknown> {
  const anthropic = isAnthropic(model);
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
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
export async function* planStream(system: string, user: UserContent, opts: PlanOptions = {}): AsyncGenerator<PlanChunk> {
  const cfg = getConfig();
  const picture = opts.picture;
  const models = opts.models ?? (picture ? visionLadder(picture.deep) : modelLadder());
  const timeoutMs = opts.timeoutMs ?? (picture ? cfg.AGENT_VISION_TIMEOUT_MS : cfg.AGENT_TIMEOUT_MS);
  const maxTokens = !picture ? AGENT_MAX_TOKENS : picture.deep ? VISION_DEEP_MAX_TOKENS : VISION_MAX_TOKENS;
  let lastError: unknown = new Error("no agent model configured");
  // A model answered, with nothing. When the ladder runs out after that, the
  // step had nothing to say, which is not the same as no model being there.
  let answeredEmpty = false;

  for (const model of models) {
    if (opts.signal?.aborted) return;
    const ctrl = new AbortController();
    const cancel = () => ctrl.abort();
    opts.signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const expire = () => { timedOut = true; ctrl.abort(); };
    let timer = setTimeout(expire, timeoutMs);
    // A picture answer's clock starts again with every chunk it writes; this
    // is the bound on the whole of it.
    const ceiling = picture ? setTimeout(expire, Math.max(timeoutMs, VISION_CALL_MAX_MS)) : undefined;
    const t0 = Date.now();
    const call: CallRecord = { model, outcome: "stopped", ms: 0 };
    if (picture) call.picture = true;
    if (picture?.deep) call.deep = true;
    let wrote = false;
    try {
      const stream = (await openrouter().chat.completions.create(
        plannerRequest(model, system, user, maxTokens) as never,
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
          if (picture) {
            clearTimeout(timer);
            timer = setTimeout(expire, timeoutMs);
          }
          yield { model, delta };
        }
      }
      if (wrote) {
        call.outcome = "ok";
        return;
      }
      // An answer that ended cleanly with nothing in it (a content filter's
      // stop, or every token spent somewhere else) is a failure before any
      // output: the next model may well answer what this one would not.
      call.outcome = "empty";
      if (opts.signal?.aborted) return;
      answeredEmpty = true;
      lastError = new Error(`${model} wrote nothing`);
    } catch (err) {
      call.outcome = timedOut ? "timeout" : "failed";
      const status = (err as { status?: unknown })?.status;
      if (typeof status === "number") call.status = status;
      // Written to, or cancelled by the device: there is nothing to fall back for.
      if (wrote || opts.signal?.aborted) return;
      lastError = err;
    } finally {
      clearTimeout(timer);
      clearTimeout(ceiling);
      opts.signal?.removeEventListener("abort", cancel);
      ctrl.abort();
      call.ms = Date.now() - t0;
      opts.log?.(call);
    }
  }
  if (answeredEmpty) return;
  throw new PlannerUnavailable(lastError);
}
