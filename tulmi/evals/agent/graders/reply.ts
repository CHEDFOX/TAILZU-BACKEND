/**
 * REPLY: what the person was told, every turn's `say` together, has what it
 * must, lacks what it must not, and is no longer than it may be.
 */
import { matches, shown } from "../match.js";
import type { GraderResult, Task, Trace } from "../types.js";
import { replyOf, result } from "./facts.js";

export function gradeReply(task: Task, trace: Trace): GraderResult {
  const r = task.expect.reply;
  if (!r) return result("reply", true, "not checked");
  const said = replyOf(trace);
  const problems: string[] = [];
  for (const m of r.mustContain ?? []) if (!matches(m, said)) problems.push(`missing ${shown(m)}`);
  for (const m of r.mustNotContain ?? []) if (matches(m, said)) problems.push(`says ${shown(m)}`);
  if (r.maxChars !== undefined && said.length > r.maxChars) problems.push(`${said.length} characters, more than ${r.maxChars}`);
  return problems.length
    ? result("reply", false, `${problems.join("; ")} in ${JSON.stringify(said.slice(0, 160))}`)
    : result("reply", true, "reply as expected");
}
