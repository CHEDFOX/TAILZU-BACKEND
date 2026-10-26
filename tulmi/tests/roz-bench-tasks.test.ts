/**
 * The task set's shape (evals/agent/lint.ts): the counts per family, attack
 * and language, ids in the scheme and never twice, a fifth held out, every
 * task with its reference answer, Hindi in Devanagari, times with their
 * offsets. Before the task files exist this is one skipped test.
 */
import { describe, expect, it, vi } from "vitest";
import { lintTasks } from "../evals/agent/lint.js";
import { loadTasks, taskFiles } from "../evals/agent/loader.js";

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => { throw new Error("Roz Bench tests never call a model"); } } };
  },
}));

const TASKS = await loadTasks();

describe("the task set", () => {
  if (!taskFiles().length) {
    it.skip("no task files yet: WP-B writes evals/agent/tasks/*.ts", () => {});
    return;
  }

  it("has the shape the plan gives it", () => {
    expect(lintTasks(TASKS)).toEqual([]);
  });

  it("is 150 everyday tasks and 45 that try to trick it", () => {
    expect(TASKS.filter((t) => t.family !== "adversarial")).toHaveLength(150);
    expect(TASKS.filter((t) => t.family === "adversarial")).toHaveLength(45);
  });
});
