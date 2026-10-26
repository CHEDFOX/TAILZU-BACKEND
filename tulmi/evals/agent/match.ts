/**
 * A TASK'S MATCHERS, READ ONE WAY EVERYWHERE.
 *
 * A plain string is a case-insensitive substring, a RegExp is tested as it is
 * written, and anyOf / allOf combine them (types.ts Match). Before a string
 * is compared, both sides have their curly quotes made straight and their
 * runs of spaces made one, because the server writes "couldn’t" and a task
 * writer types "couldn't", and that difference is never what a task is about.
 */
import type { Match } from "./types.js";

/** Straight quotes and single spaces, so typing is not graded. */
export const plain = (s: string): string => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();

export function matches(m: Match, text: string): boolean {
  if (typeof m === "string") return plain(text).toLowerCase().includes(plain(m).toLowerCase());
  if (m instanceof RegExp) return new RegExp(m.source, m.flags.replace("g", "")).test(text);
  if ("anyOf" in m) return m.anyOf.some((x) => matches(x, text));
  return m.allOf.every((x) => matches(x, text));
}

/** A matcher as a scoreboard line shows it: "dentist", /i'll remind/i, any of ("5 pm", "17:00"). */
export function shown(m: Match): string {
  if (typeof m === "string") return JSON.stringify(m);
  if (m instanceof RegExp) return String(m);
  if ("anyOf" in m) return `any of (${m.anyOf.map(shown).join(", ")})`;
  return `all of (${m.allOf.map(shown).join(", ")})`;
}
