/**
 * THE FILES A JOB CHANGED THAT ITS TASK NEVER POINTED AT (src/code/agent/scope.ts). What these hold down:
 *   - what counts as pointed at: the plan's files, the located targets, a path written in the task, and what the index connects to those
 *     (their importers, what they import, the tests covering them);
 *   - what is never called a detour: a manifest or lockfile, a NEW file in the same folder, a test beside a related file; and that an
 *     EDIT to a file that merely shares the folder IS one, or a flat src/ would excuse everything;
 *   - a brain that cannot answer makes the set smaller, never the job worse;
 *   - the words: a guess said as a guess, naming the files, pointing at flag_finding, and capped in how many it lists.
 */
import { describe, expect, it } from "vitest";
import { SCOPE_SHOWN, outsideScope, scopeLine, scopeNote } from "../src/code/agent/scope.js";

/** A brain whose graph is given: who imports what, and which tests cover what. */
const brain = (o: { imports?: Record<string, string[]>; importedBy?: Record<string, string[]>; tests?: Record<string, string[]> } = {}) => ({
  neighbors: async (p: string) => ({ imports: o.imports?.[p] ?? [], importedBy: o.importedBy?.[p] ?? [] }),
  testsFor: async (p: string) => o.tests?.[p] ?? [],
});

/** Staged files, as the changeset holds them: an edit unless the name says it is new. */
const staged = (...paths: string[]) => paths.map((p) => ({ path: p.replace(/^\+/, ""), action: p.startsWith("+") ? ("create" as const) : ("edit" as const) }));

const PLANNED = { task: "make slug() trim dashes", plan: { steps: [{ n: 1, do: "edit slug", files: [{ path: "src/util.ts", action: "edit" as const }] }] } } as never;

describe("what the task pointed at", () => {
  it("is the plan's own files, so changing them is never a detour", async () => {
    expect(await outsideScope(PLANNED, staged("src/util.ts"), brain(), [])).toEqual([]);
  });

  it("is a file the located search chose, and a path the person wrote in the task", async () => {
    const located = { task: "fix the bug in src/api/users.ts", located: { targets: [{ path: "src/pay.ts" }] } } as never;
    expect(await outsideScope(located, staged("src/pay.ts", "src/api/users.ts"), brain(), [])).toEqual([]);
  });

  it("is what the index connects to those: a caller, something they import, a test of them", async () => {
    const g = brain({ importedBy: { "src/util.ts": ["src/caller.ts"] }, imports: { "src/util.ts": ["src/types.ts"] }, tests: { "src/util.ts": ["test/util.spec.ts"] } });
    expect(await outsideScope(PLANNED, staged("src/util.ts", "src/caller.ts", "src/types.ts", "test/util.spec.ts"), g, [])).toEqual([]);
  });

  it("is what the funnel points at, for a job with no plan and no located files", async () => {
    const bare = { task: "make the pill show the time" } as never;
    expect(await outsideScope(bare, staged("src/pill/clock.ts"), brain(), ["src/pill/clock.ts"])).toEqual([]);
  });

  it("is nothing at all when neither the task, a plan nor the funnel points anywhere: then nothing is called a detour", async () => {
    expect(await outsideScope({ task: "make it nicer" } as never, staged("src/anything.ts"), brain(), [])).toEqual([]);
  });
});

describe("what is left over", () => {
  it("is a file nothing connects to the task", async () => {
    expect(await outsideScope(PLANNED, staged("src/util.ts", "src/unrelated/legacy.ts"), brain(), [])).toEqual(["src/unrelated/legacy.ts"]);
  });

  it("is not a manifest or a lockfile: a dependency the work needed shows up there", async () => {
    expect(await outsideScope(PLANNED, staged("src/util.ts", "package.json", "package-lock.json"), brain(), [])).toEqual([]);
  });

  it("is not a NEW file in the same folder, nor a test beside a related file: that is how a project grows", async () => {
    const g = brain({ tests: { "src/util.ts": ["src/util.test.ts"] } });
    expect(await outsideScope(PLANNED, staged("src/util.ts", "+src/slug.ts", "src/util.test.ts"), g, [])).toEqual([]);
  });

  it("IS an EDIT to a file that only happens to share the folder: in a project whose source sits in one directory, the folder would excuse everything", async () => {
    expect(await outsideScope(PLANNED, staged("src/util.ts", "src/legacy.ts"), brain(), [])).toEqual(["src/legacy.ts"]);
  });

  it("is only smaller when the brain cannot answer, never a reason to fail", async () => {
    const broken = { neighbors: async () => { throw new Error("down"); }, testsFor: async () => { throw new Error("down"); } };
    expect(await outsideScope(PLANNED, staged("src/util.ts", "src/elsewhere/x.ts"), broken, [])).toEqual(["src/elsewhere/x.ts"]);
  });
});

describe("the words", () => {
  it("name the files, say it is often right, and point at flag_finding instead", () => {
    const note = scopeNote(["src/a.ts", "src/b.ts"])!;
    expect(note).toContain("src/a.ts, src/b.ts");
    expect(note).toContain("often right");
    expect(note).toContain("flag_finding");
    expect(note).toMatch(/put it back/);
  });

  it("are nothing when nothing is left over", () => {
    expect(scopeNote([])).toBeNull();
    expect(scopeLine([])).toBeNull();
  });

  it("stop naming after a few and say how many more", () => {
    const many = Array.from({ length: SCOPE_SHOWN + 4 }, (_, i) => `src/f${i}.ts`);
    expect(scopeNote(many)!).toContain(`and 4 more`);
    expect(scopeLine(many)!).toContain(`and 4 more`);
  });

  it("read as a heads-up for the report, not an accusation", () => {
    expect(scopeLine(["src/a.ts"])).toBe("Also changed, beyond what the task pointed at: src/a.ts. Worth a look first.");
  });
});
