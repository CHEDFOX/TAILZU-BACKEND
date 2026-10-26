/**
 * THE RUN LEDGER'S SHAPES: a run, a step, a planner call, and the store they
 * are kept in.
 *
 * A run is one Ask from start to end: on the desktop, the steps the device
 * posts under one runId; on the phone, one request (an answer to a question
 * back is a run of its own, linked to the one it answers). The ledger keeps
 * how each ended and why, what it changed in the world, and what it cost,
 * and never what an app returned or what the planner was told. What the
 * person said is kept only from the phone, and only as long as SWEEP_TIMES
 * says (ledger.ts).
 *
 * The store is Supabase (migration 0019) with an in-memory twin for tests and
 * for AGENT_RUN_LEDGER off, the default (store.ts).
 */
import type { AgentTurn, RunOutcome, RunReason, RunReceipt } from "../../../shared/types/api.js";

export type { RunOutcome, RunReason, RunReceipt };
export type Surface = "phone" | "desktop";
/** A run's state in the ledger: how it ended, or still running. */
export type RunState = RunOutcome | "running";
export type RunPlatform = "ios" | "android" | "mac" | "win";

export interface RunRow {
  userId: string;
  runId: string;
  surface: Surface;
  platform: RunPlatform;
  outcome: RunState;
  reason: RunReason | null;
  steps: number;
  effects: number;
  ms: number;
  firstMs: number | null;
  path: string | null;
  mode: "show" | "do" | null;
  language: string | null;
  taskId: string | null;
  follows: string | null;
  followedBy: string | null;
  title: string;
  said: string | null;
  turns: AgentTurn[] | null;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
}

/** One step, as the ledger writes it once the step's stream has closed. */
export interface StepRecord {
  runId: string;
  surface: Surface;
  platform: RunPlatform;
  /** As the request numbered it, from 0: the run's steps become max(steps, step + 1). */
  step: number;
  outcome: RunState;
  reason?: RunReason;
  /** Added to the run's totals. */
  effects: number;
  ms: number;
  /** Kept from the run's first step only. */
  firstMs?: number;
  path?: string;
  mode?: "show" | "do";
  language?: string;
  taskId?: string;
  follows?: string;
  /** Their words, cut to 80: written on the run's first step only. */
  title?: string;
  /** The words to try again with, or null to empty it. Undefined leaves it. */
  said?: string | null;
  /** The phone's question waiting for its answer, or null to empty it. Undefined leaves it. */
  turns?: AgentTurn[] | null;
}

export interface CallRow {
  runId: string;
  step: number;
  surface: Surface;
  at: number;
  model: string;
  provider?: string;
  served?: string;
  outcome: "ok" | "stopped" | "failed" | "timeout" | "empty";
  ms: number;
  firstMs?: number;
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  status?: number;
  picture?: boolean;
  deep?: boolean;
}

/** A run as a screen shows it (the You tab's Activity). Never its turns. */
export interface RunView {
  runId: string;
  surface: Surface;
  outcome: RunState;
  reason?: RunReason;
  title: string;
  at: number;
  steps: number;
  effects: number;
  taskId?: string;
  /** Their words, to ask again with: a phone run that failed having changed nothing, for a day. */
  retry?: string;
}

/** How long each thing is kept before the sweep closes or empties it. */
export interface SweepTimes {
  /** A desktop run with no step for this long is closed as cancelled / device_stopped. */
  quietMs: number;
  /** A phone question with no answer for this long: turns emptied, cancelled / unanswered. */
  followUpMs: number;
  /** The words kept to try again with. */
  retryMs: number;
  /** The title. */
  titleMs: number;
}
export const SWEEP_TIMES: SweepTimes = { quietMs: 10 * 60_000, followUpMs: 5 * 60_000, retryMs: 24 * 3_600_000, titleMs: 30 * 24 * 3_600_000 };

export interface RunStore {
  /** Creates the run's row on its first step, or brings it up to date. Steps never go down. */
  saveStep(userId: string, r: StepRecord): Promise<void>;
  addCalls(userId: string, calls: CallRow[]): Promise<void>;
  get(userId: string, runId: string): Promise<RunRow | null>;
  /** Newest first. */
  recent(userId: string, limit: number): Promise<RunView[]>;
  /**
   * The newest phone question still waiting for its answer since `since`,
   * claimed for the run `by` (followed_by set, turns emptied), once, for
   * whoever gets there first. Any older waiting question is emptied too.
   */
  takeFollowUp(userId: string, by: string, since: number): Promise<{ runId: string; turns: AgentTurn[] } | null>;
  /**
   * The words kept to try again with, let go wherever they are these words:
   * the person has asked with them again (Try again, or typed the same), so
   * the run they failed in no longer offers it.
   */
  forgetRetry(userId: string, said: string): Promise<void>;
  /** Across everyone: quiet runs closed, kept words emptied when their time is up. */
  sweep(now: number, times?: SweepTimes): Promise<{ closed: number; emptied: number }>;
}
