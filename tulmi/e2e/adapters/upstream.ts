/**
 * THE REAL MODEL DOOR AS AN OPENAI-SHAPED CLIENT, OVER PLAIN FETCH: OPENROUTER'S /api/v1/chat/completions.
 *
 * Used by the cassettes (to record) and the proxy. It sends what it is given, plus OpenRouter's usage accounting so that the dollar charge comes back with
 * the answer, and never streams (a stream is rebuilt from the whole answer when a caller wants one). The key comes from the argument or the environment and
 * goes only into the Authorization header of the one request; it is never logged or stored.
 */
import type { ChatClient } from "../../src/code/brain/gateway.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1";

export function openRouterClient(o: { key?: string; baseUrl?: string; fetchFn?: typeof fetch } = {}): ChatClient {
  const key = o.key ?? process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set, so the real model cannot be called");
  const f = o.fetchFn ?? fetch;
  const base = (o.baseUrl ?? OPENROUTER_URL).replace(/\/$/, "");
  return {
    chat: {
      completions: {
        async create(body: Record<string, unknown>, opts?: { signal?: AbortSignal; timeout?: number }): Promise<unknown> {
          const { stream: _s, stream_options: _o, ...rest } = body as Record<string, unknown>;
          const payload = { ...rest, usage: (rest.usage as object | undefined) ?? { include: true } };
          const signal = opts?.signal ?? (opts?.timeout ? AbortSignal.timeout(opts.timeout) : undefined);
          const res = await f(`${base}/chat/completions`, {
            method: "POST", signal: signal ?? null,
            headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "http-referer": "https://tailzu.com", "x-title": "Tailzu e2e" },
            body: JSON.stringify(payload),
          } as RequestInit);
          const text = await res.text();
          let json: unknown;
          try { json = JSON.parse(text); } catch { json = undefined; }
          if (!res.ok) {
            const msg = (json as { error?: { message?: string } } | undefined)?.error?.message ?? text.slice(0, 200);
            throw Object.assign(new Error(`OpenRouter ${res.status}: ${String(msg).slice(0, 200)}`), { status: res.status, headers: { "retry-after": res.headers.get("retry-after") ?? undefined } });
          }
          return json;
        },
      },
    },
  };
}
