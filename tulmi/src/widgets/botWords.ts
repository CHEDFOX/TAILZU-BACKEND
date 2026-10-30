/**
 * A BOT'S WORDS FOR THE X0 WIDGET (docs/widget-glance-v2.md section 1): the one contract every bot reports to, built-in or made by a person.
 *
 * A bot reports five kinds of event, each with its own short words:
 *
 *   needs    question (80), up to 3 choices (14 each, one per answer, in the answer's order), private
 *   working  doing (28), stage / of / stageName
 *   done     result (40), link, pr
 *   failed   problem (40)
 *   idle     nothing
 *
 * The words are the bot's own (the Code bot's ask_user short / short_options and done short, code/agent/tools.ts; a person's bot's x0_widget
 * on a change it calls, bots/tools.ts). This file is the ONE place they are checked: widgetWords() keeps what fits, cuts what is long AT A WORD
 * ("…" only when it cut), and drops what is wrong. It never throws and never refuses: a bot's work never fails over its widget words. Where a
 * bot gave nothing usable, eventLine() writes the server's fill-in line ("{bot} needs you", knobs x0.fill.*, in English and Hinglish).
 *
 * Pure: no imports, so the agent's tools, the connectors and the widgets all use it.
 */

export const WIDGET_LIMITS = { question: 80, choice: 14, choices: 3, doing: 28, result: 40, problem: 40, stageName: 20 } as const;

export type EventKind = "needs" | "working" | "done" | "failed" | "idle";

/** The most characters each event's line may have. */
export const EVENT_LIMIT: Readonly<Record<EventKind, number>> = {
  needs: WIDGET_LIMITS.question, working: WIDGET_LIMITS.doing, done: WIDGET_LIMITS.result, failed: WIDGET_LIMITS.problem, idle: WIDGET_LIMITS.doing,
};

/** What a bot gives when it needs the person. `choices[i]` is the short label of the bot's i-th answer; "" where it gave none that fits. */
export interface NeedsWords {
  question?: string;
  choices?: string[];
  /** Its words never show on a locked phone. */
  private?: boolean;
}

export interface WidgetWords extends NeedsWords {
  doing?: string;
  stage?: number;
  of?: number;
  stageName?: string;
  result?: string;
  link?: string;
  pr?: { number: number; url: string };
  problem?: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/** One line: control characters and runs of space made one space, trimmed. Anything that is not a string is "". */
export function oneLineOf(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * `text` in at most `max` characters: whole when it fits; else cut at the last word that fits, with "…" (which counts). A single word longer
 * than the room has no word to cut at: "" (the caller falls back to its fill-in), never half a word.
 */
export function cutAtWord(text: string, max: number): string {
  const s = oneLineOf(text);
  if (s.length <= max) return s;
  if (max < 2) return "";
  const room = max - 1;
  // One past the room: when the character there is a space, the word before it ends exactly at the cut.
  const head = s.slice(0, room + 1);
  const at = head.lastIndexOf(" ");
  if (at <= 0) return "";
  const kept = s.slice(0, at).replace(/[\s,;:.!?\-–—/(]+$/u, "");
  return kept ? `${kept}…` : "";
}

const text = (v: unknown, max: number): string | undefined => cutAtWord(oneLineOf(v), max) || undefined;
const LINK = /^(?:tulmi:\/\/|https:\/\/)[^\s"<>]{1,300}$/;
const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

/** The short labels of a bot's answers, in order: each cut to 14 at a word, "" where none fits. At most 3. */
export function choicesOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.slice(0, WIDGET_LIMITS.choices).map((c) => text(c, WIDGET_LIMITS.choice) ?? "");
  return out.some(Boolean) ? out : undefined;
}

/** A bot's widget words, checked: what fits is kept, what is long is cut at a word, what is wrong is left out. Never throws. */
export function widgetWords(raw: unknown): WidgetWords {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: WidgetWords = {};
  const q = text(r.question, WIDGET_LIMITS.question);
  if (q) out.question = q;
  const choices = choicesOf(r.choices);
  if (choices) out.choices = choices;
  if (r.private === true) out.private = true;
  const doing = text(r.doing, WIDGET_LIMITS.doing);
  if (doing) out.doing = doing;
  const of = int(r.of, 1, 20);
  const stage = int(r.stage, 1, of ?? 20);
  if (stage !== undefined && of !== undefined) { out.stage = stage; out.of = of; }
  const stageName = text(r.stageName, WIDGET_LIMITS.stageName);
  if (stageName) out.stageName = stageName;
  const result = text(r.result, WIDGET_LIMITS.result);
  if (result) out.result = result;
  const problem = text(r.problem, WIDGET_LIMITS.problem);
  if (problem) out.problem = problem;
  if (typeof r.link === "string" && LINK.test(r.link)) out.link = r.link;
  const pr = r.pr as { number?: unknown; url?: unknown } | undefined;
  const prNumber = int(pr?.number, 1, 10_000_000);
  if (prNumber !== undefined && typeof pr?.url === "string" && /^https:\/\/[^\s"<>]{1,300}$/.test(pr.url)) out.pr = { number: prNumber, url: pr.url };
  return out;
}

/** Only the needs part of a bot's words (a question's record keeps nothing else). Undefined when nothing is left. */
export function needsWords(raw: unknown): NeedsWords | undefined {
  const w = widgetWords(raw);
  const out: NeedsWords = {
    ...(w.question ? { question: w.question } : {}), ...(w.choices ? { choices: w.choices } : {}), ...(w.private ? { private: true } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

// ------------------------------------------------------------------ the fill-in lines

/** The server's line for each event when the bot gave none. Slots: {bot} the bot's name, {task} what it was doing. Knobs x0.fill.<kind>. */
export interface FillIns { needs: string; working: string; done: string; failed: string; idle: string }

export const FILL_INS: { en: FillIns; hg: FillIns } = {
  en: { needs: "{bot} needs you", working: "{bot} is working", done: "{bot} finished {task}", failed: "{bot} hit a snag", idle: "Ready" },
  hg: { needs: "{bot} ko aapki zaroorat hai", working: "{bot} kaam kar raha hai", done: "{bot} ne {task} poora kiya", failed: "{bot} atak gaya", idle: "Taiyaar" },
};

/** "Fix cart total rounding. Also…" → "fix cart total rounding": the first clause, its first letter lower-cased (as a doing line reads). */
export function clauseOf(task: string): string {
  const first = oneLineOf(task.split(/[.\n]/)[0] ?? "");
  return first && !/^[A-Z]{2}/.test(first) ? first.charAt(0).toLowerCase() + first.slice(1) : first;
}

/**
 * A template's slots filled, in at most `max` characters. {task} is cut first (at a word) so the line keeps its bot and its verb; with no room
 * for any of the task, it goes, and the line is cut at a word as a whole. Never empty while the template has any words.
 */
export function fillIn(template: string, vars: { bot?: string; task?: string; n?: number | string; name?: string }, max: number): string {
  const bot = oneLineOf(vars.bot ?? "");
  const put = (s: string, task: string) => oneLineOf(s.replace(/\{bot\}/g, bot).replace(/\{n\}/g, String(vars.n ?? "")).replace(/\{name\}/g, oneLineOf(vars.name ?? "")).replace(/\{task\}/g, task));
  if (template.includes("{task}")) {
    const task = oneLineOf(vars.task ?? "");
    const bare = put(template, "");
    const room = max - bare.length - (task ? 1 : 0);
    const cut = task && room >= 4 ? cutAtWord(task, room) : "";
    const line = put(template, cut);
    if (cut && line.length <= max) return line;
    return cutAtWord(bare, max) || bare.slice(0, max);
  }
  const line = put(template, "");
  return cutAtWord(line, max) || line.slice(0, max);
}

/** The line a bot's event shows: its own words when it gave words that fit (cut at a word), else the fill-in. */
export function eventLine(kind: EventKind, own: string | undefined, vars: { bot: string; task?: string }, fill: FillIns): string {
  const max = EVENT_LIMIT[kind];
  const mine = cutAtWord(oneLineOf(own ?? ""), max);
  return mine || fillIn(fill[kind], vars, max);
}
