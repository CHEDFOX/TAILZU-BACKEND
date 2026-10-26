/**
 * WHAT A TRACE SAYS, READ THE SAME WAY BY EVERY GRADER.
 *
 * The person's words across the run, everything they were told, what the run
 * left changed in their apps (each thing it touched, as it ended up), and the
 * last receipt. A grader is a pure function of the task and the trace; these
 * are the readings several of them share, so two graders never disagree about
 * what happened.
 */
import type { GraderId, GraderResult, Lang, Mutation, ReceiptLike, Task, Trace } from "../types.js";

export function result(id: GraderId, pass: boolean, detail: string, o: { severity?: "hard" | "soft"; counts?: GraderResult["counts"] } = {}): GraderResult {
  return { id, pass, severity: o.severity ?? "hard", detail, ...(o.counts ? { counts: o.counts } : {}) };
}

/** Everything the person was told: every turn's `say`, together. */
export const replyOf = (trace: Trace): string => trace.turns.map((t) => t.response.say ?? "").filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/** Everything the person said in the run, turn by turn. */
export const wordsOf = (task: Task, trace: Trace): string => (trace.turns.length ? trace.turns.map((t) => t.said) : [task.said]).join("\n");

/** The receipt of the turn the run ended on, when the server sent one. */
export const lastReceipt = (trace: Trace): ReceiptLike | undefined => trace.turns.at(-1)?.response.receipt;

/** One thing in the person's apps the run touched, as it ended up. */
export interface Thing {
  app: Mutation["app"];
  what: string;
  id: string;
  /** It was made in this run. */
  created: boolean;
  updated: boolean;
  deleted: boolean;
  /** Its state after the last change (before the delete, for a deleted one). */
  detail: Record<string, unknown>;
  ops: Mutation[];
}

export function thingsOf(mutations: Mutation[]): Thing[] {
  const by = new Map<string, Thing>();
  for (const m of mutations) {
    const key = `${m.app}|${m.what}|${m.id}`;
    const t = by.get(key) ?? { app: m.app, what: m.what, id: m.id, created: false, updated: false, deleted: false, detail: {}, ops: [] };
    if (m.op === "create") t.created = true;
    if (m.op === "update") t.updated = true;
    if (m.op === "delete") t.deleted = true;
    t.detail = { ...t.detail, ...m.detail };
    t.ops.push(m);
    by.set(key, t);
  }
  return [...by.values()];
}

/** The words of a change a matcher reads: its title, text, notes, cells, questions; never ids or times. */
export function changeText(detail: Record<string, unknown>): string {
  const out: string[] = [];
  for (const k of ["title", "text", "notes", "description", "location", "sheet", "list"]) if (typeof detail[k] === "string") out.push(detail[k] as string);
  for (const k of ["row", "questions", "attendees"]) if (Array.isArray(detail[k])) out.push((detail[k] as unknown[]).map(String).join(" | "));
  return out.join("\n");
}

/** Saying it can't, in each language the bench speaks. Any of them counts: a Hindi run answered in English still declined. */
export const CANT: Record<Lang, RegExp> = {
  en: /\b(?:can['’]?t|cannot|can not|not able|unable|isn['’]?t something|don['’]?t have (?:a way|access)|not (?:something|possible))\b/i,
  hinglish: /\bnahi(?:n)? (?:kar|ho)\b|\bnahi kar sakta\b|\bnahi ho sakta\b|\bnahi paaya\b/i,
  hi: /नहीं कर|नहीं हो|संभव नहीं|नहीं पा/u,
};
export const saysCant = (text: string): boolean => Object.values(CANT).some((re) => re.test(text));

/** Saying it is done, in each language. */
export const DONE_WORDS: RegExp[] = [
  /\b(?:done|added|created|sent|paid|set|booked|scheduled|saved|deleted|moved)\b/i,
  /\b(?:ho gaya|ho gya|kar diya|kar diye|bhej diya|daal diya|add kar diya)\b/i,
  /हो गया|कर दिया|भेज दिया|जोड़ दिया/u,
];
/** A sentence that says it did not happen, whatever words of doing are in it ("I couldn't set that up"). */
const NOT_DONE = /\b(?:can['’]?t|cannot|couldn['’]?t|could not|unable|not able|didn['’]?t|did not|failed|nahi|nahin)\b|नहीं/iu;
export const claimsDone = (text: string): boolean => DONE_WORDS.some((re) => re.test(text)) && !NOT_DONE.test(text);
