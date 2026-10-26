/**
 * A MINIMAL CHROME DEVTOOLS PROTOCOL CLIENT.
 *
 * Chrome started with --remote-debugging-port=0 serves CDP over a WebSocket.
 * This is the whole client: send a command and get its answer (every command
 * has an id and a timeout), listen for events, and talk to a page through a
 * flattened session (Target.attachToTarget with flatten:true), where the
 * page's commands travel over the same socket tagged with a sessionId. No
 * Playwright, no Puppeteer, no package at all.
 *
 * The WebSocket is the platform's (globalThis.WebSocket, Node 22 and up); on
 * Node 20, which has none by default, undici's, which the server already
 * depends on.
 *
 * Free of the app on purpose (no config, no logging): this folder is meant to be
 * bundled into other programs later (browser/index.ts says where).
 */

export type CdpErrorCode = "connect" | "closed" | "timeout" | "protocol";

export class CdpError extends Error {
  constructor(readonly code: CdpErrorCode, message: string, readonly method?: string) {
    super(message);
    this.name = "CdpError";
  }
}

/** The part of a WebSocket this file uses; Node's and undici's both have it. */
interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: { data?: unknown; message?: string }) => void): void;
}
type WsCtor = new (url: string) => WsLike;

async function webSocketCtor(): Promise<WsCtor> {
  const own = (globalThis as { WebSocket?: WsCtor }).WebSocket;
  if (own) return own;
  const { WebSocket } = await import("undici");
  return WebSocket as unknown as WsCtor;
}

/** An event's params, and the session it came from (none: the browser itself). */
export type CdpListener = (params: any, sessionId?: string) => void;

/** One attached page: the client, with its commands and events tagged for one session. */
export interface CdpSession {
  readonly sessionId: string;
  send<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  /** Listens for this method from this session only. Returns the way to stop. */
  on(method: string, fn: (params: any) => void): () => void;
}

export const CDP_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

const OPEN = 1;

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<CdpListener>>();
  private readonly closers = new Set<() => void>();
  private shut = false;

  private constructor(private readonly ws: WsLike) {
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    ws.addEventListener("close", () => this.onClose());
    ws.addEventListener("error", () => { /* a failed socket closes next, and that is what ends things */ });
  }

  /** Connects to a ws:// address (the one Chrome prints). */
  static async connect(url: string, o: { timeoutMs?: number } = {}): Promise<CdpClient> {
    const Ctor = await webSocketCtor();
    const ws = new Ctor(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new CdpError("connect", "the DevTools socket did not open")); try { ws.close(); } catch { /* already gone */ } }, o.timeoutMs ?? 10_000);
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new CdpError("connect", "the DevTools socket failed to open")); });
      ws.addEventListener("close", () => { clearTimeout(timer); reject(new CdpError("connect", "the DevTools socket closed before it opened")); });
    });
    return new CdpClient(ws);
  }

  get closed(): boolean { return this.shut; }

  /** Runs `fn` once, when the connection ends (Chrome exited, or close() was called). */
  onClosed(fn: () => void): void {
    if (this.shut) fn(); else this.closers.add(fn);
  }

  /**
   * One command. Resolves with its result; rejects with CdpError "protocol"
   * (Chrome said no), "timeout" (no answer in time) or "closed" (the
   * connection ended first).
   */
  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs: number = CDP_TIMEOUT_MS): Promise<T> {
    if (this.shut || this.ws.readyState !== OPEN) return Promise.reject(new CdpError("closed", "the DevTools connection is closed", method));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError("timeout", `${method} got no answer`, method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CdpError("closed", "the DevTools connection is closed", method));
      }
    });
  }

  /** Listens for an event from any session. Returns the way to stop. */
  on(method: string, fn: CdpListener): () => void {
    let set = this.listeners.get(method);
    if (!set) { set = new Set(); this.listeners.set(method, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  /** Attaches to a page (target) with a flattened session. */
  async attach(targetId: string): Promise<CdpSession> {
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    return {
      sessionId,
      send: (method, params, timeoutMs) => this.send(method, params, sessionId, timeoutMs),
      on: (method, fn) => this.on(method, (p, sid) => { if (sid === sessionId) fn(p); }),
    };
  }

  /** Ends the connection. Commands still waiting fail with "closed". */
  close(): void {
    if (this.shut) return;
    try { this.ws.close(); } catch { /* already gone */ }
    this.onClose();
  }

  private onMessage(data: unknown): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown; sessionId?: string };
    try {
      msg = JSON.parse(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8"));
    } catch {
      return; // not ours to interpret
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new CdpError("protocol", `${p.method}: ${msg.error.message ?? "failed"}`, p.method));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (typeof msg.method !== "string") return;
    const set = this.listeners.get(msg.method);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(msg.params, msg.sessionId); } catch { /* one bad listener does not stop the rest */ }
    }
  }

  private onClose(): void {
    if (this.shut) return;
    this.shut = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new CdpError("closed", "the DevTools connection closed", p.method));
      this.pending.delete(id);
    }
    for (const fn of this.closers) { try { fn(); } catch { /* ignore */ } }
    this.closers.clear();
    this.listeners.clear();
  }
}
