/**
 * HOW LITTLE A MODEL MAY BE TOLD TO THINK: WHICH MODELS CANNOT HAVE THEIR REASONING SWITCHED OFF, AND THE LOWEST EFFORT EACH ALLOWS.
 *
 * Every call here asks for as little thinking as the model allows (a step is one line of protocol; a code tier's job is the edit, not an essay). For most
 * models that is `reasoning: { effort: "none" }` (and, for Anthropic, `enabled: false`). Some models refuse it: "Reasoning is mandatory for this
 * endpoint and cannot be disabled" is a 400 before a word is written, so a model on a ladder that answers every call that way costs one failed call per
 * step, and a ladder made of such models never works at all (the first real-model test: claude-sonnet-5.5, gpt-6.1-sol, qwen3.8-max-0902, kimi-k2.7-code,
 * minimax-m3.1-flash and glm-5.3-flash, 37 calls of 37).
 *
 * WHAT IS KNOWN, from the surest to the least:
 *
 *   learned     the model answered that exact 400 in this process (`learnReasoningRequired`): it is never sent "none" again, whatever else says
 *   catalog     OpenRouter's model list says it: `reasoning.mandatory` and `reasoning.supported_efforts` beside `supported_parameters` (which says only that the
 *               model takes a reasoning setting at all). The product has no catalog of its own; the harness (e2e/catalog.ts) and anything that reads the list
 *               hand it in with `registerReasoningCatalog`
 *   known       the short list below, for the models the first real test found refusing, and the Gemini rule (3 and later, and 2.5 Pro, cannot think "none")
 *
 * A model that requires reasoning is sent its LOWEST allowed effort: the lowest of the efforts the catalog lists for it, else "low" (a model that lists no
 * efforts takes OpenRouter's own mapping of one). A model nothing is known about is sent "none" as before, and learns from the 400.
 *
 * Nothing here reads a network, a clock or a store.
 */

/** OpenRouter's reasoning efforts, lowest first. "none" (off) is not one of them: it is the absence of thinking. */
export const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ReasoningFacts {
  /** The model takes a reasoning setting at all (OpenRouter lists `reasoning` among its supported parameters). */
  supported?: boolean;
  /** Its thinking cannot be switched off. */
  mandatory?: boolean;
  /** The efforts it accepts, "none" apart, in any order. */
  efforts?: readonly Effort[];
  /** "none" is among the efforts it accepts. */
  canBeOff?: boolean;
}

const isEffort = (e: unknown): e is Effort => (EFFORTS as readonly string[]).includes(e as string);
const rank = (e: Effort): number => EFFORTS.indexOf(e);

/** The models the first real-model test found refusing "none", with what OpenRouter's list says about their efforts that day. */
const KNOWN_REQUIRED: Readonly<Record<string, ReasoningFacts>> = {
  "anthropic/claude-sonnet-5.5": { mandatory: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  "openai/gpt-6.1-sol": { mandatory: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  "qwen/qwen3.8-max-0902": { mandatory: true, efforts: ["minimal", "low", "medium", "high", "xhigh"] },
  "moonshotai/kimi-k2.7-code": { mandatory: true },
  "minimax/minimax-m3.1-flash": { mandatory: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  "z-ai/glm-5.3-flash": { mandatory: true, efforts: ["low", "high", "max"] },
};

const geminiMajor = (model: string): number => Number(/^google\/gemini-(\d+)/.exec(model)?.[1] ?? NaN);
/** Gemini 3 and later, and 2.5 Pro: their lowest level is "low" (the rule agent/llm.ts always had, for a model the catalog does not know). */
const geminiMandatory = (model: string): boolean => geminiMajor(model) >= 3 || model.startsWith("google/gemini-2.5-pro");

const fromCatalog = new Map<string, ReasoningFacts>();
const learned = new Set<string>();

/** What OpenRouter's model list says about one model's reasoning (the `supported_parameters` and `reasoning` fields of its entry). */
export function reasoningFactsOf(raw: { supported_parameters?: readonly string[] | null; reasoning?: { mandatory?: unknown; supported_efforts?: unknown } | null }): ReasoningFacts {
  const params = raw.supported_parameters ?? [];
  const r = raw.reasoning ?? null;
  const listed = Array.isArray(r?.supported_efforts) ? (r!.supported_efforts as unknown[]) : [];
  const efforts = listed.filter(isEffort);
  return {
    supported: params.includes("reasoning") || params.includes("reasoning_effort") || params.includes("include_reasoning") || r !== null,
    ...(r && typeof r.mandatory === "boolean" ? { mandatory: r.mandatory } : {}),
    ...(efforts.length ? { efforts } : {}),
    ...(listed.includes("none") ? { canBeOff: true } : {}),
  };
}

/** Takes what a model list says (see reasoningFactsOf) for the models in it. Returns how many were taken. */
export function registerReasoningCatalog(models: Iterable<{ id: string; supported_parameters?: readonly string[] | null; reasoning?: { mandatory?: unknown; supported_efforts?: unknown } | null }>): number {
  let n = 0;
  for (const m of models) {
    if (!m || typeof m.id !== "string") continue;
    fromCatalog.set(m.id, reasoningFactsOf(m));
    n += 1;
  }
  return n;
}

/** Takes the facts for one model, as a catalog entry would give them. */
export function registerReasoning(model: string, facts: ReasoningFacts): void {
  fromCatalog.set(model, facts);
}

/** The model answered "Reasoning is mandatory": it is never sent "none" again in this process. */
export function learnReasoningRequired(model: string): void {
  learned.add(model);
}

export function resetReasoningForTests(): void {
  fromCatalog.clear();
  learned.clear();
}

/** What is known about a model: the catalog's, else the short list's. */
function factsOf(model: string): ReasoningFacts | undefined {
  return fromCatalog.get(model) ?? KNOWN_REQUIRED[model];
}

/** Whether a model's thinking cannot be switched off. */
export function reasoningRequired(model: string): boolean {
  if (learned.has(model)) return true;
  const f = factsOf(model);
  if (f?.mandatory !== undefined) return f.mandatory;
  return geminiMandatory(model);
}

/** Whether the model was learned to require reasoning from a 400 (as opposed to being known to). */
export function reasoningLearned(model: string): boolean {
  return learned.has(model);
}

/** The lowest effort a model allows: the lowest it lists, else "low". */
export function lowestEffort(model: string): Effort {
  const efforts = factsOf(model)?.efforts;
  if (!efforts?.length) return "low";
  return efforts.reduce((lo, e) => (rank(e) < rank(lo) ? e : lo));
}

/**
 * An effort a tier asks for, made one the model accepts: itself when the model lists no efforts or lists it, else the next one up, else the highest it has.
 * "low" asked of a model that starts at "medium" is "medium", not a 400.
 */
export function allowedEffort(model: string, asked: Effort): Effort {
  const efforts = factsOf(model)?.efforts;
  if (!efforts?.length || efforts.includes(asked)) return asked;
  const up = [...efforts].filter((e) => rank(e) > rank(asked)).sort((a, b) => rank(a) - rank(b))[0];
  return up ?? [...efforts].sort((a, b) => rank(b) - rank(a))[0]!;
}

// ------------------------------------------------------------- the 400

/** The 400 a model gives when it is told to switch its thinking off and cannot. Matched on the words, since OpenRouter has no code for it. */
const MANDATORY = /reasoning (?:is|are) mandatory|reasoning[^.]{0,40}cannot be (?:disabled|turned off|switched off)/i;

/** The text an SDK error carries, wherever it keeps it: its message, the body OpenRouter sent, the provider's own words under it. */
function textOf(err: unknown): string {
  const e = err as { message?: unknown; error?: unknown } | null;
  const parts: string[] = [];
  if (typeof e?.message === "string") parts.push(e.message);
  const body = e?.error as { message?: unknown; metadata?: { raw?: unknown } } | string | undefined;
  if (typeof body === "string") parts.push(body);
  else if (body && typeof body === "object") {
    if (typeof body.message === "string") parts.push(body.message);
    if (typeof body.metadata?.raw === "string") parts.push(body.metadata.raw);
  }
  return parts.join(" ");
}

/** Whether a `reasoning` setting asks for thinking to be off: "none", or Anthropic's `enabled: false`. */
export function reasoningIsOff(reasoning: unknown): boolean {
  const r = reasoning as { effort?: unknown; enabled?: unknown } | null | undefined;
  return r?.effort === "none" || r?.enabled === false;
}

/** Whether an error is that exact 400: the model requires reasoning and was told to turn it off. */
export function isReasoningRequiredError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (status !== undefined && status !== 400) return false;
  return MANDATORY.test(textOf(err));
}
