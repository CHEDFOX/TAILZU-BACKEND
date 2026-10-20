/**
 * THE MODEL'S ANSWER, READ AS IT ARRIVES.
 *
 * The planner answers in lines ("SAY …", "POINT e12", "PRESS e12"), and each
 * line is acted on the moment its newline arrives, so the guide is already
 * talking and pointing while the model is still writing. Three layers:
 *
 *   LineSplitter  chunks of text → whole lines, a line split across chunks
 *                 held until the rest of it comes
 *   parseLine     one line → one command, or null for anything that is not
 *                 the protocol (prose, a code fence, a heading)
 *   LineReader    commands → events, in the order they were written, holding
 *                 the contract the model was asked to keep: ids from this
 *                 screen only, one action at most and nothing after it, and
 *                 no action at all in show mode
 *
 * The picture path reads the same protocol with its own rules: it already
 * has the picture, so LOOK means nothing there; it answers in this one step,
 * so a question it asks is said rather than waited on; it may write many
 * more sentences, a worked answer being one sentence per step; and those
 * sentences are maths read aloud, so any TeX a model slips into is turned
 * into the plain symbols it stands for.
 *
 * Both paths may DRAW: a mark on the screen (a box, an arrow, a numbered
 * place) sent between the sentences it belongs to, the way a teacher talks
 * with a pen in hand. A mark is display only, so it never ends the step and
 * never counts as its action. Its spots are read leniently, because a small
 * model writes "(120, 300)" and "[120 300 40 20]" and "e5 → o3" and "e5 to
 * o3" for the same thing, and checked strictly: an id from this screen, and
 * a place in the picture only on a step that has one. A mark that fails is
 * dropped, never guessed at, and counted for the log.
 */
import type { AgentDraw, AgentDrawKind, AgentEvent, AgentSpot } from "../../../shared/types/api.js";
import type { Platform } from "./grammar.js";

export const SAY_MAX = 240;
export const CAPTION_MAX = 80;
export const STEP_MAX = 80;
export const STEPS_MAX = 6;
const TYPE_MAX = 1000;
const INSTRUCTION_MAX = 500;
/** More SAYs or POINTs than this in one step is a model rambling. */
const SAYS_MAX = 3;
const POINTS_MAX = 6;
const WHY_MAX = 120;
/** Marks honoured in a step when the reader is not told (AGENT_DRAW_MAX). */
const DRAWS_MAX = 12;
/** A mark's label sits beside what it marks, in handwriting: a few words. */
export const LABEL_MAX = 48;
/** Picture units run from 0 to this, across the picture and down it. */
export const PICTURE_UNITS = 1000;
/** A box thinner than this is a line, and nobody can see what it holds. */
const BOX_MIN = 4;
/** A path is a line through at least two points; past this it is a scribble. */
const PATH_MIN = 2;
export const PATH_MAX = 32;

export type ActionLine =
  | { verb: "PRESS" | "FOCUS"; id: string }
  | { verb: "SET"; id: string; text: string }
  | { verb: "TYPE"; text: string }
  | { verb: "WRITE" | "REWRITE"; text: string }
  | { verb: "KEY"; keys: string }
  | { verb: "SCROLL"; dir: "up" | "down" | "left" | "right"; id?: string }
  | { verb: "OPEN"; app: string };

export type Line =
  | { verb: "SAY"; text: string }
  | { verb: "POINT"; id: string; caption?: string }
  | { verb: "STEPS"; items: string[] }
  | { verb: "ASK"; text: string }
  | { verb: "LOOK"; why?: string }
  | { verb: "DONE"; text?: string }
  /** `draw` is null for a DRAW line that could not be read: it is still a
   *  mark the model meant, so the reader counts it as dropped. */
  | { verb: "DRAW"; draw: AgentDraw | null }
  | ActionLine;

/** Whole lines out of a stream of chunks. */
export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    this.rest += chunk;
    const parts = this.rest.split(/\r?\n/);
    this.rest = parts.pop() ?? "";
    return parts;
  }

  /** The last line, which ends with the stream rather than a newline. */
  flush(): string[] {
    const last = this.rest;
    this.rest = "";
    return last.trim() ? [last] : [];
  }
}

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max).trim();
/** Markdown a model sometimes wraps its words in, which a caption shows raw. */
const unmark = (s: string) => s.replace(/\*\*|__|`/g, "").trim();
/** One pair of quotes around the whole of it, as a model writes `TYPE "hello"`. */
const unquote = (s: string) => {
  const m = /^(["“'])([\s\S]*)(["”'])$/.exec(s.trim());
  return m && m[2]!.trim() ? m[2]!.trim() : s.trim();
};

const MODS: Record<string, string> = {
  cmd: "cmd", command: "cmd", meta: "cmd", super: "cmd", win: "win", windows: "win",
  ctrl: "ctrl", control: "ctrl", alt: "alt", option: "alt", opt: "alt", shift: "shift",
};
const NAMED_KEYS: Record<string, string> = {
  enter: "enter", return: "enter", escape: "escape", esc: "escape", tab: "tab", space: "space",
  backspace: "backspace", delete: "delete", del: "delete", up: "up", down: "down", left: "left",
  right: "right", arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right",
  home: "home", end: "end", pageup: "pageup", pagedown: "pagedown", pgup: "pageup", pgdn: "pagedown",
};

/**
 * A chord the drivers can press: modifiers first, one key last, in their
 * spelling. The platform decides what the command key is called, so a model
 * that writes cmd+k for Windows still presses ctrl+k. Null when it is not a
 * chord at all.
 */
export function normalizeChord(raw: string, platform: Platform): string | null {
  const tokens = raw.trim().toLowerCase().replace(/\s*\+\s*/g, "+").split(/[+\s]+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return null;
  const mods: string[] = [];
  for (const t of tokens.slice(0, -1)) {
    // Own keys only: "constructor+k" is no chord, not Object's constructor.
    let m = Object.hasOwn(MODS, t) ? MODS[t] : undefined;
    if (!m) return null;
    if (m === "cmd" && platform === "win") m = "ctrl";
    if (m === "win" && platform === "mac") m = "cmd";
    if (!mods.includes(m)) mods.push(m);
  }
  const last = tokens.at(-1)!;
  const key = (Object.hasOwn(NAMED_KEYS, last) ? NAMED_KEYS[last] : null)
    ?? (/^f(?:[1-9]|1\d|2[0-4])$/.test(last) ? last : null)
    ?? ([...last].length === 1 && /[\p{L}\p{N}\p{P}\p{S}]/u.test(last) ? last : null);
  if (!key) return null;
  return [...mods, key].join("+");
}

/** A tree element's id, or an OCR line's. */
const ID = /^([eo]\d{1,5})\b\s*/i;

/** One line of the protocol, or null when the line is not one. */
export function parseLine(raw: string, platform: Platform): Line | null {
  let s = raw.trim();
  if (!s || s.startsWith("```")) return null;
  // Bullets, numbering and bold a model adds out of habit.
  s = s.replace(/^(?:[-*•]\s+|\d{1,2}[.)]\s+)/, "").replace(/^\*\*([A-Z]+)\*\*/, "$1");
  // Verbs are capitals, as the protocol writes them. A sentence that happens
  // to open with "Press" or "Type" is prose, and prose is never an action.
  const m = /^([A-Z]{2,})\b\s*:?\s*([\s\S]*)$/.exec(s);
  if (!m) return null;
  const verb = m[1]!;
  const arg = m[2]!.trim();
  const idOf = (a: string) => ID.exec(a)?.[1]?.toLowerCase();

  switch (verb) {
    case "SAY": {
      const text = clip(unmark(unquote(arg)), SAY_MAX);
      return text ? { verb, text } : null;
    }
    case "POINT": {
      const id = idOf(arg);
      if (!id) return null;
      const caption = clip(unmark(arg.replace(ID, "").replace(/^[|:–—-]\s*/, "")), CAPTION_MAX);
      return caption ? { verb, id, caption } : { verb, id };
    }
    case "STEPS": {
      const items = arg.split(/\s*;\s*/).map((x) => clip(unmark(x), STEP_MAX)).filter(Boolean).slice(0, STEPS_MAX);
      return items.length ? { verb, items } : null;
    }
    case "ASK": {
      const text = clip(unmark(unquote(arg)), SAY_MAX);
      return text ? { verb, text } : null;
    }
    case "LOOK": {
      const why = clip(unmark(unquote(arg)), WHY_MAX);
      return why ? { verb, why } : { verb };
    }
    case "DONE": {
      const text = clip(unmark(unquote(arg)), SAY_MAX);
      return text ? { verb, text } : { verb };
    }
    // An action on something that is not an id is still an action: it is
    // kept with an empty id so the reader can refuse it as a bad target,
    // rather than dropped and the next line taken as the action instead.
    case "PRESS":
    case "FOCUS":
      return { verb, id: idOf(arg) ?? "" };
    case "SET": {
      const id = idOf(arg) ?? "";
      const text = unquote(arg.replace(ID, "").replace(/^\|\s*/, "")).slice(0, TYPE_MAX);
      return { verb, id, text };
    }
    case "TYPE": {
      const text = unquote(arg).slice(0, TYPE_MAX);
      return text ? { verb, text } : null;
    }
    case "WRITE":
    case "REWRITE": {
      const text = clip(arg, INSTRUCTION_MAX);
      return text ? { verb, text } : null;
    }
    case "KEY": {
      const keys = normalizeChord(arg, platform);
      return keys ? { verb, keys } : null;
    }
    case "SCROLL": {
      const d = /^(up|down|left|right)\b\s*(.*)$/i.exec(arg);
      if (!d) return null;
      const id = idOf(d[2]!);
      return { verb, dir: d[1]!.toLowerCase() as "up" | "down" | "left" | "right", ...(id ? { id } : {}) };
    }
    case "OPEN": {
      const app = clip(unquote(arg), 60);
      return app ? { verb, app } : null;
    }
    case "DRAW":
      return { verb, draw: parseDraw(arg) };
    default:
      return null;
  }
}

// ---- DRAW ---------------------------------------------------------------------

/** The kinds by the names a model writes them, its near misses included.
 *  Looked up as own keys only: "DRAW constructor e5" is no kind at all. */
const DRAW_KINDS: Record<string, AgentDrawKind> = {
  box: "box", rect: "box", rectangle: "box", square: "box",
  circle: "circle", ellipse: "circle", oval: "circle", ring: "circle",
  underline: "underline",
  highlight: "highlight",
  arrow: "arrow",
  number: "number",
  label: "label", text: "label",
  path: "path", line: "path", polyline: "path",
  clear: "clear",
};

/** One picture number, with a name in front of it if the model wrote one
 *  ("x=120", "w: 40"). */
const NUM = String.raw`(?:[a-z]\s*[=:]\s*)?(-?\d+(?:\.\d+)?)`;
/** Between two numbers: a comma, a semicolon or spaces, but something, or
 *  "(12)" would be read as the point (1, 2). */
const GAP = String.raw`(?:\s*[,;]\s*|\s+)`;
const BOX_SPOT = new RegExp(String.raw`^[[(]\s*${NUM}${GAP}${NUM}${GAP}${NUM}${GAP}${NUM}\s*[\])]`, "i");
const POINT_SPOT = new RegExp(String.raw`^[([]\s*${NUM}${GAP}${NUM}\s*[)\]]`, "i");
const ID_SPOT = /^([eo]\d{1,5})(?![\p{L}\p{N}_])/iu;
/** What joins an arrow's two ends: an arrow in any of its spellings, "to",
 *  or a comma. */
const ARROW_JOIN = /^\s*(?:-+>?|=+>|[→⟶➔➜➝⇒]|[–—]+>?|to\b|,)\s*/i;
/** Another arrow after an arrow's second end: the line goes on to a third. */
const ARROW_ON = /^\s*(?:-+>|=+>|[→⟶➔➜➝⇒]|[–—]+>|to\s+(?:[eo]\d|[[(]))/i;
/** What may sit between a path's points. */
const PATH_JOIN = /^\s*(?:-+>?|[→⟶➔➜➝⇒]|[–—]+>?|to\b|,)?\s*/i;

/** A picture number as sent: whole, and inside the picture. */
const unit = (v: string) => Math.min(PICTURE_UNITS, Math.max(0, Math.round(Number(v))));

/**
 * A box in picture units, kept inside the picture: at least BOX_MIN across
 * and down, and one that runs past the right or bottom edge is cut there
 * rather than moved, since its left and top are where the model saw it start.
 */
function fitBox(x: number, y: number, w: number, h: number): [number, number, number, number] {
  const fit = (at: number, size: number): [number, number] => {
    const s = Math.max(BOX_MIN, Math.min(size, PICTURE_UNITS - at));
    return [Math.min(at, PICTURE_UNITS - s), s];
  };
  const [bx, bw] = fit(x, w);
  const [by, bh] = fit(y, h);
  return [bx, by, bw, bh];
}

/** The spot at the start of `s`, and what follows it. */
function readSpot(s: string): { spot: AgentSpot; rest: string } | null {
  const t = s.trimStart();
  const id = ID_SPOT.exec(t);
  if (id) return { spot: { id: id[1]!.toLowerCase() }, rest: t.slice(id[0].length) };
  const box = BOX_SPOT.exec(t);
  if (box) {
    const [x, y, w, h] = box.slice(1, 5).map((v) => unit(v!)) as [number, number, number, number];
    return { spot: { box: fitBox(x, y, w, h) }, rest: t.slice(box[0].length) };
  }
  const pt = POINT_SPOT.exec(t);
  if (pt) return { spot: { pt: [unit(pt[1]!), unit(pt[2]!)] }, rest: t.slice(pt[0].length) };
  return null;
}

/** Quotes a label may come in, straight or curly, and what may close each. */
const CLOSERS: Record<string, string> = {
  '"': '"”“', "“": "”“\"", "”": "”\"", "„": "“”\"", "«": "»", "'": "'’", "‘": "’'", "’": "’'",
};

/** A label as it is drawn: one line, no control characters, no markdown, at
 *  most LABEL_MAX characters, cut at a word when it has to be cut. */
export function labelText(s: string): string {
  const t = unmark(s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")).replace(/\s+/g, " ").trim();
  if (t.length <= LABEL_MAX) return t;
  let cut = t.slice(0, LABEL_MAX - 1);
  // A cut through an emoji leaves half of it, which is no character at all
  // and is drawn as a box with a question mark in it.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  return (space >= LABEL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/** The label after a mark's spots: quoted or not, from its opening quote to
 *  the last quote that closes it, so an apostrophe inside ("what's") is
 *  kept. A separator in front of it ("| 90°", ": 90°") is not part of it. */
function readLabel(rest: string): string {
  const s = rest.trim().replace(/^(?:[|:,]|[–—-](?!\d))\s*/, "");
  const open = s[0];
  if (open && CLOSERS[open]) {
    const body = s.slice(1);
    let end = -1;
    for (let i = body.length - 1; i >= 0; i--) if (CLOSERS[open]!.includes(body[i]!)) { end = i; break; }
    return labelText(end >= 0 ? body.slice(0, end) : body);
  }
  return labelText(s);
}

const sameSpot = (a: AgentSpot, b: AgentSpot) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One DRAW line's mark, or null when it cannot be read as one: an unknown
 * kind, a spot missing, a number that is not 1 to 9, a path of fewer than 2
 * or more than PATH_MAX points, a label with no text, an arrow to where it
 * starts. Picture numbers are rounded and kept inside the picture here;
 * whether an id or a picture spot is allowed on this step is the reader's to
 * say.
 */
export function parseDraw(arg: string): AgentDraw | null {
  const m = /^([A-Za-z]+)\b\s*:?\s*([\s\S]*)$/.exec(arg.trim());
  const name = m ? m[1]!.toLowerCase() : "";
  const kind = Object.hasOwn(DRAW_KINDS, name) ? DRAW_KINDS[name] : undefined;
  if (!kind) return null;
  let rest = m![2]!;
  if (kind === "clear") return { kind };

  if (kind === "path") {
    const points: Array<[number, number]> = [];
    for (;;) {
      const t = rest.replace(PATH_JOIN, "");
      const pt = POINT_SPOT.exec(t);
      if (!pt) break;
      points.push([unit(pt[1]!), unit(pt[2]!)]);
      rest = t.slice(pt[0].length);
    }
    if (points.length < PATH_MIN || points.length > PATH_MAX) return null;
    const closed = /^\s*,?\s*closed?\b/i.exec(rest);
    if (closed) rest = rest.slice(closed[0].length);
    const text = readLabel(rest);
    return { kind, points, ...(closed ? { closed: true } : {}), ...(text ? { text } : {}) };
  }

  if (kind === "arrow") {
    const from = readSpot(rest.replace(/^\s*from\s+/i, ""));
    if (!from) return null;
    const to = readSpot(from.rest.replace(ARROW_JOIN, ""));
    if (!to || sameSpot(from.spot, to.spot)) return null;
    // "e5 -> e9 -> e10" is a chain, not a label of "> e10": the first link is
    // drawn and the rest is not written on the screen.
    const text = ARROW_ON.test(to.rest) ? "" : readLabel(to.rest);
    return { kind, from: from.spot, to: to.spot, ...(text ? { text } : {}) };
  }

  if (kind === "number") {
    // The numeral after the spot, as the syntax has it, or before it, as a
    // model writing "NUMBER 2 e5" means it.
    const before = /^\s*#?(\d{1,3})\s+(?=[eo]\d|[[(])/i.exec(rest);
    if (before) rest = rest.slice(before[0].length);
    const at = readSpot(rest);
    if (!at) return null;
    let n = before ? Number(before[1]) : NaN;
    let tail = at.rest;
    if (!before) {
      const after = /^\s*(?:#|n\s*[=:]?\s*|no\.?\s*)?(\d{1,3})(?![\d.])/i.exec(tail);
      if (!after) return null;
      n = Number(after[1]);
      tail = tail.slice(after[0].length);
    }
    if (!Number.isInteger(n) || n < 1 || n > 9) return null;
    const text = readLabel(tail);
    return { kind, target: at.spot, n, ...(text ? { text } : {}) };
  }

  const at = readSpot(rest);
  if (!at) return null;
  const text = readLabel(at.rest);
  if (kind === "label" && !text) return null;
  return { kind, target: at.spot, ...(text ? { text } : {}) };
}

/** What one line comes to: an event to send now, or the step's action. */
export type ReaderOut = { emit: AgentEvent } | { act: ActionLine };

export interface ReaderRules {
  /** The step came with a picture and is answered about it. */
  picture?: boolean;
  /** SAY lines honoured in the step. */
  says?: number;
  /** DRAW lines honoured in the step (AGENT_DRAW_MAX). */
  draws?: number;
}

/** The text's TeX, as the symbols it stands for. */
const TEX: Record<string, string> = {
  pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", lambda: "λ",
  mu: "μ", sigma: "σ", Sigma: "Σ", omega: "ω", Omega: "Ω", phi: "φ", epsilon: "ε", varepsilon: "ε",
  rho: "ρ", tau: "τ", infty: "∞", times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼",
  to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", implies: "⇒", iff: "⇔",
  int: "∫", iint: "∬", oint: "∮", sum: "∑", prod: "∏", partial: "∂", nabla: "∇", sqrt: "√",
  degree: "°", circ: "°", in: "∈", notin: "∉", cup: "∪", cap: "∩", subset: "⊂", forall: "∀",
  exists: "∃", ldots: "…", cdots: "⋯", dots: "…", angle: "∠", perp: "⊥", parallel: "∥",
};
const SUPERSCRIPT: Record<string, string> = {
  0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};
const SUBSCRIPT: Record<string, string> = {
  0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉",
};
const scripted = (s: string, map: Record<string, string>) =>
  [...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join("") : null;
/** A numerator, a denominator or a root's contents: bracketed unless it is
 *  one number, one letter or √ of a number, so "(a+b)/c" is not read as
 *  "a+b/c", nor "1/(2a)" as half of a. */
const term = (s: string) => {
  const t = s.trim();
  return /^(?:√?[\p{N}.,]+|\p{L}[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]*|π)$/u.test(t) ? t : `(${t})`;
};

/**
 * A sentence with any TeX in it written as it is read: "$\frac{1}{2}x^2$"
 * is "(1/2)x²", "\sqrt{x+1}" is "√(x+1)", "\pi r^2" is "π r²". The picture
 * path's prompt asks for plain Unicode, and small models still write TeX for
 * maths out of habit; shown raw it is noise and spoken it is gibberish. A
 * "$" around plain words ("costs $5") is money, and is left alone.
 */
export function plainMaths(text: string): string {
  if (!/[\\^_$]/.test(text)) return text;
  let s = text
    .replace(/\\[()[\]]/g, "")
    .replace(/\$\$/g, "")
    .replace(/\$([^$\n]*[\\^_{}][^$\n]*)\$/g, "$1");
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      // A fraction with a term straight after it is bracketed, so ½x² reads
      // as (1/2)x² and not 1/(2x²).
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}(?=([\p{L}\p{N}(\\])?)/gu, (_m, a: string, b: string, next?: string) =>
        next ? `(${term(a)}/${term(b)})` : `${term(a)}/${term(b)}`)
      .replace(/\\sqrt\s*\[(\d)\]\s*\{([^{}]*)\}/g, (_m, n: string, a: string) => `${SUPERSCRIPT[n]}√${term(a)}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => `√${term(a)}`)
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf)\s*\{([^{}]*)\}/g, "$1");
    if (s === before) break;
  }
  return s
    // Limits are said: "∫ from 0 to 1", "∑ from i=1 to n".
    .replace(/\\(int|sum|prod)\s*_\s*\{?([^{}\s^]+)\}?\s*\^\s*\{?([^{}\s]+)\}?/g, (_m, op: string, a: string, b: string) => `${TEX[op]} from ${a} to ${b}`)
    // And a limit's: "lim as x → 0".
    .replace(/\\lim\s*_\s*\{([^{}]+)\}/g, "lim as $1")
    .replace(/\\(?:left|right|displaystyle)\b/g, "")
    .replace(/\\[,;:! ]|\\q?quad\b/g, " ")
    .replace(/\\([A-Za-z]+)/g, (_m, name: string) => (Object.hasOwn(TEX, name) ? TEX[name]! : name))
    .replace(/(?<=[\p{L}\p{N})\]])\^\{([^{}]+)\}/gu, (_m, a: string) => scripted(a, SUPERSCRIPT) ?? `^(${a})`)
    .replace(/(?<=[\p{L}\p{N})\]])\^(\d+|[ni](?![\p{L}]))/gu, (m, a: string) => scripted(a, SUPERSCRIPT) ?? m)
    .replace(/(?<![\p{L}])(\p{L})_\{?(\d+)\}?/gu, (_m, v: string, n: string) => v + scripted(n, SUBSCRIPT))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * The contract, applied a line at a time. After the first action, ASK, LOOK
 * or DONE the reader is ended and every later line is ignored; an action
 * naming an id that is not on this screen ends the step as a bad target. In
 * show mode an action is never honoured: when it names a control, that
 * control is pointed at instead, which is what a show run was for. The same
 * goes in any mode for a line read off the window's picture (an o id): it is
 * text, and the device has nothing behind it to press or fill.
 *
 * A DRAW is honoured in either mode and never ends anything. Its ids must be
 * on this screen, as a point's must; a place in the picture is honoured only
 * on a step that has the picture, since on any other the model is making the
 * place up; and past the step's cap the rest are dropped. A mark that fails
 * any of that is dropped whole, not drawn somewhere near: a circle in the
 * wrong place teaches the wrong thing.
 */
export class LineReader {
  private done = false;
  private says = 0;
  private readonly pointed = new Set<string>();
  private readonly picture: boolean;
  private readonly saysMax: number;
  private readonly drawsMax: number;
  /** Events this reader has produced. */
  produced = 0;
  /** Marks sent, and DRAW lines dropped (unreadable, a spot not allowed
   *  here, or past the cap), for the step's log line. */
  draws = 0;
  drawsDropped = 0;

  constructor(private readonly ids: Set<string>, private readonly mode: "show" | "do", rules: ReaderRules = {}) {
    this.picture = rules.picture === true;
    this.saysMax = rules.says ?? SAYS_MAX;
    this.drawsMax = Math.max(0, rules.draws ?? DRAWS_MAX);
  }

  get ended(): boolean { return this.done; }

  read(line: Line): ReaderOut[] {
    if (this.done) return [];
    switch (line.verb) {
      case "SAY":
        return this.say(line.text);
      case "POINT":
        return this.point(line.id, line.caption);
      case "STEPS":
        return this.out({ t: "steps", items: line.items });
      case "DRAW":
        return this.draw(line.draw);
      case "ASK":
        // The picture goes once: a question back would be answered on a step
        // without it. So it is said, as part of the answer.
        if (this.picture) return this.say(line.text);
        this.done = true;
        return this.out({ t: "ask", text: line.text });
      case "LOOK":
        // A step with the picture already has it.
        if (this.picture) return [];
        this.done = true;
        return this.out({ t: "look", why: line.why ?? "the picture" });
      case "DONE":
        this.done = true;
        return this.out(line.text ? { t: "done", text: line.text } : { t: "done" });
      default:
        return this.action(line);
    }
  }

  private say(text: string): ReaderOut[] {
    if (this.says >= this.saysMax) return [];
    const said = this.picture ? plainMaths(text) : text;
    if (!said) return [];
    this.says += 1;
    return this.out({ t: "say", text: said });
  }

  private draw(mark: AgentDraw | null): ReaderOut[] {
    if (!mark || this.draws >= this.drawsMax || !this.placeable(mark)) {
      this.drawsDropped += 1;
      return [];
    }
    const e: AgentDraw = { ...mark };
    // A picture's labels are maths written by hand, like its sentences.
    if (e.text !== undefined && this.picture) {
      const text = labelText(plainMaths(e.text));
      if (text) e.text = text;
      else delete e.text;
    }
    if (e.kind === "label" && !e.text) {
      this.drawsDropped += 1;
      return [];
    }
    this.draws += 1;
    return this.out({ t: "draw", ...e });
  }

  /** Every spot of the mark is one this step may draw at. */
  private placeable(mark: AgentDraw): boolean {
    if (mark.points && !this.picture) return false;
    return [mark.target, mark.from, mark.to].every((s) => !s || ("id" in s ? this.ids.has(s.id) : this.picture));
  }

  private point(id: string, caption?: string): ReaderOut[] {
    // A point at a control that is not here has nothing to draw: skipped.
    if (!this.ids.has(id) || this.pointed.has(id) || this.pointed.size >= POINTS_MAX) return [];
    this.pointed.add(id);
    return this.out(caption ? { t: "point", id, caption } : { t: "point", id });
  }

  private action(line: ActionLine): ReaderOut[] {
    const id = "id" in line ? line.id : undefined;
    if (this.mode === "show") return id !== undefined ? this.point(id) : [];
    if (line.verb !== "SCROLL" && id && isOcrLine(id) && this.ids.has(id)) return this.point(id);
    this.done = true;
    // SCROLL's id is only where to scroll; the parser kept it only when it was
    // an id, and one that is not on this screen, or is a line of text with
    // nothing to scroll, is dropped, not refused.
    if (line.verb === "SCROLL") {
      return [{ act: line.id && (!this.ids.has(line.id) || isOcrLine(line.id)) ? { verb: "SCROLL", dir: line.dir } : line }];
    }
    if (id !== undefined && !this.ids.has(id)) {
      return this.out({ t: "error", code: "bad_target", message: "That control isn't on the screen any more." });
    }
    return [{ act: line }];
  }

  private out(e: AgentEvent): ReaderOut[] {
    this.produced += 1;
    return [{ emit: e }];
  }
}

/** A line of text the device read off the window's picture, not a control. */
export const isOcrLine = (id: string) => id.startsWith("o");
