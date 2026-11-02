/**
 * A COPY OF EACH PROJECT'S CODE, KEPT, SO THE CHAT SEARCHES ALL OF IT.
 *
 * The chat's grep had no copy of the code: it fetched files from GitHub one at a time and stopped at 60 (agent/tools.ts grepViaGithub), so
 * "who calls initMeta?" came back "no match" when the caller was file 61, and an answer was built on that. A build of the project's brain
 * (build.ts) already holds the text of every file worth reading, and threw it away. Now it is kept:
 *
 *   put(projectId, sha, files)   after a build: the files' text, at that commit, gzipped to one file (`<dir>/<projectId>.json.gz`)
 *   get(projectId)               the copy, from memory, else from disk; null when there is none
 *   files(projectId)             the copy as a LiveFiles for the agent's tools: grep and read answer from it; list and glob, and a read of a
 *                                file it does not hold (a binary, a file over the size cap), say "unavailable", and the tools ask GitHub as before
 *   drop(projectId)              the project is disconnected, or its owner's account deleted
 *   sweep()                      a copy unused for 30 days goes (the next build makes it again); past the disk cap, the longest unused first
 *
 * Measured (2026-11-02): a project is 0.1 to 8 MB on disk (this server's own code, 28 MB of text, is 7.7), and a grep of all of it 4 to 27 ms.
 * In memory only the copies being read now, up to MEMORY_BYTES of text; the longest unused is let go first. Without a folder (tests, a laptop)
 * the copies live in memory only, under the same cap. A copy is the files the build chose to read (snapshot.ts): never a .env, a key, a binary.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import type { OverlayFile } from "../jobs/types.js";
import type { LiveFiles, LiveGlob, LiveGrep, LiveList, LiveRead, LiveStatus } from "../live/ports.js";
import { byPath, grepFiles, readLines, type GrepOptions } from "../live/search.js";

const zip = promisify(gzip);
const unzip = promisify(gunzip);

export const COPY_MEMORY_BYTES = 300 * 1024 * 1024;
export const COPY_UNUSED_MS = 30 * 86_400_000;
export const COPY_DISK_BYTES = 20 * 1024 * 1024 * 1024;
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CodeCopy { sha: string; files: Map<string, string>; bytes: number }

export interface CodeCopiesOptions {
  /** Where the copies are kept; null: in memory only. */
  dir: string | null;
  memoryBytes?: number;
  unusedMs?: number;
  diskBytes?: number;
  now?: () => number;
}

const bytesOf = (files: Map<string, string>): number => { let n = 0; for (const t of files.values()) n += t.length; return n; };

export class CodeCopies {
  private readonly mem = new Map<string, CodeCopy & { used: number }>();
  private memBytes = 0;
  private readonly now: () => number;

  constructor(private readonly o: CodeCopiesOptions) {
    this.now = o.now ?? Date.now;
  }

  private file(projectId: string): string | null {
    return this.o.dir && PROJECT_ID.test(projectId) ? path.join(this.o.dir, `${projectId.toLowerCase()}.json.gz`) : null;
  }

  /** Keep the copy of a project at a commit, in place of the one before. */
  async put(projectId: string, sha: string, files: Map<string, string>): Promise<void> {
    if (!PROJECT_ID.test(projectId)) return;
    const copy: CodeCopy = { sha, files, bytes: bytesOf(files) };
    this.remember(projectId, copy);
    const file = this.file(projectId);
    if (!file) return;
    await fs.mkdir(this.o.dir!, { recursive: true });
    const tmp = `${file}.${process.pid}.${this.now()}.tmp`;
    await fs.writeFile(tmp, await zip(JSON.stringify({ v: 1, sha, files: [...files] })));
    await fs.rename(tmp, file);
  }

  /** The kept copy, or null. Reading it counts as using it (the sweep keeps what is used). */
  async get(projectId: string): Promise<CodeCopy | null> {
    const hit = this.mem.get(projectId);
    if (hit) { hit.used = this.now(); this.mem.delete(projectId); this.mem.set(projectId, hit); return hit; }
    const file = this.file(projectId);
    if (!file) return null;
    try {
      const raw = JSON.parse((await unzip(await fs.readFile(file))).toString("utf8")) as { v?: number; sha?: unknown; files?: unknown };
      if (raw.v !== 1 || typeof raw.sha !== "string" || !Array.isArray(raw.files)) return null;
      const files = new Map<string, string>(raw.files.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string"));
      const copy: CodeCopy = { sha: raw.sha, files, bytes: bytesOf(files) };
      this.remember(projectId, copy);
      const t = new Date(this.now());
      await fs.utimes(file, t, t).catch(() => undefined);
      return copy;
    } catch {
      return null;
    }
  }

  /** The project is gone (disconnected, or its owner's account deleted): its copy goes too. */
  async drop(projectId: string): Promise<void> {
    const had = this.mem.get(projectId);
    if (had) { this.memBytes -= had.bytes; this.mem.delete(projectId); }
    const file = this.file(projectId);
    if (file) await fs.rm(file, { force: true }).catch(() => undefined);
  }

  /** Copies unused for a month go; past the disk cap, the longest unused go first. Returns how many went. */
  async sweep(): Promise<number> {
    if (!this.o.dir) return 0;
    let names: string[];
    try { names = (await fs.readdir(this.o.dir)).filter((n) => n.endsWith(".json.gz")); } catch { return 0; }
    const found = (await Promise.all(names.map(async (n) => {
      const st = await fs.stat(path.join(this.o.dir!, n)).catch(() => null);
      return st ? { id: n.slice(0, -".json.gz".length), used: st.mtimeMs, size: st.size } : null;
    }))).filter((x): x is { id: string; used: number; size: number } => !!x).sort((a, b) => a.used - b.used);
    const old = this.now() - (this.o.unusedMs ?? COPY_UNUSED_MS);
    let total = found.reduce((n, f) => n + f.size, 0);
    let gone = 0;
    for (const f of found) {
      if (f.used >= old && total <= (this.o.diskBytes ?? COPY_DISK_BYTES)) continue;
      await this.drop(f.id);
      total -= f.size;
      gone += 1;
    }
    return gone;
  }

  /** The copy for the agent's tools, or null when there is none. */
  async files(projectId: string): Promise<LiveFiles | null> {
    const copy = await this.get(projectId);
    return copy ? new CopyFiles(copy) : null;
  }

  private remember(projectId: string, copy: CodeCopy): void {
    const had = this.mem.get(projectId);
    if (had) { this.memBytes -= had.bytes; this.mem.delete(projectId); }
    const cap = this.o.memoryBytes ?? COPY_MEMORY_BYTES;
    if (copy.bytes > cap) return;
    this.mem.set(projectId, { ...copy, used: this.now() });
    this.memBytes += copy.bytes;
    for (const [id, c] of this.mem) {
      if (this.memBytes <= cap) break;
      if (id === projectId) continue;
      this.mem.delete(id);
      this.memBytes -= c.bytes;
    }
  }
}

/**
 * A kept copy as the agent's tools read a job's room (live/ports.ts): grep searches every file it holds, read answers from it. What it cannot
 * say for sure (a folder's whole listing, a glob, a file it does not hold) is "unavailable", and the tools go to GitHub, which has the whole tree.
 */
export class CopyFiles implements LiveFiles {
  private overlay: OverlayFile[] = [];

  constructor(private readonly copy: CodeCopy) {}

  async status(): Promise<LiveStatus> {
    return { ready: true, remote: false, files: this.copy.files.size, bytes: this.copy.bytes, headSha: this.copy.sha };
  }

  async setOverlay(files: readonly OverlayFile[]): Promise<void> { this.overlay = files.map((f) => ({ ...f })); }

  async read(p: string, o: { offset?: number; limit?: number }): Promise<LiveRead> {
    const staged = this.overlay.find((f) => f.path === p);
    if (staged) return staged.content === null ? { kind: "missing", deleted: true } : { kind: "ok", out: readLines(staged.content, o.offset, o.limit), staged: true };
    const text = this.copy.files.get(p);
    return text === undefined ? { kind: "unavailable" } : { kind: "ok", out: readLines(text, o.offset, o.limit), staged: false };
  }

  async list(): Promise<LiveList> { return { kind: "unavailable" }; }

  async glob(): Promise<LiveGlob> { return { kind: "unavailable" }; }

  async grep(pattern: string, o: GrepOptions): Promise<LiveGrep> {
    const view = new Map(this.copy.files);
    for (const f of this.overlay) { if (f.content === null) view.delete(f.path); else view.set(f.path, f.content); }
    const out = grepFiles([...view].map(([p, content]) => ({ path: p, content })).sort(byPath), pattern, o);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }
}
