/**
 * THE WORDS THE JOB ROUTER IS BUILT FROM: STATES, PLACES, RECORDS AND NUMBERS.
 *
 * A JOB is one coding task the Code bot is working on, on one work branch of
 * one project. It runs as STEPS, numbered from 0 in the order they happen:
 *
 *   edit   something done through the GitHub workspace API (read, change,
 *          commit). It needs no computer of ours or the person's, so it is
 *          recorded after the fact and is finished the moment it is written;
 *   exec   running commands (install, build, test). This needs a computer,
 *          and where it runs is the whole point of the router (router.ts).
 *
 * A job is in one STATE:
 *
 *   queued               made, nothing has happened to it yet
 *   running              being worked on: a step is on a computer, or the
 *                        agent is between steps
 *   waiting_for_compute  an exec step is ready and there is no place to run it
 *                        (no PC of the person's online, no free GitHub
 *                        minutes, paid compute off). It continues by itself
 *                        when a place frees up
 *   waiting_for_you      the person has to say yes to something: paid compute
 *                        ("paid"), or committing what a step produced
 *                        ("commit": the policy asked, and nobody was there)
 *   paused               reserved for the person pausing a job by hand. The
 *                        router never puts a job here on its own
 *   done | failed | cancelled   the end. Nothing changes a job after these
 *
 * and has a PLACEMENT, the kind of computer holding its current step:
 * `none` (no step is out), `desktop` (the person's own PC), `github` (GitHub
 * Actions' free computers) or `paid`.
 *
 * THE LEASE. Whoever is running a step holds the job's LEASE: a holder (a
 * device id, a run id), an EPOCH and an expiry. The lease is 90 seconds and is
 * renewed by heartbeats and progress. The epoch goes up by one on every
 * dispatch, and every result and progress call carries the epoch it was given,
 * so a machine that went quiet and was replaced can never count (router.ts).
 *
 * THE CHECKPOINT is `{ stepIndex, headSha, notes }`, written after every step
 * that finishes: the number of the last finished step (-1 before any), the
 * commit the branch was at, and a line of plain words. A job moved to another
 * place starts again from there and re-runs only the step that was out.
 */

export const JOB_STATES = [
  "queued", "running", "waiting_for_compute", "waiting_for_you", "paused", "done", "failed", "cancelled",
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** States nothing leaves. */
export const END_STATES: readonly JobState[] = ["done", "failed", "cancelled"];
export const isEnded = (s: JobState): boolean => END_STATES.includes(s);

export const PLACEMENTS = ["none", "desktop", "github", "paid"] as const;
export type Placement = (typeof PLACEMENTS)[number];
/** The places a step can actually run. */
export type ComputeKind = Exclude<Placement, "none">;

export type StepKind = "edit" | "exec";
/**
 * pending     an exec step with no place yet
 * dispatched  given to a place, which has not started it
 * running     started (a PC took it)
 * blocked     it ran, and what it produced waits for the person's yes to be committed
 * done        finished, exit code 0 (or an edit)
 * failed      finished with a non-zero exit code, or its changes were refused
 * cancelled   the job ended first
 */
export type StepStatus = "pending" | "dispatched" | "running" | "blocked" | "done" | "failed" | "cancelled";

/** What the person's rule for paid compute says. */
export type PaidRule = "never" | "ask" | "auto";
export const PAID_RULES: readonly PaidRule[] = ["never", "ask", "auto"];

/** What a waiting_for_you job is waiting for. */
export type WaitingOn = "paid" | "commit";

export interface Checkpoint {
  /** The last step that finished; -1 before any. */
  stepIndex: number;
  /** The commit the branch was at after it. Empty until something is known. */
  headSha: string;
  /** A line of plain words about where the job is. */
  notes: string;
}

export const NO_CHECKPOINT: Readonly<Checkpoint> = { stepIndex: -1, headSha: "", notes: "" };

export interface CodeJob {
  id: string;
  userId: string;
  projectId: string;
  branch: string;
  /** What was asked, the first 500 characters. */
  task: string;
  state: JobState;
  placement: Placement;
  /** Who holds the lease: a device id for a PC, a run id for the others. Null when nobody does. */
  leaseHolder: string | null;
  /** Goes up by one on every dispatch. A result carrying a smaller one is refused. */
  leaseEpoch: number;
  /** Epoch ms, or null. */
  leaseExpiresAt: number | null;
  checkpoint: Checkpoint;
  /** What the person has said this job may spend on paid compute, in paise. */
  budgetPaise: number;
  spentPaise: number;
  /** How many times a lost lease has moved the job. At MAX_REASSIGNMENTS it fails. */
  reassignments: number;
  /** In plain words, why it is waiting or why it ended badly. Empty otherwise. */
  reason: string;
  waitingOn: WaitingOn | null;
  createdAt: number;
  updatedAt: number;
}

export interface JobStep {
  jobId: string;
  idx: number;
  kind: StepKind;
  /** For an exec step, the commands. For an edit step, the paths it changed. */
  commands: string[];
  timeoutSec: number;
  estimateMinutes: number;
  status: StepStatus;
  placement: Placement;
  /** The lease epoch it was dispatched under; 0 before that. */
  epoch: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  /** The end of what it printed, 8 KB at most. */
  outputTail: string;
  /** Whole minutes it ran, rounded up. */
  minutes: number;
}

export interface ComputeSettings {
  userId: string;
  paidRule: PaidRule;
  /** For "auto": the most paid compute that may be used without asking, in a calendar month, in paise. */
  autoCapPaise: number;
  /** GitHub's free computers may be used at all. */
  githubEnabled: boolean;
}

export interface ComputeUsage {
  userId: string;
  /** "YYYY-MM", UTC. */
  month: string;
  githubMinutes: number;
  paidPaise: number;
}

// ------------------------------------------------------------------ numbers

/** A lease lasts this long, from the dispatch or the last heartbeat or progress. */
export const LEASE_MS = 90_000;
/** A PC that sent a heartbeat is online this long. Shorter than a lease, so a PC that has gone quiet is gone from the choice before its lease runs out. */
export const DEVICE_ONLINE_MS = 60_000;
/** How often the ticker looks. */
export const TICK_MS = 15_000;
/** A job whose lease is lost this many times is failed. */
export const MAX_REASSIGNMENTS = 5;
/** A runner waiting for work is held this long before it is told there is none. */
export const LONG_POLL_MS = 25_000;
/** The words of a task that are kept. */
export const TASK_KEEP = 500;
/** What a step keeps of what it printed. */
export const OUTPUT_TAIL_BYTES = 8 * 1024;
/** Jobs a person can have that are not over. */
export const LIVE_JOBS_MAX = 20;
/** Steps one job can have. */
export const STEPS_MAX = 500;
/** Commands in one exec step, and the length of each. */
export const COMMANDS_MAX = 20;
export const COMMAND_CHARS = 2000;
export const TIMEOUT_MAX_SEC = 3600;
export const TIMEOUT_DEFAULT_SEC = 600;
export const ESTIMATE_MAX_MINUTES = 360;
/** The most a person can put on one job or as an automatic monthly limit: ₹10,000. */
export const PAISE_MAX = 1_000_000;
/** Devices one person can have online at once. */
export const DEVICES_MAX = 20;
/** Projects a device can name. */
export const DEVICE_PROJECTS_MAX = 200;
/** Files a runner can hand back in one result (the commit's own limit, github.ts). */
export const CHANGES_MAX = 200;
/** A step pushed to GitHub's computers whose workflow run has not appeared after this long is given up on: the free minutes are most likely used up, or Actions is off (githubActions.ts check). */
export const GITHUB_NO_RUN_MS = 3 * 60_000;
/** A run still going this long after its step's own timeout is cancelled (if the App may) and the step moved. */
export const GITHUB_OVERRUN_MS = 2 * 60_000;

/** "YYYY-MM" in UTC for an epoch ms. */
export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first line of a task for a notification: at most `max` characters, one line. */
export function brief(text: string, max = 80): string {
  const line = String(text).split("\n")[0]!.trim();
  const chars = [...line];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : line;
}

// ------------------------------------------------------------ notifications

/**
 * What the router tells the person, through an injected function (the push
 * engine in the server, a recorder in tests):
 *
 *   compute_ask      paid compute is the only place left and needs their yes
 *   compute_paused   no place to run a step: the job waits, and goes on by itself
 *   commit_ask       a step's changes are ready and the policy wants their yes to commit them
 *   job_moved        the job went to another kind of place (their PC went offline, it continues on GitHub)
 *   job_done         finished
 *   job_failed       stopped, with a reason
 */
export type NotifyKind = "compute_ask" | "compute_paused" | "commit_ask" | "job_moved" | "job_done" | "job_failed";

export interface NotifyData {
  jobId: string;
  projectId: string;
  /** The first line of the task, 80 characters at most. */
  task: string;
  /** Epoch ms of the event: with the job id, it names the event once. */
  at: number;
  stepIdx?: number;
  /** Plain words: why. */
  reason?: string;
  /** compute_ask: about what the step would cost, in paise. */
  estimatePaise?: number;
  /** job_moved: from where to where. */
  from?: Placement;
  to?: Placement;
  /** commit_ask: the policy's action id ("commit.other_branch", "commit.secret", ...). Never file names or contents. */
  action?: string;
}

export type Notify = (userId: string, kind: NotifyKind, data: NotifyData) => void | Promise<void>;
