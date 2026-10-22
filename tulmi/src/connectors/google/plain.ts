/**
 * The little things every Google app here does the same way: read an
 * argument, refuse in a sentence that can be said aloud, and keep a result
 * short. Calendar and Docs grew their own copies first; the apps after them
 * share these.
 */
import { RESULT_MAX, type CallOutcome } from "../client.js";
import type { Args } from "../native.js";
import { ConnectorError } from "../oauth.js";

export const reject = (message: string) => new ConnectorError("rejected", message);

/** A tool name the app does not have: the planner made one up. */
export const noSuchTool = (app: string, tool: string) => reject(`${app} doesn't have an action called ${tool.slice(0, 40)}.`);

/** Trimmed text, cut to `max`, or undefined when there is none. */
export const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : undefined;

/** A whole number in [lo, hi], or `dflt` when it is not a number. */
export function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

/** One line of someone's text, short enough to say: a title, a cell, an answer. */
export function oneLine(s: string | undefined, max = 80, empty = "(no title)"): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim() || empty;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** A result is at most RESULT_MAX before it goes anywhere. */
export const cut = (s: string) => (s.length > RESULT_MAX ? s.slice(0, RESULT_MAX).trimEnd() + "…" : s);

export const ok = (text: string): CallOutcome => ({ ok: true, text: cut(text) });

/**
 * The confirm card's words for a write. Working them out finds the task,
 * sheet or playlist and reads the questions, so it throws a sentence when
 * the write can't be done, and the person hears it before any card
 * (ConnectorHub.previewFor).
 */
export type Describe = (userId: string, tool: string, args: Args) => Promise<string | undefined>;

/** "1 task", "3 tasks". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c". */
export function andList(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0] ?? "";
}

/**
 * Pick the one thing the person meant from a list, by its id or its name:
 * the id exactly, then the name exactly (any case), then the one name that
 * contains what they said. Two that both contain it is a question back,
 * naming them, never a guess.
 */
export function pickByName<T>(items: T[], wanted: string, idOf: (x: T) => string, nameOf: (x: T) => string, noun: string): T | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;
  const byId = items.find((x) => idOf(x) === wanted.trim());
  if (byId) return byId;
  const exact = items.filter((x) => nameOf(x).trim().toLowerCase() === w);
  if (exact.length === 1) return exact[0]!;
  const near = exact.length ? exact : items.filter((x) => nameOf(x).toLowerCase().includes(w));
  if (near.length === 1) return near[0]!;
  if (near.length > 1) {
    const names = near.slice(0, 4).map((x) => `"${oneLine(nameOf(x), 40)}"`);
    throw reject(`I found more than one ${noun} like that: ${andList(names)}. Which one?`);
  }
  return null;
}
