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
 * Reasoning is as low as each model allows, in OpenRouter's own form,
 * whatever LLM_REASONING_EFFORT says for the writer: a step is one line of
 * protocol, and a model that thinks first spends seconds the user watches go
 * by. Off where it can be turned off; the lowest effort it allows for the
 * models whose thinking cannot be, which refuse "none" with a 400 before
 * writing a word, so every picture question on one of them used to fail and
 * fall back (reasoningFor, reasoning.ts). A model that is not known to be one
 * and answers that exact 400 is asked again at once with its lowest effort,
 * and remembered, so it costs one failed call in the life of the process and
 * not one per step. That thinking comes out of max_tokens too, so a model that
 * must think is given an allowance on top of the answer's own limit
 * (maxTokensWithReasoning), and one whose answer still came back empty because
 * it ran out of room is asked once more at once with a larger allowance. For
 * anthropic/* the system prompt is marked for caching,
 * because there it is opt-in; the other providers cache a repeated prefix on
 * their own.
 *
 * The picture path climbs its own ladder: AGENT_VISION_MODEL, then each of
 * AGENT_VISION_FALLBACK_MODELS, then CLEANUP_MODEL, by the same rule, each
 * model once however often the config names it. Asked for the long answer
 * ("step by step", "in detail") it starts at AGENT_VISION_DEEP_MODEL, with
 * more room to write. Its timeout runs to the first character and then from
 * chunk to chunk, not over the whole call, because a worked answer that is
 * still arriving is not a stall; a ceiling over the whole call still ends
 * one that never stops. Its requests ask OpenRouter for the provider of each
 * model that answers soonest (AGENT_VISION_PROVIDER_SORT): measured, that
 * took the primary's worst first sentence from 4.6 s to 2.4 s.
 *
 * Each model on a ladder may be told something different, and it is told it
 * after the system prompt, never in it: the picture path teaches Gemini models
 * to write places in the picture in their own order (prompt.ts placesNote), so
 * the user message is built per model, as the ladder reaches it, and the
 * system prompt is one stable block for all of them.
 *
 * What a call cost is read off its answer, never asked for: OpenRouter puts
 * its usage, with the charge in dollars, in the last chunk of every streamed
 * call. The request is the same bytes either way, so the prompt cache and the
 * request's tests are untouched by it.
 */
import { getConfig } from "../config.js";
import { openrouter } from "../pipeline/openrouter.js";
import { isReasoningRequiredError, learnReasoningRequired, lowestEffort, maxTokensWithReasoning, reasoningRequired, type Effort } from "./reasoning.js";

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

/** The system prompt for a call: a role's stable block (principles/roles.ts),
 *  the same bytes for every model. */
export type SystemPrompt = string;

/** One part of a user message that carries a picture. */
export type UserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A user message: text, or parts when it carries a picture. */
export type UserContent = string | UserPart[];

/** What a call sends after the system prompt: one message for every model, or
 *  built per model as the ladder reaches it (the picture path tells each model
 *  how places in a picture are written, in the order it is trained on). */
export type UserPrompt = UserContent | ((model: string) => UserContent);

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
  /** The part of completionTokens spent thinking, when the model reports it. */
  reasoningTokens?: number;
  /** Prompt tokens written to the provider's cache on this call, when it says. */
  cacheWriteTokens?: number;
  /** What OpenRouter charged for the call, in US dollars (its usage.cost). */
  costUsd?: number;
  /** Who served it, as OpenRouter names them: the provider, and the model as
   *  that provider calls it. Which one answered is what a slow call is
   *  usually down to. */
  provider?: string;
  served?: string;
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
  /** The picture path's provider preference, in place of
   *  AGENT_VISION_PROVIDER_SORT ("" for none). The timing script measures
   *  with and without it. */
  providerSort?: string;
}

/** Thrown when every model in the ladder failed before writing anything. */
export class PlannerUnavailable extends Error {
  constructor(readonly causeError: unknown) {
    super("every agent model failed", causeError !== undefined ? { cause: causeError } : undefined);
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
export const isGemini = (model: string) => model.startsWith("google/gemini-");

/** Gemini 3 and later: a major version of 3 or more, whatever follows it. */
const geminiMajor = (model: string) => Number(/^google\/gemini-(\d+)/.exec(model)?.[1] ?? NaN);
const isGemini3Up = (model: string) => geminiMajor(model) >= 3;

/**
 * The reasoning setting for one model: as little thinking as it allows.
 *
 * "none" is cleanup.common()'s way of saying off, and for Anthropic it comes
 * with OpenRouter's explicit off switch too, since its models think by
 * default. A model whose reasoning is mandatory (reasoning.ts: the catalog
 * says so, or the short list of those found refusing, or Gemini 3 and later and
 * 2.5 Pro, or it answered the 400 once) is NEVER sent "none" or `enabled:
 * false`: OpenRouter refuses both before a word is written, and the step paid
 * for that call before its fallback. It is sent its lowest allowed effort.
 */
export function reasoningFor(model: string): { effort: "none" | Effort; enabled?: false } {
  if (reasoningRequired(model)) return { effort: lowestEffort(model) };
  if (isAnthropic(model)) return { effort: "none", enabled: false };
  return { effort: "none" };
}

/**
 * The temperature for one model, or undefined to send none and keep its own.
 *
 * None for anthropic/*: its newest models refuse a sampling setting other
 * than the default with a 400, which on this ladder would make every step pay
 * for a failed call before the fallback. None for Gemini 3 and later either:
 * Google's guidance is to keep their default, since a low one can make them
 * loop. Every other model answers the same question the same way at 0.
 */
export function temperatureFor(model: string): number | undefined {
  return isAnthropic(model) || isGemini3Up(model) ? undefined : 0;
}

/**
 * The provider preference a request may carry: one of OpenRouter's three
 * sorts, or "" for none. Anything else ("none", a typo) is sent as no
 * preference rather than passed on: a provider field OpenRouter cannot read
 * is refused with a 400, and on the picture path that would fail every rung
 * of the ladder before a word was written, on every picture question.
 */
export function providerSortOf(value: string | undefined): "" | "latency" | "throughput" | "price" {
  const v = value?.trim().toLowerCase();
  return v === "latency" || v === "throughput" || v === "price" ? v : "";
}

/**
 * The request body for one model. Exported so the tests can hold it to the
 * contract: the same system bytes for every request, cache marking where it
 * is opt-in, as little reasoning as the model allows, and (picture path) the
 * provider preference when there is one.
 */
export function plannerRequest(
  model: string,
  system: string,
  user: UserContent,
  maxTokens = AGENT_MAX_TOKENS,
  opts: { providerSort?: string; bigger?: boolean } = {},
): Record<string, unknown> {
  const anthropic = isAnthropic(model);
  const temperature = temperatureFor(model);
  const sort = providerSortOf(opts.providerSort);
  const reasoning = reasoningFor(model);
  return {
    model,
    // OpenRouter's provider routing: among the providers serving this model,
    // the one that sorts first ("latency": soonest to its first token). And
    // only providers that neither keep nor train on what they are sent: a
    // step can carry what a connected app returned, and Google's user data
    // policy forbids it being used to train models.
    provider: { data_collection: "deny", ...(sort ? { sort } : {}) },
    stream: true,
    stream_options: { include_usage: true },
    // The thinking of a model that must think comes out of this limit too: it is given room on top of the answer's. `bigger`: the last try wrote nothing for want of it.
    max_tokens: maxTokensWithReasoning(maxTokens, reasoning, { retry: opts.bigger === true }),
    reasoning,
    ...(temperature === undefined ? {} : { temperature }),
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
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    /** OpenRouter's charge for the call, in US dollars. */
    cost?: number;
  };
  /** OpenRouter's: who served the call, and its name for the model there. */
  provider?: string;
  model?: string;
}

/**
 * The planner's text as it is written, chunk by chunk, each tagged with the
 * model writing it, so the reader knows how that model was told to write.
 * Stopping the iteration early (the step has its action) aborts the upstream
 * call, so the tokens after it are never paid for.
 *
 * `system` is one prompt for every model; `user` is one message for every
 * model, or a function that gives each model its own, so a ladder that moves
 * from Gemini to another model moves to that model's message too.
 */
export async function* planStream(system: SystemPrompt, user: UserPrompt, opts: PlanOptions = {}): AsyncGenerator<PlanChunk> {
  const cfg = getConfig();
  const picture = opts.picture;
  const models = ladder(opts.models ?? (picture ? visionLadder(picture.deep) : modelLadder()));
  const timeoutMs = opts.timeoutMs ?? (picture ? cfg.AGENT_VISION_TIMEOUT_MS : cfg.AGENT_TIMEOUT_MS);
  const maxTokens = !picture ? AGENT_MAX_TOKENS : picture.deep ? VISION_DEEP_MAX_TOKENS : VISION_MAX_TOKENS;
  // Only the picture path asks for a provider: the text path's calls are
  // short and its models were never measured slow to start.
  const providerSort = picture ? opts.providerSort ?? cfg.AGENT_VISION_PROVIDER_SORT : "";
  const userFor = typeof user === "function" ? user : () => user;
  let lastError: unknown = new Error("no agent model configured");
  // A model answered, with nothing. When the ladder runs out after that, the
  // step had nothing to say, which is not the same as no model being there.
  let answeredEmpty = false;
  // Models whose last answer ended in "length" with nothing written: each is asked once more, at once, with a larger allowance.
  const grown = new Set<string>();
  const queue = [...models];

  for (let at = 0; at < queue.length; at += 1) {
    const model = queue[at]!;
    const bigger = grown.has(model);
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
    let ranOut = false;
    try {
      const open = () => openrouter().chat.completions.create(
        plannerRequest(model, system, userFor(model), maxTokens, { providerSort, bigger }) as never,
        { signal: ctrl.signal, maxRetries: 0, timeout: timeoutMs },
      );
      let opened: unknown;
      try {
        opened = await open();
      } catch (err) {
        // "Reasoning is mandatory" from a model that was not known to need it: remembered, and asked once more at once at its lowest effort (the request reads
        // what was learned), instead of the ladder moving on. A model that was already sent a level and still gets it is not retried.
        if (!isReasoningRequiredError(err) || reasoningRequired(model)) throw err;
        learnReasoningRequired(model);
        opened = await open();
      }
      const stream = opened as AsyncIterable<StreamChunk>;
      for await (const chunk of stream) {
        if (typeof chunk.provider === "string" && chunk.provider) call.provider ??= chunk.provider;
        if (typeof chunk.model === "string" && chunk.model && chunk.model !== model) call.served ??= chunk.model;
        if (chunk.usage) {
          call.promptTokens = chunk.usage.prompt_tokens;
          call.completionTokens = chunk.usage.completion_tokens;
          call.cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens;
          const reasoning = chunk.usage.completion_tokens_details?.reasoning_tokens;
          if (typeof reasoning === "number") call.reasoningTokens = reasoning;
          const writes = chunk.usage.prompt_tokens_details?.cache_write_tokens;
          if (typeof writes === "number") call.cacheWriteTokens = writes;
          // A charge that is not a plain amount is no charge at all, not a guess.
          const cost = chunk.usage.cost;
          if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) call.costUsd = cost;
        }
        if (chunk.choices?.[0]?.finish_reason === "length") ranOut = true;
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
      // It ran out of room before a word (the thinking took the limit): the same model once more, with more room, before the ladder moves on.
      if (ranOut && !grown.has(model)) {
        grown.add(model);
        queue.splice(at + 1, 0, model);
      }
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
