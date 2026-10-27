/**
 * THE WORDS THE VPS AND THE CLOUDFLARE JOBS WORKER SAY TO EACH OTHER.
 *
 * Both directions are a signed POST (sign.ts) with a small JSON body of ids and kinds, never of
 * file contents, tokens or the person's code:
 *
 *   VPS -> Worker   POST {CODE_JOBS_URL}/v1/start   { jobId }                         start the job's Workflow (idempotent)
 *                   POST {CODE_JOBS_URL}/v1/event   { jobId, kind }                    the person's word, or a result: look again
 *                   POST {CODE_JOBS_URL}/v1/brain   { userId, projectId, mode, headSha }   build a project's brain (idempotent per head)
 *   Worker -> VPS   POST {PUBLIC_ORIGIN}/v1/internal/code/notify   { jobId, kind, text, at? }   tell the job's owner (the push engine is here)
 *
 * What a message means is always in the database (the Worker and the VPS share Supabase): the
 * state of a job, the person's answer, the brain's row. A message only says WHICH job to look at.
 * So a message that is lost, delayed, repeated or replayed can at worst make a Workflow look at a
 * job that has not changed.
 */
import type { NotifyKind, Placement } from "../types.js";

export const START_PATH = "/v1/start";
export const EVENT_PATH = "/v1/event";
export const BRAIN_PATH = "/v1/brain";
export const NOTIFY_PATH = "/v1/internal/code/notify";

/** What the person (or a result) did, so the job's Workflow looks again. All wake it the same; the kind is for the log. */
export const WAKE_KINDS = ["answer", "approve", "deny", "budget", "stop", "runner", "wake"] as const;
export type WakeKind = (typeof WAKE_KINDS)[number];

export interface StartBody { jobId: string }
export interface EventBody { jobId: string; kind: WakeKind }
export interface BrainBody { userId: string; projectId: string; mode: "full" | "incremental"; headSha: string }
export interface NotifyBody {
  jobId: string;
  kind: NotifyKind;
  /** Plain words: why. At most 300 characters. */
  text: string;
  /** Epoch ms of the event. With the job id, it names the push once (a retried POST does not push twice). */
  at?: number;
  /** job_moved: where to. */
  to?: Placement;
  /** compute_ask: about what the step would cost, in paise. */
  estimatePaise?: number;
}

export const NOTIFY_KINDS: readonly NotifyKind[] = ["compute_ask", "compute_paused", "commit_ask", "job_moved", "job_done", "job_failed", "needs_you"];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;

/**
 * A Workflow instance's id may be 100 characters of letters, digits, `-` and `_`, starting with a letter, digit or `_`
 * (developers.cloudflare.com/workflows/build/workers-api/, "Footnotes"). A job's id is a UUID; a brain build's is
 * `brain-<projectId>-<headSha>` (6 + 36 + 1 + 40 = 83).
 */
export const INSTANCE_ID = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,99}$/;

export function brainInstanceId(projectId: string, headSha: string): string {
  return `brain-${projectId}-${headSha}`;
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isSha = (v: unknown): v is string => typeof v === "string" && SHA.test(v);
