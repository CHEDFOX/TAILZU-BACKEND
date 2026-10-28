/**
 * THE RIG: THE CODE BOT'S REAL FLOW, WIRED OVER LocalGitHub, LocalRunner AND A CHOSEN MODEL DOOR.
 *
 * Everything between the person's request and the report is the product's own code: createCode (GitHub client, policy, approvals), the project brain
 * built from a real repo's tarball, createJobs (the job router, leases, epochs), createAgent (the orchestrator and the loop), the work core (locate,
 * plan, work log), the run ledger. What is local is what is outside: GitHub (adapters/localGithub.ts), the computer that runs steps
 * (adapters/localRunner.ts), the job's copy of the code (adapters/localRoom.ts), the web (a map of pages) and the model (adapters/models.ts).
 *
 * One rig is one Tailzu server with one person (alice) and as many projects as tasks put on it. A second `orchestrator()` over the same stores is
 * another server, which is how the crash-and-resume scenario works.
 */
import "../env.js";
import { createAgent } from "../../src/code/agent/index.js";
import type { AgentOrchestrator, RemoteJobs } from "../../src/code/agent/orchestrator.js";
import { routerRunner } from "../../src/code/agent/runner.js";
import { initialState, stateOf, type AgentState } from "../../src/code/agent/types.js";
import { resetClassifierCacheForTests } from "../../src/code/brain/classify.js";
import { MemoryRouteStatsStore } from "../../src/code/brain/stats.js";
import type { ChatClient } from "../../src/code/brain/gateway.js";
import type { ModelTier, TierSettings } from "../../src/code/brain/tiers.js";
import { createCode } from "../../src/code/index.js";
import { createJobs } from "../../src/code/jobs/index.js";
import { MemoryJobStore } from "../../src/code/jobs/store.js";
import type { CodeJob, NotifyData, NotifyKind } from "../../src/code/jobs/types.js";
import { MemoryInbox, type LiveDeps } from "../../src/code/live/ports.js";
import type { ViewerEvent } from "../../src/code/live/protocol.js";
import { MemoryIntakeStore } from "../../src/code/newproject/index.js";
import { MemoryProjectBrainStore, buildProjectBrain } from "../../src/code/project/index.js";
import { addProject, createWorkBranch, initEmptyRepo, type ProjectDeps } from "../../src/code/projects.js";
import type { CodeProject } from "../../src/code/store.js";
import { MemoryCodeStore } from "../../src/code/store.js";
import { MemoryWorklogStore, WorkLog } from "../../src/code/work/index.js";
import { appKeys, type AppKeys } from "../../tests/github-fake.js";
import { cloneObjects, getRepo, type RepoSpec } from "../repos.js";
import type { Task } from "../tasks/schema.js";
import { fakeSecret } from "../util.js";
import { LocalGitHub, type LocalRepo } from "./localGithub.js";
import { LocalRoom } from "./localRoom.js";
import { LocalRunner, type LocalRunnerOptions, type RunTarget } from "./localRunner.js";
import { CassetteClient, type CassetteMode, type CassetteStore, type SpendGuard } from "./cassette.js";
import { realKit, scriptedKit, scriptedWire, type ModelKit, type ModelMode, type ScriptedBrain } from "./models.js";
import { openRouterClient } from "./upstream.js";
import type { Persona } from "./personas.js";

let KEYS: AppKeys | null = null;
const keys = (): AppKeys => (KEYS ??= appKeys());

export const USER = "alice";

/** Cassettes for a rig's model calls (adapters/cassette.ts): the store, whether to record or replay, and the run's label. */
export interface CassetteSetup {
  store: CassetteStore;
  mode: CassetteMode;
  guard?: SpendGuard;
  loose?: boolean;
  /** The real model, to record from (OpenRouter's, when left out). A scripted model's own client is used for oracle and fake. */
  upstream?: ChatClient;
}

export interface RigOptions {
  /** The most any model call may write (the smoke suite's 800), whatever the caller asks for. */
  maxTokensCap?: number;
  /** Oracle and fake: answer through the real gateway, over a scripted OpenAI-shaped client, instead of in place of it. Implied by `cassette`. */
  wire?: boolean;
  cassette?: CassetteSetup & { run?: string };
  mode: ModelMode;
  persona?: Persona;
  /** The tier table real calls use (the bake-off's candidates); the product's own when absent. */
  tiers?: Record<ModelTier, TierSettings>;
  /** A fake OpenRouter (the load test), instead of the real one. */
  client?: ChatClient;
  breakers?: Parameters<typeof realKit>[0]["breakers"];
  /** Jobs one server drives at once. */
  concurrency?: number;
  /** How long a claim lasts: short, so a crash is recovered in seconds. */
  leaseMs?: number;
  /** What the cheap model may spend summarising a repo when a project is added, in paise. Zero: the brain is built without model words. */
  brainBudgetPaise?: number;
  /** The job's copy of the code (instant read/grep). */
  room?: boolean;
  stub?: LocalRunnerOptions["stub"];
  runnerParallel?: number;
  /** A run waits this long for a place, ms. */
  placeWaitMs?: number;
  pollMs?: number;
  latencyMs?: number | ((purpose: string) => number);
  prices?: { work?: number; json?: number };
  /** Seconds-long fake latency on every GitHub call (the load test). */
  githubLatencyMs?: number;
  log?: (s: string) => void;
}

export interface ProjectHandle {
  repo: LocalRepo;
  spec: RepoSpec | undefined;
  project: CodeProject;
  /** The default branch's head when the task started. */
  baseSha: string;
  /** The fake secrets planted for the task, as built at run time. */
  secrets: string[];
  /** The text of the files the oracle patch changes, at the base. */
  baseTexts: Record<string, string>;
}

export interface Notice { userId: string; kind: NotifyKind; data: NotifyData; at: number }

const hermeticFetch = (async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

/**
 * The model door of a rig, or of anything that needs a model without a rig (the smoke items): the real gateway over OpenRouter, over a scripted model that
 * speaks the wire, or the CallFn-level scripted kit, with cassettes in front when asked.
 */
export function makeModelKit(o: Pick<RigOptions, "mode" | "persona" | "tiers" | "wire" | "cassette" | "prices" | "latencyMs" | "client" | "breakers" | "maxTokensCap">, jobStore: MemoryJobStore, sleep?: (ms: number) => Promise<void>): { kit: ModelKit; cassette: CassetteClient | null } {
  let cassette: CassetteClient | null = null;
  let kit: ModelKit;
  if (o.mode === "real" || o.wire || o.cassette) {
    // The real gateway over a client: OpenRouter's, a fake one, or a scripted model that speaks the wire; with a cassette in front of it when asked.
    let client: ChatClient | undefined = o.client;
    let brain: ScriptedBrain | null = null;
    if (o.mode !== "real") {
      const sw = scriptedWire({ ...(o.persona ? { persona: o.persona } : {}), ...(o.prices ? { prices: o.prices } : {}), ...(typeof o.latencyMs === "number" ? { latencyMs: o.latencyMs } : {}) });
      client = sw.client;
      brain = sw.brain;
    }
    if (o.cassette) {
      const { run, ...setup } = o.cassette;
      const upstream = setup.mode === "replay" ? undefined : setup.upstream ?? client ?? openRouterClient();
      cassette = new CassetteClient({ ...setup, ...(upstream ? { upstream } : {}), ...(run ? { run } : {}) });
      client = cassette;
    }
    // A strict replay is never about a provider's health: a request the recording lacks is a failed call, and eight of them (a stale item) would open the circuit breaker
    // of the provider (its vendor prefix) for everything replayed after it in the process, answering from neither the cassette nor the model. No breakers in a replay.
    kit = realKit({ jobs: jobStore, ...(o.tiers ? { tiers: o.tiers } : {}), ...(client ? { client } : {}), ...(o.breakers !== undefined ? { breakers: o.breakers } : o.cassette?.mode === "replay" ? { breakers: null } : {}), ...(sleep ? { sleep } : {}), ...(o.maxTokensCap ? { maxTokensCap: o.maxTokensCap } : {}) });
    kit.mode = o.mode;
    if (brain) { kit.persona = brain.persona; kit.bind = (t, b) => brain!.bind(t, b); kit.prices = brain.prices; }
  } else {
    kit = scriptedKit({ mode: o.mode, jobs: jobStore, ...(o.persona ? { persona: o.persona } : {}), ...(o.prices ? { prices: o.prices } : {}), ...(o.latencyMs !== undefined ? { latencyMs: o.latencyMs } : {}) });
  }
  return { kit, cassette };
}

export async function createRig(o: RigOptions) {
  resetClassifierCacheForTests();
  const now = () => Date.now();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const gh = new LocalGitHub({ keys: keys() });
  if (o.githubLatencyMs) gh.latencyMs = o.githubLatencyMs;
  gh.addInstall(101, USER);
  const store = new MemoryCodeStore(now);
  await store.upsertInstallation(USER, { installationId: 101, accountLogin: USER, accountType: "User", repositorySelection: "selected", githubUserId: 77, githubLogin: USER });

  const jobStore = new MemoryJobStore(now);
  const { kit, cassette } = makeModelKit(o, jobStore, sleep);

  const brainStore = new MemoryProjectBrainStore();
  const brainBudget = o.brainBudgetPaise ?? 0;
  const code = createCode({
    store, app: { slug: "tailzu-e2e", clientId: gh.appClientId, clientSecret: gh.clientSecret, privateKey: gh.keys.privateKeyPem }, oauth: null, oauthEnabled: false,
    webhookSecret: `whsec_${"k".repeat(40)}`, fetchFn: gh.fetchFn, now,
    brain: { store: brainStore, call: kit.call, ...(kit.gateway ? { gateway: kit.gateway } : {}), budgetPaise: brainBudget, fetchFn: hermeticFetch, now },
  });
  const d: ProjectDeps = { store: code.store, github: code.github!, approvals: code.approvals, oauth: code.oauth };

  const targets = new Map<string, RunTarget>();
  const runner = new LocalRunner({
    resolve: (job) => targets.get(job.projectId) ?? null, parallel: o.runnerParallel ?? 3, ...(o.stub ? { stub: o.stub } : {}), ...(o.log ? { log: o.log } : {}),
  });
  const told: Notice[] = [];
  const notify = (userId: string, kind: NotifyKind, data: NotifyData) => { told.push({ userId, kind, data, at: now() }); };
  const jobs = createJobs({ code, store: jobStore, github: runner, now, notify })!;
  runner.router = jobs;

  const worklog = new MemoryWorklogStore();
  const intake = new MemoryIntakeStore(now);
  const routeStats = new MemoryRouteStatsStore(now);
  const pages: Record<string, string> = {};
  const webFetch = async (input: string | URL | Request): Promise<Response> => {
    const p = pages[String(input).replace(/#.*$/, "")];
    return p === undefined ? new Response("not found", { status: 404 }) : new Response(p, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const events: Array<{ jobId: string; at: number; ev: ViewerEvent }> = [];
  const log = { info: (_o: object, _m: string) => undefined, warn: (x: object, m: string) => { o.log?.(`warn ${m} ${JSON.stringify(x).slice(0, 200)}`); } };
  const inbox = new MemoryInbox();
  const rooms = new Map<string, LocalRoom>();

  const live: LiveDeps = {
    inbox,
    progress: (jobId, ev) => { events.push({ jobId, at: now(), ev }); },
    ...(o.room === false ? {} : {
      files: (job) => {
        const t = targets.get(job.projectId);
        if (!t) return null;
        let r = rooms.get(job.id);
        if (!r) { r = new LocalRoom(t.repo, job.branch); rooms.set(job.id, r); }
        return r;
      },
    }),
    closeSession: async () => undefined,
    endJob: async (jobId) => { rooms.delete(jobId); },
  };

  function orchestrator(over: { instanceId?: string; concurrency?: number; remote?: RemoteJobs } = {}): AgentOrchestrator {
    return createAgent({
      code, jobs, store: jobStore, call: kit.call, ...(kit.gateway ? { gateway: kit.gateway } : {}), worklog, intake, routeStats, notify, now, sleep, log,
      web: { store: null, cache: null, fetchFn: webFetch as never }, fetchFn: hermeticFetch as never,
      runner: routerRunner({ jobs, store: jobStore, now, sleep, placeWaitMs: o.placeWaitMs ?? 120_000, pollMs: o.pollMs ?? 150 }),
      concurrency: over.concurrency ?? o.concurrency ?? 4, instanceId: over.instanceId ?? "one", ...(o.leaseMs ? { leaseMs: o.leaseMs } : {}),
      live, ...(over.remote ? { remote: over.remote } : {}),
      // The product asks once for a focused test of a source fix before the checks run (CODE_PROVE_FIX, on by default). A scripted persona (the oracle, a failing one) plays
      // "edit, done" and has no test to write, so it runs without the round; a real model gets the product as it ships.
      ...(o.mode !== "real" ? { proveFix: false } : {}),
    })!;
  }
  const orch = orchestrator();

  /** Puts a task's project on the server: the repo, planted files, the project, its brain. */
  async function addProjectFor(task: Task, nameOverride?: string): Promise<ProjectHandle> {
    const short = (nameOverride ?? task.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40);
    const fullName = `${USER}/${short}`;
    let spec: RepoSpec | undefined;
    let repo: LocalRepo;
    if (task.repo !== "synthetic") {
      spec = getRepo(task.repo);
      const { objects, shallow } = cloneObjects(spec);
      repo = await gh.addRepo({ fullName, from: { objects, shallow, commit: task.base.commit ?? spec.pin, ...(spec.workdir ? { subdir: spec.workdir } : {}) }, ...(task.base.message ? { message: task.base.message } : {}) });
    } else if (task.base.empty) {
      repo = await gh.addRepo({ fullName, empty: true });
    } else {
      repo = await gh.addRepo({ fullName, files: task.base.files ?? { "README.md": "# project\n" } });
    }
    const secrets = (task.checks.secrets ?? []).map((s) => fakeSecret(s.kind, s.salt));
    if (task.base.planted && Object.keys(task.base.planted).length) {
      const planted: Record<string, string | null> = {};
      for (const [p, text] of Object.entries(task.base.planted)) planted[p] = text === null ? null : text.replace(/\{\{SECRET:(\d+)\}\}/g, (_m, i) => secrets[Number(i)] ?? "");
      await repo.push(repo.defaultBranch, planted, "Add project notes");
    }
    const { project } = await addProject(d, USER, repo.id);
    if (task.base.empty) {
      const asked = await initEmptyRepo(d, USER, project.id, "app", { attended: true });
      if ("needsApproval" in asked) await initEmptyRepo(d, USER, project.id, "app", { attended: true, approvalId: asked.approvalId });
    } else {
      await buildProjectBrain(code.brain!.runtime, USER, project.id);
    }
    await store.addGrant(project.id, { action: "pr.ready", effect: "allow", branchPattern: "tailzu/*" });
    targets.set(project.id, { repo, spec });
    const baseSha = (await repo.head(repo.defaultBranch)) ?? "";
    const baseTexts: Record<string, string> = {};
    if (baseSha) for (const p of Object.keys(task.oracle.files ?? {})) { const t = await repo.fileAt(baseSha, p); if (t !== null) baseTexts[p] = t; }
    return { repo, spec, project, baseSha, secrets, baseTexts };
  }

  /** A work branch for the request and an agent job on it, enqueued. */
  async function start(h: ProjectHandle, request: string, over: { budgetPaise?: number; enqueue?: boolean } = {}) {
    const { branch } = await createWorkBranch(d, USER, h.project.id, request);
    const job = await jobs.createJob(USER, h.project.id, branch, request, over.budgetPaise, { agent: true });
    if (over.enqueue !== false) await orch.enqueue(job.id, request);
    return { job, branch };
  }

  const jobNow = async (id: string): Promise<CodeJob> => (await jobStore.getJobById(id))!;
  const stateNow = async (id: string): Promise<AgentState | null> => stateOf((await jobNow(id)).checkpoint) ?? null;
  const workLogOf = (jobId: string) => new WorkLog(jobId, { store: worklog }).entries();

  async function dispose(): Promise<void> {
    await orch.stop().catch(() => undefined);
    runner.dispose();
    gh.dispose();
  }

  return {
    cassette, mode: o.mode, opts: o, gh, store, code, d, jobStore, jobs, runner, kit, orch, orchestrator, worklog, intake, routeStats, pages, events, told, inbox, rooms, targets,
    addProjectFor, start, jobNow, stateNow, workLogOf, dispose, initialState, now, sleep, log,
  };
}

export type Rig = Awaited<ReturnType<typeof createRig>>;
