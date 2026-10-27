/**
 * FETCHING THE CODE: THE TREE, THEN THE TEXT OF THE FILES WORTH READING, IN THE FEWEST REQUESTS.
 *
 * Two kinds of fetch, in this order:
 *
 *   the tree      `GET .../git/trees/{sha}?recursive=1`: every path with its git
 *                 sha (a file's blob, a folder's tree) and size. Three calls with
 *                 the branch and its commit (github.ts snapshotTree). It costs
 *                 nothing to read and says what is in the repo, what changed
 *                 since last time (merkle.ts), and which files are worth the
 *                 second fetch;
 *   the contents  ONE request for the whole repo, `GET .../tarball/{sha}`
 *                 (redirected to codeload), streamed through gunzip into
 *                 tar.ts. Or, for an incremental build with few changed files,
 *                 one `git/blobs/{sha}` each.
 *
 * WHAT IS READ. Only files that carry meaning, chosen from the tree before
 * anything is downloaded: not vendored or output folders (node_modules, vendor,
 * dist, build, out, .next, target, coverage, __pycache__, .git and the like), not
 * generated or minified files, not source maps, not lockfiles (their existence
 * is recorded: they say which package manager), not binaries (a NUL in the
 * first 8 KB, or a binary extension), not files over 512 KB. Caps: 20,000 files
 * and 60 MB of text in memory, the most useful first (manifests and docs, then
 * source, then tests, then the rest). A tarball over 300 MB compressed (or one
 * that inflates past 2 GB) is not read at all: the build falls back to
 * TREE-ONLY mode, where the tree and the few core files (manifests, configs,
 * docs), fetched one by one, are all there is.
 *
 * WHAT IS NEVER KEPT. A `.env` file, a key, a certificate, a credentials file:
 * only that it exists is recorded (its path). `.env.example` is documentation,
 * and is read, but values after `=` are dropped the moment it is decoded, so
 * only the names of the variables are ever held.
 *
 * Nothing here logs a path or a byte of a file.
 */
import { ConnectorError } from "../../connectors/state.js";
import type { GithubApp, RepoRef, TreeEntry } from "../github.js";
import {
  baseName, depthOf, isBinaryPath, isEnvExample, isGeneratedPath, isLockfile, isReadable, isSecretPath, isTestPath, isVendoredPath,
} from "./lang.js";
import { TarError, gunzipStream, readTar } from "./tar.js";
import {
  BINARY_SNIFF_BYTES, BLOB_CONCURRENCY, FILES_MAX, FILE_READ_MAX, TARBALL_EXPANDED_MAX_BYTES, TARBALL_MAX_BYTES, TEXT_MAX_BYTES,
  type Structure, type TreeInfo,
} from "./types.js";

// ------------------------------------------------------------------ the tree

/** The tree as the brain keeps it: files and folders by path, each with its sha. Submodules and symlinks are not files of ours. */
export function treeFromEntries(headSha: string, treeSha: string, entries: readonly TreeEntry[], truncated: boolean): TreeInfo {
  const files = new Map<string, { sha: string; size: number }>();
  const dirs = new Map<string, string>([["", treeSha]]);
  for (const e of entries) {
    if (e.type === "tree") dirs.set(e.path, e.sha);
    else if (e.type === "blob") files.set(e.path, { sha: e.sha, size: e.size ?? 0 });
  }
  return { headSha, treeSha, files, dirs, truncated };
}

/** The branch's tree. */
export async function fetchTree(github: GithubApp, repo: RepoRef, branch: string): Promise<TreeInfo> {
  const t = await github.snapshotTree(repo, branch);
  return treeFromEntries(t.headSha, t.treeSha, t.entries, t.truncated);
}

// ------------------------------------------------------------ the core files

/**
 * The files that say what a project IS rather than what it does: manifests,
 * workspace and compiler settings, formatter configs, the README and the agent
 * docs, Docker and Make. What each says is kept (structure.core) keyed by its
 * blob sha, so a build re-reads only the ones that changed. Returns a short
 * name for what it is, or null.
 */
export function coreKindOf(path: string): string | null {
  const b = baseName(path).toLowerCase();
  const lower = path.toLowerCase();
  if (b === "package.json") return "npm";
  if (/^tsconfig(?:\.[\w-]+)?\.json$/.test(b) || /^jsconfig(?:\.[\w-]+)?\.json$/.test(b)) return "tsconfig";
  if (/^requirements[\w.-]*\.txt$/.test(b) || /^constraints[\w.-]*\.txt$/.test(b)) return "requirements";
  if (b === "pyproject.toml") return "pyproject";
  if (b === "pipfile") return "pipfile";
  if (b === "setup.py" || b === "setup.cfg") return "pysetup";
  if (b === "go.mod") return "gomod";
  if (b === "go.work") return "gowork";
  if (b === "cargo.toml") return "cargo";
  if (b === "pubspec.yaml") return "pubspec";
  if (b === "gemfile") return "gemfile";
  if (b === "composer.json") return "composer";
  if (b === "build.gradle" || b === "build.gradle.kts") return "gradle";
  if (b === "settings.gradle" || b === "settings.gradle.kts") return "gradle-settings";
  if (b === "pom.xml") return "maven";
  if (b === "package.swift") return "swiftpm";
  if (b.endsWith(".csproj") || b.endsWith(".fsproj")) return "dotnet";
  if (b === "makefile" || b === "gnumakefile") return "make";
  if (b === "dockerfile" || b.startsWith("dockerfile.")) return "docker";
  if (/^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/.test(b)) return "compose";
  if (/^readme(?:\.[a-z]+)?$/.test(b)) return "readme";
  if (b === "claude.md" || b === "agents.md" || b === ".cursorrules" || b === "contributing.md" || lower.endsWith(".github/copilot-instructions.md")) return "agent-doc";
  if (isEnvExample(path)) return "env-example";
  if (b === "pnpm-workspace.yaml" || b === "lerna.json" || b === "nx.json" || b === "turbo.json") return "workspace";
  if (b === ".editorconfig" || b === "biome.json") return "editor";
  if (/^\.prettierrc(?:\.(?:json|ya?ml|json5))?$/.test(b) || /^prettier\.config\./.test(b)) return "prettier";
  if (/^\.eslintrc/.test(b) || /^eslint\.config\./.test(b)) return "eslint";
  return null;
}

/** Core files read from a tree, at most this many (shallow first): a monorepo has hundreds of package.json. */
export const CORE_FILES_MAX = 150;

// ------------------------------------------------------------------ choosing

export interface Candidate { path: string; sha: string; size: number; core: boolean }

export interface Selection {
  candidates: Candidate[];
  lockfiles: string[];
  secretFiles: string[];
  skipped: Structure["skipped"];
}

/** The first line of defence for the sizes: nothing over 512 KB is read, and nothing empty. */
const readableSize = (n: number) => n > 0 && n <= FILE_READ_MAX;

/**
 * What to fetch, from the tree alone. `known` are files already read and found
 * to be binary (their sha, so they are not fetched again). The most useful files
 * come first when a cap forces a choice.
 */
export function selectFiles(tree: TreeInfo, known: Readonly<Record<string, string>> = {}): Selection {
  const skipped: Structure["skipped"] = { vendored: 0, generated: 0, binary: 0, tooBig: 0, lockfiles: 0, secret: 0, capped: 0 };
  const lockfiles: string[] = [];
  const secretFiles: string[] = [];
  const pool: Array<Candidate & { rankKey: number }> = [];

  for (const [path, f] of tree.files) {
    if (isVendoredPath(path)) { skipped.vendored += 1; continue; }
    if (isSecretPath(path)) { secretFiles.push(path); skipped.secret += 1; continue; }
    if (isLockfile(path)) { lockfiles.push(path); skipped.lockfiles += 1; continue; }
    if (isGeneratedPath(path)) { skipped.generated += 1; continue; }
    if (isBinaryPath(path)) { skipped.binary += 1; continue; }
    if (!isReadable(path)) continue;
    if (f.size > FILE_READ_MAX) { skipped.tooBig += 1; continue; }
    if (!readableSize(f.size)) continue;
    if (known[path] === f.sha) { skipped.binary += 1; continue; }
    const core = coreKindOf(path) !== null;
    // Core first, then source, then tests, then the rest; nearer the root first, then smaller.
    const klass = core ? 0 : isTestPath(path) ? 2 : /\.(?:md|mdx|txt|rst|json|ya?ml|toml|xml|html?|css|scss|less)$/i.test(path) ? 3 : 1;
    pool.push({ path, sha: f.sha, size: f.size, core, rankKey: klass * 1000 + Math.min(depthOf(path), 99) * 10 });
  }
  pool.sort((a, b) => a.rankKey - b.rankKey || a.size - b.size || (a.path < b.path ? -1 : 1));

  const candidates: Candidate[] = [];
  let bytes = 0;
  let cores = 0;
  for (const c of pool) {
    if (c.core && cores >= CORE_FILES_MAX) { skipped.capped += 1; continue; }
    if (candidates.length >= FILES_MAX || bytes + c.size > TEXT_MAX_BYTES) { skipped.capped += 1; continue; }
    if (c.core) cores += 1;
    bytes += c.size;
    candidates.push({ path: c.path, sha: c.sha, size: c.size, core: c.core });
  }
  lockfiles.sort();
  secretFiles.sort();
  return { candidates, lockfiles, secretFiles, skipped };
}

// ----------------------------------------------------------------- decoding

/** The bytes of a file as text, or null when it is binary: a NUL in the first 8 KB. A byte-order mark and CRs are dropped; lines are kept as they were. */
export function decodeText(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, BINARY_SNIFF_BYTES);
  if (head.includes(0)) return null;
  let text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/**
 * `.env.example` as the names of its variables and nothing else: every value
 * after `=` is gone before the text is held. A person's example file is meant to
 * be harmless; this does not rely on it.
 */
export function namesOnly(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    if (m) out.push(`${m[1]}=`);
  }
  return out.join("\n");
}

// ----------------------------------------------------------------- contents

export interface Contents {
  /** The text of each file read. */
  texts: Map<string, string>;
  /** Files read and found binary, with their sha. */
  binary: Map<string, string>;
  /** How the contents came: the tarball, blob by blob, or not at all (tree-only). */
  via: "tarball" | "blobs" | "tree_only";
  /** Why a build is tree-only, in plain words. */
  note: string;
}

const keep = (texts: Map<string, string>, binary: Map<string, string>, c: Candidate, bytes: Uint8Array) => {
  const text = decodeText(bytes);
  if (text === null) { binary.set(c.path, c.sha); return; }
  texts.set(c.path, isEnvExample(c.path) ? namesOnly(text) : text);
};

/** `fn` over `items`, at most `limit` at a time, in order. */
async function inParallel<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]!); }
  }));
}

/** Blob by blob: for an incremental build with few changes, and for the core files of a tree-only one. */
export async function fetchBlobs(github: GithubApp, repo: RepoRef, wanted: readonly Candidate[]): Promise<Contents> {
  const texts = new Map<string, string>();
  const binary = new Map<string, string>();
  await inParallel(wanted, BLOB_CONCURRENCY, async (c) => {
    let bytes: Buffer;
    try {
      bytes = await github.blobBytes(repo, c.sha);
    } catch (err) {
      // A file that went (or can't be had) is a file not read; a dead connection is the build's to hear about.
      if (err instanceof ConnectorError && (err.code === "not_found" || err.code === "rejected" || err.code === "too_large")) return;
      throw err;
    }
    keep(texts, binary, c, bytes);
  });
  return { texts, binary, via: "blobs", note: "" };
}

/**
 * The tarball for a commit, streamed, with only the wanted files kept. The
 * archive's top folder (owner-repo-sha7/) is dropped from every path. Throws
 * TarError for an archive that is too big, bomb-like or broken, and a
 * ConnectorError when GitHub won't give it; the caller turns both into tree-only.
 */
export async function fetchTarball(github: GithubApp, repo: RepoRef, sha: string, wanted: readonly Candidate[]): Promise<Contents> {
  const want = new Map(wanted.map((c) => [c.path, c]));
  const texts = new Map<string, string>();
  const binary = new Map<string, string>();
  const res = await github.downloadTarball(repo, sha);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > TARBALL_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new TarError("compressed_too_large");
  }
  const stream = gunzipStream(res.body!, { maxCompressed: TARBALL_MAX_BYTES });
  const entries = readTar(stream, {
    maxExpanded: TARBALL_EXPANDED_MAX_BYTES,
    want: (e) => want.has(stripTop(e.path) ?? ""),
  });
  try {
    for await (const e of entries) {
      if (e.kind !== "file" || !e.data) continue;
      const path = stripTop(e.path);
      const c = path === null ? undefined : want.get(path);
      if (c) keep(texts, binary, c, e.data);
    }
  } catch (err) {
    // Not gzip, cut short, a dropped connection or a timeout: the download failed, which is tree-only's cue, not a bug.
    if (isStreamFailure(err)) throw new TarError("truncated");
    throw err;
  }
  return { texts, binary, via: "tarball", note: "" };
}

/** An error from reading a download (zlib, the socket, an abort), as opposed to one of ours. */
function isStreamFailure(err: unknown): boolean {
  const e = err as { name?: string; code?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  return e?.name === "AbortError" || e?.name === "TimeoutError" || /^(?:Z_|ERR_STREAM|ECONN|EPIPE|ETIMEDOUT|UND_ERR)/.test(code);
}

/** A tarball path without its top folder, or null for one that has none or tries to leave the repo. */
export function stripTop(path: string): string | null {
  const i = path.indexOf("/");
  if (i <= 0) return null;
  const rest = path.slice(i + 1);
  if (!rest || rest.startsWith("/") || rest.split("/").some((p) => p === ".." || p === "." || p === "")) return null;
  return rest;
}

/** Why a read of the tarball failed, in words for a person. */
function whyNotTarball(err: unknown): string {
  if (err instanceof TarError) {
    return err.code === "compressed_too_large" || err.code === "expanded_too_large"
      ? "This repo is too big to read in full (over 300 MB), so Tailzu read its structure and its manifests only."
      : "The download of the code was cut short, so Tailzu read its structure and its manifests only.";
  }
  return "GitHub wouldn't hand over the code in one piece, so Tailzu read its structure and its manifests only.";
}

export interface FetchOptions {
  /** Take the tarball even for a few files (a full build, or an incremental one with many changes). */
  tarball: boolean;
}

/**
 * The contents of `wanted`. By the tarball (one request) or, when `o.tarball`
 * is false, by blob; and when the tarball can't be had, the core files alone by
 * blob (TREE-ONLY), with the reason. A real failure of GitHub (auth, a dead
 * connection) is thrown, not hidden as tree-only.
 */
export async function fetchContents(
  github: GithubApp, repo: RepoRef, sha: string, wanted: readonly Candidate[], o: FetchOptions,
): Promise<Contents> {
  if (!wanted.length) return { texts: new Map(), binary: new Map(), via: o.tarball ? "tarball" : "blobs", note: "" };
  if (!o.tarball) return fetchBlobs(github, repo, wanted);
  try {
    return await fetchTarball(github, repo, sha, wanted);
  } catch (err) {
    const tooBig = err instanceof TarError;
    const refused = err instanceof ConnectorError && err.code !== "github_auth" && err.code !== "needs_signin" && err.code !== "org_blocked" && err.code !== "busy";
    if (!tooBig && !refused) throw err;
    const got = await fetchBlobs(github, repo, wanted.filter((c) => c.core));
    return { ...got, via: "tree_only", note: whyNotTarball(err) };
  }
}
