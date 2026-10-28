/**
 * ADAPTIVE EFFORT: HOW HARD THE MODEL THINKS, TURN BY TURN, IN A FREE-FORM JOB.
 *
 * A thinking model's work turn at the code tier's level ("medium", which DeepSeek V4.1 Flash takes as "high") takes 30 to 100 seconds, and some ran into the
 * 100-second timeout. Most of a job's turns do not need it: once the model has decided what to change, reading the next file, searching, running a command or
 * applying the edit it already decided on is mechanical. So, with CODE_EFFORT=adaptive, a turn thinks at the tier's own level (HIGH) when it decides something
 * and at "low" (LOW) when it carries out a decision:
 *
 *   HIGH  understanding the task: every turn until the first edit (a question to answer never edits, so all of its turns are HIGH)
 *         the person has just answered the model's question, or said something new
 *         a check or a command failed, or a check, a test request, a design or a review finding came back for this turn
 *         the model wrote words and no tool (it is deciding to finish, or answering)
 *         a command passed with edits staged: the review before done
 *   LOW   the rest, after the first edit: reading, searching and listing, edits that applied, an edit that did not apply once
 *
 * The router still picks the tier and the model (route.ts); only the effort of a LOW turn is lowered, never raised, and a tier that does not think stays off.
 * CODE_EFFORT=high (the default until the paired run says otherwise) keeps every turn at the tier's level. Pure: unit-tested in tests/code-agent-effort.test.ts.
 */
import type { Reasoning } from "../brain/tiers.js";
import type { Exchange } from "./types.js";

/** "high": every turn at the tier's level. "adaptive": turnEffort decides, turn by turn. */
export type EffortMode = "adaptive" | "high";
export type TurnEffort = "high" | "low";

export interface TurnFacts {
  /** The job's turns so far, oldest first. */
  exchanges: ReadonlyArray<Pick<Exchange, "calls" | "results" | "text">>;
  /** A check failed, a focused test was asked for, or a design or review finding came back, and no turn has seen it yet. */
  freshFeedback: boolean;
  /** The person answered the model's question since the last turn. */
  answered: boolean;
  /** The person said something new since the last turn. */
  said: boolean;
}

export const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit_file", "write_file", "delete_file"]);

const failedOf = (ex: TurnFacts["exchanges"][number], names: (n: string) => boolean): boolean => ex.calls.some((c, i) => names(c.name) && ex.results[i]?.ok === false);
const passedOf = (ex: TurnFacts["exchanges"][number], names: (n: string) => boolean): boolean => ex.calls.some((c, i) => names(c.name) && ex.results[i]?.ok === true);

/** How hard the next turn thinks, and why (for the log and the tests). */
export function turnEffort(f: TurnFacts): { effort: TurnEffort; why: string } {
  const high = (why: string) => ({ effort: "high" as const, why });
  if (f.freshFeedback) return high("a check, a test request or a finding came back");
  if (f.answered) return high("the person answered the question");
  if (f.said) return high("the person said something new");
  const edited = f.exchanges.some((ex) => passedOf(ex, (n) => EDIT_TOOLS.has(n)));
  if (!edited) return high("understanding the task: nothing is edited yet");
  const last = f.exchanges[f.exchanges.length - 1];
  if (!last) return high("the first turn");
  if (!last.calls.length) return high("it wrote words and no tool: finishing or answering");
  if (failedOf(last, (n) => n === "run" || n === "done")) return high("a command failed");
  const prev = f.exchanges[f.exchanges.length - 2];
  if (failedOf(last, (n) => EDIT_TOOLS.has(n)) && prev && failedOf(prev, (n) => EDIT_TOOLS.has(n))) return high("an edit did not apply twice in a row");
  if (passedOf(last, (n) => n === "run")) return high("a command passed with edits staged: the review before done");
  return { effort: "low", why: "carrying out a decision: reading, searching or editing after the first edit" };
}

/** The level a turn is sent at: the tier's own for HIGH; for LOW, "low" unless the tier thinks less already. */
export function effortLevel(tier: Reasoning, effort: TurnEffort): Reasoning {
  if (effort === "high" || tier === "none" || tier === "low") return tier;
  return "low";
}

/** A short mark of the feedback a turn was shown, so the next turns know it is no longer fresh. */
export function feedbackMark(text: string): string {
  return text ? `${text.length}:${text.slice(0, 40)}:${text.slice(-40)}` : "";
}
