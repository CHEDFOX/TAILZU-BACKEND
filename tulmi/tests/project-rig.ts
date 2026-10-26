/**
 * THE PROJECT BRAIN'S TEST RIG: A FAKE GITHUB SERVING "ACME SHOP", A FAKE MODEL, A FAKE REGISTRY, AND THE
 * CODE OBJECT WIRED TO ALL OF THEM.
 *
 * `projectRig()` gives alice an install with one project on the repo, a brain
 * whose store is in memory, whose model door is `model.call` (answers the five
 * kinds of call it makes, counts them, and charges `paise` a call), whose
 * registry lookups are served from `registryFetch`, and whose push timer is
 * `timers` (nothing fires until a test says `timers.fire()`).
 */
import { BudgetExceeded, type CallInput, type CallResult } from "../src/code/brain/gateway.js";
import { createCode } from "../src/code/index.js";
import { addProject } from "../src/code/projects.js";
import { MemoryProjectBrainStore } from "../src/code/project/store.js";
import type { CallFn } from "../src/code/project/summarize.js";
import { MemoryCodeStore } from "../src/code/store.js";
import { BrainGithub, FixtureRepo } from "./project-fixtures.js";
import { acmeFiles } from "./project-repo.js";
import { appKeys, FakeGithub, type FakeRepo } from "./github-fake.js";

export const KEYS = appKeys();

// ----------------------------------------------------------------- a fake model

export interface ModelCall { purpose: string; paths: string[]; ids: string[]; maxPaise: number | null; user: string }

export interface FakeModel {
  call: CallFn;
  calls: ModelCall[];
  /** The calls of one kind. */
  of(purpose: string): ModelCall[];
  /** The paths asked about across all the file-summary calls. */
  summarized(): string[];
  paise: number;
  /** Make the next calls fail with this (a model that is down). */
  failAll: boolean;
  /** Answer the welcome call with this text. */
  welcome: string | null;
  /** The messages of every call, in order: what was SENT. */
  sent: string[];
  /** Calls refused for not fitting the cap (never made). */
  refused: number;
}

export function fakeModel(o: { paise?: number } = {}): FakeModel {
  const m: FakeModel = {
    calls: [], paise: o.paise ?? 5, failAll: false, welcome: null, sent: [], refused: 0,
    of(purpose) { return m.calls.filter((c) => c.purpose === purpose); },
    summarized() { return m.of("brain.summarize.files").flatMap((c) => c.paths); },
    call: (async <T>(input: CallInput<T>): Promise<CallResult<T>> => {
      const user = input.messages.filter((x) => x.role === "user").map((x) => String(x.content)).join("\n");
      m.sent.push(input.messages.map((x) => String(x.content)).join("\n---\n"));
      const cap = typeof input.budget === "object" ? input.budget.maxPaise : null;
      // Like the gateway: a call whose worst case does not fit the cap is refused before it is made, and never counted as made.
      if (cap !== null && cap < m.paise) {
        m.sent.pop();
        m.refused += 1;
        throw new BudgetExceeded({ needPaise: m.paise, spentPaise: 0, budgetPaise: cap, scope: "call", purpose: input.purpose });
      }
      const last: ModelCall = {
        purpose: input.purpose, user: input.userId ?? "", maxPaise: cap,
        paths: [...user.matchAll(/<(?:file|dir) path="([^"]*)"/g)].map((x) => x[1]!), ids: [...user.matchAll(/<data id="(\d+)"/g)].map((x) => x[1]!),
      };
      m.calls.push(last);
      if (m.failAll) throw new Error("model down");
      let json: unknown;
      switch (input.purpose) {
        case "brain.summarize.files": json = { summaries: last.paths.map((path) => ({ path, summary: `Summary of ${path}.` })) }; break;
        case "brain.summarize.dirs": json = { summaries: last.paths.map((path) => ({ path, summary: `The ${path || "root"} folder.` })) }; break;
        case "brain.summarize.repo": json = { overview: "Acme Shop is a small shop with a web app, an API and a mobile app." }; break;
        case "brain.features": json = { features: last.ids.map((id) => ({ id, name: `Feature ${id}`, summary: `What feature ${id} does.` })) }; break;
        case "brain.welcome": json = { welcome: m.welcome ?? "Acme Shop is a small shop built with TypeScript, Python and Go. Health: not checked yet. To start: 1) Add tests for src/lib/api.ts 2) Update next." }; break;
        default: throw new Error(`unexpected call ${input.purpose}`);
      }
      return {
        text: JSON.stringify(json), json: json as T, toolCalls: [], model: "fake/cheap", tier: input.tier, promptTokens: 100, completionTokens: 50, costUsd: 0.0001,
        paise: m.paise, costSource: "reported", truncated: false, ms: 1, calls: 1, trail: [],
      };
    }) as CallFn,
  };
  return m;
}

// ----------------------------------------------------------- a fake registry

/** npm and PyPI as the layer 3 sources ask for them. */
export function registryFetch(): typeof fetch {
  const npm: Record<string, { version: string; deprecated?: string }> = {
    next: { version: "15.0.0" }, react: { version: "18.3.1" }, "react-dom": { version: "18.3.1" }, express: { version: "4.19.2" }, zod: { version: "3.23.8" },
    "old-lib": { version: "1.0.0", deprecated: "use new-lib instead" }, vitest: { version: "1.6.0" }, typescript: { version: "5.5.0" }, eslint: { version: "9.0.0" }, prettier: { version: "3.3.0" },
  };
  const pypi: Record<string, string> = { fastapi: "0.115.0", pytest: "8.0.0", requests: "2.32.0" };
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.hostname === "registry.npmjs.org") {
      if (url.pathname === "/-/v1/search") {
        const name = url.searchParams.get("text") ?? "";
        const hit = npm[name];
        return json({ objects: hit ? [{ package: { name, version: hit.version, description: "x", date: "2026-01-01T00:00:00Z", links: {} }, downloads: { weekly: 10 } }] : [] });
      }
      const m = /^\/([^/]+)\/latest$/.exec(url.pathname);
      const hit = m ? npm[decodeURIComponent(m[1]!)] : undefined;
      return hit ? json({ license: "MIT", ...(hit.deprecated ? { deprecated: hit.deprecated } : {}) }) : json({}, 404);
    }
    if (url.hostname === "pypi.org") {
      const m = /^\/pypi\/([^/]+)\/json$/.exec(url.pathname);
      const v = m ? pypi[decodeURIComponent(m[1]!)] : undefined;
      return v ? json({ info: { name: m![1], version: v, summary: "x" }, urls: [] }) : json({}, 404);
    }
    return json({}, 404);
  }) as typeof fetch;
}

// -------------------------------------------------------------- manual timers

export class ManualTimers {
  private next = 1;
  pending = new Map<number, { fn: () => void; ms: number }>();
  set = (fn: () => void, ms: number): number => { const id = this.next++; this.pending.set(id, { fn, ms }); return id; };
  clear = (id: unknown): void => { this.pending.delete(id as number); };
  get count(): number { return this.pending.size; }
  /** Fires every timer that is waiting. */
  fire(): void { const all = [...this.pending.values()]; this.pending.clear(); for (const t of all) t.fn(); }
}

// ------------------------------------------------------------------ the rig

export interface RigOptions {
  files?: Record<string, string | Buffer>;
  budgetPaise?: number;
  paise?: number;
  /** Don't add the project (the test does). */
  noProject?: boolean;
  /** Give the brain no model door at all (a build with a model that is always down). */
  modelDown?: boolean;
}

export async function projectRig(o: RigOptions = {}) {
  const fake = new FakeGithub(KEYS);
  const gh = new BrainGithub(fake);
  fake.addInstall(101, "alice");
  const fakeRepo: FakeRepo = fake.addRepo(101, "alice/acme");
  const repo = new FixtureRepo(o.files ?? acmeFiles());
  gh.served.set("alice/acme", { repo, fake: fakeRepo });
  const store = new MemoryCodeStore(() => fake.clock.t);
  await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 77, githubLogin: "alice" });
  const brainStore = new MemoryProjectBrainStore(() => fake.clock.t);
  const model = fakeModel({ paise: o.paise });
  if (o.modelDown) model.failAll = true;
  const timers = new ManualTimers();
  const logs: Array<{ o: object; m: string }> = [];
  const code = createCode({
    store, app: { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: KEYS.privateKeyPem }, oauth: null, oauthEnabled: false,
    webhookSecret: "whsec_" + "k".repeat(40), fetchFn: gh.fetchFn, now: () => fake.clock.t,
    brain: {
      store: brainStore, call: model.call, fetchFn: registryFetch(), now: () => fake.clock.t, budgetPaise: o.budgetPaise ?? 1000,
      setTimer: timers.set, clearTimer: timers.clear, debounceMs: 60_000,
      log: { info: (x, m) => logs.push({ o: x, m }), warn: (x, m) => logs.push({ o: x, m }) },
    },
  });
  const brain = code.brain!;
  const d = { store: code.store, github: code.github!, approvals: code.approvals, oauth: code.oauth };
  let project = null as Awaited<ReturnType<typeof addProject>>["project"] | null;
  if (!o.noProject) project = (await addProject(d, "alice", fakeRepo.id)).project;
  return { fake, gh, repo, fakeRepo, store, brainStore, model, timers, logs, code, brain, d, project: project!, projectId: project?.id ?? "", user: "alice" };
}

export type Rig = Awaited<ReturnType<typeof projectRig>>;

/** A build, waited for. */
export async function built(r: Rig, mode: "full" | "incremental" = "full") {
  return r.brain.build(r.user, r.projectId, { mode });
}
