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
 */
import type { AgentEvent } from "../../../shared/types/api.js";
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
    let m = MODS[t];
    if (!m) return null;
    if (m === "cmd" && platform === "win") m = "ctrl";
    if (m === "win" && platform === "mac") m = "cmd";
    if (!mods.includes(m)) mods.push(m);
  }
  const last = tokens.at(-1)!;
  const key = NAMED_KEYS[last]
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
    default:
      return null;
  }
}

/** What one line comes to: an event to send now, or the step's action. */
export type ReaderOut = { emit: AgentEvent } | { act: ActionLine };

export interface ReaderRules {
  /** The step came with a picture and is answered about it. */
  picture?: boolean;
  /** SAY lines honoured in the step. */
  says?: number;
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
 */
export class LineReader {
  private done = false;
  private says = 0;
  private readonly pointed = new Set<string>();
  private readonly picture: boolean;
  private readonly saysMax: number;
  /** Events this reader has produced. */
  produced = 0;

  constructor(private readonly ids: Set<string>, private readonly mode: "show" | "do", rules: ReaderRules = {}) {
    this.picture = rules.picture === true;
    this.saysMax = rules.says ?? SAYS_MAX;
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
