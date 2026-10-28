/**
 * The stratified sample: the smallest set of tasks that touches every category and every stage, weighted toward what failed before, with tasks that cannot run here
 * left out and said so. No key, no network.
 */
import { describe, expect, it } from "vitest";
import { loadTasks, type Task } from "../e2e/tasks/schema.js";
import { CATEGORIES_REQUIRED, PLAN_TASKS, STAGES_REQUIRED, expectsChange, planPool, sampleTasks, stagesOf } from "../e2e/reality/sampler.js";

const pool = planPool(loadTasks());

/** A minimal task: enough for the sampler. */
function task(id: string, category: Task["category"], over: Partial<Task> = {}): Task {
  return {
    id, title: id, category, repo: "r", base: {}, request: "do it", difficulty: 2, tags: [], truth: { files: category === "question" ? [] : ["a.js"] }, oracle: { kind: category === "question" ? "answer" : "patch" }, checks: {},
    ...over,
  } as Task;
}

describe("the pool", () => {
  it("is the 71 tasks on the real projects (65, and the six complex ones of 2026-10-28): no smoke task, no injection case", () => {
    expect(pool.length).toBe(71);
    expect(pool.some((t) => t.tags.includes("smoke") || t.tags.includes("injection-suite"))).toBe(false);
    for (const c of CATEGORIES_REQUIRED) expect(pool.some((t) => t.category === c), c).toBe(true);
  });
});

describe("what a task exercises", () => {
  it("a question has no locate, plan or commit; a change has all of them; only a screenshot task has design", () => {
    const q = pool.find((t) => t.category === "question")!;
    expect(expectsChange(q)).toBe(false);
    expect(stagesOf(q)).toEqual(["front", "work"]);
    const bug = pool.find((t) => t.category === "bug")!;
    expect(stagesOf(bug)).toEqual(["front", "locate", "plan", "work", "verify", "commit"]);
    const design = pool.filter((t) => stagesOf(t).includes("design"));
    expect(design.length).toBeGreaterThan(0);
    expect(design.every((t) => t.category === "ui")).toBe(true);
    const refusal = pool.find((t) => t.oracle.kind === "refuse")!;
    expect(expectsChange(refusal)).toBe(false);
  });
});

describe("the cover", () => {
  it("quick: about 12 tasks, the cover is the smallest set that has every category and every stage", () => {
    const s = sampleTasks({ tasks: pool, target: PLAN_TASKS.quick });
    expect(s.ordered.length).toBe(12);
    expect(s.cover.length).toBe(CATEGORIES_REQUIRED.length);
    expect(s.covered.categories).toEqual([...CATEGORIES_REQUIRED]);
    expect(s.covered.stages).toEqual([...STAGES_REQUIRED]);
    expect(s.uncovered).toEqual([]);
    // One task per category in the cover: it is the smallest, since a task has one category.
    expect(new Set(s.cover.map((t) => t.category)).size).toBe(s.cover.length);
    // The design stage is covered by the ui task that has it.
    expect(s.cover.some((t) => stagesOf(t).includes("design"))).toBe(true);
    expect(s.ordered.slice(0, s.cover.length)).toEqual(s.cover);
  });

  it("standard is about 24 and deep is all 71, each with the same cover first", () => {
    const q = sampleTasks({ tasks: pool, target: PLAN_TASKS.quick });
    const std = sampleTasks({ tasks: pool, target: PLAN_TASKS.standard });
    const deep = sampleTasks({ tasks: pool, target: PLAN_TASKS.deep });
    expect(std.ordered.length).toBe(24);
    expect(deep.ordered.length).toBe(71);
    expect(new Set(deep.ordered.map((t) => t.id)).size).toBe(71);
    expect(std.cover.map((t) => t.id)).toEqual(q.cover.map((t) => t.id));
    expect(std.ordered.slice(0, 12).map((t) => t.id)).toEqual(q.ordered.map((t) => t.id));
  });

  it("beyond the cover it keeps spreading, with the categories that failed before getting more (but none more than 8 of 24)", () => {
    const s = sampleTasks({ tasks: pool, target: 24 });
    const perCat = new Map<string, number>();
    for (const t of s.ordered) perCat.set(t.category, (perCat.get(t.category) ?? 0) + 1);
    expect(Math.max(...perCat.values())).toBeLessThanOrEqual(8);
    expect(Math.min(...[...perCat.values()])).toBeGreaterThanOrEqual(1);
    expect(new Set(s.ordered.map((t) => t.repo)).size).toBeGreaterThanOrEqual(6);
  });

  it("is the same twice", () => {
    expect(sampleTasks({ tasks: pool, target: 12 }).ordered.map((t) => t.id)).toEqual(sampleTasks({ tasks: [...pool].reverse(), target: 12 }).ordered.map((t) => t.id));
  });

  it("returns the whole pool when the target is bigger than it", () => {
    expect(sampleTasks({ tasks: pool.slice(0, 5), target: 50 }).ordered.length).toBe(5);
  });
});

describe("weighted toward what failed before", () => {
  const bugs = [task("bug-a", "bug"), task("bug-b", "bug"), task("bug-c", "bug")];
  const base = [task("q", "question"), task("f", "feature"), ...bugs];

  it("picks the bug that failed before to stand for the category", () => {
    const s = sampleTasks({ tasks: base, target: 4, history: new Map([["bug-b", { runs: 4, fails: 4 }], ["bug-a", { runs: 4, fails: 0 }]]) });
    expect(s.cover.find((t) => t.category === "bug")!.id).toBe("bug-b");
  });

  it("puts the categories that failed in the prior first in the order", () => {
    const s = sampleTasks({ tasks: pool, target: 12 });
    const first = s.ordered.slice(0, 3).map((t) => t.category);
    expect(first).toContain("question");
    expect(first).toContain("hostile");
  });

  it("a task already answered in the store costs nothing, so it stands for its category", () => {
    const s = sampleTasks({ tasks: [task("bug-a", "bug"), task("bug-b", "bug")], target: 1, answered: new Set(["bug-b"]), cost: () => 5 });
    expect(s.cover[0]!.id).toBe("bug-b");
  });

  it("of two equal tasks the cheaper is taken", () => {
    const s = sampleTasks({ tasks: [task("cheap", "bug"), task("dear", "bug")], target: 1, cost: (t) => (t.id === "dear" ? 9 : 1) });
    expect(s.cover[0]!.id).toBe("cheap");
  });
});

describe("tasks that cannot run here", () => {
  it("are skipped with the reason, and their category is covered by another task of it", () => {
    const blocked = new Map(pool.filter((t) => t.repo === "express").map((t) => [t.id, "needs a session where installs are allowed"] as [string, string]));
    const s = sampleTasks({ tasks: pool, target: 12, blocked });
    expect(s.skipped.length).toBe(blocked.size);
    expect(s.skipped[0]!.reason).toBe("needs a session where installs are allowed");
    expect(s.ordered.some((t) => blocked.has(t.id))).toBe(false);
    expect(s.covered.categories).toEqual([...CATEGORIES_REQUIRED]);
  });

  it("a category with no runnable task is reported as uncovered, and the rest is still sampled", () => {
    const blocked = new Map(pool.filter((t) => t.category === "ui").map((t) => [t.id, "needs a session where installs are allowed"] as [string, string]));
    const s = sampleTasks({ tasks: pool, target: 12, blocked });
    expect(s.uncovered).toContain("category ui");
    expect(s.uncovered).toContain("stage design");
    expect(s.ordered.length).toBe(12);
  });
});
