/**
 * THE PROJECT BRAIN, LAYER 4: WHAT THE CODE BOT KNOWS ABOUT A PROJECT, BUILT WHEN IT IS ADDED AND KEPT FRESH.
 * The story is in docs/code-project-brain.md. (`code/brain/` is the MODEL layer;
 * this is what the bot knows about one repo.)
 *
 *   snapshot.ts    the tree, then the code in one tarball (tar.ts), or blob by blob
 *   merkle.ts      what changed since last time, from git's own shas
 *   scan.ts symbols.ts graph.ts texts.ts tests.ts conventions.ts hotspots.ts
 *                  everything that is learned without a model
 *   summarize.ts   a cheap model, on a budget: lines for files, folders, the repo,
 *                  the features, a welcome
 *   memory.ts      the TAILZU.md text (kept in the database, not committed)
 *   baseline.ts    the plan of checks, and recordBaseline
 *   build.ts       one build, start to end
 *   store.ts       code_brain, code_brain_files, code_brain_dirs, code_brain_texts
 *
 * HERE: the door.
 *
 *   startProjectBrain   begins a build in the background (one per project at a
 *                       time) and answers with the status; `done` is the build
 *   buildProjectBrain   the same, waited for
 *   getProjectBrain     the status, progress, welcome, structure and features
 *   openProjectBrain    a handle over one project's brain with the questions
 *                       layer 5 asks: findSymbols, findTexts, findFiles,
 *                       neighbors, testsFor, feature, hotspots, file, paths
 *   ensureFresh         before a job starts: is the default branch where the
 *                       brain was built? if not, update it first
 *   BrainSync           GitHub's push webhook: mark the brain stale at once and
 *                       build it again after a minute of quiet, never inline
 *
 * Every function takes the person's id and looks the project up BY it, so a
 * project that is someone else's is not found (404), as in projects.ts.
 */
import { getConfig } from "../../config.js";
import type { ConnectorError } from "../../connectors/oauth.js";
import { assertAccess, ownProject, repoRef, type ProjectDeps } from "../projects.js";
import type { CodeProject } from "../store.js";
import { baselinePlan } from "./baseline.js";
import { runBuild, type BuildMode, type ProjectBrainDeps } from "./build.js";
import { aggregateHistory, coChanged, rankHotspots } from "./hotspots.js";
import { declaredDeps, type DeclaredDep } from "./registry.js";
import { queryWords, scoreFile, symbolScore } from "./search.js";
import { projectBrainStore, type ProjectBrainStore } from "./store.js";
import {
  BUILD_DEAD_MS, IMPORT_BUDGET_DEFAULT, PUSH_DEBOUNCE_MS, publicStructure,
  type BaselineStep, type BrainRow, type BrainView, type Feature, type Hotspot, type StoredFile, type StoredText, type SymbolInfo,
} from "./types.js";

export { memoryMarkdown, withBaseline } from "./memory.js";
export { baselinePlan, recordBaseline } from "./baseline.js";
export { diffSnapshots } from "./merkle.js";
export type { BuildMode, ProjectBrainDeps } from "./build.js";
export type { DeclaredDep } from "./registry.js";
export type { BaselineResult, BrainView, Feature, Hotspot, StoredFile, StoredText, SymbolInfo } from "./types.js";
export { MemoryProjectBrainStore, SupabaseProjectBrainStore, projectBrainStore, resetProjectBrainStoreForTests } from "./store.js";
export type { ProjectBrainStore } from "./store.js";

// --------------------------------------------------------------------- views

/** The row as a person or a client sees it. A build that says it is running but has stopped moving is reported as failed. */
export function viewOf(row: BrainRow | null, o: { running?: boolean; now?: number } = {}): BrainView {
  if (!row) {
    return { status: "none", progress: { pct: 0, phase: "" }, headSha: "", builtAt: null, summaries: "none", welcome: "", structure: null, features: [], conventions: null, baseline: null, spentPaise: 0, error: "" };
  }
  const dead = row.status === "building" && !o.running && (o.now ?? Date.now()) - row.updatedAt > BUILD_DEAD_MS;
  return {
    status: dead ? "failed" : row.status, progress: row.progress, headSha: row.headSha, builtAt: row.builtAt, summaries: row.summariesState, welcome: row.welcome,
    structure: publicStructure(row.structure), features: row.features, conventions: row.conventions, baseline: row.baseline, spentPaise: row.spentPaise,
    error: dead ? "The build stopped before it finished. Start it again." : row.error,
  };
}

// ----------------------------------------------------------- the build book

/** The builds running in this process, one per project, and the ones asked for while one ran. */
export class BuildBook {
  private running = new Map<string, { promise: Promise<BrainRow>; again: BuildMode | null }>();
  isRunning(projectId: string): boolean { return this.running.has(projectId); }
  /** Waits for the build that is running, if any. */
  waitFor(projectId: string): Promise<BrainRow> | null { return this.running.get(projectId)?.promise ?? null; }
  /** Asks for another build to follow the one that is running (a push that came during it). */
  later(projectId: string, mode: BuildMode): void { const r = this.running.get(projectId); if (r) r.again = r.again === "full" ? "full" : mode; }
  /** Starts `fn` unless one is running; returns the running one's promise either way, and whether this call started it. */
  start(projectId: string, fn: () => Promise<BrainRow>, next: () => Promise<BrainRow>): { promise: Promise<BrainRow>; started: boolean } {
    const cur = this.running.get(projectId);
    if (cur) return { promise: cur.promise, started: false };
    const entry: { promise: Promise<BrainRow>; again: BuildMode | null } = { promise: undefined as unknown as Promise<BrainRow>, again: null };
    entry.promise = fn().then(async (row) => {
      // A build asked for while this one ran follows it, once.
      const again = entry.again;
      this.running.delete(projectId);
      if (again) return next().catch(() => row);
      return row;
    }, (err) => { this.running.delete(projectId); throw err; });
    this.running.set(projectId, entry);
    return { promise: entry.promise, started: true };
  }
  /** Projects with a build running now (for tests). */
  get size(): number { return this.running.size; }
}

export interface CreateProjectBrainOptions {
  projects: ProjectDeps;
  store?: ProjectBrainStore;
  call?: ProjectBrainDeps["call"];
  gateway?: ProjectBrainDeps["gateway"];
  fetchFn?: ProjectBrainDeps["fetchFn"];
  sources?: ProjectBrainDeps["sources"];
  now?: () => number;
  /** Instead of CODE_IMPORT_BUDGET_PAISE. */
  budgetPaise?: number;
  log?: ProjectBrainDeps["log"];
  /** Instead of 60 seconds. */
  debounceMs?: number;
  /** Timers, for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** The import budget: CODE_IMPORT_BUDGET_PAISE, 1,000 paise unless set. */
export function importBudgetFromEnv(): number {
  const n = getConfig().CODE_IMPORT_BUDGET_PAISE;
  return Number.isFinite(n) && n >= 0 ? n : IMPORT_BUDGET_DEFAULT;
}

export interface BrainRuntime extends ProjectBrainDeps {
  builds: BuildBook;
}

// -------------------------------------------------------------------- start

export interface StartOptions {
  mode?: BuildMode;
  /** If a build is running, run another when it ends (a push that came during it). */
  queue?: boolean;
}

/**
 * Begins a build in the background and answers with where it is. One build per
 * project at a time: asking while one runs returns that one. `incremental` with
 * nothing built yet is a full build. The project must be the person's and still
 * reachable (404 not_found, 403 no_access). `done` settles when the build has.
 */
export async function startProjectBrain(d: BrainRuntime, userId: string, projectId: string, o: StartOptions = {}): Promise<{ status: BrainView; done: Promise<BrainView>; started: boolean }> {
  const project = await ownProject(d.projects, userId, projectId);
  await assertAccess(d.projects, userId, project);
  return startFor(d, userId, project, o);
}

async function startFor(d: BrainRuntime, userId: string, project: CodeProject, o: StartOptions): Promise<{ status: BrainView; done: Promise<BrainView>; started: boolean }> {
  const now = d.now ?? Date.now;
  const book = d.builds;
  const view = async (running: boolean) => viewOf(await d.store.getBrain(project.id), { running, now: now() });
  if (book.isRunning(project.id)) {
    if (o.queue) book.later(project.id, o.mode ?? "incremental");
    const waiting = book.waitFor(project.id)!;
    return { status: await view(true), done: waiting.then((r) => viewOf(r, { now: now() })), started: false };
  }
  const row = await d.store.getBrain(project.id);
  // A build on the books that nobody is running and that stopped moving long ago is dead: start over. A recent one may be another server's.
  if (row?.status === "building" && now() - row.updatedAt <= BUILD_DEAD_MS) {
    return { status: viewOf(row, { running: true, now: now() }), done: Promise.resolve(viewOf(row, { now: now() })), started: false };
  }
  const mode: BuildMode = (o.mode ?? "incremental") === "incremental" && row && row.headSha ? "incremental" : "full";
  await d.store.saveBrain(project.id, { status: "building", progress: { pct: 0, phase: "starting" }, error: "" });
  const begun = book.start(
    project.id,
    async () => (await runBuild(d, userId, project, mode, row)).row,
    // The build that follows one that ran while a push came: the row it left is the base.
    async () => {
      const base = await d.store.getBrain(project.id);
      await d.store.saveBrain(project.id, { status: "building", progress: { pct: 0, phase: "starting" }, error: "" });
      return (await runBuild(d, userId, project, "incremental", base)).row;
    },
  );
  const done = begun.promise.then((r) => viewOf(r, { now: now() }), async (err) => {
    // Only what the person should hear about is thrown out of a build; the row already says so.
    void (err as ConnectorError);
    return viewOf(await d.store.getBrain(project.id), { now: now() });
  });
  return { status: await view(true), done, started: begun.started };
}

/** A build, waited for. */
export async function buildProjectBrain(d: BrainRuntime, userId: string, projectId: string, o: StartOptions = {}): Promise<BrainView> {
  return (await startProjectBrain(d, userId, projectId, o)).done;
}

/** The brain's status, progress, welcome, structure and features. "none" when it has never been built. */
export async function getProjectBrain(d: BrainRuntime, userId: string, projectId: string): Promise<BrainView> {
  const project = await ownProject(d.projects, userId, projectId);
  return viewOf(await d.store.getBrain(project.id), { running: d.builds.isRunning(project.id), now: (d.now ?? Date.now)() });
}

/** Starts a full build for a project that has no brain yet. Used when a project is added. */
export async function ensureStarted(d: BrainRuntime, userId: string, project: CodeProject): Promise<boolean> {
  if (d.builds.isRunning(project.id) || (await d.store.getBrain(project.id))) return false;
  try {
    await assertAccess(d.projects, userId, project);
    return (await startFor(d, userId, project, { mode: "full" })).started;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------- freshness

export interface Fresh {
  /** The brain is built from the default branch's head now. */
  fresh: boolean;
  /** An update ran for this call. */
  updated: boolean;
  status: BrainView["status"];
  headSha: string;
}

/**
 * Called before a job starts: is the brain built from where the default branch
 * is now? If it was built from an older commit (or a push marked it stale), it
 * is brought up to date, incrementally, and waited for (up to `waitMs`, 30 s
 * unless told otherwise). A project with no brain starts a full build and
 * answers at once, not fresh.
 */
export async function ensureFresh(d: BrainRuntime, userId: string, projectId: string, o: { waitMs?: number } = {}): Promise<Fresh> {
  const project = await ownProject(d.projects, userId, projectId);
  await assertAccess(d.projects, userId, project);
  const row = await d.store.getBrain(project.id);
  if (!row) {
    const s = await startFor(d, userId, project, { mode: "full" });
    return { fresh: false, updated: false, status: s.status.status, headSha: "" };
  }
  const waitMs = o.waitMs ?? 30_000;
  const within = <T>(p: Promise<T>): Promise<T | "timeout"> => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("timeout"), waitMs);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
  if (d.builds.isRunning(project.id)) {
    const r = await within(d.builds.waitFor(project.id)!);
    if (r === "timeout") return { fresh: false, updated: false, status: "building", headSha: row.headSha };
  }
  const head = await d.projects.github.branchHead(repoRef(d.projects, userId, project), project.defaultBranch);
  const cur = (await d.store.getBrain(project.id))!;
  if (cur.status === "ready" && cur.headSha === head) return { fresh: true, updated: false, status: "ready", headSha: head };
  const s = await startFor(d, userId, project, { mode: "incremental" });
  const view = await within(s.done);
  if (view === "timeout") return { fresh: false, updated: true, status: "building", headSha: cur.headSha };
  return { fresh: view.status === "ready" && view.headSha === head, updated: true, status: view.status, headSha: view.headSha };
}

// ------------------------------------------------------------- the questions

export interface FileHit { path: string; lang: string; summary: string; rank: number; score: number; symbols: SymbolInfo[] }
export interface SymbolHit extends SymbolInfo { path: string; score: number }
export interface TextHit { path: string; line: number; text: string; kind: StoredText["kind"] }

/**
 * The questions layer 5 asks of a project's brain, scoped to one project the
 * person owns. Each is a read, cheap, and answers from the kept rows: no GitHub
 * call, no model.
 */
export interface BrainHandle {
  readonly projectId: string;
  status(): Promise<BrainView>;
  /** Files by path, symbol or summary words ("login form", "stripe webhook"). */
  findFiles(q: string, limit?: number): Promise<FileHit[]>;
  /** Symbols and routes by name or path ("handleLogin", "/api/users"). */
  findSymbols(q: string, limit?: number): Promise<SymbolHit[]>;
  /** The visible strings, with file:line ("Sign up"). */
  findTexts(q: string, limit?: number): Promise<TextHit[]>;
  /** One hop in the import graph. */
  neighbors(path: string): Promise<{ imports: string[]; importedBy: string[] }>;
  /** The test files that cover a file. */
  testsFor(path: string): Promise<string[]>;
  /** One analysed file's row (symbols, imports, rank, hotness, tests, summary), or null when the brain holds no such file. */
  file(path: string): Promise<StoredFile | null>;
  /** The paths of the analysed files, in order, at most `limit` (5,000 unless told otherwise). */
  paths(limit?: number): Promise<string[]>;
  feature(name: string): Promise<Feature | null>;
  features(): Promise<Feature[]>;
  /** The files changed most, carrying TODOs, central and untested: where to be careful. */
  hotspots(limit?: number): Promise<Hotspot[]>;
  /** Files that change together with this one. */
  coChanged(path: string): Promise<Array<{ path: string; count: number }>>;
  /** The TAILZU.md text. */
  memory(): Promise<string>;
  /** What the manifests declare (name, ecosystem and the version range as written): runtime dependencies first, then the dev ones. No workspace-internal names, no @types. */
  deps(): Promise<DeclaredDep[]>;
  /** The checks to run before the first edit. */
  baselinePlan(): Promise<BaselineStep[]>;
}

export async function openProjectBrain(d: BrainRuntime, userId: string, projectId: string): Promise<BrainHandle> {
  const project = await ownProject(d.projects, userId, projectId);
  const id = project.id;
  const store = d.store;
  const row = () => store.getBrain(id);
  const words = (q: string) => queryWords(q);

  const fileHit = (f: StoredFile, score: number, q: string): FileHit => {
    const lq = q.trim().toLowerCase();
    const w = words(q);
    const symbols = f.symbols.filter((s) => symbolScore(s, lq, w) > 0).slice(0, 5);
    return { path: f.path, lang: f.lang, summary: f.summary, rank: f.rank, score, symbols };
  };

  return {
    projectId: id,
    status: async () => viewOf(await row(), { running: d.builds.isRunning(id), now: (d.now ?? Date.now)() }),
    async findFiles(q, limit = 10) {
      const w = words(q);
      if (!w.length) return [];
      const found = await store.searchFiles(id, q, Math.max(limit * 5, 50));
      return found.map((f) => fileHit(f, scoreFile(f, q, w), q)).sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)).slice(0, limit);
    },
    async findSymbols(q, limit = 20) {
      const w = words(q);
      const lq = q.trim().toLowerCase();
      if (!w.length) return [];
      const found = await store.searchFiles(id, q, Math.max(limit * 5, 60));
      const out: SymbolHit[] = [];
      for (const f of found) for (const s of f.symbols) { const score = symbolScore(s, lq, w); if (score > 0) out.push({ ...s, path: f.path, score: score + f.rank * 4 }); }
      return out.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1) || a.line - b.line).slice(0, limit);
    },
    async findTexts(q, limit = 20) {
      const w = words(q);
      if (!w.length) return [];
      const lq = q.trim().toLowerCase();
      const found = await store.searchTexts(id, q, Math.max(limit * 4, 40));
      const score = (t: StoredText) => {
        const x = t.text.toLowerCase();
        const value = x.includes(": ") && t.kind !== "string" && t.kind !== "flutter" ? x.slice(x.indexOf(": ") + 2) : x;
        return value === lq ? 100 : value.startsWith(lq) ? 80 : value.includes(lq) ? 60 : 20 - Math.min(19, Math.floor(value.length / 20));
      };
      return found.map((t) => ({ t, s: score(t) })).sort((a, b) => b.s - a.s || (a.t.path < b.t.path ? -1 : 1) || a.t.line - b.t.line)
        .slice(0, limit).map(({ t }) => ({ path: t.path, line: t.line, text: t.text, kind: t.kind }));
    },
    async neighbors(path) {
      const f = await store.getFile(id, path);
      return { imports: f?.imports ?? [], importedBy: f ? await store.importersOf(id, path, 100) : [] };
    },
    async testsFor(path) { return (await store.getFile(id, path))?.tests ?? []; },
    async file(path) { return typeof path === "string" && path ? store.getFile(id, path) : null; },
    async paths(limit = 5000) { return (await store.listFiles(id)).slice(0, Math.max(0, limit)).map((f) => f.path); },
    async features() { return (await row())?.features ?? []; },
    async feature(name) {
      const all = (await row())?.features ?? [];
      const n = name.trim().toLowerCase();
      if (!n) return null;
      const exact = all.find((f) => f.name.toLowerCase() === n || f.key?.toLowerCase() === n);
      if (exact) return exact;
      const w = words(name);
      return all.find((f) => f.name.toLowerCase().includes(n))
        ?? all.find((f) => w.length > 0 && w.every((x) => f.name.toLowerCase().includes(x) || f.summary.toLowerCase().includes(x))) ?? null;
    },
    async hotspots(limit = 20) {
      const b = await row();
      const [hot, todo, central] = await Promise.all([store.topFiles(id, "hot", 60), store.topFiles(id, "todo", 30), store.topFiles(id, "rank", 30)]);
      const seen = new Map<string, StoredFile>();
      for (const f of [...hot, ...todo, ...central]) seen.set(f.path, f);
      const last = b ? aggregateHistory(b.history).last : new Map<string, number>();
      return rankHotspots([...seen.values()], last, limit);
    },
    async coChanged(path) {
      const b = await row();
      return b ? coChanged(aggregateHistory(b.history).pairs, path) : [];
    },
    async memory() { return (await row())?.memory ?? ""; },
    async deps() { const b = await row(); return b ? declaredDeps(b.structure.core) : []; },
    async baselinePlan() { const b = await row(); return b?.baseline?.plan ?? (b ? baselinePlan(b.structure.commands) : []); },
  };
}

// ---------------------------------------------------------------------- sync

/**
 * KEEPING THE BRAIN FRESH WHEN SOMEONE PUSHES.
 *
 * GitHub's `push` webhook (webhook.ts) calls `pushed(project)` for every
 * project on the repo whose default branch it was. This only touches Tailzu's
 * own store and a timer, so the webhook still answers at once and never calls
 * GitHub: the brain is marked STALE now, and an incremental build is scheduled
 * for after a minute with no further push (each push moves the timer). A build
 * already running when the timer fires is followed by one more. A project with
 * no brain yet is left alone: its first build is the full one.
 */
export class BrainSync {
  private timers = new Map<string, unknown>();
  private readonly debounce: number;
  private readonly set: (fn: () => void, ms: number) => unknown;
  private readonly clear: (h: unknown) => void;

  constructor(private readonly d: BrainRuntime, o: { debounceMs?: number; setTimer?: CreateProjectBrainOptions["setTimer"]; clearTimer?: CreateProjectBrainOptions["clearTimer"] } = {}) {
    this.debounce = o.debounceMs ?? PUSH_DEBOUNCE_MS;
    this.set = o.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); (h as { unref?: () => void }).unref?.(); return h; });
    this.clear = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Builds scheduled and not yet started. */
  get pending(): number { return this.timers.size; }

  async pushed(project: CodeProject): Promise<void> {
    const had = await this.d.store.markStale(project.id);
    if (!had) return;
    const old = this.timers.get(project.id);
    if (old !== undefined) this.clear(old);
    this.timers.set(project.id, this.set(() => {
      this.timers.delete(project.id);
      void startFor(this.d, project.userId, project, { mode: "incremental", queue: true }).catch((err: unknown) => {
        this.d.log?.warn({ project: project.id, code: (err as { code?: string })?.code }, "code project brain: the build after a push did not start");
      });
    }, this.debounce));
  }

  /** Forgets every timer: the server is closing. */
  dispose(): void {
    for (const h of this.timers.values()) this.clear(h);
    this.timers.clear();
  }
}

// -------------------------------------------------------------------- facade

/**
 * Everything above bound to one set of dependencies: what the Code object
 * (code/index.ts) carries and the routes use.
 */
export class ProjectBrain {
  readonly runtime: BrainRuntime;
  readonly sync: BrainSync;

  constructor(o: CreateProjectBrainOptions) {
    this.runtime = {
      projects: o.projects, store: o.store ?? projectBrainStore(), call: o.call, gateway: o.gateway, fetchFn: o.fetchFn, sources: o.sources, now: o.now,
      budgetPaise: o.budgetPaise ?? importBudgetFromEnv(), log: o.log, builds: new BuildBook(),
    };
    this.sync = new BrainSync(this.runtime, { debounceMs: o.debounceMs, setTimer: o.setTimer, clearTimer: o.clearTimer });
  }

  get store(): ProjectBrainStore { return this.runtime.store; }
  start(userId: string, projectId: string, o?: StartOptions) { return startProjectBrain(this.runtime, userId, projectId, o); }
  build(userId: string, projectId: string, o?: StartOptions) { return buildProjectBrain(this.runtime, userId, projectId, o); }
  get(userId: string, projectId: string) { return getProjectBrain(this.runtime, userId, projectId); }
  open(userId: string, projectId: string) { return openProjectBrain(this.runtime, userId, projectId); }
  ensureFresh(userId: string, projectId: string, o?: { waitMs?: number }) { return ensureFresh(this.runtime, userId, projectId, o); }
  /** A project was just added: build it, unless it has been built. */
  added(userId: string, project: CodeProject) { return ensureStarted(this.runtime, userId, project); }
  /** GitHub's push webhook (see BrainSync). */
  pushed(project: CodeProject) { return this.sync.pushed(project); }
  /** The project is gone: forget what was learned. (The database cascades too.) */
  async forget(projectId: string): Promise<void> { await this.runtime.store.deleteBrain(projectId); }
  /** Where the brain's lines go (counts and timings: never a path or a line of code). */
  useLog(log: ProjectBrainDeps["log"]): void { this.runtime.log = log; }
  /** The server is closing. */
  dispose(): void { this.sync.dispose(); }
}
