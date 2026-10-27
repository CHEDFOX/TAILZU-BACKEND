/**
 * THE WAY INTO A JOB'S ROOM THAT A RUNNER IS HANDED WITH ITS STEP.
 *
 * A live session is placed like any exec step (code/jobs/router.ts requestExec with the one command SESSION_COMMAND): the person's PC if
 * it is online, else a GitHub Actions run. The place is given, with the step, an OFFER: the address of the job's room and a one-time
 * ticket (tickets.ts, kind "runner") made for THIS step and THIS lease epoch, good for 15 minutes. On GitHub's computers it is written
 * into `.tailzu/step.json` on the throwaway branch; a PC is sent it with the step. A runner that connects with it is the one the room
 * is waiting for; a ticket for an earlier lease (the step was moved) is refused by the room.
 *
 * The ticket can be read by anyone who can read that throwaway branch in the person's own repo while it exists (minutes). It is worth
 * very little: it opens ONE connection, once, to a room that is waiting for exactly that step, and the room hands such a runner nothing
 * but commands to run on the runner's own machine.
 */
import { RUNNER_TOKEN_TTL_MS } from "./limits.js";
import { signTicket } from "./tickets.js";

export interface SessionOffer {
  /** wss:// address of the job's runner socket. */
  url: string;
  ticket: string;
  /** When the ticket stops working, epoch ms. */
  expiresAt: number;
  /** The room closes the session after this long without a command. */
  idleSec: number;
  /** The most seconds the session may last (the step's own time limit). */
  maxSec: number;
}

export type OfferSession = (job: { id: string; leaseEpoch: number }, step: { idx: number; timeoutSec: number }) => SessionOffer;

export interface OfferOptions {
  /** CODE_JOBS_SECRET. */
  secret: string;
  /** CODE_JOBS_URL: where the Worker is (https). */
  jobsUrl: string;
  idleSec: number;
  now?: () => number;
}

/** The room's runner address for a job, from the Worker's own address. */
export function roomRunnerUrl(jobsUrl: string, jobId: string): string {
  return `${jobsUrl.trim().replace(/\/+$/, "").replace(/^http/i, "ws")}/v1/rooms/${jobId}/runner`;
}

export function sessionOffers(o: OfferOptions): OfferSession {
  const now = o.now ?? Date.now;
  return (job, step) => {
    const at = now();
    const { ticket, claims } = signTicket({ secret: o.secret, kind: "runner", job: job.id, step: step.idx, epoch: job.leaseEpoch, ttlMs: RUNNER_TOKEN_TTL_MS, now: at });
    return { url: roomRunnerUrl(o.jobsUrl, job.id), ticket, expiresAt: claims.x, idleSec: o.idleSec, maxSec: step.timeoutSec };
  };
}
