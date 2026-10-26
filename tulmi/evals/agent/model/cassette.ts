/**
 * CASSETTES: a live run's planner answers, kept so they can be played again
 * for free.
 *
 * One file per task, evals/agent/cassettes/<taskId>.json, written by
 * `npm run bench:record` (live, --record). For every planner call it holds
 * the call's key (adapter.ts cassetteKey) and, under it, one entry per time
 * that call was made: the chunks as they arrived, each with its offset from
 * the call's start, and the call's log line (model, timing, tokens, what
 * OpenRouter charged). Never anything else about the person or the run: the
 * request itself is only its hash.
 *
 * The version is in the file and in every key, so a change to how keys are
 * made turns old cassettes into misses, never into wrong answers.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanChunk } from "../../../src/agent/llm.js";
import { RealDate } from "../clock.js";
import type { GraderId } from "../types.js";
import { CASSETTE_VERSION } from "./adapter.js";

/** Where cassettes live in the repository. */
export const CASSETTE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "cassettes");

/** One model call's log line, as the planner's `log` gives it (llm.ts CallRecord), with OpenRouter's cost when it sent one. */
export interface RecordedCall {
  model: string;
  outcome: string;
  ms: number;
  firstMs?: number;
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  provider?: string;
  served?: string;
  status?: number;
}

export interface CassetteEntry {
  /** The live trial it was recorded in. */
  trial?: number;
  chunks: Array<PlanChunk & { at: number }>;
  call: RecordedCall;
  /** Every model on the ladder failed before writing: replay fails the same way. */
  error?: "unavailable";
}

export interface Cassette {
  v: number;
  task: string;
  models: string[];
  recordedAt: string;
  git: string;
  entries: Record<string, CassetteEntry[]>;
  /**
   * The hard graders each recorded trial failed, by trial: what a replay must
   * come out as again (tests/roz-bench-replay.test.ts), so a change to the
   * server after the model's answer shows without paying for the model.
   */
  graded?: Record<string, GraderId[]>;
}

const fileName = (taskId: string) => `${taskId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
export const cassettePath = (dir: string, taskId: string): string => join(dir, fileName(taskId));

/** A new, empty cassette for a task, recorded now. */
export function newCassette(task: string, models: string[], git: string): Cassette {
  return { v: CASSETTE_VERSION, task, models: [...models], recordedAt: new RealDate().toISOString(), git, entries: {} };
}

/** The task's cassette, or why there is none to play: no file, or one written by another version. */
export function readCassette(dir: string, taskId: string): { cassette: Cassette } | { missing: string } {
  let raw: string;
  try {
    raw = readFileSync(cassettePath(dir, taskId), "utf8");
  } catch {
    return { missing: "no cassette" };
  }
  let c: Cassette;
  try {
    c = JSON.parse(raw) as Cassette;
  } catch {
    return { missing: "cassette unreadable" };
  }
  if (c?.v !== CASSETTE_VERSION || typeof c.entries !== "object" || !Array.isArray(c.models)) {
    return { missing: `cassette version ${String(c?.v)}, not ${CASSETTE_VERSION}` };
  }
  return { cassette: c };
}

/** Written whole, through a temporary file, so a run cut short never leaves half a cassette. */
export function writeCassette(dir: string, c: Cassette): string {
  mkdirSync(dir, { recursive: true });
  const path = cassettePath(dir, c.task);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(c, null, 1)}\n`);
  renameSync(`${path}.tmp`, path);
  return path;
}

/** How many live trials a cassette holds: as its entries say, else the most answers under any one key. */
export function recordedTrials(c: Cassette): number {
  const entries = Object.values(c.entries);
  const tagged = entries.flat().filter((e) => e.trial !== undefined);
  return tagged.length ? 1 + Math.max(...tagged.map((e) => e.trial!)) : Math.max(1, ...entries.map((e) => e.length));
}
