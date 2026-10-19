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

const ID = /^(e\d{1,6})\b\s*/i;

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

/**
 * The contract, applied a line at a time. After the first action, ASK or DONE
 * the reader is ended and every later line is ignored; an action naming an id
 * that is not on this screen ends the step as a bad target. In show mode an
 * action is never honoured: when it names a control, that control is pointed
 * at instead, which is what a show run was for.
 */
export class LineReader {
  private done = false;
  private says = 0;
  private readonly pointed = new Set<string>();
  /** Events this reader has produced. */
  produced = 0;

  constructor(private readonly ids: Set<string>, private readonly mode: "show" | "do") {}

  get ended(): boolean { return this.done; }

  read(line: Line): ReaderOut[] {
    if (this.done) return [];
    switch (line.verb) {
      case "SAY":
        if (this.says >= SAYS_MAX) return [];
        this.says += 1;
        return this.out({ t: "say", text: line.text });
      case "POINT":
        return this.point(line.id, line.caption);
      case "STEPS":
        return this.out({ t: "steps", items: line.items });
      case "ASK":
        this.done = true;
        return this.out({ t: "ask", text: line.text });
      case "DONE":
        this.done = true;
        return this.out(line.text ? { t: "done", text: line.text } : { t: "done" });
      default:
        return this.action(line);
    }
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
    this.done = true;
    // SCROLL's id is only where to scroll; the parser kept it only when it was
    // an id, and one that is not on this screen is dropped, not refused.
    if (line.verb === "SCROLL") {
      return [{ act: line.id && !this.ids.has(line.id) ? { verb: "SCROLL", dir: line.dir } : line }];
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
