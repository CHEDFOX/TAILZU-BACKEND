/**
 * THE SHARED SHAPES OF THE REALITY PLAN.
 */
import type { CentPartResult } from "../bakeoff/centparts.js";
import type { Perf } from "./perf.js";
import type { Decision } from "./stats.js";
import type { StageName } from "./sampler.js";

export type PlanName = "quick" | "standard" | "deep";
/** real: models are called and paid. replay: the cassettes only. scripted: Tailzu's real flow on the harness's scripted models (free; the outcomes are the script's). sim: drawn outcomes (free; proves the logic). */
export type Mode = "real" | "replay" | "scripted" | "sim";
export type StageId = 0 | 1 | 2 | 3 | 4 | 5;

export const STAGE_TITLES: Record<StageId, string> = {
  0: "Free: offline suite, every cassette replayed, the free part bake-offs",
  1: "Cents: probes for models with no score yet",
  2: "Smoke, recorded",
  3: "Stratified real sample, our bot with the current ladders",
  4: "Comparisons with sequential testing",
  5: "Parts with the money left",
};

/** One contestant in a comparison: an agent with a model (or the product's own ladders). */
export interface Arm {
  id: string;
  agent: string;
  /** An OpenRouter slug, "ladders" (the product's tier table as it is), "recommended" (the ladders this plan recommends) or a scripted persona for scripted mode. */
  model: string;
  group: "agents" | "models";
}

export interface StageEstimate {
  stage: StageId;
  title: string;
  /** What the stage is expected to spend (with the early stops working). */
  expectedInr: number;
  /** The most it can spend if nothing stops early. */
  maxInr: number;
  /** What it would have cost but is already answered in the store. */
  reusedInr: number;
  /** Units of work: "9 models x 6 probes", "12 tasks". */
  units: string;
  notes: string[];
}

export interface ProbeOutcome { ok: boolean; score: number; detail: string; costInr: number; wallMs: number; errors: { failed: number; repaired: number; badToolCalls: number } }

export interface TaskOutcome {
  ok: boolean;
  costInr: number;
  wallMs: number;
  perf: Perf;
  /** The share of the task's checks that passed. */
  quality: number;
  detail: string;
  /** Set when the task was not run, and why ("needs a session where installs are allowed"). */
  skipped?: string;
}

export interface StageReport {
  stage: StageId;
  title: string;
  status: "done" | "skipped" | "aborted" | "partial" | "blocked";
  estimateInr: number;
  spentInr: number;
  reusedInr: number;
  /** The reason a stage did not run, or stopped. */
  reason?: string;
  lines: string[];
}

export interface ComparisonReport {
  id: string;
  title: string;
  group: "agents" | "models";
  tasks: string[];
  arms: string[];
  rounds: Array<{ round: number; tasks: string[]; decision: Decision; spentInr: number }>;
  final: Decision;
  /** "clear", "last" (only one left), "tie" (the tasks ran out), "budget" (the money did), "short". */
  ended: "clear" | "last" | "tie" | "budget" | "short" | "overrun";
  winner: string | null;
  runsSaved: number;
  /** Each arm's runs, for the frontier chart and the performance table. */
  runs: Array<{ arm: string; task: string; repeat: number; ok: boolean; costInr: number; perf: Perf; reused: boolean }>;
  repeats: number;
}

export interface PartReport { id: string; result: CentPartResult | null; reused: boolean; reason?: string }

export type { Decision, StageName };
