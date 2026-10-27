/**
 * THE LEAD: SPLIT THE GOAL, DO THE CONTRACTS, RUN THE HELPERS, REVIEW AND MERGE THEIR PARTS, THEN HAND THE WHOLE BACK TO THE ORDINARY CHECK AND PULL REQUEST.
 *
 * Two phases of the agent loop are the lead's (agent/loop.ts), and the rest of a lead's life is the ordinary phases with small hooks:
 *
 *   split      the plan is divided into parts (split.ts). If the split cannot be made right the lead does the work itself, as an ordinary job, and says so
 *   (work)     part 0, the shared contracts, is the lead's own work: the ordinary work, verify and commit phases, held to part 0's files (guard.ts)
 *   team       the helpers: start the ones that can start, watch the ones that run, review what is finished, send a part back for a fix, merge the approved ones into
 *              the lead branch in dependency order. When nothing is left to do until a helper changes, the lead RESTS (TeamWait): its claim is let go, it holds no
 *              place among the jobs a server drives, and a helper that ends or parks wakes it at once (on Cloudflare, a Workflow event)
 *   (merge)    a part with a conflict goes through the runner merge flow (agent/merge.ts), the ordinary merge phase, and comes back to `team`
 *   (verify)   everything merged: the FULL check against the baseline (and the design round, if there is a spec), fix rounds by the lead itself, then commit and pr
 *
 * EVERYTHING HERE CAN BE ENTERED AGAIN. Each part's state is written before and after each thing done to it; a helper's job is found again if the lead died between
 * making it and writing it down (spawn.ts); a merge that was made and not written down is found in the lead branch (integrate.ts); a slice of the budget taken
 * from the lead's wallet is written down before it is taken. A lead that crashes and is picked up again does not run a finished part twice.
 *
 * MONEY. The helpers' slices are taken from the lead's wallet when the first helper starts (budget.ts), and what a part did not spend is given back when it ends.
 * A part that runs out of its slice stops cleanly (the ordinary budget stop of its job), is marked exhausted and reported; the lead goes on with the others, and
 * when only exhausted parts are left it parks for the person: more budget goes to them, or they are stopped.
 */
import { getConfig } from "../../config.js";
import type { Run } from "../agent/run.js";
import { BudgetStop, EndJob, LostClaim, Park, TeamWait } from "../agent/run.js";
import { rupees, topUpFor, type AgentState } from "../agent/types.js";
import { ownProject, repoRef } from "../projects.js";
import { cut } from "../work/model.js";
import type { ChangePlan } from "../work/plan.js";
import { adjustSpend, affordable, parallelCap, reserveOf, sliceBudgets } from "./budget.js";
import { readChild, type Child } from "./children.js";
import { fileDiffOf } from "./changes.js";
import { mergePart } from "./integrate.js";
import { reviewDiff, findingsText, hasBlocker } from "./review.js";
import { spawnHelper, spawnRepoLead } from "./spawn.js";
import { splitWork, type SplitRepo } from "./split.js";
import { leadDecision } from "./when.js";
import {
  PART_ENDED, PART_WORKING, PART_PAISE_MIN, REVIEW_FIX_ROUNDS_MAX, TEAM_COMMANDS_MAX, TEAM_REST_MS, boardOf,
  type PartSpec, type PartStatus, type TeamCommand, type TeamPart, type TeamState,
} from "./types.js";

/** Rounds of looking at the parts in one pass of the team phase, so a pass that keeps finding something to do still comes to an end. */
const SWEEPS_MAX = 40;
/** How long the lead rests when every part that is left waits for the person. */
export const TEAM_IDLE_REST_MS = 5 * 60_000;

const ended = (p: TeamPart): boolean => PART_ENDED.includes(p.status);
const working = (t: TeamState): number => t.parts.filter((p) => PART_WORKING.includes(p.status)).length;
const byId = (t: TeamState, id: number): TeamPart | undefined => t.parts.find((p) => p.id === id);

/** The phase a lead is in, from its team's stage: where it goes on after a restart. */
export function phaseFor(t: TeamState): "work" | "team" | "verify" {
  return t.stage === "contracts" ? "work" : t.stage === "run" ? "team" : "verify";
}

// ------------------------------------------------------------------ split

async function reposOf(r: Run): Promise<SplitRepo[]> {
  const out: SplitRepo[] = [];
  for (const id of r.state.teamRepos ?? []) {
    const project = await ownProject(r.deps.projects, r.userId, id);
    let summary: string | undefined;
    try { summary = (await (await r.deps.brain.open(r.userId, id)).status()).welcome ?? undefined; } catch { summary = undefined; }
    out.push({ projectId: id, name: project.fullName, ...(summary ? { summary } : {}) });
  }
  return out;
}

/** Which of the plan's files import which: [from, to], among the plan's own files. */
async function edgesOf(r: Run, plan: ChangePlan | undefined): Promise<Array<[string, string]>> {
  const files = [...new Set((plan?.steps ?? []).flatMap((s) => s.files.map((f) => f.path)))];
  const set = new Set(files);
  const edges: Array<[string, string]> = [];
  for (const f of files.slice(0, 60)) {
    const n = await r.brain.neighbors(f).catch(() => null);
    for (const to of n?.imports ?? []) if (set.has(to) && to !== f) edges.push([f, to]);
  }
  return edges;
}

function toPart(spec: PartSpec): TeamPart {
  return {
    ...spec, status: spec.id === 0 ? "running" : spec.dependsOn.length ? "waiting" : "ready", jobIds: [], budgetPaise: 0, reservedPaise: 0, refundedPaise: 0, spentPaise: 0,
    fixRounds: 0, reviews: [], paths: [], refused: [],
  };
}

function contractsTask(t: Pick<TeamState, "goal" | "parts">, p0: TeamPart): string {
  const others = t.parts.filter((p) => p.id !== 0).map((p) => `${p.title}`).slice(0, 8);
  return [
    t.goal,
    `YOU ARE THE LEAD OF A TEAM. The goal is big, so it is split into parts that helpers build side by side after you. First comes part 0, the shared contracts they all build on: ${p0.goal}`,
    `Change only these files: ${p0.ownedPaths.slice(0, 12).join(", ")}. Anything else is refused: the helpers own the rest.`,
    p0.acceptance.length ? `Part 0 is done when:\n${p0.acceptance.map((a) => `- ${cut(a, 300)}`).join("\n")}` : "",
    others.length ? `The helpers build these afterwards, so leave them alone: ${others.join("; ")}.` : "",
    "Make the contracts compile and keep the project's checks green, then call done.",
  ].filter(Boolean).join("\n\n");
}

/** One line per part, for the work log. */
const partsLine = (parts: readonly TeamPart[]): string => parts.map((p) => `${p.id === 0 ? "contracts" : `part ${p.id}`}: ${p.title}`).join("; ");

export async function splitPhase(r: Run): Promise<void> {
  const s = r.state;
  if (s.team) { s.phase = phaseFor(s.team); await r.save(); return; }
  const repos = await reposOf(r);
  const decision = leadDecision({ plan: s.plan, mode: s.teamMode, projects: 1 + repos.length });
  if (!decision.lead) { s.phase = "work"; await r.save(); return; }
  const job = await r.job();
  await r.log.decision(`This is a big goal, so I will lead a team. ${decision.reason} First I split it into parts that do not touch the same files.`);
  const res = await splitWork(r.model(), {
    task: s.task, ...(s.plan ? { plan: s.plan } : {}), files: await r.brain.paths(5000).catch(() => []), edges: await edgesOf(r, s.plan), repos, project: r.project.fullName,
    ...(s.classification ? { classification: s.classification } : {}), remainingPaise: Math.max(0, job.budgetPaise - job.spentPaise),
  });
  if (!res.ok) {
    if (res.why === "aborted") throw new LostClaim();
    if (res.why === "budget") throw new BudgetStop(0);
    const why = res.why === "down" ? "No model could be reached to split it." : `The parts kept overlapping or leaving files out (${cut(res.problems[0] ?? "no usable split", 160)}).`;
    // A goal over several projects cannot be done by one job on one project: nothing is left to fall back on.
    if (repos.length) throw new EndJob("failed", `${why} A goal over several projects needs the split, so I stopped. Nothing was changed.`);
    s.teamMode = "off";
    r.note(`I could not divide this into parts that do not overlap, so I did it myself as one job. ${why}`);
    await r.log.decision(`No team: ${why} I will do the work myself.`);
    s.phase = "work";
    await r.save();
    return;
  }
  const parts = res.parts.map(toPart);
  const contracts = parts.find((p) => p.id === 0);
  const cap = parallelCap({ configured: getConfig().CODE_TEAM_PARALLEL, ...(r.deps.jobs.capacity ? { capacity: await r.deps.jobs.capacity(job).catch(() => undefined) } : {}) });
  const t: TeamState = {
    stage: contracts ? "contracts" : "run", why: decision.why ?? "asked", reason: decision.reason, goal: s.task, parts, parallel: cap.cap, reservePaise: reserveOf(job.budgetPaise), poolPaise: 0,
    repos: repos.map((x) => x.projectId), splitRounds: res.rounds, handled: [], links: [],
    notes: [...res.notes, ...(cap.cap < getConfig().CODE_TEAM_PARALLEL && cap.why ? [`Helpers work ${cap.cap} at a time: ${cap.why}.`] : [])].slice(0, 8), startedAt: r.now(),
  };
  s.team = t;
  await r.log.decision(`Split into ${parts.length} part${parts.length === 1 ? "" : "s"}${res.rounds > 1 ? ` (asked ${res.rounds} times: the first answers overlapped)` : ""}: ${cut(partsLine(parts), 600)}.`);
  for (const p of parts) await r.log.step(`${p.id === 0 ? "Part 0, the contracts" : `Part ${p.id}`}: ${p.title}`, p.ownedPaths.slice(0, 6));
  if (contracts) {
    s.task = contractsTask(t, contracts);
    s.phase = "work";
  } else {
    t.baseSha = undefined;
    s.phase = "team";
  }
  board(r, t);
  await r.save();
}

// ---------------------------------------------------------------- contracts

/** What a job's work state is when a new piece of work starts on it (the contracts are done and the helpers' parts follow; the full check's fixes come last). */
function resetWork(s: AgentState): void {
  const w = s.work;
  w.exchanges = []; w.digests = []; w.summary = ""; w.turns = 0; w.badTurns = 0; w.fixRounds = 0; w.runs = 0; w.finished = false; w.nudged = false;
  w.doneSummary = undefined; w.feedback = undefined; w.designFeedback = undefined; w.excerpts = undefined; w.roundStartPaise = undefined; w.roundStartedAt = undefined;
}

/** Part 0 is committed (or turned out to need no change): the helpers can start. */
export async function afterContracts(r: Run, o: { sha?: string; none?: boolean } = {}): Promise<void> {
  const s = r.state;
  const t = s.team;
  if (!t || t.stage !== "contracts") return;
  const p0 = byId(t, 0)!;
  p0.status = "merged";
  if (o.sha) p0.mergedSha = o.sha;
  if (o.none) { p0.noChange = true; p0.reason = "Nothing in the shared contracts needed changing."; }
  t.stage = "run";
  s.task = t.goal;
  s.verify = undefined; s.verified = undefined; s.commit = undefined;
  resetWork(s);
  s.phase = "team";
  await r.log.decision(o.none ? "The contracts needed no change; the helpers start from the branch as it is." : `The contracts are committed (${o.sha?.slice(0, 7)}); the helpers start from there.`);
  board(r, t);
  await r.save();
}

// ------------------------------------------------------------------- board

function board(r: Run, t: TeamState): void {
  r.progress({ t: "team", parts: boardOf(t), at: r.now() });
}

// ------------------------------------------------------------ the money

/** Takes `wantPaise` more than the part holds from the lead's wallet, if the wallet has it. Returns whether the part now holds enough. */
async function ensureHeld(r: Run, p: TeamPart, wantPaise: number): Promise<boolean> {
  const held = p.reservedPaise - p.refundedPaise - p.spentPaise;
  const short = Math.ceil(wantPaise - held);
  if (short <= 0) return true;
  const job = await r.job();
  if (job.budgetPaise - job.spentPaise < short + 50) return false;
  p.reservedPaise += short;
  await r.save();
  await adjustSpend(r.deps.store, r.jobId, short);
  return true;
}

/** A part has ended: what it spent is counted, and what it was given and did not spend goes back to the lead. */
async function settle(r: Run, p: TeamPart): Promise<void> {
  p.spentPaise = await spentOf(r, p);
  p.endedAt ??= r.now();
  const back = p.reservedPaise - p.refundedPaise - p.spentPaise;
  if (back <= 0) { await r.save(); return; }
  // Written down first: a restart between the two loses a refund (in the person's disfavour by a few paise) and never gives one twice.
  p.refundedPaise += back;
  await r.save();
  await adjustSpend(r.deps.store, r.jobId, -back);
}

async function spentOf(r: Run, p: TeamPart): Promise<number> {
  let n = 0;
  for (const id of p.jobIds) n += (await r.deps.store.getJobById(id))?.spentPaise ?? 0;
  return n;
}

/** The first time the helpers are about to start: the pool is worked out, divided among them, and taken from the lead's wallet. Parks for money when the budget cannot pay a team. */
async function startRun(r: Run, t: TeamState): Promise<void> {
  const d = r.deps.projects;
  if (!t.allocated) {
    const helpers = t.parts.filter((p) => p.id !== 0 && !ended(p));
    if (t.reserving) {
      // A restart between writing the reservation down and taking it: taken if the lead's spend already shows it.
      const job = await r.job();
      if (job.spentPaise < t.reserving.spentBefore + t.reserving.poolPaise) await adjustSpend(r.deps.store, r.jobId, t.reserving.poolPaise);
      t.allocated = true; t.reserving = undefined;
      await r.save();
    } else {
      const job = await r.job();
      const remaining = job.budgetPaise - job.spentPaise;
      const ok = affordable(remaining, t.reservePaise, helpers.length);
      if (!ok.ok) {
        await r.log.decision(`The budget cannot pay for a team yet: it needs ${rupees(ok.needPaise)} more.`);
        throw new BudgetStop(ok.needPaise);
      }
      const pool = Math.max(0, remaining - t.reservePaise);
      const slices = sliceBudgets(pool, helpers.map((p) => p.budgetShare));
      helpers.forEach((p, i) => { p.budgetPaise = slices[i]!; p.reservedPaise = slices[i]!; });
      t.poolPaise = pool;
      t.reserving = { poolPaise: pool, spentBefore: job.spentPaise };
      await r.save();
      await adjustSpend(r.deps.store, r.jobId, pool);
      t.allocated = true; t.reserving = undefined;
      await r.log.decision(`Budget: ${rupees(pool)} shared among ${helpers.length} helper${helpers.length === 1 ? "" : "s"}, ${rupees(t.reservePaise)} kept by the lead for the reviews, the merges and the final check.`);
      await r.save();
    }
  }
  if (t.baseSha === undefined) {
    t.baseSha = await d.github.branchHead(repoRef(d, r.userId, r.project), r.branch);
    await r.save();
  }
}

// ------------------------------------------------------------ commands

async function takeCommands(r: Run, t: TeamState): Promise<void> {
  const job = await r.job();
  const list = (job.checkpoint as { teamCommands?: TeamCommand[] }).teamCommands ?? [];
  for (const c of list.slice(-TEAM_COMMANDS_MAX)) {
    if (t.handled.includes(c.id)) continue;
    t.handled.push(c.id);
    if (t.handled.length > 100) t.handled.shift();
    const p = byId(t, c.part);
    if (!p || p.id === 0) { t.notes.push(`There is no part ${c.part} to ${c.op}.`); continue; }
    if (c.op === "stop") {
      if (ended(p)) continue;
      if (p.jobId) await r.deps.jobs.cancelJob(p.jobId, "You stopped this part.").catch(() => undefined);
      p.status = "stopped";
      p.reason = "You stopped it.";
      await r.log.decision(`Part ${p.id} (${p.title}) was stopped at your request.`);
      await settle(r, p);
      continue;
    }
    // rerun
    if (!["failed", "stopped", "exhausted", "skipped"].includes(p.status)) { t.notes.push(`Part ${p.id} is ${p.status}, so it cannot be run again.`); continue; }
    if (c.addPaise && c.addPaise > 0) { p.budgetPaise += c.addPaise; }
    if (p.status === "exhausted" && p.jobId) {
      // Its helper is parked for money; the person gave it more (and woke it): the lead takes the money into account and goes back to watching.
      if (!(await ensureHeld(r, p, Math.max(0, p.budgetPaise - p.spentPaise)))) { t.notes.push(`Part ${p.id} could not be given more: the lead's budget is short. Add budget to the job first.`); continue; }
      p.status = p.fixRounds > 0 ? "fixing" : "running";
      p.reason = undefined;
      await r.log.decision(`Part ${p.id} (${p.title}) goes on with more budget.`);
      continue;
    }
    const grant = Math.max(0, p.budgetPaise - p.spentPaise);
    if (grant < PART_PAISE_MIN || !(await ensureHeld(r, p, grant))) { t.notes.push(`Part ${p.id} cannot be run again without more budget: it needs at least ${rupees(PART_PAISE_MIN)}. Send addPaise.`); continue; }
    p.attempts = (p.attempts ?? 0) + 1;
    p.fixRounds = 0; p.jobId = undefined; p.reason = undefined; p.noChange = undefined; p.endedAt = undefined;
    p.status = p.dependsOn.every((d) => byId(t, d)?.status === "merged") ? "ready" : "waiting";
    for (const q of t.parts) if (q.status === "skipped" && q.dependsOn.includes(p.id)) { q.status = "waiting"; q.reason = undefined; }
    await r.log.decision(`Part ${p.id} (${p.title}) will be run again at your request.`);
  }
  await r.save();
}

// -------------------------------------------------------------- observing

/** Looks at every part that has a helper and brings the lead's record of it up to date. Returns whether anything changed. */
async function observe(r: Run, t: TeamState): Promise<boolean> {
  let moved = false;
  for (const p of t.parts) {
    if (!p.jobId || !["running", "blocked", "fixing", "exhausted"].includes(p.status)) continue;
    const c = await readChild(r.deps.store, p.jobId);
    p.spentPaise = await spentOf(r, p);
    if (c.state?.part) for (const x of c.state.part.refused) if (!p.refused.includes(x)) { p.refused.push(x); moved = true; }
    const model = c.state?.work.lastModel;
    if (model && model !== p.helperModel) p.helperModel = model;
    const before = p.status;
    const back: PartStatus = p.fixRounds > 0 ? "fixing" : "running";
    switch (c.kind) {
      case "active": p.status = back; p.reason = undefined; break;
      case "blocked": p.status = "blocked"; p.reason = cut(c.why, 200); break;
      case "exhausted": p.status = "exhausted"; p.reason = "It used up its share of the budget and stopped cleanly. What it had was kept on its branch."; break;
      case "done": await harvest(r, t, p, c); break;
      case "failed": p.status = "failed"; p.reason = cut(c.why, 300); await settle(r, p); break;
      case "cancelled": p.status = "stopped"; p.reason = cut(c.why, 200); await settle(r, p); break;
      case "missing": p.status = "failed"; p.reason = c.why; await settle(r, p); break;
    }
    if (p.status !== before) {
      moved = true;
      await r.log.decision(`Part ${p.id} (${p.title}): ${before} to ${p.status}${p.reason ? `, ${cut(p.reason, 160)}` : ""}.`);
    }
  }
  if (moved) { board(r, t); await r.save(); }
  return moved;
}

/** A helper finished: what it changed is recorded, and the part goes to be reviewed. */
async function harvest(r: Run, t: TeamState, p: TeamPart, c: Child): Promise<void> {
  const d = r.deps.projects;
  const st = c.state;
  p.summary = cut(st?.work.doneSummary ?? st?.report?.text.split("\n")[0] ?? "", 600) || p.summary;
  p.checks = st?.verify ? cut(st.verify.summary, 300) : p.checks;
  if (p.kind === "repo") {
    // Another project's share: its own lead opened its own pull request. That is the part's end.
    const pr = st?.pr;
    p.status = "merged";
    p.reason = pr ? `It opened its own pull request: ${pr.url}` : (st?.commits.length ? "It committed its work to its own branch." : "It made no change.");
    if (pr && !t.links.some((l) => l.jobId === p.jobId)) t.links.push({ projectId: p.projectId!, name: p.title, jobId: p.jobId!, url: pr.url, number: pr.number, ...(p.branch ? { branch: p.branch } : {}) });
    await settle(r, p);
    return;
  }
  p.headSha = await d.github.branchHead(repoRef(d, r.userId, r.project), p.branch!);
  for (const x of st?.committedPaths ?? []) if (!p.paths.includes(x)) p.paths.push(x);
  if (!p.paths.length) {
    p.noChange = true;
    p.status = "merged";
    p.reason = `Its helper finished and changed nothing${p.summary ? `: ${cut(p.summary, 160)}` : "."}`;
    await settle(r, p);
    return;
  }
  p.status = "reviewing";
  p.reason = undefined;
}

// ----------------------------------------------------------------- review

async function reviewNext(r: Run, t: TeamState): Promise<boolean> {
  const p = t.parts.find((x) => x.status === "reviewing");
  if (!p) return false;
  const changes = await fileDiffOf(r, p);
  const job = await r.job();
  const rev = await reviewDiff(r.model(), {
    part: p, changes, ...(p.checks ? { checks: p.checks } : {}), ...(r.state.classification ? { classification: r.state.classification } : {}),
    remainingPaise: Math.max(0, job.budgetPaise - job.spentPaise),
  }, p.fixRounds, r.now());
  if (rev.aborted) throw new LostClaim();
  const { aborted: _aborted, ...review } = rev;
  p.reviews.push(review);
  await r.log.decision(`Part ${p.id} (${p.title}) was reviewed${review.model ? ` by ${review.model}` : ""}${review.writerFamily ? ` (the helper is ${review.writerFamily}, the reviewer ${review.family ?? "none"})` : ""}: ${review.verdict}. ${cut(review.summary, 200)}`);
  if (review.verdict !== "fix") { p.status = "approved"; board(r, t); await r.save(); return true; }

  const grant = p.budgetPaise - p.spentPaise;
  if (p.fixRounds < REVIEW_FIX_ROUNDS_MAX && grant >= PART_PAISE_MIN && await ensureHeld(r, p, grant)) {
    const round = p.fixRounds + 1;
    const s = await spawnHelper(r, t, p, { round, budgetPaise: grant, feedback: findingsText(review.findings, review.summary) });
    p.fixRounds = round;
    p.jobId = s.jobId;
    if (!p.jobIds.includes(s.jobId)) p.jobIds.push(s.jobId);
    p.status = "fixing";
    await r.log.step(`Fix round ${round} of ${REVIEW_FIX_ROUNDS_MAX} for part ${p.id} (${p.title}): ${review.findings.filter((f) => f.severity === "blocker" || f.severity === "major").length} finding(s) sent back to its helper`, p.ownedPaths.slice(0, 4));
  } else if (hasBlocker(review.findings)) {
    p.status = "failed";
    p.reason = `The reviewer still found a blocker ${p.fixRounds >= REVIEW_FIX_ROUNDS_MAX ? `after ${REVIEW_FIX_ROUNDS_MAX} fix rounds` : "and there was no budget left for a fix round"}: ${cut(review.findings.find((f) => f.severity === "blocker")?.text ?? review.summary, 200)}`;
    await settle(r, p);
  } else {
    // Majors left over after the fix rounds: the part is merged, said so, and the pull request stays a draft.
    p.status = "approved";
    t.notes.push(`Part ${p.id} (${p.title}) was merged with problems the reviewer found and the fix rounds did not clear: ${cut(review.summary, 160)}`);
  }
  board(r, t);
  await r.save();
  return true;
}

// ------------------------------------------------------------------ merge

/** A part is approved and everything it waited for is merged: it is merged into the lead branch. Returns "phase" when the conflict flow took over. */
async function mergeNext(r: Run, t: TeamState): Promise<"phase" | "moved" | "none"> {
  const s = r.state;
  const p = t.parts.find((x) => x.status === "approved" && x.dependsOn.every((d) => byId(t, d)?.status === "merged"));
  if (!p) return "none";
  const out = await mergePart(r, p);
  switch (out.kind) {
    case "merged":
      p.status = "merged"; p.mergedSha = out.sha;
      s.commits.push(out.sha);
      s.committedPaths = [...new Set([...(s.committedPaths ?? []), ...p.paths])];
      r.tools.invalidate();
      await r.log.step(`Merged part ${p.id} (${p.title}) into ${r.branch} (${out.sha.slice(0, 7)}, ${out.files} file${out.files === 1 ? "" : "s"})`, p.paths.slice(0, 12));
      break;
    case "nothing":
      p.status = "merged"; p.reason = "Its files were in the lead branch already.";
      await r.log.decision(`Part ${p.id} (${p.title}) had nothing left to merge: its files are in ${r.branch} already.`);
      break;
    case "refused":
      p.status = "failed"; p.reason = out.why;
      await r.log.decision(`Part ${p.id} (${p.title}) was not merged: ${out.why}`);
      break;
    case "retry":
      return "none";
    case "conflict":
      await startConflict(r, t, p, out.paths);
      return "phase";
  }
  await settle(r, p);
  board(r, t);
  await r.save();
  return "moved";
}

/** A part clashes with what the lead branch has: the runner merge flow takes it (agent/merge.ts), and brings the lead back here. */
async function startConflict(r: Run, t: TeamState, p: TeamPart, paths: string[]): Promise<void> {
  const s = r.state;
  t.merging = p.id;
  s.task = t.goal;
  s.merge = { stage: "run", base: p.branch!, baseSha: "", headSha: "", conflicted: [] };
  resetWork(s);
  s.verify = undefined; s.verified = undefined; s.commit = undefined;
  s.phase = "merge";
  await r.log.decision(`Part ${p.id} (${p.title}) changed ${paths.length} file${paths.length === 1 ? "" : "s"} that ${r.branch} has changed too (${paths.slice(0, 3).join(", ")}), so a computer merges it with git and the clash is resolved there.`);
  await r.save();
}

/** The merge flow committed the part (a merge commit with two parents): the part is merged, and the lead goes back to the team. */
export async function afterConflict(r: Run, o: { sha?: string } = {}): Promise<void> {
  const s = r.state;
  const t = s.team;
  if (!t || t.merging === undefined) return;
  const p = byId(t, t.merging);
  t.merging = undefined;
  if (p) {
    p.status = "merged";
    if (o.sha) p.mergedSha = o.sha;
    await r.log.decision(`Part ${p.id} (${p.title}) is merged into ${r.branch}${o.sha ? ` (${o.sha.slice(0, 7)})` : ""} after its clash was resolved.`);
    await settle(r, p);
  }
  s.merge = undefined; s.task = t.goal; s.verify = undefined; s.verified = undefined; s.commit = undefined;
  resetWork(s);
  r.tools.invalidate();
  s.phase = "team";
  board(r, t);
  await r.save();
}

// ------------------------------------------------------------------ spawn

function unblock(t: TeamState): boolean {
  let moved = false;
  for (const p of t.parts) {
    if (p.status !== "waiting" && p.status !== "ready") continue;
    const deps = p.dependsOn.map((d) => byId(t, d));
    const dead = deps.find((d) => d && ["failed", "stopped", "skipped"].includes(d.status));
    if (dead) { p.status = "skipped"; p.reason = `Part ${dead.id} (${dead.title}) did not finish, and this part builds on it.`; moved = true; continue; }
    if (p.status === "waiting" && deps.every((d) => d?.status === "merged")) { p.status = "ready"; moved = true; }
  }
  return moved;
}

async function spawnReady(r: Run, t: TeamState): Promise<boolean> {
  let moved = false;
  for (const p of t.parts) {
    if (p.status !== "ready" || p.id === 0) continue;
    if (working(t) >= t.parallel) break;
    const grant = Math.max(0, p.budgetPaise - p.spentPaise);
    if (grant < PART_PAISE_MIN) { p.status = "exhausted"; p.reason = "It was given too little of the budget to start."; moved = true; continue; }
    const made = p.kind === "repo" ? await spawnRepoLead(r, t, p, { budgetPaise: grant }) : await spawnHelper(r, t, p, { round: 0, budgetPaise: grant });
    p.jobId = made.jobId;
    if (!p.jobIds.includes(made.jobId)) p.jobIds.push(made.jobId);
    p.branch = made.branch;
    p.startedAt = r.now();
    p.status = "running";
    moved = true;
    await r.log.step(`Started ${p.kind === "repo" ? "the share of another project" : "a helper"} for part ${p.id} (${p.title}) on ${made.branch}${made.adopted ? " (its job was already made)" : ""}`, p.ownedPaths.slice(0, 4));
    board(r, t);
    await r.save();
  }
  return moved;
}

// ---------------------------------------------------------------- the pass

async function sweep(r: Run, t: TeamState): Promise<"phase" | boolean> {
  let moved = await observe(r, t);
  if (unblock(t)) { moved = true; await r.save(); }
  if (await reviewNext(r, t)) moved = true;
  const m = await mergeNext(r, t);
  if (m === "phase") return "phase";
  if (m === "moved") moved = true;
  if (unblock(t)) { moved = true; await r.save(); }
  if (await spawnReady(r, t)) moved = true;
  return moved;
}

/** More budget came while the lead was parked for a part that ran out: shared among the parts that did. */
async function shareTopUp(r: Run, t: TeamState): Promise<void> {
  if (t.parkedBudgetPaise === undefined) return;
  const job = await r.job();
  const added = job.budgetPaise - t.parkedBudgetPaise;
  t.parkedBudgetPaise = undefined;
  const stuck = t.parts.filter((p) => p.status === "exhausted" && p.jobId);
  if (added <= 0 || !stuck.length) { await r.save(); return; }
  const each = Math.floor(added / stuck.length);
  for (const p of stuck) {
    if (each < 1) break;
    p.budgetPaise += each;
    if (!(await ensureHeld(r, p, p.budgetPaise - p.spentPaise))) { p.budgetPaise -= each; continue; }
    await r.deps.team?.addBudget?.(r.userId, p.jobId!, each);
    await r.log.decision(`Part ${p.id} (${p.title}) was given ${rupees(each)} more and goes on.`);
  }
  await r.save();
}

export async function teamPhase(r: Run): Promise<void> {
  const s = r.state;
  const t = s.team;
  if (!t) { s.phase = "work"; await r.save(); return; }
  if (t.stage === "final" || t.stage === "done") { s.phase = "verify"; await r.save(); return; }
  if (t.stage === "contracts") { s.phase = "work"; await r.save(); return; }
  await startRun(r, t);
  await shareTopUp(r, t);
  await takeCommands(r, t);
  s.waiting = s.waiting?.kind === "budget" ? undefined : s.waiting;
  for (let n = 0; n < SWEEPS_MAX; n += 1) {
    if (r.signal.aborted) throw new LostClaim();
    const moved = await sweep(r, t);
    if (moved === "phase") return;
    if (!moved) break;
  }
  board(r, t);
  if (t.parts.every(ended)) { await finish(r, t); return; }
  // Only parts that ran out of money are left to wait for: the person decides (more budget, or stop them).
  const alive = t.parts.some((p) => ["ready", "running", "fixing", "reviewing", "approved", "blocked"].includes(p.status));
  const stuck = t.parts.filter((p) => p.status === "exhausted");
  if (!alive && stuck.length) {
    const job = await r.job();
    const top = topUpFor(stuck.reduce((n, p) => n + p.spentPaise, 0) / stuck.length);
    t.parkedBudgetPaise = job.budgetPaise;
    s.waiting = { kind: "budget", needPaise: top * stuck.length, at: r.now() };
    await r.log.question(`Part${stuck.length === 1 ? "" : "s"} ${stuck.map((p) => `${p.id} (${p.title})`).join(", ")} used up ${stuck.length === 1 ? "its" : "their"} share of the budget. Add budget to go on, or stop ${stuck.length === 1 ? "it" : "them"}.`);
    await r.save();
    throw new Park("budget", `Part${stuck.length === 1 ? "" : "s"} ${stuck.map((p) => p.id).join(", ")} ran out of budget. Continue with ${rupees(top * stuck.length)} more, or stop ${stuck.length === 1 ? "it" : "them"}?`);
  }
  await r.save();
  // A helper working, a part to review or merge, or a part that can start: look again soon. Only the person's word to wait for (a question, a yes): not for a while.
  const soon = t.parts.some((p) => ["running", "fixing", "reviewing", "approved"].includes(p.status)) || (t.parts.some((p) => p.status === "ready") && working(t) < t.parallel);
  throw new TeamWait(soon ? TEAM_REST_MS : TEAM_IDLE_REST_MS);
}

// ---------------------------------------------------------------- the end

/** The unfinished parts, in a line each, for the final task and the report. */
export function unfinished(t: TeamState): TeamPart[] {
  return t.parts.filter((p) => p.status !== "merged");
}

/** Whether the team did everything: every part merged, none of them without a change, no problem left by the reviews. */
export function teamClean(t: TeamState): boolean {
  return t.parts.every((p) => p.status === "merged" && !p.noChange)
    && !t.parts.some((p) => p.reviews.at(-1)?.verdict === "fix")
    && !t.notes.some((n) => n.includes("merged with problems"));
}

function finalTask(t: TeamState): string {
  const left = unfinished(t);
  const asked = t.parts.flatMap((p) => p.refused.map((x) => `${x} (part ${p.id} asked for a change there)`));
  return [
    t.goal,
    "The parts of this goal were built by helpers and are merged into this branch. The whole is being checked together now. If the checks find something broken, fix it with the smallest change that does.",
    left.length ? `These parts did not finish, so what they were meant to do is not in the branch: ${left.map((p) => `part ${p.id} (${p.title}): ${p.status}`).join("; ")}. Do not try to build them now; keep the rest working.` : "",
    asked.length ? `Helpers asked for changes outside their own files: ${asked.slice(0, 8).join("; ")}. Make them if the whole needs them.` : "",
  ].filter(Boolean).join("\n\n");
}

/** What the lead says it did, for the pull request and the report: the goal's first sentence, and who built it. */
export function teamSummary(t: TeamState): string {
  const first = (t.goal.split(/(?<=[.!?])\s|\n/)[0] ?? t.goal).trim();
  const helpers = t.parts.filter((p) => p.id !== 0);
  const done = helpers.filter((p) => p.status === "merged" && !p.noChange);
  return `${cut(first, 200)} Built by a lead and ${helpers.length} helper${helpers.length === 1 ? "" : "s"} working side by side, each in files of its own: ${done.length} of ${helpers.length} part${helpers.length === 1 ? "" : "s"} reviewed and merged.`;
}

async function finish(r: Run, t: TeamState): Promise<void> {
  const s = r.state;
  const merged = t.parts.filter((p) => p.id !== 0 && p.status === "merged" && !p.noChange);
  if (!merged.length) {
    const why = t.parts.filter((p) => p.id !== 0).map((p) => `part ${p.id} (${p.title}): ${p.status}${p.reason ? `, ${cut(p.reason, 120)}` : ""}`).join("; ");
    throw new EndJob("failed", `None of the parts could be merged, so there is nothing to put in a pull request. ${cut(why, 400)}${s.commits.length ? " The shared contracts are on the branch." : " Nothing was changed."}`);
  }
  t.stage = "final";
  s.task = finalTask(t);
  s.verify = undefined; s.verified = undefined; s.commit = undefined;
  resetWork(s);
  s.work.doneSummary = teamSummary(t);
  s.phase = "verify";
  await r.log.decision(`${merged.length} of ${t.parts.length - (byId(t, 0) ? 1 : 0)} part${merged.length === 1 ? "" : "s"} are merged. Now the whole is checked together against what the project was before.`);
  board(r, t);
  await r.save();
}
