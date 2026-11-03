/**
 * WHERE A LINE A BOT KEPT GOES IN THE PERSON'S SPACE, AND WHICH LINES BOTS MAY USE. Rules only: no model, nothing paid, the same answer every time.
 *
 *   fileFact(text)            the section by its words: money, people, work, your day, places, likes, else About you (first rule that fits wins)
 *   keyOf(text)               a line's key: its words, so the copy each bot keeps is one line in the space
 *   sectionOf(text, marks)    where the person put it, else where the rules file it
 *   forBots(facts, marks)     what bots are shown: nothing from a section the person switched off, pinned lines first
 *
 * Money comes first: it is never shared across bots (shared.ts), so it must never be filed as something else.
 */
import { createHash } from "node:crypto";
import type { FactSection, SpaceMarks } from "./spaceMarks.js";

/** Money words. shared.ts keeps these out of what every bot reads. */
export const MONEY = /(?:[₹$€£]|\brs\.?\s*\d|\b(?:inr|rupees?|lakhs?|crores?|salary|income|earn(?:s|ed|ing)?|ctc|loans?|debts?|emi|banks?|credit\s+card|debit\s+card|upi|net\s+worth|savings?|invest\w*|stocks?|mutual\s+funds?|crypto|bitcoin|tax(?:es)?|budget)\b)/i;

const RULES: ReadonlyArray<[FactSection, RegExp]> = [
  ["money", MONEY],
  // Another person in their life: a line about them belongs with them, whatever else it says.
  ["people", /\b(?:wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?|mom|mum|mother|mummy|maa|dad|father|papa|parents?|sons?|daughters?|kids?|children|child|baby|brothers?|sisters?|siblings?|bhai|bhaiya|didi|cousins?|uncle|aunt|aunty|chacha|chachi|nani|nana|dadi|dada|grand(?:ma|pa|mother|father|parents)|in-laws?|friends?|roommate|flatmate|boss|colleagues?|co-?workers?|teammates?|neighbou?rs?|family)\b|\b[a-z]+'s (?:name|birthday)\b/i],
  ["work", /\b(?:works?\s+(?:at|as|for|in|on)|working\s+(?:at|as|for|in|on)|job|office|company|startup|clients?|career|profession|business|freelanc\w*|engineer|developer|designer|founder|employer|student|college|university|school|exams?|studies|studying|internship|intern|coding|programm\w*|projects?)\b/i],
  ["day", /\b(?:wakes?|waking|sleeps?|sleeping|bed\s?time|mornings?|evenings?|nights?|daily|every\s+(?:day|morning|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|weekdays?|weekends?|routine|gym|workouts?|exercis\w*|yoga|runs|running|walks?|commut\w*|schedule)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i],
  ["places", /\b(?:lives?|living|moved\s+to|based\s+in|from|hometown|city|town|village|country|neighbou?rhood|address|home|flat|apartment|travel\w*|trips?|visit\w*|airport)\b/i],
  ["likes", /\b(?:likes?|loves?|prefers?|preference|favou?rites?|enjoys?|hates?|dislikes?|can't\s+stand|fan\s+of|vegetarian|vegan|eggetarian|coffee|tea|chai|music|movies?|films?|books?|reading|games?|cricket|football|food|cuisine|spicy)\b/i],
];

export function fileFact(text: string): FactSection {
  for (const [section, re] of RULES) if (re.test(text)) return section;
  return "about";
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
export const keyOf = (text: string): string => createHash("sha256").update(norm(text)).digest("hex").slice(0, 12);

export function sectionOf(text: string, marks: SpaceMarks): FactSection {
  return marks.moved[keyOf(text)] ?? fileFact(text);
}

/** The lines bots may use, pinned first, each section the person switched off left out. */
export function forBots<T extends { text: string }>(facts: readonly T[], marks: SpaceMarks): T[] {
  if (!marks.off.length && !marks.pins.length) return [...facts];
  const off = new Set(marks.off), pins = new Set(marks.pins);
  const kept = facts.filter((f) => !off.has(sectionOf(f.text, marks)));
  return [...kept.filter((f) => pins.has(keyOf(f.text))), ...kept.filter((f) => !pins.has(keyOf(f.text)))];
}
