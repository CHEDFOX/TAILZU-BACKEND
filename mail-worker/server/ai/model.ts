// Our AI, for every business (nobody brings a key): OpenRouter's chat completions with the platform's key, best model first
// (MAIL_MODELS). A model that fails (down, slow, rate-limited, an answer that is not the JSON asked for) hands the same request to the
// next; a refused key stops at once, since every model shares it. "model@low" sets its thinking effort, so a thinking model does not
// spend the answer's length on thinking. What each answer cost comes back from OpenRouter (usage.cost, in US dollars) for the log and the
// business's daily allowance. Replaces Xooteq Mail's providers (dashboard/server/ai/providers.ts, openai.ts, anthropic.ts); the JSON
// reading below is theirs.
import { config } from "../config.ts";

export type CompleteRequest = {
  system: string;
  user: string;
  /** JSON Schema the answer must follow (an object). */
  schema: Record<string, unknown>;
  /** At most this many tokens in the answer (thinking included). */
  maxTokens?: number;
};
export type CompleteResult = { data: unknown; model: string; costUsd: number };

/** A failure worth saying as it is. */
export class AiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { cost?: number };
  error?: { message?: string };
};

/** "anthropic/claude-sonnet-5.5@low" -> the model and its effort. */
export function splitModel(m: string): { model: string; effort?: string } {
  const at = m.lastIndexOf("@");
  const effort = at > 0 ? m.slice(at + 1) : "";
  return /^(minimal|low|medium|high)$/.test(effort) ? { model: m.slice(0, at), effort } : { model: m };
}

/** The JSON object in a model's text answer, with or without a code fence around it. (Xooteq Mail's.) */
export function parseJsonAnswer(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new AiError("The model did not answer in the expected format.");
  }
}

let fetchFn: Fetch = (url, init) => fetch(url, init);
/** Tests stand the network in. */
export function useFetch(f: Fetch): void { fetchFn = f; }

async function once(model: string, req: CompleteRequest): Promise<CompleteResult> {
  const { model: id, effort } = splitModel(model);
  const body = {
    model: id,
    messages: [
      { role: "system", content: `${req.system}\n\nAnswer with one JSON object only, following this JSON Schema:\n${JSON.stringify(req.schema)}` },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_object" },
    max_tokens: req.maxTokens ?? 3000,
    usage: { include: true },
    ...(effort ? { reasoning: { effort } } : {}),
  };
  let res: { status: number; json(): Promise<unknown> };
  try {
    res = await fetchFn(`${config.openrouterUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.openrouterKey}`, "x-title": "X0 Bot mail" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new AiError(`the model could not be reached (${(e as Error).message})`, 503);
  }
  const json = (await res.json().catch(() => ({}))) as ChatResponse;
  if (res.status === 401 || res.status === 403) throw new AiError("the AI key was refused", res.status);
  if (res.status < 200 || res.status >= 300) throw new AiError(`the model answered ${res.status}${json.error?.message ? `: ${json.error.message}` : ""}`, res.status);
  const choice = json.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("the model declined to write this reply");
  const text = choice?.message?.content ?? "";
  if (!text) throw new AiError("the model sent back an empty answer");
  return { data: parseJsonAnswer(text), model: json.model ?? id, costUsd: Number(json.usage?.cost ?? 0) || 0 };
}

/** The answer from the first model in the chain that gives one. */
export async function complete(req: CompleteRequest, models: string[] = config.models): Promise<CompleteResult> {
  if (!config.openrouterKey) throw new AiError("the AI is not set up on this server (OPENROUTER_API_KEY)");
  let last: unknown = new AiError("no model is set (MAIL_MODELS)");
  for (const m of models) {
    try {
      return await once(m, req);
    } catch (e) {
      last = e;
      if (e instanceof AiError && (e.status === 401 || e.status === 403)) break;
    }
  }
  throw last instanceof AiError ? last : new AiError(String((last as Error)?.message ?? last));
}
