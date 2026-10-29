/**
 * TALKING TO AN APP: one MCP client per (person, app).
 *
 * The client speaks the SDK's Streamable HTTP transport, signed in with that
 * person's own token (OAuth apps) or their pasted URL (Zapier-style apps).
 * Every request leaves through egress.ts (public https addresses only, an
 * answer capped at 1 MiB), for every app: the catalog's addresses are ours,
 * but the ones their sign-in discovers are the vendor's to name. A sign-in the
 * SDK starts from inside a call (a 401: discovery, a token refresh) gets a
 * sign-in's ten seconds and 256 KiB instead (endpointFetch).
 * Clients are kept for a while, since opening one is a handshake, and dropped
 * the moment they fail. A tool list is cached five minutes per person and app:
 * the planner asks on every step and the app's list almost never changes.
 * A call gets twenty seconds, then the person hears that it timed out.
 *
 * Apps a person added by link (catalog.ts customDef) are found by `resolve`,
 * which looks in the catalog first and then in that person's own rows (kept a
 * minute). Their tool lists are cleaned and pinned (hygiene.ts) before anyone
 * sees them, and the planner is handed only the tools the person has accepted
 * and not switched off. One whose server asked for no sign-in is opened with
 * no auth provider at all: there is no token to send it.
 *
 * Every failure leaves this file as one shape, { code, message }, in plain
 * words that can be said aloud. Raw errors (a stack, a status line, a vendor's
 * JSON) never go further: the codes are
 *   not_connected  needs_reconnect  timeout  unreachable  unknown_tool
 *   rejected       tool_error       blocked  failed       blocked_address
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, LATEST_PROTOCOL_VERSION, McpError } from "@modelcontextprotocol/sdk/types.js";
import { customDef, type ConnectorDef } from "./catalog.js";
import { decrypt, encrypt } from "./crypto.js";
import { deviceToolInfos } from "./device.js";
import { EgressRefused, mcpFetch, oauthFetch, type FetchLike } from "./egress.js";
import { acceptPatch, cleanTools, pinList, reviewTools, visibleTools } from "./hygiene.js";
import { ConnectorError, providerOptions, UserOAuthProvider, type SignInConfig } from "./oauth.js";
import type { Args, Handoff, NativeConnector, NativeSet } from "./native.js";
import { riskOf as riskByName, type Risk } from "./risk.js";
import { CUSTOM_ID, type Connection, type ConnectorStore, type ToolsPin } from "./store.js";

export interface Fail { code: string; message: string }

export interface ToolInfo {
  name: string;
  /** A display name the server may give (MCP 2025-06-18 and later). */
  title?: string;
  description?: string;
  inputSchema: { type?: string; properties?: Record<string, unknown>; required?: string[] } & Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } & Record<string, unknown>;
}

export interface CallOutcome { ok: boolean; text: string; error?: Fail; open?: Handoff }

export const TOOLS_CACHE_MS = 5 * 60_000;
/** How long a person's own apps are kept before they are read again. */
export const CUSTOM_CACHE_MS = 60_000;
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
  if (err instanceof EgressRefused) {
    return err.reason === "too_large"
      ? { code: "failed", message: `${name} sent back more than I can take.` }
      : { code: "blocked_address", message: `${name} is at an address X0 Bot won't connect to.` };
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

/**
 * A pasted link's request: the address, with a `?token=` it carries moved
 * into an Authorization header. The MCP spec keeps tokens out of query
 * strings (they end up in logs) and Zapier takes the header as well; what is
 * stored stays the link exactly as it was pasted.
 */
export function bearerFromUrl(pasted: URL): { url: URL; headers?: Record<string, string> } {
  const token = pasted.searchParams.get("token");
  if (!token) return { url: pasted };
  const url = new URL(pasted);
  url.searchParams.delete("token");
  return { url, headers: { Authorization: `Bearer ${token}` } };
}

/**
 * The fetch an OAuth app's transport is given. The SDK signs in again through
 * the transport's own fetch (on a 401 it runs discovery and the token refresh
 * with it, and with no signal to cancel them), so the transport cannot simply
 * be handed `mcp`: a sign-in request has to get a sign-in's limits, ten
 * seconds and 256 KiB (`signIn`), not an MCP answer's. Only the app's own
 * endpoint, and the same-origin redirects it answers with (the SDK follows
 * those), go through `mcp`; every other address is part of signing in.
 */
export function endpointFetch(endpoint: URL, mcp: FetchLike, signIn: FetchLike): FetchLike {
  const own = new Set([endpoint.href]);
  return async (input, init) => {
    const url = new URL(String(input));
    if (!own.has(url.href)) return signIn(input, init);
    const res = await mcp(input, init);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location && own.size < 8) {
      try { const next = new URL(location, url); if (next.origin === url.origin) own.add(next.href); } catch { /* not an address: the SDK will not follow it either */ }
    }
    return res;
  };
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
  /** Apps people added by link are switched on (CUSTOM_CONNECTORS). Off: their rows are not read, so they are not there. */
  custom?: boolean;
  /** The native connectors (src/connectors/google), by catalog id. A catalog entry with no MCP endpoint to open is served from here. */
  natives?: NativeSet;
  redirectUrl: string;
  /** Who Tailzu is to the vendors' sign-in (CIMD, pre-registered clients). */
  signIn?: SignInConfig;
  /** Every request to an MCP app's own endpoint. Default: mcpFetch (egress.ts). */
  fetch?: FetchLike;
  /** The sign-in requests the SDK makes from inside a call (discovery, a token refresh). Default: oauthFetch (egress.ts). */
  signInFetch?: FetchLike;
  callTimeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}

interface Held { client: Promise<Client>; used: number }
/** A fetched tool list; for an app added by link, cleaned and with its pin worked out once. */
interface Listed { at: number; tools: ToolInfo[]; pins?: ToolsPin }

/** An app whose server asked for no sign-in has no token to keep: this, encrypted like one, is what marks it connected. */
export const authlessMark = (): string => encrypt(JSON.stringify({ authless: true }));

export class ConnectorHub {
  private readonly clients = new Map<string, Held>();
  private readonly toolCache = new Map<string, Listed>();
  /** userId -> that person's own apps, read at most once a minute. */
  private readonly customs = new Map<string, { at: number; defs: ConnectorDef[] }>();
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
  /** A catalog app. For anything a person's id is known for, use resolve(): it finds their own apps too. */
  def(id: string): ConnectorDef | undefined { return this.o.catalog.find((c) => c.id === id); }

  /** The catalog app, else this person's own app by that id (kept a minute), else nothing. */
  async resolve(userId: string, id: string): Promise<ConnectorDef | undefined> {
    const known = this.def(id);
    if (known || !this.o.custom || !CUSTOM_ID.test(id)) return known;
    return (await this.customApps(userId)).find((d) => d.id === id);
  }

  /** This person's own apps, as ConnectorDefs. Empty while they are switched off. */
  async customApps(userId: string): Promise<ConnectorDef[]> {
    if (!this.o.custom) return [];
    const hit = this.customs.get(userId);
    if (hit && this.now() - hit.at < CUSTOM_CACHE_MS) return hit.defs;
    const defs = (await this.o.store.listCustom(userId)).map(customDef);
    this.customs.set(userId, { at: this.now(), defs });
    if (this.customs.size > 5000) this.customs.delete(this.customs.keys().next().value!);
    return defs;
  }

  /** Read this person's own apps again next time: one was added, removed, or tied to its auth server. */
  forgetCustom(userId: string): void { this.customs.delete(userId); }

  /** The native connector behind a catalog entry, when it is one. */
  private native(def: ConnectorDef): NativeConnector | undefined {
    return def.kind === "native" ? this.o.natives?.[def.id] : undefined;
  }

  /** A tool's risk without looking at any arguments: a native tool's own, an MCP tool's by its annotations and name. */
  toolRisk(def: ConnectorDef, info: ToolInfo): Risk {
    const n = this.native(def);
    return n ? n.tools().find((t) => t.name === info.name)?.risk ?? "write" : riskByName(info);
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

  /**
   * The confirm card's words for this call, when the app has better ones than
   * the generic preview. Throws when the app finds the call cannot be done (a
   * "rejected" ConnectorError: no such task, no title), so that is said now
   * and not after a yes; any other failure falls back to the generic preview.
   */
  async previewFor(userId: string, def: ConnectorDef, tool: string, args: Args): Promise<string | undefined> {
    try {
      return await this.native(def)?.preview?.(userId, tool, args);
    } catch (e) {
      if (e instanceof ConnectorError && e.code === "rejected") throw e;
      return undefined;
    }
  }

  /** A tool whose link opens only on a phone (a call, a text, a UPI payment). */
  phoneOnly(connectorId: string, tool: string): boolean {
    const def = this.def(connectorId);
    const n = def && this.native(def);
    return !!n?.tools().find((t) => t.name === tool)?.phoneOnly;
  }

  /** Whether a hand-off's recipient, when the call names one, is in the person's own words (NativeConnector.recipientSaid). */
  recipientSaid(connectorId: string, tool: string, args: Args, words: string): boolean {
    const def = this.def(connectorId);
    const n = def && this.native(def);
    return n?.recipientSaid?.(tool, args, words) ?? true;
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
    const fetch = this.o.fetch ?? mcpFetch;
    let transport: StreamableHTTPClientTransport;
    if (def.auth === "url") {
      const { url } = JSON.parse(decrypt(conn.tokensEnc)) as { url: string };
      const req = bearerFromUrl(new URL(url));
      transport = new StreamableHTTPClientTransport(req.url, { fetch, ...(req.headers ? { requestInit: { headers: req.headers } } : {}) });
    } else if (def.custom?.authless) {
      // It asked nobody to sign in: there is no token to send it, and no auth server to send anyone to.
      transport = new StreamableHTTPClientTransport(new URL(def.url), { fetch });
    } else {
      const provider = new UserOAuthProvider(this.o.store, userId, def.id, this.o.redirectUrl, false, providerOptions(this.o.signIn ?? {}, def));
      const endpoint = new URL(def.url);
      transport = new StreamableHTTPClientTransport(endpoint, { authProvider: provider, fetch: endpointFetch(endpoint, fetch, this.o.signInFetch ?? oauthFetch) });
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

  /**
   * The tools the planner may use, from the cache when it is under five
   * minutes old. For an app added by link: cleaned, checked against the pin,
   * and only the accepted ones not switched off. Throws a ConnectorError.
   */
  async tools(userId: string, connectorId: string): Promise<ToolInfo[]> {
    const def = await this.resolve(userId, connectorId);
    if (!def) throw new ConnectorError("not_connected", "That app isn't available.");
    if (def.kind === "device") return deviceToolInfos();
    const native = this.native(def);
    if (native) return native.tools().map(({ risk: _risk, phoneOnly: _phone, ...tool }) => tool);
    const listed = await this.listed(userId, def);
    if (!def.custom) return listed.tools;
    return visibleTools(listed.tools, await this.reviewed(userId, def, listed));
  }

  /**
   * Every tool, for the person's own look at them (the per-tool sheet):
   * changed and switched-off ones included, with the connection as it stands
   * after this list was checked against the pin. `version` names this exact
   * list, for an accept to say what it accepted. `fresh` asks the app again
   * instead of taking the cached list: what the person reviews is what is there.
   */
  async toolSheet(userId: string, def: ConnectorDef, o: { fresh?: boolean } = {}): Promise<{ tools: ToolInfo[]; conn: Connection | null; version?: string }> {
    const native = this.native(def);
    if (native) return { tools: native.tools().map(({ risk: _risk, phoneOnly: _phone, ...tool }) => tool), conn: await this.o.store.getConnection(userId, def.id) };
    const listed = await this.listed(userId, def, o.fresh);
    if (!def.custom) return { tools: listed.tools, conn: await this.o.store.getConnection(userId, def.id) };
    return { tools: listed.tools, conn: await this.reviewed(userId, def, listed), version: listed.pins!.list };
  }

  /**
   * The person accepted the tools as they are now: pin them, and let the
   * changed ones back in front of the planner. When `version` is given and
   * the list has moved on since, nothing is accepted (false).
   */
  async acceptTools(userId: string, def: ConnectorDef, version?: string): Promise<boolean> {
    const listed = await this.listed(userId, def);
    const now = listed.pins ?? pinList(listed.tools);
    if (version !== undefined && version !== now.list) return false;
    await this.o.store.upsertConnection(userId, def.id, acceptPatch(listed.tools, now));
    return true;
  }

  /** A custom app's connection, its pin brought up to date with this list. */
  private async reviewed(userId: string, def: ConnectorDef, listed: Listed): Promise<Connection> {
    const conn = await this.o.store.getConnection(userId, def.id);
    if (!conn?.tokensEnc) throw new ConnectorError("not_connected", `${def.name} isn't connected.`);
    const patch = reviewTools(listed.tools, conn, listed.pins);
    return patch ? this.o.store.upsertConnection(userId, def.id, patch) : conn;
  }

  /** The app's whole tool list, from the cache unless `fresh` (cleaned, for an app added by link). Throws a ConnectorError. */
  private async listed(userId: string, def: ConnectorDef, fresh = false): Promise<Listed> {
    const key = `${userId}|${def.id}`;
    const hit = this.toolCache.get(key);
    if (hit && !fresh && this.now() - hit.at < this.cacheMs) return hit;
    try {
      const client = await this.open(userId, def);
      const raw: unknown[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const res = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.callMs });
        raw.push(...res.tools);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      const tools = def.custom ? cleanTools(raw) : (raw as ToolInfo[]);
      const listed: Listed = { at: this.now(), tools, ...(def.custom ? { pins: pinList(tools) } : {}) };
      this.toolCache.set(key, listed);
      this.signIn.delete(key);
      return listed;
    } catch (err) {
      await this.forget(userId, def.id);
      const f = toFail(err, def.name);
      if (f.code === "needs_reconnect") this.signIn.add(key);
      throw new ConnectorError(f.code, f.message);
    }
  }

  /** Call one tool. Never throws: a failure is the outcome's `error`. */
  async call(userId: string, connectorId: string, tool: string, args: Record<string, unknown>): Promise<CallOutcome> {
    const def = await this.resolve(userId, connectorId).catch(() => undefined);
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
    this.customs.clear();
    await Promise.all(all.map((h) => h.client.then((c) => c.close()).catch(() => {})));
  }
}

const fail = (error: Fail): CallOutcome => ({ ok: false, text: "", error });

/**
 * What an address a person pasted turns out to be, by asking it to start an
 * MCP session with no credentials: "oauth" when it answers 401 (the only
 * signal the spec gives that a sign-in is wanted, and the one Claude starts
 * from), "none" when it simply answers. Anything else is not an app we can
 * connect to. Through egress.ts like every request: ten seconds, 256 KiB.
 */
export async function probeMcp(url: URL, name: string, fetchFn: FetchLike = oauthFetch): Promise<"oauth" | "none"> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 0, method: "initialize",
        params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "tailzu", version: "1.0.0" } },
      }),
    });
  } catch (err) {
    const f = toFail(err, name);
    throw new ConnectorError(f.code, f.code === "unreachable" ? `I couldn't reach ${name} at that address.` : f.message);
  }
  await res.body?.cancel().catch(() => {});
  if (res.status === 401) return "oauth";
  if (res.ok) return "none";
  throw new ConnectorError("not_mcp", `That address didn't answer like an app X0 Bot can connect to.`);
}
