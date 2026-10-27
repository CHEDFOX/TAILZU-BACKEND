/**
 * VERSIONS: SNAPSHOTS AND PATCHES, AND REBUILDING ANY VERSION FROM THE NEAREST SNAPSHOT.
 *
 * Every change to an artifact is a new version, and a bot changes an artifact often (a colour, a
 * label, a fix), so keeping the whole text each time would be most of the storage there is. Instead:
 *
 *   version 1, 11, 21 ...   a SNAPSHOT: the whole text
 *   every version between   a PATCH: the spans that changed against the version before it
 *
 * A patch is JSON, `{"e":[[start,deleteLength,"inserted text"], ...],"n":lengthOfTheResult}`: offsets
 * are into the PREVIOUS version's text, sorted, never overlapping. `n` is a check, not data: a patch
 * that does not make a text of that length was applied to the wrong text, and is refused rather than
 * trusted. Rebuilding version v is the nearest snapshot at or before it with the patches after it
 * applied in order: never more than nine of them (SNAPSHOT_EVERY).
 *
 * Where the bot gave exact edits (artifact_update), the patch IS those edits at the places they were
 * found, so nothing is diffed. Where a whole text came (a rewrite, a revert), the patch is the one
 * span between the longest common start and the longest common end, and if even that span is most of
 * the text (PATCH_MAX_SHARE) the version is stored as a snapshot: it is no cheaper as a patch.
 *
 * Nothing here reaches a store; contentAt takes the two reads it needs.
 */
import { ArtifactError, NOTE_MAX, PATCH_MAX_SHARE, SNAPSHOT_EVERY, type Edit, type NewVersion, type VersionKind, type VersionRow } from "./types.js";

/** `[start, deleteLength, insert]`: replace `deleteLength` characters at `start` with `insert`. */
export type PosEdit = [start: number, del: number, ins: string];

/** Whether this version number is stored whole: the first, and every SNAPSHOT_EVERY after it. */
export const isSnapshotVersion = (version: number): boolean => (version - 1) % SNAPSHOT_EVERY === 0;

// ------------------------------------------------------------------ patches

export function encodePatch(edits: readonly PosEdit[], resultLength: number): string {
  return JSON.stringify({ e: edits, n: resultLength });
}

export function decodePatch(body: string): { e: PosEdit[]; n: number } {
  let v: unknown;
  try { v = JSON.parse(body); } catch { throw new Error("a stored patch is not JSON"); }
  const p = v as { e?: unknown; n?: unknown } | null;
  if (!p || !Array.isArray(p.e) || typeof p.n !== "number") throw new Error("a stored patch has the wrong shape");
  for (const x of p.e) {
    if (!Array.isArray(x) || x.length !== 3 || !Number.isInteger(x[0]) || !Number.isInteger(x[1]) || typeof x[2] !== "string" || x[0] < 0 || x[1] < 0) {
      throw new Error("a stored patch has a bad edit");
    }
  }
  return { e: p.e as PosEdit[], n: p.n };
}

/** The edits applied to a text. They must be sorted and not overlap, and fit inside it. */
export function applyPositional(prev: string, edits: readonly PosEdit[]): string {
  let out = "";
  let at = 0;
  for (const [start, del, ins] of edits) {
    if (start < at || start + del > prev.length) throw new Error("a patch does not fit the text it was made for");
    out += prev.slice(at, start) + ins;
    at = start + del;
  }
  return out + prev.slice(at);
}

export function applyPatch(prev: string, body: string): string {
  const p = decodePatch(body);
  const out = applyPositional(prev, p.e);
  if (out.length !== p.n) throw new Error("a patch made a text of the wrong length");
  return out;
}

/** The one span that differs between two texts, as a patch's edits (none when they are equal). Never splits a surrogate pair. */
export function diffSpan(a: string, b: string): PosEdit[] {
  if (a === b) return [];
  const max = Math.min(a.length, b.length);
  let head = 0;
  while (head < max && a.charCodeAt(head) === b.charCodeAt(head)) head += 1;
  let tail = 0;
  while (tail < max - head && a.charCodeAt(a.length - 1 - tail) === b.charCodeAt(b.length - 1 - tail)) tail += 1;
  // A shared half of a surrogate pair is not shared: the pair is one character.
  const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
  const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
  if (head > 0 && isHigh(a.charCodeAt(head - 1))) head -= 1;
  if (tail > 0 && isLow(a.charCodeAt(a.length - tail))) tail -= 1;
  return [[head, a.length - head - tail, b.slice(head, b.length - tail)]];
}

/**
 * What to store for version `version`, whose text is `next` and whose previous version's is `prev`. `hint` is the positional edits
 * when the change was exact edits (so nothing is diffed).
 */
export function planVersion(version: number, prev: string, next: string, hint?: readonly PosEdit[]): { kind: VersionKind; body: string } {
  if (isSnapshotVersion(version)) return { kind: "snapshot", body: next };
  const edits = hint ?? diffSpan(prev, next);
  const body = encodePatch(edits, next.length);
  return body.length > next.length * PATCH_MAX_SHARE ? { kind: "snapshot", body: next } : { kind: "patch", body };
}

/** A NewVersion for the store, with the note kept to its length. */
export function newVersion(version: number, prev: string, next: string, o: { madeBy: NewVersion["madeBy"]; note: string; hint?: readonly PosEdit[] }): NewVersion {
  return { ...planVersion(version, prev, next, o.hint), madeBy: o.madeBy, note: o.note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) };
}

// ------------------------------------------------------------------ rebuilding

/** The two reads rebuilding a version needs. The stores answer both. */
export interface VersionReader {
  /** The newest snapshot at or before `version`. */
  snapshotAtOrBefore(artifactId: string, version: number): Promise<VersionRow | null>;
  /** The versions from `from` to `to`, both included, oldest first. */
  versionsBetween(artifactId: string, from: number, to: number): Promise<VersionRow[]>;
}

/** A version's whole text, rebuilt from the nearest snapshot. Throws a plain Error if the history is damaged (a missing row, a patch that does not fit). */
export async function contentAt(reader: VersionReader, artifactId: string, version: number): Promise<string> {
  const snap = await reader.snapshotAtOrBefore(artifactId, version);
  if (!snap) throw new Error("no snapshot at or before that version");
  if (snap.version === version) return snap.body;
  const rows = await reader.versionsBetween(artifactId, snap.version + 1, version);
  if (rows.length !== version - snap.version) throw new Error("a version is missing from the history");
  let text = snap.body;
  for (const [i, row] of rows.entries()) {
    if (row.version !== snap.version + 1 + i) throw new Error("the history is out of order");
    text = row.kind === "snapshot" ? row.body : applyPatch(text, row.body);
  }
  return text;
}

// ------------------------------------------------------------------ exact edits

const preview = (s: string): string => {
  const line = s.split("\n").find((l) => l.trim().length > 0)?.trim() ?? s.trim();
  return JSON.stringify(line.length > 60 ? `${line.slice(0, 59)}…` : line);
};

function occurrences(text: string, needle: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    at.push(i);
    if (at.length > 20) break;
  }
  return at;
}

/**
 * Exact edits against a text: every `old` must occur exactly once in the text AS IT IS (not in the result of the edits before it), the
 * edits must not overlap, and either all of them apply or none does. A failure names the edit that missed, by its number and the start of
 * its old text, and says what to do. Returns the new text and the edits as positions (the patch).
 */
export function applyEdits(text: string, edits: unknown): { content: string; pos: PosEdit[] } {
  const fail = (message: string) => new ArtifactError("edit_failed", `${message} Nothing was changed.`);
  if (!Array.isArray(edits) || edits.length === 0) throw fail("edits is a list of {old, new} replacements, and it is empty.");
  const list = edits as unknown[];
  if (list.length > 40) throw fail("At most 40 edits at a time; send the rest in another call.");
  const pos: Array<{ n: number; start: number; end: number; ins: string }> = [];
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    const e = raw as Partial<Edit> | null;
    if (!e || typeof e.old !== "string" || typeof e.new !== "string") throw fail(`Edit ${n} needs both old (the exact text to replace) and new (what goes in its place).`);
    if (e.old === "") throw fail(`Edit ${n} has an empty old text. Copy the exact text to replace, with enough around it to be the only one.`);
    if (e.old === e.new) throw fail(`Edit ${n} changes nothing: old and new are the same.`);
    const found = occurrences(text, e.old);
    if (found.length === 0) {
      const line = e.old.split("\n").map((l) => l.trim()).find((l) => l.length > 6 && text.includes(l));
      const near = line
        ? ` A line of it, ${preview(line)}, is in the artifact, so the difference is in the spacing or the lines around it: copy the text exactly.`
        : " Read the artifact again and copy the text exactly, spaces and all.";
      throw fail(`Edit ${n} did not apply: its old text ${preview(e.old)} is not in the artifact as it is now (every edit is matched against the artifact, not against the edits before it).${near}`);
    }
    if (found.length > 1) {
      throw fail(`Edit ${n} did not apply: its old text ${preview(e.old)} is in the artifact ${found.length > 20 ? "more than 20" : found.length} times. Include more of the lines around it so it is the only one.`);
    }
    pos.push({ n, start: found[0]!, end: found[0]! + e.old.length, ins: e.new });
  }
  const sorted = [...pos].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.start < sorted[i - 1]!.end) throw fail(`Edits ${sorted[i - 1]!.n} and ${sorted[i]!.n} overlap. Merge them into one edit.`);
  }
  const edits2: PosEdit[] = sorted.map((p) => [p.start, p.end - p.start, p.ins]);
  return { content: applyPositional(text, edits2), pos: edits2 };
}
