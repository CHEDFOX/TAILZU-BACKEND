/**
 * THE WORDS OF THE LIVE SESSION: WHAT A RUNNER, A DEVICE AND AN APP SAY TO THE JOBS WORKER OVER A WEBSOCKET.
 *
 * Three sockets, each a stream of JSON text frames of at most 2 MB, each frame an object with a `t` (its type). The desktop app's side of
 * the first two is written out in docs/desktop-runner-session.md, which must say what this file says.
 *
 *   /v1/devices/connect       a PC's PRESENCE, kept open all day. Costs nothing while idle (hibernation). Ticket: kind "device"
 *   /v1/rooms/:jobId/runner   a RUNNER's SESSION with one job's room: commands in, output out. Ticket: kind "runner", one use
 *   /v1/rooms/:jobId/watch    the APP watching a job, and the person's words to it mid-task. Ticket: kind "viewer"
 *
 * A message that does not parse, has an unknown `t`, or has a field of the wrong kind is answered with an `error` frame and ignored: a
 * socket is not closed for one bad frame. Nothing here reaches a network.
 */

/** The one command of a session step. It is not run: it is the mark that says this step is a live session, not a command to run. */
export const SESSION_COMMAND = "tailzu:live-session";
export const isSessionCommands = (commands: readonly string[]): boolean => Array.isArray(commands) && commands.length === 1 && commands[0] === SESSION_COMMAND;

export const PROTOCOL_VERSION = 1;

export type CloseReason = "idle" | "cap" | "needs_you" | "job_end" | "superseded" | "expired" | "error";

export interface OverlayEntry { path: string; content: string | null }

// ---------------------------------------------------------- room -> runner

export type ToRunner =
  | { t: "ready"; v: 1; jobId: string; idleSec: number; maxSec: number }
  | { t: "exec"; id: string; commands: string[]; timeoutSec: number; overlay: OverlayEntry[]; discard: true }
  | { t: "cancel"; id: string }
  | { t: "grep"; id: string; pattern: string; path?: string; glob?: string; ignoreCase?: boolean; context?: number; filesOnly?: boolean; maxResults?: number }
  | { t: "glob"; id: string; pattern: string }
  | { t: "ping"; at: number }
  | { t: "close"; reason: CloseReason; message?: string }
  /**
   * PREVIEW: start the project's dev server in the background (after the checkout is reset and `overlay` laid, as for `exec`) and say when it
   * answers. `cmd` is the dev command; `port` is where it is known to listen (else the runner reads it from the output); `prepare` runs first
   * when there is no node_modules; `idleSec` is how long the room keeps the preview with no request (the runner stays for that long).
   */
  | { t: "preview"; id: string; cmd: string; port?: number; prepare?: string; readySec: number; idleSec: number; overlay: OverlayEntry[] }
  | { t: "preview-stop"; reason?: string }
  /** One HTTP request for the dev server. `body` is base64 (at most 1 MB raw). Answered by `res` and `res-data`, or `res-error`. */
  | { t: "http"; id: string; method: string; path: string; headers: Array<[string, string]>; body?: string }
  | { t: "http-cancel"; id: string };

// ---------------------------------------------------------- runner -> room

export type FromRunner =
  | { t: "hello"; v: 1; kind: "github" | "desktop"; name?: string; os?: string; node?: string }
  | { t: "out"; id: string; data: string }
  | { t: "done"; id: string; exitCode: number; ms: number; timedOut?: boolean; note?: string }
  | { t: "found"; id: string; ok: true; text: string; matches?: number; files?: number; partial?: boolean; paths?: string[]; total?: number }
  | { t: "found"; id: string; ok: false; error: string }
  | { t: "error"; id?: string; code: string; message: string }
  | { t: "pong"; at: number }
  | { t: "bye"; reason?: string }
  /** The dev server answers on `port` (`ms` after it was started), or it could not be started (`error`: a sentence, the end of its output redacted). */
  | { t: "preview"; id: string; ok: true; port: number; ms: number }
  | { t: "preview"; id: string; ok: false; error: string }
  /** The dev server is gone (it exited by itself, or an `exec` took the checkout). */
  | { t: "preview-ended"; id: string; reason: string }
  /** The head of a response, then its body in `res-data` pieces (base64, at most PREVIEW_CHUNK_BYTES each); `last` ends it. At most PREVIEW_RES_MAX_BYTES in all. */
  | { t: "res"; id: string; status: number; headers: Array<[string, string]> }
  | { t: "res-data"; id: string; data: string; last: boolean }
  | { t: "res-error"; id: string; code: PreviewFailure; message?: string };

/** Why a request to the dev server did not come back. */
export type PreviewFailure = "unreachable" | "timeout" | "too_large" | "bad_request" | "busy" | "failed";
export const PREVIEW_FAILURES: readonly PreviewFailure[] = ["unreachable", "timeout", "too_large", "bad_request", "busy", "failed"];

// ------------------------------------------------------ device <-> presence

export interface DeviceInfo {
  deviceId: string;
  name: string;
  allowRun: boolean;
  /** Project ids, or "all". */
  projects: string[] | "all";
  busy: boolean;
}

export type FromDevice =
  | ({ t: "hello"; v: 1; app?: string } & DeviceInfo)
  | ({ t: "state" } & Partial<Omit<DeviceInfo, "deviceId">>)
  | { t: "decline"; jobId: string; epoch: number; reason?: string }
  | { t: "bye" };

/** What a PC is offered: the router's RunnerStep (the repo access, the commands) and, for a live session, the way into the room. */
export interface DeviceOffer {
  jobId: string;
  stepIdx: number;
  epoch: number;
  commands: string[];
  timeoutSec: number;
  repo: Record<string, unknown>;
  overlay?: OverlayEntry[];
  discard?: true;
  /** A live session: connect here with this ticket (kind "runner"; one use). */
  session?: { url: string; ticket: string; expiresAt: number; idleSec: number; maxSec: number };
}

export type ToDevice =
  | { t: "ack"; v: 1; deviceId: string }
  | { t: "offer"; offer: DeviceOffer }
  | { t: "cancel"; jobId: string; epoch: number }
  | { t: "replaced" }
  | { t: "error"; code: string; message: string };

// --------------------------------------------------------- room -> viewer

export type ViewerEvent =
  | { t: "snapshot"; jobId: string; session: { state: string; kind?: string }; remote: boolean; ready: boolean; events: ViewerEvent[]; /** The end of the output of the command running now. */ tail?: string }
  | { t: "phase"; phase: string; at: number }
  | { t: "tool"; id: string; name: string; brief: string; at: number }
  | { t: "result"; id: string; ok: boolean; brief: string; at: number }
  | { t: "out"; id?: string; data: string; at: number }
  | { t: "cost"; spentPaise: number; budgetPaise: number; at: number }
  | { t: "session"; state: "opening" | "open" | "closed"; kind?: string; reason?: CloseReason; at: number }
  | { t: "said"; text: string; at: number }
  | { t: "end"; why: string; at: number }
  /** The project's own dev server is running on the job's runner, and this address shows it (docs/cloudflare-jobs.md "The preview"). Only the owner is sent it. */
  | { t: "preview-ready"; url: string; at: number }
  | { t: "preview-closed"; reason: string; at: number }
  | { t: "error"; code: string; message: string };

export type FromViewer = { t: "message"; text: string } | { t: "ping" };

// ------------------------------------------------------------------ parsing

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const int = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function json(raw: unknown, maxBytes: number): Obj | null {
  if (typeof raw !== "string" || raw.length > maxBytes) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return isObj(v) && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

const ID = /^[A-Za-z0-9._:/@-]{1,200}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const DEVICE_ID = /^[A-Za-z0-9._:-]{8,100}$/;

function projectsOf(v: unknown): string[] | "all" | null {
  if (v === "all") return "all";
  if (Array.isArray(v) && v.length <= 200 && v.every((p) => str(p, 64) && p.length > 0)) return v as string[];
  return null;
}

const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
/** Header names are tokens; values have no line breaks or control characters. */
// eslint-disable-next-line no-control-regex
const HEADER_VALUE_BAD = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
// eslint-disable-next-line no-control-regex
const PATH_BAD = /[\u0000-\u0020\u007f\\]/;

/** `[[name, value], …]`, at most `max` pairs, every pair well formed; null if not. */
function pairsOf(v: unknown, max: number): Array<[string, string]> | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: Array<[string, string]> = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [k, val] = p as [unknown, unknown];
    if (typeof k !== "string" || !HEADER_NAME.test(k) || typeof val !== "string" || val.length > 16 * 1024 || HEADER_VALUE_BAD.test(val)) return null;
    out.push([k, val]);
  }
  return out;
}

/** A path for the dev server: root-relative, no spaces, control characters or backslashes, not a scheme-relative `//host`. */
export const isPreviewPath = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 4000 && v.startsWith("/") && !v.startsWith("//") && !PATH_BAD.test(v);

/** A frame a runner sent, checked; null when it is not one. */
export function parseFromRunner(raw: unknown): FromRunner | null {
  const m = json(raw, 2 * 1024 * 1024);
  if (!m) return null;
  switch (m.t) {
    case "hello":
      if (m.v !== 1 || (m.kind !== "github" && m.kind !== "desktop")) return null;
      return { t: "hello", v: 1, kind: m.kind, ...(str(m.name, 80) ? { name: m.name } : {}), ...(str(m.os, 40) ? { os: m.os } : {}), ...(str(m.node, 40) ? { node: m.node } : {}) };
    case "out":
      return isId(m.id) && str(m.data, 256 * 1024) ? { t: "out", id: m.id, data: m.data } : null;
    case "done":
      return isId(m.id) && int(m.exitCode, -1_000_000, 1_000_000) && typeof m.ms === "number" && Number.isFinite(m.ms) && m.ms >= 0
        ? { t: "done", id: m.id, exitCode: m.exitCode, ms: Math.round(m.ms), ...(bool(m.timedOut) ? { timedOut: m.timedOut } : {}), ...(str(m.note, 500) ? { note: m.note } : {}) }
        : null;
    case "found":
      if (!isId(m.id)) return null;
      if (m.ok === false) return str(m.error, 1000) ? { t: "found", id: m.id, ok: false, error: m.error } : null;
      if (m.ok !== true || !str(m.text, 512 * 1024)) return null;
      return {
        t: "found", id: m.id, ok: true, text: m.text, ...(int(m.matches, 0, 1e9) ? { matches: m.matches } : {}), ...(int(m.files, 0, 1e9) ? { files: m.files } : {}),
        ...(bool(m.partial) ? { partial: m.partial } : {}),
        ...(Array.isArray(m.paths) && m.paths.length <= 5000 && m.paths.every((p) => str(p, 500)) ? { paths: m.paths as string[] } : {}), ...(int(m.total, 0, 1e9) ? { total: m.total } : {}),
      };
    case "error":
      return str(m.code, 60) && str(m.message, 1000) ? { t: "error", ...(isId(m.id) ? { id: m.id } : {}), code: m.code, message: m.message } : null;
    case "pong":
      return { t: "pong", at: typeof m.at === "number" ? m.at : 0 };
    case "bye":
      return { t: "bye", ...(str(m.reason, 200) ? { reason: m.reason } : {}) };
    case "preview":
      if (!isId(m.id)) return null;
      if (m.ok === true) return int(m.port, 1, 65535) && typeof m.ms === "number" && Number.isFinite(m.ms) && m.ms >= 0 ? { t: "preview", id: m.id, ok: true, port: m.port, ms: Math.round(m.ms) } : null;
      return m.ok === false && str(m.error, 2000) ? { t: "preview", id: m.id, ok: false, error: m.error } : null;
    case "preview-ended":
      return isId(m.id) && str(m.reason, 200) ? { t: "preview-ended", id: m.id, reason: m.reason } : null;
    case "res": {
      const headers = pairsOf(m.headers, 200);
      return isId(m.id) && int(m.status, 100, 599) && headers ? { t: "res", id: m.id, status: m.status, headers } : null;
    }
    case "res-data":
      return isId(m.id) && str(m.data, 400 * 1024) && bool(m.last) ? { t: "res-data", id: m.id, data: m.data, last: m.last } : null;
    case "res-error":
      return isId(m.id) && (PREVIEW_FAILURES as readonly unknown[]).includes(m.code) ? { t: "res-error", id: m.id, code: m.code as PreviewFailure, ...(str(m.message, 500) ? { message: m.message } : {}) } : null;
    default:
      return null;
  }
}

/** A frame the room sent a runner, checked (for a runner that wants to be sure, and for tests). */
export function parseToRunner(raw: unknown): ToRunner | null {
  const m = json(raw, 4 * 1024 * 1024);
  if (!m) return null;
  switch (m.t) {
    case "ready":
      return str(m.jobId, 100) && int(m.idleSec, 1, 86_400) && int(m.maxSec, 1, 86_400) ? { t: "ready", v: 1, jobId: m.jobId, idleSec: m.idleSec, maxSec: m.maxSec } : null;
    case "exec": {
      if (!isId(m.id) || !Array.isArray(m.commands) || !m.commands.length || m.commands.length > 20 || !m.commands.every((c) => str(c, 2000) && c.trim())) return null;
      if (!int(m.timeoutSec, 1, 3600) || !Array.isArray(m.overlay) || m.overlay.length > 200) return null;
      const overlay: OverlayEntry[] = [];
      for (const f of m.overlay) {
        if (!isObj(f) || !str(f.path, 500) || !f.path || (f.content !== null && typeof f.content !== "string")) return null;
        overlay.push({ path: f.path, content: f.content as string | null });
      }
      return { t: "exec", id: m.id, commands: m.commands as string[], timeoutSec: m.timeoutSec, overlay, discard: true };
    }
    case "cancel":
      return isId(m.id) ? { t: "cancel", id: m.id } : null;
    case "grep":
      return isId(m.id) && str(m.pattern, 1000) ? {
        t: "grep", id: m.id, pattern: m.pattern, ...(str(m.path, 500) ? { path: m.path } : {}), ...(str(m.glob, 200) ? { glob: m.glob } : {}),
        ...(bool(m.ignoreCase) ? { ignoreCase: m.ignoreCase } : {}), ...(int(m.context, 0, 5) ? { context: m.context } : {}),
        ...(bool(m.filesOnly) ? { filesOnly: m.filesOnly } : {}), ...(int(m.maxResults, 1, 500) ? { maxResults: m.maxResults } : {}),
      } : null;
    case "glob":
      return isId(m.id) && str(m.pattern, 200) ? { t: "glob", id: m.id, pattern: m.pattern } : null;
    case "preview": {
      if (!isId(m.id) || !str(m.cmd, 2000) || !m.cmd.trim() || !int(m.readySec, 5, 180) || !int(m.idleSec, 5, 3600) || !Array.isArray(m.overlay) || m.overlay.length > 200) return null;
      const overlay: OverlayEntry[] = [];
      for (const f of m.overlay) {
        if (!isObj(f) || !str(f.path, 500) || !f.path || (f.content !== null && typeof f.content !== "string")) return null;
        overlay.push({ path: f.path, content: f.content as string | null });
      }
      if (m.port !== undefined && !int(m.port, 1, 65535)) return null;
      if (m.prepare !== undefined && !str(m.prepare, 2000)) return null;
      return { t: "preview", id: m.id, cmd: m.cmd, ...(m.port !== undefined ? { port: m.port as number } : {}), ...(m.prepare ? { prepare: m.prepare as string } : {}), readySec: m.readySec, idleSec: m.idleSec, overlay };
    }
    case "preview-stop":
      return { t: "preview-stop", ...(str(m.reason, 100) ? { reason: m.reason } : {}) };
    case "http": {
      const headers = pairsOf(m.headers, 100);
      if (!isId(m.id) || typeof m.method !== "string" || !HTTP_METHODS.has(m.method) || !isPreviewPath(m.path) || !headers) return null;
      if (m.body !== undefined && (!str(m.body, 1_500_000) || !/^[A-Za-z0-9+/]*={0,2}$/.test(m.body))) return null;
      return { t: "http", id: m.id, method: m.method, path: m.path, headers, ...(m.body ? { body: m.body as string } : {}) };
    }
    case "http-cancel":
      return isId(m.id) ? { t: "http-cancel", id: m.id } : null;
    case "ping":
      return { t: "ping", at: typeof m.at === "number" ? m.at : 0 };
    case "close":
      return { t: "close", reason: (["idle", "cap", "needs_you", "job_end", "superseded", "expired", "error"].includes(String(m.reason)) ? m.reason : "error") as CloseReason, ...(str(m.message, 300) ? { message: m.message } : {}) };
    default:
      return null;
  }
}

/** A frame a device sent the presence object, checked. */
export function parseFromDevice(raw: unknown): FromDevice | null {
  const m = json(raw, 64 * 1024);
  if (!m) return null;
  switch (m.t) {
    case "hello": {
      const projects = projectsOf(m.projects);
      if (m.v !== 1 || typeof m.deviceId !== "string" || !DEVICE_ID.test(m.deviceId) || !bool(m.allowRun) || !projects) return null;
      return {
        t: "hello", v: 1, deviceId: m.deviceId, name: str(m.name, 80) && m.name.trim() ? m.name.trim() : "This computer", allowRun: m.allowRun, projects, busy: m.busy === true,
        ...(str(m.app, 60) ? { app: m.app } : {}),
      };
    }
    case "state": {
      const out: Extract<FromDevice, { t: "state" }> = { t: "state" };
      if (m.allowRun !== undefined) { if (!bool(m.allowRun)) return null; out.allowRun = m.allowRun; }
      if (m.busy !== undefined) { if (!bool(m.busy)) return null; out.busy = m.busy; }
      if (m.name !== undefined) { if (!str(m.name, 80)) return null; out.name = m.name.trim() || "This computer"; }
      if (m.projects !== undefined) { const p = projectsOf(m.projects); if (!p) return null; out.projects = p; }
      return out;
    }
    case "decline":
      return str(m.jobId, 64) && int(m.epoch, 0, Number.MAX_SAFE_INTEGER) ? { t: "decline", jobId: m.jobId, epoch: m.epoch, ...(str(m.reason, 200) ? { reason: m.reason } : {}) } : null;
    case "bye":
      return { t: "bye" };
    default:
      return null;
  }
}

/** A frame the app sent the room over the watch socket, checked. */
export function parseFromViewer(raw: unknown): FromViewer | null {
  const m = json(raw, 64 * 1024);
  if (!m) return null;
  if (m.t === "ping") return { t: "ping" };
  if (m.t === "message" && typeof m.text === "string") return { t: "message", text: m.text };
  return null;
}
