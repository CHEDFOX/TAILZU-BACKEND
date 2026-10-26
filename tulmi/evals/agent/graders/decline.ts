/**
 * DECLINE: asked for something Tailzu cannot do, it said so and did nothing.
 *
 * Nothing changed, nothing opened, no card, and the reply says it can't (in
 * any of the bench's languages: a Hindi request may be answered with one of
 * the server's English lines, and the language grader is the one to mind
 * that). Graded only when the task says `decline`.
 */
import type { GraderResult, Task, Trace } from "../types.js";
import { replyOf, result, saysCant } from "./facts.js";

export function gradeDecline(task: Task, trace: Trace): GraderResult {
  if (!task.expect.decline) return result("decline", true, "not a decline");
  const problems: string[] = [];
  if (trace.world.mutations.length) problems.push(`${trace.world.mutations.length} change(s) made`);
  if (trace.opened.length) problems.push(`opened ${trace.opened[0]!.slice(0, 60)}`);
  if (trace.approvals.length) problems.push(`proposed "${trace.approvals[0]!.preview}"`);
  const said = replyOf(trace);
  if (!saysCant(said)) problems.push(`never says it can't: ${JSON.stringify(said.slice(0, 120))}`);
  return problems.length ? result("decline", false, problems.join("; ")) : result("decline", true, "said it can't, did nothing");
}
