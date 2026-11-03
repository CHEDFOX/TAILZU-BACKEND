/**
 * THE CODE BOT AT WORK: the live job and its chat, the team, a design and its preview, attaching, the shipped moment and a job
 * that could not finish. One id serves the phone and the window (ctx.client); built with the kit like screens/shell.ts.
 *
 *   bots.code.job      Job / DeskWork (params id)        watch it work: the stages, what it did, its one quick question (answer,
 *                                                        yes / no, keep going), how much of its share it used, stop. No money. With no job, or a job that
 *                                                        was a question (report "answer"), or after a question (params asked,
 *                                                        answer) it is Xode's CHAT (Chat.dc.html; the window draws the
 *                                                        chat beside the live job, DeskWork). Params project, thread, asked,
 *                                                        answer, flow (the answer's diagram artifact)
 *   bots.code.team     TeamBoard / DTeamBoard (id)       a lead and its helpers: GET /v1/code/jobs/:id/team, stop or re-run a part
 *   bots.code.design   Design / DeskDesign (id, job?)    an approved design (an artifact): point at a part and say what to change,
 *                                                        build it into the app (POST /v1/artifacts/:id/build)
 *   bots.code.preview  Preview / DPreview (id | job)     the artifact's parts to point at, its versions, go back to one
 *   bots.attach        Attach / DAttach (id | project)   add a file you already sent, a link or your voice to the chat
 *   bots.done          Done / DDone (id)                 the shipped moment: the pull request, the numbers, what changed
 *   bots.failed        Failed / DFailed (id)             what it tried; try again deeper, tell me more, stop
 *
 * Everything is the existing Xode backend: routes/code/codeJobs.ts (the job, its log, its team, answer / approve / deny /
 * budget / stop / message), routes/artifacts.ts, routes/files.ts, and the front door (POST /v1/ask with projectId and a
 * threadId, docs/code-chat.md) for the chat. Live: the screens are never cached (cacheTtlSeconds 0), every write refreshes
 * the screen, the phone refreshes open screens on its own tick and when it comes back to the front, the window when it
 * comes back into focus; a status line taps to refresh. No new transport.
 */

import type { FlowData } from "./codeWork/flow.js";
import {
  isUuid, type JobRead, type WorkEntry, type ProjectRow, type ArtifactRead, flowOf, type VersionRow, type TeamRead, type FileRow,
} from "../../../botsCodeWork/read.js";
import type { ChatTurn } from "../../../code/chat/threads.js";
import { type BotsCtx, canLive, SCREENS } from "../kit.js";
import { type BotsScreen, screen } from "../registry.js";
import { type ArtData, type LivePage, artScreen } from "./codeWork/art.js";
import { type AttachData, attachScreen } from "./codeWork/attach.js";
import { doneScreen } from "./codeWork/done.js";
import { failedScreen } from "./codeWork/failed.js";
import { type ChatData, jobScreen } from "./codeWork/job.js";
import { type JobData, jobPath, type DoneData, threadFor } from "./codeWork/parts.js";
import { type TeamData, teamScreen } from "./codeWork/team.js";

async function readJob(deps: Parameters<NonNullable<BotsScreen["load"]>>[1], id: unknown): Promise<JobData | undefined> {
  if (!isUuid(id)) return undefined;
  const r = await deps.api<JobRead>("GET", jobPath(id));
  const [log, project] = await Promise.all([
    deps.api<{ entries: WorkEntry[] }>("GET", jobPath(id, "/log")).then((x) => x.entries ?? []).catch(() => [] as WorkEntry[]),
    deps.api<{ project: ProjectRow }>("GET", `/v1/code/projects/${r.job.projectId}`).then((x) => x.project).catch(() => undefined),
  ]);
  return { ...r, log, ...(project ? { project } : {}) };
}

type LoadDeps = Parameters<NonNullable<BotsScreen["load"]>>[1];

/**
 * A project chat's turns: the thread named, else the person's latest on the project that is not a job's own chat (a job's thread is the
 * job's id); undefined when it cannot be read.
 */
async function chatRead(deps: LoadDeps, projectId: string, thread?: string): Promise<{ thread: string | null; turns: ChatTurn[] } | undefined> {
  const not = thread ? [] : (await deps.jobs().catch(() => [])).map((j) => j.id).filter(isUuid);
  const q = thread ? `?thread=${thread}` : not.length ? `?not=${not.join(",")}` : "";
  return deps.api<{ thread: string | null; turns: ChatTurn[] }>("GET", `/v1/code/projects/${projectId}/chat${q}`)
    .then((x) => ({ thread: x.thread, turns: Array.isArray(x.turns) ? x.turns : [] })).catch(() => undefined);
}

async function loadJobOrChat(ctx: BotsCtx, deps: LoadDeps): Promise<ChatData> {
  const chatOf = ctx.params.id === undefined && isUuid(ctx.params.project);
  const [job, flow, project, chat] = await Promise.all([
    ctx.params.id !== undefined ? readJob(deps, ctx.params.id) : Promise.resolve(undefined),
    isUuid(ctx.params.flow)
      ? deps.api<ArtifactRead>("GET", `/v1/artifacts/${ctx.params.flow}`).then((a) => flowOf(a.content)).catch(() => undefined)
      : Promise.resolve(undefined),
    ctx.params.id === undefined && isUuid(ctx.params.project)
      ? deps.api<{ project: ProjectRow }>("GET", `/v1/code/projects/${ctx.params.project}`).then((x) => x.project).catch(() => undefined)
      : Promise.resolve(undefined),
    // The chat so far: the thread named, else the latest one on the project.
    chatOf ? chatRead(deps, ctx.params.project as string, isUuid(ctx.params.thread) ? ctx.params.thread : undefined) : Promise.resolve(undefined),
  ]);
  // A job's own chat (its thread is the job) and the project chat it was started from.
  const [own, before] = job
    ? await Promise.all([
      chatRead(deps, job.job.projectId, job.job.id),
      isUuid(ctx.params.from) && ctx.params.from !== job.job.id ? chatRead(deps, job.job.projectId, ctx.params.from) : Promise.resolve(undefined),
    ])
    : [undefined, undefined];
  const talk = chat ?? own;
  // The Xode flow for a project chat: its gate and its plan, on the thread the chat shows (an older server answers nothing: the chat as it was).
  const flowThread = chatOf ? (isUuid(ctx.params.thread) ? ctx.params.thread : isUuid(chat?.thread) ? chat!.thread! : threadFor(ctx.user?.id ?? "anon", ctx.params.project as string)) : null;
  const xode = flowThread
    ? await deps.api<FlowData>("GET", `/v1/bots/code/flow/${ctx.params.project}/plan?thread=${flowThread}`).catch(() => undefined)
    : undefined;
  return {
    ...(xode?.gate ? { xode } : {}),
    ...(job ? { job } : {}), ...(flow?.length ? { flow } : {}), ...(project ? { project } : {}), ...(talk ? { chat: talk } : {}),
    ...(before?.turns.length ? { before: before.turns } : {}),
  };
}

async function readArtifact(deps: Parameters<NonNullable<BotsScreen["load"]>>[1], id: string): Promise<{ art: ArtifactRead; versions: VersionRow[] }> {
  const [art, versions] = await Promise.all([
    deps.api<ArtifactRead>("GET", `/v1/artifacts/${id}`),
    deps.api<{ versions: VersionRow[] }>("GET", `/v1/artifacts/${id}/versions`).then((v) => v.versions ?? []).catch(() => [] as VersionRow[]),
  ]);
  return { art, versions };
}

/** The artifact a screen is about: its id, or the design a job builds, or the newest one of the job's project. */
async function loadArt(ctx: BotsCtx, deps: Parameters<NonNullable<BotsScreen["load"]>>[1]): Promise<ArtData> {
  const job = isUuid(ctx.params.job) ? await readJob(deps, ctx.params.job).catch(() => undefined) : undefined;
  let id = isUuid(ctx.params.id) ? ctx.params.id : job?.agent?.spec?.artifactId;
  if (!id && job) {
    const list = await deps.api<{ artifacts: Array<{ id: string }> }>("GET", `/v1/artifacts?projectId=${job.job.projectId}`).catch(() => ({ artifacts: [] }));
    id = list.artifacts[0]?.id;
  }
  if (!id) throw new Error("nothing to show");
  // The running page too, for a build that can show one: none (no viewer set, an older build) draws the parts as before.
  const [a, live] = await Promise.all([
    readArtifact(deps, id),
    canLive(ctx) ? deps.api<LivePage>("GET", `/v1/artifacts/${id}/live?pick=1`).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return { ...a, ...(job ? { job } : {}), ...(live && typeof live.html === "string" && typeof live.origin === "string" ? { live } : {}) };
}

// ===================================================================== the screens
type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

/** Jobs that ended done since Monday, in the person's own week. */
async function shippedThisWeek(ctx: BotsCtx, deps: Deps): Promise<number> {
  const r = await deps.api<{ jobs: Array<{ state: string; updatedAt: number }> }>("GET", "/v1/code/jobs").catch(() => ({ jobs: [] }));
  const local = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000);
  const sinceMonday = ((local.getUTCDay() + 6) % 7) * 86_400_000 + (local.getUTCHours() * 60 + local.getUTCMinutes()) * 60_000 + local.getUTCSeconds() * 1000;
  const monday = ctx.live.now - sinceMonday;
  return r.jobs.filter((j) => j.state === "done" && j.updatedAt >= monday).length;
}

export const codeWorkScreens: BotsScreen[] = [
  screen<ChatData>({ id: SCREENS.codeJob, load: loadJobOrChat, build: jobScreen }),
  screen<TeamData>({
    id: SCREENS.team,
    load: async (ctx, deps) => {
      const job = await readJob(deps, ctx.params.id);
      if (!job) throw new Error("no job");
      return { job, team: await deps.api<TeamRead>("GET", jobPath(job.job.id, "/team")) };
    },
    build: teamScreen,
  }),
  screen<ArtData>({ id: SCREENS.design, load: loadArt, build: artScreen("design") }),
  screen<ArtData>({ id: SCREENS.preview, load: loadArt, build: artScreen("preview") }),
  screen<AttachData>({
    id: SCREENS.attach,
    load: async (ctx, deps) => {
      const [files, job, project] = await Promise.all([
        deps.api<{ files: FileRow[] }>("GET", "/v1/files").then((f) => f.files ?? []).catch(() => [] as FileRow[]),
        ctx.params.id !== undefined ? readJob(deps, ctx.params.id).catch(() => undefined) : Promise.resolve(undefined),
        isUuid(ctx.params.project) ? deps.api<{ project: ProjectRow }>("GET", `/v1/code/projects/${ctx.params.project}`).then((x) => x.project).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      return { files, ...(job ? { job } : {}), ...(project ? { project } : {}) };
    },
    build: attachScreen,
  }),
  screen<DoneData>({
    id: SCREENS.done,
    load: async (ctx, deps) => {
      const job = await readJob(deps, ctx.params.id);
      if (!job) throw new Error("no job");
      return { job, shippedThisWeek: await shippedThisWeek(ctx, deps) };
    },
    build: doneScreen,
  }),
  screen<JobData>({ id: SCREENS.failed, load: (ctx, deps) => readJob(deps, ctx.params.id).then((j) => { if (!j) throw new Error("no job"); return j; }), build: failedScreen }),
];
