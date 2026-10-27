/**
 * STARTING AND WAKING THE WORKFLOWS: THE ONLY PLACE THAT KNOWS THEIR INSTANCE IDS AND THEIR RULES.
 *
 * A Workflow instance's id is unique for as long as its state is kept (30 days on Workers Paid unless the retention is set
 * shorter), and `create` THROWS for an id that is already used
 * (developers.cloudflare.com/workflows/build/workers-api/, "create"). So "start" here means: create, and if that fails
 * because the instance is there, that is the answer, not an error. A job's id is its Workflow's id; a brain build's is
 * `brain-<projectId>-<headSha>`, so one build per head however many times it is asked for.
 *
 * Waking: `sendEvent` of type "wake". An event sent before the instance reaches the `waitForEvent` it is for is kept and
 * delivered when it does (".../events-and-parameters/", "Event timing"), so a person who answers a moment after the job
 * parked but before its Workflow got to waiting loses nothing. `sendEvent` throws for an instance that is not running.
 */
import { brainInstanceId, type BrainBody, type WakeKind } from "../../tulmi/src/code/jobs/handoff/protocol.js";
import type { BrainRemote } from "../../tulmi/src/code/project/index.js";
import type { AgentJobParams, Env } from "./env.js";
import { roomOf } from "./rooms.js";

/** The event type the Workflows wait for. Letters, digits, - and _ only: a "." is refused (".../events-and-parameters/", "Wait for events"). */
export const WAKE_EVENT = "wake";

type Instance = Awaited<ReturnType<Workflow["get"]>>;
const FINISHED = new Set(["complete", "errored", "terminated"]);

export interface Started {
  /** A new instance was made (or a finished one restarted). False: it was there already. */
  created: boolean;
  status: string;
}

/** Starts the Workflow of a job. An instance that exists is fine, whatever it is doing. */
export async function startAgentJob(env: Pick<Env, "AGENT_JOB">, jobId: string): Promise<Started> {
  try {
    await env.AGENT_JOB.create({ id: jobId, params: { jobId } satisfies AgentJobParams });
    return { created: true, status: "queued" };
  } catch (err) {
    const there = await existing(env.AGENT_JOB, jobId);
    if (!there) throw err;
    return { created: false, status: there.status };
  }
}

/**
 * Starts the Workflow of a brain build. An instance of that id that is still going is left alone (one build per head). One that has
 * FINISHED is deleted and made again with the new parameters (a person asked for a full rebuild of a head already built, or the last
 * try failed): `restart()` would run it again with the parameters it was first made with, and the mode may be different now.
 */
export async function startBrainBuild(env: Pick<Env, "BUILD_BRAIN">, b: BrainBody): Promise<Started> {
  const id = brainInstanceId(b.projectId, b.headSha);
  try {
    await env.BUILD_BRAIN.create({ id, params: b, retention: { successRetention: "1 day", errorRetention: "3 days" } });
    return { created: true, status: "queued" };
  } catch (err) {
    const there = await existing(env.BUILD_BRAIN, id);
    if (!there) throw err;
    if (FINISHED.has(there.status)) {
      await there.instance.delete();
      await env.BUILD_BRAIN.create({ id, params: b, retention: { successRetention: "1 day", errorRetention: "3 days" } });
      return { created: true, status: "queued" };
    }
    return { created: false, status: there.status };
  }
}

async function existing(wf: Workflow, id: string): Promise<{ instance: Instance; status: string } | null> {
  try {
    const instance = await wf.get(id);
    return { instance, status: (await instance.status()).status };
  } catch {
    return null;
  }
}

export interface Woken {
  /** The event was handed to a running instance. */
  delivered: boolean;
  /** The instance, or null when there is none. */
  status: string | null;
}

/**
 * Tells a job's Workflow to look again. `stop` also ends the instance: the job is already cancelled in the database, so there is
 * nothing for it to do, and a step that is out is cut short (terminate does not run anything more).
 */
export async function wakeAgentJob(env: Pick<Env, "AGENT_JOB"> & Partial<Pick<Env, "ROOMS">>, jobId: string, kind: WakeKind): Promise<Woken> {
  // A stopped job's room (the copy of the code, the runner session) goes with it, whether or not its Workflow is still there.
  if (kind === "stop" && env.ROOMS) {
    try { await roomOf(env as Pick<Env, "ROOMS">, jobId).endJob(); } catch { /* the room deletes itself after six idle hours */ }
  }
  const there = await existing(env.AGENT_JOB, jobId);
  if (!there) return { delivered: false, status: null };
  if (kind === "stop" && !FINISHED.has(there.status)) {
    try { await there.instance.terminate(); return { delivered: true, status: "terminated" }; } catch { /* it ended by itself: nothing to cut short */ }
  }
  try {
    await there.instance.sendEvent({ type: WAKE_EVENT, payload: { kind } });
    return { delivered: true, status: there.status };
  } catch {
    return { delivered: false, status: there.status };
  }
}

/** The BrainRemote of this Worker: a build asked for here (by the agent's first phase, or a push) is a BuildBrain instance. */
export function bindingBrainRemote(env: Pick<Env, "BUILD_BRAIN">): BrainRemote {
  return { build: async (b) => { await startBrainBuild(env, b); } };
}

/** Wakes a job's Workflow; makes the Workflow if the job has none (the VPS's start never arrived); runs a finished one again. For the cron's rescue. */
export async function rescueAgentJob(env: Pick<Env, "AGENT_JOB">, jobId: string): Promise<"woken" | "started" | "restarted" | "alive"> {
  const there = await existing(env.AGENT_JOB, jobId);
  if (!there) {
    await env.AGENT_JOB.create({ id: jobId, params: { jobId } satisfies AgentJobParams });
    return "started";
  }
  if (FINISHED.has(there.status)) {
    await there.instance.restart();
    return "restarted";
  }
  if (there.status === "waiting") {
    await there.instance.sendEvent({ type: WAKE_EVENT, payload: { kind: "wake" } });
    return "woken";
  }
  return "alive";
}
