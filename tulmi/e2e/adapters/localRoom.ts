/**
 * LocalRoom: A JOB'S COPY OF THE CODE FOR INSTANT read, list, glob AND grep, THE WAY THE CLOUDFLARE ROOM (jobs/src/jobRoom.ts) ANSWERS THE AGENT.
 *
 * The real room holds a copy of the work branch's head in a Durable Object and puts the staged edits over every answer; the text-searching is
 * code/live/search.ts, shared with the room, so this class only has to HOLD the files. It reads them from the LocalGitHub repo with one
 * `git cat-file --batch` process, applies the rules about what a room never holds (vendored folders, lockfiles, binaries, secrets: live/rules.ts),
 * and answers through the same LiveFiles shapes.
 *
 * Opening it is lazy (the first need), like the real room; `reset()` after a commit throws the copy away so the next need makes it from the new head.
 */
import { spawn } from "node:child_process";
import type { OverlayFile } from "../../src/code/jobs/types.js";
import type { LiveFiles, LiveGlob, LiveGrep, LiveList, LiveRead, LiveStatus } from "../../src/code/live/ports.js";
import { skipReason } from "../../src/code/live/rules.js";
import { byPath, globPaths, grepFiles, listDir, readLines, type GrepOptions } from "../../src/code/live/search.js";
import type { LocalRepo } from "./localGithub.js";

/** Every blob of a commit's tree, read with a single git process. */
export async function snapshotTexts(repo: LocalRepo, commit: string, o: { maxBytes?: number } = {}): Promise<{ files: Map<string, string>; skipped: number; bytes: number }> {
  const listing = (await repo.g(["ls-tree", "-r", "-l", "-z", "--full-tree", commit])).split("\0").filter(Boolean);
  const wanted: Array<{ sha: string; path: string; size: number }> = [];
  let skipped = 0;
  for (const row of listing) {
    const m = /^(\d+) (\w+) ([0-9a-f]{40})\s+(\d+)\t(.+)$/s.exec(row);
    if (!m || m[2] !== "blob") continue;
    const size = Number(m[4]);
    if (skipReason(m[5]!, size || 1) !== null) { skipped += 1; continue; }
    wanted.push({ sha: m[3]!, path: m[5]!, size });
  }
  const files = new Map<string, string>();
  let bytes = 0;
  if (!wanted.length) return { files, skipped, bytes };
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], { cwd: repo.dir, env: { ...process.env, GIT_DIR: repo.dir } });
    let buf = Buffer.alloc(0);
    let i = 0;
    let need = -1;
    const max = o.maxBytes ?? 60 * 1024 * 1024;
    child.stdout.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (need < 0) {
          const nl = buf.indexOf(0x0a);
          if (nl < 0) return;
          const head = buf.subarray(0, nl).toString("utf8");
          buf = buf.subarray(nl + 1);
          const m = /^[0-9a-f]{40} (\w+) (\d+)$/.exec(head);
          need = m ? Number(m[2]) : 0;
        }
        if (buf.length < need + 1) return;
        const item = wanted[i]!;
        const body = buf.subarray(0, need);
        buf = buf.subarray(need + 1);
        need = -1;
        i += 1;
        if (!body.includes(0) && bytes + body.length <= max) {
          files.set(item.path, body.toString("utf8"));
          bytes += body.length;
        } else skipped += 1;
        if (i >= wanted.length) { child.stdin.end(); }
      }
    });
    child.on("error", reject);
    child.on("close", () => resolve());
    child.stdin.write(`${wanted.map((w) => w.sha).join("\n")}\n`);
  });
  return { files, skipped, bytes };
}

export class LocalRoom implements LiveFiles {
  readonly calls: Array<{ op: string; at: number }> = [];
  private base: Map<string, string> | null = null;
  private overlay: OverlayFile[] = [];
  private head = "";
  private opening: Promise<void> | null = null;
  resets = 0;

  /** `branchHead` is read when the copy is made, so a reset picks up a commit. */
  constructor(private readonly repo: LocalRepo, private readonly branch: string) {}

  private note(op: string): void { this.calls.push({ op, at: Date.now() }); }
  count(op: string): number { return this.calls.filter((c) => c.op === op).length; }

  private open(): Promise<void> {
    if (this.base) return Promise.resolve();
    this.opening ??= (async () => {
      const head = await this.repo.head(this.branch);
      if (!head) { this.base = new Map(); return; }
      const snap = await snapshotTexts(this.repo, head);
      this.head = head;
      this.base = snap.files;
    })().finally(() => { this.opening = null; });
    return this.opening;
  }

  /** The held files with the staged edits laid over them. */
  private view(): Map<string, string> {
    const m = new Map(this.base ?? []);
    for (const f of this.overlay) { if (f.content === null) m.delete(f.path); else m.set(f.path, f.content); }
    return m;
  }

  async status(): Promise<LiveStatus> {
    this.note("status");
    await this.open();
    let bytes = 0;
    for (const t of this.base!.values()) bytes += t.length;
    return { ready: true, remote: false, files: this.base!.size, bytes, headSha: this.head };
  }
  async setOverlay(files: readonly OverlayFile[]): Promise<void> { this.note("setOverlay"); this.overlay = files.map((f) => ({ ...f })); }
  async reset(): Promise<void> { this.note("reset"); this.resets += 1; this.base = null; this.overlay = []; }

  async read(path: string, o: { offset?: number; limit?: number }): Promise<LiveRead> {
    this.note("read");
    await this.open();
    const staged = this.overlay.find((f) => f.path === path);
    if (staged) return staged.content === null ? { kind: "missing", deleted: true } : { kind: "ok", out: readLines(staged.content, o.offset, o.limit), staged: true };
    const text = this.base!.get(path);
    if (text !== undefined) return { kind: "ok", out: readLines(text, o.offset, o.limit), staged: false };
    // In the repo but not held (vendored, a lockfile, binary, too big): GitHub can still be asked.
    const there = await this.repo.fileAt(this.head || this.branch, path);
    if (there !== null) return { kind: "skipped", reason: skipReason(path, there.length || 1) ?? "skipped" };
    return { kind: "missing", deleted: false };
  }

  async list(dir: string): Promise<LiveList> {
    this.note("list");
    await this.open();
    const out = listDir([...this.view().keys()], dir);
    return out ? { kind: "ok", out } : { kind: "empty" };
  }

  async glob(pattern: string): Promise<LiveGlob> {
    this.note("glob");
    await this.open();
    const recent = new Map(this.overlay.map((f, i) => [f.path, 1e15 + i]));
    const out = globPaths([...this.view().keys()], pattern, recent);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }

  async grep(pattern: string, o: GrepOptions): Promise<LiveGrep> {
    this.note("grep");
    await this.open();
    const out = grepFiles([...this.view()].map(([path, content]) => ({ path, content })).sort(byPath), pattern, o);
    return out.ok ? { kind: "ok", out } : { kind: "error", error: out.error };
  }
}
