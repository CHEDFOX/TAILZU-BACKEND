/**
 * Every task in the set, run through the phone's real Ask with its reference
 * answers (scripted mode): the proof that each task can be passed at all.
 *
 * A task without `xfail` must pass every hard grader; a task marked for M2
 * must fail at least one (one that passes has been fixed early: take the mark
 * off); and every control, a known-bad answer, must fail the graders it
 * names, which proves those graders would catch it from a real model. No
 * network, no key, no model. Before the task files exist this is one skipped
 * test.
 */
import { describe, expect, it, vi } from "vitest";
import { benchEnv, benchTokens, People } from "../evals/agent/env.js";
import { loadTasks } from "../evals/agent/loader.js";

const net = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => { net.calls.push("chat"); throw new Error("Roz Bench tests never call a model"); } } };
  },
}));

const TASKS = await loadTasks();
const TRIALS = TASKS.reduce((n, t) => n + 1 + (t.controls?.length ?? 0), 0);
const TOKENS = benchTokens(Math.max(1, TRIALS));
Object.assign(process.env, benchEnv({ people: TOKENS.length, offline: true }));
vi.stubGlobal("fetch", async (url: unknown) => { net.calls.push(`fetch ${String(url)}`); throw new Error("Roz Bench tests never reach the network"); });

const { runTrial } = await import("../evals/agent/harness.js");
const { ScriptedAdapter } = await import("../evals/agent/model/scripted.js");
const { grade, hardFailures } = await import("../evals/agent/graders/index.js");
type Task = import("../evals/agent/types.js").Task;

const people = new People(TOKENS);
const run = (task: Task, calls: string[]) => runTrial({ task, trial: 0, mode: "scripted", model: new ScriptedAdapter({ calls }), token: people.take() });

describe("every task, with its reference answers", () => {
  if (!TASKS.length) {
    it.skip("no task files yet: WP-B writes evals/agent/tasks/*.ts", () => {});
    return;
  }

  for (const task of TASKS) {
    it(task.id, async () => {
      const trace = await run(task, task.scripted.calls);
      expect(trace.error, `${task.id}: the bench broke`).toBeUndefined();
      const failed = hardFailures(grade(task, trace));
      if (task.xfail) {
        expect(failed.length, `${task.id} passes: XPASS, take the xfail off (${task.xfail.why})`).toBeGreaterThan(0);
      } else {
        const why = grade(task, trace).filter((g) => failed.includes(g.id)).map((g) => `${g.id}: ${g.detail}`).join("\n");
        expect(failed, `${task.id} fails with its own reference answer:\n${why}`).toEqual([]);
      }
      for (const c of task.controls ?? []) {
        const ct = await run(task, c.scripted.calls);
        expect(ct.error, `${task.id} control "${c.name}": the bench broke`).toBeUndefined();
        const missed = c.mustFail.filter((id) => !hardFailures(grade(task, ct)).includes(id));
        expect(missed, `${task.id} control "${c.name}" was not caught by`).toEqual([]);
      }
    });
  }

  it("made no model call and touched no network", () => expect(net.calls).toEqual([]));
});
