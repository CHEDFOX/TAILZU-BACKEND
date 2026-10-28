/**
 * PR CARE: LOOKING AFTER A PULL REQUEST AFTER IT IS OPENED. The story is in docs/pr-care.md.
 *
 * WHOSE PULL REQUESTS. Only those that are Tailzu's: one Tailzu opened (its "tailzu/..." work branch has the pull request's number), or one the person
 * explicitly HANDED OVER (handOver). A pull request that is neither is ignored whoever opened it and whatever it says: its events are dropped before GitHub
 * is asked anything. A fork's pull request is never looked after (there is nowhere Tailzu may push).
 *
 * WHAT TRIGGERS IT. GitHub's webhook (code/webhook.ts hands each event to `onEvent`): pull_request, pull_request_review, pull_request_review_comment,
 * issue_comment, check_run, check_suite, status; a push to the default branch (`baseMoved`); and the end of a job it started (`onJobEvent`). A webhook is
 * answered at once: the events are only queued here, one line of work at a time for each pull request, so two events for one pull request never run
 * together. What an event SAYS is never trusted for what to do: it names a pull request, and everything decided is read from GitHub afresh.
 *
 * WHAT IT DOES, each of them a job on the pull request's own branch (the agent loop, with its budget, policy, staged changeset, step cap, checkpoints and
 * verify-before-commit, and the server doing the pushing):
 *
 *   red CI          ci.ts decides whether it is this change's to fix. If so a free-form "fix CI" job; three automatic rounds a pull request a day, then it
 *                   stops and tells the person. Red on the default branch too, or the same infra error: a note, and NOTHING is pushed
 *   a review ask    review.ts reads each new comment of someone who may write to the repo. A small ask is done (one job for the pass), answered under the
 *                   comment and the thread resolved; a larger one gets a PROPOSAL reply and the person is told; a question is answered from the work log
 *   a conflict      `mergeable: false`: a job merges the default branch in (a runner does the git merge; the model resolves what clashes; the server commits
 *                   a merge commit with two parents). Two sides that changed the same logic: the person is asked
 *
 * WHAT IT NEVER DOES. Skip, disable or weaken a test or a check. Push an empty commit, or close and reopen, to kick CI. Force-push or rebase. Act on a
 * pull request that is not Tailzu's. Work round GitHub's refusal of a push: the job stops, the status comment carries exactly what GitHub said with its
 * link, and it waits for the person.
 *
 * ONE VOICE. The pull request carries one "Tailzu status" comment, edited in place (status.ts); replies go under a reviewer's own comment.
 */
import { ConnectorError } from "../../connectors/state.js";
import type { AgentOrchestrator } from "../agent/orchestrator.js";
import { stateOf, type CareContext, type JobMode } from "../agent/types.js";
import type { GatewayDeps } from "../brain/gateway.js";
import { validBranchName, type PullInfo, type RepoRef, type ReviewThread } from "../github.js";
import type { JobRouter } from "../jobs/router.js";
import type { JobStore } from "../jobs/store.js";
import { isEnded, type CodeJob, type Notify, type NotifyData, type NotifyKind } from "../jobs/types.js";
import { assertAccess, ownProject, repoRef, type ProjectDeps } from "../projects.js";
import type { CodeProject } from "../store.js";
import { WorkLog, worklogStore, type Located, type WorklogStore } from "../work/index.js";
import { cut, oneLine, type CallFn, type ModelCtx } from "../work/model.js";
import { redactText } from "../work/worklog.js";
import { decideCi, type CiDecision } from "./ci.js";
import { readComment, type ReviewVerdict } from "./review.js";
import { writeStatus } from "./status.js";
import { careStore, type CareStore } from "./store.js";
import { isLeaving } from "../../you/deletion.js";
import {
  CI_ROUNDS_PER_DAY, COMMENTS_PER_PASS, HANDLED_KEEP, JOBS_KEEP, JOB_STUCK_MS, NOTES_KEEP, ROUND_DAYS_KEEP, STATUS_MARK,
  dayOf, emptyState, type CareJobRef, type CareKind, type CareRow,
} from "./types.js";

/** The events PR care listens to. */
export const CARE_EVENTS: ReadonlySet<string> = new Set(["pull_request", "pull_request_review", "pull_request_review_comment", "issue_comment", "check_run", "check_suite", "status"]);

export interface CareDeps {
  projects: ProjectDeps;
  jobs: Pick<JobRouter, "createJob" | "cancelJob">;
  jobStore: Pick<JobStore, "getJobById" | "listJobs">;
  agent: Pick<AgentOrchestrator, "enqueue">;
  store?: CareStore;
  call?: CallFn;
  gateway?: GatewayDeps;
  worklog?: WorklogStore;
  /** How the person is told (the push engine). */
  notify?: Notify;
  now?: () => number;
  log?: { info?(o: object, m: string): void; warn(o: object, m: string): void };
  /** What a job PR care starts may spend, in paise; the router's default when absent. */
  budgetPaise?: number;
  /** Paise one reading of a comment may cost. */
  readPaise?: number;
  /** Whether a person's bots are stopped (their account waits to be deleted: you/deletion.ts isLeaving, the default): nothing is read or started for them. */
  stopped?: (userId: string) => Promise<boolean>;
}

/** One pull request, as it is being worked on: its row, its project, the repo, and the pull request as GitHub has it now. */
interface Ctx { row: CareRow; project: CodeProject; repo: RepoRef; pull: PullInfo }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
const isBot = (login: string): boolean => /\[bot\]$/i.test(login);
const sha7 = (s: string): string => s.slice(0, 7);
const keyOf = (projectId: string, n: number): string => `${projectId}|${n}`;

/** Where in the payloads each event names its pull request: numbers, and/or the branch. */
function targetsOf(event: string, p: Record<string, unknown>): Array<{ number?: number; branch?: string }> {
  const repoId = int(obj(p.repository).id);
  if (event === "pull_request" || event === "pull_request_review" || event === "pull_request_review_comment") {
    const pr = obj(p.pull_request);
    const head = obj(pr.head);
    const n = int(pr.number);
    // A pull request from a fork has no branch of ours.
    if (n === null || int(obj(head.repo).id) !== repoId) return [];
    return [{ number: n, ...(str(head.ref) ? { branch: str(head.ref) } : {}) }];
  }
  if (event === "issue_comment") {
    const issue = obj(p.issue);
    const n = int(issue.number);
    return n !== null && issue.pull_request ? [{ number: n }] : [];
  }
  if (event === "check_run" || event === "check_suite") {
    const subject = obj(p[event]);
    const suite = event === "check_run" ? obj(subject.check_suite) : subject;
    const listed = (Array.isArray(subject.pull_requests) ? subject.pull_requests : []).map(obj);
    // A pull request from a fork has checks on this repo too (the fork's branch may even be named like one of ours): only a head in this repo counts.
    const prs = listed.filter((x) => int(obj(obj(x.base).repo).id) === repoId && int(obj(obj(x.head).repo).id) === repoId)
      .flatMap((x) => (int(x.number) !== null ? [{ number: int(x.number)!, ...(str(obj(x.head).ref) ? { branch: str(obj(x.head).ref) } : {}) }] : []));
    // GitHub lists no pull requests for some checks: the branch then names it. When it lists some, those are the ones, and none of them is ours: nothing to look at.
    if (listed.length) return prs;
    return str(suite.head_branch) ? [{ branch: str(suite.head_branch) }] : [];
  }
  if (event === "status") {
    return (Array.isArray(p.branches) ? p.branches : []).map((b) => str(obj(b).name)).filter(Boolean).slice(0, 10).map((branch) => ({ branch }));
  }
  return [];
}

/** Whether an event is worth looking at, from its action and its sender alone. */
function worthLooking(event: string, p: Record<string, unknown>): boolean {
  const action = str(p.action);
  const sender = obj(p.sender);
  const actor = str(sender.login);
  const bot = str(sender.type) === "Bot" || isBot(actor);
  if (event === "pull_request") return ["opened", "reopened", "synchronize", "ready_for_review", "closed"].includes(action);
  if (event === "pull_request_review") return action === "submitted" && !bot;
  if (event === "pull_request_review_comment" || event === "issue_comment") return action === "created" && !bot;
  if (event === "check_run" || event === "check_suite") return action === "completed";
  if (event === "status") return str(p.state) !== "pending";
  return false;
}

export class PrCare {
  private readonly store: CareStore;
  private readonly now: () => number;
  private readonly chains = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly d: CareDeps) {
    this.store = d.store ?? careStore();
    this.now = d.now ?? Date.now;
  }

  // ------------------------------------------------------------------ the queue

  private warn(err: unknown, what: string): void {
    this.d.log?.warn({ error: (err as { code?: string; name?: string } | null)?.code ?? (err as Error | null)?.name ?? "error" }, `pr care: ${what} failed`);
  }

  private track<T>(p: Promise<T>): void {
    const q = p.catch(() => undefined);
    this.pending.add(q);
    void q.finally(() => this.pending.delete(q));
  }

  /** Runs `fn` after everything queued before it for the same pull request. */
  private enqueue(key: string, what: string, fn: () => Promise<void>): void {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next: Promise<void> = prev.then(fn).catch((err) => this.warn(err, what)).finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); });
    this.chains.set(key, next);
    this.track(next);
  }

  /** Waits until nothing is queued (for tests, and for a clean shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  // ------------------------------------------------------------------ what the person does

  async list(userId: string, projectId: string): Promise<CareRow[]> {
    const project = await ownProject(this.d.projects, userId, projectId);
    return this.store.listByProject(project.id);
  }

  /**
   * "Look after this pull request": the person hands over a pull request Tailzu did not open. It must be open, from a branch in this repo (not a fork), and not the
   * default branch. The branch is recorded like a work branch, so jobs run on it and the policy treats it as Tailzu's own: the hand-over is the person's yes to
   * pushing to it (never forced, and a protection rule on GitHub still says no). What was already said on it is taken as seen: only what comes after is dealt with.
   */
  async handOver(userId: string, projectId: string, prNumber: unknown): Promise<CareRow> {
    if (typeof prNumber !== "number" || !Number.isSafeInteger(prNumber) || prNumber < 1) throw new ConnectorError("bad_request", "prNumber is the number of the pull request.");
    const d = this.d.projects;
    const project = await ownProject(d, userId, projectId);
    await assertAccess(d, userId, project, true);
    const repo = repoRef(d, userId, project);
    const pull = await d.github.getPull(repo, prNumber);
    if (pull.state !== "open") throw new ConnectorError("pr_not_open", "That pull request isn't open.");
    if (pull.headRepoId !== project.repoId) throw new ConnectorError("bad_request", "That pull request comes from a fork. Tailzu cannot push to a fork, so it cannot look after it.");
    if (!validBranchName(pull.headRef) || pull.headRef === project.defaultBranch || pull.headRef === pull.baseRef) throw new ConnectorError("bad_request", "Tailzu cannot look after a pull request from the default branch.");
    const kept = await this.store.get(project.id, prNumber);
    if (kept && !kept.endedAt) return kept;
    let branch = await d.store.getBranch(project.id, pull.headRef);
    if (!branch) {
      branch = await d.store.addBranch({ projectId: project.id, branch: pull.headRef, task: cut(pull.title, 200), baseSha: await d.github.branchHead(repo, pull.baseRef), handed: true });
    }
    if (branch.prNumber !== prNumber) await d.store.setBranchPr(project.id, pull.headRef, prNumber, pull.url);
    const now = this.now();
    // Everything said before the hand-over is taken as seen.
    const threads = await d.github.reviewThreads(repo, pull).catch(() => [] as ReviewThread[]);
    const convo = await d.github.issueComments(repo, prNumber).catch(() => []);
    const row: CareRow = {
      projectId: project.id, prNumber, userId, branch: pull.headRef, origin: branch.handed ? "handed" : "tailzu", statusCommentId: null, ciRounds: {},
      state: { ...emptyState(), title: pull.title, prUrl: pull.url, head: pull.headSha, handled: [...threads.flatMap((t) => t.comments.map((c) => c.id)), ...convo.map((c) => c.id)].slice(-HANDLED_KEEP) },
      handedAt: now, endedAt: null, createdAt: now, updatedAt: now,
    };
    this.note(row, "Tailzu is looking after this pull request now.");
    await this.store.put(row);
    this.enqueue(keyOf(project.id, prNumber), "a hand-over", () => this.process(project.id, prNumber, "pull_request", "opened"));
    return row;
  }

  /** "Stop looking after it": the status comment says so, and the row goes. Jobs already out are cancelled. */
  async release(userId: string, projectId: string, prNumber: number): Promise<boolean> {
    const project = await ownProject(this.d.projects, userId, projectId);
    const row = await this.store.get(project.id, prNumber);
    if (!row) return false;
    await new Promise<void>((resolve) => this.enqueue(keyOf(project.id, prNumber), "a release", async () => {
      try {
        const live = (await this.store.get(project.id, prNumber)) ?? row;
        for (const j of live.state.jobs.filter((x) => !x.done)) await this.d.jobs.cancelJob(j.jobId, "You took this pull request back from Tailzu.").catch(() => undefined);
        live.state.ended = "released";
        live.state.jobs.forEach((j) => { j.done = true; });
        live.state.waiting = undefined;
        await this.writeStatusOf(live, project).catch((err) => this.warn(err, "the last status"));
        await this.store.delete(project.id, prNumber);
      } finally { resolve(); }
    }));
    return true;
  }

  // ------------------------------------------------------------------ what GitHub says

  /** A webhook delivery. Quick: it only queues the work. */
  onEvent(event: string, payload: unknown): void {
    if (!CARE_EVENTS.has(event)) return;
    const p = obj(payload);
    const repoId = int(obj(p.repository).id);
    if (repoId === null || !worthLooking(event, p)) return;
    this.track(this.dispatch(event, p, repoId).catch((err) => this.warn(err, "an event")));
  }

  private async dispatch(event: string, p: Record<string, unknown>, repoId: number): Promise<void> {
    const projects = await this.d.projects.store.listProjectsByRepo(repoId);
    if (!projects.length) return;
    const targets = targetsOf(event, p);
    if (!targets.length) return;
    const seen = new Set<string>();
    for (const project of projects) {
      for (const t of targets) {
        const row = await this.rowFor(project, t.number, t.branch);
        if (!row || seen.has(keyOf(project.id, row.prNumber))) continue;
        seen.add(keyOf(project.id, row.prNumber));
        this.enqueue(keyOf(project.id, row.prNumber), `an ${event} event`, () => this.process(project.id, row.prNumber, event, str(p.action)));
      }
    }
  }

  /** The pull request's row: the one kept, or one made now for a pull request Tailzu opened. Null for a pull request that is none of Tailzu's. */
  private async rowFor(project: CodeProject, number?: number, branch?: string): Promise<CareRow | null> {
    if (number !== undefined) {
      const kept = await this.store.get(project.id, number);
      if (kept) return kept;
    } else if (branch) {
      const kept = (await this.store.listByProject(project.id)).find((r) => r.branch === branch && !r.endedAt);
      if (kept) return kept;
    }
    // Tailzu's own: a work branch it recorded, with this pull request's number (or none yet: the number is written just after the pull request is opened).
    const b = branch ? await this.d.projects.store.getBranch(project.id, branch)
      : number !== undefined ? (await this.d.projects.store.listBranches(project.id)).find((x) => x.prNumber === number) ?? null : null;
    const n = number ?? b?.prNumber ?? undefined;
    if (!b || b.state === "deleted" || n === undefined || (b.prNumber !== null && b.prNumber !== n)) return null;
    const now = this.now();
    const row: CareRow = {
      projectId: project.id, prNumber: n, userId: project.userId, branch: b.branch, origin: b.handed ? "handed" : "tailzu", statusCommentId: null, ciRounds: {},
      state: { ...emptyState(), ...(b.prUrl ? { prUrl: b.prUrl } : {}) }, handedAt: null, endedAt: null, createdAt: now, updatedAt: now,
    };
    return this.store.put(row);
  }

  /** The default branch moved: every pull request Tailzu looks after in the project is looked at again for a conflict. */
  baseMoved(project: CodeProject): void {
    this.track((async () => {
      for (const r of await this.store.listByProject(project.id)) {
        if (!r.endedAt) this.enqueue(keyOf(project.id, r.prNumber), "a base move", () => this.process(project.id, r.prNumber, "base_moved", ""));
      }
    })().catch((err) => this.warn(err, "a base move")));
  }

  /** A job ended, or needs the person (the router's notification): the jobs PR care started are looked at. */
  onJobEvent(_userId: string, _kind: NotifyKind, data: NotifyData): void {
    this.track((async () => {
      for (const r of await this.store.listByProject(data.projectId)) {
        if (r.state.jobs.some((j) => !j.done && j.jobId === data.jobId)) {
          this.enqueue(keyOf(r.projectId, r.prNumber), "a job event", () => this.process(r.projectId, r.prNumber, "job", ""));
        }
      }
    })().catch((err) => this.warn(err, "a job event")));
  }

  /** What a timer does: finishes the jobs whose end nobody reported, and looks again where GitHub had not worked out whether a branch merges. */
  async sweep(): Promise<void> {
    for (const r of await this.store.listActive(100)) {
      if (r.state.jobs.some((j) => !j.done) || r.state.recheck) {
        this.enqueue(keyOf(r.projectId, r.prNumber), "a sweep", () => this.process(r.projectId, r.prNumber, r.state.recheck ? "base_moved" : "job", ""));
      }
    }
    await this.idle();
  }

  // ------------------------------------------------------------------ one pull request, one event

  private async context(row: CareRow): Promise<Ctx | null> {
    const project = await this.d.projects.store.getProject(row.userId, row.projectId);
    if (!project) return null;
    try { await assertAccess(this.d.projects, row.userId, project); } catch (err) { this.warn(err, "access"); return null; }
    const repo = { ...repoRef(this.d.projects, row.userId, project) };
    const pull = await this.d.projects.github.getPull(repo, row.prNumber);
    return { row, project, repo, pull };
  }

  private async process(projectId: string, prNumber: number, event: string, action: string): Promise<void> {
    let row = await this.store.get(projectId, prNumber);
    if (!row) return;
    // The person's bots are stopped (their account waits to be deleted): nothing is read, written or started until they keep it.
    if (await (this.d.stopped ?? isLeaving)(row.userId)) return;
    if (row.endedAt) {
      if (!(event === "pull_request" && action === "reopened")) return;
      row = { ...row, endedAt: null, state: { ...row.state, ended: undefined } };
    }
    const c = await this.context(row);
    if (!c) return;
    row = c.row;
    // Only the branch Tailzu was given: a pull request whose branch is another (renamed) or from a fork is not the one looked after.
    if (c.pull.state !== "open") { await this.end(c, c.pull.state); return; }
    if (c.pull.headRef !== row.branch || c.pull.headRepoId !== c.project.repoId) return;
    row.state.title = c.pull.title;
    row.state.prUrl = c.pull.url;
    // What the jobs it started came to is written down FIRST: a push of a fix makes events of its own before the job's end is reported, and the new head must be judged
    // knowing that job is over (else "a fix is out" would hide a head that is red again).
    await this.syncJobs(c);
    switch (event) {
      case "pull_request":
        await this.conflicts(c);
        await this.ci(c);
        break;
      case "pull_request_review":
      case "pull_request_review_comment":
      case "issue_comment":
        await this.reviews(c);
        break;
      case "check_run":
      case "check_suite":
      case "status":
        await this.ci(c);
        break;
      case "base_moved":
        await this.conflicts(c);
        break;
      default:
        break;
    }
    await this.save(c);
  }

  private async end(c: Ctx, why: "merged" | "closed"): Promise<void> {
    const { row } = c;
    for (const j of row.state.jobs.filter((x) => !x.done)) await this.d.jobs.cancelJob(j.jobId, `The pull request was ${why}.`).catch(() => undefined);
    row.state.jobs.forEach((j) => { j.done = true; });
    row.state.ended = why;
    row.state.waiting = undefined;
    row.endedAt = this.now();
    this.note(row, why === "merged" ? "The pull request was merged." : "The pull request was closed.");
    await this.save(c);
  }

  /** Writes the status comment and the row. A status that cannot be written (the App may not comment) never stops the work. */
  private async save(c: Ctx): Promise<void> {
    const { row } = c;
    row.updatedAt = this.now();
    const days = Object.keys(row.ciRounds).sort().slice(-ROUND_DAYS_KEEP);
    row.ciRounds = Object.fromEntries(days.map((d) => [d, row.ciRounds[d]!]));
    row.state.handled = row.state.handled.slice(-HANDLED_KEEP);
    row.state.jobs = row.state.jobs.slice(-JOBS_KEEP);
    try {
      const w = await writeStatus(this.d.projects.github, c.repo, row, this.now());
      row.statusCommentId = w.id;
      row.state.statusHash = w.hash;
    } catch (err) { this.warn(err, "the status comment"); }
    await this.store.put(row);
  }

  private async writeStatusOf(row: CareRow, project: CodeProject): Promise<void> {
    const repo = repoRef(this.d.projects, row.userId, project);
    const w = await writeStatus(this.d.projects.github, repo, row, this.now());
    row.statusCommentId = w.id;
  }

  private note(row: CareRow, text: string): void {
    const last = row.state.notes.at(-1);
    if (last?.text === text) return;
    row.state.notes.push({ at: this.now(), text: cut(text, 300) });
    row.state.notes = row.state.notes.slice(-NOTES_KEEP);
  }

  /** Tells the person something that is theirs to decide. Never throws. */
  private async tell(c: Ctx, text: string): Promise<void> {
    const last = c.row.state.jobs.at(-1);
    try {
      await this.d.notify?.(c.row.userId, "needs_you", {
        jobId: last?.jobId ?? `pr-${c.row.prNumber}`, projectId: c.project.id, task: cut(`PR #${c.row.prNumber}: ${c.pull.title}`, 80), at: this.now(), reason: cut(oneLine(text, 200), 200),
      });
    } catch { /* a missed push is not a failed pull request: the status comment says it */ }
  }

  // ------------------------------------------------------------------ jobs

  /** Makes a job on the pull request's branch and hands it to the agent. Null when it could not be made (the caller tries again on the next event). */
  private async start(c: Ctx, o: { kind: CareKind; task: string; refs: string[]; care?: Partial<CareContext>; located?: Located; mode?: JobMode; threads?: CareJobRef["threads"] }): Promise<CareJobRef | null> {
    const { row, pull } = c;
    try {
      const job = await this.d.jobs.createJob(row.userId, row.projectId, row.branch, o.task, this.d.budgetPaise, { agent: true });
      const care: CareContext = { kind: o.kind, prNumber: row.prNumber, prUrl: pull.url, headSha: pull.headSha, refs: o.refs, ...o.care };
      await this.d.agent.enqueue(job.id, o.task, { care, ...(o.mode ? { mode: o.mode } : {}), ...(o.located ? { located: o.located, locatedFrom: "care" as const } : {}) });
      const ref: CareJobRef = { jobId: job.id, kind: o.kind, refs: o.refs, headSha: pull.headSha, startedAt: this.now(), ...(o.threads ? { threads: o.threads } : {}) };
      row.state.jobs.push(ref);
      return ref;
    } catch (err) {
      if (err instanceof ConnectorError) { this.note(row, `I could not start the work: ${err.message}`); return null; }
      throw err;
    }
  }

  /** Brings the row in step with the jobs it started: a job that ended is written up, one that waits for the person is said to. */
  private async syncJobs(c: Ctx): Promise<void> {
    const { row } = c;
    for (const ref of row.state.jobs.filter((j) => !j.done)) {
      const job = await this.d.jobStore.getJobById(ref.jobId);
      if (!job) { ref.done = true; continue; }
      if (isEnded(job.state)) {
        await this.jobEnded(c, ref, job);
        ref.done = true;
        if (row.state.waiting?.jobId === ref.jobId) row.state.waiting = undefined;
      } else if (job.state === "waiting_for_you") {
        const text = this.waitingText(job);
        if (text && (!row.state.waiting || row.state.waiting.jobId !== ref.jobId || row.state.waiting.text !== text)) {
          row.state.waiting = { jobId: ref.jobId, text, at: this.now() };
          if (!ref.waitingNoted) { ref.waitingNoted = true; this.note(row, "A job is waiting for your answer."); }
        }
      } else if (row.state.waiting?.jobId === ref.jobId) {
        row.state.waiting = undefined;
        ref.waitingNoted = false;
      } else if (this.now() - ref.startedAt > JOB_STUCK_MS) {
        this.note(row, "A job has been running for a long time; it is still going.");
      }
    }
  }

  /** What a parked job is waiting for, in words for the status comment. GitHub's own words for a refused push are in the question, link and all. */
  private waitingText(job: CodeJob): string {
    const w = stateOf(job.checkpoint)?.waiting;
    if (!w) return job.reason ? cut(job.reason, 700) : "";
    if (w.kind === "question") return w.question;
    if (w.kind === "approval") return `Needs your OK to ${w.for === "plan" ? "go ahead with the plan" : w.for === "commit" ? "commit the changes" : "mark the pull request ready"}.`;
    return "The job is out of budget. Add some to go on.";
  }

  private async jobEnded(c: Ctx, ref: CareJobRef, job: CodeJob): Promise<void> {
    const { row } = c;
    const s = row.state;
    const st = stateOf(job.checkpoint);
    const sha = st?.commits.at(-1);
    const why = oneLine(redactText(job.reason || st?.report?.text || "", 400), 240);
    const names = ref.refs.join(", ");
    if (ref.kind === "ci") {
      if (sha) {
        this.note(row, `Pushed a fix for ${names} (${sha7(sha)}). Waiting for the checks to run again.`);
      } else {
        s.ci = { head: ref.headSha, outcome: "unfixed", checks: ref.refs, note: why ? `Tailzu could not fix it: ${why}` : "Tailzu could not fix it.", at: this.now() };
        this.note(row, `I could not fix ${names}${why ? `: ${why}` : "."}`);
        await this.tell(c, `I could not fix the failing checks on #${row.prNumber}${why ? `: ${why}` : "."}`);
      }
      return;
    }
    if (ref.kind === "conflict") {
      const key = ref.refs[1] ?? "";
      if (sha || job.state === "done") {
        s.conflict = { key, outcome: "merged", at: this.now(), note: sha ? `Merged ${ref.refs[0] ?? "the default branch"} into the branch (${sha7(sha)}).` : "Nothing needed merging." };
        this.note(row, s.conflict.note);
      } else {
        s.conflict = { key, outcome: "failed", at: this.now(), note: `Tailzu could not clear the conflict${why ? `: ${why}` : "."} It is yours to merge.` };
        this.note(row, s.conflict.note);
        await this.tell(c, s.conflict.note);
      }
      return;
    }
    // A reviewer's ask: answered under each comment, and the thread resolved once the change is on the branch.
    const g = this.d.projects.github;
    for (const t of ref.threads ?? []) {
      const reply = sha ? `Done in ${sha7(sha)}.` : `I could not make this change${why ? `: ${why}` : "."} Nothing was pushed.`;
      await this.replyUnder(c, t, reply);
      if (sha && t.threadId) await g.resolveThread(c.repo, t.threadId).catch((err) => this.warn(err, "resolving a thread"));
    }
    this.note(row, sha ? `Made the change a reviewer asked for (${sha7(sha)}) and resolved ${ref.threads?.filter((t) => t.threadId).length ?? 0} thread(s).` : `I could not make the change a reviewer asked for${why ? `: ${why}` : "."}`);
    if (!sha) await this.tell(c, `I could not make a reviewer's change on #${row.prNumber}${why ? `: ${why}` : "."}`);
  }

  /** A reply under a reviewer's comment: in its thread, or, for a comment in the conversation, a comment that names them. Never throws. */
  private async replyUnder(c: Ctx, t: { threadId: string | null; commentId: number; author: string }, text: string): Promise<void> {
    const g = this.d.projects.github;
    try {
      if (t.threadId) await g.replyToReviewComment(c.repo, c.row.prNumber, t.commentId, text);
      else await g.createIssueComment(c.repo, c.row.prNumber, `@${t.author} ${text}`);
    } catch (err) { this.warn(err, "a reply"); }
  }

  // ------------------------------------------------------------------ CI

  private async ci(c: Ctx): Promise<void> {
    const { row, pull } = c;
    const s = row.state;
    s.head = pull.headSha;
    const prior = s.ci;
    // A fix is out for this head, or Tailzu gave up on it (three rounds, or no fix found): a webhook that comes again, or the next check to finish, changes nothing.
    // Everything else is looked at again, because checks appear and finish on a head one after another.
    if (prior && prior.head === pull.headSha && (prior.outcome === "fixing" || prior.outcome === "unfixed" || prior.outcome === "capped")) return;
    const dec = await decideCi(this.d.projects.github, c.repo, pull);
    const at = this.now();
    const was = prior?.outcome;
    switch (dec.kind) {
      case "pending":
        s.ci = { head: pull.headSha, outcome: "pending", checks: [], note: "", at };
        return;
      case "green":
        s.ci = { head: pull.headSha, outcome: "green", checks: [], note: "", at };
        if (was && was !== "green" && was !== "pending") this.note(row, `The checks pass on ${sha7(pull.headSha)}.`);
        return;
      case "blind":
        s.ci = { head: pull.headSha, outcome: "blind", checks: [], note: "", at };
        if (was !== "blind") this.note(row, "I cannot read this repository's checks: the GitHub App needs the Checks and Commit statuses read permissions.");
        return;
      case "also_red": {
        const note = `${dec.names.join(", ")} also fail${dec.names.length === 1 ? "s" : ""} on ${pull.baseRef}.`;
        s.ci = { head: pull.headSha, outcome: "also_red", checks: dec.names, note, at };
        this.note(row, `${note} I pushed nothing.`);
        return;
      }
      case "infra": {
        const note = `${dec.names.join(", ")} failed, and ${dec.why}.`;
        s.ci = { head: pull.headSha, outcome: "infra", checks: dec.names, note, at };
        this.note(row, `${note} I pushed nothing. Re-run it from GitHub if it keeps failing.`);
        return;
      }
      case "fix":
        await this.fixCi(c, dec);
        return;
    }
  }

  private async fixCi(c: Ctx, dec: Extract<CiDecision, { kind: "fix" }>): Promise<void> {
    const { row, pull } = c;
    const s = row.state;
    const at = this.now();
    if (s.jobs.some((j) => !j.done && j.kind === "ci")) { s.ci = { head: pull.headSha, outcome: "fixing", checks: dec.names, note: "", at }; return; }
    const day = dayOf(at);
    const used = row.ciRounds[day] ?? 0;
    if (used >= CI_ROUNDS_PER_DAY) {
      s.ci = { head: pull.headSha, outcome: "capped", checks: dec.names, note: `I made ${used} fix attempts today and ${dec.names.join(", ")} still fails. I have stopped; it is yours now.`, at };
      if (s.capNoted !== day) {
        s.capNoted = day;
        this.note(row, s.ci.note);
        await this.tell(c, `The checks on #${row.prNumber} still fail after ${used} automatic fixes today. I stopped trying.`);
      }
      return;
    }
    const names = dec.names.join(", ");
    const task = `The checks on pull request #${row.prNumber} are failing: ${names}. Find out why from the failing output you are shown and fix the cause in the code, changing as little as possible. `
      + "Do not skip, disable, delete or weaken any test or check, and do not change CI configuration.";
    const ref = await this.start(c, { kind: "ci", task, refs: dec.names, care: { log: dec.log }, mode: "freeform" });
    if (!ref) return;
    row.ciRounds[day] = used + 1;
    s.ci = { head: pull.headSha, outcome: "fixing", checks: dec.names, note: "", at };
    this.note(row, `${names} failing. Started fix ${used + 1} of ${CI_ROUNDS_PER_DAY} for today.`);
  }

  // ------------------------------------------------------------------ conflicts

  private async conflicts(c: Ctx): Promise<void> {
    const { row, pull } = c;
    const s = row.state;
    s.recheck = undefined;
    if (pull.mergeable === null) { s.recheck = true; return; }
    if (pull.mergeable !== false && pull.mergeableState !== "dirty") {
      if (s.conflict && s.conflict.outcome !== "fixing") s.conflict = undefined;
      return;
    }
    const g = this.d.projects.github;
    const base = pull.baseRef;
    const key = `${await g.branchHead(c.repo, base)}:${pull.headSha}`;
    if (s.conflict?.key === key) return;
    if (s.jobs.some((j) => !j.done && j.kind === "conflict")) return;
    const task = `Pull request #${row.prNumber} no longer merges cleanly into ${base}. Bring ${base} into this branch and resolve what clashes, keeping the behaviour of both sides.`;
    const ref = await this.start(c, { kind: "conflict", task, refs: [base, key], care: { base } });
    if (!ref) return;
    s.conflict = { key, outcome: "fixing", at: this.now(), note: `${base} and this branch clash. Merging ${base} in.` };
    this.note(row, s.conflict.note);
  }

  // ------------------------------------------------------------------ reviews

  /** What the job that made this pull request wrote down, for answering a question about why: its decisions and steps, in order. */
  private async workLogOf(row: CareRow): Promise<string> {
    try {
      for (const j of await this.d.jobStore.listJobs(row.userId, 60)) {
        if (j.projectId !== row.projectId || j.branch !== row.branch) continue;
        const st = stateOf(j.checkpoint);
        if (st?.care || st?.pr?.number !== row.prNumber) continue;
        const log = new WorkLog(j.id, { store: this.d.worklog ?? worklogStore() });
        const entries = await log.entries({ kinds: ["step", "decision", "finding", "edit", "question"] });
        return entries.map((e) => `[${e.kind}] ${e.text}${e.files?.length ? ` (${e.files.slice(0, 3).join(", ")})` : ""}`).join("\n");
      }
    } catch { /* no log: the model is told there is none */ }
    return "";
  }

  /** The lines of a file around a comment, numbered, as the branch has them now. */
  private async codeAround(c: Ctx, path: string, line?: number): Promise<string | undefined> {
    try {
      const f = await this.d.projects.github.readFile(c.repo, c.row.branch, path);
      const lines = f.text.split("\n");
      const at = Math.min(Math.max((line ?? 1) - 1, 0), Math.max(lines.length - 1, 0));
      const from = Math.max(0, at - 8);
      return lines.slice(from, at + 9).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
    } catch { return undefined; }
  }

  private modelCtx(userId: string): ModelCtx {
    return { ...(this.d.call ? { call: this.d.call } : {}), ...(this.d.gateway ? { gateway: this.d.gateway } : {}), userId, budget: { maxPaise: this.d.readPaise ?? 60 } };
  }

  private async reviews(c: Ctx): Promise<void> {
    const { row, pull, repo } = c;
    const g = this.d.projects.github;
    const s = row.state;
    const handled = new Set(s.handled);
    const threads = await g.reviewThreads(repo, pull).catch((err) => { this.warn(err, "reading the review threads"); return [] as ReviewThread[]; });
    const convo = await g.issueComments(repo, row.prNumber).catch(() => [] as Array<{ id: number; author: string; body: string }>);
    interface Cand { id: number; author: string; body: string; threadId: string | null; rootId: number; path?: string; line?: number }
    const cands: Cand[] = [];
    for (const t of threads) {
      if (t.resolved || !t.comments.length) continue;
      const people = t.comments.filter((x) => !isBot(x.author));
      const last = people.at(-1);
      // The newest word in the thread is Tailzu's own: the person's was answered.
      if (!last || handled.has(last.id) || isBot(t.comments.at(-1)!.author)) continue;
      cands.push({ id: last.id, author: last.author, body: last.body, threadId: t.id, rootId: t.comments[0]!.id, ...(t.path ? { path: t.path } : {}), ...(t.line ? { line: t.line } : {}) });
    }
    for (const m of convo) {
      if (isBot(m.author) || m.body.startsWith(STATUS_MARK) || handled.has(m.id)) continue;
      cands.push({ id: m.id, author: m.author, body: m.body, threadId: null, rootId: m.id });
    }
    const smalls: Array<{ cand: Cand; verdict: ReviewVerdict }> = [];
    const larger: string[] = [];
    let workLog: string | null = null;
    for (const cand of cands.slice(0, COMMENTS_PER_PASS)) {
      // Only somebody who may write to the repo can ask Tailzu for a change.
      const perm = await g.permissionOf(repo, cand.author);
      if (perm !== "write" && perm !== "admin") { handled.add(cand.id); continue; }
      workLog ??= await this.workLogOf(row);
      const code = cand.path ? await this.codeAround(c, cand.path, cand.line) : undefined;
      const verdict = await readComment(this.modelCtx(row.userId), {
        title: pull.title, author: cand.author, body: cand.body, ...(cand.path ? { path: cand.path } : {}), ...(cand.line ? { line: cand.line } : {}), ...(code ? { code } : {}), workLog,
      });
      if (!verdict) { this.note(row, "I could not read a comment just now. I will look again."); continue; }
      handled.add(cand.id);
      const under = { threadId: cand.threadId, commentId: cand.rootId, author: cand.author };
      if (verdict.kind === "small") smalls.push({ cand, verdict });
      else if (verdict.kind === "large") {
        await this.replyUnder(c, under, verdict.reply || "This is a bigger change than I make on my own. I have told the person who handed me this pull request.");
        (s.proposals ??= []).push({ commentId: cand.id, at: this.now() });
        larger.push(cand.author);
        this.note(row, `${cand.author} asked for a larger change${cand.path ? ` on ${cand.path}` : ""}. I replied with a proposal and told you.`);
      } else if (verdict.kind === "question") {
        await this.replyUnder(c, under, verdict.reply || "I could not find the reason in what I wrote down.");
        this.note(row, `Answered ${cand.author}'s question${cand.path ? ` on ${cand.path}` : ""}.`);
      }
    }
    if (smalls.length) {
      const place = (x: (typeof smalls)[number]) => (x.cand.path ? ` (${x.cand.path}${x.cand.line ? `:${x.cand.line}` : ""})` : "");
      const task = `Make ${smalls.length === 1 ? "this change" : "these changes"} a reviewer asked for on pull request #${row.prNumber}, and nothing else:\n`
        + smalls.map((x, i) => `${i + 1}. ${x.verdict.summary || "the change in the comment"}${place(x)}`).join("\n")
        + "\nDo not skip, disable or weaken any test or check.";
      const targets: Located["targets"] = smalls.filter((x) => x.cand.path).map((x) => ({ path: x.cand.path!, why: "a reviewer commented here", signals: [], score: 1 }));
      // A comment in the conversation names no file: the files this pull request changes are where it is about.
      if (!targets.length) {
        const diff = await g.compare(repo, row.branch).catch(() => null);
        for (const f of (diff?.files ?? []).filter((x) => x.status !== "removed").slice(0, 5)) targets.push({ path: f.path, why: "this pull request changes it", signals: [], score: 0.6 });
      }
      const located: Located | undefined = targets.length
        ? { targets: [...new Map(targets.map((t) => [t.path, t])).values()], related: [], tests: [], confidence: 1, used: { expanded: false, picked: false, paise: 0 } }
        : undefined;
      const first = smalls.find((x) => x.cand.path);
      const ref = await this.start(c, {
        kind: "review", task, refs: smalls.map((x) => String(x.cand.id)), ...(located ? { located } : {}),
        care: {
          comment: smalls.map((x) => `${x.cand.author}${place(x)}: ${x.cand.body}`).join("\n---\n"), threadIds: smalls.flatMap((x) => (x.cand.threadId ? [x.cand.threadId] : [])),
          ...(first?.cand.path ? { path: first.cand.path } : {}), ...(first?.cand.line ? { line: first.cand.line } : {}),
        },
        threads: smalls.map((x) => ({ threadId: x.cand.threadId, commentId: x.cand.rootId, author: x.cand.author })),
      });
      // Not started: the comments are not marked done, so the next event tries again.
      if (!ref) for (const x of smalls) handled.delete(x.cand.id);
      else this.note(row, `Working on ${smalls.length} change${smalls.length === 1 ? "" : "s"} a reviewer asked for.`);
    }
    s.handled = [...handled].slice(-HANDLED_KEEP);
    if (larger.length) await this.tell(c, `${[...new Set(larger)].join(", ")} asked for a larger change on #${row.prNumber}. I replied with a proposal; it is for you to decide.`);
  }
}
