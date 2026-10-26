/**
 * FINDINGS (src/code/work/findings.ts): what the checks say after a change, sorted against what they said before it.
 *
 *   broke           passed at baseline, fails now: a blocker
 *   already broken  failed at baseline too: flagged "was already broken before Tailzu", not ours
 *   fixed           failed at baseline, passes now
 *
 * New lint problems count only in the files the change touched; a lint problem is told from another by its file and
 * rule and not its line, which moves. And flagFinding: what the bot notices while reading, cleaned, and into the log.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { compareToBaseline, identityOf, pathOfFailure, flagFinding, cleanFinding, logComparison } = await import("../src/code/work/findings.js");
const { WorkLog, MemoryWorklogStore } = await import("../src/code/work/worklog.js");
type BaselineResult = import("../src/code/project/types.js").BaselineResult;

const r = (kind: BaselineResult["kind"], exitCode: number, failing?: string[], summary = ""): BaselineResult => ({ kind, exitCode, durationMs: 1000, summary, ...(failing ? { failing } : {}) });
const baselineOf = (...results: BaselineResult[]) => ({ plan: [], recorded: { headSha: "a".repeat(40), at: 1, results, healthy: results.every((x) => x.exitCode === 0) } });

describe("compareToBaseline: tests, by name", () => {
  it("sorts every failing test: broke it, already broken, fixed", () => {
    const base = baselineOf(r("test", 1, ["api > lists users", "api > deletes a user"]));
    const c = compareToBaseline(base, [r("test", 1, ["api > deletes a user", "signup > validates the email"])]);
    expect(c.broke.map((f) => f.name)).toEqual(["signup > validates the email"]);
    expect(c.alreadyBroken.map((f) => f.name)).toEqual(["api > deletes a user"]);
    expect(c.alreadyBroken[0]!.note).toBe("was already broken before Tailzu");
    expect(c.fixed.map((f) => f.name)).toEqual(["api > lists users"]);
    expect(c.ok).toBe(false);
    expect(c.checks).toEqual([{ kind: "test", status: "broke", exitCode: 1 }]);
    expect(c.summary).toBe("1 thing this change broke; 1 already broken before Tailzu; 1 fixed.");
  });

  it("a check that passed and fails now is all ours; a check that failed and passes now is all fixed", () => {
    const c = compareToBaseline(baselineOf(r("test", 0), r("lint", 1, ["src/a.ts:1:1 error x"])), [r("test", 1, ["t1", "t2"]), r("lint", 0)]);
    expect(c.broke.map((f) => f.name)).toEqual(["t1", "t2"]);
    expect(c.fixed.map((f) => f.name)).toEqual(["src/a.ts:1:1 error x"]);
    expect(c.checks).toEqual([{ kind: "test", status: "broke", exitCode: 1 }, { kind: "lint", status: "fixed", exitCode: 0 }]);
  });

  it("passing is passing, and install is not a check", () => {
    const c = compareToBaseline(baselineOf(r("test", 0), r("install", 0)), [r("test", 0), r("install", 1)]);
    expect(c).toMatchObject({ broke: [], alreadyBroken: [], fixed: [], ok: true, summary: "nothing this change broke." });
    expect(c.checks).toEqual([{ kind: "test", status: "passed", exitCode: 0 }]);
  });

  it("a test is the same test with or without its timing", () => {
    expect(identityOf("test", "adds up (12 ms)")).toBe(identityOf("test", "adds up (3ms)"));
    expect(identityOf("test", "Adds Up")).toBe(identityOf("test", "adds up"));
  });
});

describe("compareToBaseline: a check that names nothing", () => {
  it("is judged as a whole: red when it was green is ours, red when it was red is not", () => {
    const c = compareToBaseline(baselineOf(r("build", 0), r("typecheck", 2)), [r("build", 1, undefined, "failed to compile"), r("typecheck", 2)]);
    expect(c.broke).toEqual([{ kind: "build", name: "build" }]);
    expect(c.alreadyBroken).toEqual([{ kind: "typecheck", name: "typecheck", note: "was already broken before Tailzu" }]);
    expect(c.checks).toEqual([{ kind: "build", status: "broke", exitCode: 1 }, { kind: "typecheck", status: "already_broken", exitCode: 2 }]);
  });

  it("failing now with names, where the baseline was red and kept no names, cannot be blamed on the change", () => {
    const c = compareToBaseline(baselineOf(r("test", 1)), [r("test", 1, ["some test"])]);
    expect(c.broke).toEqual([]);
    expect(c.alreadyBroken[0]).toMatchObject({ name: "some test" });
    expect(c.alreadyBroken[0]!.note).toMatch(/cannot tell if its change made it worse/);
    expect(c.ok).toBe(true);
  });

  it("with no baseline at all, a failure is ours, and says why it is only assumed", () => {
    const c = compareToBaseline(null, [r("test", 1, ["t"]), r("build", 1)]);
    expect(c.broke).toEqual([{ kind: "test", name: "t", note: "no baseline was recorded for this check" }, { kind: "build", name: "build", note: "no baseline was recorded for this check" }]);
  });

  it("takes the baseline as the brain's record, as its results, or as nothing", () => {
    const results = [r("test", 1, ["t"])];
    const now = [r("test", 1, ["t"])];
    for (const b of [baselineOf(...results), results, { plan: [], recorded: null }, undefined]) {
      expect(() => compareToBaseline(b as never, now)).not.toThrow();
    }
    expect(compareToBaseline(results, now).alreadyBroken).toHaveLength(1);
    expect(compareToBaseline({ plan: [], recorded: null }, now).broke).toHaveLength(1);
  });
});

describe("compareToBaseline: lint counts only in the files the change touched", () => {
  const base = baselineOf(r("lint", 1, ["src/old.ts:3:1 error no-unused-vars", "src/a.ts:10:5 warning prefer-const"]));

  it("a new problem in a touched file is ours; in a file the change did not touch it is not counted", () => {
    const now = r("lint", 1, ["src/a.ts:40:2 error no-explicit-any", "src/other.ts:9:1 error no-explicit-any"]);
    const c = compareToBaseline(base, [now], { touched: ["src/a.ts"] });
    expect(c.broke.map((f) => f.name)).toEqual(["src/a.ts:40:2 error no-explicit-any"]);
    expect(c.ignored).toEqual([{ kind: "lint", name: "src/other.ts:9:1 error no-explicit-any", path: "src/other.ts", note: "in a file this change did not touch" }]);
    expect(c.summary).toContain("1 lint problem in files it did not touch, not counted");
  });

  it("a problem that was there before is still there when its line has moved", () => {
    const now = r("lint", 1, ["src/a.ts:14:5 warning prefer-const", "src/old.ts:3:1 error no-unused-vars"]);
    const c = compareToBaseline(base, [now], { touched: ["src/a.ts", "src/old.ts"] });
    expect(c.broke).toEqual([]);
    expect(c.alreadyBroken.map((f) => f.path)).toEqual(["src/a.ts", "src/old.ts"]);
    expect(c.ok).toBe(true);
  });

  it("only new lint debt in untouched files leaves the change clear", () => {
    const c = compareToBaseline(baselineOf(r("lint", 0)), [r("lint", 1, ["src/x.ts:1:1 error y"])], { touched: ["src/a.ts"] });
    expect(c.broke).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.checks[0]).toMatchObject({ kind: "lint", status: "passed" });
  });

  it("a problem's path and rule, whatever its form", () => {
    expect(pathOfFailure("src/a.ts:12:3 error x")).toBe("src/a.ts");
    expect(pathOfFailure("./src/a.ts(12,3): error TS2345")).toBe("src/a.ts");
    expect(pathOfFailure("a test name with no file")).toBeUndefined();
    expect(identityOf("lint", "src/a.ts:12:3 error no-explicit-any")).toBe(identityOf("lint", "src/a.ts:99:1 warning no-explicit-any"));
    expect(identityOf("lint", "src/a.ts:12:3 error no-explicit-any")).not.toBe(identityOf("lint", "src/a.ts:12:3 error prefer-const"));
  });
});

describe("logComparison and flagFinding", () => {
  const JOB = "7d444840-9dc0-4f6a-a8b1-1f2b8d5a8c01";

  it("writes each check with its verdict, a risk finding for what the change broke and an info one for what was broken already", async () => {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store });
    const now = [{ ...r("test", 1, ["signup > validates"]), cmd: "pnpm test" }, { ...r("lint", 1, ["src/a.ts:1:1 error x"]), cmd: "pnpm lint" }, { ...r("build", 0), cmd: "pnpm build" }];
    const c = compareToBaseline(baselineOf(r("test", 0), r("lint", 1, ["src/a.ts:9:9 error x"]), r("build", 0)), now, { touched: ["src/a.ts"] });
    await logComparison(log, c, now);
    const all = await store.list(JOB);
    expect(all.filter((e) => e.kind === "command").map((e) => [e.text, e.data?.verdict])).toEqual([["pnpm test", "broke"], ["pnpm lint", "already_broken"], ["pnpm build", undefined]]);
    const findings = all.filter((e) => e.kind === "finding");
    expect(findings.map((e) => e.data?.severity)).toEqual(["risk", "info"]);
    expect(findings[0]!.text).toMatch(/This change broke test: signup > validates/);
    expect(findings[1]!.text).toMatch(/was already broken before Tailzu/);
  });

  it("flagFinding cleans what the bot noticed, and writes it to the log", async () => {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store });
    const f = await flagFinding({ severity: "risk", path: "src/lib/api.ts", line: 12, text: "  SQL is built\nby joining strings  " }, { log });
    expect(f).toEqual({ severity: "risk", path: "src/lib/api.ts", line: 12, text: "SQL is built by joining strings" });
    expect(await store.list(JOB)).toEqual([expect.objectContaining({ kind: "finding", files: ["src/lib/api.ts"], data: { severity: "risk", path: "src/lib/api.ts", line: 12 } })]);
  });

  it("an unknown severity is info, a bad line is left out, and a finding with no words or no path is nothing", () => {
    expect(cleanFinding({ severity: "catastrophic", path: "a.ts", line: -3, text: "x" })).toEqual({ severity: "info", path: "a.ts", text: "x" });
    expect(cleanFinding({ severity: "warn", path: "a.ts", line: 1.5, text: "x" })).toEqual({ severity: "warn", path: "a.ts", text: "x" });
    expect(cleanFinding({ severity: "warn", path: "", text: "x" })).toBeNull();
    expect(cleanFinding({ severity: "warn", path: "a.ts", text: "   " })).toBeNull();
    expect(cleanFinding({ path: "a.ts", text: 5 })).toBeNull();
  });

  it("never keeps a secret it noticed", async () => {
    const key = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const f = await flagFinding({ severity: "risk", path: "src/config.ts", line: 3, text: `a token is committed: ${key}` });
    expect(f!.text).toBe("a token is committed: [redacted]");
  });
});
