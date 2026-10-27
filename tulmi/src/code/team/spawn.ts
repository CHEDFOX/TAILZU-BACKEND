/**
 * STARTING A HELPER: ITS BRANCH, ITS JOB, ITS SLICE OF THE BUDGET, AND EVERYTHING IT NEEDS TO BEGIN WORKING AT ONCE.
 *
 * A helper is a child agent job on its own branch, `tailzu/<slug>-p<k>`, cut from the lead branch after the parts it waits for are in it (so, for a part that
 * needs nothing but part 0, right after part 0). It uses the existing loop, and starts where the lead already got to, so it does not repeat the lead's work and
 * is not asked what the person already answered:
 *
 *   plan, located   the lead's plan, cut down to the files this part owns (the impact and the checks recomputed for them), already approved
 *   baseline        what the project's checks said before any edit, as the lead measured it
 *   classification  the lead's
 *   phase           "work": no prepare, baseline, locate or plan of its own. A fix round (after a review) has no plan, so it is free-form, with the reviewer's findings
 *   guard           AgentState.part: the files it owns; a change outside them is refused (guard.ts)
 *
 * The job is written down before it is started, and found again (isChildOf) when the lead is picked up after a crash that came between the two.
 */
import { initialState, type AgentState } from "../agent/types.js";
import type { Run } from "../agent/run.js";
import { createNamedBranch, createWorkBranch, branchSlug, ownProject, repoRef } from "../projects.js";
import { ConnectorError } from "../../connectors/state.js";
import { computeImpact, riskOf } from "../work/impact.js";
import { verifyCommands, type ChangePlan } from "../work/plan.js";
import type { LocateTarget } from "../work/locate.js";
import { cut } from "../work/model.js";
import { isChildOf } from "./children.js";
import { owns } from "./globs.js";
import { REVIEW_FIX_ROUNDS_MAX, type PartContext, type TeamPart, type TeamState } from "./types.js";
import { randomBytes } from "node:crypto";

/** The slug in a helper's branch name: the lead branch's own (`tailzu/<slug>-<4 hex>`), else the goal's words. */
export function slugOf(leadBranch: string, goal: string): string {
  const m = /^tailzu\/(.+?)(?:-[0-9a-f]{4})?$/.exec(leadBranch);
  return m?.[1] || branchSlug(goal);
}

export const partBranchName = (slug: string, k: number): string => `tailzu/${slug}-p${k}`;

/** The task a helper is given: the part, the files it owns, how it is judged. The person's request is in it, whole, for what it says about the goal. */
export function partTask(t: Pick<TeamState, "goal">, p: TeamPart, o: { round: number }): string {
  const own = p.ownedPaths.slice(0, 12).join(", ");
  return [
    `Part ${p.id}, ${p.title}: you are a helper in a team. A lead split a big goal into parts that are built side by side; this part is yours.`,
    `The whole goal (for context; your part is only a piece of it): ${cut(t.goal, 1500)}`,
    `YOUR PART, ${p.title}: ${p.goal}`,
    `You own, and may change, only these files: ${own}. A change anywhere else is refused. If your part needs a change in a file that is not yours, do not try to make it: write what you need in a note and in your done summary, and the lead will see it.`,
    p.reads.length ? `You may read besides your own files: ${p.reads.slice(0, 12).join(", ")}.` : "",
    p.dependsOn.length ? "The parts you build on are already on your branch. Build on them; do not change them." : "",
    "Other helpers are building the other parts at the same time, in files you do not touch. Do not wait for them.",
    p.acceptance.length ? `You are done when:\n${p.acceptance.map((a) => `- ${cut(a, 300)}`).join("\n")}` : "",
    o.round > 0 ? `This is fix round ${o.round} of ${REVIEW_FIX_ROUNDS_MAX}: your work is on the branch already and a reviewer found problems, listed below. Fix them and change nothing else.` : "",
    "Keep the project's checks green. When the work is finished, call done and say what you did.",
  ].filter(Boolean).join("\n\n");
}

/** The lead's plan cut down to one part: its steps' files that the part owns, with the impact, the risk and the checks worked out again for them. Undefined when the plan has nothing in the part. */
export async function partPlanOf(r: Run, plan: ChangePlan, p: TeamPart): Promise<ChangePlan | undefined> {
  const steps = plan.steps
    .map((st) => ({ ...st, files: st.files.filter((f) => owns(p.ownedPaths, f.path)) }))
    .filter((st) => st.files.length > 0)
    .map((st, i) => ({ ...st, n: i + 1 }));
  if (!steps.length) return undefined;
  const changes = [...new Map(steps.flatMap((st) => st.files).map((f) => [f.path, f])).values()];
  const view = await r.brain.status().catch(() => null);
  const impact = await computeImpact(changes, r.brain, { entryPoints: (view?.structure?.entryPoints ?? []).map((e) => e.path) });
  const { risk, reasons } = riskOf(r.state.classification?.risk ?? "low", changes, impact);
  const verify = verifyCommands(await r.brain.baselinePlan().catch(() => []), impact, view?.structure?.testing.frameworks ?? []);
  return { steps, impact, verify, risk, riskReasons: reasons, notes: [], tier: plan.tier, paise: 0 };
}

/** Where a part's files are, for the helper's first look: the plan's files that exist (and so can be read) in the part. */
function locatedFor(p: ChangePlan | undefined): AgentState["located"] {
  const targets: LocateTarget[] = (p?.steps ?? []).flatMap((st) => st.files).filter((f) => f.action !== "create").slice(0, 8)
    .map((f) => ({ path: f.path, why: "the lead's plan for this part", signals: [], score: 1 }));
  return { targets, related: [], tests: p?.impact.tests.slice(0, 8) ?? [], confidence: 1, used: { expanded: false, picked: false, paise: 0 } };
}

export interface SpawnResult { jobId: string; branch: string; adopted: boolean }

/**
 * Starts a helper for a part (round 0) or a fix round. Makes the branch (round 0), the job with its slice of the budget, its state, and tells the driver to start
 * it. `budgetPaise` is what the job may spend. Returns the job's id.
 */
export async function spawnHelper(r: Run, t: TeamState, p: TeamPart, o: { round: number; budgetPaise: number; feedback?: string }): Promise<SpawnResult> {
  const d = r.deps.projects;
  const store = r.deps.store;
  const create = r.deps.jobs.createJob?.bind(r.deps.jobs);
  if (!create) throw new Error("the job router cannot make a helper's job here");
  const projectId = p.projectId ?? r.projectId;

  // A job made for this part and round before a crash is the one to use.
  const mine = (await store.listJobs(r.userId, 200)).find((j) => isChildOf(j, { parentId: r.jobId, part: p.id, round: o.round, attempt: p.attempts ?? 0 }));
  if (mine) {
    await r.deps.team?.start?.(mine.id);
    return { jobId: mine.id, branch: mine.branch, adopted: true };
  }

  // The branch: round 0 cuts it from the lead branch as it is now (the parts this one waits for are in it); a fix round works on the branch the helper made.
  let branch = p.branch;
  if (!branch) {
    const from = await d.github.branchHead(await repoOf(r, projectId), r.branch);
    const slug = slugOf(r.branch, t.goal);
    for (let attempt = 0; !branch; attempt += 1) {
      const name = attempt === 0 ? partBranchName(slug, p.id) : `${partBranchName(slug, p.id)}-${randomBytes(2).toString("hex")}`;
      try {
        const made = await createNamedBranch(d, r.userId, projectId, name, p.goal, { from, attended: true });
        branch = made.branch;
        p.baseSha = made.baseSha;
      } catch (err) {
        if (!(err instanceof ConnectorError && err.code === "branch_exists" && attempt < 3)) throw err;
      }
    }
    p.branch = branch;
  }

  const task = partTask(t, p, { round: o.round });
  const job = await create(r.userId, projectId, branch, task, o.budgetPaise, { agent: true });
  const state = initialState(task, r.now());
  state.phase = "work";
  state.teamMode = "off";
  state.part = { parentId: r.jobId, id: p.id, title: p.title, goal: p.goal, ownedPaths: p.ownedPaths, reads: p.reads, acceptance: p.acceptance, round: o.round, attempt: p.attempts ?? 0, refused: [] } satisfies PartContext;
  if (r.state.classification) state.classification = structuredClone(r.state.classification);
  if (r.state.baseline) state.baseline = structuredClone(r.state.baseline);
  state.repoEmpty = false;
  if (o.round === 0 && r.state.plan) {
    const plan = await partPlanOf(r, r.state.plan, p);
    if (plan) { state.plan = plan; state.planOk = true; }
    state.located = locatedFor(plan);
    state.handoff = true;
  }
  if (!state.plan) {
    // No plan for this part, or a fix round: the helper decides the order of its work (free-form), inside the same rails.
    state.mode = "freeform";
  }
  if (o.feedback) state.work.reviewFeedback = o.feedback;
  await store.casJob(job.id, { agentEpoch: job.agentEpoch }, { agent: true, checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> } });
  await r.deps.team?.start?.(job.id);
  return { jobId: job.id, branch, adopted: false };
}

async function repoOf(r: Run, projectId: string) {
  const project = projectId === r.projectId ? r.project : await ownProject(r.deps.projects, r.userId, projectId);
  return repoRef(r.deps.projects, r.userId, project);
}

/**
 * The task another project's lead is given: its share of the goal, and nothing of the other projects' (the lead finds where in ITS project the change belongs from these
 * words, and the other project's file names would lead it astray). The split writes each share so that it stands alone.
 */
export function repoTask(_t: Pick<TeamState, "goal">, p: TeamPart, o: { project: string }): string {
  return [
    `${o.project}'s share of a goal that spans several projects: ${p.title}.`,
    "Each project's share is built and opened as a pull request of its own, and the pull requests are linked. The other projects are done by others at the same time.",
    `YOUR SHARE: ${p.goal}`,
    p.acceptance.length ? `You are done when:\n${p.acceptance.map((a) => `- ${cut(a, 300)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * Starts another project's share of a goal that spans several: an ordinary job on a work branch of that project, with its own prepare, plan, work and pull request (and
 * its own team, if its plan is big). It is the lead's child like a helper is: it wakes the lead when it ends, and is stopped with it.
 */
export async function spawnRepoLead(r: Run, t: TeamState, p: TeamPart, o: { budgetPaise: number }): Promise<SpawnResult> {
  const d = r.deps.projects;
  const store = r.deps.store;
  const create = r.deps.jobs.createJob?.bind(r.deps.jobs);
  if (!create || !p.projectId) throw new Error("the job router cannot make another project's job here");
  const mine = (await store.listJobs(r.userId, 200)).find((j) => isChildOf(j, { parentId: r.jobId, part: p.id, round: 0, attempt: p.attempts ?? 0 }));
  if (mine) {
    await r.deps.team?.start?.(mine.id);
    return { jobId: mine.id, branch: mine.branch, adopted: true };
  }
  const project = await ownProject(d, r.userId, p.projectId);
  const task = repoTask(t, p, { project: project.fullName });
  const made = p.branch ? { branch: p.branch } : await createWorkBranch(d, r.userId, project.id, p.goal);
  p.branch = made.branch;
  const job = await create(r.userId, project.id, made.branch, task, o.budgetPaise, { agent: true });
  const state = initialState(task, r.now());
  state.part = { parentId: r.jobId, id: p.id, title: p.title, goal: p.goal, ownedPaths: [], reads: [], acceptance: p.acceptance, round: 0, attempt: p.attempts ?? 0, refused: [], repo: true } satisfies PartContext;
  await store.casJob(job.id, { agentEpoch: job.agentEpoch }, { agent: true, checkpoint: { ...job.checkpoint, agent: state as unknown as Record<string, unknown> } });
  await r.deps.team?.start?.(job.id);
  return { jobId: job.id, branch: made.branch, adopted: false };
}
