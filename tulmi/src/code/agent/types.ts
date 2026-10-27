/**
 * THE WORDS THE AGENT LOOP IS MADE OF: ITS PHASES, ITS STATE, AND THE NUMBERS THAT BOUND IT.
 *
 * The agent (docs/code-agent.md) drives one job from the person's words to a pull
 * request. It is a state machine that can be picked up where it stopped, by any
 * server, so everything it needs to go on is in ONE value, AgentState, kept in the
 * job's checkpoint (jobs/types.ts Checkpoint.agent) and written after every model
 * turn and every tool call:
 *
 *   prepare      read the project's brain, classify the request, load the rules
 *   new_project  (an empty repo only) intake, spec, PLAN.md, the scaffold step
 *   baseline     what the project's own checks said before any edit
 *   locate       where does this belong? (a question to the person if unsure)
 *   plan         what to change; the person's OK if it is risky or the policy asks
 *   work         a model with tools: read, search, edit (staged), run, ask
 *   verify       the plan's checks against the baseline
 *   commit       the server commits the staged edits, through the policy
 *   pr           the draft pull request, and ready for review if the checks are green
 *   report       what was done, in words, to the person
 *
 * A phase is entered, worked and left; the state says which, and what was decided
 * on the way. Nothing in this file reaches a network or a store.
 */
import type { Classification } from "../brain/types.js";
import type { BaselineResult } from "../project/types.js";
import type { ChangePlan, Located } from "../work/index.js";

export const PHASES = ["prepare", "new_project", "baseline", "locate", "plan", "work", "verify", "commit", "pr", "report", "done"] as const;
export type Phase = (typeof PHASES)[number];

// ------------------------------------------------------------------ numbers

/** The most characters of the request the agent keeps (the route's own limit). */
export const TASK_CHARS = 20_000;
/** Model turns in the work phase, over the whole job. At the limit the work is called done. */
export const TURNS_MAX = 60;
/** Fix rounds after a verify that found something this change broke. */
export const FIX_ROUNDS_MAX = 3;
/** Runs the model may ask for in one work round. */
export const RUNS_MAX = 10;
/** Tool calls in one model turn that are carried out; the rest are answered "too many". */
export const CALLS_PER_TURN = 8;
/** Characters of the assembled prompt for one model call. */
export const CONTEXT_MAX_CHARS = 60_000;
/** The last this-many tool results go to the model in full; older ones are folded. */
export const FULL_RESULTS = 6;
/** One tool result, as the model is shown it. */
export const RESULT_MAX_CHARS = 6_000;
/** The running summary of folded results, and how many fallen-out results are folded at once. */
export const SUMMARY_MAX_CHARS = 2_000;
export const FOLD_BATCH = 4;
/** What the project's rules and memory may take of the system prompt. */
export const RULES_MAX_CHARS = 5_000;
export const MEMORY_MAX_CHARS = 5_000;
/** Staged edits: files, and characters of text, held in the checkpoint. */
export const STAGED_FILES_MAX = 100;
export const STAGED_CHARS_MAX = 600_000;
/** A file read for the model, and a listing. */
export const READ_MAX_CHARS = 12_000;
export const LIST_MAX = 200;
/** A run that waits for a place this long is given up on; the step's own time is the rest of the wait. */
export const PLACE_WAIT_MS = 120_000;
export const RUN_GRACE_MS = 3 * 60_000;
export const RUN_POLL_MS = 2_000;
/** How long a run whose changes wait for the person's OK is waited for. */
export const BLOCKED_WAIT_MS = 6 * 60 * 60_000;
/** The default time a run is given, and the least and most. */
export const RUN_TIMEOUT_SEC = 600;
/** A baseline older than this is run again. */
export const BASELINE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Times in a row a loop may fail on something unexpected before the job is failed. */
export const LOOP_ERRORS_MAX = 3;
/** The wait before an errored loop is picked up again, doubled each time. */
export const ERROR_BACKOFF_MS = 15_000;
/** Findings the model may flag in one job. */
export const FINDINGS_MAX = 30;

// ------------------------------------------------------------------ the work

/** One staged edit: the file's whole new text, or null for a deletion. `action` is for the work log and the pull request. */
export interface StagedFile {
  path: string;
  content: string | null;
  action: "edit" | "create" | "delete";
}

export interface CallRecord {
  id: string;
  name: string;
  /** The JSON the model wrote, as written. */
  arguments: string;
}

export interface ResultRecord {
  ok: boolean;
  /** Tailzu's own words about what happened ("Edited src/a.ts."). */
  content: string;
  /** Text that came from the repo, a command or the web: shown to the model only inside a data wrapper, never as words of ours. */
  data?: string;
  /** What the data is, for its wrapper: a path, a command. */
  label?: string;
  /** `data` is already inside a wrapper for text from the web (asUntrusted). */
  wrapped?: boolean;
}

/** One turn of the model: what it said, the calls it made, and what each came to. A turn with fewer results than calls is half done. */
export interface Exchange {
  text: string;
  calls: CallRecord[];
  results: ResultRecord[];
  /** The model that answered, for the route's record. */
  model?: string;
}

export interface Finding { severity: "info" | "warn" | "risk"; path: string; line?: number; text: string }

export interface CheckSummary { kind: string; exitCode: number; summary: string; failing: string[]; status: string }

/** Where the project's own checks stood before this job touched it. */
export interface BaselineState {
  /** "recorded": the checks ran (now or for the default head earlier). "unknown": they could not be run, and what was already broken cannot be told from what this change breaks. */
  status: "recorded" | "unknown";
  headSha?: string;
  results?: BaselineResult[];
  note?: string;
}

export interface VerifyState {
  /** The checks ran. False: there was nothing to run, or no computer to run them on. */
  ran: boolean;
  ok: boolean;
  /** One line, from the comparison. */
  summary: string;
  checks: CheckSummary[];
  broke: string[];
  alreadyBroken: string[];
  fixed: string[];
  note?: string;
  round: number;
}

export interface NewProjectState {
  stage: "intake" | "plan_commit" | "scaffold" | "ready";
  planSha?: string;
  scaffold?: { status: "pending" | "done" | "skipped"; commands: string[] };
  stackKind?: string;
  /** PLAN.md as it will be committed. */
  planMd?: string;
  specName?: string;
  /** The first milestone, in words, which the job goes on to do as an ordinary task. */
  milestoneTask?: string;
  nextMilestones?: string[];
  checks?: string[];
}

export type WaitFor = "plan" | "commit" | "ready";

/**
 * What the job is waiting for the person to say. The job is parked (waiting_for_you,
 * nobody holds its claim) while this is set; their answer is written into it and
 * the loop goes on from the phase it was in.
 */
export type Waiting =
  | {
    kind: "question";
    from: "locate" | "intake" | "model" | "scaffold";
    question: string;
    options?: string[];
    /** The model's call to answer with the person's words (from "model"). */
    callId?: string;
    answer?: string;
    at: number;
  }
  | {
    kind: "approval";
    for: WaitFor;
    /** The policy's action id, or "job.plan". */
    action: string;
    faceId: boolean;
    summary: Record<string, unknown>;
    /** The id the approval book gave; the person says yes with it. */
    approvalId: string;
    expiresAt: number;
    /** The person said yes. */
    approved?: boolean;
    at: number;
  }
  | { kind: "budget"; needPaise: number; at: number };

export interface Report {
  at: number;
  /** "done": finished. "failed": stopped, nothing more will be done. "budget": out of money, can go on. "answer": nothing was changed, the answer is the report. */
  outcome: "done" | "failed" | "budget" | "answer";
  text: string;
  prUrl?: string;
  costPaise: number;
  /** For "budget": the top-up the report offers, in paise. */
  continueWithPaise?: number;
}

/** The whole of where the agent has got to. Plain data: it goes into the checkpoint as JSON. */
export interface AgentState {
  v: 1;
  phase: Phase;
  /** The request, whole (the job keeps its first 500 characters). */
  task: string;
  classification?: Classification;
  repoEmpty?: boolean;
  baseline?: BaselineState;
  located?: Located;
  /** A clarification the person gave for a question from locate (spent: locate does not ask twice). */
  locateAsked?: boolean;
  plan?: ChangePlan;
  /** The person said yes to the plan, or it needed no yes. */
  planOk?: boolean;
  newProject?: NewProjectState;
  work: {
    exchanges: Exchange[];
    /** One line for each result that fell out of the last six and is not folded yet. */
    digests: string[];
    /** Everything older, folded by the cheap tier. */
    summary: string;
    turns: number;
    /** Turns in a row that came to nothing, and verify rounds that found a break: what the router climbs a tier on. */
    badTurns: number;
    fixRounds: number;
    runs: number;
    staged: StagedFile[];
    /** The excerpts of the located files, as they were when work began. */
    excerpts?: string;
    /** What the last verify found, for the model to fix: the failing checks and the end of their output. Data, wrapped when shown. */
    feedback?: string;
    lastTier?: string;
    lastModel?: string;
    /** Paise at the start of this round, for the route's record. */
    roundStartPaise?: number;
    roundStartedAt?: number;
    finished?: boolean;
    doneSummary?: string;
    /** The model was nudged once to use a tool. */
    nudged?: boolean;
  };
  verify?: VerifyState;
  commit?: { base: string; message: string; sha?: string; files: string[] };
  /** Every commit this job made. */
  commits: string[];
  pr?: { number: number; url: string; ready: boolean; existing?: boolean };
  /** The person said no to marking the pull request ready: it stays a draft. */
  readyDenied?: boolean;
  findings: Finding[];
  waiting?: Waiting;
  report?: Report;
  /** Things worth saying in the report: a baseline that could not be run, a lock-step the loop worked round. */
  notes: string[];
  /** Consecutive loop failures, for the backoff. */
  errors?: number;
  /** The run in flight, so a server that picks the job up after a restart takes that step over instead of asking for another. `tag` says which ask it was for (a call's id, "baseline", "verify:1", "scaffold"). */
  run?: { stepIdx: number; commands: string[]; tag: string };
  /** Epoch ms the job was handed to the agent. */
  startedAt: number;
}

/** A fresh state for a job. */
export function initialState(task: string, now: number): AgentState {
  return {
    v: 1, phase: "prepare", task: task.slice(0, TASK_CHARS),
    work: { exchanges: [], digests: [], summary: "", turns: 0, badTurns: 0, fixRounds: 0, runs: 0, staged: [] },
    commits: [], findings: [], notes: [], startedAt: now,
  };
}

/** The agent's state out of a job's checkpoint, or null when the job has none. */
export function stateOf(checkpoint: { agent?: Record<string, unknown> } | undefined): AgentState | null {
  const a = checkpoint?.agent;
  if (!a || typeof a !== "object" || (a as { v?: unknown }).v !== 1 || typeof (a as { phase?: unknown }).phase !== "string") return null;
  return a as unknown as AgentState;
}

// ------------------------------------------------------------------ money

/** Paise as a person reads them: "₹12", "₹12.50". */
export function rupees(paise: number): string {
  const n = Math.max(0, Math.round(paise)) / 100;
  return `₹${n.toFixed(2).replace(/\.00$/, "")}`;
}

/** What the report offers to go on with when the money ran out: half of what has been spent, at least ₹10, in whole rupees. */
export function topUpFor(spentPaise: number): number {
  return Math.max(1000, Math.ceil(spentPaise / 2 / 100) * 100);
}
