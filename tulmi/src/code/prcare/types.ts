/**
 * THE WORDS PR CARE IS MADE OF: WHAT IT KEEPS ABOUT A PULL REQUEST, AND THE NUMBERS THAT BOUND IT.
 *
 * PR care (docs/pr-care.md) looks after a pull request AFTER it is opened: it fixes red CI, answers the reviewer, and brings a branch that fell behind the
 * default branch up to date. It looks only after pull requests that are Tailzu's: one Tailzu opened (its "tailzu/..." work branch), or one the person
 * explicitly HANDED OVER. Every other pull request is none of its business, whoever opened it and whatever it says.
 *
 * One row for each pull request (migration 0034, code_pr_care). It holds the id of the ONE "Tailzu status" comment the pull request carries (edited in
 * place, never a second one), how many automatic CI fix rounds were made on each day, and what has been seen and done, so that a webhook GitHub
 * delivers twice does the same thing once. Nothing in it is the person's code.
 */

/** Automatic CI fix rounds for one pull request in one UTC day. After that Tailzu stops, says so, and tells the person. */
export const CI_ROUNDS_PER_DAY = 3;
/** Review comments Tailzu answers in one pass of a pull request (the rest wait for the next event). */
export const COMMENTS_PER_PASS = 8;
/** Comment ids kept as handled, and notes kept for the status comment. */
export const HANDLED_KEEP = 300;
export const NOTES_KEEP = 8;
/** Jobs kept in a row (the newest). */
export const JOBS_KEEP = 20;
/** Days of CI rounds kept in a row. */
export const ROUND_DAYS_KEEP = 3;
/** The longest reply Tailzu writes under a reviewer's comment (the role's own limit). */
export const CARE_REPLY_MAX = 600;
/** How much of a failing check's log is read, and how much the fixing job is shown. */
export const LOG_READ_CHARS = 6000;
export const LOG_SHOWN_CHARS = 3500;
/** A job PR care started that has not ended after this long is reported as stuck in the status (it is left running). */
export const JOB_STUCK_MS = 6 * 60 * 60_000;
/** How often the sweep looks at pull requests it has jobs on, and at ones whose mergeability GitHub had not worked out. */
export const SWEEP_EVERY_MS = 2 * 60_000;

/** The first line of the status comment: how Tailzu finds its own comment again if the id was lost. */
export const STATUS_MARK = "<!-- tailzu-pr-status -->";

export type CareOrigin = "tailzu" | "handed";
export type CareKind = "ci" | "review" | "conflict";

/** A job PR care made, and how it ended. */
export interface CareJobRef {
  jobId: string;
  kind: CareKind;
  /** ci: the failing checks. review: the comments (ids). conflict: the default branch. */
  refs: string[];
  /** The pull request's head when the job was made. */
  headSha: string;
  startedAt: number;
  /** review: the thread ids to resolve once the change is on the branch, and the comment to reply under (by thread). */
  threads?: Array<{ threadId: string | null; /** The comment to reply under: a thread's first comment, or the conversation comment itself. */ commentId: number; author: string }>;
  /** The job ended and its result was written to the pull request. */
  done?: boolean;
  /** The job parked for the person and the status says so. */
  waitingNoted?: boolean;
}

export type CiOutcome =
  | "green"        // every check passed
  | "pending"      // some checks are still running: nothing is decided yet
  | "fixing"       // a fix job is out
  | "also_red"     // the same checks fail on the default branch: not this pull request's
  | "infra"        // the failure looks like CI's own trouble (network, a registry, the runner), the same as seen elsewhere
  | "capped"       // three automatic rounds today: it stopped, and told the person
  | "unfixed"      // a fix job ended without a fix
  | "blind";       // the App may not read checks

export interface CareState {
  /** The head commit last looked at, and the pull request's title and address. */
  head?: string;
  title?: string;
  prUrl?: string;
  /** The pull request ended (or the person took it back from Tailzu); nothing more is done. */
  ended?: "merged" | "closed" | "released";
  /** A digest of the status comment as last written: a body that did not change is not written again. */
  statusHash?: string;
  /** GitHub had not worked out whether the branch merges: the sweep looks again. */
  recheck?: boolean;
  ci?: { head: string; outcome: CiOutcome; checks: string[]; note: string; at: number };
  /** The UTC day the person was last told that the daily cap was reached. */
  capNoted?: string;
  /** GitHub ids of the comments already dealt with (review comments and conversation comments). */
  handled: number[];
  /** "<base sha>:<head sha>" of the last conflict dealt with, and how it went. */
  conflict?: { key: string; outcome: "fixing" | "merged" | "asked" | "failed"; at: number; note: string };
  jobs: CareJobRef[];
  /** The latest things Tailzu did or decided, newest last, for the status comment. */
  notes: Array<{ at: number; text: string }>;
  /** The person must say something before a job goes on (a question, GitHub's refusal of a push). */
  waiting?: { jobId: string; text: string; at: number };
  /** Large asks proposed to the person: comment id to the proposal's words, so a proposal is made once. */
  proposals?: Array<{ commentId: number; at: number }>;
}

export interface CareRow {
  projectId: string;
  prNumber: number;
  userId: string;
  branch: string;
  origin: CareOrigin;
  statusCommentId: number | null;
  /** UTC day ("2026-10-27") -> automatic CI fix rounds made that day. */
  ciRounds: Record<string, number>;
  state: CareState;
  handedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const emptyState = (): CareState => ({ handled: [], jobs: [], notes: [] });

/** The UTC day of a time, "2026-10-27". */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
