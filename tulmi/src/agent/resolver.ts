/**
 * THE OTHER FREE PATH: "where's Export?" and "click Export" against the labels
 * on the screen.
 *
 * Most of what people ask Ask is a name they can already read off a control,
 * said back. That needs a string match, not a model, as long as the match is
 * unmistakable. So the bar is high on both sides: the best label has to score
 * 0.85 or more AND beat the next one by 0.2. Two buttons called "Save", or a
 * label that is only roughly what they said, are exactly the cases where a
 * wrong guess would point at or press the wrong thing, and those go to the
 * model, which can see the regions and ask.
 */
import type { AgentElement } from "../../../shared/types/api.js";

export const ACCEPT_AT = 0.85;
export const MARGIN = 0.2;

/** What they asked of a named control: to be shown it, or to press it. */
export interface ResolverAsk {
  verb: "point" | "press";
  /** The name they said, cleaned: "export". */
  target: string;
  /** The kind of control they named, when they named one ("the export button"). */
  roleHint?: string;
}

const POINT_ASK = /^(?:where(?:'s| is| are|s)?|where can i find|where do i find|point (?:at|to)|show me(?: where)?(?: the)?|find|locate|look for|help me find|i can'?t find|i cannot find)\s+(.+)$/;
const PRESS_ASK = /^(?:click on|click|press|tap on|tap|hit|select|choose|open)\s+(.+)$/;

/** Role words people say, and the roles they mean. */
const ROLE_WORDS: Record<string, string[]> = {
  button: ["button"], link: ["link"], tab: ["tab"], menu: ["menu", "menuitem"],
  option: ["menuitem", "item", "radio"], item: ["item", "menuitem", "row", "cell"],
  field: ["field", "area", "combo"], box: ["field", "area", "combo", "check"],
  checkbox: ["check"], toggle: ["switch", "check"], switch: ["switch", "check"],
  icon: ["button", "image", "link"], dropdown: ["combo", "menu"],
};

export function resolverAsk(clean: string): ResolverAsk | null {
  let verb: ResolverAsk["verb"] | null = null;
  let rest = "";
  let m = POINT_ASK.exec(clean);
  if (m) { verb = "point"; rest = m[1]!; }
  else if ((m = PRESS_ASK.exec(clean))) { verb = "press"; rest = m[1]!; }
  if (!verb) return null;
  let roleHint: string | undefined;
  let t = rest
    .replace(/\s+(?:is|are|located|at)$/, "")
    .replace(/\s+(?:on|in) (?:the|this) (?:screen|page|window|app)$/, "")
    .replace(/^(?:the|a|an|my|this|that)\s+/, "");
  const last = /\s(\w+)$/.exec(t);
  if (last && ROLE_WORDS[last[1]!]) { roleHint = last[1]; t = t.slice(0, last.index); }
  t = t.replace(/^(?:the|a|an|my|this|that)\s+/, "").trim();
  if (!t || t.split(" ").length > 6) return null;
  return { verb, target: t, roleHint };
}

/** Lowercase words without punctuation or accents, for comparing names. */
export function nameWords(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const similarity = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

/**
 * How well a label names what they said, 0..1: the better of the whole
 * strings' edit distance and their word overlap, where a word counts when it
 * is spelled within a letter or so ("exprot" for "export"). Speech gets
 * single words wrong far more often than it gets the order wrong.
 */
export function labelScore(said: string, label: string): number {
  const a = nameWords(said);
  const b = nameWords(label);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aw = a.split(" ");
  const bw = b.split(" ");
  let matched = 0;
  const used = new Set<number>();
  for (const w of aw) {
    let best = -1, bestSim = 0;
    bw.forEach((x, i) => {
      if (used.has(i)) return;
      const sim = w === x ? 1 : w.length >= 4 && x.length >= 4 ? similarity(w, x) : 0;
      if (sim > bestSim) { bestSim = sim; best = i; }
    });
    if (best >= 0 && bestSim >= 0.8) { used.add(best); matched += 1; }
  }
  const overlap = (2 * matched) / (aw.length + bw.length);
  return Math.max(overlap, similarity(a, b));
}

/** Roles a press is meant for. Static text and headings share their words
 *  with the button beside them, and are never what "click" means. */
const NOT_PRESSABLE = new Set(["text", "heading", "window"]);

export interface Resolution {
  element: AgentElement;
  score: number;
}

/**
 * The one control their words name, or null when none does clearly enough.
 * Scores are lifted a little for the role they named and lowered for any
 * other; for a press, disabled controls and ones that are not pressed are
 * left out.
 */
export function resolve(ask: ResolverAsk, elements: AgentElement[]): Resolution | null {
  const roles = ask.roleHint ? ROLE_WORDS[ask.roleHint] ?? [] : [];
  const scored: Resolution[] = [];
  for (const el of elements) {
    if (!el.label) continue;
    if (ask.verb === "press" && (NOT_PRESSABLE.has(el.role) || el.disabled)) continue;
    let score = labelScore(ask.target, el.label);
    if (roles.length) score += roles.includes(el.role) ? 0.1 : -0.2;
    scored.push({ element: el, score: Math.min(1, score) });
  }
  scored.sort((x, y) => y.score - x.score);
  const [best, second] = scored;
  if (!best || best.score < ACCEPT_AT) return null;
  // A hair of slack: 1.0 against 0.8 is a clear margin, whatever the floats say.
  if (second && best.score - second.score < MARGIN - 1e-9) return null;
  return best;
}
