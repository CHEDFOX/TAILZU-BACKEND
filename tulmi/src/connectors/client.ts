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
import type { Args, Handoff, NativeConnector, NativeSet } from "./native.js";
import { riskOf as riskByName, type Risk } from "./risk.js";
import type { ConnectorStore } from "./store.js";

export interface Fail { code: string; message: string }

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: { type?: string; properties?: Record<string, unknown>; required?: string[] } & Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } & Record<string, unknown>;
}

export interface CallOutcome { ok: boolean; text: string; error?: Fail; open?: Handoff }

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
  /** The native connectors (src/connectors/google), by catalog id. A catalog entry with no MCP endpoint to open is served from here. */
  natives?: NativeSet;
  redirectUrl: string;
  callTimeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}

interface Held { client: Promise<Client>; used: number }

export class ConnectorHub {
  private readonly clients = new Map<string, Held>();
  private readonly toolCache = new Map<string, { at: number; tools: ToolInfo[] }>();
  /** "user|app" pairs whose last try was refused for want of a new sign-in. In memory: it clears with a restart or the next good try. */
  private readonly signIn = new Set<string>();
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
  /** The native connector behind a catalog entry, when it is one. */
  private native(def: ConnectorDef): NativeConnector | undefined {
    return def.kind === "native" ? this.o.natives?.[def.id] : undefined;
  }

  /**
   * The risk of THIS call. An MCP tool is judged by its annotations and name
   * (risk.ts); a native tool carries the risk we gave it, and may look at the
   * arguments (and the event they point at) to say more. Throws a ConnectorError
   * when it has to look and cannot.
   */
  async riskFor(userId: string, def: ConnectorDef, info: ToolInfo, args: Args): Promise<Risk> {
    const n = this.native(def);
    if (!n) return riskByName(info);
    const own = n.tools().find((t) => t.name === info.name)?.risk ?? "write";
    return (await n.riskOf?.(userId, info.name, args)) ?? own;
  }

  /** The confirm card's words for this call, when the app has better ones than the generic preview. */
  async previewFor(userId: string, def: ConnectorDef, tool: string, args: Args): Promise<string | undefined> {
    try { return await this.native(def)?.preview?.(userId, tool, args); } catch { return undefined; }
  }

  /** Whether this person's last try in the app needed them to sign in again. */
  needsSignIn(userId: string, connectorId: string): boolean { return this.signIn.has(`${userId}|${connectorId}`); }

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
    this.signIn.delete(key);
    const held = this.clients.get(key);
    this.clients.delete(key);
    await held?.client.then((c) => c.close()).catch(() => {});
  }

  /** The app's tools, from the cache when it is under five minutes old. Throws a ConnectorError. */
  async tools(userId: string, connectorId: string): Promise<ToolInfo[]> {
    const def = this.def(connectorId);
    if (!def) throw new ConnectorError("not_connected", "That app isn't available.");
    const native = this.native(def);
    if (native) return native.tools().map(({ risk: _risk, ...tool }) => tool);
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
      this.signIn.delete(key);
      return tools;
    } catch (err) {
      await this.forget(userId, connectorId);
      const f = toFail(err, def.name);
      if (f.code === "needs_reconnect") this.signIn.add(key);
      throw new ConnectorError(f.code, f.message);
    }
  }

  /** Call one tool. Never throws: a failure is the outcome's `error`. */
  async call(userId: string, connectorId: string, tool: string, args: Record<string, unknown>): Promise<CallOutcome> {
    const def = this.def(connectorId);
    if (!def) return fail({ code: "not_connected", message: "That app isn't available." });
    const native = this.native(def);
    if (native) return this.callNative(userId, def, native, tool, args);
    try {
      const client = await this.open(userId, def);
      const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: this.callMs });
      const text = resultText((res as { content?: unknown }).content).replace(/^MCP error -?\d+:\s*/, "");
      this.signIn.delete(`${userId}|${connectorId}`);
      void this.o.store.upsertConnection(userId, connectorId, { lastUsedAt: this.now() }).catch(() => {});
      if ((res as { isError?: boolean }).isError) {
        return fail({ code: "tool_error", message: text ? `${def.name} said: ${text.slice(0, 300)}` : `${def.name} couldn't do that.` });
      }
      return { ok: true, text: text || "Done." };
    } catch (err) {
      const f = toFail(err, def.name);
      // A dead connection is dropped; a refused tool name or arguments is the tool's answer.
      if (!(err instanceof McpError) || err.code === ErrorCode.RequestTimeout) await this.forget(userId, connectorId);
      if (f.code === "needs_reconnect") this.signIn.add(`${userId}|${connectorId}`);
      if (err instanceof McpError && (err.code === ErrorCode.InvalidParams || err.code === ErrorCode.MethodNotFound)) {
        return fail({ code: "rejected", message: `${def.name} didn't accept that. ${err.message.replace(/^MCP error -?\d+:\s*/, "").slice(0, 200)}` });
      }
      return fail(f);
    }
  }

  /** A native tool, held to the same twenty seconds and the same failure shape as an MCP one. */
  private async callNative(userId: string, def: ConnectorDef, native: NativeConnector, tool: string, args: Args): Promise<CallOutcome> {
    if (!native.tools().some((t) => t.name === tool)) {
      return fail({ code: "unknown_tool", message: `${def.name} doesn't have an action called ${tool.slice(0, 40)}.` });
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const out = await Promise.race([
        native.call(userId, tool, args),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ConnectorError("timeout", `${def.name} took too long to answer.`)), this.callMs);
          timer.unref?.();
        }),
      ]);
      const key = `${userId}|${def.id}`;
      this.signIn.delete(key);
      if (out.ok && def.auth !== "none") void this.o.store.upsertConnection(userId, def.id, { lastUsedAt: this.now() }).catch(() => {});
      return out;
    } catch (err) {
      const f = toFail(err, def.name);
      if (f.code === "needs_reconnect") this.signIn.add(`${userId}|${def.id}`);
      return fail(f);
    } finally {
      clearTimeout(timer);
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
