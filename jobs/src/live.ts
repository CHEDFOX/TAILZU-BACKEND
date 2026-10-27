/**
 * THE LIVE SESSION, THE WORKER'S SIDE OF THE AGENT: THE ROOM AS FILES, AS A RUNNER, AS AN INBOX, AS A WINDOW.
 *
 * The agent loop (tulmi/src/code/agent) asks four things of `AgentDeps.live`, and this file answers each from the job's room (jobRoom.ts):
 *
 *   files      RoomFiles: read, list, glob, grep over the room's copy of the code. On the first need it makes the copy: it mints a READ-ONLY, ONE-REPO
 *              token here (the same `runnerAccess` a PC is given, never one that can write), and the room downloads the tarball with it
 *   runner     liveRunner: the agent's `run`. Opens the session late (only when a command needs it: it asks the router for a session step, which is
 *              placed like any other, the person's PC first), queues the command in the room, and does NOT hold an RPC open for it. It throws
 *              RunPending, the advance ends, the Workflow waits for an event, and the room sends the event when the runner reports. The next
 *              advance asks `execStatus` and has the result. A step the router could not place in time, a cap that is used up, a keepChanges step
 *              (a scaffold, whose changes the server commits) all go the old way, through the router, as before
 *   inbox      the person's words sent while the job works
 *   progress   compact events for the app's live view
 *
 * Nothing here is used unless CODE_LIVE_SESSION is not "false", CODE_JOBS_URL is set (the address a runner is told to connect to) and the job's
 * rooms exist; `buildLive` answers null otherwise and the Worker runs exactly as it did.
 */
import { createHash } from "node:crypto";
import { ConnectorError } from "../../tulmi/src/connectors/state.js";
import { PLACE_WAIT_MS, RUN_GRACE_MS, RUN_POLL_MS } from "../../tulmi/src/code/agent/types.js";
import { RunPending, retryAfter, type AgentRunner, type RunControl, type RunOutcome, type RunSpec } from "../../tulmi/src/code/agent/runner.js";
import type { JobRouter } from "../../tulmi/src/code/jobs/router.js";
import type { JobStore } from "../../tulmi/src/code/jobs/store.js";
import { isEnded, type CodeJob } from "../../tulmi/src/code/jobs/types.js";
import { RUNNER_TOKEN_TTL_MS } from "../../tulmi/src/code/live/limits.js";
import type { Inbox, LiveDeps, LiveFiles, LiveGlob, LiveGrep, LiveJob, LiveList, LivePreview, LiveRead, LiveStatus, PreviewState } from "../../tulmi/src/code/live/ports.js";
import { SESSION_COMMAND, isId, isSessionCommands, type CloseReason, type ViewerEvent } from "../../tulmi/src/code/live/protocol.js";
import type { GrepOptions } from "../../tulmi/src/code/live/search.js";
import { ownProject, repoRef, runnerAccess, type ProjectDeps } from "../../tulmi/src/code/projects.js";
import type { OverlayFile } from "../../tulmi/src/code/jobs/types.js";
import type { Env } from "./env.js";
import type { TarSource } from "./jobRoom.js";
import { previewSiteOf } from "./previewDoor.js";
import { roomOf, type Room } from "./rooms.js";

export { roomOf };

export interface LiveSettings {
  idleSec: number;
  maxMin: number;
  /** CODE_PREVIEW_IDLE_SEC: a preview with no request for this long is closed. */
  previewIdleSec?: number;
}


// ----------------------------------------------------------------- the files

/** The commit a job's copy is of and how to download it, with a token that can read one repo and nothing else. */
export type CopySource = (job: LiveJob) => Promise<{ headSha: string; source: TarSource }>;

export function copySource(d: ProjectDeps, store: Pick<JobStore, "getJobById">): CopySource {
  return async (job) => {
    const project = await ownProject(d, job.userId, job.projectId);
    const repo = repoRef(d, job.userId, project);
    // The commit the runner's checkout will be at (githubActions.ts dispatch): the checkpoint's, else the branch's head.
    const checkpoint = (await store.getJobById(job.id))?.checkpoint.headSha;
    const headSha = checkpoint || (await d.github.branchHead(repo, job.branch));
    const access = await runnerAccess(d, job.userId, job.projectId, job.branch, "read");
    if (access.kind === "app") {
      const [owner, name] = project.fullName.split("/");
      return { headSha, source: { kind: "github", owner: owner!, repo: name!, token: access.token } };
    }
    return { headSha, source: { kind: "url", url: access.tarballUrl } };
  };
}

const NOT_READY: LiveStatus = { ready: false, remote: false, files: 0, bytes: 0, headSha: "" };

/** A job's room as the agent's files. Every call that can fail says "unavailable" instead, and the tools use GitHub. */
export class RoomFiles implements LiveFiles {
  constructor(private readonly room: Room, private readonly job: LiveJob, private readonly source: CopySource) {}

  async status(): Promise<LiveStatus> {
    try {
      let st = await this.room.status();
      if (!st.ready && !st.remote) {
        const src = await this.source(this.job);
        st = await this.room.prepare({ jobId: this.job.id, headSha: src.headSha, source: src.source });
      }
      return { ready: st.ready, remote: st.remote, files: st.files, bytes: st.bytes, headSha: st.headSha };
    } catch {
      return NOT_READY;
    }
  }

  async setOverlay(files: readonly OverlayFile[]): Promise<void> { await this.room.setOverlay(files.map((f) => ({ path: f.path, content: f.content }))); }
  async read(path: string, o: { offset?: number; limit?: number }): Promise<LiveRead> { return this.room.read(path, o).catch(() => ({ kind: "unavailable" as const })); }
  async list(dir: string): Promise<LiveList> { return this.room.list(dir).catch(() => ({ kind: "unavailable" as const })); }
  async glob(pattern: string): Promise<LiveGlob> { return this.room.glob(pattern).catch(() => ({ kind: "unavailable" as const })); }
  async grep(pattern: string, o: GrepOptions): Promise<LiveGrep> { return this.room.grep(pattern, o).catch(() => ({ kind: "unavailable" as const })); }
  async reset(): Promise<void> { await this.room.invalidate(); }
}

// --------------------------------------------------------------- the runner

export interface SettleOptions {
  jobs: Pick<JobRouter, "cancelExec">;
  store: Pick<JobStore, "listSteps" | "getStep">;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  /** How long a session step that is finishing its report is waited for. */
  settleMs: number;
}

/**
 * Waits for the job's session step, whose session has been closed, to report (the runner posts its result as it leaves, and the minutes it used
 * are counted then), and drops it if it does not in time. The router lets one exec step be out at a time and a job be done only with none out.
 */
export async function settleSessionStep(o: SettleOptions, jobId: string): Promise<void> {
  const open = (await o.store.listSteps(jobId)).filter((s) => s.kind === "exec" && (s.status === "pending" || s.status === "dispatched" || s.status === "running" || s.status === "blocked")).at(-1);
  if (!open || !isSessionCommands(open.commands)) return;
  const until = o.now() + o.settleMs;
  while (o.now() < until) {
    const cur = await o.store.getStep(jobId, open.idx);
    if (!cur || !(cur.status === "pending" || cur.status === "dispatched" || cur.status === "running" || cur.status === "blocked")) return;
    await o.sleep(Math.min(1000, o.pollMs));
  }
  await o.jobs.cancelExec(jobId);
}

export interface LiveRunnerOptions {
  env: Pick<Env, "ROOMS">;
  jobs: Pick<JobRouter, "requestExec" | "cancelExec">;
  store: Pick<JobStore, "getStep" | "listSteps" | "getJobById">;
  /** Commands the session cannot run (a scaffold whose changes are committed), a session that could not be placed in time, and a job past its session time. */
  fallback: AgentRunner;
  settings: LiveSettings;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  placeWaitMs?: number;
  graceMs?: number;
  /** How long a session step that is finishing its report is waited for before another is asked for. */
  settleMs?: number;
}

/** A tag the room and the runner can carry: the call's id as it is when it is plain, else a digest of it. */
export function safeTag(tag: string): string {
  return isId(tag) ? tag : `t-${createHash("sha256").update(tag).digest("hex").slice(0, 24)}`;
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function liveRunner(o: LiveRunnerOptions): AgentRunner {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? sleepFor;
  const poll = o.pollMs ?? RUN_POLL_MS;
  const placeWait = o.placeWaitMs ?? PLACE_WAIT_MS;
  const grace = o.graceMs ?? RUN_GRACE_MS;
  const settle = o.settleMs ?? 15_000;
  const capMs = o.settings.maxMin * 60_000;
  const idleMs = o.settings.idleSec * 1000;

  const settleOldStep = (jobId: string) => settleSessionStep({ jobs: o.jobs, store: o.store, now, sleep, pollMs: poll, settleMs: settle }, jobId);

  async function dropSession(job: CodeJob, room: Room): Promise<void> {
    const sess = await room.sessionInfo().catch(() => null);
    if (sess && (sess.state === "open" || sess.state === "opening")) await room.closeSession("superseded").catch(() => undefined);
    await settleOldStep(job.id);
  }

  /** Asks the router for a session step and tells the room. Returns the step's number. Throws a ConnectorError the caller turns into "no runner". */
  async function openSession(job: CodeJob, room: Room, remainingMs: number): Promise<number> {
    await settleOldStep(job.id);
    await room.expectRunner({ jobId: job.id, idleMs, remainingMs, ticketTtlMs: RUNNER_TOKEN_TTL_MS });
    try {
      // The step's own time limit is the session's: it is also the GitHub workflow's timeout.
      const { step } = await o.jobs.requestExec(job.id, [SESSION_COMMAND], Math.max(60, Math.min(3600, Math.floor(remainingMs / 1000))), 5, { keepChanges: false });
      await room.bindStep(step.idx);
      return step.idx;
    } catch (err) {
      await room.closeSession("error").catch(() => undefined);
      throw err;
    }
  }

  const done = (v: { exitCode?: number; outputTail?: string; ms?: number }, stepIdx: number): RunOutcome => ({
    status: "done", exitCode: v.exitCode ?? 1, outputTail: v.outputTail ?? "", minutes: Math.max(0, Math.ceil((v.ms ?? 0) / 60_000)), ms: v.ms ?? 0, stepIdx,
  });

  return {
    async run(job: CodeJob, spec: RunSpec, ctl: RunControl = {}): Promise<RunOutcome> {
      const room = roomOf(o.env, job.id);
      // A step a server that died asked for, which is not a session: the old way takes it over.
      if (spec.adopt !== undefined) {
        const was = await o.store.getStep(job.id, spec.adopt);
        if (was && was.kind === "exec" && !isSessionCommands(was.commands)) return o.fallback.run(job, spec, ctl);
      }
      // What a step's changes are kept for (a scaffold) cannot be done in a session: the server commits them, from the step's result.
      if (spec.keepChanges === true) {
        await dropSession(job, room);
        return o.fallback.run(job, spec, ctl);
      }

      const tag = safeTag(spec.tag ?? spec.commands.join("\n"));
      const started = ctl.startedAt ?? now();
      let stepIdx = spec.adopt;
      let view = await room.execStatus(tag);
      if (view?.status === "done") return done(view, stepIdx ?? -1);
      if (view?.status === "lost") return { status: view.note?.includes("ran past") ? "timeout" : "no_runner", reason: view.note ?? "The session ended before the command finished." };

      if (!view) {
        const budget = await room.sessionBudget(capMs);
        const sess = await room.sessionInfo();
        // The job has used all its session time: the rest of its commands are steps of their own, as they always were.
        if (!budget.ok && sess.state !== "open") return o.fallback.run(job, spec, ctl);
        view = await room.queueExec({ jobId: job.id, tag, commands: spec.commands, timeoutSec: spec.timeoutSec, overlay: spec.overlay ?? [] });
        if (view.status === "lost") return { status: "no_runner", reason: view.note ?? "The session could not take the command." };
      }

      // The session: already there, or opened now (late: this is the first command that needs it).
      let sess = await room.sessionInfo();
      if (sess.state === "none" || sess.state === "closed") {
        const budget = await room.sessionBudget(capMs);
        if (!budget.ok) {
          await room.cancelExec(tag);
          return o.fallback.run(job, spec, ctl);
        }
        try {
          stepIdx = await openSession(job, room, budget.remainingMs);
        } catch (err) {
          await room.cancelExec(tag);
          if (err instanceof ConnectorError) return { status: "no_runner", reason: err.message };
          throw err;
        }
        await ctl.onStep?.(stepIdx);
        sess = await room.sessionInfo();
      } else if (stepIdx === undefined) stepIdx = sess.stepIdx;

      for (;;) {
        if (ctl.signal?.aborted) return { status: "cancelled", reason: "stopped" };
        view = (await room.execStatus(tag)) ?? view;
        if (view.status === "done") return done(view, stepIdx ?? -1);
        if (view.status === "lost") return { status: view.note?.includes("ran past") ? "timeout" : "no_runner", reason: view.note ?? "The session ended before the command finished." };
        const j = await o.store.getJobById(job.id);
        if (!j || isEnded(j.state)) return { status: "cancelled", reason: "The job was stopped." };
        const waited = now() - started;
        sess = await room.sessionInfo();
        if (sess.state !== "open" && stepIdx !== undefined) {
          const step = await o.store.getStep(job.id, stepIdx);
          // The router has found no place for the session in the time the agent will wait: the command is dropped, and the agent is told so.
          if (step && step.status === "pending" && waited > placeWait) {
            await room.cancelExec(tag);
            await room.closeSession("error").catch(() => undefined);
            await o.jobs.cancelExec(job.id);
            return { status: "no_runner", reason: j.reason || "No computer was free to run it." };
          }
          // The step ended (its runner exited, failed, was dropped) without ever connecting.
          if (step && (step.status === "done" || step.status === "failed" || step.status === "cancelled")) {
            await room.cancelExec(tag);
            return { status: "no_runner", reason: "The computer that was to run it did not connect to the session." };
          }
        }
        if (waited > spec.timeoutSec * 1000 + grace + placeWait + RUNNER_TOKEN_TTL_MS) {
          await room.cancelExec(tag);
          return { status: "timeout", reason: "It did not finish in the time it was given." };
        }
        if (ctl.once) throw new RunPending(retryAfter(waited), stepIdx ?? 0);
        await ctl.renew?.();
        await sleep(poll);
      }
    },
  };
}

// -------------------------------------------------------------- the preview

/**
 * The agent's `LivePreview` over a job's room: the dev server on the open session's runner, with the staged edits laid, and an address for it on the
 * preview site (previewDoor.ts). `start` returns at once; the room tells the job's Workflow when the dev server answers.
 */
export function roomPreview(env: Env, o: { previewIdleSec: number }): LivePreview {
  return {
    async start(job, p) {
      const r = await roomOf(env, job.id).startPreview({
        jobId: job.id, userId: job.userId, cmd: p.cmd, readySec: p.readySec ?? 90, idleSec: o.previewIdleSec, overlay: p.overlay.map((f) => ({ path: f.path, content: f.content })),
        site: previewSiteOf(env), ...(p.port ? { port: p.port } : {}), ...(p.prepare ? { prepare: p.prepare } : {}),
      });
      return r.ok ? { ok: true } : { ok: false, reason: r.reason, message: r.message };
    },
    async status(jobId): Promise<PreviewState> {
      const v = await roomOf(env, jobId).previewStatus();
      return { state: v.state, ...(v.url ? { url: v.url } : {}), ...(v.error ? { error: v.error } : {}), ...(v.closeReason ? { closeReason: v.closeReason } : {}) };
    },
    async stop(jobId, reason) { await roomOf(env, jobId).stopPreview(reason ?? "stopped"); },
  };
}

// ---------------------------------------------------------------- the rest

export interface BuiltLive {
  deps: LiveDeps;
  runner: AgentRunner;
}

/** Everything the agent is given for the live session, or null when it is switched off. */
export function buildLive(env: Env, o: {
  d: ProjectDeps; jobs: JobRouter; store: JobStore; fallback: AgentRunner; settings: LiveSettings; now?: () => number; sleep?: (ms: number) => Promise<void>;
  pollMs?: number; placeWaitMs?: number; settleMs?: number;
}): BuiltLive | null {
  if (String(env.CODE_LIVE_SESSION ?? "true").trim().toLowerCase() === "false") return null;
  const source = copySource(o.d, o.store);
  const inbox: Inbox = {
    pending: (jobId) => roomOf(env, jobId).inboxPending(),
    ack: (jobId, ids) => roomOf(env, jobId).inboxAck([...ids]),
  };
  const deps: LiveDeps = {
    files: (job) => new RoomFiles(roomOf(env, job.id), job, source),
    inbox,
    progress: (jobId: string, ev: ViewerEvent) => { void roomOf(env, jobId).publish(ev).catch(() => undefined); },
    // The room closes the session; at the job's end the step that hosts it is given a moment to report (its minutes are counted then) before the job is finished.
    closeSession: async (jobId: string, reason: CloseReason) => {
      const closed = await roomOf(env, jobId).closeSession(reason);
      if (closed.closed && reason === "job_end") await settleSessionStep({ jobs: o.jobs, store: o.store, now: o.now ?? Date.now, sleep: o.sleep ?? sleepFor, pollMs: o.pollMs ?? RUN_POLL_MS, settleMs: o.settleMs ?? 15_000 }, jobId);
    },
    endJob: async (jobId: string) => { await roomOf(env, jobId).endJob(); },
    preview: roomPreview(env, { previewIdleSec: o.settings.previewIdleSec ?? 300 }),
  };
  const runner = liveRunner({
    env, jobs: o.jobs, store: o.store, fallback: o.fallback, settings: o.settings,
    ...(o.now ? { now: o.now } : {}), ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.pollMs !== undefined ? { pollMs: o.pollMs } : {}),
    ...(o.placeWaitMs !== undefined ? { placeWaitMs: o.placeWaitMs } : {}), ...(o.settleMs !== undefined ? { settleMs: o.settleMs } : {}),
  });
  return { deps, runner };
}
