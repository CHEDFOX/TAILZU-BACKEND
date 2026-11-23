/**
 * EVERY ROLE A MODEL CAN INVENT, RESOLVED ONTO A LOOK THIS APP ALREADY HAS.
 *
 *   textLook("snippet")      -> "mono"
 *   boxLook("comparison")    -> { card: true }
 *   controlLook("duplicate") -> "copy"
 *
 * THE PROBLEM THIS SOLVES. A catalogue of blocks is never finished: somebody makes a bot nobody planned for, it needs a
 * thing nobody wrote, and the answer cannot be "wait for a release". But a model that is handed the styles instead will
 * write its own, and then nothing on any screen matches anything else — which is the one thing the design will not have.
 *
 * SO THE VOCABULARY IS OPEN AT THE NAME AND CLOSED AT THE LOOK. The model says what a thing IS, in whatever words suit
 * the moment: `role: "code"`, `role: "severity"`, `role: "comparison"`, `role: "duplicate"`. It never says how the thing
 * looks. Every role, including one nobody has ever written down, is resolved HERE onto one of the handful of looks this
 * app already draws and has already tested. A role we know lands where it should; one we have never seen lands on the
 * nearest thing we do know, and worst of all lands on the plain one. Nothing can come out off-style, because there is no
 * style for it to come out in except ours.
 *
 * HOW A ROLE IS RESOLVED, in order:
 *   1. the table, which is every role we have thought of and its synonyms
 *   2. the hints, which read the SHAPE of an invented name ("api_snippet" has "snip" in it, so it is code)
 *   3. the family's plain look
 *
 * Deliberately not clever: no string distance, no model call, no learning. A rule a person can read off the page is worth
 * more here than one that is right more often, because the failure of a guess is a thing drawn wrong and nobody told.
 */
import { SHOW_LIMITS as L, type PartKind, type TextStyle, type Tone } from "./types.js";

/** A role as it is looked up: lowercase, trimmed, punctuation that only joins words removed. */
export const normalRole = (role: string): string => role.trim().toLowerCase().replace(/[\s._-]+/g, "");

// ------------------------------------------------------------------ text

/** The text looks this app draws. A role resolves to one of these and nothing else. */
const TEXT_TABLE: Readonly<Record<string, TextStyle>> = {
  title: "title", name: "title", subject: "title",
  heading: "heading", header: "heading", subtitle: "heading", section: "heading", step: "heading",
  body: "body", text: "body", paragraph: "body", detail: "body", answer: "body", summary: "body", quote: "body",
  label: "label", tag: "label", badge: "label", pill: "label", chip: "label", status: "label",
  meta: "meta", caption: "meta", note: "meta", hint: "meta", aside: "meta", footnote: "meta", timestamp: "meta", small: "meta",
  big: "big", number: "big", figure: "big", total: "big", amount: "big", count: "big", score: "big", result: "big",
  code: "mono", snippet: "mono", command: "mono", script: "mono", path: "mono", url: "mono", id: "mono",
  key: "mono", token: "mono", json: "mono", sql: "mono", query: "mono", mono: "mono", terminal: "mono", output: "mono",
};

/** Read off the shape of a name nobody wrote down. First match wins, so the most telling patterns come first. */
const TEXT_HINTS: ReadonlyArray<readonly [RegExp, TextStyle]> = [
  [/cod|snip|comm?and|script|shell|termin|path|url|uri|slug|token|json|yaml|sql|query|regex|hash|sha|hex/, "mono"],
  [/titl|headl|subject/, "title"],
  [/head|section|chapter/, "heading"],
  [/label|tag|badge|chip|pill|state|status/, "label"],
  [/meta|note|hint|caption|small|foot|aside|minor|sub/, "meta"],
  [/num|count|total|amount|score|figure|metric|stat|price|cost/, "big"],
];

export function textLook(role: string): TextStyle {
  const r = normalRole(role);
  const exact = TEXT_TABLE[r];
  if (exact) return exact;
  for (const [re, look] of TEXT_HINTS) if (re.test(r)) return look;
  return "body";
}

// ------------------------------------------------------------------ box

/** How a box is drawn: as a plain stack, as a card, or as a card with a tone on its edge. */
export interface BoxLook { card: boolean; tone?: Tone; row?: boolean }

const BOX_TABLE: Readonly<Record<string, BoxLook>> = {
  group: { card: false }, stack: { card: false }, block: { card: false }, section: { card: false }, body: { card: false },
  row: { card: false, row: true }, line: { card: false, row: true }, inline: { card: false, row: true }, pair: { card: false, row: true },
  card: { card: true }, panel: { card: true }, box: { card: true }, tile: { card: true }, item: { card: true },
  option: { card: true }, choice: { card: true }, comparison: { card: true }, candidate: { card: true }, summary: { card: true },
  note: { card: true, tone: "info" }, info: { card: true, tone: "info" }, detail: { card: true, tone: "info" },
  tip: { card: true, tone: "tip" }, idea: { card: true, tone: "tip" }, suggestion: { card: true, tone: "tip" },
  warning: { card: true, tone: "warn" }, warn: { card: true, tone: "warn" }, caution: { card: true, tone: "warn" },
  error: { card: true, tone: "warn" }, danger: { card: true, tone: "warn" }, risk: { card: true, tone: "warn" }, severity: { card: true, tone: "warn" },
  good: { card: true, tone: "good" }, done: { card: true, tone: "good" }, success: { card: true, tone: "good" }, ready: { card: true, tone: "good" },
};

const BOX_HINTS: ReadonlyArray<readonly [RegExp, BoxLook]> = [
  [/warn|caution|danger|risk|error|fail|sever|alert|problem|issue|broken/, { card: true, tone: "warn" }],
  [/good|done|success|pass|ready|complete|ok\b/, { card: true, tone: "good" }],
  [/tip|idea|suggest|advice|recommend/, { card: true, tone: "tip" }],
  [/note|info|about|context|explain/, { card: true, tone: "info" }],
  [/row|inline|side|beside|horizont/, { card: false, row: true }],
  [/card|panel|tile|box|option|candidat|compar|choice|item|entry/, { card: true }],
  [/group|stack|list|set|wrap|section|holder|contain/, { card: false }],
];

export function boxLook(role: string): BoxLook {
  const r = normalRole(role);
  const exact = BOX_TABLE[r];
  if (exact) return exact;
  for (const [re, look] of BOX_HINTS) if (re.test(r)) return look;
  return { card: false };
}

// ------------------------------------------------------------------ control

/** What a control is drawn and behaves as. Only what vocabulary 1 can really do, so every build honours it. */
export type ControlLook = "copy" | "say";

const CONTROL_TABLE: Readonly<Record<string, ControlLook>> = {
  copy: "copy", duplicate: "copy", clipboard: "copy", take: "copy", grab: "copy", copycode: "copy", copycommand: "copy",
  say: "say", ask: "say", pick: "say", choose: "say", select: "say", send: "say", reply: "say", tell: "say",
  run: "say", do: "say", go: "say", next: "say", more: "say", explain: "say", retry: "say", confirm: "say",
};

const CONTROL_HINTS: ReadonlyArray<readonly [RegExp, ControlLook]> = [
  [/copy|duplicat|clipboard|yank|paste/, "copy"],
  [/pick|choos|select|send|ask|reply|say|tell|run|go|next|more|explain|retry|confirm|apply|use/, "say"],
];

/**
 * A control's look, from its role AND what it was given to do. The action it carries decides when the role says nothing
 * useful: a control holding text to copy is a copy, one holding words to send is a send. A control with neither is
 * nothing at all, and check.ts drops it rather than drawing a button that does nothing.
 */
export function controlLook(role: string, has: { copy?: boolean; say?: boolean }): ControlLook | null {
  const r = normalRole(role);
  const named = CONTROL_TABLE[r] ?? CONTROL_HINTS.find(([re]) => re.test(r))?.[1];
  // What it was actually given wins over what it was called: a "copy" holding only words to send can only send.
  if (named === "copy" && has.copy) return "copy";
  if (named === "say" && has.say) return "say";
  if (has.copy) return "copy";
  if (has.say) return "say";
  return null;
}

// ------------------------------------------------------------------ the whole lot, for a test and for a log

/** Every look a role can land on, by family: what the design has to cover, and all it has to cover. */
export const LOOKS = {
  text: ["title", "heading", "body", "label", "meta", "big", "mono"] as const,
  box: ["plain", "row", "card", "card:info", "card:tip", "card:warn", "card:good"] as const,
  control: ["copy", "say"] as const,
} as const;

/** A role, as the log says it: what was asked for, and what it was drawn as. */
export const lookWords = (kind: PartKind, role: string, look: string): string =>
  `part ${kind} "${role.slice(0, L.role)}" drawn as ${look}`;
