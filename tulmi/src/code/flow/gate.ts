/**
 * THE XODE FLOW'S GATE: the chat opens only once Xode has read the project AND knows where its owner wants it to go.
 *
 *   gateOf(brain, book)   { open, reading, vision }: reading is the brain's build (its percent and phase); vision is "given" (the owner wrote
 *                         their direction or vision), "skipped" (they let Xode suggest one) or "missing". Open when the read is done and
 *                         the vision is given or skipped. A brain that failed is "failed", so the screen offers to read again.
 */
import type { OwnerAnswers } from "../project/book.js";

export type Reading = { status: "none" | "building" | "ready" | "failed" | "stale"; pct: number; phase: string };
export type VisionState = "given" | "skipped" | "missing";
export interface Gate { open: boolean; reading: Reading; vision: VisionState }

/** What the brain says, as far as the gate reads it. */
export interface BrainLike { status?: string; progress?: { pct?: number; phase?: string } | null }

export function visionOf(owner: OwnerAnswers | null | undefined): VisionState {
  if (!owner) return "missing";
  if (owner.vision || owner.for || owner.next) return "given";
  return owner.skipped ? "skipped" : "missing";
}

export function gateOf(brain: BrainLike | null | undefined, owner: OwnerAnswers | null | undefined): Gate {
  const raw = brain?.status;
  const status: Reading["status"] = raw === "building" || raw === "ready" || raw === "failed" || raw === "stale" ? raw : "none";
  // A stale brain was read before and is being brought up to date: the chat can open on what was read.
  const read = status === "ready" || status === "stale";
  const pct = read ? 100 : Math.max(0, Math.min(99, Math.round(Number(brain?.progress?.pct ?? 0))));
  const vision = visionOf(owner);
  return { open: read && vision !== "missing", reading: { status, pct, phase: read ? "done" : String(brain?.progress?.phase ?? "") }, vision };
}
