/**
 * THE CODE BOT: its home, getting started (meet, pick projects, read the project, the projects overview), a new
 * project's questions and PLAN.md, the plan-first approval, the project's rules, the review, and PR care
 * (CodeHome, Enter1-4, NewProject, CodePlan, ProjectRules, CodeReview, PRCare and their D* boards).
 *
 * Screen ids are "bots.<name>"; one id serves the phone and the window (ctx.client). Everything is Xode's own
 * backend (routes/code/code.ts, routes/code/codeJobs.ts, src/code/**) read through deps.api, and the few doors the screens needed
 * beyond it (routes/bots/botsCode.ts: start a task plan-first, pick projects, the rules, a new project's answers, the line
 * diff, merge). The job, team, design, preview, attach, done, failed and chat screens are screens/codeWork.ts's: this
 * file links to them through SCREENS.
 *
 *   bots.code            params project?  one project's home; no project yet: meet; several and none named: the overview
 *   bots.code.start      params step: meet | pick | read | home, project (read), q / vis (pick)
 *   bots.code.new        params project?  the idea, then the questions with the plan growing beside them, then Start building
 *   bots.code.plan       params id (a job)  the plan, Start / Change the plan
 *   bots.code.rules      params project
 *   bots.code.book       params project   the project book (code/project/book.ts): its chapters, every fact with its source, and the owner's questions
 *   bots.code.review     params id (a job), or project + branch
 *   bots.code.pr-care    params project, pr (and branch, when PR care is off)
 */

import type { ScreenResponse, Node } from "../../../../../shared/types/sdui.js";
import type { BrainLite } from "../../../botsCode/brain.js";
import type { PastJob } from "../../../botsCode/history.js";
import { type ProjectBook, type BookFact, CHAPTERS, CHAPTER_TITLES } from "../../../code/project/book.js";
import { type BotsCtx, col, text, meta, sectionLabel, listCard, call, seq, button, page, open, SCREENS, botAvatar } from "../kit.js";
import type { BotsDeps } from "../live.js";
import { type BotsScreen, screen } from "../registry.js";
import { type PlanData, codePlan } from "./code/codePlan.js";
import { type ReviewData, type Changes, codeReview } from "./code/codeReview.js";
import { meet } from "./code/meet.js";
import { type NewData, type IntakeView, newProject } from "./code/newProject.js";
import { overview } from "./code/overview.js";
import {
  type Github, type MeetData, type Project, str, type OverviewData, type Job, unreachable, type JobView, short, toast, REFRESH, field,
  head, subLine, CODE, type PrStatus,
} from "./code/parts.js";
import { type PickData, pickProjects } from "./code/pickProjects.js";
import { type CareData, type CarePull, type Comment, prCare } from "./code/prCare.js";
import { type HomeData, type Branch, projectHome } from "./code/projectHome.js";
import { type RulesView, projectRules } from "./code/projectRules.js";
import { loadWork, workCtx, type WorkRead } from "./work/workTab.js";
import { type ReadData, readProject } from "./code/readProject.js";

const get = <T>(deps: BotsDeps, path: string): Promise<T | undefined> => deps.api<T>("GET", path).catch(() => undefined);

/**
 * Where "Connect GitHub" goes: the GitHub App's install page; on a server that offers only "Sign in with GitHub" (CODE_GITHUB_OAUTH,
 * no App), that sign-in. Nothing while GitHub is already connected, or neither way is set up.
 */
async function connectUrl(deps: BotsDeps, gh: Github | undefined): Promise<string | undefined> {
  if (!gh || gh.connected) return undefined;
  const install = await deps.api<{ installUrl: string }>("POST", "/v1/code/github/connect").then((r) => r.installUrl).catch(() => undefined);
  if (install || !gh.oauth) return install;
  return deps.api<{ authorizeUrl: string }>("POST", "/v1/code/github/signin").then((r) => r.authorizeUrl).catch(() => undefined);
}

async function loadMeet(deps: BotsDeps): Promise<MeetData> {
  // 404 code_off: Xode is off here. 503 not_configured: it is on, but GitHub isn't set up (the notice says which).
  let off = false;
  const gh = await deps.api<Github>("GET", "/v1/code/github").catch((e: { status?: number }) => { off = e?.status === 404; return undefined; });
  return { gh, installUrl: await connectUrl(deps, gh), off };
}

async function loadPick(deps: BotsDeps): Promise<PickData> {
  const [gh, repos, projects] = await Promise.all([
    get<Github>(deps, "/v1/code/github"),
    get<PickData["repos"]>(deps, "/v1/code/repos"),
    get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects),
  ]);
  return { gh, repos, projects, installUrl: await connectUrl(deps, gh) };
}

async function loadRead(ctx: BotsCtx, deps: BotsDeps): Promise<ReadData> {
  const id = str(ctx.params.project);
  if (!id) return {};
  const [brain, projects] = await Promise.all([
    get<BrainLite>(deps, `/v1/code/projects/${id}/brain`),
    get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects),
  ]);
  const others = (projects ?? []).filter((p) => p.id !== id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const theirs = await Promise.all(others.map((p) => get<BrainLite>(deps, `/v1/code/projects/${p.id}/brain`)));
  const next = others.find((_, i) => theirs[i]?.status === "building")?.fullName;
  return { brain, project: projects?.find((p) => p.id === id), projects, ...(next ? { next } : {}) };
}

async function loadOverview(deps: BotsDeps, projects?: Project[]): Promise<OverviewData | undefined> {
  const [list, jobs] = await Promise.all([
    projects ? Promise.resolve(projects) : get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects),
    get<{ jobs: Job[] }>(deps, "/v1/code/jobs").then((r) => r?.jobs ?? []),
  ]);
  if (!list) return undefined;
  const shown = list.slice(0, 8);
  const brains = await Promise.all(shown.map((p) => get<BrainLite>(deps, `/v1/code/projects/${p.id}/brain`)));
  return { projects: list, jobs: jobs ?? [], brains: Object.fromEntries(shown.map((p, i) => [p.id, brains[i]])) };
}

async function loadHome(ctx: BotsCtx, deps: BotsDeps): Promise<HomeData> {
  let status = 0;
  const projects = await deps.api<{ projects: Project[] }>("GET", "/v1/code/projects").then((r) => r.projects).catch((e: { status?: number }) => { status = e?.status ?? 500; return undefined; });
  if (!projects) return status === 404 || status === 503 ? { kind: "meet", meet: await loadMeet(deps) } : { kind: "off" };
  if (!projects.length) return { kind: "meet", meet: await loadMeet(deps) };
  const wanted = str(ctx.params.project);
  const project = wanted ? projects.find((p) => p.id === wanted) : projects.length === 1 ? projects[0] : undefined;
  if (!project) return { kind: "overview", overview: await loadOverview(deps, projects) };
  const [brain, jobs, branches] = await Promise.all([
    get<BrainLite>(deps, `/v1/code/projects/${project.id}/brain`),
    get<{ jobs: Job[] }>(deps, "/v1/code/jobs").then((r) => (r?.jobs ?? []).filter((j) => j.projectId === project.id)),
    get<{ branches: Branch[] }>(deps, `/v1/code/projects/${project.id}/branches`).then((r) => r?.branches ?? []),
  ]);
  return { kind: "project", project, brain, jobs, branches };
}

function codeHome(ctx: BotsCtx, d: HomeData | undefined): ScreenResponse {
  if (!d || d.kind === "off") return unreachable(ctx, "Xode");
  if (d.kind === "meet") return meet(ctx, d.meet);
  if (d.kind === "overview") return overview(ctx, d.overview);
  return projectHome(ctx, d);
}

// ===================================================================== bots.code.start
type StartData = { step: "meet"; d: MeetData } | { step: "pick"; d: PickData } | { step: "read"; d: ReadData } | { step: "home"; d?: OverviewData };

async function loadStart(ctx: BotsCtx, deps: BotsDeps): Promise<StartData> {
  const step = str(ctx.params.step) || "meet";
  if (step === "pick") return { step, d: await loadPick(deps) };
  if (step === "read") return { step, d: await loadRead(ctx, deps) };
  if (step === "home") return { step, d: await loadOverview(deps) };
  return { step: "meet", d: await loadMeet(deps) };
}

function start(ctx: BotsCtx, s: StartData | undefined): ScreenResponse {
  if (!s) return meet(ctx, undefined);
  if (s.step === "pick") return pickProjects(ctx, s.d);
  if (s.step === "read") return readProject(ctx, s.d);
  if (s.step === "home") return overview(ctx, s.d, true);
  return meet(ctx, s.d);
}

async function loadNew(ctx: BotsCtx, deps: BotsDeps): Promise<NewData | undefined> {
  const id = str(ctx.params.project);
  if (id) {
    const v = await get<IntakeView>(deps, `/v1/bots/code/projects/${id}/intake`);
    return v ? { kind: "intake", v } : undefined;
  }
  const projects = await get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects ?? []);
  return { kind: "pick", projects };
}

async function loadPlan(ctx: BotsCtx, deps: BotsDeps): Promise<PlanData | undefined> {
  const id = str(ctx.params.id);
  if (!id) return undefined;
  const view = await get<JobView>(deps, `/v1/code/jobs/${id}`);
  if (!view) return undefined;
  const pid = view.job.projectId;
  const [project, history, brain] = await Promise.all([
    get<{ project: Project }>(deps, `/v1/code/projects/${pid}`).then((r) => r?.project),
    get<{ jobs: PastJob[] }>(deps, "/v1/code/jobs").then((r) => r?.jobs ?? []),
    get<BrainLite>(deps, `/v1/code/projects/${pid}/brain`),
  ]);
  return { view, project, history, brain };
}

// ===================================================================== bots.code.book (the project book)
interface BookData { book: ProjectBook; markdown: string }
interface BookView { id: string; data: BookData }

async function loadBook(ctx: BotsCtx, deps: BotsDeps): Promise<BookView | undefined> {
  const id = str(ctx.params.project);
  if (!id) return undefined;
  const data = await get<BookData>(deps, `/v1/code/projects/${id}/book`);
  return data?.book ? { id, data } : undefined;
}

const SOURCE_WORDS: Record<string, string> = { owner: "you said", index: "the project's index", file: "file", commit: "commit", pull: "pull request", issue: "issue", milestone: "milestone", check: "checks" };

/** The book: each chapter a list, each fact with where it came from (✓ you said it, ~ a guess); what is not known; the questions, answered here. */
function projectBookScreen(ctx: BotsCtx, v: BookView | undefined): ScreenResponse {
  if (!v) return unreachable(ctx, "that project's book");
  const desk = ctx.client === "desktop";
  const { book } = v.data;
  const name = short(book.project);
  const factRow = (f: BookFact): Node => col([
    text(`${f.status === "confirmed" ? "✓ " : f.status === "guessed" ? "~ " : ""}${f.text}`, { size: 14, lineHeight: 20 }),
    meta(f.source.kind === "owner" || f.source.kind === "index" ? SOURCE_WORDS[f.source.kind]! : `${SOURCE_WORDS[f.source.kind]} ${f.source.ref}`, { size: 12 }),
  ], { gap: 2, paddingVertical: 10, paddingHorizontal: 16 }, f.source.url ? { kind: "openUrl", url: f.source.url } : undefined);
  const chapters = CHAPTERS.map((c) => ({ c, facts: book.facts.filter((f) => f.chapter === c) })).filter((x) => x.facts.length)
    .map(({ c, facts }) => col([sectionLabel(CHAPTER_TITLES[c]), listCard(facts.map(factRow))], { gap: 8 }));
  const asked = book.questions;
  const answers = Object.fromEntries(asked.map((q) => [q.id, `$state.a_${q.id}`]));
  const save = call("POST", `/v1/code/projects/${v.id}/book`, { answers }, { ok: seq(toast("Saved to the book."), REFRESH), fail: toast("Couldn't save that. Try again.") });
  const questions = asked.length ? [col([
    sectionLabel("A few questions"),
    meta("Your words go in the book as facts, and Xode works by them.", { size: 12 }),
    listCard(asked.map((q) => col([text(q.text, { size: 14, weight: 600, lineHeight: 20 }), field(`a_${q.id}`, "Your answer", { multiline: true, minHeight: 60 })], { gap: 6, paddingVertical: 12, paddingHorizontal: 16 }))),
    button("Save", save, { kind: "primary", size: "md" }),
  ], { gap: 8 })] : [];
  const gaps = book.gaps.length ? [col([sectionLabel("Not known yet"), ...book.gaps.map((g) => meta(g, { size: 13, lineHeight: 18 }))], { gap: 6 })] : [];
  return page(ctx, {
    nav: "code", title: "Project book", state: Object.fromEntries(asked.map((q) => [`a_${q.id}`, ""])), gap: 16, ...(desk ? { maxWidth: 820 } : {}),
    body: [
      head(ctx, { title: "Project book", sub: subLine([{ code: name }, `· as of ${book.commit.slice(0, 7)}`]), to: open(SCREENS.code, { project: v.id }), right: [botAvatar(CODE, 30)] }),
      ...questions, ...chapters, ...gaps,
    ],
  });
}

// ===================================================================== bots.code.rules (ProjectRules / DProjectRules)

async function loadRules(ctx: BotsCtx, deps: BotsDeps): Promise<RulesView | undefined> {
  const id = str(ctx.params.project);
  return id ? get<RulesView>(deps, `/v1/bots/code/projects/${id}/rules`) : undefined;
}

async function loadReview(ctx: BotsCtx, deps: BotsDeps): Promise<ReviewData | undefined> {
  const id = str(ctx.params.id);
  let view: JobView | undefined, projectId = str(ctx.params.project), branch = str(ctx.params.branch);
  if (id) {
    view = await get<JobView>(deps, `/v1/code/jobs/${id}`);
    if (!view) return undefined;
    projectId = view.job.projectId; branch = view.job.branch;
  }
  if (!projectId || !branch) return undefined;
  const enc = encodeURIComponent(branch);
  const [project, changes, pr] = await Promise.all([
    get<{ project: Project }>(deps, `/v1/code/projects/${projectId}`).then((r) => r?.project),
    get<Changes>(deps, `/v1/bots/code/projects/${projectId}/changes?branch=${enc}${id ? `&job=${id}` : ""}`),
    get<PrStatus>(deps, `/v1/code/projects/${projectId}/branches/${enc}/pr`),
  ]);
  return { view, project, branch, changes, pr };
}

async function loadCare(ctx: BotsCtx, deps: BotsDeps): Promise<CareData | undefined> {
  const pid = str(ctx.params.project);
  const n = Number(ctx.params.pr);
  if (!pid) return undefined;
  let careOff = false;
  const pulls = await deps.api<{ pulls: CarePull[] }>("GET", `/v1/code/projects/${pid}/care`).then((r) => r.pulls).catch(() => { careOff = true; return [] as CarePull[]; });
  const pull = pulls.find((p) => p.prNumber === n) ?? (n ? undefined : pulls[0]);
  const branch = pull?.branch ?? str(ctx.params.branch);
  if (!branch) return { branch: "", comments: [], spentPaise: 0, careOff, project: await get<{ project: Project }>(deps, `/v1/code/projects/${pid}`).then((r) => r?.project) };
  const enc = encodeURIComponent(branch);
  const [project, pr, comments, diff, jobs] = await Promise.all([
    get<{ project: Project }>(deps, `/v1/code/projects/${pid}`).then((r) => r?.project),
    get<PrStatus>(deps, `/v1/code/projects/${pid}/branches/${enc}/pr`),
    get<{ comments: Comment[] }>(deps, `/v1/code/projects/${pid}/branches/${enc}/pr/comments`).then((r) => r?.comments ?? []),
    get<CareData["diff"]>(deps, `/v1/code/projects/${pid}/branches/${enc}/diff`),
    get<{ jobs: Job[] }>(deps, "/v1/code/jobs").then((r) => (r?.jobs ?? []).filter((j) => j.projectId === pid && j.branch === branch)),
  ]);
  const latest = [...(jobs ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { project, pull, branch, pr, comments: comments ?? [], diff, spentPaise: (jobs ?? []).reduce((s, j) => s + j.spentPaise, 0), ...(latest ? { latestJob: latest.id } : {}), careOff };
}

// ===================================================================== the list
export const codeScreens: BotsScreen[] = [
  screen<HomeData & { work?: WorkRead }>({
    id: SCREENS.code,
    // With the new Spaces: Work in space's people for Xode too (screens/work/workTab.ts), on whichever home page it draws.
    load: async (ctx, deps) => { const [home, work] = await Promise.all([loadHome(ctx, deps), loadWork(ctx, deps, "code")]); return { ...home, work }; },
    build: (ctx, d) => codeHome(workCtx(ctx, d?.work), d),
  }),
  screen<StartData>({ id: SCREENS.codeStart, load: loadStart, build: start }),
  screen<NewData | undefined>({ id: SCREENS.newProject, load: loadNew, build: newProject }),
  screen<PlanData | undefined>({ id: SCREENS.codePlan, load: loadPlan, build: codePlan }),
  screen<RulesView | undefined>({ id: SCREENS.projectRules, load: loadRules, build: projectRules }),
  screen<BookView | undefined>({ id: SCREENS.projectBook, load: loadBook, build: projectBookScreen }),
  screen<ReviewData | undefined>({ id: SCREENS.codeReview, load: loadReview, build: codeReview }),
  screen<CareData | undefined>({ id: SCREENS.prCare, load: loadCare, build: prCare }),
];
