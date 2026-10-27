/**
 * FIXTURES FOR THE WORK CORE'S TESTS (LAYERS 5 TO 7): A FAKE callModel THAT ANSWERS BY PURPOSE AND WRITES DOWN
 * EVERY CALL, A BRAIN BUILT FROM ROWS WE CHOOSE, AND A FAKE FETCH FOR THE REGISTRIES, OSV AND GITHUB.
 *
 * `fakeCall()` is a `callModel` stand-in. A test says what each purpose answers (`call.on("work.plan", ...)`)
 * and reads back what was asked: the tier, the purpose, the budget, the messages. A purpose with no answer
 * fails the call, like a model that is down, so a test that did not expect a call finds out.
 *
 * `fixtureBrain()` is the real BrainHandle (code/project/index.ts) over a memory store holding the files, texts
 * and features a test hands it, so locate, plan and the finder run the real search and the real scoring.
 */
import { BudgetExceeded, type CallInput, type CallResult } from "../src/code/brain/gateway.js";
import type { ModelTier } from "../src/code/brain/tiers.js";
import { ApprovalBook } from "../src/code/approvals.js";
import { openProjectBrain, BuildBook, type BrainHandle, type BrainRuntime } from "../src/code/project/index.js";
import { MemoryProjectBrainStore } from "../src/code/project/store.js";
import { EMPTY_CONVENTIONS, EMPTY_STRUCTURE, type Baseline, type BrainRow, type Conventions, type Feature, type StoredFile, type StoredText, type Structure, type SymbolInfo } from "../src/code/project/types.js";
import { createCode } from "../src/code/index.js";
import { addProject } from "../src/code/projects.js";
import { MemoryCodeStore } from "../src/code/store.js";
import type { CallFn } from "../src/code/work/model.js";
import { appKeys, FakeGithub, type AppKeys } from "./github-fake.js";

// ----------------------------------------------------------------- a fake model

export interface SeenCall {
  purpose: string;
  tier: ModelTier | undefined;
  budget: CallInput["budget"];
  jobId: string | undefined;
  userId: string | undefined;
  /** Every message, joined: what was SENT. */
  sent: string;
  system: string;
  user: string;
  maxTokens: number | undefined;
}

type Answer = unknown | ((input: CallInput<unknown>, seen: SeenCall) => unknown);

export interface FakeCall {
  call: CallFn;
  calls: SeenCall[];
  of(purpose: string): SeenCall[];
  /** What a purpose answers: a value (the JSON), or a function of the call. */
  on(purpose: string, answer: Answer): FakeCall;
  /** Fail every call with this (a model that is down). */
  down: boolean;
  /** Refuse every call for the budget. */
  broke: boolean;
  /** Paise charged a call. */
  paise: number;
  spent(): number;
}

export function fakeCall(): FakeCall {
  const answers = new Map<string, Answer>();
  const f: FakeCall = {
    calls: [], down: false, broke: false, paise: 3,
    of: (purpose) => f.calls.filter((c) => c.purpose === purpose),
    on: (purpose, answer) => { answers.set(purpose, answer); return f; },
    spent: () => f.calls.length * f.paise,
    call: (async <T>(input: CallInput<T>): Promise<CallResult<T>> => {
      const msgs = input.messages;
      const seen: SeenCall = {
        purpose: input.purpose, tier: input.tier, budget: input.budget, jobId: input.jobId, userId: input.userId, maxTokens: input.maxTokens,
        sent: msgs.map((m) => String(m.content)).join("\n---\n"),
        system: msgs.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n"),
        user: msgs.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n"),
      };
      if (f.broke) throw new BudgetExceeded({ needPaise: 5, spentPaise: 0, budgetPaise: 0, scope: "job", purpose: input.purpose, tier: input.tier });
      f.calls.push(seen);
      if (f.down) throw new Error("model down");
      if (!answers.has(input.purpose)) throw new Error(`unexpected call ${input.purpose}`);
      const a = answers.get(input.purpose);
      const json = typeof a === "function" ? (a as (i: CallInput<unknown>, s: SeenCall) => unknown)(input as CallInput<unknown>, seen) : a;
      // The gateway checks the answer against the caller's schema; so does this.
      let checked = json;
      if (input.json && input.json !== true) {
        const parsed = input.json.safeParse(json);
        if (!parsed.success) throw new Error("the model's answer did not fit the schema");
        checked = parsed.data;
      }
      return {
        text: typeof json === "string" ? json : JSON.stringify(json), json: checked as T, toolCalls: [], model: "fake/model", tier: input.tier, promptTokens: 100, completionTokens: 50,
        costUsd: 0.0001, paise: f.paise, costSource: "reported", truncated: false, ms: 1, calls: 1, trail: [],
      };
    }) as CallFn,
  };
  return f;
}

// ----------------------------------------------------------------- a brain

export interface FileSpec {
  path: string;
  symbols?: SymbolInfo[];
  imports?: string[];
  tests?: string[];
  summary?: string;
  rank?: number;
  hot?: number;
  todo?: number;
  lang?: string;
}

export const sym = (name: string, kind: SymbolInfo["kind"] = "function", line = 1, exported = true): SymbolInfo => ({ name, kind, line, exported });
/** A route as the brain extracts it: its name and its path are the same. */
export const route = (method: string, path: string, line = 1): SymbolInfo => ({ name: path, kind: "route", line, method, path });
export const envSym = (name: string, line = 1): SymbolInfo => ({ name, kind: "env", line });

export interface FixtureBrain {
  brain: BrainHandle;
  store: MemoryProjectBrainStore;
  projectId: string;
  setRow(patch: Partial<BrainRow>): Promise<void>;
}

export interface FixtureOptions {
  files: FileSpec[];
  texts?: StoredText[];
  features?: Feature[];
  structure?: Partial<Structure>;
  conventions?: Partial<Conventions>;
  baseline?: Baseline | null;
}

/** The real brain handle over rows we chose. */
export async function fixtureBrain(o: FixtureOptions): Promise<FixtureBrain> {
  const codeStore = new MemoryCodeStore();
  const project = await codeStore.createProject("u1", { installationId: 1, repoId: 9, fullName: "u1/app", defaultBranch: "main", private: true });
  const store = new MemoryProjectBrainStore();
  await store.saveBrain(project.id, {
    status: "ready", headSha: "a".repeat(40), treeSha: "b".repeat(40), summariesState: "complete",
    structure: { ...EMPTY_STRUCTURE, fileCount: o.files.length, analysedCount: o.files.length, ...(o.structure ?? {}) } as Structure,
    conventions: { ...EMPTY_CONVENTIONS, ...(o.conventions ?? {}) } as Conventions,
    features: o.features ?? [], baseline: o.baseline ?? null, builtAt: 1,
  });
  await store.upsertFiles(project.id, o.files.map((f): StoredFile => ({
    path: f.path, blobSha: "c".repeat(40), lang: f.lang ?? "TypeScript", bytes: 100, symbols: f.symbols ?? [], imports: f.imports ?? [], rank: f.rank ?? 0.1,
    hot: f.hot ?? 0, todo: f.todo ?? 0, tests: f.tests ?? [], summary: f.summary ?? "",
  })));
  if (o.texts?.length) await store.replaceTexts(project.id, [], o.texts);
  const runtime: BrainRuntime = {
    projects: { store: codeStore, github: null as never, approvals: new ApprovalBook({}) }, store, budgetPaise: 1000, builds: new BuildBook(),
  };
  return {
    brain: await openProjectBrain(runtime, "u1", project.id), store, projectId: project.id,
    setRow: async (patch) => { await store.saveBrain(project.id, patch); },
  };
}

export const text = (path: string, line: number, t: string, kind: StoredText["kind"] = "jsx"): StoredText => ({ path, line, text: t, kind });

// ------------------------------------------------------------ a fake Supabase

type Row = Record<string, any>;

/**
 * A Supabase client holding some tables in memory and answering what the work core's stores ask of it: insert, upsert,
 * select with eq / in / order / range / returns, an exact count, delete, single and maybeSingle. `error` makes every
 * call fail the way a missing table does.
 */
export function fakeSupabase(o: { error?: string; tables?: string[] } = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries((o.tables ?? ["code_worklog", "code_intake"]).map((t) => [t, []]));
  const log: Array<{ table: string; op: string; args: unknown[] }> = [];
  let nextId = 1;
  const sb = {
    tables, log,
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "upsert" | "delete" = "select";
      let payload: Row | Row[] | null = null;
      let conflict = "";
      let range: [number, number] | null = null;
      let order: string | null = null;
      let head = false;
      let count = false;
      const exec = (): { data: any; error: { message: string } | null; count?: number } => {
        if (!(table in tables)) return { data: null, error: { message: `no table ${table}` } };
        if (o.error) return { data: null, error: { message: o.error } };
        const list = tables[table]!;
        if (op === "insert" || op === "upsert") {
          const rows = (Array.isArray(payload) ? payload : [payload!]).map((r) => structuredClone(r));
          const out: Row[] = [];
          for (const r of rows) {
            if (op === "upsert") {
              // `onConflict` may name several columns, comma separated, as a composite primary key does.
              const keys = conflict.split(",").map((k) => k.trim());
              const at = list.findIndex((x) => keys.every((k) => x[k] === r[k]));
              if (at >= 0) { list[at] = { ...list[at], ...r }; out.push(list[at]!); continue; }
            }
            const stored = { ...(table === "code_worklog" ? { id: nextId++ } : {}), ...r, ...(table === "code_intake" && !r.created_at ? { created_at: new Date().toISOString() } : {}) };
            list.push(stored);
            out.push(stored);
          }
          log.push({ table, op, args: [payload] });
          return { data: out.map((r) => structuredClone(r)), error: null };
        }
        let hit = list.filter((r) => filters.every((f) => f(r)));
        if (op === "delete") { tables[table] = list.filter((r) => !hit.includes(r)); log.push({ table, op, args: [] }); return { data: hit.map((r) => structuredClone(r)), error: null }; }
        if (order) hit = [...hit].sort((a, b) => (a[order!] < b[order!] ? -1 : a[order!] > b[order!] ? 1 : 0));
        if (range) hit = hit.slice(range[0], range[1] + 1);
        return { data: head ? null : hit.map((r) => structuredClone(r)), error: null, ...(count ? { count: list.filter((r) => filters.every((f) => f(r))).length } : {}) };
      };
      const b: any = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => { if (opts?.count) count = true; if (opts?.head) head = true; return b; },
        insert: (row: Row | Row[]) => { op = "insert"; payload = row; return b; },
        upsert: (row: Row | Row[], opts: { onConflict: string }) => { op = "upsert"; payload = row; conflict = opts.onConflict; return b; },
        delete: () => { op = "delete"; return b; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
        order: (c: string) => { order = c; return b; },
        range: (a: number, z: number) => { range = [a, z]; return b; },
        limit: () => b,
        returns: () => b,
        single: async () => { const r = exec(); return r.error ? r : { data: (r.data as Row[])[0], error: null }; },
        maybeSingle: async () => { const r = exec(); return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }; },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(exec).then(ok, ko),
      };
      return b;
    },
  };
  return sb;
}

// ------------------------------------------------------------- a fake world

export interface NpmPkg {
  version: string;
  license?: unknown;
  deprecated?: string;
  repo?: string;
  unpackedSize?: number;
  dependencies?: Record<string, string>;
  peers?: Record<string, string>;
  optionalPeers?: string[];
  description?: string;
  /** ISO date of the last publish. */
  date?: string;
  weekly?: number;
  /** Words the registry's search finds it by. */
  tags?: string[];
}

export interface PypiPkg {
  version: string;
  license?: string;
  classifiers?: string[];
  summary?: string;
  requires?: string[];
  repo?: string;
  size?: number;
  uploaded?: string;
  weekly?: number;
  yanked?: boolean;
}

export interface GhRepo { stars?: number; issues?: number; archived?: boolean; spdx?: string | null; pushed?: string; description?: string; topics?: string[] }

export interface OsvRec { id: string; summary?: string; cvss?: string; severity?: string; pkg: string; ecosystem: string; fixed?: string[] }

/** An OSV record in the shape osv.dev answers in. */
export function osvRecord(r: OsvRec): Record<string, unknown> {
  return {
    id: r.id, summary: r.summary ?? `Problem ${r.id}`,
    ...(r.cvss ? { severity: [{ type: "CVSS_V3", score: r.cvss }] } : {}),
    ...(r.severity ? { database_specific: { severity: r.severity } } : {}),
    affected: [{ package: { name: r.pkg, ecosystem: r.ecosystem }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, ...(r.fixed ?? []).map((f) => ({ fixed: f }))] }] }],
  };
}

/**
 * The registries, OSV and GitHub as the code under test calls them, from memory: npm (search, /latest, downloads), PyPI
 * (the package document and pypistats), OSV (query, querybatch, a record) and GitHub (a repository, a search). Every
 * call is written down. A host in `down` fails the way a dead network does.
 */
export function fakeWorld() {
  const w = {
    npm: new Map<string, NpmPkg>(),
    pypi: new Map<string, PypiPkg>(),
    github: new Map<string, GhRepo>(),
    /** `${ecosystem}:${name}@${version}` -> records. */
    osv: new Map<string, Array<Record<string, unknown>>>(),
    calls: [] as Array<{ method: string; url: string; body?: any }>,
    down: new Set<string>(),
    /** Statuses to answer with instead: host -> status. */
    status: new Map<string, number>(),
    fetch: undefined as unknown as typeof fetch,
    urls(host: string): string[] { return w.calls.filter((c) => new URL(c.url).hostname === host).map((c) => c.url); },
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  w.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    w.calls.push({ method, url: u.toString(), ...(body !== undefined ? { body } : {}) });
    if (w.down.has(u.hostname)) throw new Error("network down");
    const forced = w.status.get(u.hostname);
    if (forced) return json({ message: "forced" }, forced);
    const h = u.hostname;

    if (h === "registry.npmjs.org") {
      if (u.pathname === "/-/v1/search") {
        const q = words(u.searchParams.get("text") ?? "");
        const hits = [...w.npm].filter(([name, p]) => name === q.join(" ") || q.some((x) => name.includes(x) || (p.tags ?? []).includes(x)));
        return json({ objects: hits.map(([name, p]) => ({ package: { name, version: p.version, description: p.description ?? `${name} package`, date: p.date ?? "2026-09-01T00:00:00.000Z", links: { npm: `https://www.npmjs.com/package/${name}` } }, downloads: { weekly: p.weekly } })) });
      }
      const m = /^\/(.+)\/latest$/.exec(decodeURIComponent(u.pathname));
      const p = m ? w.npm.get(m[1]!) : undefined;
      if (!p) return json({}, 404);
      return json({
        name: m![1], version: p.version, ...(p.license !== undefined ? { license: p.license } : {}), ...(p.deprecated ? { deprecated: p.deprecated } : {}),
        description: p.description, ...(p.repo ? { repository: { type: "git", url: `git+${p.repo}.git` } } : {}),
        dist: { ...(p.unpackedSize !== undefined ? { unpackedSize: p.unpackedSize } : {}) }, dependencies: p.dependencies ?? {}, peerDependencies: p.peers ?? {},
        peerDependenciesMeta: Object.fromEntries((p.optionalPeers ?? []).map((n) => [n, { optional: true }])),
      });
    }
    if (h === "api.npmjs.org") {
      const name = decodeURIComponent(u.pathname.split("/last-week/")[1] ?? "");
      return w.npm.has(name) ? json({ downloads: w.npm.get(name)!.weekly ?? 0, package: name }) : json({}, 404);
    }
    if (h === "pypi.org") {
      const m = /^\/pypi\/([^/]+)\/json$/.exec(u.pathname);
      const p = m ? w.pypi.get(decodeURIComponent(m[1]!)) : undefined;
      if (!p) return json({}, 404);
      const name = decodeURIComponent(m![1]!);
      return json({
        info: {
          name, version: p.version, summary: p.summary ?? `${name} for Python`, license: p.license ?? "", classifiers: p.classifiers ?? [], requires_dist: p.requires ?? [],
          project_urls: p.repo ? { Source: p.repo } : {}, package_url: `https://pypi.org/project/${name}/`, yanked: p.yanked ?? false,
        },
        urls: [{ packagetype: "bdist_wheel", size: p.size ?? 200_000, upload_time_iso_8601: p.uploaded ?? "2026-09-01T00:00:00Z" }],
      });
    }
    if (h === "pypistats.org") {
      const name = decodeURIComponent(/\/packages\/([^/]+)\/recent/.exec(u.pathname)?.[1] ?? "");
      const p = [...w.pypi].find(([n]) => n.toLowerCase() === name);
      return p ? json({ data: { last_week: p[1].weekly ?? 0 } }) : json({}, 404);
    }
    if (h === "api.osv.dev") {
      if (method === "POST" && u.pathname === "/v1/query") {
        const k = `${body.package.ecosystem}:${body.package.name}@${body.version}`;
        return json({ vulns: w.osv.get(k) ?? [] });
      }
      if (method === "POST" && u.pathname === "/v1/querybatch") {
        return json({ results: (body.queries as Array<{ package: { name: string; ecosystem: string }; version: string }>).map((q) => ({ vulns: (w.osv.get(`${q.package.ecosystem}:${q.package.name}@${q.version}`) ?? []).map((v) => ({ id: v.id, modified: "2026-01-01T00:00:00Z" })) })) });
      }
      const m = /^\/v1\/vulns\/(.+)$/.exec(u.pathname);
      if (method === "GET" && m) {
        const rec = [...w.osv.values()].flat().find((v) => v.id === decodeURIComponent(m[1]!));
        return rec ? json(rec) : json({}, 404);
      }
    }
    if (h === "api.github.com") {
      const repo = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname);
      if (repo) {
        const g = w.github.get(repo[1]!);
        return g ? json({ stargazers_count: g.stars ?? 0, open_issues_count: g.issues ?? 0, archived: g.archived ?? false, pushed_at: g.pushed ?? "2026-09-01T00:00:00Z", license: g.spdx === undefined ? null : g.spdx ? { spdx_id: g.spdx } : null }) : json({ message: "Not Found" }, 404);
      }
      if (u.pathname === "/search/repositories") {
        const q = words(u.searchParams.get("q") ?? "");
        const items = [...w.github].filter(([name, g]) => q.some((x) => name.toLowerCase().includes(x) || (g.topics ?? []).includes(x) || words(g.description ?? "").includes(x)));
        return json({ items: items.map(([full, g]) => ({ full_name: full, html_url: `https://github.com/${full}`, description: g.description ?? "", stargazers_count: g.stars ?? 0, forks_count: 0, archived: g.archived ?? false, private: false, license: g.spdx ? { spdx_id: g.spdx } : null, pushed_at: g.pushed ?? "2026-09-01T00:00:00Z", topics: g.topics ?? [] })) }, 200);
      }
    }
    if (h === "hn.algolia.com") return json({ hits: [] });
    return json({ message: "not in the fake world" }, 404);
  }) as typeof fetch;
  return w;
}

// ------------------------------------------------------- a project on a fake GitHub

let keys: AppKeys | null = null;

/**
 * Alice, with one project on a fake GitHub (tests/github-fake.ts), and the Code object over it: for the tests that need
 * the real workspace, the real policy and real branches. No project brain (a test brings its own, fixtureBrain).
 */
export async function githubRig(o: { files?: Record<string, string>; empty?: boolean; repo?: string; wrapFetch?: (inner: typeof fetch) => typeof fetch } = {}) {
  keys ??= appKeys();
  const fake = new FakeGithub(keys);
  fake.addInstall(101, "alice");
  const repo = fake.addRepo(101, o.repo ?? "alice/app", { ...(o.files ? { files: o.files } : {}), ...(o.empty ? { empty: true } : {}) });
  const store = new MemoryCodeStore(() => fake.clock.t);
  await store.upsertInstallation("alice", { installationId: 101, accountLogin: "alice", accountType: "User", repositorySelection: "selected", githubUserId: 77, githubLogin: "alice" });
  const code = createCode({
    store, app: { slug: "tailzu-test", clientId: fake.appClientId, clientSecret: fake.clientSecret, privateKey: keys.privateKeyPem }, oauth: null, oauthEnabled: false,
    webhookSecret: "whsec_" + "k".repeat(40), fetchFn: o.wrapFetch ? o.wrapFetch(fake.fetchFn) : fake.fetchFn, now: () => fake.clock.t, brain: false,
  });
  const d = { store: code.store, github: code.github!, approvals: code.approvals, oauth: code.oauth };
  const project = (await addProject(d, "alice", repo.id)).project;
  return { fake, repo, store, code, d, project, projectId: project.id, user: "alice" };
}
export type GithubRig = Awaited<ReturnType<typeof githubRig>>;
