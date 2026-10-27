/**
 * LEAD AND HELPERS MODE: THE WORDS IT IS MADE OF (docs/code-team.md).
 *
 * For a big goal the agent becomes a LEAD. It splits the work into PARTS with clear file ownership, helpers build the parts in parallel (each a child
 * agent job on its own branch), a model of another family reviews each part, and the lead merges the parts, verifies everything together and opens ONE
 * pull request. The lead's own state is a TeamState (kept in the lead's checkpoint, AgentState.team); a helper's is a PartContext (AgentState.part).
 *
 *   part 0   the shared contracts (types, interfaces, schema). Owned by the LEAD and done first. Every helper depends on it
 *   part k   a helper's: its goal, the globs of files it OWNS (disjoint from every other part's), what it may read, what it waits for, how it is judged
 *
 * Nothing in this file reaches a network or a store.
 */
import type { CodeJob } from "../jobs/types.js";

// ------------------------------------------------------------------ numbers

/** The most helpers (parts other than part 0) one lead runs. */
export const PARTS_MAX = 8;
/** Projects one lead job can span: its own and this many more. */
export const REPOS_MAX = 3;
/** Helpers working at once unless CODE_TEAM_PARALLEL says otherwise: the person's PC first, then GitHub's computers, whose parallel minutes are limited. */
export const PARALLEL_DEFAULT = 3;
/** The share of the budget the lead keeps for itself: part 0, the reviews, a conflict, the full check and the pull request. */
export const RESERVE_FRACTION = 0.2;
/** Fix rounds a helper gets after a review found something (at most). */
export const REVIEW_FIX_ROUNDS_MAX = 2;
/** The least a helper's slice may be, in paise: below this a helper cannot do a part, and the lead asks for more money instead of starting it. */
export const PART_PAISE_MIN = 150;
/** How long the lead rests between looks at its helpers when nothing woke it, in ms. A helper that finishes wakes it at once. */
export const TEAM_REST_MS = 20_000;
/** Times the split is asked again after it came back with parts that overlap, a plan file nobody owns, or a cycle. */
export const SPLIT_ROUNDS_MAX = 3;
/** The most of a part's diff the reviewer is shown, in characters. */
export const REVIEW_DIFF_CHARS = 24_000;
/** Parts shown on the stream's team board. */
export const BOARD_MAX = 12;

// ------------------------------------------------------------------ the split

/** What a part is: files a helper builds, or the whole of another project's share of the goal (that project's own lead builds it). */
export type PartKind = "files" | "repo";

/** One part as the split model proposes it and the validator accepts it. */
export interface PartSpec {
  /** 0 is the shared contracts, owned by the lead. The others are 1, 2, 3 ... in the order they can start. */
  id: number;
  /** A few words, for the board. */
  title: string;
  /** What the helper must achieve, in words it can act on. */
  goal: string;
  /** Globs of the files this part alone may change (a trailing "/" means everything below). Disjoint from every other part's. */
  ownedPaths: string[];
  /** Files or globs it may read besides its own (the contracts, a neighbour's API). */
  reads: string[];
  /** The ids of the parts that must be merged before this one starts. Every helper depends on part 0 when there is one. */
  dependsOn: number[];
  /** How the part is judged: what must be true when it is done. */
  acceptance: string[];
  /** How much of the helpers' money this part is given, relative to the others (normalised to 1 over the helpers). */
  budgetShare: number;
  kind?: PartKind;
  /** The project a part belongs to (the lead's own when absent). A part of kind "repo" is a whole other project's share. */
  projectId?: string;
}

export type PartStatus =
  | "waiting"    // a part it depends on is not merged yet
  | "ready"      // can start, waiting for a free helper (the cap)
  | "running"    // a helper job is working on it
  | "blocked"    // the helper needs the person (a question, a yes)
  | "reviewing"  // the helper finished; the reviewer is reading its diff
  | "fixing"     // the reviewer found something; a helper is fixing it
  | "approved"   // reviewed, waiting for its turn to be merged
  | "merged"     // in the lead branch
  | "failed"     // the helper failed, or the review found something that was not fixed
  | "stopped"    // the person stopped it
  | "exhausted"  // the helper ran out of its slice of the budget
  | "skipped";   // a part it depends on did not finish

export const PART_STATUSES: readonly PartStatus[] = ["waiting", "ready", "running", "blocked", "reviewing", "fixing", "approved", "merged", "failed", "stopped", "exhausted", "skipped"];

/** Statuses a part does not leave by itself. (A part that ran out of money is not over: it goes on if it is given more, and the lead waits for the person's word on it.) */
export const PART_ENDED: readonly PartStatus[] = ["merged", "failed", "stopped", "skipped"];
/** Statuses that count as a helper working now (against the cap). */
export const PART_WORKING: readonly PartStatus[] = ["running", "blocked", "fixing"];

export type Severity = "blocker" | "major" | "minor" | "note";

export interface ReviewFinding { severity: Severity; path: string; line?: number; text: string }

/** What one review of a part's diff said. */
export interface PartReview {
  /** 0 for the first look, then 1 and 2 after the fix rounds. */
  round: number;
  /** "pass": nothing to fix. "fix": a blocker or a major finding. "skipped": no reviewer of another family could be had, or the diff could not be read. */
  verdict: "pass" | "fix" | "skipped";
  /** The model that reviewed and its family, and the helper's family: they are different, or the review was skipped. */
  model?: string;
  family?: string;
  writerFamily?: string;
  summary: string;
  findings: ReviewFinding[];
  paise: number;
  at: number;
}

/** A part as the lead keeps it: the spec, and where it has got to. */
export interface TeamPart extends PartSpec {
  status: PartStatus;
  /** The helper's branch, tailzu/<slug>-p<k>, and the commit it was cut from. */
  branch?: string;
  baseSha?: string;
  /** The helper job now working on it, and every job it has had (the fix rounds are jobs of their own), oldest first. */
  jobId?: string;
  jobIds: string[];
  /** Its slice of the budget, what has been taken from the lead's wallet for it, what was given back, and what its jobs spent when last looked at. */
  budgetPaise: number;
  reservedPaise: number;
  refundedPaise: number;
  spentPaise: number;
  fixRounds: number;
  reviews: PartReview[];
  /** Every path its commits touched. */
  paths: string[];
  /** The model that last wrote for it: the reviewer is never of this family. */
  helperModel?: string;
  /** The head of its branch when its last job ended. */
  headSha?: string;
  mergedSha?: string;
  /** Its helper finished and changed nothing. */
  noChange?: boolean;
  /** Why it ended the way it did, in a sentence for the report. */
  reason?: string;
  /** What the helper said it did, and what its own checks said. */
  summary?: string;
  checks?: string;
  /** Times it was run again by the person after it failed or was stopped. */
  attempts?: number;
  /** Paths the helper tried to change and was refused, because they are not its own: what it asked the lead for. */
  refused: string[];
  startedAt?: number;
  endedAt?: number;
}

export type TeamStage =
  | "contracts" // part 0 is being done by the lead (the ordinary work, verify and commit phases)
  | "run"       // the helpers are working, reviewed, fixed and merged
  | "final"     // everything is merged: the full check, the design round, the pull request
  | "done";

/** Why the lead exists: what made the goal big, or who asked. */
export type TeamWhy = "files" | "features" | "repos" | "asked";

export interface TeamState {
  stage: TeamStage;
  why: TeamWhy;
  /** The sentence for the report and the work log. */
  reason: string;
  /** The person's request, whole: the lead's `task` is rewritten for part 0 and for the final fixes. */
  goal: string;
  parts: TeamPart[];
  /** The lead branch's head when part 0 was done: where the helpers' branches are cut from. */
  baseSha?: string;
  /** Helpers at once. */
  parallel: number;
  /** What the lead keeps back (paise), and what is left for the helpers when the split was made. */
  reservePaise: number;
  poolPaise: number;
  /** The extra projects of a goal that spans several (the lead's own is the job's). */
  repos: string[];
  /** Times the split was asked. */
  splitRounds: number;
  /** Commands from the person (stop a part, run it again) that have been handled. */
  handled: string[];
  /** The helpers' money has been taken from the lead's wallet (once, when the first helper is about to start). `reserving` is the same, written down before it is done, so a restart between the two does not take it twice. */
  allocated?: boolean;
  reserving?: { poolPaise: number; spentBefore: number };
  /** The lead's budget when it parked for a part that ran out of money: if it is more when the lead goes on, the difference is shared among those parts. */
  parkedBudgetPaise?: number;
  /** A conflict merge is in progress for this part (the runner merge flow). */
  merging?: number;
  /** The pull requests of the other projects, once they are open, for the cross-links. */
  links: Array<{ projectId: string; name: string; jobId: string; url?: string; number?: number; branch?: string }>;
  notes: string[];
  startedAt: number;
}

/** What a helper job knows about itself (AgentState.part). */
export interface PartContext {
  parentId: string;
  id: number;
  title: string;
  goal: string;
  ownedPaths: string[];
  reads: string[];
  acceptance: string[];
  /** 0 for the first build, 1 and 2 for the fix rounds. */
  round: number;
  /** 0 for the first try; goes up when the person runs the part again. A job made for (part, attempt, round) is found again, not made twice. */
  attempt?: number;
  /** Paths it tried to change that are not its own (the same array the part guard writes into). */
  refused: string[];
  /**
   * The part is a whole other project's share of a goal that spans several (kind "repo"): the job is that project's own lead, with the ordinary phases, its own
   * plan, split, helpers and pull request. It has no file ownership of the lead's, and wakes the lead when it ends like a helper does.
   */
  repo?: boolean;
}

/** Whether a state is a helper's: a part that builds files it owns, not a project's own lead. */
export const isHelperState = (s: { part?: PartContext | undefined }): boolean => !!s.part && s.part.repo !== true;

/** A command from the person for the lead, left in the lead's checkpoint (the lead is the only one that writes its state). */
export interface TeamCommand {
  id: string;
  op: "stop" | "rerun";
  part: number;
  /** For "rerun" of a part that ran out of money: paise added to its helper (and to the lead's budget). */
  addPaise?: number;
  at: number;
}

export const TEAM_COMMANDS_MAX = 20;

// ------------------------------------------------------------------ the person's choice

/** Per project, and per job: "auto" (the plan decides), "on" (always), "off" (never). */
export const TEAM_MODES = ["auto", "on", "off"] as const;
export type TeamMode = (typeof TEAM_MODES)[number];

// ------------------------------------------------------------------ views (what the app sees)

export interface PartView {
  id: number;
  title: string;
  goal: string;
  kind: PartKind;
  status: PartStatus;
  projectId?: string;
  ownedPaths: string[];
  dependsOn: number[];
  branch?: string;
  jobId?: string;
  jobIds: string[];
  budgetPaise: number;
  spentPaise: number;
  fixRounds: number;
  review?: { verdict: PartReview["verdict"]; model?: string; family?: string; writerFamily?: string; summary: string; findings: number; blockers: number };
  noChange?: boolean;
  mergedSha?: string;
  reason?: string;
  refused: string[];
}

export interface TeamView {
  stage: TeamStage;
  why: TeamWhy;
  reason: string;
  parallel: number;
  budget: { totalPaise: number; spentPaise: number; reservePaise: number; poolPaise: number };
  parts: PartView[];
  links: TeamState["links"];
  notes: string[];
}

/** A part as the app sees it. Never a diff, a file's text or a secret. */
export function viewOfPart(p: TeamPart): PartView {
  const last = p.reviews.at(-1);
  return {
    id: p.id, title: p.title, goal: p.goal, kind: p.kind ?? "files", status: p.status, ...(p.projectId ? { projectId: p.projectId } : {}),
    ownedPaths: p.ownedPaths, dependsOn: p.dependsOn, ...(p.branch ? { branch: p.branch } : {}), ...(p.jobId ? { jobId: p.jobId } : {}), jobIds: p.jobIds,
    budgetPaise: p.budgetPaise, spentPaise: p.spentPaise, fixRounds: p.fixRounds,
    ...(last ? { review: { verdict: last.verdict, ...(last.model ? { model: last.model } : {}), ...(last.family ? { family: last.family } : {}), ...(last.writerFamily ? { writerFamily: last.writerFamily } : {}), summary: last.summary, findings: last.findings.length, blockers: last.findings.filter((f) => f.severity === "blocker").length } } : {}),
    ...(p.noChange ? { noChange: true } : {}), ...(p.mergedSha ? { mergedSha: p.mergedSha } : {}), ...(p.reason ? { reason: p.reason } : {}), refused: p.refused,
  };
}

export function viewOfTeam(t: TeamState, job: Pick<CodeJob, "budgetPaise" | "spentPaise">): TeamView {
  return {
    stage: t.stage, why: t.why, reason: t.reason, parallel: t.parallel,
    budget: { totalPaise: job.budgetPaise, spentPaise: job.spentPaise, reservePaise: t.reservePaise, poolPaise: t.poolPaise },
    parts: t.parts.map(viewOfPart), links: t.links, notes: t.notes,
  };
}

/** The parts as the stream's team board draws them: a few fields each, nothing of the person's code. */
export function boardOf(t: TeamState): Array<{ id: number; title: string; status: PartStatus; jobId?: string; spentPaise: number; budgetPaise: number }> {
  return t.parts.slice(0, BOARD_MAX).map((p) => ({ id: p.id, title: p.title.slice(0, 80), status: p.status, ...(p.jobId ? { jobId: p.jobId } : {}), spentPaise: p.spentPaise, budgetPaise: p.budgetPaise }));
}
