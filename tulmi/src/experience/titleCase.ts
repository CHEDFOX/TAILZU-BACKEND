/**
 * EVERY WORD STARTS WITH A CAPITAL — the owner's rule for the app's own words.
 *
 * Applied to a phone screen as the last step of building it (catalog.ts
 * buildScreen), so the hundreds of strings written in sentence case across
 * the catalog follow it without each being rewritten, and a string added
 * tomorrow follows it too.
 *
 * Only the app's OWN words. Untouched:
 *   - anything bound from state: a dictation, a history row, a name — what
 *     the person wrote is theirs, and its casing is part of it;
 *   - a node marked `props.keepCase` and everything under it: the writing
 *     samples on Voices and the dictionary's words show text exactly as it
 *     would be written, which is the point of showing them;
 *   - a label key ("@history.title") or a state reference ("$state.x"),
 *     which are not words yet;
 *   - links, emails and file names (tailzu.space, a@b.c);
 *   - brand words that start small on purpose (iPhone, macOS);
 *   - a unit after a number ("15 min", "6 pm", "2k"), which reads as part of
 *     the number;
 *   - scripts without capitals (Devanagari, Tamil, Arabic, Chinese…), which
 *     are left exactly as they are.
 */
import type { Node, ScreenResponse } from "../../../shared/types/sdui.js";

const UNITS = new Set(["min", "mins", "sec", "secs", "h", "hr", "hrs", "ms", "am", "pm", "k", "x", "kb", "mb", "wpm"]);

function capChunk(chunk: string): string {
  // The first letter, past any opening punctuation ("(clean", "“hello").
  let out = chunk.replace(/^([^\p{L}\p{N}]*)(\p{Ll})/u, (_, p: string, c: string) => p + c.toUpperCase());
  // And each part of a joined word: "clean-up" → "Clean-Up", "and/or".
  out = out.replace(/([-–—/])(\p{Ll})/gu, (_, p: string, c: string) => p + c.toUpperCase());
  return out;
}

/** One string, every word capitalised (see the rules above). */
export function titleCase(text: string, startsAfterNumber = false): string {
  return titleCaseRun(text, startsAfterNumber).text;
}

/**
 * The same, and whether the text ends on a number — so a sentence drawn a
 * word to a node ("19 " then "min.") still reads its unit as the number's.
 */
function titleCaseRun(text: string, startsAfterNumber: boolean): { text: string; endsOnNumber: boolean } {
  if (!text || text.startsWith("@") || text.includes("$state")) return { text, endsOnNumber: false };
  const parts = text.split(/(\s+)/);
  let afterNumber = startsAfterNumber;
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i]!;
    if (!chunk || /^\s+$/.test(chunk)) continue;
    const core = chunk.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const keep =
      /:\/\/|@|www\./i.test(chunk) ||
      /[\p{L}\p{N}]\.[\p{L}]{2,}/u.test(core) ||                // a domain or a file name
      /^\p{Ll}.*\p{Lu}/u.test(core) ||                         // iPhone, macOS
      (afterNumber && UNITS.has(core.toLowerCase())) ||        // 15 min, 6 pm
      /\{[^}]*\}/.test(chunk);                                 // a {placeholder}
    if (!keep) parts[i] = capChunk(chunk);
    afterNumber = /\p{N}[^\p{L}]*$/u.test(chunk);
  }
  return { text: parts.join(""), endsOnNumber: afterNumber };
}

/** Props that hold a node's own visible words. */
const WORD_PROPS = ["content", "label", "title", "subtitle", "placeholder", "emptyLabel", "caption", "hint"] as const;

/** Whether the last words visited ended on a number, in reading order. */
let lastWasNumber = false;

function walkNode(n: unknown): void {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { n.forEach(walkNode); return; }
  const node = n as Node & { props?: Record<string, unknown>; fallback?: unknown };
  if (typeof node.type !== "string") return;
  const props = node.props;
  if (props?.keepCase === true) { lastWasNumber = false; return; }
  if (props) {
    for (const k of WORD_PROPS) {
      const v = props[k];
      if (typeof v !== "string") continue;
      const run = titleCaseRun(v, k === "content" && lastWasNumber);
      props[k] = run.text;
      if (k === "content") lastWasNumber = run.endsOnNumber;
    }
    // Choices drawn as words: a segmented control's, a picker's.
    if (Array.isArray(props.options)) {
      for (const o of props.options as Array<Record<string, unknown>>) {
        if (o && typeof o.label === "string") o.label = titleCase(o.label);
      }
    }
    if (props.itemTemplate) walkNode(props.itemTemplate);
  }
  if (node.fallback) walkNode(node.fallback);
  for (const c of (node as { children?: unknown[] }).children ?? []) walkNode(c);
}

/** What an action says out loud: a toast, a copied-text confirmation. */
function walkAction(a: unknown): void {
  if (!a || typeof a !== "object") return;
  if (Array.isArray(a)) { a.forEach(walkAction); return; }
  const act = a as Record<string, unknown>;
  if (act.kind === "toast" && typeof act.message === "string") act.message = titleCase(act.message);
  if (typeof act.toastMessage === "string") act.toastMessage = titleCase(act.toastMessage);
  for (const k of ["actions", "then", "else", "onSuccess", "onError"]) walkAction(act[k]);
}

/** The whole screen, in place, and returned for chaining. */
export function titleCaseScreen(screen: ScreenResponse): ScreenResponse {
  if (typeof screen.title === "string") screen.title = titleCase(screen.title);
  lastWasNumber = false;
  walkNode(screen.root);
  for (const a of Object.values(screen.actions ?? {})) walkAction(a);
  return screen;
}

/** A label map (the bootstrap's copy), every value capitalised. */
export function titleCaseLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) out[k] = typeof v === "string" ? titleCase(v) : v;
  return out;
}
