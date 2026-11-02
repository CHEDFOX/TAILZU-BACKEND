/**
 * EVERY CLAIM CITES path:line, AND A CITATION THAT DOES NOT RESOLVE IS STRIPPED.
 *
 * The model is told to cite the files and lines an answer rests on (principle code.cite). A model sometimes cites a line that is not there, or a file
 * the project does not have: the person would follow it and find nothing, and stop trusting the ones that are right. So after the answer is written
 * every `path:line` (or `path:start-end`) in it is checked against what Tailzu SAW:
 *
 *   a file it read     the path, and the line count it has: a line past the end of the file is not a line
 *   a file the brain knows   the path; a line the brain itself named (a symbol's, a visible text's), line 1 (the file as a whole), or a line a file of that
 *                      many bytes could have
 *
 * A citation that resolves stays. One that does not is taken out of the text (with the brackets it was in, if they would be left empty), and the
 * answer says that it did, so nothing is dropped silently. Pure.
 */

/** What is known about one file's lines. */
export interface FileAnchors {
  /** The most lines the file could have: exact for a file that was read, an upper bound for one the brain only knows. */
  max: number;
  exact: boolean;
  /** Lines the brain or the reads named. */
  lines: Set<number>;
}

export class Anchors {
  private readonly files = new Map<string, FileAnchors>();

  /** A file whose text was read: its line count is exact. */
  read(path: string, text: string): void {
    const n = text === "" ? 0 : text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
    const a = this.files.get(path);
    this.files.set(path, { max: n, exact: true, lines: a?.lines ?? new Set() });
  }

  /** A file the brain knows by its size: no more lines than a file of that many bytes could have (a line is at least 6 characters here), and the lines it named. */
  known(path: string, bytes: number, named: Iterable<number> = []): void {
    const a = this.files.get(path);
    if (a?.exact) { for (const l of named) a.lines.add(l); return; }
    const lines = a?.lines ?? new Set<number>();
    for (const l of named) lines.add(l);
    this.files.set(path, { max: Math.max(1, Math.ceil(Math.max(0, bytes) / 6), ...lines), exact: false, lines });
  }

  /** A file whose line count is known exactly (the job's copy of the code says how many lines it has). */
  lines(path: string, total: number): void {
    const a = this.files.get(path);
    this.files.set(path, { max: Math.max(0, total), exact: true, lines: a?.lines ?? new Set() });
  }

  /** A line a search result named in a file (a grep hit): it exists, so the file is at least that long. */
  hit(path: string, line: number): void {
    const a = this.files.get(path);
    if (a) { a.lines.add(line); if (!a.exact) a.max = Math.max(a.max, line); return; }
    this.files.set(path, { max: line, exact: false, lines: new Set([line]) });
  }

  /** What earlier turns of the chat read, as `path:from-to` (the thread keeps them): those lines were there, so a follow-up may cite them. */
  earlier(seen: readonly string[]): void {
    for (const r of seen) {
      const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(r);
      if (m) this.hit(m[1]!, Number(m[3] ?? m[2]));
    }
  }

  has(path: string): boolean { return this.files.has(path); }

  /**
   * The path a citation means: as written, or, for a file's bare name after its first mention ("deps.py:52" once backend/app/api/deps.py was
   * read), the one file read with that name. Two read with the name: as written, so it does not resolve.
   */
  pathOf(written: string): string {
    if (this.files.has(written) || written.includes("/")) return written;
    const named = [...this.files.keys()].filter((p) => p.endsWith(`/${written}`));
    return named.length === 1 ? named[0]! : written;
  }
  get(path: string): FileAnchors | undefined { return this.files.get(path); }
  get size(): number { return this.files.size; }
  paths(): string[] { return [...this.files.keys()]; }
}

/** `path:line` and `path:start-end`: a path with a dot in its last part, not part of a longer word, a URL or a host:port. */
const CITE = /(?<![\w/.:@-])((?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7}):(\d{1,6})(?:[-–](\d{1,6}))?(?![\w:])/g;

export interface Cite { path: string; from: number; to: number; text: string }

/** A web address and its port ("example.com:8080", "api.myapp.dev:443"), not a file and its line: no folder, and the last part a domain's. */
const HOST_END = /^(?:com|org|net|io|dev|app|co|ai|me|local|localhost|internal|lan|test|example|invalid|cloud|site|xyz|in|us|uk|de|fr|eu)$/i;
const hostLike = (path: string, anchors?: Anchors): boolean => !path.includes("/") && HOST_END.test(path.split(".").pop() ?? "") && !anchors?.has(path);

/** Every citation in a text, in order. */
export function citationsIn(text: string): Cite[] {
  return [...text.matchAll(CITE)].filter((m) => !hostLike(m[1]!)).map((m) => ({ path: m[1]!.replace(/^\.\//, ""), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]), text: m[0] }));
}

/** Whether a citation points at something that is there. */
function resolves(c: Pick<Cite, "path" | "from" | "to">, anchors: Anchors): boolean {
  const a = anchors.get(c.path);
  if (!a || c.from < 1 || c.to < c.from) return false;
  if (a.exact) return c.to <= Math.max(a.max, 1);
  return c.to <= a.max;
}

export interface Checked {
  text: string;
  /** The citations that stayed, as written (`path:line`), once each. */
  kept: string[];
  /** The ones taken out. */
  dropped: string[];
}

/** Takes out what does not resolve, tidies what it leaves, and says what stayed and what went. */
export function checkCitations(text: string, anchors: Anchors): Checked {
  const kept: string[] = [];
  const dropped: string[] = [];
  let out = text.replace(CITE, (whole, p: string, a: string, b: string | undefined) => {
    const written = p.replace(/^\.\//, "");
    if (hostLike(written, anchors)) return whole;
    const c: Cite = { path: anchors.pathOf(written), from: Number(a), to: b ? Number(b) : Number(a), text: whole };
    if (resolves(c, anchors)) { if (!kept.includes(whole)) kept.push(whole); return whole; }
    dropped.push(whole);
    // A file this answer knows, at a line it cannot check: the file stays and the line goes, so the sentence keeps its subject ("lives in (" was left).
    return anchors.has(c.path) ? written : "\u0000";
  });
  if (dropped.length) {
    out = out
      // A dropped citation in backticks goes with its backticks (the changesets run: "listed as a user of ``").
      .replace(/`\u0000`/g, "\u0000")
      .replace(/\s*[(\[]\s*(?:(?:see|in|at|from|per|cf\.?)\s+)?\u0000(?:\s*[,;]\s*\u0000)*\s*[)\]]/gi, "")
      .replace(/\u0000(?:\s*[,;]\s*\u0000)*/g, "")
      .replace(/\b(?:see|in|at|from|per)\s*(?=[.,;:)]|$)/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:])/g, "$1")
      .replace(/([,;])\s*([.,;])/g, "$2")
      .replace(/[ \t]+$/gm, "");
  }
  return { text: out.trim(), kept, dropped };
}

/** A path in an answer: folders and a file with an extension, as a model writes one (with or without a line after it). */
const PATH = /(?<![\w/.:@-])((?:[\w@.+-]+\/)+[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?![\w/])/g;

/** Paths in the text the project does not have, folders and all: what fixPaths may correct. */
export function unknownPaths(text: string, has: (path: string) => boolean): string[] {
  return [...new Set([...text.matchAll(PATH)].map((m) => m[1]!.replace(/^\.\//, "")).filter((p) => !has(p)))];
}

/**
 * A path a model wrote with folders the project does not have ("live/liveViewMain.js" for a file at the root, its folder taken from a feature's
 * name), put right when exactly one file in the project has that name; left as it is when none does or several do. Before the citations are
 * checked, so a line cited in it is checked in the right file. Pure.
 */
export function fixPaths(text: string, all: readonly string[]): { text: string; fixed: Array<[string, string]> } {
  const known = new Set(all);
  const byName = new Map<string, string[]>();
  for (const p of all) { const n = p.slice(p.lastIndexOf("/") + 1); const l = byName.get(n) ?? []; l.push(p); byName.set(n, l); }
  const fixed: Array<[string, string]> = [];
  const out = text.replace(PATH, (whole, p: string) => {
    const path = p.replace(/^\.\//, "");
    if (known.has(path)) return whole;
    const same = byName.get(path.slice(path.lastIndexOf("/") + 1)) ?? [];
    if (same.length !== 1) return whole;
    if (!fixed.some(([a]) => a === path)) fixed.push([path, same[0]!]);
    return same[0]!;
  });
  return { text: out, fixed };
}

/** The first "path:line" of every citation that stayed, as a list of unique `path:line` (a range is its first line). */
export function keptLocations(kept: readonly string[]): string[] {
  return [...new Set(kept.map((k) => k.replace(/[-–]\d+$/, "")))];
}
