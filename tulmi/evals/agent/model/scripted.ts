/**
 * THE SCRIPTED PLANNER: a task's reference answers, call by call.
 *
 * Each planner call of a trial is answered with the next entry of the task's
 * `scripted.calls` (or one of its `controls`), whole, as one chunk; a call
 * past the end is answered "DONE". No network, no key, no time.
 *
 * This is how CI proves a task can be passed at all. Everything after the
 * planner is the server's real code against the bench's Google, so a task
 * whose reference cannot meet its own checks (a wrong date, a preview no card
 * can show, a world change the tools cannot make) fails the day it is
 * written. And a control, a known-bad answer, proves the graders it names
 * would catch that answer from a real model.
 */
import type { PlanChunk } from "../../../src/agent/llm.js";
import type { ModelCallTrace, ScriptedModel } from "../types.js";
import { TracedAdapter } from "./adapter.js";

export const SCRIPTED_MODEL = "scripted";

export class ScriptedAdapter extends TracedAdapter {
  protected readonly models = [SCRIPTED_MODEL];
  private next = 0;

  constructor(private readonly script: ScriptedModel) {
    super();
  }

  protected async *answer(trace: ModelCallTrace): AsyncGenerator<PlanChunk> {
    const text = this.script.calls[this.next++] ?? "DONE";
    trace.model = SCRIPTED_MODEL;
    yield { model: SCRIPTED_MODEL, delta: `${text}\n` };
  }
}
