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
 *   merge        (a PR-care job for a branch that conflicts with the default branch only) the default branch is merged in on a runner, and the result is staged
 *   locate       where does this belong? (a question to the person if unsure). Free-form jobs skip it
 *   plan         what to change; the person's OK if it is risky, the policy asks, or the person said "always show me the plan first". Free-form jobs plan only for that
 *   work         a model with tools: read, search, edit (staged), run, ask. Guided: after locate and plan. Free-form: the model decides the order of explore, change and run
 *   verify       the plan's checks against the baseline
 *   design       only for a job built from an approved design (spec): run the app, shoot it, compare it to the design; major differences go back to work
 *   split        (a LEAD only: a goal that is big, code/team) the plan is split into parts with clear file ownership (team/split.ts)
 *   team         (a LEAD only) the helpers build the parts in parallel on their own branches, a model of another family reviews each, the lead merges them
 *   commit       the server commits the staged edits, through the policy
 *   pr           the draft pull request, and ready for review if the checks are green
 *   report       what was done, in words, to the person
 *
 * A phase is entered, worked and left; the state says which, and what was decided
 * on the way. Nothing in this file reaches a network or a store.
 */
import type { Approval } from "../approvals.js";
import type { ContextStrategy } from "./mask.js";
import type { Classification } from "../brain/types.js";
import type { BaselineResult } from "../project/types.js";
import type { ChangePlan, Located } from "../work/index.js";
import type { PartContext, TeamMode, TeamState } from "../team/types.js";

export const PHASES = ["prepare", "new_project", "baseline", "merge", "locate", "plan", "split", "team", "work", "verify", "design", "commit", "pr", "report", "done"] as const;
export type Phase = (typeof PHASES)[number];

/** How a job is worked: GUIDED (locate, plan, work, verify, commit: the phases in order) or FREEFORM (the model decides the order of explore, change and run). */
export const JOB_MODES = ["guided", "freeform"] as const;
export type JobMode = (typeof JOB_MODES)[number];

// ------------------------------------------------------------------ numbers

/** The most characters of the request the agent keeps (the route's own limit). */
export const TASK_CHARS = 20_000;
/** Model turns in the work phase, over the whole job. At the limit the work is called done. */
export const TURNS_MAX = 60;
/**
 * Free-form: STEPS (a step is a round of the model's work: a turn and its tool calls) in all, and runs in all. The model decides the order of explore, change
 * and run, which makes a job easy to lose in; a lower cap on steps and a higher one on runs (investigating means running things) is how it is kept in hand.
 * At the cap the work is called done and goes to the checks like any other.
 */
export const FREEFORM_STEPS_MAX = 40;
export const FREEFORM_RUNS_MAX = 25;
/** Rewind points kept for a job: the last this-many steps. */
export const REWIND_KEEP = 60;
/** The most characters of staged text all of a job's rewind points may hold together (the oldest go first). */
export const REWIND_CHARS_MAX = 3_000_000;
/** Fix rounds after a verify that found something this change broke. */
export const FIX_ROUNDS_MAX = 3;
/** Runs the model may ask for in one work round. */
export const RUNS_MAX = 10;
/** Tool calls in one model turn that are carried out; the rest are answered "too many". */
export const CALLS_PER_TURN = 8;
/** Characters of the assembled prompt for one model call. */
export const CONTEXT_MAX_CHARS = 60_000;
/** The last this-many tool results go to the model in full; older ones are masked or folded (context.ts, mask.ts). */
export const FULL_RESULTS = 6;
/** How the old results are dealt with unless CODE_CONTEXT_STRATEGY (or the agent's `contextStrategy`) says otherwise. Chosen by measurement: docs/code-agent.md. */
export const CONTEXT_STRATEGY_DEFAULT: ContextStrategy = "summary";
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
/** Times the design check may send the job back to work (design.ts). After the last, one more look is taken and what still differs is reported. */
export const DESIGN_ROUNDS_MAX = 2;
/** The longest the dev server is given to answer for the design check, in all (the runner's own wait is inside it). */
export const DESIGN_START_MS = 150_000;

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
  /** The output was replaced by a one-line placeholder in `content` when it became old (mask.ts): there is no `data` any more. */
  masked?: boolean;
  /** The placeholder quotes words from the output (a line of errors, the names of files found): it is shown inside a data fence. */
  quotes?: boolean;
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
    from: "locate" | "intake" | "model" | "scaffold" | "push" | "merge";
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
    /**
     * The approval book's own record of the question (approvals.ts peek), kept here so that the yes can be taken by a process that did not
     * ask it: the book is in one process's memory, and with jobs on Cloudflare the question is asked on the Worker and answered on the VPS.
     */
    bound?: Approval;
    at: number;
  }
  | { kind: "budget"; needPaise: number; at: number };

/** Why a PR-care job exists (code/prcare): what it is for, on which pull request, so its end can be told on that pull request. */
export interface CareContext {
  kind: "ci" | "review" | "conflict";
  prNumber: number;
  prUrl: string;
  /** The pull request's head commit when the job was made: a CI fix or a review change is for this commit. */
  headSha: string;
  /** ci: the names of the failing checks. review: the ids of the comments it answers. conflict: the default branch it merges in. */
  refs: string[];
  /** review: the thread ids to resolve once the change is committed. */
  threadIds?: string[];
  /**
   * What the job is shown as DATA, beside its task: ci: the end of the failing checks' logs. review: the reviewer's own words. Somebody else's text,
   * cleaned of anything that looks like a secret, and never an instruction (context.ts shows it inside a data wrapper).
   */
  log?: string;
  comment?: string;
  /** review: where on the diff the ask is. */
  path?: string;
  line?: number;
  /** conflict: the branch the pull request is into, which is the one merged in (the default branch when the pull request is into it). */
  base?: string;
}

/** The merge of the default branch into a conflicting branch (stage "merge"): what was merged, and where it stands. */
export interface MergeState {
  stage: "run" | "judge" | "resolve" | "uptodate";
  /** The default branch's name, and the commit of it that is merged in (the merge commit's second parent). */
  base: string;
  baseSha: string;
  /** The branch's head when the merge was made: the merge commit's first parent. */
  headSha: string;
  /** The files that conflict. */
  conflicted: string[];
  /** The person's choice, when both sides changed the same logic and picking one loses behaviour. */
  choice?: string;
}

/** A step of the model's work, as a rewind point: the staged edits as they stood after it, and the notes the model is given back. */
export interface StepCheckpoint {
  step: number;
  at: number;
  /** What the step did, in a line. */
  note: string;
  staged: StagedFile[];
  summary: string;
  digests: string[];
}

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

/** The most of an approved design's source the checkpoint keeps, and the most of it the model is shown in one turn. */
export const SPEC_CHARS_MAX = 40_000;
export const SPEC_SHOWN_CHARS = 14_000;

/**
 * A DESIGN THE PERSON APPROVED, TO BUILD INTO THE PROJECT (src/artifacts/build.ts, docs/artifacts.md): an artifact as it was at the version they
 * said yes to, the project's compact style kit, and where a search says it goes. The model is shown it as the design to match, built with the
 * project's real components. The screenshot compare (built next) reads `artifactId` and `version` to know what to compare the built page to.
 */
export interface SpecArtifact {
  artifactId: string;
  version: number;
  /** html, react, svg, mermaid or markdown. */
  type: string;
  title: string;
  /** The artifact's source at that version, cut to SPEC_CHARS_MAX. */
  content: string;
  truncated?: boolean;
  /** The project's kit for a model (artifacts/kit.ts), at most 2,000 characters. */
  kit: string;
  /** Where it goes, best first. */
  target: Array<{ path: string; why: string }>;
  approvedAt: number;
}

// ------------------------------------------------------------------ the design check

export type DesignViewport = "mobile" | "desktop";

/** One difference the vision tier found between the design and the built page (artifacts/build.ts DesignIssue, kept in the job's state). */
export interface DesignIssueRecord { area: string; issue: string; severity: "minor" | "major"; fixHint: string; viewport: DesignViewport }

/** What one viewport came to in the latest look. */
export interface DesignViewState {
  viewport: DesignViewport;
  /** 0 to 1. */
  match: number;
  issues: DesignIssueRecord[];
  /** "same": the cheap gate found the shots alike (no model was asked). "model": the vision tier looked. "failed": see `error`. */
  gate: "same" | "model" | "failed";
  /** Ids of the two kept shots (artifacts/shots.ts); a link to each is made when the report is written. */
  shots?: { built: string; approved: string };
  error?: string;
}

/**
 * THE DESIGN CHECK (agent/design.ts, docs/artifacts.md section 11), for a job that has a spec. Its stages are saved one by one, so it is entered again
 * after a restart or a wait and does not do anything twice:
 *   session   a runner is opened (a trivial command, so the staged edits are laid) 
 *   start     the dev server is started on it
 *   wait      until it answers
 *   check     the built page and the design are shot and compared, one viewport at a time
 *   decide    major differences send the job back to work (twice at most); otherwise the check is over
 *   done
 */
export interface DesignState {
  stage: "session" | "start" | "wait" | "check" | "decide" | "done";
  /** Times it has sent the job back to work. */
  round: number;
  startedAt?: number;
  /** The page of the app the design is shown on, and a word about how it was found. */
  route?: string;
  routeNote?: string;
  /** Where the design goes, for the vision tier ("src/components/Pricing.tsx"). */
  location?: string;
  viewports: DesignViewport[];
  /** The latest look, viewport by viewport (emptied when the job goes back to work). */
  views: DesignViewState[];
  /** Every look: round, the average match, and how many differences of each kind. */
  history: Array<{ round: number; match: number; major: number; minor: number }>;
  /** Why the check did not run (or stopped), in a sentence for the report. */
  skipped?: string;
  /** What the compare calls cost, in paise (already in the job's spend). */
  paise: number;
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
  /** The design this job builds, when it was made from an approved artifact. */
  spec?: SpecArtifact;
  /** The design check, once the job has got to it (only a job with a spec). */
  design?: DesignState;
  /** A clarification the person gave for a question from locate (spent: locate does not ask twice). */
  locateAsked?: boolean;
  /** How the job is worked. Absent: guided, as every job was before free-form existed. */
  mode?: JobMode;
  /** "Always show me the plan first": the plan goes to the person for a yes before any work, whatever its risk. */
  planFirst?: boolean;
  /** Lead and helpers (code/team): "on" always splits a goal into parts, "off" never does; absent is "auto", where the plan decides (more than 12 files, more than 3 features, or several projects). */
  teamMode?: TeamMode;
  /** The other projects of the same person this goal spans (a lead job over several repositories). */
  teamRepos?: string[];
  /** This job is a LEAD: how it split the goal, and where each part stands (team/lead.ts). */
  team?: TeamState;
  /** This job is a HELPER: the part of a lead's goal it builds, and the files it owns (team/guard.ts). */
  part?: PartContext;
  /** `located` came from a conversation about the code (code/chat): locate takes it as it is and does not look again. */
  handoff?: boolean;
  /** Why this job exists, when it is PR care's (code/prcare). */
  care?: CareContext;
  /** The merge of the default branch into the branch, when this is a PR-care job for a conflict. */
  merge?: MergeState;
  /**
   * What the checks were run on: a digest of the staged edits that passed verify. A commit is made only of exactly this (agent/phases.ts commitStaged):
   * verifying before committing is not a convention of the phases' order but a thing the commit checks.
   */
  verified?: string;
  /** The branch's head before this job's first commit, and every path its commits touched: what a rewind after the commit undoes (with a new commit, never a rewrite). */
  baseSha?: string;
  committedPaths?: string[];
  /** Times the person rewound the job, and how. */
  rewinds?: Array<{ to: number; at: number; kind: "restored" | "reverted"; sha?: string }>;
  plan?: ChangePlan;
  /** The person said yes to the plan, or it needed no yes. */
  planOk?: boolean;
  newProject?: NewProjectState;
  work: {
    exchanges: Exchange[];
    /** One line for each result that fell out of the last six and is not folded yet (the summary strategy; the others keep the turns themselves). */
    digests: string[];
    /** Everything older, folded by the cheap tier. */
    summary: string;
    /** How this job treats its old results, fixed at its first model turn so that a restart under another setting does not change it halfway. Absent: it is the default. */
    strategy?: ContextStrategy;
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
    /** What the design check found, for the model to fix: the differences and the fix hints. Data, wrapped when shown. */
    designFeedback?: string;
    /** What a team's reviewer found in this helper's work (code/team): the findings, for the fix round. Data, wrapped when shown. */
    reviewFeedback?: string;
    /** What the person said while the job was working (POST /v1/code/jobs/:id/message), newest last. The model is shown them as the person's words. */
    said?: Array<{ id: string; text: string; at: number }>;
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
  run?: { stepIdx: number; commands: string[]; tag: string; /** Epoch ms the step was asked for (so a run that is looked at once per advance knows how long it has waited). */ at?: number };
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
