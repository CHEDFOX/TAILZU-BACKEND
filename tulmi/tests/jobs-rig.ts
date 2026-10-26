/**
 * The rig the job router's tests stand on (code-jobs*.test.ts).
 *
 * Alice has the Tailzu App installed on her own account, one repo (alice/app)
 * as a project, and a work branch Tailzu made for a task, all against the fake
 * GitHub (github-fake.ts), with in-memory stores and ONE clock that the fake
 * GitHub, the stores, the router and the device book all read, so a test moves
 * time by moving `fake.clock.t` (`advance`). The router has a fake for GitHub's
 * free computers and one for paid compute (jobs-fakes.ts), which a test can
 * leave out, and a notifier that writes down what the person would be told.
 *
 * Import it after the test file's environment is set (it loads src/).
 */
import { FakeGithub, appKeys } from "./github-fake.js";
import { createCode } from "../src/code/index.js";
import { createJobs } from "../src/code/jobs/index.js";
import { MemoryJobStore } from "../src/code/jobs/store.js";
import type { JobRouter } from "../src/code/jobs/router.js";
import type { NotifyData, NotifyKind } from "../src/code/jobs/types.js";
import { addProject, createWorkBranch, type ProjectDeps } from "../src/code/projects.js";
import { MemoryCodeStore } from "../src/code/store.js";
import { FakeProvider } from "./jobs-fakes.js";

export const KEYS = appKeys();
export const SEC = 1000;
export const MIN = 60_000;

export interface Told { userId: string; kind: NotifyKind; data: NotifyData }

export interface RigOptions {
  /** No fake for GitHub's free computers. */
  github?: false;
  /** No fake for paid compute. */
  paid?: false;
  freeMinutes?: number;
}

export async function rig(o: RigOptions = {}) {
  const fake = new FakeGithub(KEYS);
  const now = () => fake.clock.t;
  const store = new MemoryCodeStore(now);
  const code = createCode({
    store, webhookSecret: null, oauth: null, oauthEnabled: false, fetchFn: fake.fetchFn, now,
    app: { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem },
  });
  const d: ProjectDeps = { store, github: code.github!, approvals: code.approvals, oauth: code.oauth };
  const jobStore = new MemoryJobStore(now);
  const gh = o.github === false ? null : new FakeProvider("github");
  const pd = o.paid === false ? null : new FakeProvider("paid");
  const told: Told[] = [];
  const jobs: JobRouter = createJobs({
    code, store: jobStore, github: gh, paid: pd, now, freeMinutes: o.freeMinutes,
    notify: (userId, kind, data) => { told.push({ userId, kind, data }); },
  })!;

  // Alice: the App on her own account, one repo as a project, a work branch for a task.
  fake.addInstall(101, "alice");
  const repo = fake.addRepo(101, "alice/app", { files: { "README.md": "# app\n", "src/a.ts": "export const a = 1;\n" } });
  await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 1, githubLogin: "alice" });
  const { project } = await addProject(d, "alice", repo.id);
  const { branch } = await createWorkBranch(d, "alice", project.id, "make the build pass");

  /** Another repo as a second project of Alice's, with its own work branch. */
  async function another(name = "alice/other") {
    const r = fake.addRepo(101, name, { files: { "README.md": "# other\n" } });
    const { project: p } = await addProject(d, "alice", r.id);
    const b = (await createWorkBranch(d, "alice", p.id, "other task")).branch;
    return { repo: r, project: p, branch: b };
  }

  /** Moves the clock (the fake GitHub's, which is everyone's). */
  const advance = (ms: number) => { fake.clock.t += ms; };

  /** A PC's heartbeat. Allowed to run, on every project, idle, unless said otherwise. */
  const beat = (deviceId: string, over: { allowRun?: boolean; projects?: string[] | "all"; busy?: boolean; name?: string; user?: string } = {}) =>
    jobs.heartbeat(over.user ?? "alice", {
      deviceId, name: over.name ?? "Work laptop", allowRun: over.allowRun ?? true, projects: over.projects ?? "all", busy: over.busy ?? false,
    });

  /** A job on Alice's work branch. */
  const job = (task = "make the build pass", budgetPaise = 0) => jobs.createJob("alice", project.id, branch, task, budgetPaise);

  /** What was told to the person, of one kind. */
  const toldOf = (kind: NotifyKind) => told.filter((t) => t.kind === kind);

  return { fake, now, advance, store, jobStore, code, d, jobs, gh, pd, told, toldOf, repo, project, branch, another, beat, job };
}

export type Rig = Awaited<ReturnType<typeof rig>>;

/** The one-line, valid device ids the tests use. */
export const LAPTOP = "laptop-0001";
export const DESKTOP = "desktop-0002";

/** A secret-looking value put together here so this file holds none whole (policy.ts scans for these). */
export const SECRET_ENV = `API_KEY=${"Zk3QpW9xLm2VbN7tRy5HcD8sFgJ4aE1u"}\n`;
