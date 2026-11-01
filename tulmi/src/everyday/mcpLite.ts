/**
 * A PUBLIC MCP SERVER, ASKED ONE THING: the smallest Streamable HTTP client for a server that needs no sign-in (Kiwi.com's flights,
 * trivago's stays). initialize, then one tools/call, then done; the session is not kept (they are cheap, and a kept one goes stale).
 *
 * What comes back is DATA: the structured result when the server gives one, else the text. A server's own words for the model ("render
 * a table", "end with a fun fact") are never passed on; everyday/*.ts reads the fields it needs and nothing else.
 */
export type FetchFn = typeof fetch;

export class McpLiteError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "McpLiteError";
  }
}

const PROTOCOL = "2025-06-18";

/** A JSON-RPC answer, from a plain JSON body or the last `data:` line of an event stream. */
function readBody(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return null;
  const json = t.startsWith("{") ? t : t.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean).pop();
  if (!json) return null;
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return null; }
}

export interface CallResult {
  /** The server's structuredContent, when it gave one. */
  structured: unknown;
  /** Its text parts, joined. */
  text: string;
  isError: boolean;
}

export async function callTool(url: string, tool: string, args: Record<string, unknown>, o: { fetch?: FetchFn; timeoutMs?: number; userAgent?: string } = {}): Promise<CallResult> {
  const f = o.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 25_000);
  (timer as { unref?: () => void }).unref?.();
  const post = async (body: unknown, session?: string | null) => {
    const r = await f(url, {
      method: "POST", signal: ctl.signal,
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL,
        "user-agent": o.userAgent ?? "X0Bot/1.0 (+https://x0bot.com)", ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, session: r.headers.get("mcp-session-id"), body: readBody(await r.text()) };
  };
  try {
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "x0bot", version: "1.0" } } });
    if (init.status >= 400 || !init.body || init.body.error) throw new McpLiteError(`initialize failed (${init.status})`, init.status);
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, init.session).catch(() => undefined);
    const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }, init.session);
    if (r.status >= 400 || !r.body) throw new McpLiteError(`${tool} failed (${r.status})`, r.status);
    if (r.body.error) throw new McpLiteError(`${tool}: ${String((r.body.error as { message?: unknown }).message ?? "error").slice(0, 200)}`);
    const result = (r.body.result ?? {}) as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown; isError?: boolean };
    const text = (result.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text!).join("\n");
    return { structured: result.structuredContent ?? null, text, isError: result.isError === true };
  } catch (err) {
    if (err instanceof McpLiteError) throw err;
    throw new McpLiteError((err as Error)?.name === "AbortError" ? `${tool} took too long` : `${tool} could not be reached`);
  } finally {
    clearTimeout(timer);
  }
}
