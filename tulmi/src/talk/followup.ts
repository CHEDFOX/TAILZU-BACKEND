/**
 * A HANDOFF THAT POINTS BACK: "send that to Riya", "isse Riya ko bhej do", "इसे रिया को भेजो".
 *
 *   followUp(goal, words, last)    what Ask is handed: the goal, with the last answer it points to when the words point back and the
 *                                  brain did not make them whole
 *
 * The brain is asked to make a follow-up whole in its goal (docs/ask-decide.md), and on the cheap tier it often hands the words back as
 * they were, or as something vaguer ("send the GST result to Riya"). Ask then has "that" and nothing it refers to. This is the rule
 * that holds whatever the brain did: words with a word that points back, an answer in the turn before, and a goal that carries none
 * of that answer's figures (a number of three digits or more): the answer (and what it found) goes with the goal. Names and short
 * numbers say nothing ("the Pixel 9 price" carries no price). No call is made for it.
 */
import { oneLine } from "../code/work/model.js";
import type { TalkTurn } from "./session.js";
import { foundLine } from "./session.js";

/** Words that point back to something already said, in English, Hinglish and Hindi. */
const BACK = /\b(?:that|this|it|those|these|them|same|ye|yeh|yah|woh|wo|vo|isse|isko|use|usko|unko|inko|wahi|yahi)\b|(?:^|\s)(?:यह|ये|वह|वो|इसे|उसे|इसको|उसको|वही|यही)(?=\s|$|[।,.!?])/iu;

/** How much of the last answer goes with the goal. */
export const FOLLOW_ANSWER_CHARS = 400;

export function followUp(goal: string, words: string, last: Pick<TalkTurn, "answer" | "found"> | undefined): string {
  if (!last || !last.answer.trim()) return goal;
  if (!BACK.test(words)) return goal;
  const figures = (last.found?.numbers ?? []).filter((n) => n.replace(/\D/g, "").length >= 3);
  if (figures.some((n) => goal.includes(n))) return goal;
  const found = foundLine(last.found);
  return `${goal}\n(${oneLine(last.answer, FOLLOW_ANSWER_CHARS)}${found ? ` Found: ${found}` : ""})`;
}
