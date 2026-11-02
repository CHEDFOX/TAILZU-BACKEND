/**
 * Each project's code, kept for the chat (code/project/copies.ts): kept and read back from disk, held in memory under a cap, dropped, swept,
 * and searched whole by the agent's grep, where the GitHub path stopped at 60 files (the missed caller of the App Review replay, 2026-11-02).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodeCopies, CopyFiles } from "../src/code/project/copies.js";
import { Tools, GITHUB_GREP_FILES_MAX } from "../src/code/agent/tools.js";
import { initialState } from "../src/code/agent/types.js";
import { FakeWorkspace, fakeLog } from "./live-fakes.js";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const dirs: string[] = [];
async function tmp(): Promise<string> { const d = await fs.mkdtemp(path.join(os.tmpdir(), "copies-")); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

/** A project of `n` files, the one that calls initMeta last of all (as SduiApp.tsx sorts after 60 others). */
function bigProject(n = 120): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < n - 1; i++) files.set(`app/src/a${String(i).padStart(3, "0")}.ts`, `export const v${i} = ${i};\n`);
  files.set("app/src/telemetry/meta.ts", "export function initMeta(): void {}\n");
  files.set("app/src/zz/SduiApp.tsx", 'import { initMeta } from "../telemetry/meta";\nuseEffect(() => { initMeta(); }, []);\n');
  return files;
}

describe("the copies", () => {
  it("keep a project's code on disk, gzipped, and read it back after a restart", async () => {
    const dir = await tmp();
    await new CodeCopies({ dir }).put(P1, "sha1", new Map([["src/a.ts", "const a = 1;\n"]]));
    const st = await fs.stat(path.join(dir, `${P1}.json.gz`));
    expect(st.size).toBeGreaterThan(0);
    const back = await new CodeCopies({ dir }).get(P1);
    expect(back?.sha).toBe("sha1");
    expect(back?.files.get("src/a.ts")).toBe("const a = 1;\n");
  });

  it("never write outside their folder for an id that is not a project's", async () => {
    const dir = await tmp();
    const c = new CodeCopies({ dir });
    await c.put("../../etc/x", "sha", new Map([["a", "b"]]));
    expect(await fs.readdir(dir)).toEqual([]);
    expect(await c.get("../../etc/x")).toBeNull();
  });

  it("hold in memory only up to the cap, letting the longest unused go; without a folder that is all there is", async () => {
    const c = new CodeCopies({ dir: null, memoryBytes: 25 });
    await c.put(P1, "s1", new Map([["a", "x".repeat(10)]]));
    await c.put(P2, "s2", new Map([["a", "x".repeat(10)]]));
    await c.get(P1);                                        // P1 used: P2 is now the longest unused
    await c.put(P3, "s3", new Map([["a", "x".repeat(10)]]));
    expect(await c.get(P2)).toBeNull();
    expect((await c.get(P1))?.sha).toBe("s1");
    expect((await c.get(P3))?.sha).toBe("s3");
  });

  it("go with the project, from memory and disk", async () => {
    const dir = await tmp();
    const c = new CodeCopies({ dir });
    await c.put(P1, "s1", new Map([["a", "b"]]));
    await c.drop(P1);
    expect(await c.get(P1)).toBeNull();
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("are swept when unused for a month, and past the disk cap the longest unused first", async () => {
    const dir = await tmp();
    let now = Date.UTC(2026, 10, 2);
    const c = new CodeCopies({ dir, now: () => now, unusedMs: 30 * 86_400_000 });
    await c.put(P1, "s1", new Map([["a", "old"]]));
    await c.put(P2, "s2", new Map([["a", "new"]]));
    const month = new Date(now - 31 * 86_400_000);
    await fs.utimes(path.join(dir, `${P1}.json.gz`), month, month);
    expect(await c.sweep()).toBe(1);
    expect((await fs.readdir(dir)).sort()).toEqual([`${P2}.json.gz`]);

    now += 1000;
    const capped = new CodeCopies({ dir, now: () => now, diskBytes: 1 });
    expect(await capped.sweep()).toBe(1);
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe("a copy, read by the agent's tools", () => {
  it("answers grep from every file and reads from what it holds; a folder's listing, a glob and a file it lacks go to GitHub", async () => {
    const files = new CopyFiles({ sha: "s", files: bigProject(), bytes: 1 });
    expect((await files.status()).ready).toBe(true);
    const g = await files.grep("initMeta\\(\\)", {});
    expect(g.kind === "ok" && g.out.text).toMatch(/app\/src\/zz\/SduiApp\.tsx:2:/);
    expect((await files.read("app/src/zz/SduiApp.tsx", {})).kind).toBe("ok");
    expect((await files.read("assets/logo.png", {})).kind).toBe("unavailable");
    expect((await files.list()).kind).toBe("unavailable");
    expect((await files.glob()).kind).toBe("unavailable");
  });

  it("finds the caller in file 121 that the GitHub search, stopping at 60, never reached", async () => {
    const repo = Object.fromEntries(bigProject());
    expect(Object.keys(repo).length).toBeGreaterThan(GITHUB_GREP_FILES_MAX);
    const tools = (files?: CopyFiles) => new Tools({
      userId: "u", projectId: "p", state: initialState("task", 0), ws: new FakeWorkspace(repo) as never, brain: {} as never, log: fakeLog(),
      web: { run: async () => ({ ok: false, message: { content: "no" } }) } as never,
      runStep: async () => { throw new Error("no runs"); }, closedSource: false, now: () => 1000, ...(files ? { files } : {}),
    });
    const call = { id: "c1", name: "grep", arguments: JSON.stringify({ pattern: "initMeta\\(\\);" }) };

    const without = await tools().exec(call);
    expect(without.content).toMatch(/No match/);
    expect(without.content).toMatch(/only 60 of 121 files were searched/);

    const withCopy = await tools(new CopyFiles({ sha: "s", files: bigProject(), bytes: 1 })).exec(call);
    expect(withCopy.content).toMatch(/1 line matches/);
    expect(withCopy.content).not.toMatch(/PARTIAL/);
    expect(withCopy.data).toMatch(/app\/src\/zz\/SduiApp\.tsx:2:/);
  });
});
