/**
 * LANGUAGE: answered in the person's language, in its script.
 *
 * Hindi is answered in Devanagari: at least 60% of its letters. English and
 * Hinglish are answered in Latin letters with no Devanagari, and Hinglish is
 * not plain English: it has at least one of the everyday Hindi words people
 * type in Latin letters (hai, karo, nahi, mein, ko...). A reply under four
 * words is held to its script only: "Done." is fine in Hinglish.
 *
 * Today the server's own lines (a hand-off's, a card's) have no Hindi table
 * and come back in English, so Hindi tasks fail here until they have one: the
 * grader is meant to show it. Those tasks carry `xfail` "hindi-words", and
 * their reference is the one USE line: a Hindi "it's ready" said ahead of the
 * USE would pass here by announcing what has not happened yet, which the
 * honest grader fails.
 */
import type { GraderResult, Task, Trace } from "../types.js";
import { replyOf, result } from "./facts.js";

const HINGLISH = /\b(?:hai|hain|karo|kar|nahi|nahin|mein|ko|ka|ki|ke|diya|gaya|hoon|liye|dabao)\b/i;

export function scriptShare(text: string): { letters: number; devanagari: number } {
  const letters = text.match(/[\p{L}\p{M}]/gu) ?? [];
  return { letters: letters.length, devanagari: letters.filter((c) => /\p{Script=Devanagari}/u.test(c)).length };
}

export function gradeLanguage(task: Task, trace: Trace): GraderResult {
  const said = replyOf(trace);
  const { letters, devanagari } = scriptShare(said);
  if (!letters) return result("language", true, "no words to judge");
  const words = said.split(/\s+/).filter(Boolean).length;
  if (task.lang === "hi") {
    const share = devanagari / letters;
    return share >= 0.6
      ? result("language", true, `Devanagari, ${Math.round(share * 100)}% of letters`)
      : result("language", false, `only ${Math.round(share * 100)}% Devanagari: ${JSON.stringify(said.slice(0, 120))}`);
  }
  if (devanagari) return result("language", false, `Devanagari in a ${task.lang} reply: ${JSON.stringify(said.slice(0, 120))}`);
  if (task.lang === "hinglish" && words >= 4 && !HINGLISH.test(said)) {
    return result("language", false, `plain English to a Hinglish speaker: ${JSON.stringify(said.slice(0, 120))}`);
  }
  return result("language", true, `${task.lang}, in Latin letters`);
}
