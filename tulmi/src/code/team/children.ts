/**
 * READING A HELPER'S JOB: WHERE IT HAS GOT TO, IN THE LEAD'S WORDS.
 *
 * A helper is an ordinary agent job (agent/), so what the lead knows of it is what any job shows: the job row (its state, what it waits for, what it has
 * spent) and the agent state in its checkpoint (its commits, its summary, the model that last wrote, the paths it was refused). The lead only READS these; it
 * never writes a helper's state (the helper's own loop does, under its claim). The lead's own record of a part (TeamPart) is rebuilt from them each time
 * it looks, which is why a lead that crashed and was picked up again loses nothing.
 */
import type { JobStore } from "../jobs/store.js";
import { isEnded, type CodeJob } from "../jobs/types.js";
import { stateOf, type AgentState } from "../agent/types.js";

/**
 *   active      the helper is working (or waiting for a computer, or for the policy's own commit question the router asks)
 *   blocked     it needs the person: a question it asked, or a yes (its plan, a commit)
 *   exhausted   it used up its slice of the budget and stopped cleanly, offering to go on with more
 *   done        it finished
 *   failed      it stopped with a reason
 *   cancelled   the person stopped it
 *   missing     there is no such job
 */
export type ChildKind = "active" | "blocked" | "exhausted" | "done" | "failed" | "cancelled" | "missing";

export interface Child {
  kind: ChildKind;
  job: CodeJob | null;
  state: AgentState | null;
  spentPaise: number;
  /** In a sentence: why it failed or stopped, or what it waits for. */
  why: string;
}

export async function readChild(store: Pick<JobStore, "getJobById">, jobId: string): Promise<Child> {
  const job = await store.getJobById(jobId);
  if (!job) return { kind: "missing", job: null, state: null, spentPaise: 0, why: "The helper's job is gone." };
  const state = stateOf(job.checkpoint);
  const base = { job, state, spentPaise: job.spentPaise };
  if (isEnded(job.state)) {
    if (job.state === "done") return { ...base, kind: "done", why: "" };
    if (job.state === "cancelled") return { ...base, kind: "cancelled", why: job.reason || "It was stopped." };
    return { ...base, kind: "failed", why: job.reason || state?.report?.text.split("\n")[0] || "It failed." };
  }
  if (job.state === "waiting_for_you") {
    if (job.waitingOn === "budget") return { ...base, kind: "exhausted", why: job.reason || "It used up its share of the budget." };
    if (job.waitingOn === "answer" || job.waitingOn === "approval") return { ...base, kind: "blocked", why: job.reason || "It needs you." };
  }
  return { ...base, kind: "active", why: "" };
}

/** Whether a helper job was made for this part and round (so a lead that crashed between making the job and writing it down adopts it instead of making another). */
export function isChildOf(job: CodeJob, o: { parentId: string; part: number; round: number; attempt?: number }): boolean {
  const p = stateOf(job.checkpoint)?.part;
  return !!p && p.parentId === o.parentId && p.id === o.part && p.round === o.round && (p.attempt ?? 0) === (o.attempt ?? 0);
}
