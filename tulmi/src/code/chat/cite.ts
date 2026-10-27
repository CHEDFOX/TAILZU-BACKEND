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

  has(path: string): boolean { return this.files.has(path); }
  get(path: string): FileAnchors | undefined { return this.files.get(path); }
  get size(): number { return this.files.size; }
  paths(): string[] { return [...this.files.keys()]; }
}

/** `path:line` and `path:start-end`: a path with a dot in its last part, not part of a longer word, a URL or a host:port. */
const CITE = /(?<![\w/.:@-])((?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7}):(\d{1,6})(?:[-–](\d{1,6}))?(?![\w:])/g;

export interface Cite { path: string; from: number; to: number; text: string }

/** Every citation in a text, in order. */
export function citationsIn(text: string): Cite[] {
  return [...text.matchAll(CITE)].map((m) => ({ path: m[1]!.replace(/^\.\//, ""), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]), text: m[0] }));
}

/** Whether a citation points at something that is there. */
export function resolves(c: Pick<Cite, "path" | "from" | "to">, anchors: Anchors): boolean {
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
    const c: Cite = { path: p.replace(/^\.\//, ""), from: Number(a), to: b ? Number(b) : Number(a), text: whole };
    if (resolves(c, anchors)) { if (!kept.includes(whole)) kept.push(whole); return whole; }
    dropped.push(whole);
    return "\u0000";
  });
  if (dropped.length) {
    out = out
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

/** The first "path:line" of every citation that stayed, as a list of unique `path:line` (a range is its first line). */
export function keptLocations(kept: readonly string[]): string[] {
  return [...new Set(kept.map((k) => k.replace(/[-–]\d+$/, "")))];
}
