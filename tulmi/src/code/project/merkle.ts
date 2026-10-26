/**
 * WHAT CHANGED SINCE LAST TIME, FROM GIT'S OWN FINGERPRINTS.
 *
 * Git already is a Merkle tree: a file's blob sha is a hash of its bytes, a
 * folder's tree sha is a hash of its entries' names and shas, and so a folder's
 * sha is the same exactly when nothing under it changed. The project brain
 * keeps the sha of every file it analysed and every folder it summarised, so a
 * new build is a comparison of two maps and nothing is guessed:
 *
 *   a file whose blob sha is the same      its symbols, imports, texts and
 *                                          summary are still true: not fetched,
 *                                          not analysed, not summarised again
 *   a file that is new or changed          fetched and analysed again, and
 *                                          summarised again if it is one of the
 *                                          files that get a summary
 *   a file that is gone                    its rows are dropped
 *   a folder whose tree sha is the same    its summary stands
 *   a folder whose tree sha changed        its summary is made again, if
 *                                          something under it was re-summarised
 *                                          (a folder that changed only because
 *                                          a lockfile did is not)
 *
 * Changes ROLL UP TO THE ROOT: a changed file changes every folder above it, in
 * git's tree as in the diff here, so the root's overview is always remade when
 * anything that is summarised changes.
 *
 * Pure: no network, no store, no clock.
 */
import { dirName } from "./lang.js";
import type { TreeInfo } from "./types.js";

export interface Fingerprint {
  /** Path to blob sha. */
  files: ReadonlyMap<string, string>;
  /** Folder path to tree sha; the root is "". */
  dirs: ReadonlyMap<string, string>;
}

export interface SnapshotDiff {
  added: string[];
  changed: string[];
  removed: string[];
  /** Folders in the new tree whose sha is new or different. */
  changedDirs: string[];
  /** Folders that were there and are not. */
  removedDirs: string[];
}

/** The fingerprint of a tree, of just `only` among its files when given (the files that are analysed). */
export function fingerprintOf(tree: TreeInfo, only?: Iterable<string>): Fingerprint {
  const files = new Map<string, string>();
  if (only) {
    for (const p of only) { const f = tree.files.get(p); if (f) files.set(p, f.sha); }
  } else {
    for (const [p, f] of tree.files) files.set(p, f.sha);
  }
  return { files, dirs: tree.dirs };
}

/** What differs between two fingerprints. Each list is sorted, so the answer is the same every time. */
export function diffSnapshots(prev: Fingerprint, next: Fingerprint): SnapshotDiff {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, sha] of next.files) {
    const before = prev.files.get(path);
    if (before === undefined) added.push(path);
    else if (before !== sha) changed.push(path);
  }
  for (const path of prev.files.keys()) if (!next.files.has(path)) removed.push(path);

  const changedDirs: string[] = [];
  const removedDirs: string[] = [];
  for (const [path, sha] of next.dirs) if (prev.dirs.get(path) !== sha) changedDirs.push(path);
  for (const path of prev.dirs.keys()) if (!next.dirs.has(path)) removedDirs.push(path);

  const sort = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return { added: added.sort(sort), changed: changed.sort(sort), removed: removed.sort(sort), changedDirs: changedDirs.sort(sort), removedDirs: removedDirs.sort(sort) };
}

/** Every folder above a path, nearest first, up to and including the root (""). */
export function ancestorsOfPath(path: string): string[] {
  const out: string[] = [];
  let d = dirName(path);
  for (;;) {
    out.push(d);
    if (d === "") break;
    d = dirName(d);
  }
  return out;
}

/** The folders above any of the paths, each once, the root included. */
export function ancestorsOf(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const p of paths) for (const d of ancestorsOfPath(p)) out.add(d);
  return out;
}

/** Whether nothing differs. */
export const isUnchanged = (d: SnapshotDiff): boolean =>
  !d.added.length && !d.changed.length && !d.removed.length && !d.changedDirs.length && !d.removedDirs.length;

/** The files to read again: the new and the changed. */
export const toRead = (d: SnapshotDiff): string[] => [...d.added, ...d.changed];

/**
 * The folders whose summary has to be made again: those above a file that was
 * added, changed or removed, and whose sha did change (or that are new). The
 * root is always among them when anything is.
 */
export function rollUp(d: SnapshotDiff): Set<string> {
  const moved = new Set([...d.changedDirs]);
  const above = ancestorsOf([...d.added, ...d.changed, ...d.removed]);
  const out = new Set<string>();
  for (const dir of above) if (moved.has(dir) || dir === "") out.add(dir);
  return out;
}
