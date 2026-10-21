/**
 * TALKING TO AN APP: one MCP client per (person, app).
 *
 * The client speaks the SDK's Streamable HTTP transport, signed in with that
 * person's own token (OAuth apps) or their pasted URL (Zapier-style apps).
 * Clients are kept for a while, since opening one is a handshake, and dropped
 * the moment they fail. A tool list is cached five minutes per person and app:
 * the planner asks on every step and the app's list almost never changes.
 * A call gets twenty seconds, then the person hears that it timed out.
 *
 * Every failure leaves this file as one shape, { code, message }, in plain
 * words that can be said aloud. Raw errors (a stack, a status line, a vendor's
 * JSON) never go further: the codes are
 *   not_connected  needs_reconnect  timeout  unreachable  unknown_tool
 *   rejected       tool_error       blocked  failed
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectorDef } from "./catalog.js";
import { decrypt } from "./crypto.js";
import { ConnectorError, UserOAuthProvider } from "./oauth.js";
import type { ConnectorStore } from "./store.js";

export interface Fail { code: string; message: string }

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: { type?: string; properties?: Record<string, unknown>; required?: string[] } & Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } & Record<string, unknown>;
}

export interface CallOutcome { ok: boolean; text: string; error?: Fail }

export const TOOLS_CACHE_MS = 5 * 60_000;
export const CALL_TIMEOUT_MS = 20_000;
/** A client nobody has used for this long is closed. */
const IDLE_MS = 10 * 60_000;
/** Most a result is cut to before it goes anywhere (the planner, the log). */
export const RESULT_MAX = 1500;

/** A thrown thing turned into a plain-words failure about `name`. */
export function toFail(err: unknown, name: string): Fail {
  if (err instanceof ConnectorError) {
    return err.code === "needs_reconnect" ? { code: err.code, message: `${name} needs you to sign in again.` } : { code: err.code, message: err.message };
  }
  const text = err instanceof Error ? `${err.name} ${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : String(err);
  const status = (err as { code?: unknown })?.code;
  if (err instanceof UnauthorizedError || status === 401 || status === 403) {
    return { code: "needs_reconnect", message: `${name} needs you to sign in again.` };
  }
  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
    return { code: "timeout", message: `${name} took too long to answer.` };
  }
  if (/timed? ?out|abort/i.test(text)) return { code: "timeout", message: `${name} took too long to answer.` };
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket|network|UND_ERR/i.test(text)) {
    return { code: "unreachable", message: `I couldn't reach ${name} just now.` };
  }
  return { code: "failed", message: `${name} ran into a problem.` };
}

/** The text of a tool's result, cut short; images and files are named, not carried. */
export function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts = content.map((c: { type?: string; text?: string }) =>
    c?.type === "text" && typeof c.text === "string" ? c.text : c?.type === "image" ? "[an image]" : c?.type ? `[${c.type}]` : "");
  const joined = parts.filter(Boolean).join("\n").replace(/[ \t]+\n/g, "\n").trim();
  return joined.length > RESULT_MAX ? joined.slice(0, RESULT_MAX).trimEnd() + "…" : joined;
}

export interface HubOptions {
  store: ConnectorStore;
  /** The enabled catalog. */
  catalog: readonly ConnectorDef[];
  redirectUrl: string;
  callTimeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}

interface Held { client: Promise<Client>; used: number }

export class ConnectorHub {
  private readonly clients = new Map<string, Held>();
  private readonly toolCache = new Map<string, { at: number; tools: ToolInfo[] }>();
  private readonly callMs: number;
  private readonly cacheMs: number;
  private readonly now: () => number;

  constructor(private readonly o: HubOptions) {
    this.callMs = o.callTimeoutMs ?? CALL_TIMEOUT_MS;
    this.cacheMs = o.cacheMs ?? TOOLS_CACHE_MS;
    this.now = o.now ?? Date.now;
  }

  get catalog(): readonly ConnectorDef[] { return this.o.catalog; }
  def(id: string): ConnectorDef | undefined { return this.o.catalog.find((c) => c.id === id); }

  private open(userId: string, def: ConnectorDef): Promise<Client> {
    const key = `${userId}|${def.id}`;
    const t = this.now();
    for (const [k, h] of this.clients) {
      if (t - h.used > IDLE_MS) { this.clients.delete(k); void h.client.then((c) => c.close()).catch(() => {}); }
    }
    const held = this.clients.get(key);
    if (held) { held.used = t; return held.client; }
    const client = this.connect(userId, def);
    this.clients.set(key, { client, used: t });
    client.catch(() => { if (this.clients.get(key)?.client === client) this.clients.delete(key); });
    return client;
  }

  private async connect(userId: string, def: ConnectorDef): Promise<Client> {
    const conn = await this.o.store.getConnection(userId, def.id);
    if (!conn?.tokensEnc) throw new ConnectorError("not_connected", `${def.name} isn't connected.`);
    let transport: StreamableHTTPClientTransport;
    if (def.auth === "url") {
      const { url } = JSON.parse(decrypt(conn.tokensEnc)) as { url: string };
      transport = new StreamableHTTPClientTransport(new URL(url));
    } else {
      const provider = new UserOAuthProvider(this.o.store, userId, def.id, this.o.redirectUrl, false);
      transport = new StreamableHTTPClientTransport(new URL(def.url), { authProvider: provider });
    }
    const client = new Client({ name: "tailzu", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport, { timeout: this.callMs });
    return client;
  }

  /** Let go of the client and the cached tools: after a disconnect or a new sign-in. */
  async forget(userId: string, connectorId: string): Promise<void> {
    const key = `${userId}|${connectorId}`;
    this.toolCache.delete(key);
    const held = this.clients.get(key);
    this.clients.delete(key);
    await held?.client.then((c) => c.close()).catch(() => {});
  }

  /** The app's tools, from the cache when it is under five minutes old. Throws a ConnectorError. */
  async tools(userId: string, connectorId: string): Promise<ToolInfo[]> {
    const def = this.def(connectorId);
    if (!def) throw new ConnectorError("not_connected", "That app isn't available.");
    const key = `${userId}|${connectorId}`;
    const hit = this.toolCache.get(key);
    if (hit && this.now() - hit.at < this.cacheMs) return hit.tools;
    try {
      const client = await this.open(userId, def);
      const tools: ToolInfo[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const res = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.callMs });
        tools.push(...(res.tools as unknown as ToolInfo[]));
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      this.toolCache.set(key, { at: this.now(), tools });
      return tools;
    } catch (err) {
      await this.forget(userId, connectorId);
      const f = toFail(err, def.name);
      throw new ConnectorError(f.code, f.message);
    }
  }

  /** Call one tool. Never throws: a failure is the outcome's `error`. */
  async call(userId: string, connectorId: string, tool: string, args: Record<string, unknown>): Promise<CallOutcome> {
    const def = this.def(connectorId);
    if (!def) return fail({ code: "not_connected", message: "That app isn't available." });
    try {
      const client = await this.open(userId, def);
      const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: this.callMs });
      const text = resultText((res as { content?: unknown }).content).replace(/^MCP error -?\d+:\s*/, "");
      void this.o.store.upsertConnection(userId, connectorId, { lastUsedAt: this.now() }).catch(() => {});
      if ((res as { isError?: boolean }).isError) {
        return fail({ code: "tool_error", message: text ? `${def.name} said: ${text.slice(0, 300)}` : `${def.name} couldn't do that.` });
      }
      return { ok: true, text: text || "Done." };
    } catch (err) {
      const f = toFail(err, def.name);
      // A dead connection is dropped; a refused tool name or arguments is the tool's answer.
      if (!(err instanceof McpError) || err.code === ErrorCode.RequestTimeout) await this.forget(userId, connectorId);
      if (err instanceof McpError && (err.code === ErrorCode.InvalidParams || err.code === ErrorCode.MethodNotFound)) {
        return fail({ code: "rejected", message: `${def.name} didn't accept that. ${err.message.replace(/^MCP error -?\d+:\s*/, "").slice(0, 200)}` });
      }
      return fail(f);
    }
  }

  async close(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    this.toolCache.clear();
    await Promise.all(all.map((h) => h.client.then((c) => c.close()).catch(() => {})));
  }
}

const fail = (error: Fail): CallOutcome => ({ ok: false, text: "", error });
