/**
 * THE AGENT UNDER TEST: THE ONE SEAM BETWEEN THE REALITY CHECK AND WHATEVER DOES THE WORK.
 *
 * The harness prepares a task (a project at a pinned commit, files planted over it, dependencies linked in), asks an AGENT to do the request, and scores
 * what comes back: a set of file changes (a diff) and some metrics. It does not care how the agent got there. Tailzu's own flow is one implementation
 * (agents/tailzu.ts); an open-source agent run headless in the same checkout against the same OpenRouter model is another (OpenHands, Aider, opencode,
 * Codex CLI are meant to be added as further implementations of this interface, scored by the same hidden checks). `patch` (agents/patch.ts) applies a
 * task's known-correct patch and nothing else: the smallest second implementation, and the baseline the scoring is proven against.
 *
 * WHAT AN AGENT IS GIVEN (AgentRunInput)
 *   task, request   what the person typed (and `images`, absolute paths of the pictures that came with it)
 *   checkout        a git work tree at the task's base: the project, planted files committed, dependencies installed. An agent that works on files
 *                   works HERE and may leave its changes uncommitted; the runner reads them out. An agent with its own project store (Tailzu's, over a
 *                   local git host) can ignore it: it declares `usesCheckout: false`
 *   model           what to think with: a slug, or a ladder, or (for Tailzu) the product's tier table or a scripted mode
 *   budgetPaise     the most it may spend; timeoutSec the most wall time
 *   outDir          where it may write its transcript
 *
 * WHAT IT RETURNS (AgentRunResult)
 *   changes         the files it changed (path -> new text, null = deleted); omitted: the runner reads them from the checkout with git
 *   answer          the last thing it said to the person (a question's answer, a report); the scorer reads it for facts, refusals, flagged failures
 *   metrics         cost, tokens, steps, tool calls and errors, wall time, models used
 *   transcriptPath  where its transcript is, if it kept one
 *   flow            only Tailzu: the facts about its own flow (questions asked, phases, the pull request, the work log), which feed the flow-specific
 *                   checks and the stage attribution. Other agents leave it out, and those checks are skipped for them, not failed.
 *
 * PARTS. Pieces of an agent can be compared in isolation, each against its own ground truth, through the part hooks below (agents/parts.ts has the
 * scorers and Tailzu's implementations): finding the files a change belongs in, applying a model's proposed edit, and condensing a long working
 * context. A part is a function of one input with a known right answer; no agent loop is run.
 */
import type { ModelTier, TierSettings } from "../../src/code/brain/tiers.js";
import type { ModelMode } from "../adapters/models.js";
import type { RigOptions } from "../adapters/rig.js";
import type { Persona } from "../adapters/personas.js";
import type { RunTrace } from "../runTask.js";
import type { Task } from "../tasks/schema.js";

export interface FileChange { path: string; content: string | null }

export interface ModelSpec {
  /** How Tailzu's own flow is wired: the real OpenRouter door, a scripted model that fails on purpose, or the oracle. Other agents are always "real". */
  mode: ModelMode;
  /** One model for everything the agent does (an external agent is given this one). */
  slug?: string;
  /** Models to try in order (an agent with its own fallbacks). */
  ladder?: string[];
  /** Tailzu's tier table, for a bake-off of its tiers. */
  tiers?: Record<ModelTier, TierSettings>;
  /** The scripted persona for mode "fake". */
  persona?: Persona;
  /** Cassettes: record the model's answers, or replay them for nothing (adapters/cassette.ts). */
  cassette?: RigOptions["cassette"];
  /** Oracle and fake runs answer through the real gateway over a scripted OpenAI-shaped client (implied by a cassette). */
  wire?: boolean;
  /** Most work turns a task may take. */
  maxTurns?: number;
  /** The most any model call may write. */
  maxTokens?: number;
  /**
   * For an agent that speaks HTTP (an external one): the base URL of the local recording proxy (e2e/proxy.ts) to give it as its OpenAI-compatible
   * endpoint. Every model call it makes is then recorded once and replayed for free, under the run's spend cap. Tailzu's own flow uses `cassette` in process.
   */
  proxyUrl?: string;
}

export interface AgentRunInput {
  task: Task;
  request: string;
  images: string[];
  checkout: string;
  model: ModelSpec;
  budgetPaise: number;
  timeoutSec: number;
  outDir: string;
  repeat: number;
  log: (s: string) => void;
  /** What the repo summaries may cost per project, for agents that build a project index (Tailzu's brain). */
  brainBudgetPaise?: number;
}

export interface AgentMetrics {
  costPaise: number;
  promptTokens: number;
  completionTokens: number;
  /** Model turns. */
  steps: number;
  toolCalls: number;
  toolErrors: number;
  modelCalls: number;
  wallMs: number;
  /** Calls per model slug. */
  models: Record<string, number>;
  /** What the cassettes did, when there were any. */
  cassette?: { hits: number; misses: number; recorded: number; spentUsd: number; replayedUsd: number; missed?: Array<{ purpose?: string; model: string; summary: string }> };
}

export type AgentStatus = "finished" | "failed" | "timeout" | "budget" | "error";

export interface AgentRunResult {
  agent: string;
  status: AgentStatus;
  reason: string;
  changes?: FileChange[];
  /** A unified diff of the changes, for the report; the runner makes one when the agent gives none. */
  diff?: string;
  answer: string;
  metrics: AgentMetrics;
  transcriptPath: string | null;
  flow?: RunTrace;
}

export interface AgentUnderTest {
  readonly id: string;
  readonly describe: string;
  /** The model modes it can be run in. Tailzu: real, fake, oracle. An external agent: real only. */
  readonly modes: readonly ModelMode[];
  /** False when the agent keeps its own copy of the project and has no use for `checkout`. */
  readonly usesCheckout: boolean;
  run(input: AgentRunInput): Promise<AgentRunResult>;
  /** Called once when the harness is done with it. */
  dispose?(): Promise<void>;
}

// ------------------------------------------------------------------ parts

/** Finding where a change belongs: the ranked files, best first. */
export interface LocatePart {
  readonly id: string;
  locate(i: { task: Task; request: string; k: number; model: ModelSpec; log: (s: string) => void }): Promise<{ files: string[]; ms: number; costPaise: number }>;
}

/** A search-and-replace edit a model proposed. */
export interface EditProposal { path: string; old: string; new: string }

/** Whether a model's proposed edit applies cleanly to a file's text, and what the text is after. */
export interface EditApplyPart {
  readonly id: string;
  apply(i: { path: string; text: string; proposal: EditProposal }): Promise<{ applied: boolean; text?: string; reason: string }>;
}

/** Condensing a long working context into notes that keep what matters. */
export interface CondensePart {
  readonly id: string;
  condense(i: { lines: string[]; maxChars: number; model: ModelSpec; log: (s: string) => void }): Promise<{ summary: string; costPaise: number; ms: number }>;
}

export interface Parts { locate?: LocatePart; editApply?: EditApplyPart; condense?: CondensePart }
