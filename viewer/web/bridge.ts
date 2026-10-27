/**
 * `window.tailzu`: what an artifact can ask of the app. Each call becomes a message to the parent (which holds the person's
 * session and talks to the API as them) and resolves when the matching `*-result` comes back. The viewer itself holds no
 * token and no storage.
 *
 *   tailzu.storage.get(key, { shared })            → value | null
 *   tailzu.storage.set(key, value, { shared })     → void          (value: anything JSON can hold, up to LIMITS.storageValueBytes)
 *   tailzu.storage.delete(key, { shared })         → void
 *   tailzu.storage.list(prefix?, { shared })       → string[]
 *   tailzu.ask(prompt)                             → string        (the bot's answer; metered against the person)
 *   tailzu.download(name, mime, data)              → void          (data: string | Blob | ArrayBuffer | typed array)
 *
 * The limits of protocol.ts are checked here first, so a runaway artifact is stopped before it reaches the parent; the
 * parent and the server enforce them again.
 */
import { LIMITS, PROTOCOL_VERSION, type FrameMsg, type HostMsg } from "../../tulmi/src/artifacts/protocol.js";
import { utf8Length } from "../lib/text.js";

export interface StorageOptions {
  shared?: boolean;
}

export interface TailzuApi {
  readonly version: number;
  readonly storage: {
    get(key: string, opts?: StorageOptions): Promise<unknown>;
    set(key: string, value: unknown, opts?: StorageOptions): Promise<void>;
    delete(key: string, opts?: StorageOptions): Promise<void>;
    list(prefix?: string, opts?: StorageOptions): Promise<string[]>;
  };
  ask(prompt: string): Promise<string>;
  download(name: string, mime: string, data: string | Blob | ArrayBuffer | ArrayBufferView): Promise<void>;
}

type Result = Extract<HostMsg, { t: "storage-result" | "ask-result" }>;

interface Pending {
  resolve(r: Result): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_PENDING = 64;
const STORAGE_TIMEOUT_MS = 20_000;
const ASK_TIMEOUT_MS = 180_000;
const MAX_KEY_CHARS = 256;

export interface Bridge {
  api: TailzuApi;
  /** A `storage-result` / `ask-result` from the parent. */
  handle(m: Result): void;
  /** A different artifact is now shown: calls still waiting are over. */
  reset(): void;
}

export function createBridge(post: (m: FrameMsg) => void, limitHit: (message: string) => void): Bridge {
  const pending = new Map<string, Pending>();
  const nonce = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  // Keys this artifact is known to have, for the key-count limit (the server holds the real count).
  const known = { private: new Set<string>(), shared: new Set<string>() };

  const fail = (message: string): Promise<never> => {
    limitHit(message);
    return Promise.reject(new Error(message));
  };

  const request = (msg: (reqId: string) => FrameMsg, timeoutMs: number): Promise<Result> => {
    if (pending.size >= MAX_PENDING) return Promise.reject(new Error("Too many requests are waiting for the app."));
    const reqId = `${nonce}-${++seq}`;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("The app did not answer in time."));
      }, timeoutMs);
      pending.set(reqId, { resolve, reject, timer });
      try {
        post(msg(reqId));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(reqId);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };

  const checkKey = (key: unknown): string | null => {
    if (typeof key !== "string" || key.length === 0) return "Storage keys must be non-empty strings.";
    if (key.length > MAX_KEY_CHARS) return `Storage keys can be at most ${MAX_KEY_CHARS} characters.`;
    return null;
  };

  const scope = (opts?: StorageOptions) => (opts?.shared ? "shared" : "private");

  const storageOp = async (op: "get" | "set" | "delete" | "list", key: string | undefined, value: unknown, opts?: StorageOptions): Promise<Result & { t: "storage-result" }> => {
    const shared = !!opts?.shared;
    const r = await request((reqId) => ({ t: "storage", reqId, op, ...(key !== undefined ? { key } : {}), ...(op === "set" ? { value } : {}), shared }), STORAGE_TIMEOUT_MS);
    if (r.t !== "storage-result") throw new Error("Unexpected answer.");
    if (!r.ok) throw new Error(r.error || "Storage failed.");
    return r;
  };

  const api: TailzuApi = Object.freeze({
    version: PROTOCOL_VERSION,
    storage: Object.freeze({
      async get(key: string, opts?: StorageOptions) {
        const bad = checkKey(key);
        if (bad) throw new Error(bad);
        const r = await storageOp("get", key, undefined, opts);
        return r.value === undefined ? null : r.value;
      },
      async set(key: string, value: unknown, opts?: StorageOptions) {
        const bad = checkKey(key);
        if (bad) throw new Error(bad);
        let json: string | undefined;
        try {
          json = JSON.stringify(value);
        } catch {
          throw new Error("Storage values must be JSON: this one cannot be turned into JSON (a cycle, or a BigInt).");
        }
        if (json === undefined) throw new Error("Storage values must be JSON: undefined, functions and symbols cannot be stored.");
        if (utf8Length(json) > LIMITS.storageValueBytes) return fail(`Storage value for "${key}" is ${utf8Length(json)} bytes; the limit is ${LIMITS.storageValueBytes}.`);
        const keys = known[scope(opts)];
        if (!keys.has(key) && keys.size >= LIMITS.storageKeys) return fail(`An artifact can store at most ${LIMITS.storageKeys} keys.`);
        await storageOp("set", key, JSON.parse(json), opts);
        keys.add(key);
      },
      async delete(key: string, opts?: StorageOptions) {
        const bad = checkKey(key);
        if (bad) throw new Error(bad);
        await storageOp("delete", key, undefined, opts);
        known[scope(opts)].delete(key);
      },
      async list(prefix?: string, opts?: StorageOptions) {
        if (prefix !== undefined && (typeof prefix !== "string" || prefix.length > MAX_KEY_CHARS)) throw new Error("The prefix must be a string.");
        const r = await storageOp("list", prefix, undefined, opts);
        const keys = Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === "string") : [];
        if (!prefix) known[scope(opts)] = new Set(keys);
        else for (const k of keys) known[scope(opts)].add(k);
        return keys;
      },
    }),
    async ask(prompt: string) {
      if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("ask() needs a question as a string.");
      if (prompt.length > LIMITS.askChars) return fail(`The prompt is ${prompt.length} characters; the limit is ${LIMITS.askChars}.`);
      const r = await request((reqId) => ({ t: "ask", reqId, prompt }), ASK_TIMEOUT_MS);
      if (r.t !== "ask-result") throw new Error("Unexpected answer.");
      if (!r.ok) throw new Error(r.error || "The bot could not answer.");
      return r.text ?? "";
    },
    async download(name: string, mime: string, data: string | Blob | ArrayBuffer | ArrayBufferView) {
      let bytes: Uint8Array;
      if (typeof data === "string") bytes = new TextEncoder().encode(data);
      else if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
      else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else throw new Error("download() needs a string, a Blob, an ArrayBuffer or a typed array.");
      if (bytes.byteLength > LIMITS.downloadBytes) return fail(`The download is ${bytes.byteLength} bytes; the limit is ${LIMITS.downloadBytes}.`);
      const safeName = String(name || "download").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "download";
      const safeMime = /^[\w.+-]+\/[\w.+-]+$/.test(String(mime)) ? String(mime).toLowerCase() : "application/octet-stream";
      post({ t: "download", name: safeName, mime: safeMime, dataBase64: toBase64(bytes) });
    },
  });

  return {
    api,
    handle(m) {
      const p = pending.get(m.reqId);
      if (!p) return;
      pending.delete(m.reqId);
      clearTimeout(p.timer);
      p.resolve(m);
    },
    reset() {
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("This artifact was replaced."));
        pending.delete(id);
      }
      known.private.clear();
      known.shared.clear();
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
