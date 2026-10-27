/**
 * WHEN A JOB BECOMES A LEAD: ONLY A BIG GOAL PAYS FOR A TEAM.
 *
 * A lead costs a split, a reviewer for every part and a merge, so a small task never has one. The plan decides (`planChange` knows how many files and how
 * many parts of the app a change reaches), by the same limits the milestone split uses (work/plan.ts):
 *
 *   more than 12 files in the plan                    why "files"
 *   more than 3 features (parts of the app) reached   why "features"
 *   a goal over several projects of the person's     why "repos"
 *   the person asked for a team ("on")                why "asked"
 *
 * and the person's word beats the plan: "off" (for this job, or for the project in its settings) is never a lead, whatever the plan reaches, and "on"
 * is one for any plan. The front door can set "on" or "off" from the words of the request (front/rules.ts). CODE_TEAM=false switches it off for the server.
 */
import { getConfig } from "../../config.js";
import type { AgentState, Phase } from "../agent/types.js";
import { FEATURES_MAX, FILES_MAX, type ChangePlan } from "../work/plan.js";
import type { TeamMode, TeamWhy } from "./types.js";

export interface LeadDecision { lead: boolean; why?: TeamWhy; reason: string }

export function leadDecision(f: { plan?: ChangePlan | undefined; mode?: TeamMode | undefined; projects?: number; enabled?: boolean }): LeadDecision {
  const enabled = f.enabled ?? getConfig().CODE_TEAM;
  if (!enabled) return { lead: false, reason: "Lead and helpers mode is switched off on this server." };
  if (f.mode === "off") return { lead: false, reason: "Lead and helpers mode is off for this job." };
  const projects = f.projects ?? 1;
  if (projects > 1) return { lead: true, why: "repos", reason: `The goal spans ${projects} projects, so each project gets its own part.` };
  if (f.mode === "on") return { lead: true, why: "asked", reason: "You asked for a team." };
  const files = f.plan?.impact.files.length ?? 0;
  if (files > FILES_MAX) return { lead: true, why: "files", reason: `The plan changes ${files} files, which is more than ${FILES_MAX}.` };
  const features = f.plan?.impact.features.length ?? 0;
  if (features > FEATURES_MAX) return { lead: true, why: "features", reason: `The plan reaches ${features} parts of the app, which is more than ${FEATURES_MAX}.` };
  return { lead: false, reason: `The plan is small enough (${files} file${files === 1 ? "" : "s"}, ${features} feature${features === 1 ? "" : "s"}) for one job.` };
}

/** The phase after the plan is made and approved: the split for a goal that is big, else the work. A helper never splits, and a job already split goes on. */
export function afterPlan(s: AgentState): Phase {
  if (s.part) return "work";
  if (s.team) return s.team.stage === "contracts" ? "work" : "team";
  const d = leadDecision({ plan: s.plan, mode: s.teamMode, projects: 1 + (s.teamRepos?.length ?? 0) });
  return d.lead ? "split" : "work";
}
