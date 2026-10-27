/**
 * THE JOB'S ROOM: ONE DURABLE OBJECT PER JOB. A COPY OF THE CODE FOR INSTANT READ, GREP AND GLOB; ONE RUNNER KEPT OPEN FOR THE JOB; THE APP'S LIVE VIEW.
 *
 * "Make the bot work like Claude Code" (docs/cloudflare-jobs.md section 10). Id = the job's id. Everything it holds is in its own SQLite and is
 * deleted when the job ends or after six idle hours (`deleteAll`): Tailzu never keeps a person's code.
 *
 * (a) THE COPY. On the first need the Worker mints a read-only, one-repo token and calls `prepare`; the room downloads the tarball for the job's
 *     branch head and unpacks it while it streams (tulmi/src/code/live/unpack.ts: the project brain's skip rules, secret files never held
 *     or named, 50 MB of text at most). Over the cap the room is `remote`: it holds nothing, and grep and glob are answered by the runner, which has
 *     the whole checkout. Files are `files(path, sha, size, content, mtime)`; what was left out is in `skipped(path, size, reason)` so a listing
 *     shows the folder as it is. The agent's STAGED edits (`overlay`) are laid over every read.
 *
 * (b) THE TOOLS: read (numbered lines, capped), list, glob (the most recently changed first), grep (ripgrep-like, with a pattern guard and a
 *     budget; tulmi/src/code/live/search.ts). Plain RPC methods, answered from SQLite.
 *
 * (c) THE SESSION HUB. A runner connects with a one-time, HMAC-signed ticket bound to this job, its step and its lease epoch (the Worker checks the
 *     signature; the room checks the epoch and that the ticket was not used before). The agent's `run` is `queueExec`, which returns at once; the
 *     room sends the command to the runner WITH THE STAGED OVERLAY, takes the output a line at a time, and when the runner says `done` it keeps the
 *     result and WAKES THE JOB'S WORKFLOW with `sendEvent` (the Workflow is in `waitForEvent`): no RPC is held open for a command. The Workflow
 *     comes back, asks `execStatus`, and has the exit code, the tail (8 KB, scanned for secrets) and the duration.
 *
 * (d) THE RULES. Opened late (only when the first command needs it: the Worker asks the router for a session step when `queueExec` finds none).
 *     Closed when idle for CODE_SESSION_IDLE_SEC (an ALARM), closed before the person is asked anything (`closeSession("needs_you")`, called by the
 *     loop), and capped at CODE_SESSION_MAX_MIN of session time for the job in all (the same alarm). The numbers come in from the caller, so the room
 *     reads no settings.
 *
 * (f) THE APP'S LIVE VIEW. A viewer socket (a ticket from the VPS, owner only) is sent compact events: the phase, a tool call and its short result,
 *     the output as it comes, the cost. The person can send {"t":"message","text":"..."}; it is kept in the room's inbox, the Workflow is woken,
 *     and the next model turn is shown it as the person's words.
 *
 * HIBERNATION. Every socket is accepted with `ctx.acceptWebSocket`, so a room with an open but quiet runner or viewer costs nothing while it waits;
 * nothing in here uses a timer (`setTimeout`) except a search forwarded to the runner, which is an RPC the caller is waiting on. What must happen
 * later is an alarm. State that must survive a sleep is in SQLite or in the socket's attachment (16 KB), never in a field.
 */
import { DurableObject } from "cloudflare:workers";
import { keepOutput } from "../../tulmi/src/code/jobs/util.js";
import {
  EXEC_GRACE_MS, EXEC_QUEUE_MAX, MESSAGE_MAX_BYTES, OUTPUT_HOLD_CHARS, PREPARE_TIMEOUT_MS, PREVIEW_PENDING_MAX, PREVIEW_REQ_MAX_BYTES, PREVIEW_REQUEST_MS,
  PREVIEW_RES_MAX_BYTES, PREVIEW_TOUCH_MS, SAID_KEEP, SAID_MAX_CHARS, SEARCH_TIMEOUT_MS, TARBALL_MAX_BYTES, VIEWER_BACKLOG, VIEWER_OUT_CHARS, WORKSPACE_IDLE_MS,
} from "../../tulmi/src/code/live/limits.js";
import { mintPreviewToken, previewAvailable, previewUrl, requestHeadersFor, responseHeadersFor, sameHex, type PreviewSite } from "../../tulmi/src/code/live/preview.js";
import type { LiveGlob, LiveGrep, LiveList, LiveRead } from "../../tulmi/src/code/live/ports.js";
import {
  isId, parseFromRunner, parseFromViewer, type CloseReason, type FromRunner, type OverlayEntry, type PreviewFailure, type ToRunner, type ViewerEvent,
} from "../../tulmi/src/code/live/protocol.js";
import { globPaths, grepFiles, inScope, listDir, readLines, type GrepBudget, type GrepFile, type GrepOptions } from "../../tulmi/src/code/live/search.js";
import { unpackTarball, type HeldWrite, type WorkspaceSink } from "../../tulmi/src/code/live/unpack.js";
import type { SkipReason } from "../../tulmi/src/code/live/rules.js";
import type { Env } from "./env.js";
import { wakeAgentJob } from "./workflows.js";

// ------------------------------------------------------------------ shapes

export type RoomState = "empty" | "preparing" | "ready" | "remote" | "error";
export type SessionState = "none" | "opening" | "open" | "closed";

export interface SessionView {
  state: SessionState;
  stepIdx?: number;
  epoch?: number;
  kind?: "github" | "desktop";
  /** Milliseconds of session time this job has used in all, closed sessions and the open one. */
  usedMs: number;
  /** A runner is connected and has said hello. */
  connected: boolean;
  closeReason?: CloseReason;
}

export interface RoomStatus {
  jobId: string | null;
  state: RoomState;
  ready: boolean;
  remote: boolean;
  files: number;
  bytes: number;
  skipped: number;
  headSha: string;
  error?: string;
  note?: string;
  session: SessionView;
}

/** Where a tarball is fetched from: the repo with a read-only token, or a one-time link. */
export type TarSource = { kind: "github"; owner: string; repo: string; token: string } | { kind: "url"; url: string };

export interface ExecView {
  tag: string;
  /** "lost": it will never have an exit code (the runner went, the session was closed, it ran past its time). `note` says which. */
  status: "queued" | "running" | "done" | "lost";
  exitCode?: number;
  /** The last 8 KB it printed, with nothing that looks like a secret. */
  outputTail?: string;
  ms?: number;
  note?: string;
}

export interface QueueExec {
  jobId: string;
  /** The call that asked (idempotent: asking again with the same tag is the same command). */
  tag: string;
  commands: string[];
  timeoutSec: number;
  overlay: OverlayEntry[];
}

export type Opened = { ok: true; remainingMs: number } | { ok: false; reason: "cap" };

// ------------------------------------------------------------------ the preview

/** What the room keeps of a preview (meta "preview"). The token is not kept, only its nonce and who it was made for. */
export interface PreviewRow {
  state: "starting" | "ready" | "closed";
  /** The id the runner knows it by. */
  id: string;
  nonce: string;
  /** The job's owner: the person the address is made for, and the only one it is handed to. */
  userId: string;
  /** Epoch ms the token stops: the end of the job's session time. */
  exp: number;
  url: string;
  startedAt: number;
  readySec: number;
  readyAt?: number;
  port?: number;
  lastRequestAt: number;
  idleMs: number;
  requests: number;
  error?: string;
  closeReason?: string;
}

export interface PreviewStartReq {
  jobId: string;
  /** The job's owner. */
  userId: string;
  /** The dev command (the brain's `dev` / `start` script, with the package manager's prefix). */
  cmd: string;
  port?: number;
  /** The install to run first if there is no node_modules. */
  prepare?: string;
  readySec: number;
  /** CODE_PREVIEW_IDLE_SEC. */
  idleSec: number;
  /** The staged edits: the dev server runs on the branch plus these. */
  overlay: OverlayEntry[];
  site: PreviewSite;
}

export type PreviewStart =
  | { ok: true; state: "starting"; url: string }
  | { ok: false; reason: "off" | "no_session" | "bad_request"; message: string };

export interface PreviewView {
  state: "none" | "starting" | "ready" | "closed";
  url?: string;
  port?: number;
  error?: string;
  closeReason?: string;
  requests: number;
}

/** One HTTP request for the preview, as the door hands it over: already read, already limited. */
export interface PreviewHttpReq {
  /** From the token, in hex. */
  nonce: string;
  method: string;
  /** Root-relative path and query. */
  path: string;
  headers: Array<[string, string]>;
  body: ArrayBuffer | null;
  /** The host the browser used, for X-Forwarded-Host. */
  publicHost: string;
}

interface PendingHttp {
  method: string;
  status?: number;
  headers?: Array<[string, string]>;
  parts: Uint8Array[];
  size: number;
  done: (r: Response) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pvError = (status: number, code: string, message: string, extra: Record<string, string> = {}): Response =>
  Response.json({ code, message }, { status, headers: { "cache-control": "no-store", ...extra } });

const FAILURE_STATUS: Record<PreviewFailure, [number, string, string]> = {
  unreachable: [502, "preview_unreachable", "The dev server did not take the request."],
  timeout: [504, "preview_timeout", "The dev server took too long to answer."],
  too_large: [502, "preview_too_large", "That response is over 10 MB, more than a preview carries."],
  bad_request: [400, "bad_request", "That request could not be passed on."],
  busy: [503, "preview_busy", "The preview is busy. Try again."],
  failed: [502, "preview_failed", "The dev server's answer broke off."],
};

/** Test seam: how the room fetches a tarball, what time it is, and (only so that a test need not make 50 MB) how much text a copy may hold. */
export const roomDeps: { fetch: (url: string, init: RequestInit) => Promise<Response>; now: () => number; maxBytes?: number } = {
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
};

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, sha TEXT NOT NULL, size INTEGER NOT NULL, content TEXT NOT NULL, mtime INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS skipped (path TEXT PRIMARY KEY, size INTEGER NOT NULL, reason TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS overlay (path TEXT PRIMARY KEY, content TEXT, seq INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS execs (tag TEXT PRIMARY KEY, seq INTEGER NOT NULL, commands TEXT NOT NULL, timeout_sec INTEGER NOT NULL, overlay TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, out TEXT NOT NULL DEFAULT '', ms INTEGER, note TEXT, deadline INTEGER)",
  "CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS nonces (n TEXT PRIMARY KEY, exp INTEGER NOT NULL)",
];

interface SessionRow {
  state: SessionState;
  stepIdx?: number;
  epoch?: number;
  kind?: "github" | "desktop";
  idleMs: number;
  /** What is left of the job's session time when this session was expected. */
  remainingMs: number;
  /** When the ticket stops working: an unconnected session is given up on then. */
  deadline?: number;
  connectedAt?: number;
  lastActivity: number;
  closeReason?: CloseReason;
}

/** A preview that has not said it is ready this long after its own time (the install before it takes its time) is given up on. */
const PREVIEW_START_GRACE_SEC = 330;
const NO_SESSION: SessionRow = { state: "none", idleMs: 0, remainingMs: 0, lastActivity: 0 };
const BAD = (status: number, code: string, message: string): Response => Response.json({ code, message }, { status });
const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);


export class JobRoom extends DurableObject<Env> {
  private inited = false;
  /** The download in progress, shared by callers that arrive meanwhile. */
  private preparing: Promise<void> | null = null;
  /** Searches forwarded to a runner, waiting for its answer (the RPC that asked is held for it). */
  private readonly searches = new Map<string, (r: Extract<FromRunner, { t: "found" }>) => void>();
  /** HTTP requests for the preview, waiting for the runner's answer. A request in flight keeps this object in memory, so a Map is enough. */
  private readonly pending = new Map<string, PendingHttp>();
  private httpSeq = 0;
  /** The last time the preview's "used" mark was written, so a page's dozens of assets are one write. */
  private lastTouch = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A plain-text keepalive from a runner or a viewer is answered by the runtime without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ------------------------------------------------------------- storage

  private get sql(): SqlStorage {
    if (!this.inited) {
      for (const stmt of SCHEMA) this.ctx.storage.sql.exec(stmt);
      this.inited = true;
    }
    return this.ctx.storage.sql;
  }

  private meta(k: string): string | null {
    const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return r ? String(r.v) : null;
  }

  private setMeta(k: string, v: string | number): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, String(v));
  }

  private num(k: string): number {
    const n = Number(this.meta(k));
    return Number.isFinite(n) ? n : 0;
  }

  private get session(): SessionRow {
    const raw = this.meta("session");
    if (!raw) return { ...NO_SESSION };
    try { return JSON.parse(raw) as SessionRow; } catch { return { ...NO_SESSION }; }
  }

  private setSession(s: SessionRow): void {
    this.setMeta("session", JSON.stringify(s));
  }

  private now(): number { return roomDeps.now(); }

  private touch(): void { this.setMeta("touched", this.now()); }

  private jobId(): string | null { return this.meta("job") ?? this.ctx.id.name ?? null; }

  private remember(jobId: string): void {
    if (isId(jobId) && this.meta("job") !== jobId) this.setMeta("job", jobId);
  }

  // -------------------------------------------------------------- status

  private sessionView(): SessionView {
    const s = this.session;
    const open = s.state === "open";
    return {
      state: s.state, ...(s.stepIdx !== undefined ? { stepIdx: s.stepIdx } : {}), ...(s.epoch !== undefined ? { epoch: s.epoch } : {}), ...(s.kind ? { kind: s.kind } : {}),
      usedMs: this.num("used_ms") + (open && s.connectedAt ? Math.max(0, this.now() - s.connectedAt) : 0),
      connected: open, ...(s.closeReason ? { closeReason: s.closeReason } : {}),
    };
  }

  /** What the room holds and what its session is doing. Costs nothing and creates nothing. */
  async status(): Promise<RoomStatus> {
    const state = (this.meta("state") as RoomState | null) ?? "empty";
    return {
      jobId: this.jobId(), state, ready: state === "ready", remote: state === "remote", files: this.num("files"), bytes: this.num("bytes"), skipped: this.num("skipped"),
      headSha: this.meta("head") ?? "", ...(this.meta("error") ? { error: this.meta("error")! } : {}), ...(this.meta("note") ? { note: this.meta("note")! } : {}),
      session: this.sessionView(),
    };
  }

  // --------------------------------------------------------- the copy (a)

  /**
   * Makes the copy of the job's branch at `headSha` if there is not one, from the tarball. One download at a time: callers that arrive during
   * it wait for the same one. The only long RPC of the room, and a bounded one (PREPARE_TIMEOUT_MS).
   */
  async prepare(req: { jobId: string; headSha: string; source: TarSource }): Promise<RoomStatus> {
    this.remember(req.jobId);
    const state = this.meta("state");
    if ((state === "ready" || state === "remote") && this.meta("head") === req.headSha) {
      this.touch();
      return this.status();
    }
    if (!this.preparing) {
      this.preparing = this.fill(req).finally(() => { this.preparing = null; });
    }
    await this.preparing;
    return this.status();
  }

  private clearCopy(): void {
    this.sql.exec("DELETE FROM files");
    this.sql.exec("DELETE FROM skipped");
    for (const k of ["files", "bytes", "skipped", "error", "note"]) this.sql.exec("DELETE FROM meta WHERE k = ?", k);
  }

  private async fill(req: { headSha: string; source: TarSource }): Promise<void> {
    this.clearCopy();
    this.setMeta("state", "preparing");
    this.setMeta("head", req.headSha);
    try {
      const res = await this.download(req.headSha, req.source);
      const declared = Number(res.headers.get("content-length"));
      let out: Awaited<ReturnType<typeof unpackTarball>>;
      if (Number.isFinite(declared) && declared > TARBALL_MAX_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        out = { files: 0, bytes: 0, skipped: 0, remote: true, note: "The repo is too big to hold a copy of." };
      } else {
        const sink = new SqlSink(this.sql, (fn) => this.ctx.storage.transactionSync(fn));
        out = await unpackTarball(res.body!, sink, roomDeps.maxBytes !== undefined ? { maxBytes: roomDeps.maxBytes } : {});
        sink.flush();
        if (!out.remote) { this.setMeta("files", out.files); this.setMeta("bytes", out.bytes); this.setMeta("skipped", out.skipped); }
      }
      if (out.remote) {
        // Nothing is kept: a repo that does not fit is searched where it is, on the runner.
        this.clearCopy();
        this.setMeta("state", "remote");
        if (out.note) this.setMeta("note", out.note);
      } else this.setMeta("state", "ready");
    } catch (err) {
      this.clearCopy();
      this.setMeta("state", "error");
      // Never a value from the request: the token is in it.
      this.setMeta("error", short(`The copy could not be made (${(err as Error)?.name === "TimeoutError" ? "it took too long" : "the download failed"}).`, 200));
    }
    this.touch();
    await this.reschedule();
  }

  /** The tarball: with the token only to GitHub's API, and the redirect to the signed link followed by hand, without it. */
  private async download(headSha: string, source: TarSource): Promise<Response> {
    const signal = AbortSignal.timeout(PREPARE_TIMEOUT_MS);
    let url: string;
    const headers: Record<string, string> = { "User-Agent": "tailzu", Accept: "application/x-gzip" };
    if (source.kind === "github") {
      if (!/^[0-9a-f]{40}$/.test(headSha) || !/^[A-Za-z0-9._-]{1,100}$/.test(source.owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(source.repo)) throw new Error("bad source");
      url = `https://api.github.com/repos/${source.owner}/${source.repo}/tarball/${headSha}`;
      headers.Authorization = `Bearer ${source.token}`;
    } else url = source.url;
    if (!/^https:\/\//i.test(url)) throw new Error("bad source");
    let res = await roomDeps.fetch(url, { method: "GET", headers, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const where = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!where || !/^https:\/\//i.test(where)) throw new Error("bad redirect");
      res = await roomDeps.fetch(where, { method: "GET", headers: { "User-Agent": "tailzu", Accept: "application/x-gzip" }, redirect: "error", signal });
    }
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`answered ${res.status}`);
    }
    return res;
  }

  /** Throws the copy away (the branch moved, or a person asked for a fresh one). The overlay, the inbox and the session are left. */
  async invalidate(): Promise<void> {
    this.clearCopy();
    this.sql.exec("DELETE FROM meta WHERE k IN ('state', 'head')");
    await this.reschedule();
  }

  /** The agent's staged edits: laid over every read until they are replaced. */
  async setOverlay(files: OverlayEntry[]): Promise<void> {
    this.touch();
    this.replaceOverlay(files);
  }

  private replaceOverlay(files: readonly OverlayEntry[]): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM overlay");
      let seq = 0;
      for (const f of files.slice(0, 400)) this.sql.exec("INSERT OR REPLACE INTO overlay (path, content, seq) VALUES (?, ?, ?)", f.path, f.content, (seq += 1));
    });
  }

  private overlayMap(): Map<string, { content: string | null; seq: number }> {
    const m = new Map<string, { content: string | null; seq: number }>();
    for (const r of this.sql.exec("SELECT path, content, seq FROM overlay").toArray()) m.set(String(r.path), { content: r.content === null ? null : String(r.content), seq: Number(r.seq) });
    return m;
  }

  // ------------------------------------------------------- the tools (b)

  async read(path: string, o: { offset?: number; limit?: number } = {}): Promise<LiveRead> {
    this.touch();
    const staged = this.sql.exec("SELECT content FROM overlay WHERE path = ?", path).toArray()[0];
    if (staged) {
      if (staged.content === null) return { kind: "missing", deleted: true };
      return { kind: "ok", out: readLines(String(staged.content), o.offset, o.limit), staged: true };
    }
    if (this.meta("state") !== "ready") return { kind: "unavailable" };
    const row = this.sql.exec("SELECT content FROM files WHERE path = ?", path).toArray()[0];
    if (row) return { kind: "ok", out: readLines(String(row.content), o.offset, o.limit), staged: false };
    const skipped = this.sql.exec("SELECT reason FROM skipped WHERE path = ?", path).toArray()[0];
    if (skipped) return { kind: "skipped", reason: String(skipped.reason) };
    return { kind: "missing", deleted: false };
  }

  /** The held and skipped paths, staged edits applied, and the paths' recency (a time of any unit; staged edits are the latest). */
  private allPaths(): { paths: string[]; recent: Map<string, number> } {
    const recent = new Map<string, number>();
    const set = new Set<string>();
    for (const r of this.sql.exec("SELECT path, mtime FROM files").toArray()) { set.add(String(r.path)); if (Number(r.mtime) > 0) recent.set(String(r.path), Number(r.mtime)); }
    for (const r of this.sql.exec("SELECT path FROM skipped").toArray()) set.add(String(r.path));
    for (const [p, o] of this.overlayMap()) {
      if (o.content === null) set.delete(p); else set.add(p);
      recent.set(p, 1e15 + o.seq);
    }
    return { paths: [...set], recent };
  }

  async list(dir: string): Promise<LiveList> {
    this.touch();
    if (this.meta("state") !== "ready") return { kind: "unavailable" };
    const out = listDir(this.allPaths().paths, dir);
    return out ? { kind: "ok", out } : { kind: "empty" };
  }

  async glob(pattern: string): Promise<LiveGlob> {
    this.touch();
    const state = this.meta("state");
    if (state === "remote") return this.forward("glob", { pattern });
    if (state !== "ready") return { kind: "unavailable" };
    const { paths, recent } = this.allPaths();
    const out = globPaths(paths, pattern, recent);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }

  /** `budget` is for a test that needs a search to run out of it. */
  async grep(pattern: string, opts: GrepOptions = {}, budget: Partial<Omit<GrepBudget, "now">> = {}): Promise<LiveGrep> {
    this.touch();
    const state = this.meta("state");
    if (state === "remote") return this.forward("grep", { pattern, ...opts });
    if (state !== "ready") return { kind: "unavailable" };
    const overlay = this.overlayMap();
    const scope = opts.path?.trim().replace(/^\.\/?/, "").replace(/\/+$/, "") || undefined;
    // Paths first (cheap), contents only for the files a search reaches, in chunks.
    const names = new Set<string>();
    // A scope is a file or a folder: the path itself, or everything from "path/" up to (not including) "path0" ("0" is the character after "/").
    const rows = scope
      ? this.sql.exec("SELECT path FROM files WHERE path = ? OR (path >= ? AND path < ?) ORDER BY path", scope, `${scope}/`, `${scope}0`)
      : this.sql.exec("SELECT path FROM files ORDER BY path");
    for (const r of rows.toArray()) names.add(String(r.path));
    for (const [p, o] of overlay) { if (o.content === null) names.delete(p); else names.add(p); }
    const ordered = [...names].filter((p) => inScope(p, scope)).sort();
    const sql = this.sql;
    function* files(): Generator<GrepFile> {
      for (let i = 0; i < ordered.length; i += 40) {
        const chunk = ordered.slice(i, i + 40);
        const want = chunk.filter((p) => !overlay.has(p));
        const held = new Map<string, string>();
        if (want.length) {
          for (const r of sql.exec(`SELECT path, content FROM files WHERE path IN (${want.map(() => "?").join(",")})`, ...want).toArray()) held.set(String(r.path), String(r.content));
        }
        for (const p of chunk) {
          const content = overlay.has(p) ? overlay.get(p)!.content : held.get(p);
          if (typeof content === "string") yield { path: p, content };
        }
      }
    }
    const out = grepFiles(files(), pattern, opts, budget);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }

  // ------------------------------------------------- the runner session (c)

  /** How much of the job's session time is left (`capMs` is the job's whole allowance). The caller asks before it places a session step. */
  async sessionBudget(capMs: number): Promise<Opened> {
    const left = capMs - this.sessionView().usedMs;
    return left >= 20_000 ? { ok: true, remainingMs: left } : { ok: false, reason: "cap" };
  }

  /**
   * A session is about to be placed: this is the runner the room is waiting for. It is told BEFORE the step is asked of the router, because a PC
   * is sent its offer while the router is still placing the step and may connect before the router has answered; `bindStep` follows with the
   * step's number. Any earlier runner is told it has been superseded. The room gives up on a runner that has not connected `ticketTtlMs` (and a
   * minute) from now.
   */
  async expectRunner(req: { jobId: string; idleMs: number; remainingMs: number; ticketTtlMs: number }): Promise<void> {
    this.remember(req.jobId);
    const old = this.session;
    if (old.state === "open" || old.state === "opening") await this.closeSession("superseded");
    this.setSession({ state: "opening", idleMs: req.idleMs, remainingMs: req.remainingMs, deadline: this.now() + req.ticketTtlMs + 60_000, lastActivity: this.now() });
    this.touch();
    this.event({ t: "session", state: "opening", at: this.now() });
    await this.reschedule();
  }

  /** The router has placed the session step: a runner must come with a ticket made for exactly this step. (A runner that got here first has bound it already.) */
  async bindStep(stepIdx: number): Promise<void> {
    const s = this.session;
    if ((s.state === "opening" || s.state === "open") && s.stepIdx === undefined) this.setSession({ ...s, stepIdx });
  }

  /** The session as it is: the Worker asks before placing a step, and each time it comes back to wait. */
  async sessionInfo(): Promise<SessionView> { return this.sessionView(); }

  /** Queues a command for the runner. Idempotent per `tag`. Returns at once; the Workflow is woken when it is done. */
  async queueExec(req: QueueExec): Promise<ExecView> {
    this.remember(req.jobId);
    const have = this.execView(req.tag);
    if (have) return have;
    const queued = Number(this.sql.exec("SELECT COUNT(*) AS n FROM execs WHERE status IN ('queued', 'running')").one().n);
    if (queued >= EXEC_QUEUE_MAX) return { tag: req.tag, status: "lost", note: "Too many commands are waiting for the runner." };
    const seq = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM execs").one().n);
    this.sql.exec(
      "INSERT INTO execs (tag, seq, commands, timeout_sec, overlay, status) VALUES (?, ?, ?, ?, ?, 'queued')",
      req.tag, seq, JSON.stringify(req.commands), Math.max(1, Math.floor(req.timeoutSec)), JSON.stringify(req.overlay),
    );
    this.replaceOverlay(req.overlay);
    this.touch();
    const s = this.session;
    if (s.state === "open") this.setSession({ ...s, lastActivity: this.now() });
    this.pump();
    await this.reschedule();
    return this.execView(req.tag)!;
  }

  async execStatus(tag: string): Promise<ExecView | null> { return this.execView(tag); }

  /** Forgets a command that was queued but that its caller has given up on. A command that is running is stopped. */
  async cancelExec(tag: string): Promise<void> {
    const row = this.sql.exec("SELECT status FROM execs WHERE tag = ?", tag).toArray()[0];
    if (!row) return;
    if (row.status === "running") this.toRunner({ t: "cancel", id: tag });
    if (row.status === "queued" || row.status === "running") await this.endExec(tag, { lost: "It was stopped before it finished." });
  }

  private execView(tag: string): ExecView | null {
    const r = this.sql.exec("SELECT status, exit_code, out, ms, note FROM execs WHERE tag = ?", tag).toArray()[0];
    if (!r) return null;
    const status = String(r.status);
    if (status === "done") return { tag, status: "done", exitCode: Number(r.exit_code), outputTail: keepOutput(String(r.out)), ms: Number(r.ms ?? 0), ...(r.note ? { note: String(r.note) } : {}) };
    if (status === "lost") return { tag, status: "lost", ...(r.note ? { note: String(r.note) } : {}) };
    return { tag, status: status === "running" ? "running" : "queued" };
  }

  private runnerSocket(): WebSocket | null {
    return this.ctx.getWebSockets("runner").find((ws) => (ws.deserializeAttachment() as { hello?: boolean } | null)?.hello === true) ?? null;
  }

  private toRunner(m: ToRunner): boolean {
    const ws = this.runnerSocket();
    if (!ws) return false;
    try { ws.send(JSON.stringify(m)); return true; } catch { return false; }
  }

  /** Sends the oldest queued command to the runner, if one is connected and idle. */
  private pump(): void {
    const s = this.session;
    if (s.state !== "open") return;
    if (this.sql.exec("SELECT 1 FROM execs WHERE status = 'running' LIMIT 1").toArray().length) return;
    const next = this.sql.exec("SELECT tag, commands, timeout_sec, overlay FROM execs WHERE status = 'queued' ORDER BY seq LIMIT 1").toArray()[0];
    if (!next) return;
    const deadline = this.now() + Number(next.timeout_sec) * 1000 + EXEC_GRACE_MS;
    const tag = String(next.tag);
    const msg: ToRunner = {
      t: "exec", id: tag, commands: JSON.parse(String(next.commands)) as string[], timeoutSec: Number(next.timeout_sec),
      overlay: JSON.parse(String(next.overlay)) as OverlayEntry[], discard: true,
    };
    if (!this.toRunner(msg)) return;
    this.sql.exec("UPDATE execs SET status = 'running', deadline = ? WHERE tag = ?", deadline, tag);
    this.event({ t: "out", id: tag, data: `$ ${short((JSON.parse(String(next.commands)) as string[]).join("\n$ "), 300)}\n`, at: this.now() });
  }

  /** Records how a command ended and moves on: the next command, the alarm, and the job's Workflow, which is waiting. */
  private async endExec(tag: string, how: { exitCode: number; ms: number; note?: string } | { lost: string }): Promise<void> {
    if ("lost" in how) this.sql.exec("UPDATE execs SET status = 'lost', note = ?, deadline = NULL WHERE tag = ?", how.lost, tag);
    else this.sql.exec("UPDATE execs SET status = 'done', exit_code = ?, ms = ?, note = ?, deadline = NULL WHERE tag = ?", how.exitCode, how.ms, how.note ?? null, tag);
    const s = this.session;
    if (s.state === "open") this.setSession({ ...s, lastActivity: this.now() });
    this.pump();
    await this.reschedule();
    await this.wake("runner");
  }

  /** Marks every command that has not finished as lost, with a reason: the session is over. */
  private loseExecs(reason: string): void {
    for (const r of this.sql.exec("SELECT tag FROM execs WHERE status IN ('queued', 'running')").toArray()) {
      this.sql.exec("UPDATE execs SET status = 'lost', note = ?, deadline = NULL WHERE tag = ?", reason, String(r.tag));
    }
  }

  /** Wakes the job's Workflow (it is waiting for the runner or for the person). A job with no Workflow is nobody to wake. */
  private async wake(kind: "runner" | "message"): Promise<void> {
    const id = this.jobId();
    if (!id) return;
    try { await wakeAgentJob(this.env, id, kind); } catch { /* the Workflow's own timer looks again */ }
  }

  /**
   * Ends the session: the runner is told to go (`close`), the time it was open is added to the job's, commands that never ran are lost, and a
   * viewer is told. Idempotent. `reason` is why: "idle", "cap", "needs_you" (the person is about to be asked something), "job_end", "superseded".
   */
  async closeSession(reason: CloseReason): Promise<{ closed: boolean }> {
    const s = this.session;
    if (s.state !== "open" && s.state !== "opening") return { closed: false };
    this.toRunner({ t: "close", reason });
    for (const ws of this.ctx.getWebSockets("runner")) {
      try { ws.close(1000, reason); } catch { /* gone already */ }
    }
    // The dev server lived on that runner.
    await this.closePreview(`session_${reason}`);
    if (s.state === "open" && s.connectedAt) this.setMeta("used_ms", this.num("used_ms") + Math.max(0, this.now() - s.connectedAt));
    this.loseExecs(reason === "idle" ? "The session was closed." : reason === "cap" ? "The session reached the time limit for this job." : "The session was closed before the command finished.");
    this.setSession({ ...s, state: "closed", closeReason: reason });
    this.event({ t: "session", state: "closed", reason, at: this.now() });
    await this.reschedule();
    // Someone may be waiting on a command that will now never finish; an idle close or the person's turn has nobody waiting.
    if (reason === "cap" || reason === "error" || reason === "expired") await this.wake("runner");
    return { closed: true };
  }

  // ----------------------------------------------------------- the preview

  private get preview(): PreviewRow | null {
    const raw = this.meta("preview");
    if (!raw) return null;
    try { return JSON.parse(raw) as PreviewRow; } catch { return null; }
  }

  private setPreview(p: PreviewRow): void { this.setMeta("preview", JSON.stringify(p)); }

  /** The preview exists and has not been closed: the session must not be closed as idle under it. */
  private previewActive(): boolean {
    const p = this.preview;
    return !!p && p.state !== "closed";
  }

  /** What the preview is doing. Costs nothing and creates nothing. */
  async previewStatus(): Promise<PreviewView> {
    const p = this.preview;
    if (!p) return { state: "none", requests: 0 };
    return {
      state: p.state, ...(p.state !== "closed" ? { url: p.url } : {}), ...(p.port ? { port: p.port } : {}), ...(p.error ? { error: p.error } : {}),
      ...(p.closeReason ? { closeReason: p.closeReason } : {}), requests: p.requests,
    };
  }

  /**
   * The address of the preview, for the person it was made for and nobody else. (The live view is sent it as an event on the owner's socket; this is
   * for an owner who asks again.)
   */
  async previewFor(userId: string): Promise<{ ok: true; url: string } | { ok: false }> {
    const p = this.preview;
    if (!p || p.state !== "ready" || !sameHex(p.userId, String(userId))) return { ok: false };
    return { ok: true, url: p.url };
  }

  /**
   * Starts the project's dev server on the open session's runner, with the staged edits laid over the checkout, and returns at once: the runner says
   * when it answers (`preview` frame), the room tells the job's Workflow and sends the live view `preview-ready`. The address is made here: a token
   * for this job that stops working when the session's time does. A preview already open is closed first.
   */
  async startPreview(req: PreviewStartReq): Promise<PreviewStart> {
    this.remember(req.jobId);
    const secret = String(this.env.CODE_JOBS_SECRET ?? "");
    if (!secret || !previewAvailable(req.site)) return { ok: false, reason: "off", message: "Previews are not set up on the Worker (a PREVIEW_DOMAIN or a PREVIEW_HOST, and the secret)." };
    if (!/^[0-9a-f-]{36}$/i.test(req.jobId) || !req.cmd.trim()) return { ok: false, reason: "bad_request", message: "A preview needs a job and a command." };
    const s = this.session;
    if (s.state !== "open" || !this.runnerSocket()) return { ok: false, reason: "no_session", message: "No runner is connected for this job, so there is nowhere to run the dev server." };
    if (this.previewActive()) await this.closePreview("replaced", { tellRunner: true });
    const now = this.now();
    const capEnd = (s.connectedAt ?? now) + s.remainingMs;
    const minted = mintPreviewToken({ secret, jobId: req.jobId, ttlMs: Math.max(30_000, capEnd - now), now });
    const url = previewUrl(req.site, minted.token)!;
    const id = `pv${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const readySec = Math.min(180, Math.max(5, Math.floor(req.readySec)));
    const row: PreviewRow = {
      state: "starting", id, nonce: minted.nonce, userId: req.userId, exp: minted.exp, url, startedAt: now, readySec, lastRequestAt: now,
      idleMs: Math.max(10, Math.floor(req.idleSec)) * 1000, requests: 0,
    };
    this.setPreview(row);
    this.touch();
    this.setSession({ ...this.session, lastActivity: now });
    const sent = this.toRunner({
      t: "preview", id, cmd: req.cmd, readySec, idleSec: Math.max(10, Math.floor(req.idleSec)), overlay: req.overlay,
      ...(req.port ? { port: req.port } : {}), ...(req.prepare ? { prepare: req.prepare } : {}),
    });
    if (!sent) {
      this.setPreview({ ...row, state: "closed", closeReason: "failed", error: "The runner could not be reached." });
      return { ok: false, reason: "no_session", message: "The runner could not be reached." };
    }
    await this.reschedule();
    return { ok: true, state: "starting", url };
  }

  /** Closes the preview (the person's agent is done with it, or the loop is going back to work). */
  async stopPreview(reason = "stopped"): Promise<{ closed: boolean }> {
    return { closed: await this.closePreview(short(reason, 60), { tellRunner: true }) };
  }

  /**
   * Closes the preview: the dev server is told to go (unless it already has), requests in flight are answered 502, the live view is told, and the
   * session's idle clock, which the preview was holding, starts from the last request.
   */
  private async closePreview(reason: string, o: { tellRunner?: boolean } = {}): Promise<boolean> {
    const p = this.preview;
    if (!p || p.state === "closed") return false;
    if (o.tellRunner) this.toRunner({ t: "preview-stop", reason });
    for (const [id, w] of [...this.pending]) this.settle(id, w, pvError(502, "preview_closed", "The preview was closed."));
    this.setPreview({ ...p, state: "closed", closeReason: reason });
    this.event({ t: "preview-closed", reason, at: this.now() });
    await this.reschedule();
    return true;
  }

  private settle(id: string, w: PendingHttp, r: Response): void {
    if (this.pending.get(id) !== w) return;
    this.pending.delete(id);
    clearTimeout(w.timer);
    w.done(r);
  }

  /** The preview was used: the time of the last request is kept (at most every few seconds), and so is the session awake. */
  private usedPreview(p: PreviewRow): PreviewRow {
    const now = this.now();
    const next = { ...p, requests: p.requests + 1, lastRequestAt: now };
    if (now - this.lastTouch >= PREVIEW_TOUCH_MS) {
      this.lastTouch = now;
      this.setPreview(next);
      const s = this.session;
      if (s.state === "open") this.setSession({ ...s, lastActivity: now });
      this.touch();
      void this.reschedule();
    }
    return next;
  }

  /**
   * One HTTP request for the dev server, passed to the runner over its socket. The door has already read the token (signature, expiry) and limited
   * the body; the room checks the nonce is this preview's, that it is open and ready, and answers 502/503/504 in words when the runner cannot.
   * Held until the runner has sent the whole answer (at most 10 MB), which is why the object stays awake meanwhile.
   */
  async previewHttp(req: PreviewHttpReq): Promise<Response> {
    const p = this.preview;
    if (!p || !sameHex(p.nonce, req.nonce)) return pvError(404, "preview_not_found", "There is no such preview.");
    if (p.state === "closed") return pvError(410, "preview_closed", "This preview has ended.");
    if (this.now() >= p.exp) { await this.closePreview("expired", { tellRunner: true }); return pvError(410, "preview_closed", "This preview has ended."); }
    if (p.state === "starting") return pvError(503, "preview_starting", "The dev server is still starting. Try again in a moment.", { "retry-after": "2" });
    if (!this.runnerSocket()) { await this.closePreview("runner_gone"); return pvError(502, "preview_closed", "The computer running the preview is gone."); }
    if (req.body && req.body.byteLength > PREVIEW_REQ_MAX_BYTES) return pvError(413, "request_too_large", "A request to a preview may carry 1 MB at most.");
    if (this.pending.size >= PREVIEW_PENDING_MAX) return pvError(503, "preview_busy", "The preview is busy. Try again.", { "retry-after": "1" });

    const id = `h${(this.httpSeq += 1).toString(36)}${this.now().toString(36)}`;
    const used = this.usedPreview(p);
    const headers = requestHeadersFor(req.headers, { publicHost: req.publicHost, port: p.port ?? 0 });
    const body = req.body && req.body.byteLength ? Buffer.from(req.body).toString("base64") : undefined;
    return new Promise<Response>((resolve) => {
      const w: PendingHttp = {
        method: req.method, parts: [], size: 0, done: resolve,
        timer: setTimeout(() => {
          this.toRunner({ t: "http-cancel", id });
          this.settle(id, w, pvError(504, "preview_timeout", FAILURE_STATUS.timeout[2]));
        }, PREVIEW_REQUEST_MS),
      };
      this.pending.set(id, w);
      const sent = this.toRunner({ t: "http", id, method: req.method, path: req.path, headers, ...(body ? { body } : {}) });
      if (!sent) this.settle(id, w, pvError(502, "preview_closed", "The computer running the preview is gone."));
      void used;
    });
  }

  /** The runner's answer to a request: the head, a piece of the body, or why there will be none. */
  private fromPreview(m: Extract<FromRunner, { t: "res" | "res-data" | "res-error" }>): void {
    const w = this.pending.get(m.id);
    if (!w) return;
    if (m.t === "res") {
      w.status = m.status;
      w.headers = m.headers;
      return;
    }
    if (m.t === "res-error") {
      const [status, code, message] = FAILURE_STATUS[m.code] ?? FAILURE_STATUS.failed;
      this.settle(m.id, w, pvError(status, code, message));
      return;
    }
    if (w.status === undefined) { this.settle(m.id, w, pvError(502, "preview_failed", FAILURE_STATUS.failed[2])); return; }
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)); } catch { this.settle(m.id, w, pvError(502, "preview_failed", FAILURE_STATUS.failed[2])); return; }
    w.size += bytes.length;
    if (w.size > PREVIEW_RES_MAX_BYTES) {
      this.toRunner({ t: "http-cancel", id: m.id });
      this.settle(m.id, w, pvError(FAILURE_STATUS.too_large[0], FAILURE_STATUS.too_large[1], FAILURE_STATUS.too_large[2]));
      return;
    }
    if (bytes.length) w.parts.push(bytes);
    if (!m.last) return;
    const headers = new Headers();
    for (const [k, v] of responseHeadersFor(w.headers ?? [])) { try { headers.append(k, v); } catch { /* a header the platform will not take is dropped */ } }
    const status = w.status >= 200 && w.status <= 599 ? w.status : 502;
    const noBody = w.method === "HEAD" || status === 204 || status === 205 || status === 304;
    const all = new Uint8Array(w.size);
    let at = 0;
    for (const part of w.parts) { all.set(part, at); at += part.length; }
    this.settle(m.id, w, new Response(noBody ? null : all, { status, headers }));
  }

  // ------------------------------------------------------- remote searches

  /** Asks the runner to search its checkout (a repo too big for a copy). Held for the runner's answer, at most a minute. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async forward(op: "grep" | "glob", args: Record<string, unknown>): Promise<any> {
    if (!this.runnerSocket()) return { kind: "unavailable", why: "no live session is open for this job, so there is nowhere to search a repo this big" };
    const id = `s${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const answer = new Promise<Extract<FromRunner, { t: "found" }> | null>((resolve) => {
      const timer = setTimeout(() => { this.searches.delete(id); resolve(null); }, SEARCH_TIMEOUT_MS);
      this.searches.set(id, (r) => { clearTimeout(timer); this.searches.delete(id); resolve(r); });
    });
    const sent = this.toRunner({ t: op, id, ...args } as ToRunner);
    if (!sent) { this.searches.delete(id); return { kind: "unavailable", why: "the runner is not connected" } ; }
    const r = await answer;
    if (!r) return { kind: "unavailable", why: "the runner did not answer in time" };
    if (!r.ok) return { kind: "error", error: r.error };
    if (op === "glob") return { kind: "ok", out: { ok: true, paths: r.paths ?? r.text.split("\n").filter(Boolean), total: r.total ?? r.paths?.length ?? 0, partial: r.partial === true } };
    return { kind: "ok", out: { ok: true, text: r.text, matches: r.matches ?? 0, files: r.files ?? 0, scanned: 0, partial: r.partial === true, ...(r.partial ? { why: "results" as const } : {}) } };
  }

  // ------------------------------------------------- sockets: the doorway

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return BAD(426, "upgrade_required", "This is a WebSocket.");
    const job = request.headers.get("x-room-job");
    if (job) this.remember(job);
    if (url.pathname === "/runner") return this.acceptRunner(request);
    if (url.pathname === "/watch") return this.acceptViewer(request);
    return BAD(404, "not_found", "No such route.");
  }

  /** A runner arrives with a ticket the Worker has already checked (signature, expiry, job). The room checks it is the one it expects, and once. */
  private async acceptRunner(request: Request): Promise<Response> {
    const step = Number(request.headers.get("x-room-step"));
    const epoch = Number(request.headers.get("x-room-epoch"));
    const nonce = request.headers.get("x-room-nonce") ?? "";
    const exp = Number(request.headers.get("x-room-exp"));
    const s = this.session;
    if (s.state !== "opening" && s.state !== "open") return BAD(409, "no_session", "This job is not waiting for a runner.");
    // The ticket was made for one step; a session that has been bound to another, or to a later lease of this one, is not this runner's.
    if (s.stepIdx !== undefined && s.stepIdx !== step) return BAD(409, "superseded", "That runner was for an earlier step.");
    if (s.epoch !== undefined && epoch < s.epoch) return BAD(409, "superseded", "That runner was for an earlier lease.");
    if (!nonce) return BAD(401, "bad_ticket", "That ticket is not valid.");
    // One use: the nonce is written down before the socket is accepted.
    this.sql.exec("DELETE FROM nonces WHERE exp < ?", this.now());
    if (this.sql.exec("SELECT 1 FROM nonces WHERE n = ?", nonce).toArray().length) return BAD(401, "used", "That ticket has been used.");
    const there = this.ctx.getWebSockets("runner");
    if (there.length) {
      // A later lease of the same step (the router moved it to another place) takes over; the same lease twice does not.
      if (s.epoch === undefined || epoch <= s.epoch) return BAD(409, "already_connected", "A runner is connected already.");
      for (const old of there) { try { old.send(JSON.stringify({ t: "close", reason: "superseded" } satisfies ToRunner)); old.close(4001, "superseded"); } catch { /* gone */ } }
      if (s.state === "open" && s.connectedAt) this.setMeta("used_ms", this.num("used_ms") + Math.max(0, this.now() - s.connectedAt));
      this.loseExecs("The computer running the session was replaced.");
      await this.closePreview("superseded");
    }
    this.sql.exec("INSERT INTO nonces (n, exp) VALUES (?, ?)", nonce, Number.isFinite(exp) ? exp : this.now() + 20 * 60_000);
    this.setSession({ ...this.session, state: "opening", stepIdx: step, epoch, connectedAt: undefined });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["runner"]);
    server.serializeAttachment({ stepIdx: step, epoch, hello: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async acceptViewer(request: Request): Promise<Response> {
    const user = request.headers.get("x-room-user") ?? "";
    if (!user) return BAD(401, "bad_ticket", "That ticket is not valid.");
    // A viewer or two per job is a person with the app open; more than a few is not.
    if (this.ctx.getWebSockets("viewer").length >= 8) return BAD(429, "too_many", "Too many views of this job are open.");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, ["viewer"]);
    server.serializeAttachment({ user });
    const events = this.sql.exec("SELECT json FROM events ORDER BY seq").toArray().flatMap((r) => { try { return [JSON.parse(String(r.json)) as ViewerEvent]; } catch { return []; } });
    const run = this.sql.exec("SELECT out FROM execs WHERE status = 'running' LIMIT 1").toArray()[0];
    const st = await this.status();
    server.send(JSON.stringify({ t: "snapshot", jobId: st.jobId ?? "", session: { state: st.session.state, ...(st.session.kind ? { kind: st.session.kind } : {}) }, remote: st.remote, ready: st.ready, events, ...(run ? { tail: String(run.out).slice(-VIEWER_OUT_CHARS) } : {}) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // --------------------------------------------- sockets: what they say

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text.length > MESSAGE_MAX_BYTES) { try { ws.close(1009, "too big"); } catch { /* gone */ } return; }
    if (tags.includes("runner")) await this.fromRunner(ws, text);
    else if (tags.includes("viewer")) await this.fromViewer(ws, text);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const tags = this.ctx.getTags(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason.slice(0, 100)); } catch { /* already closed */ }
    if (tags.includes("runner")) await this.runnerGone();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (this.ctx.getTags(ws).includes("runner")) await this.runnerGone();
  }

  /** The runner's socket closed. If the session was still open that was not the room's doing: what it was running is lost. */
  private async runnerGone(): Promise<void> {
    if (this.ctx.getWebSockets("runner").some((w) => { try { return w.readyState === 1; } catch { return false; } })) return;
    const s = this.session;
    if (s.state !== "open" && s.state !== "opening") return;
    if (s.state === "open" && s.connectedAt) this.setMeta("used_ms", this.num("used_ms") + Math.max(0, this.now() - s.connectedAt));
    this.loseExecs("The computer running the session disconnected.");
    await this.closePreview("runner_gone");
    this.setSession({ ...s, state: "closed", closeReason: "error" });
    this.event({ t: "session", state: "closed", reason: "error", at: this.now() });
    await this.reschedule();
    await this.wake("runner");
  }

  private async fromRunner(ws: WebSocket, text: string): Promise<void> {
    const m = parseFromRunner(text);
    if (!m) { try { ws.send(JSON.stringify({ t: "error", code: "bad_message", message: "That frame was not understood." })); } catch { /* gone */ } return; }
    const s = this.session;
    switch (m.t) {
      case "hello": {
        const att = (ws.deserializeAttachment() as { stepIdx?: number; epoch?: number } | null) ?? {};
        // The session moved on while this runner was arriving (it was superseded, or closed): it is not the one.
        if (s.state !== "opening" || att.stepIdx !== s.stepIdx || att.epoch !== s.epoch) {
          try { ws.send(JSON.stringify({ t: "close", reason: "superseded" } satisfies ToRunner)); ws.close(4001, "superseded"); } catch { /* gone */ }
          return;
        }
        ws.serializeAttachment({ ...att, hello: true });
        const now = this.now();
        this.setSession({ ...s, state: "open", kind: m.kind, connectedAt: now, lastActivity: now });
        this.touch();
        const maxSec = Math.max(1, Math.floor(s.remainingMs / 1000));
        ws.send(JSON.stringify({ t: "ready", v: 1, jobId: this.jobId() ?? "", idleSec: Math.round(s.idleMs / 1000), maxSec } satisfies ToRunner));
        this.event({ t: "session", state: "open", kind: m.kind, at: now });
        this.pump();
        // Nothing to wake the Workflow for: a command that was waiting for the runner has just been sent, and its result will wake it.
        await this.reschedule();
        return;
      }
      case "out": {
        this.sql.exec("UPDATE execs SET out = substr(out || ?, -?) WHERE tag = ? AND status = 'running'", m.data, OUTPUT_HOLD_CHARS, m.id);
        this.event({ t: "out", id: m.id, data: m.data.slice(-VIEWER_OUT_CHARS), at: this.now() }, false);
        return;
      }
      case "done": {
        const row = this.sql.exec("SELECT status FROM execs WHERE tag = ?", m.id).toArray()[0];
        if (!row || row.status !== "running") return;
        await this.endExec(m.id, { exitCode: m.exitCode, ms: m.ms, ...(m.note ? { note: m.note } : {}) });
        return;
      }
      case "found": {
        this.searches.get(m.id)?.(m);
        return;
      }
      case "error": {
        if (m.id) {
          const pending = this.searches.get(m.id);
          if (pending) { pending({ t: "found", id: m.id, ok: false, error: m.message }); return; }
          const row = this.sql.exec("SELECT status FROM execs WHERE tag = ?", m.id).toArray()[0];
          if (row && (row.status === "running" || row.status === "queued")) await this.endExec(m.id, { lost: `The runner said: ${short(m.message, 200)}` });
        }
        return;
      }
      case "bye":
        await this.closeSession("error");
        return;
      case "pong":
        return;
      case "res":
      case "res-data":
      case "res-error":
        this.fromPreview(m);
        return;
      case "preview": {
        const p = this.preview;
        if (!p || p.id !== m.id || p.state !== "starting") return;
        const now = this.now();
        if (m.ok) {
          this.setPreview({ ...p, state: "ready", port: m.port, readyAt: now, lastRequestAt: now });
          this.lastTouch = now;
          if (s.state === "open") this.setSession({ ...s, lastActivity: now });
          this.event({ t: "preview-ready", url: p.url, at: now });
          await this.reschedule();
        } else {
          this.setPreview({ ...p, error: short(m.error, 600) });
          await this.closePreview("failed");
        }
        // The job's Workflow is waiting to hear how it went.
        await this.wake("runner");
        return;
      }
      case "preview-ended": {
        const p = this.preview;
        if (!p || p.id !== m.id || p.state === "closed") return;
        await this.closePreview(short(m.reason, 100));
        await this.wake("runner");
        return;
      }
    }
  }

  private async fromViewer(ws: WebSocket, text: string): Promise<void> {
    const m = parseFromViewer(text);
    if (!m) { try { ws.send(JSON.stringify({ t: "error", code: "bad_message", message: "That frame was not understood." })); } catch { /* gone */ } return; }
    if (m.t === "ping") { try { ws.send(JSON.stringify({ t: "pong" })); } catch { /* gone */ } return; }
    const r = await this.message(m.text);
    if (!r.ok) { try { ws.send(JSON.stringify({ t: "error", code: "bad_message", message: r.why })); } catch { /* gone */ } }
  }

  // --------------------------------------------- the person's words, events

  /**
   * The person's word to the working job: kept until the loop takes it (the start of its next model turn), shown to any viewer, and the job's
   * Workflow woken so a job that is waiting for a runner or sleeping looks at once.
   */
  async message(text: string, jobId?: string): Promise<{ ok: true; id: string } | { ok: false; why: string }> {
    if (jobId) this.remember(jobId);
    const t = typeof text === "string" ? text.trim() : "";
    if (!t) return { ok: false, why: "Say something." };
    if (t.length > SAID_MAX_CHARS) return { ok: false, why: `At most ${SAID_MAX_CHARS} characters.` };
    const seq = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM inbox").one().n);
    const id = `m${seq}-${this.now()}`;
    this.sql.exec("INSERT INTO inbox (id, seq, text, at) VALUES (?, ?, ?, ?)", id, seq, t, this.now());
    this.sql.exec("DELETE FROM inbox WHERE seq <= ?", seq - SAID_KEEP * 2);
    this.touch();
    this.event({ t: "said", text: short(t, 500), at: this.now() });
    await this.wake("message");
    return { ok: true, id };
  }

  async inboxPending(): Promise<Array<{ id: string; text: string; at: number }>> {
    return this.sql.exec("SELECT id, text, at FROM inbox ORDER BY seq").toArray().map((r) => ({ id: String(r.id), text: String(r.text), at: Number(r.at) }));
  }

  async inboxAck(ids: string[]): Promise<void> {
    for (const id of ids.slice(0, 100)) this.sql.exec("DELETE FROM inbox WHERE id = ?", id);
  }

  /** A compact event from the agent loop for anyone watching. Best effort: nothing the loop does waits on it. */
  async publish(ev: ViewerEvent): Promise<void> {
    const clean = compact(ev);
    if (!clean) return;
    const first = this.meta("touched") === null;
    this.touch();
    this.event(clean);
    if (first) await this.reschedule();
  }

  /** Sends an event to every viewer, and keeps it for one that joins late (`keep`: false for output, which is too chatty to keep). */
  private event(ev: ViewerEvent, keep = true): void {
    if (keep) {
      this.sql.exec("INSERT INTO events (json) VALUES (?)", JSON.stringify(ev));
      this.sql.exec("DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?", VIEWER_BACKLOG);
    }
    const viewers = this.ctx.getWebSockets("viewer");
    if (!viewers.length) return;
    const frame = JSON.stringify(ev);
    for (const v of viewers) { try { v.send(frame); } catch { /* it closes by itself */ } }
  }

  // ------------------------------------------------------------ the end

  /** The job is over: the session is closed, viewers are told, and everything this room holds is deleted. */
  async endJob(): Promise<void> {
    await this.closeSession("job_end");
    this.event({ t: "end", why: "over", at: this.now() }, false);
    for (const ws of this.ctx.getWebSockets("viewer")) { try { ws.close(1000, "over"); } catch { /* gone */ } }
    await this.wipe();
  }

  private async wipe(): Promise<void> {
    this.preparing = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.inited = false;
  }

  // -------------------------------------------------------------- the alarm

  /** The next time something must happen with nobody asking: a session going idle or over its limit, a command past its time, a copy gone stale. */
  private nextAlarmAt(): number | null {
    const times: number[] = [];
    const s = this.session;
    if (s.state === "opening" && s.deadline) times.push(s.deadline);
    if (s.state === "open") {
      const running = this.sql.exec("SELECT deadline FROM execs WHERE status = 'running' LIMIT 1").toArray()[0];
      const queued = this.sql.exec("SELECT 1 FROM execs WHERE status = 'queued' LIMIT 1").toArray().length > 0;
      if (running) times.push(Number(running.deadline));
      // A preview that is open holds the session: it has its own idle time, from the last request, and the session's follows it.
      else if (!queued && !this.previewActive()) times.push(s.lastActivity + s.idleMs);
      if (s.connectedAt) times.push(s.connectedAt + s.remainingMs);
    }
    const pv = this.preview;
    if (pv && pv.state === "starting") times.push(Math.min(pv.exp, pv.startedAt + (pv.readySec + PREVIEW_START_GRACE_SEC) * 1000));
    if (pv && pv.state === "ready") times.push(Math.min(pv.exp, pv.lastRequestAt + pv.idleMs));
    // Anything the room holds (a copy, staged edits, commands and their output, a person's words) is deleted after six idle hours.
    if (this.meta("touched") !== null) times.push(this.num("touched") + WORKSPACE_IDLE_MS);
    return times.length ? Math.min(...times) : null;
  }

  private async reschedule(): Promise<void> {
    const at = this.nextAlarmAt();
    if (at === null) { await this.ctx.storage.deleteAlarm(); return; }
    const when = Math.max(at, this.now() + 1);
    if ((await this.ctx.storage.getAlarm()) === when) return;
    await this.ctx.storage.setAlarm(when);
  }

  async alarm(): Promise<void> {
    const now = this.now();
    // The preview first: when it closes for being unused, the session's own idle clock (from the last request) is read just after.
    const pv = this.preview;
    if (pv && pv.state === "starting" && now >= Math.min(pv.exp, pv.startedAt + (pv.readySec + PREVIEW_START_GRACE_SEC) * 1000)) {
      this.setPreview({ ...pv, error: "The dev server did not answer in time." });
      await this.closePreview("failed", { tellRunner: true });
      await this.wake("runner");
    } else if (pv && pv.state === "ready" && now >= Math.min(pv.exp, pv.lastRequestAt + pv.idleMs)) {
      await this.closePreview(now >= pv.exp ? "expired" : "idle", { tellRunner: true });
    }
    const s = this.session;
    if (s.state === "opening" && s.deadline && now >= s.deadline) {
      // Nobody came with the ticket in time: the Workflow is told, and falls back.
      this.loseExecs("No computer connected to the session in time.");
      this.setSession({ ...s, state: "closed", closeReason: "expired" });
      this.event({ t: "session", state: "closed", reason: "expired", at: now }, true);
      await this.wake("runner");
    } else if (s.state === "open") {
      const running = this.sql.exec("SELECT tag, deadline FROM execs WHERE status = 'running' LIMIT 1").toArray()[0];
      if (s.connectedAt && now >= s.connectedAt + s.remainingMs) {
        await this.closeSession("cap");
      } else if (running && now >= Number(running.deadline)) {
        this.toRunner({ t: "cancel", id: String(running.tag) });
        await this.endExec(String(running.tag), { lost: "It ran past its time and was stopped." });
      } else if (!running && !this.previewActive() && now >= s.lastActivity + s.idleMs && !this.sql.exec("SELECT 1 FROM execs WHERE status = 'queued' LIMIT 1").toArray().length) {
        await this.closeSession("idle");
      }
    }
    // A copy nobody has touched for six hours is deleted, whatever else is going on: we never keep a person's code.
    if (this.session.state !== "open" && this.meta("touched") !== null && now >= this.num("touched") + WORKSPACE_IDLE_MS) {
      await this.closeSession("job_end");
      await this.wipe();
      return;
    }
    await this.reschedule();
  }
}

// ----------------------------------------------------------------- helpers

/** A sink that writes a tarball's files into the room's SQLite, a few at a time in a transaction. */
class SqlSink implements WorkspaceSink {
  private files: HeldWrite[] = [];
  private skips: Array<[string, number, SkipReason]> = [];
  constructor(private readonly sql: SqlStorage, private readonly tx: <T>(fn: () => T) => T) {}

  file(f: HeldWrite): void {
    this.files.push(f);
    if (this.files.length >= 50) this.flush();
  }

  skipped(path: string, size: number, reason: SkipReason): void {
    this.skips.push([path, size, reason]);
    if (this.skips.length >= 90) this.flush();
  }

  flush(): void {
    if (!this.files.length && !this.skips.length) return;
    const files = this.files;
    const skips = this.skips;
    this.files = [];
    this.skips = [];
    this.tx(() => {
      for (const f of files) this.sql.exec("INSERT OR REPLACE INTO files (path, sha, size, content, mtime) VALUES (?, ?, ?, ?, ?)", f.path, f.sha, f.size, f.content, f.mtime);
      for (const [p, n, why] of skips) this.sql.exec("INSERT OR REPLACE INTO skipped (path, size, reason) VALUES (?, ?, ?)", p, n, why);
    });
  }
}

/** An event from the loop, shortened to what a live view shows. Null for one that is not a loop event. */
function compact(ev: unknown): ViewerEvent | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;
  const at = typeof e.at === "number" ? e.at : roomDeps.now();
  const s = (v: unknown, n: number) => (typeof v === "string" ? short(v, n) : "");
  switch (e.t) {
    case "phase": return { t: "phase", phase: s(e.phase, 40), at };
    case "tool": return { t: "tool", id: s(e.id, 120), name: s(e.name, 40), brief: s(e.brief, 160), at };
    case "result": return { t: "result", id: s(e.id, 120), ok: e.ok === true, brief: s(e.brief, 160), at };
    case "cost": return { t: "cost", spentPaise: Number(e.spentPaise) || 0, budgetPaise: Number(e.budgetPaise) || 0, at };
    case "end": return { t: "end", why: s(e.why, 40), at };
    // A lead's team board (code/team): a few fields for each part, and nothing of the person's code.
    case "team": return {
      t: "team", at,
      parts: (Array.isArray(e.parts) ? e.parts : []).slice(0, 12).flatMap((p) => {
        if (!p || typeof p !== "object") return [];
        const x = p as Record<string, unknown>;
        return [{ id: Number(x.id) || 0, title: s(x.title, 80), status: s(x.status, 20), ...(typeof x.jobId === "string" ? { jobId: s(x.jobId, 80) } : {}), spentPaise: Number(x.spentPaise) || 0, budgetPaise: Number(x.budgetPaise) || 0 }];
      }),
    };
    default: return null;
  }
}
