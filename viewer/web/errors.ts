/**
 * Everything that goes wrong in the viewer or in the artifact ends up as one `error` message to the parent.
 *
 * Positions are mapped back to the artifact's ORIGINAL source: each piece of code the viewer runs is registered under its
 * blob URL with a function that takes a (line, col) in the running code to a (line, col) in the original text.
 */
import type { FrameMsg } from "../../tulmi/src/artifacts/protocol.js";

export type ErrorKind = "compile" | "runtime" | "import" | "limit";

/** (line, col) in the code that ran → (line, col) in the original artifact source. Both 1-based. */
export type Locator = (line: number, col: number) => { line: number; col: number } | undefined;

/** A problem to show the bot: what kind, what, and where in the original source. */
export class ViewerError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public line?: number,
    public col?: number,
    public viewerStack?: string,
  ) {
    super(message);
    this.name = "ViewerError";
  }
}

const sources = new Map<string, Locator>();

/** Only the newest few are kept: a long stream compiles the source again and again, and each locator holds a copy of it. */
const MAX_SOURCES = 12;

export function registerSource(url: string, locate: Locator): void {
  sources.set(url, locate);
  while (sources.size > MAX_SOURCES) sources.delete(sources.keys().next().value!);
}

export function clearSources(): void {
  sources.clear();
}

const BLOB_FRAME = /(blob:[^\s()@]+?):(\d+):(\d+)/g;

/** The first stack frame that is in code the viewer knows, mapped to the original source. */
export function locateInStack(stack: string | undefined): { line: number; col: number } | undefined {
  if (!stack) return undefined;
  for (const m of stack.matchAll(BLOB_FRAME)) {
    const locate = sources.get(m[1]!);
    if (!locate) continue;
    const at = locate(Number(m[2]), Number(m[3]));
    if (at) return at;
  }
  return undefined;
}

/** Position for a script error event: from its stack, else from its file/line/col. */
export function locateEvent(file: string | undefined, line: number | undefined, col: number | undefined, stack: string | undefined): { line: number; col: number } | undefined {
  const fromStack = locateInStack(stack);
  if (fromStack) return fromStack;
  if (file && line && sources.has(file)) return sources.get(file)!(line, col ?? 1);
  return undefined;
}

const MAX_PER_LOAD = 50;

export interface Reporter {
  report(kind: ErrorKind, message: string, extra?: { line?: number; col?: number; stack?: string }): void;
  reportError(e: unknown, fallbackKind?: ErrorKind): void;
  /** A new artifact: errors are counted afresh. */
  reset(): void;
  /** Ignore `error` events from this script URL: the caller reports its failure itself. Returns the way to stop. */
  mute(file: string): () => void;
  /** Watch a window (the shell's, or an html artifact's own) for errors the artifact code throws. */
  watch(win: Window): void;
}

export function createReporter(post: (m: FrameMsg) => void): Reporter {
  let count = 0;
  const seen = new Map<string, number>();

  const report: Reporter["report"] = (kind, message, extra = {}) => {
    const key = `${kind}|${message}|${extra.line ?? ""}:${extra.col ?? ""}`;
    const now = Date.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < 2000) return;
    seen.set(key, now);
    if (seen.size > 200) seen.clear();
    if (++count > MAX_PER_LOAD) return;
    const msg: Extract<FrameMsg, { t: "error" }> = { t: "error", kind, message: String(message).slice(0, 2000) };
    if (extra.line) msg.line = extra.line;
    if (extra.col) msg.col = extra.col;
    if (extra.stack) msg.stack = String(extra.stack).slice(0, 4000);
    post(msg);
  };

  const reportError: Reporter["reportError"] = (e, fallbackKind = "runtime") => {
    if (e instanceof ViewerError) {
      report(e.kind, e.message, { line: e.line, col: e.col, stack: e.viewerStack });
      return;
    }
    const err = e as { message?: unknown; stack?: unknown } | null;
    const message = typeof err?.message === "string" ? err.message : String(e);
    const stack = typeof err?.stack === "string" ? err.stack : undefined;
    report(fallbackKind, message, { ...locateInStack(stack), stack });
  };

  const muted = new Set<string>();
  const watched = new WeakSet<Window>();
  const watch: Reporter["watch"] = (win) => {
    if (watched.has(win)) return;
    watched.add(win);
    win.addEventListener("error", (e: ErrorEvent) => {
      if (muted.has(e.filename)) return;
      const err = e.error as { message?: unknown; stack?: unknown } | null | undefined;
      const message = typeof err?.message === "string" ? err.message : e.message || "Script error.";
      const stack = typeof err?.stack === "string" ? err.stack : undefined;
      report("runtime", message, { ...locateEvent(e.filename, e.lineno, e.colno, stack), stack });
    });
    win.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: unknown; stack?: unknown } | string | undefined;
      const message = typeof r === "string" ? r : typeof r?.message === "string" ? r.message : "Unhandled promise rejection";
      const stack = typeof r === "object" && typeof r?.stack === "string" ? r.stack : undefined;
      report("runtime", message, { ...locateInStack(stack), stack });
    });
    // The CSP says no to something: say so to the bot, in words it can act on.
    win.addEventListener("securitypolicyviolation", (e: SecurityPolicyViolationEvent) => {
      const what = e.blockedURI && e.blockedURI !== "inline" ? e.blockedURI : e.effectiveDirective;
      if (e.effectiveDirective.startsWith("connect-src")) {
        report("runtime", `Blocked: artifacts have no network access (tried to reach ${what}). Keep data inside the artifact, or use window.tailzu.storage / window.tailzu.ask.`);
      } else if (e.effectiveDirective.startsWith("script-src")) {
        report("import", `Blocked ${what === "eval" ? "eval / new Function" : what === "inline" ? "an inline script or event handler" : "script " + what}: artifacts can only run their own code and the bundled libraries.`);
      } else if (e.effectiveDirective.startsWith("img-src") || e.effectiveDirective.startsWith("font-src") || e.effectiveDirective.startsWith("style-src")) {
        report("runtime", `Blocked ${e.effectiveDirective.split("-")[0]} from ${what}: only https images, data: images and Google Fonts are allowed.`);
      }
    });
  };

  return {
    report,
    reportError,
    reset() {
      count = 0;
      seen.clear();
    },
    mute(file) {
      muted.add(file);
      return () => void muted.delete(file);
    },
    watch,
  };
}
