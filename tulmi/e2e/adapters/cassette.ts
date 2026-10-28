/**
 * CASSETTES: EVERY MODEL REQUEST AND ITS ANSWER, WRITTEN DOWN ONCE AND PLAYED BACK FOR NOTHING.
 *
 * The cassette sits at the one place every model call passes, the OpenAI-shaped client (the gateway's `ChatClient`, and the proxy's `/v1/chat/completions`
 * in e2e/proxy.ts), so a replay runs the real gateway on top of it: the ladder, retries, JSON repair, budgets and ledger all run again, at zero cost.
 *
 *   record   every request goes to the upstream model and the answer is written to e2e/cassettes/<name>.jsonl.gz (the file is started afresh)
 *   replay   answers come from the file; a request with no recording is a MISS: an error to the caller, and a line in `stats.misses`. Strict: no model is called.
 *   mixed    a recorded request is answered from the file, a missing one goes upstream and is added to it
 *
 * THE KEY is a hash of what the request says to the model: the model, the messages, the tools, the answer format and HOW MUCH IT IS TOLD TO THINK (`reasoning`):
 * a request that asks a model to think less, or more, or not to think at all is a different request, and the answer to one is not the answer to another (the
 * first real run recorded six models' "Reasoning is mandatory" 400s for a request that said `effort: none`; after the fix those models are asked `low`, and a
 * replay must miss, not serve the 400). A recording made before the key had the field has no `reasoning` in it; it still answers a request that the product
 * would have sent the same way then (`legacyKey`), but never one whose reasoning has changed since (a model that requires reasoning). Anything that changes from run to run
 * without meaning anything (an id, a time, a commit hash, a temporary folder, a duration in a test's output) is replaced by a placeholder first, so the same
 * pipeline asks the same questions every time. The same key asked twice is answered with the recordings in order (the last one repeats).
 * `loose` replay adds a second chance for a miss: the same run's n-th call of the same purpose, for runs whose prompts moved a little.
 *
 * WHAT IS STORED: the request without its headers or key (the API key never reaches this file), the answer as it came, the model, the cost. Anything that
 * looks like a secret (a token, a key, a private key, a value of a secret environment variable) is replaced by [redacted] BEFORE the key is made and the
 * entry written, so a cassette is safe to keep and to share. Pictures are stored as a checksum and a size, not their bytes.
 *
 * MONEY. In record and mixed mode the upstream's own charge (`usage.cost`, dollars) is counted by a hard guard: once the cap is reached the next request is
 * refused with a 402 that says so, and the run stops cleanly. A replay costs nothing; what the recorded calls cost is reported as "would have cost".
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { reasoningRequired } from "../../src/agent/reasoning.js";
import type { ChatClient } from "../../src/code/brain/gateway.js";
import { callContext } from "./models.js";
import { E2E_DIR, mkdirp } from "../util.js";

/** Where cassettes are kept: e2e/cassettes, or E2E_CASSETTES_DIR (a proof run keeps its own out of the repository). */
export const CASSETTES_DIR = process.env.E2E_CASSETTES_DIR ? path.resolve(process.env.E2E_CASSETTES_DIR) : path.join(E2E_DIR, "cassettes");

export type CassetteMode = "record" | "replay" | "mixed";

// ------------------------------------------------------------------- the file
//
// A cassette is JSON lines, kept GZIPPED (`<name>.jsonl.gz`): the biggest recordings are about 100 MB as text, GitHub's limit for one file, and about a fifth
// of that compressed. Each appended entry is its own gzip member (a crash loses at most the line being written; gunzip reads concatenated members as one
// stream), and `npm run e2e:cassettes` rewrites a file as one member, which compresses better. A plain `<name>.jsonl` from before is still read (first, as the
// older recording); the decompressed text is byte for byte what the plain file held, so replay keys and answers do not change.

/** The cassette's file name stem: what a name may hold. */
export const cassetteStem = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, "_");
/** A cassette file's name without its extension (`x.jsonl.gz` and `x.jsonl` are both `x`); null for a file that is not a cassette. */
export const cassetteNameOf = (file: string): string | null => { const m = /^(.*)\.jsonl(\.gz)?$/.exec(path.basename(file)); return m ? m[1]! : null; };

/** The text of a cassette file, plain or gzipped (several members, or a torn last one, are read as far as they go). "" for a missing or empty file. */
export function readCassetteText(file: string): string {
  if (!fs.existsSync(file)) return "";
  const buf = fs.readFileSync(file);
  if (!buf.length) return "";
  if (!file.endsWith(".gz")) return buf.toString("utf8");
  try { return zlib.gunzipSync(buf).toString("utf8"); }
  catch { return zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString("utf8"); }
}

/** Rewrites a cassette as ONE gzip member at `<stem>.jsonl.gz` (from the plain file, the gzipped one, or both: plain first), checks that it reads back byte for byte, then removes the plain file. */
export function compactCassette(dir: string, stem: string): { from: number; to: number; bytes: number } {
  const plain = path.join(dir, `${stem}.jsonl`), gz = `${plain}.gz`;
  const had = (fs.existsSync(plain) ? fs.statSync(plain).size : 0) + (fs.existsSync(gz) ? fs.statSync(gz).size : 0);
  const text = readCassetteText(plain) + readCassetteText(gz);
  const packed = zlib.gzipSync(text, { level: 9 });
  if (zlib.gunzipSync(packed).toString("utf8") !== text) throw new Error(`${stem}: the compressed cassette does not read back the same`);
  const tmp = `${gz}.tmp`;
  fs.writeFileSync(tmp, packed);
  fs.renameSync(tmp, gz);
  if (fs.existsSync(plain)) fs.rmSync(plain);
  return { from: had, to: packed.length, bytes: Buffer.byteLength(text) };
}

// ------------------------------------------------------------------- redaction

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{20,}/g,
];

/** Values of the environment's secret variables that are long enough to be one. */
function envSecrets(): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(process.env)) if (v && v.length >= 12 && /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i.test(k)) out.push(v);
  return out.sort((a, b) => b.length - a.length);
}

export function redact(text: string): string {
  let t = text;
  for (const v of envSecrets()) if (t.includes(v)) t = t.split(v).join("[redacted]");
  for (const re of SECRET_PATTERNS) t = t.replace(re, "[redacted]");
  return t;
}

// -------------------------------------------------------------- normalization

/** Replaces what changes from run to run without meaning anything. */
export function normalize(text: string): string {
  return text
    // Colour codes: a test runner's timing is written `92\u001b[2mms` with codes between the number and its unit, so no duration rule below would see it.
    .replace(/\u001b\[[0-9;]*m/g, "")
    // Node's notice about its env-proxy support, with the process id in it. A project's own command (`npm test`) printed it whenever the run that RECORDED had
    // NODE_USE_ENV_PROXY=1 in its environment (the first real runs did), once for every `node` the tests started, as plain lines and as TAP comments. So the tool
    // result the agent read was different in a session without it, the next request missed, and a strict replay of a just-recorded cassette failed (parts-router-2,
    // smoke-2). It is not about the project: it is gone from the key, and any other process id is a placeholder.
    .replace(/^(?:# ?)?\(node:\d+\) \[UNDICI-EHPA\][^\n]*\n?/gm, "")
    .replace(/^(?:# ?)?\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n?/gm, "")
    .replace(/\(node:\d+\)/g, "(node:<pid>)")
    // The test runner's own timings (node:test's TAP: `duration_ms: 32.4` per test and `# duration_ms 215.5` at the end).
    .replace(/\bduration_ms:? ?\d+(?:\.\d+)?/g, "duration_ms <n>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{40}\b/g, "<sha>")
    .replace(/\b[0-9a-f]{64}\b/g, "<sha256>")
    .replace(/\b(?=[0-9a-f]{7,12}\b)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,12}\b/g, "<hex>")
    .replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?/g, "<time>")
    .replace(/\b\d{4}-\d\d-\d\d\b/g, "<date>")
    .replace(/\b\d\d:\d\d:\d\d(?:\.\d+)?\b/g, "<clock>")
    .replace(/\b1[5-9]\d{11}\b/g, "<ms>")
    .replace(/(?:\/dev\/shm|\/tmp|\/var\/folders)[^\s"'`)\]]*/g, "<tmp>")
    .replace(/\/[^\s"'`]*\/e2e\/cache\/[^\s"'`)\]]*/g, "<cache>")
    .replace(/tailzu\/[a-z0-9-]+-[0-9a-f]{4}\b/g, "tailzu/<branch>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|minutes)\b(?!=)/g, "<dur>")
    .replace(/\bin \d+(?:\.\d+)?m?s\b/g, "in <dur>")
    .replace(/\b(secs|ms|seconds|elapsed|took)=\d+(?:\.\d+)?/g, "$1=<n>")
    // Codex CLI names each command's output chunk with a random six-digit hex id.
    .replace(/\bChunk ID: [0-9a-f]{4,}/gi, "Chunk ID: <id>");
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function imageStub(url: string): string {
  const m = /^data:([^;,]+)[^,]*,(.*)$/s.exec(url);
  return m ? `data:${m[1]};checksum=${createHash("sha256").update(m[2]!).digest("hex").slice(0, 16)};bytes=${m[2]!.length}` : url;
}

function cleanContent(c: unknown): Json {
  if (typeof c === "string") return redact(c);
  if (Array.isArray(c)) {
    return c.map((p) => {
      const part = (p ?? {}) as { type?: string; text?: string; image_url?: { url?: string } };
      if (part.type === "text") return { type: "text", text: redact(part.text ?? "") };
      if (part.type === "image_url") return { type: "image_url", image_url: { url: imageStub(part.image_url?.url ?? "") } };
      return JSON.parse(redact(JSON.stringify(p ?? null))) as Json;
    });
  }
  return c === undefined ? null : (JSON.parse(redact(JSON.stringify(c))) as Json);
}

/** The part of a request that is stored and hashed: what it says to the model, redacted. */
export interface WireRequest { model: string; messages: Json[]; tools?: Json[]; response_format?: Json; max_tokens?: number; reasoning?: Json }

/** An object with its keys in order, so the same setting is the same text. */
function sorted(v: Json): Json {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as { [k: string]: Json })[k]!)]));
  return v;
}

export function wireRequestOf(body: Record<string, unknown>): WireRequest {
  const messages = ((body.messages ?? []) as Array<Record<string, unknown>>).map((m) => {
    const o: Record<string, Json> = { role: String(m.role ?? ""), content: cleanContent(m.content) };
    if (m.tool_calls !== undefined) o.tool_calls = cleanContent(m.tool_calls) as Json;
    if (m.tool_call_id !== undefined) o.tool_call_id = String(m.tool_call_id);
    if (m.name !== undefined) o.name = String(m.name);
    return o;
  });
  const model = String(body.model ?? "").replace(/^openrouter\//, "");
  return {
    model, messages,
    ...(Array.isArray(body.tools) && body.tools.length ? { tools: cleanContent(body.tools) as Json[] } : {}),
    ...(body.response_format ? { response_format: cleanContent(body.response_format) as Json } : {}),
    ...(typeof body.max_tokens === "number" ? { max_tokens: body.max_tokens } : {}),
    ...(body.reasoning !== undefined && body.reasoning !== null ? { reasoning: sorted(cleanContent(body.reasoning)) } : {}),
  };
}

const walk = (v: Json, f: (s: string) => string): Json => {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, f));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "id" || k === "tool_call_id" ? "<id>" : walk(x, f)]));
  return v;
};

/**
 * The key of a request: a hash of its model, messages, tools, answer format and reasoning, with the volatile parts replaced.
 * `legacy`: the key as it was made before reasoning was part of it, to find a recording from then.
 */
export function cassetteKey(body: Record<string, unknown>, o: { legacy?: boolean } = {}): string {
  const r = wireRequestOf(body);
  const canon = walk({
    model: r.model, messages: r.messages, ...(r.tools ? { tools: r.tools } : {}), ...(r.response_format ? { rf: (r.response_format as { type?: string }).type ?? null } : {}),
    ...(r.reasoning !== undefined && !o.legacy ? { reasoning: r.reasoning } : {}),
  } as Json, normalize);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 24);
}

/**
 * Whether a recording from before reasoning was part of the key can stand for this request: yes unless the product now asks this model something different
 * from what it asked then. The one thing that changed is a model that requires reasoning, which used to be told "none" (the Gemini 3 rule predates it).
 */
export function legacyCanStand(model: string): boolean {
  const m = model.replace(/^openrouter\//, "");
  const major = Number(/^google\/gemini-(\d+)/.exec(m)?.[1] ?? NaN);
  const askedLowBefore = major >= 3 || m.startsWith("google/gemini-2.5-pro");
  return askedLowBefore || !reasoningRequired(m);
}

/**
 * Whether a recording is an answer that wrote nothing because it ran out of room (finish_reason "length", no text, no tool call), and this request allows more
 * tokens than the recorded one did: the recording says nothing about what the larger allowance would bring.
 */
export function cutShortFor(hit: Pick<Entry, "req" | "res">, body: Record<string, unknown>): boolean {
  const choice = ((hit.res as { choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown[] } }> } | null)?.choices ?? [])[0];
  if (!choice || choice.finish_reason !== "length") return false;
  const text = typeof choice.message?.content === "string" ? choice.message.content.trim() : "";
  if (text || (choice.message?.tool_calls?.length ?? 0) > 0) return false;
  const was = hit.req.max_tokens;
  const now = typeof body.max_tokens === "number" ? body.max_tokens : undefined;
  return was !== undefined && now !== undefined && now > was;
}

/**
 * Whether a recording is a failure that a second try can mend: a dropped connection (no status) or a 429 or a 5xx. In a run that may call the model it is not
 * an answer: replaying it made the gateway's retry, and then every rung of a ladder of one model, fail the same way in 60 ms, and the job ended "No model
 * could be reached" (the paid comparison, 2026-10-28: one dropped socket). Replay mode still replays it, so a recorded story is told the same way.
 */
export function failedTransiently(hit: Pick<Entry, "err">): boolean {
  if (!hit.err) return false;
  const s = hit.err.status;
  return s === undefined || s === 429 || s >= 500;
}

// ------------------------------------------------------------------- the file

export interface Entry {
  k: string;
  at: string;
  run?: string;
  purpose?: string;
  n?: number;
  req: WireRequest;
  /** The answer as it came; null when the upstream failed (then `err` says how, and a replay fails the same way). */
  res: unknown;
  err?: { status?: number; message: string };
  ms: number;
  /** Dollars the upstream charged. */
  usd: number;
}

export class CassetteStore {
  /** The file written to: `<name>.jsonl.gz`. */
  readonly file: string;
  /** A plain `<name>.jsonl` from before the cassettes were gzipped: still read, never written. */
  readonly plainFile: string;
  private readonly byKey = new Map<string, Entry[]>();
  /** The same entries under the key the CURRENT rules (normalize, wireRequestOf) make of their request: a recording survives a change in what is ignored. */
  private readonly byCurrentKey = new Map<string, Entry[]>();
  private readonly byRun = new Map<string, Entry>();
  private readonly all: Entry[] = [];
  count = 0;

  constructor(readonly name: string, dir = CASSETTES_DIR) {
    this.plainFile = path.join(dir, `${cassetteStem(name)}.jsonl`);
    this.file = `${this.plainFile}.gz`;
  }

  exists(): boolean { return fs.existsSync(this.file) || fs.existsSync(this.plainFile); }

  /** The whole recording as text (the plain file first, as the older one, then the gzipped one). */
  text(): string { return readCassetteText(this.plainFile) + readCassetteText(this.file); }

  load(): this {
    this.byKey.clear(); this.byCurrentKey.clear(); this.byRun.clear(); this.all.length = 0; this.count = 0;
    if (!this.exists()) return this;
    for (const line of this.text().split("\n")) {
      if (!line.trim()) continue;
      try { this.add(JSON.parse(line) as Entry); } catch { /* a torn last line is not a recording */ }
    }
    return this;
  }

  /** Starts the file afresh (a new recording). */
  reset(): void { mkdirp(path.dirname(this.file)); fs.writeFileSync(this.file, ""); fs.rmSync(this.plainFile, { force: true }); this.byKey.clear(); this.byCurrentKey.clear(); this.byRun.clear(); this.all.length = 0; this.count = 0; }

  private add(e: Entry): void {
    const l = this.byKey.get(e.k) ?? [];
    l.push(e);
    this.byKey.set(e.k, l);
    // The key as the rules are NOW (the request is stored whole, so it can be made again). Only worth a second index when it differs from the stored one.
    try {
      const now = cassetteKey(e.req as unknown as Record<string, unknown>);
      if (now !== e.k) { const m = this.byCurrentKey.get(now) ?? []; m.push(e); this.byCurrentKey.set(now, m); }
    } catch { /* an entry whose request cannot be read keeps only its stored key */ }
    if (e.run && e.purpose && e.n !== undefined) this.byRun.set(`${e.run}|${e.purpose}|${e.n}`, e);
    this.all.push(e);
    this.count += 1;
  }

  append(e: Entry): void {
    mkdirp(path.dirname(this.file));
    fs.appendFileSync(this.file, zlib.gzipSync(`${JSON.stringify(e)}\n`));
    this.add(e);
  }

  get(key: string, nth: number): Entry | undefined {
    const l = this.byKey.get(key) ?? this.byCurrentKey.get(key);
    return l ? l[Math.min(nth, l.length - 1)] : undefined;
  }
  byOrdinal(run: string, purpose: string, n: number): Entry | undefined { return this.byRun.get(`${run}|${purpose}|${n}`); }
  entries(): Entry[] { return [...this.all]; }
  totalUsd(): number { return this.entries().reduce((n, e) => n + e.usd, 0); }
}

// ------------------------------------------------------------------ the guard

/** A hard cap on what the upstream may charge in a run, in dollars. Once reached, the next request is refused. */
export class SpendGuard {
  spentUsd = 0;
  constructor(readonly capUsd: number) {}
  get exhausted(): boolean { return this.capUsd > 0 && this.spentUsd >= this.capUsd; }
  add(usd: number): void { this.spentUsd += Math.max(0, usd); }
}

export const costUsdOf = (res: unknown): number => {
  const c = ((res ?? {}) as { usage?: { cost?: unknown } }).usage?.cost;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : 0;
};

// ------------------------------------------------------------------ the client

export interface CassetteStats {
  hits: number;
  misses: Array<{ key: string; model: string; purpose?: string; summary: string }>;
  recorded: number;
  /** Dollars the upstream charged this run (record and mixed). */
  spentUsd: number;
  /** Dollars the replayed answers had cost when they were recorded. */
  replayedUsd: number;
  /** Milliseconds the replayed answers had taken when they were recorded: a run's wall time "as if live" adds them (a replay answers at once). */
  replayedMs?: number;
  refused: number;
}

export interface CassetteOptions {
  store: CassetteStore;
  mode: CassetteMode;
  /** The real model: OpenRouter's client. Needed to record, and for mixed. */
  upstream?: ChatClient;
  guard?: SpendGuard;
  /** A label for the run (a task id): stored with each entry, and the ordinal fallback's scope. */
  run?: string;
  loose?: boolean;
}

export class CassetteMiss extends Error {
  readonly status = 400;
  readonly cassetteMiss = true;
  constructor(readonly key: string, model: string) { super(`cassette miss: no recording for this request to ${model} (key ${key}). Record again, or run with --mixed.`); this.name = "CassetteMiss"; }
}

export class CassetteClient implements ChatClient {
  readonly stats: CassetteStats = { hits: 0, misses: [], recorded: 0, spentUsd: 0, replayedUsd: 0, replayedMs: 0, refused: 0 };
  private readonly seen = new Map<string, number>();
  private readonly ordinals = new Map<string, number>();
  readonly chat: ChatClient["chat"];

  constructor(private readonly o: CassetteOptions) {
    if (o.mode !== "replay" && !o.upstream) throw new Error(`cassette mode ${o.mode} needs an upstream model client (is OPENROUTER_API_KEY set?)`);
    this.chat = { completions: { create: (body, opts) => this.create(body, opts) } };
  }

  async create(body: Record<string, unknown>, opts?: { signal?: AbortSignal; timeout?: number; maxRetries?: number }): Promise<unknown> {
    const key = cassetteKey(body);
    const legacyKey = cassetteKey(body, { legacy: true });
    const ctx = callContext.getStore();
    const purpose = ctx?.purpose;
    const run = this.o.run;
    const ord = purpose && run ? this.bump(`${run}|${purpose}`) : undefined;
    const nth = this.seen.get(key) ?? 0;
    this.seen.set(key, nth + 1);
    const legacyNth = this.seen.get(`legacy:${legacyKey}`) ?? 0;
    this.seen.set(`legacy:${legacyKey}`, legacyNth + 1);

    if (this.o.mode !== "record") {
      let hit = this.o.store.get(key, nth);
      // A recording from before the key held the reasoning (its request has none): it answers a request that is asked the same way now.
      if (!hit && legacyKey !== key && legacyCanStand(String(body.model ?? ""))) {
        const old = this.o.store.get(legacyKey, legacyNth);
        if (old && old.req.reasoning === undefined) hit = old;
      }
      if (!hit && this.o.loose && run && purpose && ord !== undefined) hit = this.o.store.byOrdinal(run, purpose, ord);
      // The key does not hold max_tokens. An answer recorded EMPTY because it ran out of room (the thinking took every token) cannot stand for the gateway's
      // retry with a larger allowance: replaying it made the retry fail the same way, and the job with it (the free-form debug run, 2026-10-28). It is a miss.
      if (hit && cutShortFor(hit, body)) hit = undefined;
      if (hit && this.o.mode !== "replay" && failedTransiently(hit)) hit = undefined;
      if (hit) {
        this.stats.hits += 1;
        this.stats.replayedUsd += hit.usd;
        this.stats.replayedMs = (this.stats.replayedMs ?? 0) + (hit.ms || 0);
        if (hit.err) throw Object.assign(new Error(hit.err.message), { ...(hit.err.status !== undefined ? { status: hit.err.status } : {}) });
        return structuredClone(hit.res);
      }
      if (this.o.mode === "replay") {
        const r = wireRequestOf(body);
        const last = [...r.messages].reverse().find((m) => (m as { role?: string }).role === "user") as { content?: unknown } | undefined;
        this.stats.misses.push({ key, model: r.model, ...(purpose ? { purpose } : {}), summary: normalize(typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "")).slice(0, 160) });
        throw new CassetteMiss(key, r.model);
      }
    }

    if (this.o.guard?.exhausted) {
      this.stats.refused += 1;
      throw Object.assign(new Error(`the spend cap was reached ($${this.o.guard.spentUsd.toFixed(4)} of $${this.o.guard.capUsd.toFixed(4)}): no more model calls are made`), { status: 402, code: "budget_exceeded", spendCap: true });
    }
    const t0 = Date.now();
    let res: unknown;
    try {
      res = await this.o.upstream!.chat.completions.create(body, opts);
    } catch (err) {
      const e = err as { status?: number; message?: string; name?: string };
      // A call that failed is part of the story too (the ladder climbed because of it): written down, and failed the same way on replay.
      if (e.name !== "AbortError") {
        this.o.store.append({
          k: key, at: new Date().toISOString(), ...(run ? { run } : {}), ...(purpose ? { purpose } : {}), ...(ord !== undefined ? { n: ord } : {}),
          req: wireRequestOf(body), res: null, err: { ...(e.status !== undefined ? { status: e.status } : {}), message: redact(String(e.message ?? "error")).slice(0, 300) }, ms: Date.now() - t0, usd: 0,
        });
      }
      throw err;
    }
    const usd = costUsdOf(res);
    this.o.guard?.add(usd);
    this.stats.spentUsd += usd;
    this.stats.recorded += 1;
    this.o.store.append({
      k: key, at: new Date().toISOString(), ...(run ? { run } : {}), ...(purpose ? { purpose } : {}), ...(ord !== undefined ? { n: ord } : {}),
      req: wireRequestOf(body), res: JSON.parse(redact(JSON.stringify(res))) as unknown, ms: Date.now() - t0, usd,
    });
    return res;
  }

  private bump(k: string): number { const n = this.ordinals.get(k) ?? 0; this.ordinals.set(k, n + 1); return n; }
}
