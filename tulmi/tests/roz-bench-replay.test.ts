/**
 * Every task with a cassette, replayed through the phone's real Ask: the
 * recorded answers of a live run, played back for free.
 *
 * A replay must run (the bench does not break on it) and must come out as the
 * recording did: the same hard graders failing, trial by trial, when the
 * cassette kept them. So a change to the server that alters what happens
 * after the model answers shows up here, without paying for a model. A call
 * whose request changed since the recording (a prompt, a tool card) is a
 * stale cassette, and its test is skipped, not failed: re-record once the
 * prompts are settled. No cassettes at all is one skipped test.
 */
import { describe, expect, it, vi } from "vitest";
import { benchEnv, benchTokens, People } from "../evals/agent/env.js";
import { loadTasks } from "../evals/agent/loader.js";
import { CASSETTE_DIR, readCassette, recordedTrials } from "../evals/agent/model/cassette.js";

const net = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => { net.calls.push("chat"); throw new Error("Roz Bench tests never call a model"); } } };
  },
}));

const TAPED = (await loadTasks()).flatMap((task) => {
  const tape = readCassette(CASSETTE_DIR, task.id);
  return "cassette" in tape ? [{ task, cassette: tape.cassette }] : [];
});
const TOKENS = benchTokens(Math.max(1, TAPED.reduce((n, x) => n + recordedTrials(x.cassette), 0)));
Object.assign(process.env, benchEnv({ people: TOKENS.length, offline: true }));
vi.stubGlobal("fetch", async (url: unknown) => { net.calls.push(`fetch ${String(url)}`); throw new Error("Roz Bench tests never reach the network"); });

const { runTrial } = await import("../evals/agent/harness.js");
const { ReplayAdapter } = await import("../evals/agent/model/replay.js");
const { grade, hardFailures } = await import("../evals/agent/graders/index.js");

const people = new People(TOKENS);

describe("every recorded task, replayed", () => {
  if (!TAPED.length) {
    it.skip("no cassettes yet: npm run bench:record writes them, once the prompts are settled", () => {});
    return;
  }

  for (const { task, cassette } of TAPED) {
    it(task.id, async (ctx) => {
      for (let trial = 0; trial < recordedTrials(cassette); trial++) {
        const trace = await runTrial({ task, trial, mode: "replay", model: new ReplayAdapter(cassette, trial), token: people.take() });
        if (trace.skipped) ctx.skip();
        expect(trace.error, `${task.id} trial ${trial}: the bench broke`).toBeUndefined();
        const failed = hardFailures(grade(task, trace));
        const recorded = cassette.graded?.[String(trial)];
        if (recorded) expect(failed, `${task.id} trial ${trial} no longer ends as it was recorded`).toEqual(recorded);
      }
    });
  }

  it("made no model call and touched no network", () => expect(net.calls).toEqual([]));
});
