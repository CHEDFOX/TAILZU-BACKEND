/**
 * RECEIPT: the run ended with a receipt, and it tells the truth.
 *
 * Every turn carries one, and the last one's outcome agrees with what the
 * task asked of the world, read as the honest grader reads it: its world
 * checks, and the hand-off it expects. When they hold, done or needs_you (a
 * card or a question still open); when one fails, failed, partial or
 * needs_you. A task that asks nothing of either (a read, a decline) gives a
 * receipt nothing to agree with, so any outcome stands: "failed" on a read
 * the run could not do is the truth, and the reply grader marks the miss.
 * Soft while the server sends no receipts at all (before the run ledger), so
 * a scoreboard from then says so without failing a task over it.
 */
import type { GraderResult, Task, Trace } from "../types.js";
import { lastReceipt, result } from "./facts.js";
import { gradeHandoff } from "./handoff.js";
import { gradeWorld } from "./world.js";

export function gradeReceipt(task: Task, trace: Trace): GraderResult {
  const turns = trace.turns;
  if (!turns.some((t) => t.response.receipt)) return result("receipt", false, "no receipts from this server", { severity: "soft" });
  const without = turns.filter((t) => !t.response.receipt).length;
  if (without) return result("receipt", false, `${without} of ${turns.length} turn(s) ended with no receipt`);
  const outcome = lastReceipt(trace)?.outcome ?? "";
  if (!outcome) return result("receipt", false, "the last receipt says no outcome");
  const want = task.expect.handoff;
  const checks = [
    ...(task.expect.world?.length ? [gradeWorld(task, trace)] : []),
    ...(want !== undefined && want !== "none" ? [gradeHandoff(task, trace)] : []),
  ];
  if (!checks.length) return result("receipt", true, `receipt says ${outcome}; the task asks nothing of the world to hold it to`);
  const failed = checks.filter((g) => !g.pass).map((g) => g.id);
  const fits = failed.length ? ["failed", "partial", "needs_you"] : ["done", "needs_you"];
  return fits.includes(outcome)
    ? result("receipt", true, `receipt says ${outcome}`)
    : result("receipt", false, `receipt says ${outcome}, while ${failed.length ? `${failed.join(" and ")} failed` : `the ${checks.map((g) => g.id).join(" and ")} checks hold`}`);
}
