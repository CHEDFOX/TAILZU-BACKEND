/**
 * THE FREE PATH: commands that need no model at all.
 *
 * "Scroll down", "go back", "undo", "press escape" and "open Slack" have one
 * meaning wherever they are said, so they are answered here, for nothing,
 * before anything is sent anywhere. The rule is that the WHOLE utterance has
 * to be the command once the padding is gone: fillers, a name it was called
 * by, "can you", "please". Anchoring both ends is what keeps "don't scroll
 * down" and "scroll down to the comments and reply" out of it; anything with
 * more in it than the command goes on to the resolver or the model.
 *
 * Also here: whether a run SHOWS or DOES, decided from its first words, and
 * whether what they said with text selected is about that text.
 */
import type { AgentElement } from "../../../shared/types/api.js";

export type Platform = "mac" | "win";

/** An action the grammar settled, before risk is added. */
export interface GrammarAction {
  kind: "key" | "scroll" | "open";
  keys?: string;
  dir?: "up" | "down" | "left" | "right";
  app?: string;
}

/** Lowercase words, the punctuation commands never need gone. Keeps what a
 *  chord or a channel is spelled with: "+", "#", "@", "'" and ".". */
export function plainWords(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{M}\p{N}\s'#@+.-]/gu, " ")
    .replace(/(?<=\S)[.](?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HEAD_FILLER = /^(?:u+m+|u+h+|uhm+|e+r+m*|h+m+|ok(?:ay)?|so|well|hey|hi|yo|alright|and|now|just|please|pls|kindly|actually)\b[\s,]*/;
const HEAD_ASK = /^(?:can you|could you|would you|will you|can u|could u|i want you to|i'd like you to|i need you to|go ahead and)\b\s*/;
const TAIL = /\s*\b(?:please|pls|thanks|thank you|for me|now|right now|quickly|okay|ok|again)$/;

/**
 * What they said with the padding gone, for matching: "Hey Tailzu, um, can
 * you scroll down please?" is "scroll down". `names` are the names it
 * answers to (its own, and the one they gave it).
 */
export function commandText(said: string, names: string[] = []): string {
  let s = plainWords(said);
  const named = names.map((n) => plainWords(n)).filter(Boolean).map(escapeRe);
  const NAME = named.length ? new RegExp(`^(?:${named.join("|")})\\b[\\s,]*`) : null;
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s.replace(HEAD_FILLER, "").replace(HEAD_ASK, "");
    if (NAME) s = s.replace(NAME, "");
    s = s.replace(TAIL, "").trim();
    if (s === before) break;
  }
  return s;
}

/**
 * A question or a request to be shown, by its first words. Questions in
 * English open with the question; in Hinglish the question word comes late,
 * so those are found anywhere. A question mark after a sentence that does not
 * open as a polite request counts too. When in doubt this says "show", which
 * is the safe side: a show run never acts.
 */
const SHOW_OPENING = /^(?:where|how|what|whats|what's|why|which|who|whose|when|is there|are there|is it|is this|is that|does|do i|do you|did|can i|could i|should i|am i|show me|point|find|locate|explain|tell me|help me (?:find|understand)|i can'?t find|i cannot find|i don'?t see|i do not see|look for|wheres|where's|hows|how's)\b/;
const SHOW_ANYWHERE = /\b(?:kahan|kahaan|kaha|kidhar|kaise|kaisa|kyun|kyu|kaun sa|kaunsa)\b|कहाँ|कहां|किधर|कैसे|क्यों|कौन सा/u;
const POLITE_REQUEST = /^(?:\W*)(?:hey\s+\S+[\s,]+)?(?:please\s+)?(?:can|could|would|will) (?:you|u)\b/i;

export function modeOf(said: string, names: string[] = []): "show" | "do" {
  const clean = commandText(said, names);
  if (SHOW_OPENING.test(clean) || SHOW_ANYWHERE.test(clean)) return "show";
  if (/\?\s*$/.test(said) && !POLITE_REQUEST.test(said.trim())) return "show";
  return "do";
}

const KEY_WORDS: Record<string, string> = {
  enter: "enter", return: "enter", escape: "escape", esc: "escape", tab: "tab",
  space: "space", spacebar: "space", backspace: "backspace", delete: "delete", del: "delete",
  up: "up", down: "down", left: "left", right: "right", home: "home", end: "end",
  pageup: "pageup", pagedown: "pagedown",
};

function modifierFor(word: string, platform: Platform): string | null {
  switch (word) {
    case "cmd": case "command": return platform === "mac" ? "cmd" : "ctrl";
    case "ctrl": case "control": return "ctrl";
    case "alt": case "option": case "opt": return "alt";
    case "shift": return "shift";
    case "win": case "windows": case "super": case "meta": return platform === "mac" ? "cmd" : "win";
    default: return null;
  }
}

/** "control shift t" → "ctrl+shift+t"; null when it is not a chord. */
export function spokenChord(words: string, platform: Platform): string | null {
  const tokens = words
    .replace(/\bpage (up|down)\b/g, "page$1")
    .replace(/\b(?:the|key|keys|button|arrow|plus)\b/g, " ")
    .split(/[\s+]+/)
    .filter(Boolean);
  if (!tokens.length || tokens.length > 4) return null;
  const mods: string[] = [];
  for (const t of tokens.slice(0, -1)) {
    const m = modifierFor(t, platform);
    if (!m) return null;
    if (!mods.includes(m)) mods.push(m);
  }
  const last = tokens.at(-1)!;
  const key = KEY_WORDS[last] ?? (/^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4]))$/.test(last) ? last : null);
  if (!key) return null;
  return [...mods, key].join("+");
}

/** Words that make "open X" about something on this screen, not an app. */
const ON_SCREEN = /(?:^|\s)(?:the|this|that|these|those|my|a|an|new|menu|tab|tabs|button|panel|settings|preferences|options|file|files|folder|link|page|window|dialog|channel|chat|message|messages|thread|conversation|inbox|email|mail|item|list|sidebar|section|it)(?:\s|$)/;

const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());

function labelsSay(name: string, elements: AgentElement[]): boolean {
  const n = ` ${name} `;
  return elements.some((e) => e.label && ` ${plainWords(e.label)} `.includes(n));
}

/**
 * The grammar's answer for a cleaned utterance, or null. `elements` is the
 * screen, read only to keep "open export" (a menu right there) from becoming
 * an app called Export.
 */
export function grammar(clean: string, platform: Platform, elements: AgentElement[] = []): GrammarAction | null {
  let m = /^(launch|switch to|open) (.+)$/.exec(clean);
  if (m) {
    const name = m[2]!.replace(/\s+(?:app|application)$/, "").trim();
    if (!name || name.split(" ").length > 4 || /^[#@]/.test(name)) return null;
    // "Launch" and "switch to" only ever name an app. "Open" names a thing on
    // the screen just as often, and that is the resolver's or the model's.
    if (m[1] === "open" && (ON_SCREEN.test(name) || labelsSay(name, elements))) return null;
    return { kind: "open", app: titleCase(name) };
  }

  m = /^scroll(?: (?:back|the page|this|this page|the list|it))? (?:to the )?(up|down|left|right|top|bottom)(?: (?:a bit|a little|a little bit|a lot|some|more|of the page))?$/.exec(clean);
  if (m) {
    const d = m[1]!;
    return { kind: "scroll", dir: d === "top" ? "up" : d === "bottom" ? "down" : (d as GrammarAction["dir"]) };
  }

  if (/^(?:go )?back(?: a page| one page)?$/.test(clean)) {
    return { kind: "key", keys: platform === "mac" ? "cmd+[" : "alt+left" };
  }
  if (/^(?:go )?forward(?: a page| one page)?$/.test(clean)) {
    return { kind: "key", keys: platform === "mac" ? "cmd+]" : "alt+right" };
  }
  if (/^undo(?: (?:that|it|this|the last (?:thing|change)))?$/.test(clean)) {
    return { kind: "key", keys: platform === "mac" ? "cmd+z" : "ctrl+z" };
  }
  if (/^redo(?: (?:that|it|this))?$/.test(clean)) {
    return { kind: "key", keys: platform === "mac" ? "cmd+shift+z" : "ctrl+y" };
  }

  m = /^(?:press|hit|push) (.+)$/.exec(clean);
  if (m) {
    const keys = spokenChord(m[1]!, platform);
    if (keys) return { kind: "key", keys };
  }
  return null;
}

/** The grammar action as the line the device will report back as `did`. */
export function grammarLine(a: GrammarAction): string {
  if (a.kind === "key") return `KEY ${a.keys}`;
  if (a.kind === "scroll") return `SCROLL ${a.dir}`;
  return `OPEN ${a.app}`;
}

/**
 * Said with text selected, is this about the text? "Make this shorter",
 * "rewrite it", "bullet points", "translate to Hindi", "fix the grammar". Then
 * the writer rewrites the selection and the model is never asked.
 */
const ABOUT_THE_TEXT = /\b(?:make (?:this|it|that|them)|rewrite|re-write|reword|rephrase|shorter|longer|shorten|lengthen|condense|expand (?:this|it|on)|bullet(?:ed)?(?: points?| list)?|numbered list|translate|fix (?:the |my |this |its |any )?(?:grammar|spelling|typos?|punctuation|wording)|proofread|correct (?:this|it|the grammar|the spelling)|more (?:formal|casual|polite|friendly|professional|concise|direct)|less (?:formal|casual|harsh|wordy)|summari[sz]e|simplify|turn (?:this|it|that) into|in (?:hindi|english|hinglish|spanish|french|german|marathi|tamil|telugu|bengali|gujarati|punjabi|urdu|arabic|japanese|chinese|portuguese))\b/;
export function aboutTheText(clean: string): boolean {
  return ABOUT_THE_TEXT.test(clean);
}
