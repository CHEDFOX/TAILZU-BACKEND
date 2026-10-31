/**
 * ONE BUILD OF A PROJECT'S BRAIN, FROM THE TREE TO THE WELCOME MESSAGE.
 *
 * The steps, in order (the percentages are what GET .../brain reports):
 *
 *    5  the tree          three calls; every path with its sha
 *   15  the contents      one tarball, or the blobs of what changed
 *   35  each file         symbols, routes, imports, strings, TODOs (no model)
 *   50  the whole         the import graph and its ranks, the test map, the
 *                         conventions, the history and hotspots, the features
 *   70  SAVED             everything above is written, the status still
 *                         "building": the analysis is complete and usable here
 *   85  the words         one or two lines for the files that matter, the
 *                         folders and the repo; the features named (cheap model,
 *                         on a budget; what the money can't reach is left out)
 *   95  the memory and the welcome message
 *  100  ready
 *
 * A FULL build reads every file again. An INCREMENTAL one (merkle.ts) compares
 * the tree against what was kept and reads only the files whose sha changed (by
 * blob if there are 200 or fewer, else the tarball again), analyses only those,
 * gives new lines only to the changed files that get one and to the folders above
 * them whose sha changed, and rebuilds everything that spans files (the graph,
 * the ranks, the tests, the features) from the kept rows plus the new ones. It
 * becomes a full build, by itself, when a file that decides how imports resolve
 * (tsconfig, go.mod, a package's name...) changed: the kept rows hold what
 * imports resolved to, not what they said.
 *
 * Either way, a file whose sha is the same as the kept row's keeps its line, and
 * a folder whose sha is the same keeps its: a rebuild after a partial one pays
 * only for what is missing.
 *
 * TREE-ONLY. A repo too big to download (over 300 MB), or whose tarball GitHub
 * won't give, is known by its tree and its manifests: every readable file gets a
 * row with no symbols, so it can still be found by name, grouped by folder and
 * paired with its tests. A later incremental build stays tree-only (it reads the
 * manifests that changed); asking for a full build tries the download again.
 *
 * A failed build leaves the earlier rows as they were, and says why in plain
 * words (never a path, a line of code, or GitHub's own message).
 */
import { getConfig, isWorkerRuntime } from "../../config.js";
import { ConnectorError } from "../../connectors/state.js";
import type { FetchLike } from "../../web/search/types.js";
import { callModel, type GatewayDeps } from "../brain/gateway.js";
import type { GithubApp } from "../github.js";
import { scanForSecrets } from "../policy.js";
import { assertAccess, repoRef, type ProjectDeps } from "../projects.js";
import type { CodeProject } from "../store.js";
import { baselinePlan } from "./baseline.js";
import { analyseConventions } from "./conventions.js";
import { clusterFeatures } from "./features.js";
import { buildResolver, extractImports, rankFiles, resolveImport, type RawImport } from "./graph.js";
import { aggregateHistory, collectHistory, rankHotspots } from "./hotspots.js";
import { baseName, classOf, dirName, isTestPath, languageOf } from "./lang.js";
import { memoryMarkdown } from "./memory.js";
import { ancestorsOf, diffSnapshots, fingerprintOf, rollUp, toRead, type SnapshotDiff } from "./merkle.js";
import { checkDeps, declaredDeps, type CheckOptions, type DepNote } from "./registry.js";
import { buildStructure, extractCore } from "./scan.js";
import { coreKindOf, fetchContents, fetchTree, selectFiles, type Candidate, type Contents } from "./snapshot.js";
import type { ProjectBrainStore } from "./store.js";
import {
  Meter, fallbackWelcome, labelFeatures, phaseCap, pickForSummary, suggestTasks, summarizeDirs, summarizeFiles, summarizeRepo, welcomeMessage,
  type CallFn, type DirJob, type FileJob, type SummaryCtx,
} from "./summarize.js";
import { withHashes } from "./map.js";
import { countTodos, extractSymbols, type SymbolContext } from "./symbols.js";
import { buildTestMap, untestedImportant } from "./tests.js";
import { extractTexts } from "./texts.js";
import { analyse, ensureGrammars, treeSitter } from "./treesitter/index.js";
import {
  BLOBS_MAX, EMPTY_STRUCTURE, PARSER_WORKER_TEXT_MAX, TEXTS_PER_PROJECT,
  type BrainRow, type CoreEntry, type History, type StoredDir, type StoredFile, type StoredText, type Structure, type SymbolInfo, type TreeInfo,
} from "./types.js";

export type BuildMode = "full" | "incremental";

export interface BuildLog { info(o: object, m: string): void; warn(o: object, m: string): void }

export interface ProjectBrainDeps {
  projects: ProjectDeps;
  store: ProjectBrainStore;
  /** The model door (brain/gateway.ts callModel). */
  call?: CallFn;
  gateway?: GatewayDeps;
  /** The registries' fetch (the layer 3 sources); the guarded egress fetch when absent. */
  fetchFn?: FetchLike;
  sources?: CheckOptions["sources"];
  now?: () => number;
  /** CODE_IMPORT_BUDGET_PAISE. */
  budgetPaise: number;
  log?: BuildLog;
}

/** An incremental build may spend this fraction of the import budget: it only writes about what changed. */
export const INCREMENTAL_BUDGET_SHARE = 0.2;

/** Words for a person when a build ends badly. Never GitHub's own words, a path or a line of code. */
export function whyFailed(err: unknown): string {
  if (err instanceof ConnectorError) return err.message;
  return "X0 Bot couldn't finish reading this project. Try again in a moment.";
}

const yieldNow = () => new Promise<void>((r) => setImmediate(r));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const depthOfDir = (d: string) => (d ? d.split("/").length : 0);

// ----------------------------------------------------------------- the pieces

interface Analysed {
  file: StoredFile;
  raw: RawImport[];
  texts: StoredText[];
  text: string;
  /** The text holds something the secret scan flags: a model is not shown it. */
  redact: boolean;
}

/** The directories that hold a Next.js app: any package.json that depends on `next`. */
export function nextRootsOf(core: Record<string, CoreEntry>): string[] {
  const out: string[] = [];
  for (const [path, e] of Object.entries(core)) {
    if (e.kind !== "npm") continue;
    const d = e.data as { deps?: string[]; devDeps?: string[] };
    if ([...(d.deps ?? []), ...(d.devDeps ?? [])].includes("next")) out.push(dirName(path));
  }
  return out;
}

/** What decides how imports resolve; when it changes, the kept imports can't be trusted. */
function resolverSignature(core: Record<string, CoreEntry>): string {
  const parts: string[] = [];
  for (const [path, e] of Object.entries(core)) {
    const d = e.data as Record<string, unknown>;
    if (["tsconfig", "gomod", "gowork", "pubspec", "pysetup"].includes(e.kind)) parts.push(`${path}|${e.kind}|${JSON.stringify(d)}`);
    else if (e.kind === "npm") parts.push(`${path}|npm|${String(d.name ?? "")}|${String(d.main ?? "")}|${JSON.stringify(d.workspaces ?? null)}`);
    else if (["pyproject", "requirements", "pipfile"].includes(e.kind)) parts.push(`${path}|py`);
  }
  return parts.sort().join("\n");
}

/** A file's analysis: the symbols, the imports as written, the strings, the TODOs. */
function analyseFile(path: string, sha: string, text: string, ctx: SymbolContext): Analysed {
  const lang = languageOf(path);
  const symbols: SymbolInfo[] = withHashes(text, extractSymbols(path, lang, text, ctx));
  // Read by a parser, a file also says which names it refers to (the repo map's graph); read by a regex it does not.
  const refs = analyse(path, lang, text)?.refs;
  return {
    file: { path, blobSha: sha, lang, bytes: Buffer.byteLength(text, "utf8"), symbols, imports: [], rank: 0, hot: 0, todo: countTodos(text), tests: [], summary: "", ...(refs ? { refs } : {}) },
    raw: extractImports(path, lang, text),
    texts: extractTexts(path, lang, text).map((t) => ({ path, line: t.line, text: t.text, kind: t.kind })),
    text,
    redact: scanForSecrets([{ path, content: text }]).length > 0,
  };
}

/** A row for a file that was not read (tree-only): where it is and how big, nothing more. */
const stubOf = (c: Candidate): StoredFile => ({ path: c.path, blobSha: c.sha, lang: languageOf(c.path), bytes: c.size, symbols: [], imports: [], rank: 0, hot: 0, todo: 0, tests: [], summary: "" });

export interface BuildResult { row: BrainRow; mode: BuildMode; changed: number }

// ---------------------------------------------------------------------- build

/**
 * One build for a project. `userId` is its owner (the person, or the owner on
 * whose behalf a push is followed). Returns the saved row. Throws only for what
 * the caller should hear about (the project isn't theirs, or access is gone); any
 * other failure is saved as a failed row and returned. `base` is the row as it was
 * before this build was marked "building" (index.ts does that first, so that the
 * status is true at once); left out, it is read.
 */
export async function runBuild(
  deps: ProjectBrainDeps, userId: string, project: CodeProject, requested: BuildMode, base?: BrainRow | null,
): Promise<BuildResult> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const t0 = now();
  const gh: GithubApp = deps.projects.github;
  const call: CallFn = deps.call ?? (callModel as CallFn);
  const progress = async (pct: number, phase: string) => { try { await store.setProgress(project.id, { pct, phase }); } catch { /* progress is a courtesy */ } };

  try {
    await assertAccess(deps.projects, userId, project);
    const repo = repoRef(deps.projects, userId, project);
    await progress(5, "reading the tree");

    let tree: TreeInfo;
    try {
      tree = await fetchTree(gh, repo, project.defaultBranch);
    } catch (err) {
      if (err instanceof ConnectorError && (err.code === "not_found" || err.code === "conflict") && await gh.repoIsEmpty(repo).catch(() => false)) {
        return { row: await emptyRepo(deps, project), mode: "full", changed: 0 };
      }
      throw err;
    }

    // ---- what was kept
    // A row that says "building" and has a head is safe to build on: the rows are compared by their own shas, whatever stopped.
    const existing = base !== undefined ? base : await store.getBrain(project.id);
    let mode: BuildMode = requested === "incremental" && !!existing && existing.headSha !== "" ? "incremental" : "full";
    // Nothing has moved: the brain is as fresh as it was (a push that was already built marked it stale, and it is not any more).
    if (mode === "incremental" && existing!.headSha === tree.headSha && (existing!.status === "ready" || existing!.status === "stale")) {
      const row = await store.saveBrain(project.id, { status: "ready", progress: { pct: 100, phase: "ready" }, error: "" });
      return { row, mode, changed: 0 };
    }
    const [storedFiles, storedDirs] = existing
      ? await Promise.all([store.listFiles(project.id), store.listDirs(project.id)])
      : [[] as StoredFile[], [] as StoredDir[]];
    if (mode === "incremental" && !storedFiles.length) mode = "full";
    const treeOnlyBefore = mode === "incremental" && existing!.structure.mode === "tree_only";
    const oldSkipped = existing?.structure.skippedBlobs ?? {};
    const storedByPath = new Map(storedFiles.map((f) => [f.path, f]));

    // ---- which files are worth reading, and which differ from the kept ones
    const sel = selectFiles(tree, oldSkipped);
    const byPath = new Map(sel.candidates.map((c) => [c.path, c]));
    const stillBinary = Object.keys(oldSkipped).filter((p) => tree.files.get(p)?.sha === oldSkipped[p]);
    const diff: SnapshotDiff = diffSnapshots(
      {
        files: new Map<string, string>([...storedFiles.map((f): [string, string] => [f.path, f.blobSha]), ...Object.entries(oldSkipped)]),
        dirs: new Map(storedDirs.map((d): [string, string] => [d.path, d.treeSha])),
      },
      fingerprintOf(tree, [...byPath.keys(), ...stillBinary]),
    );
    const coreCandidates = sel.candidates.filter((c) => c.core);
    let core: Record<string, CoreEntry> = {};
    const changedSet = new Set(toRead(diff));
    if (mode === "incremental") {
      for (const c of coreCandidates) {
        const old = existing!.structure.core[c.path];
        if (old && old.sha === c.sha && !changedSet.has(c.path)) core[c.path] = old;
      }
    }

    // ---- the contents
    let wanted: Candidate[] = mode === "full" ? [...sel.candidates]
      : sel.candidates.filter((c) => (changedSet.has(c.path) || (c.core && !core[c.path])) && (!treeOnlyBefore || c.core));
    await progress(15, "reading the code");
    let contents: Contents = await fetchContents(gh, repo, tree.headSha, wanted, { tarball: mode === "full" || (!treeOnlyBefore && wanted.length > BLOBS_MAX) });
    const readCore = (c: Contents) => {
      for (const cand of coreCandidates) {
        const text = c.texts.get(cand.path);
        const kind = coreKindOf(cand.path);
        if (text !== undefined && kind) core[cand.path] = { sha: cand.sha, kind, data: extractCore(cand.path, kind, text) };
      }
    };
    readCore(contents);
    // A change to what imports resolve against: the kept imports can't be trusted, so read everything again.
    if (mode === "incremental" && !treeOnlyBefore && resolverSignature(core) !== resolverSignature(existing!.structure.core)) {
      deps.log?.info({ project: project.id }, "code project brain: a resolver file changed, building in full");
      mode = "full";
      core = {};
      wanted = [...sel.candidates];
      contents = await fetchContents(gh, repo, tree.headSha, wanted, { tarball: true });
      readCore(contents);
    }
    const treeOnly = contents.via === "tree_only" || treeOnlyBefore;
    const kept = mode === "incremental" ? existing : null;

    // ---- each file
    await progress(35, "reading each file");
    const nextRoots = nextRootsOf(core);
    // The parser's grammars for the languages this repo has, loaded now and not before (a repo with no Kotlin never loads Kotlin). A grammar that
    // cannot be had costs only its language: those files are read by regex, as they were before.
    let textBytes = 0;
    for (const t of contents.texts.values()) textBytes += t.length;
    treeSitter.disable(!getConfig().CODE_TREE_SITTER || (isWorkerRuntime() && textBytes > PARSER_WORKER_TEXT_MAX));
    const grammarsAt = now();
    const grammars = await ensureGrammars([...contents.texts.keys()].map((p) => ({ path: p, lang: languageOf(p) })));
    const parserStatus = treeSitter.status();
    deps.log?.info({ project: project.id, grammars, failed: Object.keys(parserStatus.failed), absent: parserStatus.absent, ms: now() - grammarsAt }, "code project brain: parser grammars");
    const analysed = new Map<string, Analysed>();
    let n = 0;
    for (const [path, text] of contents.texts) {
      const cand = byPath.get(path);
      if (!cand) continue;
      analysed.set(path, analyseFile(path, cand.sha, text, { nextRoots }));
      if (++n % 150 === 0) await yieldNow();
    }
    // Every readable file is in `all`: read now, kept from last time (same sha), or, tree-only, a row with no symbols.
    const all = new Map<string, StoredFile>();
    for (const c of sel.candidates) {
      const a = analysed.get(c.path);
      const old = storedByPath.get(c.path);
      if (a) {
        // A read file with the same sha as the kept one is the same file: the old line still describes it.
        if (old && old.blobSha === a.file.blobSha) a.file.summary = old.summary;
        all.set(c.path, a.file);
      } else if (old && old.blobSha === c.sha && mode === "incremental") all.set(c.path, { ...old });
      else if (treeOnly) all.set(c.path, old && old.blobSha === c.sha ? { ...old } : stubOf(c));
    }
    const allPaths = [...all.keys()].sort();

    // ---- the whole: imports, ranks, tests, history, structure, conventions, features
    await progress(50, "connecting the files");
    const resolver = buildResolver(allPaths, core);
    for (const a of analysed.values()) {
      const found = new Set<string>();
      for (const imp of a.raw) for (const f of resolveImport(resolver, imp, a.file.path, a.file.lang)) found.add(f);
      a.file.imports = [...found].filter((p) => all.has(p)).sort();
    }
    for (const f of all.values()) if (!analysed.has(f.path)) f.imports = f.imports.filter((p) => all.has(p));
    const edges = new Map<string, string[]>(allPaths.map((p) => [p, all.get(p)!.imports]));
    for (const [p, r] of rankFiles(allPaths, edges, isTestPath)) all.get(p)!.rank = r;

    const depNames = new Set<string>();
    for (const e of Object.values(core)) {
      const d = e.data as Record<string, unknown>;
      for (const k of ["deps", "devDeps", "dev", "requires", "gems", "packages"]) {
        for (const x of Array.isArray(d[k]) ? (d[k] as unknown[]) : []) {
          if (typeof x === "string") depNames.add(x); else if (Array.isArray(x) && typeof x[0] === "string") depNames.add(x[0]);
        }
      }
    }
    const testMap = buildTestMap(allPaths.map((p) => ({ path: p, lang: all.get(p)!.lang, imports: all.get(p)!.imports })), [...depNames], new Set(Object.values(core).map((e) => e.kind)));
    for (const p of allPaths) all.get(p)!.tests = testMap.testsFor.get(p) ?? [];

    await progress(58, "reading the history");
    let history: History = existing?.history ?? { commits: [], head: "" };
    let messages: string[] = [];
    try {
      const h = await collectHistory(gh, repo, project.defaultBranch, existing?.history ?? null);
      history = h.history;
      messages = h.messages;
    } catch {
      // The history is a nicety; a build without it is whole.
    }
    const agg = aggregateHistory(history);
    for (const p of allPaths) all.get(p)!.hot = agg.changes.get(p) ?? 0;
    let branches: string[] = [];
    try { branches = await gh.branchNames(repo); } catch { /* same */ }

    const skippedBlobs: Record<string, string> = {};
    for (const p of stillBinary) skippedBlobs[p] = oldSkipped[p]!;
    for (const [p, sha] of contents.binary) skippedBlobs[p] = sha;
    for (const p of Object.keys(skippedBlobs).slice(2000)) delete skippedBlobs[p];

    let structure: Structure = buildStructure({
      tree, core, lockfiles: sel.lockfiles, secretFiles: sel.secretFiles, skipped: sel.skipped,
      files: allPaths.map((p) => ({ path: p, lang: all.get(p)!.lang, symbols: all.get(p)!.symbols })),
      analysedCount: treeOnly ? analysed.size : allPaths.length, mode: treeOnly ? "tree_only" : "full",
      note: contents.note || (treeOnlyBefore ? existing!.structure.note : ""), skippedBlobs,
    });
    if (tree.truncated) structure.note = `${structure.note} GitHub cut the file listing short (a very large repo), so some files are missing.`.trim();
    const importantUntested = untestedImportant(allPaths.map((p) => ({ path: p, hot: all.get(p)!.hot, rank: all.get(p)!.rank, tests: all.get(p)!.tests, isTest: isTestPath(p), lang: all.get(p)!.lang })));
    structure = { ...structure, testing: { frameworks: testMap.frameworks, testFiles: testMap.testFiles.length, untestedHot: importantUntested } };

    // The style is sniffed from the best-connected source files read in a full build; an incremental one keeps what it found.
    const sample = [...analysed.values()].filter((a) => classOf(a.file.path) === "source" && !a.redact)
      .sort((x, y) => y.file.rank - x.file.rank).slice(0, 40).map((a) => ({ path: a.file.path, lang: a.file.lang, text: a.text }));
    const conventions = analyseConventions({
      paths: tree.files, core, depNames, languages: new Set(structure.languages.map((l) => l.lang)), sample, sniff: mode === "full", sourcePaths: allPaths,
      symbols: allPaths.map((p) => ({ lang: all.get(p)!.lang, symbols: all.get(p)!.symbols })), commits: messages, branches,
      defaultBranch: project.defaultBranch, prior: kept?.conventions ?? null,
    });

    // A few strings per file for the features: the new ones, and some of the kept.
    const sampleOf = new Map<string, string[]>();
    const gather = (t: StoredText) => { const l = sampleOf.get(t.path) ?? []; if (l.length < 3 && !l.includes(t.text)) l.push(t.text); sampleOf.set(t.path, l); };
    if (mode === "incremental") for (const t of await store.sampleTexts(project.id, 4000)) if (!analysed.has(t.path) && all.has(t.path)) gather(t);
    for (const a of analysed.values()) for (const t of a.texts) gather(t);

    let features = clusterFeatures({
      files: allPaths.map((p) => ({ path: p, symbols: all.get(p)!.symbols, summary: all.get(p)!.summary, rank: all.get(p)!.rank, imports: all.get(p)!.imports, isTest: isTestPath(p) })),
      texts: sampleOf, pairs: agg.pairs, packages: structure.monorepo?.packages ?? [],
    });
    // A cluster with the same files as last time keeps the name and line a model gave it.
    const priorByKey = new Map((existing?.features ?? []).filter((f) => f.key).map((f) => [f.key!, f]));
    const needLabel = new Set<string>();
    features = features.map((f) => {
      const old = f.key ? priorByKey.get(f.key) : undefined;
      if (old && sameJson(old.files, f.files)) return { ...f, name: old.name, summary: old.summary };
      if (f.key) needLabel.add(f.key);
      return f;
    });

    // ---- SAVED: the analysis is whole from here on
    await progress(70, "saving what was read");
    const hotspots = () => rankHotspots(allPaths.map((p) => ({ path: p, hot: all.get(p)!.hot, todo: all.get(p)!.todo, rank: all.get(p)!.rank, tests: all.get(p)!.tests })), agg.last, 12);
    const toWrite: StoredFile[] = [];
    for (const f of all.values()) {
      const old = storedByPath.get(f.path);
      if (!old || analysed.has(f.path) || old.rank !== f.rank || old.hot !== f.hot || !sameJson(old.tests, f.tests) || !sameJson(old.imports, f.imports)) toWrite.push(f);
    }
    const goneFiles = storedFiles.filter((f) => !all.has(f.path)).map((f) => f.path);

    // Folders with files under them. A folder keeps its line while nothing summarised under it changed.
    const dirSet = ancestorsOf(allPaths);
    const rolled = rollUp(diff);
    const storedDirBy = new Map(storedDirs.map((d) => [d.path, d]));
    const dirRows = new Map<string, StoredDir>();
    for (const d of dirSet) {
      const sha = tree.dirs.get(d);
      if (!sha) continue;
      const old = storedDirBy.get(d);
      const same = !!old && (old.treeSha === sha || !rolled.has(d));
      dirRows.set(d, { path: d, treeSha: sha, summary: same ? old.summary : "" });
    }
    const baseline = { plan: baselinePlan(structure.commands), recorded: existing?.baseline?.recorded ?? null };
    const project0 = { fullName: project.fullName, defaultBranch: project.defaultBranch };

    await store.upsertFiles(project.id, toWrite);
    if (goneFiles.length) await store.deleteFiles(project.id, goneFiles);
    await store.upsertDirs(project.id, [...dirRows.values()]);
    const goneDirs = storedDirs.filter((d) => !dirRows.has(d.path)).map((d) => d.path);
    if (goneDirs.length) await store.deleteDirs(project.id, goneDirs);
    const freshTexts = [...analysed.values()].flatMap((a) => a.texts).slice(0, TEXTS_PER_PROJECT);
    if (mode === "full") { await store.clearTexts(project.id); await store.replaceTexts(project.id, [], freshTexts); }
    else await store.replaceTexts(project.id, [...analysed.keys(), ...goneFiles], freshTexts);
    await store.saveBrain(project.id, {
      headSha: tree.headSha, treeSha: tree.treeSha, status: "building", structure, conventions, features, history, baseline, error: "",
      memory: memoryMarkdown({ project: project0, headSha: tree.headSha, structure, conventions, features, hotspots: hotspots(), baseline }),
      welcome: existing?.welcome ?? "",
    });

    // ---- the words
    await progress(85, "writing it down");
    const meter = new Meter(mode === "full" ? deps.budgetPaise : Math.ceil(deps.budgetPaise * INCREMENTAL_BUDGET_SHARE));
    const ctx: SummaryCtx = { call, gateway: deps.gateway, userId, meter };
    let anySummary = false;
    let complete = true;

    // Files that get a line: by rank, heat and entry points. A re-read one gets a new line; a kept one keeps its own.
    const entryPaths = new Set(structure.entryPoints.map((e) => e.path));
    const picked = pickForSummary(allPaths.map((p) => {
      const f = all.get(p)!;
      const klass = classOf(p);
      return {
        path: p, lang: f.lang, rank: f.rank, hot: f.hot, entry: entryPaths.has(p) || f.symbols.some((s) => s.kind === "entry"),
        routes: f.symbols.filter((s) => s.kind === "route").length, symbols: f.symbols.filter((s) => s.kind !== "env").length,
        isTest: isTestPath(p), kind: klass === "source" ? "source" as const : klass === "markup" ? "markup" as const : "other" as const,
      };
    }));
    const pickedSet = new Set(picked);
    for (const f of all.values()) if (f.summary && !pickedSet.has(f.path)) f.summary = "";
    const jobs: FileJob[] = picked.filter((p) => analysed.has(p) && !all.get(p)!.summary)
      .map((p) => { const a = analysed.get(p)!; return { path: p, lang: a.file.lang, text: a.text, symbols: a.file.symbols, redact: a.redact }; });
    const fileLines = await summarizeFiles(ctx, jobs, phaseCap(meter, "files"));
    for (const [p, s] of fileLines.summaries) { all.get(p)!.summary = s; anySummary = true; }
    if (picked.some((p) => !all.get(p)!.summary)) complete = false;
    if (picked.some((p) => all.get(p)!.summary)) anySummary = true;

    // Folders, deepest first, so a parent reads its children's lines.
    const childFiles = new Map<string, string[]>();
    const childDirs = new Map<string, string[]>();
    const weight = new Map<string, number>();
    for (const p of allPaths) {
      const d = dirName(p);
      const l = childFiles.get(d) ?? [];
      l.push(p);
      childFiles.set(d, l);
      for (const up of ancestorsOf([p])) weight.set(up, (weight.get(up) ?? 0) + all.get(p)!.rank + 0.01);
    }
    for (const d of dirSet) if (d) { const up = dirName(d); const l = childDirs.get(up) ?? []; l.push(d); childDirs.set(up, l); }
    const needsLine = [...dirRows.keys()].filter((d) => d !== "" && !dirRows.get(d)!.summary && depthOfDir(d) <= 3).filter((d) => {
      const own = childFiles.get(d) ?? [];
      return own.length >= 2 || own.some((p) => all.get(p)!.summary) || (childDirs.get(d) ?? []).length >= 1;
    });
    const chosen = needsLine.sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || (a < b ? -1 : 1)).slice(0, 60);
    const levels = new Map<number, string[]>();
    for (const d of chosen) { const k = depthOfDir(d); const l = levels.get(k) ?? []; l.push(d); levels.set(k, l); }
    const brief = (p: string) => {
      const f = all.get(p)!;
      return f.summary || f.symbols.filter((s) => s.kind !== "env" && s.exported !== false).slice(0, 4).map((s) => s.name).join(", ");
    };
    for (const depth of [...levels.keys()].sort((a, b) => b - a)) {
      const dirJobs: DirJob[] = levels.get(depth)!.map((d) => ({
        path: d,
        files: (childFiles.get(d) ?? []).sort((a, b) => all.get(b)!.rank - all.get(a)!.rank).slice(0, 20).map((p) => ({ name: baseName(p), summary: brief(p) })),
        dirs: (childDirs.get(d) ?? []).slice(0, 12).map((c) => ({ name: baseName(c), summary: dirRows.get(c)?.summary ?? "" })),
      }));
      const r = await summarizeDirs(ctx, dirJobs, phaseCap(meter, "dirs"));
      for (const [p, s] of r.summaries) { const row = dirRows.get(p); if (row) { row.summary = s; anySummary = true; } }
      if (!r.complete) complete = false;
    }

    // The features named, and the repo in two sentences.
    const toName = features.filter((f) => f.key && needLabel.has(f.key));
    if (toName.length) {
      const labelled = await labelFeatures(ctx, toName, phaseCap(meter, "rest"));
      if (labelled.labelled) anySummary = true; else complete = false;
      const byKey = new Map(labelled.features.map((f) => [f.key, f]));
      features = features.map((f) => (f.key && byKey.has(f.key) ? { ...f, name: byKey.get(f.key)!.name, summary: byKey.get(f.key)!.summary } : f));
    }
    const root = dirRows.get("");
    if (root && (!root.summary || rolled.has(""))) {
      const overview = await summarizeRepo(ctx, {
        name: project.fullName, readme: structure.readme ? { title: structure.readme.title, blurb: structure.readme.blurb } : null,
        languages: structure.languages.slice(0, 5).map((l) => l.lang), frameworks: structure.frameworks.slice(0, 8),
        folders: (childDirs.get("") ?? []).map((c) => ({ name: c, summary: dirRows.get(c)?.summary ?? "" })).slice(0, 20), features: features.slice(0, 8).map((f) => f.name),
      }, phaseCap(meter, "rest"));
      if (overview) { root.summary = overview; anySummary = true; } else complete = false;
    }

    // First tasks, from what was found and from the registries; then the welcome message.
    await progress(92, "checking dependencies");
    let notes: DepNote[] = [];
    try { notes = await checkDeps(declaredDeps(core), { fetchFn: deps.fetchFn, sources: deps.sources }); } catch { /* no registry, no dependency tasks */ }
    const hot = hotspots();
    const recorded = baseline.recorded;
    const tasks = suggestTasks({
      baseline: recorded ? recorded.results.map((r) => ({ kind: r.kind, ok: r.exitCode === 0, failing: r.failing ?? [] })) : null,
      hasTests: testMap.testFiles.length > 0, testFrameworks: testMap.frameworks, untestedImportant: importantUntested,
      todoHotspots: allPaths.map((p) => ({ path: p, todo: all.get(p)!.todo })).filter((x) => x.todo >= 3).sort((a, b) => b.todo - a.todo).slice(0, 3),
      deprecated: notes.filter((x) => x.deprecated).map((x) => ({ name: x.name, note: x.deprecated! })),
      behind: notes.filter((x) => x.behind && !x.deprecated).map((x) => ({ name: x.name, declared: x.declared, latest: x.latest })),
      fragile: hot.filter((h) => h.changes >= 3 && h.tests === 0).map((h) => ({ path: h.path, changes: h.changes })),
      hasCommands: { test: structure.commands.some((c) => c.kind === "test") },
    });
    const facts = {
      name: project.fullName, blurb: structure.readme?.blurb || structure.readme?.title || "",
      stack: [...structure.languages.slice(0, 3).map((l) => l.lang), ...structure.frameworks.slice(0, 5)],
      fileCount: structure.fileCount, analysed: structure.analysedCount,
      health: recorded ? (recorded.healthy ? "all checks passed" : "some checks fail") : structure.commands.some((c) => c.kind === "test") ? "not checked yet" : "no test command found",
      tasks,
    };
    const w = await welcomeMessage(ctx, facts, phaseCap(meter, "rest"));
    if (w.viaModel) anySummary = true; else if (meter.budget > 0) complete = false;

    // ---- kept
    await progress(96, "saving");
    const withLines = [...all.values()].filter((f) => f.summary !== (storedByPath.get(f.path)?.summary ?? "") || (analysed.has(f.path) && f.summary !== ""));
    await store.upsertFiles(project.id, withLines);
    await store.upsertDirs(project.id, [...dirRows.values()]);
    const row = await store.saveBrain(project.id, {
      status: "ready", progress: { pct: 100, phase: "ready" }, features, structure, baseline, welcome: w.text || fallbackWelcome(facts),
      memory: memoryMarkdown({ project: project0, headSha: tree.headSha, structure, conventions, features, hotspots: hot, baseline }),
      summariesState: !anySummary ? "none" : complete ? "complete" : "partial",
      spentPaise: (existing?.spentPaise ?? 0) + meter.spent, builtAt: now(), error: "",
    });
    deps.log?.info({ project: project.id, mode, files: allPaths.length, changed: analysed.size, via: contents.via, paise: meter.spent, calls: meter.calls, ms: now() - t0 }, "code project brain built");
    return { row, mode, changed: analysed.size };
  } catch (err) {
    // Not theirs, or no access any more: the caller hears it. Anything else is a failed build, in plain words.
    if (err instanceof ConnectorError && (err.code === "not_found" || err.code === "no_access" || err.code === "needs_reconnect" || err.code === "suspended")) {
      try { await store.saveBrain(project.id, { status: "failed", error: err.message, progress: { pct: 0, phase: "failed" } }); } catch { /* the original error is the one to throw */ }
      throw err;
    }
    deps.log?.warn({ project: project.id, error: (err as Error)?.name, code: (err as { code?: string })?.code }, "code project brain failed");
    const row = await store.saveBrain(project.id, { status: "failed", error: whyFailed(err), progress: { pct: 0, phase: "failed" } });
    return { row, mode: requested, changed: 0 };
  }
}

/** A repo with no commits: nothing to read, and a message that says what to do. */
async function emptyRepo(deps: ProjectBrainDeps, project: CodeProject): Promise<BrainRow> {
  const now = deps.now ?? Date.now;
  await deps.store.clearTexts(project.id);
  const prior = await deps.store.listFiles(project.id);
  if (prior.length) await deps.store.deleteFiles(project.id, prior.map((f) => f.path));
  return deps.store.saveBrain(project.id, {
    headSha: "", treeSha: "", status: "ready", progress: { pct: 100, phase: "ready" }, structure: { ...EMPTY_STRUCTURE, note: "This repo has no commits yet." } as Structure,
    features: [], memory: "", summariesState: "none", error: "", builtAt: now(),
    welcome: "This repo has no commits yet, so there is nothing to read. Ask me to start it with a README, or push something first and I will learn it.",
  });
}
