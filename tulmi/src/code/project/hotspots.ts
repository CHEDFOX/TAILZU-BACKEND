/**
 * WHERE THE CHANGES HAPPEN: THE FILES THAT KEEP BEING TOUCHED, AND WHAT MOVES WITH WHAT.
 *
 * A file that changed twelve times in the last hundred commits is a file that
 * is being worked on (or that keeps breaking), and the files that change in the
 * same commits are bound to each other whether or not they import each other.
 * Both are read from git's history:
 *
 *   GET /repos/{o}/{r}/commits?per_page=100       the newest hundred commits
 *   GET /repos/{o}/{r}/commits/{sha}              the files each touched
 *
 * one request a commit, FOUR AT A TIME, at most a hundred, and it STOPS when
 * GitHub says fewer than 500 requests are left in the hour (X-RateLimit-
 * Remaining), keeping what it has. A commit already looked at in an earlier
 * build is not looked at again: the history is kept (code_brain.history) with
 * each commit's files, so a build after a push costs the new commits only. A
 * commit that touched more than 40 files (the first, a rename, a reformat) is
 * kept with no files at all: it says nothing about what keeps changing.
 *
 * Counts, per file: how many of those commits touched it, and when last. TODO,
 * FIXME and HACK markers per file are counted from the code when it is read
 * (symbols.ts countTodos) and kept in the file's row.
 *
 * Nothing here logs a path or a message.
 */
import type { GithubApp, RepoRef } from "../github.js";
import { classOf, isGeneratedPath, isLockfile, isTestPath, isVendoredPath } from "./lang.js";
import { COMMITS_MAX, COMMIT_CONCURRENCY, RATE_FLOOR, type CommitRecord, type Hotspot, type History } from "./types.js";

/** Files kept per commit. */
export const COMMIT_FILES_KEPT = 40;
/** A commit with more files than this says nothing about what changes together. */
const CO_CHANGE_MAX_FILES = 30;

export interface HistoryResult {
  history: History;
  /** First lines of the commit messages, newest first (the commit style is read from these). */
  messages: string[];
  /** Looking stopped because GitHub's rate limit fell under the floor. */
  stoppedByRate: boolean;
  /** Requests GitHub last said were left, or null. */
  rateRemaining: number | null;
  /** Commits looked at in this call (not the ones remembered). */
  fetched: number;
}

export interface HistoryOptions {
  max?: number;
  concurrency?: number;
  /** Stop when GitHub says fewer than this many requests are left. */
  floor?: number;
}

/**
 * The history of a branch: its newest commits and the files each touched. The
 * ones in `prior` are reused; only new ones are asked about. Never throws for a
 * commit it can't read (it is skipped); a list it can't get at all throws.
 */
export async function collectHistory(
  github: Pick<GithubApp, "recentCommits" | "commitFiles">, repo: RepoRef, branch: string, prior: History | null, o: HistoryOptions = {},
): Promise<HistoryResult> {
  const max = Math.min(o.max ?? COMMITS_MAX, COMMITS_MAX);
  const floor = o.floor ?? RATE_FLOOR;
  const list = (await github.recentCommits(repo, branch, max)).slice(0, max);
  const known = new Map((prior?.commits ?? []).map((c) => [c.sha, c]));
  const fresh = list.filter((c) => !known.has(c.sha));

  const got = new Map<string, CommitRecord>();
  let stopped = false;
  let remaining: number | null = null;
  let next = 0;
  const worker = async () => {
    while (next < fresh.length && !stopped) {
      const c = fresh[next++]!;
      try {
        const r = await github.commitFiles(repo, c.sha);
        // A commit that touched more than 40 files (the first one, a rename, a reformat) says nothing about what changes: it is kept, empty.
        got.set(c.sha, { sha: c.sha, at: c.at, files: r.truncated || r.files.length > COMMIT_FILES_KEPT ? [] : r.files });
        if (r.rateRemaining !== null) {
          remaining = remaining === null ? r.rateRemaining : Math.min(remaining, r.rateRemaining);
          if (r.rateRemaining < floor) stopped = true;
        }
      } catch {
        // A commit that can't be read is left out; the next build tries it again.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? COMMIT_CONCURRENCY, fresh.length) }, worker));

  const commits: CommitRecord[] = [];
  for (const c of list) {
    const rec = got.get(c.sha) ?? known.get(c.sha);
    if (rec) commits.push(rec);
  }
  return {
    history: { commits, head: list[0]?.sha ?? prior?.head ?? "" },
    messages: list.map((c) => c.message),
    stoppedByRate: stopped, rateRemaining: remaining, fetched: got.size,
  };
}

// ------------------------------------------------------------- aggregating

export interface Aggregate {
  /** Commits that touched each file. */
  changes: Map<string, number>;
  /** When each was last touched (epoch ms). */
  last: Map<string, number>;
  /** Pairs of files changed together in two commits or more, strongest first: [a, b, count]. */
  pairs: Array<[string, string, number]>;
}

const noise = (p: string) => isLockfile(p) || isGeneratedPath(p) || isVendoredPath(p);

export function aggregateHistory(history: History): Aggregate {
  const changes = new Map<string, number>();
  const last = new Map<string, number>();
  const together = new Map<string, number>();
  for (const c of history.commits) {
    const files = [...new Set(c.files.filter((f) => !noise(f)))];
    for (const f of files) {
      changes.set(f, (changes.get(f) ?? 0) + 1);
      if ((last.get(f) ?? 0) < c.at) last.set(f, c.at);
    }
    if (files.length < 2 || files.length > CO_CHANGE_MAX_FILES) continue;
    const sorted = [...files].sort();
    for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < sorted.length; j += 1) {
      const k = `${sorted[i]}\u0000${sorted[j]}`;
      together.set(k, (together.get(k) ?? 0) + 1);
    }
  }
  const pairs = [...together.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 300)
    .map(([k, n]): [string, string, number] => { const [a, b] = k.split("\u0000"); return [a!, b!, n]; });
  return { changes, last, pairs };
}

/** The files that change together with `path`, strongest first. */
export function coChanged(pairs: Aggregate["pairs"], path: string, limit = 5): Array<{ path: string; count: number }> {
  const out: Array<{ path: string; count: number }> = [];
  for (const [a, b, n] of pairs) { if (a === path) out.push({ path: b, count: n }); else if (b === path) out.push({ path: a, count: n }); }
  return out.sort((x, y) => y.count - x.count).slice(0, limit);
}

/**
 * The files to look at with care: changed often, carrying TODOs, central, and
 * with no test. A file that never changed and carries nothing is not a hotspot.
 */
export function rankHotspots(
  files: ReadonlyArray<{ path: string; hot: number; todo: number; rank: number; tests: readonly string[] }>, last: ReadonlyMap<string, number>, limit = 20,
): Hotspot[] {
  return files
    .filter((f) => (f.hot > 0 || f.todo > 0) && !isTestPath(f.path) && ["source", "markup"].includes(classOf(f.path)))
    .map((f) => ({
      path: f.path, changes: f.hot, lastAt: last.get(f.path) ?? 0, todo: f.todo, tests: f.tests.length, rank: f.rank,
      score: Math.round((f.hot + f.todo * 0.5 + f.rank * 4 + (f.hot > 0 && f.tests.length === 0 ? 2 : 0)) * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, limit);
}
