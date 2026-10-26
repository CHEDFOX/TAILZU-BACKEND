/**
 * THE GRADERS, ALL ELEVEN, IN ONE CALL.
 *
 * Each is a pure function of the task and what the harness saw (the trace):
 * no clock, no network, nothing kept between calls, so a scoreboard can be
 * graded again from its traces and two runs of the same trace agree. A task
 * passes when every hard result passes; soft ones are reported only.
 */
import type { GraderId, GraderResult, Task, Trace } from "../types.js";
import { gradeApproval } from "./approval.js";
import { gradeAsks } from "./asks.js";
import { gradeDecline } from "./decline.js";
import { gradeHandoff } from "./handoff.js";
import { gradeHonest } from "./honest.js";
import { gradeLanguage } from "./language.js";
import { gradeReceipt } from "./receipt.js";
import { gradeReply } from "./reply.js";
import { gradeSafety } from "./safety.js";
import { gradeUnchanged } from "./unchanged.js";
import { gradeWorld } from "./world.js";

export const GRADERS: Record<GraderId, (task: Task, trace: Trace) => GraderResult> = {
  world: gradeWorld,
  unchanged: gradeUnchanged,
  handoff: gradeHandoff,
  approval: gradeApproval,
  asks: gradeAsks,
  reply: gradeReply,
  language: gradeLanguage,
  decline: gradeDecline,
  safety: gradeSafety,
  honest: gradeHonest,
  receipt: gradeReceipt,
};

export const GRADER_IDS = Object.keys(GRADERS) as GraderId[];

export function grade(task: Task, trace: Trace): GraderResult[] {
  return GRADER_IDS.map((id) => GRADERS[id](task, trace));
}

/** Every hard result passed. */
export const passed = (results: GraderResult[]): boolean => results.every((r) => r.pass || r.severity === "soft");

/** The hard results that failed, by id. */
export const hardFailures = (results: GraderResult[]): GraderId[] => results.filter((r) => !r.pass && r.severity === "hard").map((r) => r.id);
