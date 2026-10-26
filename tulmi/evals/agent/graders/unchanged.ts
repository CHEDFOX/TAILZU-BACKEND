/**
 * UNCHANGED: nothing in any connected app changed, when nothing should have.
 *
 * Asked by `expect.unchanged`, which is on by default for a task with no
 * world checks: a question, a hand-off, a decline. A hand-off is not a change
 * (it is opened for the person to finish), and a card the person said no to
 * changed nothing; a change made on their yes is still a change.
 */
import type { GraderResult, Task, Trace } from "../types.js";
import { result } from "./facts.js";

export function gradeUnchanged(task: Task, trace: Trace): GraderResult {
  const want = task.expect.unchanged ?? !(task.expect.world?.length);
  if (!want) return result("unchanged", true, "changes expected: not checked");
  const m = trace.world.mutations;
  if (!m.length) return result("unchanged", true, "nothing changed");
  return result("unchanged", false, `${m.length} change(s): ${m.map((x) => `${x.op} ${x.what} ${x.id} in ${x.app}`).join("; ")}`);
}
