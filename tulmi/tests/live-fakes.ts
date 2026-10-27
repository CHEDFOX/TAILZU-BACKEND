/**
 * FAKES FOR THE LIVE SESSION'S TESTS IN TULMI: A ROOM THAT ANSWERS FROM A MAP (with the real search code, which is what the real room puts in front of
 * SQLite), and the little of a workspace and a work log that the agent's tools need.
 */
import { ConnectorError } from "../src/connectors/state.js";
import type { OverlayFile } from "../src/code/jobs/types.js";
import type { LiveFiles, LiveGlob, LiveGrep, LiveList, LiveRead, LiveStatus } from "../src/code/live/ports.js";
import { skipReason } from "../src/code/live/rules.js";
import { byPath, globPaths, grepFiles, listDir, readLines, type GrepOptions } from "../src/code/live/search.js";
import { WorkLog, MemoryWorklogStore } from "../src/code/work/index.js";

/** A job's copy of the code, from a map. Every call is written down. */
export class FakeRoom implements LiveFiles {
  readonly calls: Array<{ op: string; args: unknown[] }> = [];
  overlay: OverlayFile[] = [];
  /** What `status` says; flip `remote` or `ready` to test the fallbacks. */
  state: LiveStatus = { ready: true, remote: false, files: 0, bytes: 0, headSha: "a".repeat(40) };
  /** Calls fail like a room that is down. */
  down = false;
  resets = 0;
  /** What a remote room's runner answers to a grep. */
  remoteGrep: LiveGrep = { kind: "unavailable", why: "no live session is open" };

  constructor(readonly files: Record<string, string>) {
    this.state.files = Object.keys(files).length;
  }

  private note(op: string, ...args: unknown[]): void { this.calls.push({ op, args }); }
  count(op: string): number { return this.calls.filter((c) => c.op === op).length; }

  /** The held files with the staged edits laid over them. */
  private view(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [p, c] of Object.entries(this.files)) if (skipReason(p, c.length || 1) === null) m.set(p, c);
    for (const f of this.overlay) { if (f.content === null) m.delete(f.path); else m.set(f.path, f.content); }
    return m;
  }

  async status(): Promise<LiveStatus> { this.note("status"); if (this.down) throw new Error("down"); return { ...this.state }; }
  async setOverlay(files: readonly OverlayFile[]): Promise<void> { this.note("setOverlay", files); this.overlay = files.map((f) => ({ ...f })); }
  async reset(): Promise<void> { this.note("reset"); this.resets += 1; }

  async read(path: string, o: { offset?: number; limit?: number }): Promise<LiveRead> {
    this.note("read", path, o);
    if (this.down) return { kind: "unavailable" };
    const staged = this.overlay.find((f) => f.path === path);
    if (staged) return staged.content === null ? { kind: "missing", deleted: true } : { kind: "ok", out: readLines(staged.content, o.offset, o.limit), staged: true };
    const text = this.view().get(path);
    if (text !== undefined) return { kind: "ok", out: readLines(text, o.offset, o.limit), staged: false };
    if (path in this.files) return { kind: "skipped", reason: skipReason(path, this.files[path]!.length || 1) ?? "skipped" };
    return { kind: "missing", deleted: false };
  }

  async list(dir: string): Promise<LiveList> {
    this.note("list", dir);
    if (this.down) return { kind: "unavailable" };
    const out = listDir([...this.view().keys()], dir);
    return out ? { kind: "ok", out } : { kind: "empty" };
  }

  async glob(pattern: string): Promise<LiveGlob> {
    this.note("glob", pattern);
    if (this.down) return { kind: "unavailable" };
    const recent = new Map(this.overlay.map((f, i) => [f.path, 1e15 + i]));
    const out = globPaths([...this.view().keys()], pattern, recent);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }

  async grep(pattern: string, o: GrepOptions): Promise<LiveGrep> {
    this.note("grep", pattern, o);
    if (this.down) return { kind: "unavailable" };
    if (this.state.remote) return this.remoteGrep;
    const out = grepFiles([...this.view()].map(([path, content]) => ({ path, content })).sort(byPath), pattern, o);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }
}

/** The part of a workspace the tools read through: a map of files (as GitHub would give them) and its tree. Every read is counted. */
export class FakeWorkspace {
  reads: string[] = [];
  treeCalls = 0;
  constructor(readonly files: Record<string, string>, readonly o: { truncated?: boolean } = {}) {}

  async tree() {
    this.treeCalls += 1;
    return { entries: Object.entries(this.files).map(([path, text]) => ({ path, type: "blob" as const, sha: "s".repeat(40), size: text.length })), truncated: this.o.truncated === true };
  }
  async read(path: string) {
    this.reads.push(path);
    const text = this.files[path];
    if (text === undefined) throw new ConnectorError("not_found", `I couldn't find ${path}.`);
    return { path, size: text.length, text };
  }
}

export const fakeLog = (jobId = "job-1") => new WorkLog(jobId, { store: new MemoryWorklogStore() });
