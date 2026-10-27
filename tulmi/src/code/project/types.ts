/**
 * THE WORDS THE PROJECT BRAIN IS BUILT FROM: WHAT IT KNOWS ABOUT A REPO, AND THE NUMBERS THAT BOUND IT.
 *
 * (Layer 4. `code/brain/` is the MODEL layer, the door to a model and its
 * money; this directory is what the bot knows about one project, and docs/
 * code-project-brain.md is the story.)
 *
 * A project's understanding has four parts, in the order it is built:
 *
 *   the tree        every path in the repo with its git sha (a file's blob, a
 *                   folder's tree). It is the Merkle tree the next build is
 *                   compared against (merkle.ts) and costs three calls
 *   the files       what could be read of the files worth reading: symbols,
 *                   routes, imports, the strings a person sees, TODOs. No model
 *   the shape       languages, frameworks, commands, conventions, tests, hot
 *                   areas, features. No model
 *   the words       one or two lines for the files that matter, for the
 *                   folders, and for the repo; a feature map; a welcome. A
 *                   cheap model, on a budget, and the rest stands without it
 *
 * Nothing in this file reaches a network or a store.
 */

// ------------------------------------------------------------------ numbers

/** A tarball bigger than this (compressed) is not read: the build falls back to the tree alone. */
export const TARBALL_MAX_BYTES = 300 * 1024 * 1024;
/** ...and one that inflates past this is the same (a bomb is a few kilobytes of gzip). */
export const TARBALL_EXPANDED_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Files analysed, and the text kept in memory for them. */
export const FILES_MAX = 20_000;
export const TEXT_MAX_BYTES = 60 * 1024 * 1024;
/** A file bigger than this is not read. */
export const FILE_READ_MAX = 512 * 1024;
/**
 * On a Cloudflare Worker (128 MB for the isolate) a build that holds more text than this in memory does not also load the parser: the engine and one
 * grammar take about 40 MB of it (measured in workerd, jobs/src/grammars.ts), and the build's text is the larger part of what the isolate holds. Such a
 * repo is read by the regexes, as it was before the parser.
 */
export const PARSER_WORKER_TEXT_MAX = 32 * 1024 * 1024;
/** The first bytes looked at for a NUL, which makes a file binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;
/** An incremental build with this many changed files or fewer asks for the blobs one by one; more takes the tarball again. */
export const BLOBS_MAX = 200;
/** Blob requests in flight at once. */
export const BLOB_CONCURRENCY = 6;
/** Commits looked at for hotspots, requests in flight at once, and the GitHub rate limit under which looking stops. */
export const COMMITS_MAX = 100;
export const COMMIT_CONCURRENCY = 4;
export const RATE_FLOOR = 500;
/** Commit messages the commit style is read from. */
export const COMMIT_STYLE_SAMPLE = 30;
/** Files that get a model's one or two lines, and files sent to a model in one call. */
export const SUMMARY_FILES_MAX = 150;
export const SUMMARY_BATCH = 10;
/** What a model sees of one file. */
export const EXCERPT_CHARS = 2500;
/** Registry lookups for the welcome summary. */
export const REGISTRY_LOOKUPS_MAX = 15;
/** The welcome summary. */
export const WELCOME_CHARS = 900;
/** Visible strings kept per file and per project. */
export const TEXTS_PER_FILE = 200;
export const TEXTS_PER_PROJECT = 30_000;
/** Symbols kept per file. */
export const SYMBOLS_PER_FILE = 120;
/** Names a file refers to that are kept for the repo map (the definition/reference graph), most telling first. */
export const REFS_PER_FILE = 120;
/** A project's rules, from the agent docs the repo already has: per document and in all. */
export const RULES_DOC_CHARS = 6000;
export const RULES_TOTAL_CHARS = 16_000;
/** The memory file (TAILZU.md content). */
export const MEMORY_CHARS = 24_000;
/** A build that has not moved for this long, with nothing running it, is taken for dead. */
export const BUILD_DEAD_MS = 15 * 60_000;
/** A push is waited on this long for the next one before the build starts. */
export const PUSH_DEBOUNCE_MS = 60_000;
/** The default for CODE_IMPORT_BUDGET_PAISE. */
export const IMPORT_BUDGET_DEFAULT = 1000;

// --------------------------------------------------------------- the files

export type SymbolKind =
  | "function" | "method" | "class" | "interface" | "type" | "enum" | "struct" | "trait" | "const" | "component" | "module"
  | "route" | "env" | "entry";

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  line: number;
  /** Visible from outside the file (export, pub, capitalised in Go...). Absent for routes, env names and entry marks. */
  exported?: boolean;
  /** A route: the verb ("GET", "ANY"...) and the path as written. */
  method?: string;
  path?: string;
  /** The last line of the definition, when a parser read the file (tree-sitter). Absent when a regex did: a regex knows where a thing starts, not where it ends. */
  endLine?: number;
}

/** What a file is, by its path. */
export type FileClass = "source" | "test" | "config" | "doc" | "markup" | "style" | "data";

/** One analysed file, as it is kept (code_brain_files). */
export interface StoredFile {
  path: string;
  blobSha: string;
  lang: string;
  bytes: number;
  symbols: SymbolInfo[];
  /** The files of this repo it imports, resolved, repo-relative. */
  imports: string[];
  /** 0 to 1: how central it is in the import graph. */
  rank: number;
  /** Times it changed in the commits looked at. */
  hot: number;
  /** TODO, FIXME and HACK markers. */
  todo: number;
  /** The test files that cover it. */
  tests: string[];
  summary: string;
  /**
   * The names it refers to (calls, new, types, JSX tags, base classes) with how often, when a parser read it: the references half of the repo
   * map's definition/reference graph (repomap.ts). Names, not files: which file a name means is decided when the map is made, against the
   * definitions the repo has by then, so a file added later is found by files that were not rebuilt. Absent when a regex read the file.
   */
  refs?: Array<[string, number]>;
}

export interface StoredDir { path: string; treeSha: string; summary: string }

/** The kinds of visible text. */
export type TextKind = "jsx" | "attr" | "html" | "template" | "i18n" | "flutter" | "android" | "ios" | "string";
export interface StoredText { path: string; line: number; text: string; kind: TextKind }

// ----------------------------------------------------------------- the tree

export interface TreeFile { sha: string; size: number }

/** A repo's tree: what is in it and the sha of each thing (merkle.ts takes it from here). */
export interface TreeInfo {
  headSha: string;
  treeSha: string;
  /** Every file by path. */
  files: Map<string, TreeFile>;
  /** Every folder by path ("" is the root) with its tree sha. */
  dirs: Map<string, string>;
  /** GitHub cut the listing short: what is here is not the whole repo. */
  truncated: boolean;
}

// ---------------------------------------------------------------- structure

export interface LanguageShare { lang: string; bytes: number; files: number; pct: number }

export type CommandKind = "install" | "dev" | "build" | "test" | "lint" | "typecheck" | "format" | "run";
export interface Command { kind: CommandKind; cmd: string; cwd: string; source: string }

export interface PackageInfo { path: string; name?: string; kind: string }

/**
 * What one core file (a manifest, a config, a doc) told us, keyed by the file's
 * blob sha: an unchanged sha means the same facts, so a build reads only the
 * ones that changed.
 */
export interface CoreEntry { sha: string; kind: string; data: Record<string, unknown> }

export interface Structure {
  /** "full": the code was read. "tree_only": only the tree and the core files were (a huge repo, or a download that failed). */
  mode: "full" | "tree_only";
  /** Why a build is less than whole, in plain words, or "". */
  note: string;
  fileCount: number;
  analysedCount: number;
  totalBytes: number;
  languages: LanguageShare[];
  packageManagers: string[];
  lockfiles: string[];
  frameworks: string[];
  monorepo: { tool: string; packages: PackageInfo[] } | null;
  entryPoints: Array<{ path: string; why: string }>;
  commands: Command[];
  ci: string[];
  envVars: Array<{ name: string; example: boolean; uses: number }>;
  docker: { files: string[]; images: string[]; ports: number[]; services: string[] };
  readme: { path: string; title: string; blurb: string } | null;
  /** Files that hold secrets, by path only: their contents were never read. */
  secretFiles: string[];
  skipped: { vendored: number; generated: number; binary: number; tooBig: number; lockfiles: number; secret: number; capped: number };
  testing: { frameworks: string[]; testFiles: number; untestedHot: string[] };
  /** Internal: what each core file said. */
  core: Record<string, CoreEntry>;
  /** Internal: files read and found to be binary, with their sha, so they are not fetched again. */
  skippedBlobs: Record<string, string>;
}

export const EMPTY_STRUCTURE: Readonly<Structure> = {
  mode: "full", note: "", fileCount: 0, analysedCount: 0, totalBytes: 0, languages: [], packageManagers: [], lockfiles: [], frameworks: [],
  monorepo: null, entryPoints: [], commands: [], ci: [], envVars: [], docker: { files: [], images: [], ports: [], services: [] }, readme: null,
  secretFiles: [], skipped: { vendored: 0, generated: 0, binary: 0, tooBig: 0, lockfiles: 0, secret: 0, capped: 0 },
  testing: { frameworks: [], testFiles: 0, untestedHot: [] }, core: {}, skippedBlobs: {},
};

/** The structure without the parts that are the build's own bookkeeping. */
export function publicStructure(s: Structure): Omit<Structure, "core" | "skippedBlobs"> {
  const { core: _core, skippedBlobs: _skipped, ...rest } = s;
  void _core; void _skipped;
  return rest;
}

// -------------------------------------------------------------- conventions

export interface Conventions {
  formatter: string[];
  linter: string[];
  configs: string[];
  style: {
    indent: string | null;
    quotes: "single" | "double" | null;
    semicolons: boolean | null;
    fileNames: string | null;
    identifiers: string | null;
    sampled: number;
  };
  commits: { style: "conventional" | "freeform" | "unknown"; conventionalPct: number; scopes: string[]; examples: string[]; sampled: number };
  branches: { default: string; naming: string | null; examples: string[] };
  /** The agent docs the repo already has, kept verbatim and capped: the project's rules. */
  rules: Array<{ path: string; text: string; truncated: boolean }>;
}

export const EMPTY_CONVENTIONS: Readonly<Conventions> = {
  formatter: [], linter: [], configs: [],
  style: { indent: null, quotes: null, semicolons: null, fileNames: null, identifiers: null, sampled: 0 },
  commits: { style: "unknown", conventionalPct: 0, scopes: [], examples: [], sampled: 0 },
  branches: { default: "", naming: null, examples: [] },
  rules: [],
};

// ----------------------------------------------------------------- features

export interface Feature {
  /** The cluster's own name from features.ts, kept when a model renames it, so a later build can tell it is the same one. */
  key?: string;
  name: string;
  summary: string;
  /** Up to 80 of them; `fileCount` is how many there are. */
  files: string[];
  fileCount: number;
  routes: string[];
  /** A sample of what a person sees in it. */
  texts: string[];
}

// ---------------------------------------------------------------- hotspots

export interface CommitRecord { sha: string; at: number; files: string[] }

export interface History {
  /** The newest commits looked at, newest first, each with the files it touched (capped). */
  commits: CommitRecord[];
  /** The head the list was taken from. */
  head: string;
}

export interface Hotspot { path: string; changes: number; lastAt: number; todo: number; tests: number; rank: number; score: number }

// ----------------------------------------------------------------- baseline

export type BaselineKind = "install" | "typecheck" | "lint" | "test" | "build";
export interface BaselineStep { kind: BaselineKind; cmd: string; cwd: string }
export interface BaselineResult { kind: BaselineKind; exitCode: number; durationMs: number; summary: string; failing?: string[] }

export interface Baseline {
  /** The plan: what to run, from the scripts that were found. */
  plan: BaselineStep[];
  /** What running it said, once someone has (recordBaseline). */
  recorded: { headSha: string; at: number; results: BaselineResult[]; healthy: boolean } | null;
}

// ------------------------------------------------------------- the whole row

export type BrainStatus = "building" | "ready" | "failed" | "stale";
export type SummariesState = "none" | "partial" | "complete";
export interface Progress { pct: number; phase: string }

export interface BrainRow {
  projectId: string;
  headSha: string;
  treeSha: string;
  status: BrainStatus;
  progress: Progress;
  structure: Structure;
  conventions: Conventions;
  features: Feature[];
  memory: string;
  welcome: string;
  summariesState: SummariesState;
  baseline: Baseline | null;
  history: History;
  spentPaise: number;
  builtAt: number | null;
  error: string;
  updatedAt: number;
}

/** What a build reports to whoever asked. */
export interface BrainView {
  /** "none": never built. */
  status: BrainStatus | "none";
  progress: Progress;
  headSha: string;
  builtAt: number | null;
  summaries: SummariesState;
  welcome: string;
  structure: Omit<Structure, "core" | "skippedBlobs"> | null;
  features: Feature[];
  conventions: Conventions | null;
  baseline: Baseline | null;
  spentPaise: number;
  error: string;
}
