/**
 * The planted-answer leak (2026-10-28): a task's planted files (a bug, a stale test, a note) were one more commit over the project's real history, so
 * `git show HEAD`, `git log -S` or `git diff HEAD~1` gave the original code back, and models did that. A task with planted files is now a SNAPSHOT: one root
 * commit, only the objects of its tree, nothing borrowed. Its store key carries the fixture, so results from the leaky fixture are not reused.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalGitHub } from "../e2e/adapters/localGithub.js";
import { fixtureFingerprint, snapshotBase, type Task } from "../e2e/tasks/schema.js";
import { git } from "../e2e/util.js";

const ident = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };

describe("a task with planted files is a snapshot", () => {
  it("the local git host gives one commit with the planted file, and the original is in no object", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "snap-src-"));
    await git(src, ["init", "-q"]);
    fs.writeFileSync(path.join(src, "a.js"), "export const hops = (n) => n - 1; // the original, right\n");
    fs.writeFileSync(path.join(src, "b.js"), "export const b = 1;\n");
    await git(src, ["add", "-A"]);
    await git(src, ["commit", "-q", "-m", "fix the hops count"], { env: ident });
    const pin = (await git(src, ["rev-parse", "HEAD"])).trim();
    const original = (await git(src, ["rev-parse", "HEAD:a.js"])).trim();
    const gh = new LocalGitHub({ root: fs.mkdtempSync(path.join(os.tmpdir(), "snap-gh-")) });
    try {
      const repo = await gh.addRepo({ fullName: "u/snap", from: { objects: path.join(src, ".git", "objects"), commit: pin, snapshot: true, planted: { "a.js": "export const hops = (n) => n; // planted\n" } } });
      const head = (await repo.head(repo.defaultBranch))!;
      expect((await repo.g(["rev-list", "--all"])).trim().split("\n")).toEqual([head]);
      expect(await repo.fileAt(head, "a.js")).toContain("planted");
      expect(await repo.fileAt(head, "b.js")).toContain("b = 1");
      expect(fs.existsSync(path.join(repo.dir, "objects", "info", "alternates"))).toBe(false);
      const all = await repo.g(["cat-file", "--batch-all-objects", "--batch-check"]);
      expect(all).not.toContain(original);
      expect(all).not.toContain(pin);
      expect((await repo.g(["fsck", "--connectivity-only", "--no-dangling"])).trim()).toBe("");
    } finally { gh.dispose(); fs.rmSync(src, { recursive: true, force: true }); }
  });

  it("only a repos.json task with planted files is one, and only its key changes", () => {
    const base = { id: "t", repo: "express", base: { commit: "abc" } } as unknown as Task;
    const planted = { ...base, base: { commit: "abc", planted: { "lib/x.js": "bug" } } } as unknown as Task;
    const synthetic = { ...base, repo: "synthetic", base: { files: {}, planted: { "x.js": "y" } } } as unknown as Task;
    expect([snapshotBase(base), snapshotBase(planted), snapshotBase(synthetic)]).toEqual([false, true, false]);
    expect(fixtureFingerprint(base)).toBe("");
    expect(fixtureFingerprint(planted)).toBe("fixture:snapshot-1");
  });
});
