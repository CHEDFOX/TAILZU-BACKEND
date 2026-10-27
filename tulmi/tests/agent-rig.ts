/**
 * THE AGENT LOOP'S TEST RIG (code-agent-*.test.ts): A FAKE GITHUB, A FIXTURE BRAIN, A SCRIPTED MODEL, A
 * RUNNER THAT ANSWERS FROM A SCRIPT, AND THE REAL ROUTER, POLICY, WORKSPACE AND ORCHESTRATOR AROUND THEM.
 *
 * Nothing here reaches a network, a model or a computer:
 *
 *   GitHub     tests/github-fake.ts. Alice has the App on her own account and one repo (alice/app); commits,
 *              branches and pull requests are real to it, so what the agent commits can be read back
 *   the brain  tests/work-fixtures.ts fixtureBrain: the real BrainHandle over rows chosen to match the repo
 *   the model  `scriptedModel()`: answers JSON questions by purpose (the work core's fakeCall) and the
 *              agent's own turns from a queue of tool calls. It charges the job like the gateway does: a
 *              turn whose worst case would pass the budget throws BudgetExceeded before it is made
 *   the runner `ScriptRunner`, a ComputeProvider the real router dispatches to and which answers from rules:
 *              a wrapped check (checks.ts) gets a marker line per kind with the exit code a test chose, any
 *              other command gets `commandResult`. It answers through the router's own submitResult, with the
 *              epoch it was given, as GitHub's free computers do
 *   the agent  the real orchestrator (createAgent) with the real routerRunner over the real JobRouter
 *
 * One clock, `fake.clock.t`, is everyone's; the runner's sleep moves it.
 */
import { resetClassifierCacheForTests } from "../src/code/brain/classify.js";
import { BudgetExceeded, type CallInput, type CallResult } from "../src/code/brain/gateway.js";
import { createAgent } from "../src/code/agent/index.js";
import type { RemoteJobs } from "../src/code/agent/orchestrator.js";
import type { LiveDeps } from "../src/code/live/ports.js";
import type { DesignDeps } from "../src/code/agent/deps.js";
import { CHECK_MARK } from "../src/code/agent/checks.js";
import { routerRunner } from "../src/code/agent/runner.js";
import type { ContextStrategy } from "../src/code/agent/mask.js";
import { initialState, stateOf, type AgentState } from "../src/code/agent/types.js";
import { createCode } from "../src/code/index.js";
import { createJobs } from "../src/code/jobs/index.js";
import type { JobRouter } from "../src/code/jobs/router.js";
import { MemoryJobStore } from "../src/code/jobs/store.js";
import type { ComputeProvider, Availability, AvailabilityCtx } from "../src/code/jobs/providers.js";
import type { CodeJob, JobStep, NotifyData, NotifyKind, OverlayFile } from "../src/code/jobs/types.js";
import { MemoryIntakeStore } from "../src/code/newproject/index.js";
import { MemoryProjectBrainStore } from "../src/code/project/store.js";
import { addProject, createWorkBranch, initEmptyRepo, type ProjectDeps } from "../src/code/projects.js";
import { MemoryRouteStatsStore } from "../src/code/brain/stats.js";
import { addJobSpend } from "../src/code/brain/spend.js";
import { MemoryCodeStore } from "../src/code/store.js";
import { MemoryWorklogStore } from "../src/code/work/index.js";
import { appKeys, FakeGithub } from "./github-fake.js";
import { fakeCall, fixtureBrain, sym, type FakeCall, type FileSpec } from "./work-fixtures.js";

export const KEYS = appKeys();

/** A secret-looking value built at runtime, so this file holds none whole (GitHub's push protection reads the source). */
export const FAKE_STRIPE = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");

export const APP_FILES: Record<string, string> = {
  "README.md": "# app\n\nA small app.\n",
  "package.json": JSON.stringify({ name: "app", scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } }, null, 2),
  "src/util.ts": 'export function slug(s: string): string {\n  return s.toLowerCase().replace(/\\s+/g, "-");\n}\n',
  "src/util.test.ts": 'import { expect, test } from "vitest";\nimport { slug } from "./util";\n\ntest("slug", () => {\n  expect(slug("Hello World")).toBe("hello-world");\n});\n',
  "src/index.ts": 'import { slug } from "./util";\n\nexport const title = slug("My App");\n',
  "src/legacy.ts": "export const OLD = 1;\n",
};

const APP_ROWS: FileSpec[] = [
  { path: "README.md", lang: "Markdown", summary: "What the app is." },
  { path: "src/util.ts", symbols: [sym("slug")], tests: ["src/util.test.ts"], summary: "String helpers: slug turns a title into a URL slug.", rank: 0.8 },
  { path: "src/util.test.ts", summary: "Tests for the string helpers." },
  { path: "src/index.ts", imports: ["src/util.ts"], symbols: [sym("title", "const")], summary: "The app's entry point." },
  { path: "src/legacy.ts", symbols: [sym("OLD", "const")], summary: "Old constants." },
];

export const APP_FEATURES = [
  { name: "Slugs", summary: "Turning a title into a URL slug.", files: ["src/util.ts"], fileCount: 1, routes: [], texts: [] },
  { name: "App entry", summary: "The app's entry point.", files: ["src/index.ts"], fileCount: 1, routes: [], texts: [] },
  { name: "Legacy constants", summary: "Old constants nobody uses.", files: ["src/legacy.ts"], fileCount: 1, routes: [], texts: [] },
];

export const APP_STRUCTURE = {
  languages: [{ lang: "TypeScript", bytes: 900, files: 4, pct: 100 }],
  packageManagers: ["npm"],
  testing: { frameworks: ["vitest"], testFiles: 1, untestedHot: [] as string[] },
  commands: [
    { kind: "install" as const, cmd: "npm install", cwd: "", source: "package.json" },
    { kind: "typecheck" as const, cmd: "npm run typecheck", cwd: "", source: "package.json" },
    { kind: "lint" as const, cmd: "npm run lint", cwd: "", source: "package.json" },
    { kind: "test" as const, cmd: "npm test", cwd: "", source: "package.json" },
  ],
};

// -------------------------------------------------------------- the runner

export interface RunRecord { jobId: string; stepIdx: number; commands: string[]; overlay: OverlayFile[]; discard: boolean; wrapped: boolean }
export type CheckAnswer = { exit: number; text?: string };

/** Where steps run, in a test: it answers each from a script, through the router's own submitResult. */
export class ScriptRunner implements ComputeProvider {
  readonly kind = "github" as const;
  router!: JobRouter;
  open = true;
  /** Do not answer: a step that never reports, until `release()`. */
  hold = false;
  runs: RunRecord[] = [];
  private held: Array<() => Promise<void>> = [];
  /** What a wrapped check of this kind says; passing by default. `run` is the record of the step it is in. */
  checkResult: (kind: string, run: RunRecord) => CheckAnswer = () => ({ exit: 0, text: "ok" });
  /** What any other command says. */
  commandResult: (command: string, run: RunRecord) => { exit: number; out: string } = () => ({ exit: 0, out: "ok" });
  /** Files a step hands back as its changes (the scaffold). */
  changesFor: (run: RunRecord) => Array<{ path: string; content: string | null }> | undefined = () => undefined;
  private n = 0;

  async available(_ctx: AvailabilityCtx): Promise<Availability> { return { ok: this.open, places: this.open ? 1 : 0 }; }

  async dispatch(job: CodeJob, step: JobStep): Promise<{ holder: string }> {
    const run: RunRecord = {
      jobId: job.id, stepIdx: step.idx, commands: [...step.commands], overlay: step.overlay.map((f) => ({ ...f })), discard: step.discard,
      wrapped: step.commands.some((c) => c.includes(CHECK_MARK)),
    };
    this.runs.push(run);
    const epoch = job.leaseEpoch;
    const userId = job.userId;
    // After the router has finished dispatching: it holds the person's lock until then.
    if (!this.hold) setImmediate(() => void this.answer(userId, run, epoch).catch(() => undefined));
    else this.held.push(() => this.answer(userId, run, epoch));
    return { holder: `script-run-${(this.n += 1)}` };
  }

  /** Answers the steps that were held back. */
  async release(): Promise<void> {
    const list = this.held.splice(0);
    this.hold = false;
    for (const f of list) await f();
  }

  async cancel(): Promise<void> {}

  private async answer(userId: string, run: RunRecord, epoch: number): Promise<void> {
    const outs: string[] = [];
    let exit = 0;
    for (const c of run.commands) {
      const m = new RegExp(`${CHECK_MARK} kind=(\\w+)`).exec(c);
      if (m) {
        const r = this.checkResult(m[1]!, run);
        outs.push(`${r.text ?? ""}\n${CHECK_MARK} kind=${m[1]} exit=${r.exit} secs=3`);
      } else {
        const r = this.commandResult(c, run);
        outs.push(`$ ${c}\n${r.out}`);
        if (r.exit !== 0) { exit = r.exit; break; }
      }
    }
    const changes = exit === 0 ? this.changesFor(run) : undefined;
    await this.router.submitResult(userId, {
      jobId: run.jobId, stepIdx: run.stepIdx, epoch, exitCode: exit, outputTail: outs.join("\n"), minutes: 1, ...(changes ? { changes } : {}),
    }, "github");
  }
}

/** A wrapped check's output as the runner prints it. */
export const checkLine = (kind: string, exit: number, secs = 3): string => `${CHECK_MARK} kind=${kind} exit=${exit} secs=${secs}`;

// --------------------------------------------------------------- the model

export interface Turn {
  text?: string;
  calls: Array<{ name: string; args: Record<string, unknown> | string }>;
}

export interface SeenTurn { input: CallInput<unknown>; messages: string; system: string; user: string; tier: string | undefined; tools: string[] }

/**
 * The model: JSON questions answered by purpose (`json.on(purpose, answer)`, the work core's fakeCall), and the agent's
 * own turns (`agent.work`) taken from a queue. A call is charged to the job as the gateway charges it.
 */
export function scriptedModel(jobStore: MemoryJobStore) {
  const json = fakeCall();
  const queue: Array<Turn | ((input: CallInput<unknown>) => Turn)> = [];
  const m = {
    json,
    queue,
    seen: [] as SeenTurn[],
    /** Paise a call costs, and the worst case the guard assumes. */
    paise: 4,
    need: 10,
    /** Turn ids are unique across the whole script, which is how a model's are. */
    n: 0,
    /** Before a work turn takes its answer from the script (a server that dies, a model that is slow): called with the turn number. A throw ends the call. */
    beforeTurn: undefined as undefined | ((turn: number) => void | Promise<void>),
    /** After the turn has taken its answer, before it is returned. */
    afterTurn: undefined as undefined | ((turn: number) => void | Promise<void>),
    turns: 0,
    /** The turns left in the script. */
    get left(): number { return queue.length; },
    push(...t: Array<Turn | ((input: CallInput<unknown>) => Turn)>) { queue.push(...t); return m; },
    call: (async <T>(input: CallInput<T>): Promise<CallResult<T>> => {
      // Like the gateway: the job's budget is checked before the call, and what it cost is added after.
      let userId = input.userId;
      if (input.jobId) {
        const job = await jobStore.getJobById(input.jobId);
        if (!job) throw new Error("no such job");
        userId ??= job.userId;
        if (job.spentPaise + m.need > job.budgetPaise) {
          throw new BudgetExceeded({ needPaise: m.need, spentPaise: job.spentPaise, budgetPaise: job.budgetPaise, scope: "job", purpose: input.purpose, ...(input.tier ? { tier: input.tier } : {}) });
        }
      }
      let result: CallResult<T>;
      if (input.purpose === "agent.work") {
        const messages = input.messages.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content)));
        m.seen.push({
          input: input as CallInput<unknown>, messages: messages.join("\n---\n"), system: messages[0] ?? "", user: messages[1] ?? "", tier: input.tier,
          tools: (input.tools ?? []).map((t) => t.name),
        });
        m.turns += 1;
        await m.beforeTurn?.(m.turns);
        const next = queue.shift();
        if (!next) throw new Error("the model's script ran out");
        const turn = typeof next === "function" ? next(input as CallInput<unknown>) : next;
        await m.afterTurn?.(m.turns);
        const toolCalls = turn.calls.map((c) => ({ id: `call_${(m.n += 1)}`, name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) }));
        result = {
          text: turn.text ?? "", json: undefined, toolCalls, model: `fake/${input.tier ?? "code"}`, ...(input.tier ? { tier: input.tier } : {}), promptTokens: 100, completionTokens: 50,
          costUsd: 0.0001, paise: m.paise, costSource: "reported", truncated: false, ms: 1, calls: 1, trail: [],
        } as CallResult<T>;
      } else {
        result = await json.call<T>(input);
      }
      if (input.jobId) await addJobSpend(jobStore, input.jobId, result.paise);
      return result;
    }) as <T>(input: CallInput<T>) => Promise<CallResult<T>>,
  };
  return m;
}
export type ScriptedModel = ReturnType<typeof scriptedModel>;

/** A turn of the model with one call. */
export const call = (name: string, args: Record<string, unknown> | string = {}, text?: string): Turn => ({ ...(text ? { text } : {}), calls: [{ name, args }] });
/** A turn that ends the work. */
export const done = (summary = "Did the thing."): Turn => call("done", { summary });

// ------------------------------------------------------------------ the rig

export interface AgentRigOptions {
  files?: Record<string, string>;
  /** The repo has no commits (an empty repo that is given its first README before the job). */
  empty?: boolean;
  /** Rows the fixture brain holds. Defaults to the ones that match APP_FILES. */
  rows?: FileSpec[];
  features?: typeof APP_FEATURES;
  structure?: Partial<typeof APP_STRUCTURE> & Record<string, unknown>;
  /** Standing permission to mark pull requests ready (the default: yes, as a person who has said "always" would have). */
  readyGrant?: boolean;
  concurrency?: number;
  /** A run waits this long for a place before it is given up on. */
  placeWaitMs?: number;
  /** The model's price per call, in paise. */
  paise?: number;
  /** The live session's ports (code/live/ports.ts): a room's files, the inbox, progress, closeSession, endJob, the preview. */
  live?: LiveDeps;
  /** The design round's compare step and links (code/agent/design.ts). */
  design?: DesignDeps;
  /** What becomes of a tool result once it is older than the last six (agent/mask.ts). Absent: the agent's default. */
  contextStrategy?: ContextStrategy;
  /** What the GitHub App was given on the install (Contents, Pull requests and Metadata unless said otherwise): PR care needs Checks, Commit statuses and Actions (read) as well. */
  installPermissions?: Record<string, string>;
}

export async function agentRig(o: AgentRigOptions = {}) {
  // The classifier remembers a request for ten minutes, across tests too: each rig starts it empty.
  resetClassifierCacheForTests();
  const fake = new FakeGithub(KEYS);
  const now = () => fake.clock.t;
  fake.addInstall(101, "alice", o.installPermissions ? { permissions: o.installPermissions } : {});
  const repo = fake.addRepo(101, "alice/app", { ...(o.empty ? { empty: true } : { files: o.files ?? APP_FILES }) });
  const store = new MemoryCodeStore(now);
  await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 77, githubLogin: "alice" });
  const code = createCode({
    store, app: { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem }, oauth: null, oauthEnabled: false,
    webhookSecret: "whsec_" + "k".repeat(40), fetchFn: fake.fetchFn, now, brain: false,
  });
  const d: ProjectDeps = { store: code.store, github: code.github!, approvals: code.approvals, oauth: code.oauth };
  const jobStore = new MemoryJobStore(now);
  const runner = new ScriptRunner();
  const told: Array<{ userId: string; kind: NotifyKind; data: NotifyData }> = [];
  const notify = (userId: string, kind: NotifyKind, data: NotifyData) => { told.push({ userId, kind, data }); };
  const jobs = createJobs({ code, store: jobStore, github: runner, now, notify })!;
  runner.router = jobs;

  const project = (await addProject(d, "alice", repo.id)).project;
  if (o.empty) {
    // A repo with no commits gets its first README (it asks, and the person says yes) before a work branch can be made.
    const asked = await initEmptyRepo(d, "alice", project.id, "app", { attended: true });
    if ("needsApproval" in asked) await initEmptyRepo(d, "alice", project.id, "app", { attended: true, approvalId: asked.approvalId });
  }
  if (o.readyGrant !== false) await store.addGrant(project.id, { action: "pr.ready", effect: "allow", branchPattern: "tailzu/*" });

  const model = scriptedModel(jobStore);
  if (o.paise !== undefined) model.paise = o.paise;
  // The tiny tier, asked when the rules are not sure what a request is: a feature, unless a test says otherwise.
  model.json.on("classify", { type: "feature", difficulty: "medium", risk: "low", needs: { web: false, exec: true, vision: false, indic: false }, language: "en", confidence: 0.9, signals: [] });
  const files = o.rows ?? APP_ROWS;
  const fixture = await fixtureBrain({
    files, features: o.features ?? APP_FEATURES, structure: { fileCount: files.length, analysedCount: files.length, ...(o.structure ?? APP_STRUCTURE) } as never,
  });
  const brain = {
    ensureFresh: async () => ({ fresh: true }),
    open: async () => fixture.brain,
    recordBaseline: async (_projectId: string, headSha: string, results: Parameters<typeof import("../src/code/project/baseline.js").recordBaseline>[2]) => {
      const { recordBaseline } = await import("../src/code/project/baseline.js");
      return recordBaseline(fixture.projectId, headSha, results, { store: fixture.store as MemoryProjectBrainStore, now });
    },
  };
  const worklog = new MemoryWorklogStore();
  const intake = new MemoryIntakeStore(now);
  const routeStats = new MemoryRouteStatsStore(now);
  /** The runner's wait for a step: the clock moves with it, and the event loop turns, so a script that answers on the next turn has done so. */
  const sleep = async (ms: number) => { fake.clock.t += ms; await new Promise<void>((r) => setImmediate(r)); };
  /** The web, as the agent's read_page sees it: a page's HTML by address (anything else is a 404). */
  const pages: Record<string, string> = {};
  const webFetch = async (input: string | URL | Request): Promise<Response> => {
    const p = pages[String(input).replace(/#.*$/, "")];
    return p === undefined ? new Response("not found", { status: 404 }) : new Response(p, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const logLines: Array<{ o: object; m: string }> = [];
  const log = { info: (x: object, m: string) => { logLines.push({ o: x, m }); }, warn: (x: object, m: string) => { logLines.push({ o: x, m }); } };

  /** An orchestrator over these stores. A second one is another server. */
  function orchestrator(over: { instanceId?: string; concurrency?: number; live?: LiveDeps; remote?: RemoteJobs } = {}) {
    return createAgent({
      code, jobs, store: jobStore, brain, call: model.call as never, worklog, intake, routeStats, notify, now, sleep, log, web: { store: null, cache: null, fetchFn: webFetch as never },
      runner: routerRunner({ jobs, store: jobStore, now, sleep, placeWaitMs: o.placeWaitMs ?? 120_000, pollMs: 2000 }),
      concurrency: over.concurrency ?? o.concurrency ?? 4, instanceId: over.instanceId ?? "one",
      ...((over.live ?? o.live) ? { live: (over.live ?? o.live)! } : {}), ...(over.remote ? { remote: over.remote } : {}), ...(o.design ? { design: o.design } : {}),
      ...(o.contextStrategy ? { contextStrategy: o.contextStrategy } : {}),
    })!;
  }
  const orch = orchestrator();

  /** A work branch for a task, and an agent job on it, enqueued. */
  async function start(task: string, over: { budgetPaise?: number | undefined; enqueue?: boolean } = {}) {
    const { branch } = await createWorkBranch(d, "alice", project.id, task);
    const job = await jobs.createJob("alice", project.id, branch, task, "budgetPaise" in over ? over.budgetPaise : undefined, { agent: true });
    if (over.enqueue !== false) await orch.enqueue(job.id, task);
    return { job, branch };
  }

  const jobNow = async (id: string): Promise<CodeJob> => (await jobStore.getJobById(id))!;
  const stateNow = async (id: string): Promise<AgentState> => stateOf((await jobNow(id)).checkpoint)!;
  const toldOf = (kind: NotifyKind) => told.filter((t) => t.kind === kind);

  return {
    fake, now, store, code, d, jobStore, jobs, runner, model, fixture, brain, worklog, intake, routeStats, orch, orchestrator, repo, project, told, toldOf, start, jobNow, stateNow, sleep, pages,
    log, logLines, json: model.json as FakeCall, initialState,
  };
}

export type AgentRig = Awaited<ReturnType<typeof agentRig>>;

/** The default plan for the util task: one step, one file. */
export const UTIL_PLAN = {
  steps: [{ do: "Make slug() trim dashes from both ends", files: [{ path: "src/util.ts", action: "edit" as const }] }], notes: [] as string[],
};
/** The request the happy path uses: it names the file and the function, so locating needs no model. */
export const UTIL_TASK = "In src/util.ts make slug() trim leading and trailing dashes";
export const UTIL_EDIT = {
  path: "src/util.ts",
  old: '  return s.toLowerCase().replace(/\\s+/g, "-");\n',
  new: '  return s.toLowerCase().replace(/\\s+/g, "-").replace(/^-+|-+$/g, "");\n',
};
