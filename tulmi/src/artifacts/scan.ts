/**
 * THE ELEMENT SCANNER: FROM "THE ELEMENT THAT OPENS AT LINE 14, COLUMN 7" TO ITS WHOLE SOURCE, AND NOTHING ELSE.
 *
 * Every element a person can point at carries protocol.ts ELEMENT_ID_ATTR, `"<line>:<col>"`, 1-based,
 * the place of the `<` that opens it in the artifact's original source. An edit of that element
 * needs only the element's own text, and finding where it ends is what this file does: a small scanner
 * that reads the element from its `<` to its closing tag the way a JSX compiler or a browser would,
 * without building a tree of the rest.
 *
 * WHAT IT UNDERSTANDS
 *   JSX (react)   fragments `<>…</>`; member names `<Foo.Bar>`; self-closing `<X />`; attributes with
 *                 "strings", 'strings' and {expressions}; {…} children and spread; and inside any {…}
 *                 a small JavaScript reader: strings, template literals with ${…}, comments, regex
 *                 literals, and nested elements in expression position (`{ok && <b>Don't</b>}`), where
 *                 `<` is an element after an operator, a `(` or `return` and a less-than after a value
 *                 (`a < b`, `useState<string>()`). A `<` that turns out not to open an element is
 *                 read as a plain character, so TypeScript generics do not derail it
 *   HTML          void elements (<br>, <img>…); raw text in <script>, <style>, <textarea> and <title>;
 *                 comments and CDATA; unquoted attributes; and the end tags HTML lets you leave out
 *                 (`<li>a<li>b`, `<p>a<p>b`, `<td>`, `<option>`…), which end at the next sibling or at
 *                 the end tag of their parent. `/>` closes only void and svg/math elements, as in a browser
 *   SVG           HTML's reading with `/>` honoured everywhere and no void elements
 *
 * WHAT IT DOES NOT: markdown and mermaid have no elements, and say so. A source that is not well formed
 * from the element on gets a plain reason (the end could not be found), never a guess: the caller then
 * edits the whole artifact instead.
 *
 * Offsets are UTF-16 indexes, the same as the string the viewer compiled. Nothing here reaches a network
 * or a store.
 */
import type { ArtifactType } from "./protocol.js";

export interface Span {
  /** Index of the `<` that opens the element. */
  start: number;
  /** Index just after the `>` that ends it. */
  end: number;
  /** "div", "Foo.Bar", or "" for a fragment. */
  tag: string;
  line: number;
  col: number;
}

export type Found = { ok: true; span: Span } | { ok: false; reason: string };

/** `"14:7"` as numbers, or null when it is not an element id. */
export function parseElementId(id: unknown): { line: number; col: number } | null {
  const m = typeof id === "string" ? /^(\d{1,7}):(\d{1,5})$/.exec(id.trim()) : null;
  const line = m ? Number(m[1]) : 0;
  const col = m ? Number(m[2]) : 0;
  return line >= 1 && col >= 1 ? { line, col } : null;
}

/** The index of a 1-based line and column, or null when the source has no such place. */
export function offsetOf(source: string, line: number, col: number): number | null {
  let start = 0;
  for (let l = 1; l < line; l += 1) {
    const nl = source.indexOf("\n", start);
    if (nl < 0) return null;
    start = nl + 1;
  }
  const at = start + col - 1;
  return at >= 0 && at <= source.length ? at : null;
}

/** The 1-based line and column of an index. */
export function lineColOf(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = source.indexOf("\n"); i >= 0 && i < offset; i = source.indexOf("\n", i + 1)) { line += 1; last = i; }
  return { line, col: offset - last };
}

class Unfinished extends Error {}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
/** Block elements: their start tag ends an open <p>. */
const CLOSES_P = ["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"];
/** Elements whose start tag ends the open one directly above it, by the new tag (HTML's optional end tags, the common cases). */
const IMPLIED: Record<string, readonly string[]> = {
  li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"], optgroup: ["optgroup", "option"],
  thead: ["tbody", "tfoot"], tbody: ["thead", "tbody"], tfoot: ["thead", "tbody"], rt: ["rt", "rp"], rp: ["rt", "rp"],
};
for (const t of CLOSES_P) IMPLIED[t] = [...(IMPLIED[t] ?? []), "p"];

/** A word before which `/` starts a regular expression and `<` an element, rather than being an operator. */
const EXPR_WORDS = new Set(["return", "typeof", "case", "in", "of", "else", "do", "yield", "await", "void", "delete", "new", "throw", "instanceof", "default"]);

const NAME = /[A-Za-z_$][\w$.:-]*/y;
const ATTR = /[^\s=/>{}"'<]+/y;

class Scanner {
  i = 0;
  private steps = 0;
  private backtracks = 0;
  /** Names of the HTML elements open above the one being read; the scan begins at the target, so this starts with it. */
  private open: string[] = [];
  private foreign = 0;

  constructor(private readonly s: string, private readonly mode: "jsx" | "html" | "svg") {}

  private tick(): void {
    if ((this.steps += 1) > 3_000_000) throw new Unfinished("the element is too big to read");
  }

  private ws(): void { while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i += 1; }

  private starts(text: string, at = this.i): boolean { return this.s.startsWith(text, at); }

  // ------------------------------------------------------------ JavaScript inside {…}

  private skipString(q: string): void {
    this.i += 1;
    while (this.i < this.s.length) {
      this.tick();
      const c = this.s[this.i]!;
      if (c === "\\") { this.i += 2; continue; }
      if (c === q) { this.i += 1; return; }
      if (c === "\n") throw new Unfinished("a string is not closed");
      this.i += 1;
    }
    throw new Unfinished("a string is not closed");
  }

  private skipTemplate(): void {
    this.i += 1;
    while (this.i < this.s.length) {
      this.tick();
      const c = this.s[this.i]!;
      if (c === "\\") { this.i += 2; continue; }
      if (c === "`") { this.i += 1; return; }
      if (c === "$" && this.s[this.i + 1] === "{") { this.i += 1; this.skipBraces(); continue; }
      this.i += 1;
    }
    throw new Unfinished("a template string is not closed");
  }

  /** At a `/` where a regular expression may start: skips it if it is one on this line, else reports false. */
  private skipRegex(): boolean {
    let j = this.i + 1;
    let inClass = false;
    while (j < this.s.length) {
      const c = this.s[j]!;
      if (c === "\n") return false;
      if (c === "\\") { j += 2; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j += 1;
        while (j < this.s.length && /[a-z]/i.test(this.s[j]!)) j += 1;
        this.i = j;
        return true;
      }
      j += 1;
    }
    return false;
  }

  /** At a `{`: skips a JavaScript expression to its matching `}`, whatever strings, comments, regexes and elements are in it. */
  private skipBraces(): void {
    let depth = 0;
    // "value": the last token ends a value (so `<` is less-than and `/` divides). "op": an element or a regex may start here.
    let prev: "value" | "op" = "op";
    while (this.i < this.s.length) {
      this.tick();
      const c = this.s[this.i]!;
      if (c === "{") { depth += 1; this.i += 1; prev = "op"; continue; }
      if (c === "}") {
        depth -= 1;
        this.i += 1;
        if (depth === 0) return;
        prev = "value";
        continue;
      }
      if (c === '"' || c === "'") { this.skipString(c); prev = "value"; continue; }
      if (c === "`") { this.skipTemplate(); prev = "value"; continue; }
      if (c === "/") {
        const n = this.s[this.i + 1];
        if (n === "/") { const nl = this.s.indexOf("\n", this.i); this.i = nl < 0 ? this.s.length : nl; continue; }
        if (n === "*") {
          const e = this.s.indexOf("*/", this.i + 2);
          if (e < 0) throw new Unfinished("a comment is not closed");
          this.i = e + 2;
          continue;
        }
        if (prev === "op" && this.skipRegex()) { prev = "value"; continue; }
        this.i += 1; prev = "op";
        continue;
      }
      if (c === "<" && prev === "op" && this.backtracks < 50 && /[A-Za-z>_$]/.test(this.s[this.i + 1] ?? "")) {
        const at = this.i;
        try {
          this.element();
          prev = "value";
          continue;
        } catch (err) {
          if (!(err instanceof Unfinished)) throw err;
          // It was not an element after all (a generic, `<T,>() =>`): a plain character.
          this.backtracks += 1;
          this.i = at + 1;
          prev = "op";
          continue;
        }
      }
      if (/[A-Za-z_$]/.test(c)) {
        let j = this.i + 1;
        while (j < this.s.length && /[\w$]/.test(this.s[j]!)) j += 1;
        prev = EXPR_WORDS.has(this.s.slice(this.i, j)) ? "op" : "value";
        this.i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = this.i + 1;
        while (j < this.s.length && /[\w.]/.test(this.s[j]!)) j += 1;
        this.i = j; prev = "value";
        continue;
      }
      if (c === ")" || c === "]") prev = "value";
      else if (!/\s/.test(c)) prev = "op";
      this.i += 1;
    }
    throw new Unfinished("a { is not closed");
  }

  // ------------------------------------------------------------ elements

  /** At a `<` that opens an element (or a fragment): reads it to its end. Leaves `i` after it. */
  element(): void {
    this.tick();
    const s = this.s;
    if (s[this.i] !== "<") throw new Unfinished("an element does not start here");
    if (this.open.length > 400) throw new Unfinished("elements are nested too deep");
    this.i += 1;
    let tag = "";
    if (s[this.i] === ">") {
      if (this.mode !== "jsx") throw new Unfinished("a fragment outside JSX");
    } else {
      NAME.lastIndex = this.i;
      const m = NAME.exec(s);
      if (!m) throw new Unfinished("an element has no name");
      tag = m[0];
      this.i += tag.length;
    }
    const lower = tag.toLowerCase();

    // The start tag's attributes.
    let selfClosed = false;
    if (s[this.i] !== ">") {
      for (;;) {
        this.tick();
        this.ws();
        if (this.i >= s.length) throw new Unfinished("a tag is not closed");
        if (this.starts("/>")) { this.i += 2; selfClosed = true; break; }
        if (s[this.i] === ">") { this.i += 1; break; }
        if (s[this.i] === "{") { this.skipBraces(); continue; }
        if (s[this.i] === "/") { this.i += 1; continue; }
        ATTR.lastIndex = this.i;
        const a = ATTR.exec(s);
        if (!a) throw new Unfinished("an attribute is not understood");
        this.i += a[0].length;
        this.ws();
        if (s[this.i] !== "=") continue;
        this.i += 1;
        this.ws();
        const q = s[this.i];
        if (q === '"' || q === "'") {
          const e = s.indexOf(q, this.i + 1);
          if (e < 0) throw new Unfinished("an attribute value is not closed");
          this.i = e + 1;
        } else if (q === "{" && this.mode === "jsx") {
          this.skipBraces();
        } else if (this.mode === "jsx") {
          throw new Unfinished("an attribute value is not understood");
        } else {
          while (this.i < s.length && !/[\s>]/.test(s[this.i]!)) this.i += 1;
        }
      }
    } else {
      this.i += 1;
    }
    if (selfClosed) {
      // HTML honours `/>` only on void and foreign (svg, math) elements; on others it is an ordinary `>`.
      if (this.mode === "jsx" || this.mode === "svg" || VOID.has(lower) || this.foreign > 0 || lower === "svg" || lower === "math") return;
    }
    if (this.mode === "html" && VOID.has(lower)) return;
    if (this.mode === "jsx" && tag === "" ) { this.children(tag); return; }

    if (this.mode !== "jsx" && RAW.has(lower)) {
      const close = new RegExp(`</${lower}\\s*>`, "i");
      const rest = s.slice(this.i);
      const m = close.exec(rest);
      if (!m) throw new Unfinished(`<${tag}> is not closed`);
      this.i += m.index + m[0].length;
      return;
    }
    const foreign = this.mode === "html" && (lower === "svg" || lower === "math");
    if (foreign) this.foreign += 1;
    this.open.push(lower);
    try {
      this.children(tag);
    } finally {
      this.open.pop();
      if (foreign) this.foreign -= 1;
    }
  }

  /** The children of the element named `tag`, up to and including its end tag (or, in HTML, to where it is ended without one). */
  private children(tag: string): void {
    const s = this.s;
    const lower = tag.toLowerCase();
    for (;;) {
      this.tick();
      if (this.i >= s.length) {
        // HTML lets a document end with elements still open; JSX does not.
        if (this.mode !== "jsx") return;
        throw new Unfinished(`<${tag}> is not closed`);
      }
      const c = s[this.i]!;
      if (c === "{" && this.mode === "jsx") { this.skipBraces(); continue; }
      if (c !== "<") { this.i += 1; continue; }
      if (this.starts("<!--")) {
        const e = s.indexOf("-->", this.i + 4);
        if (e < 0) throw new Unfinished("a comment is not closed");
        this.i = e + 3;
        continue;
      }
      if (this.starts("<![CDATA[")) {
        const e = s.indexOf("]]>", this.i);
        if (e < 0) throw new Unfinished("a CDATA section is not closed");
        this.i = e + 3;
        continue;
      }
      if (s[this.i + 1] === "/") {
        const m = /<\/\s*([A-Za-z_$][\w$.:-]*)?\s*>/y;
        m.lastIndex = this.i;
        const x = m.exec(s);
        if (!x) {
          if (this.mode === "jsx") throw new Unfinished("an end tag is not understood");
          this.i += 2;
          continue;
        }
        const name = (x[1] ?? "").toLowerCase();
        if (name === lower) { this.i += x[0].length; return; }
        if (this.mode === "jsx") throw new Unfinished(`</${x[1] ?? ""}> does not close <${tag}>`);
        // HTML: the end tag of an element above ends this one without being consumed; one that matches nothing open ends it too
        // (the scan began at this element, so it is its parent's); inside this element's own children it was already matched.
        if (this.open.includes(name) || this.open.length <= 1) return;
        this.i += x[0].length;
        continue;
      }
      const n = s[this.i + 1] ?? "";
      if (this.mode === "jsx" ? !/[A-Za-z>_$]/.test(n) : !/[A-Za-z]/.test(n)) {
        if (this.mode === "jsx") throw new Unfinished("a < that opens nothing");
        this.i += 1;
        continue;
      }
      if (this.mode !== "jsx") {
        // A start tag that ends the open element (HTML's optional end tags).
        const m = /<([A-Za-z][\w:-]*)/y;
        m.lastIndex = this.i;
        const next = m.exec(s)![1]!.toLowerCase();
        if (IMPLIED[next]?.includes(lower)) return;
      }
      this.element();
    }
  }
}

/** The element that opens at `offset`, as a span; `type` picks the reading (jsx, html, svg). */
export function elementAt(source: string, type: ArtifactType, offset: number): Found {
  if (type === "markdown" || type === "mermaid") return { ok: false, reason: `A ${type} artifact has no elements to point at.` };
  if (source[offset] !== "<") return { ok: false, reason: "No element opens at that place in this version." };
  const sc = new Scanner(source, type === "react" ? "jsx" : type === "svg" ? "svg" : "html");
  sc.i = offset;
  try {
    sc.element();
  } catch (err) {
    if (err instanceof Unfinished) return { ok: false, reason: `The element's end could not be found (${err.message}).` };
    throw err;
  }
  let end = sc.i;
  // An element ended without its end tag (HTML) does not take the whitespace after it.
  if (type === "html") while (end > offset + 1 && /\s/.test(source[end - 1]!)) end -= 1;
  const tag = /^<([A-Za-z_$][\w$.:-]*)?/.exec(source.slice(offset, offset + 80))?.[1] ?? "";
  const lc = lineColOf(source, offset);
  return { ok: true, span: { start: offset, end, tag, line: lc.line, col: lc.col } };
}

/** The element a viewer's `data-tz-id` names, in this source. */
export function findElementSpan(source: string, type: ArtifactType, elementId: unknown): Found {
  const id = parseElementId(elementId);
  if (!id) return { ok: false, reason: 'An element id is "line:column", like "14:7".' };
  if (type === "markdown" || type === "mermaid") return { ok: false, reason: `A ${type} artifact has no elements to point at.` };
  const at = offsetOf(source, id.line, id.col);
  if (at === null) return { ok: false, reason: `This version has no line ${id.line}: the element id is from another version.` };
  return elementAt(source, type, at);
}

/**
 * A few lines of the source around a span, outside it: `before` lines above and `after` below, each cut to `width` characters,
 * with the line numbers the viewer's errors use. This is all the model sees of the rest of the artifact.
 */
export function contextAround(source: string, span: Pick<Span, "start" | "end">, o: { before?: number; after?: number; width?: number } = {}): { before: string; after: string } {
  const before = o.before ?? 3;
  const after = o.after ?? 2;
  const width = o.width ?? 160;
  const cut = (l: string) => (l.length > width ? `${l.slice(0, width - 1)}…` : l);
  // The lines above, and whatever is on the span's first line before its `<` (an `{ok && ` that belongs to the expression around it).
  const head = source.slice(0, span.start).split("\n");
  const spanLine = head.length;
  const above = head.slice(Math.max(0, spanLine - 1 - before), spanLine - 1).map((l, i, a) => `${spanLine - a.length + i}: ${cut(l)}`);
  const prefix = head[spanLine - 1]!;
  if (prefix.trim()) above.push(`${spanLine}: ${cut(prefix)}`);
  // Whatever is on the span's last line after it, then the lines below.
  const endLine = lineColOf(source, span.end).line;
  const lineEnd = source.indexOf("\n", span.end);
  const tail = source.slice(span.end, lineEnd < 0 ? source.length : lineEnd);
  const below: string[] = [];
  if (tail.trim()) below.push(`${endLine}: ${cut(tail)}`);
  if (lineEnd >= 0) source.slice(lineEnd + 1).split("\n", after).forEach((l, i) => below.push(`${endLine + 1 + i}: ${cut(l)}`));
  return { before: above.join("\n"), after: below.slice(0, after).join("\n") };
}

/** The lines `from`..`to` (1-based, inclusive) of a source, numbered, each cut to `width`: the window around a reported error. */
export function linesWindow(source: string, from: number, to: number, width = 200): string {
  const lines = source.split("\n");
  const a = Math.max(1, from);
  const b = Math.min(lines.length, to);
  const out: string[] = [];
  for (let n = a; n <= b; n += 1) out.push(`${n}: ${lines[n - 1]!.length > width ? `${lines[n - 1]!.slice(0, width - 1)}…` : lines[n - 1]}`);
  return out.join("\n");
}
