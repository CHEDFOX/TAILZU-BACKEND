/**
 * THE SMOKE SUITE'S SHARED TYPES: NINE ITEMS, EACH JUDGED PER STAGE OF THE REAL FLOW.
 */
export const SMOKE_STAGES = ["front", "locate", "plan", "work", "verify", "commit", "pr", "artifact", "research", "vision", "safety"] as const;
export type SmokeStage = (typeof SMOKE_STAGES)[number];

export const STAGE_NAMES: Record<SmokeStage, string> = {
  front: "front door", locate: "locate", plan: "plan", work: "work", verify: "verify", commit: "commit", pr: "PR", artifact: "artifact", research: "research", vision: "vision", safety: "safety",
};

export interface StageVerdict { ok: boolean; detail: string }

export interface ItemCassette { hits: number; misses: number; recorded: number; spentUsd: number; replayedUsd: number; missed?: Array<{ purpose?: string; model: string; summary: string }> }

export interface ItemResult {
  id: string;
  n: number;
  title: string;
  kind: "task" | "front" | "artifact" | "research" | "vision";
  ok: boolean;
  stages: Partial<Record<SmokeStage, StageVerdict>>;
  /** What the model calls cost, in paise (as charged for a real run, as recorded for a replay). */
  costPaise: number;
  calls: number;
  ms: number;
  detail: string;
  notes: string[];
  /**
   * What the HARNESS did to the item, as opposed to what the product did: it stopped a job at the turn cap (with the files it had staged), cut the time, described a
   * picture for it. The first re-check had an item fail on the harness's own 12-turn cap and the report said only "did not meet the task's checks"; these are shown
   * in the report next to the failure they explain.
   */
  harness: string[];
  cassette?: ItemCassette;
  error?: string;
}
