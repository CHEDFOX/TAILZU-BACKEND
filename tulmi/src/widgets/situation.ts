/**
 * THE X0 WIDGET'S SITUATION LINE (docs/widget-glance-v2.md section 3): the one line under the greeting when there is no AI digest, picked from
 * a small table, situation × part of the day, in English and Hinglish (knobs x0.sit.<situation>.<part>[.hg], widgets/defaults.ts; "any" is a
 * situation's line for every part it has none for).
 *
 *   situationOf(facts)        which situation it is, and its slots: the first that holds, in this order
 *     justFinished            a bot finished something the person has not seen ({bot}, {task})
 *     moved                   things moved since they last looked ({n}, at least x0.situation.movedMin)
 *     severalWorking          two or more bots are working ({n})
 *     longJob                 one job has been running a long time ({bot}, {task})
 *     firstLook               their first look of the day
 *     quietLong               nothing at all for days ({name})
 *     weekend                 Saturday or Sunday
 *   situationLine(...)        its line, slots filled, 60 characters at most, cut at a word ({task} first)
 *
 * Pure.
 */
import { cutAtWord, fillIn, oneLineOf } from "./botWords.js";

export const SITUATIONS = ["justFinished", "moved", "severalWorking", "longJob", "firstLook", "quietLong", "weekend"] as const;
export type Situation = (typeof SITUATIONS)[number];
export type DayPart = "morning" | "afternoon" | "evening" | "night";

/** The summary's limit (the AI digest's too). */
export const SUMMARY_MAX = 60;

export interface SituationFacts {
  part: DayPart;
  /** Saturday or Sunday in the person's day. */
  weekend: boolean;
  /** No look before today (or ever). */
  firstLook: boolean;
  /** Things that moved since the last look. */
  moved: number;
  /** A bot finished something not yet seen. */
  justFinished?: { bot: string; task: string };
  /** Bots working now. */
  working: number;
  /** The job running longest, and for how many minutes. */
  longJob?: { bot: string; task: string; minutes: number };
  /** Whole days since anything happened (Infinity: never). */
  quietDays: number;
  /** Their first name, or "". */
  name: string;
}

export interface SituationRules { movedMin: number; longJobMin: number; quietDays: number }

export const SITUATION_RULES: SituationRules = { movedMin: 2, longJobMin: 30, quietDays: 3 };

export interface Chosen { situation: Situation; vars: { name: string; bot?: string; task?: string; n?: number } }

/** Which situation it is, or null when none holds (the widget then shows no summary). */
export function situationOf(f: SituationFacts, rules: SituationRules = SITUATION_RULES): Chosen | null {
  const name = f.name;
  if (f.justFinished) return { situation: "justFinished", vars: { name, bot: f.justFinished.bot, task: f.justFinished.task } };
  if (f.moved >= Math.max(1, rules.movedMin)) return { situation: "moved", vars: { name, n: f.moved } };
  if (f.working >= 2) return { situation: "severalWorking", vars: { name, n: f.working } };
  if (f.longJob && f.longJob.minutes >= rules.longJobMin) return { situation: "longJob", vars: { name, bot: f.longJob.bot, task: f.longJob.task } };
  if (f.firstLook) return { situation: "firstLook", vars: { name } };
  if (f.quietDays >= rules.quietDays) return { situation: "quietLong", vars: { name } };
  if (f.weekend) return { situation: "weekend", vars: { name } };
  return null;
}

/** A situation's template for a part of the day: its own, else the situation's "any", else "". `lookup` reads the knobs. */
export function templateFor(lookup: (key: string) => string | undefined, s: Situation, part: DayPart, hg: boolean): string {
  const at = (key: string) => (hg ? lookup(`${key}.hg`) : undefined) ?? lookup(key);
  return at(`x0.sit.${s}.${part}`) ?? at(`x0.sit.${s}.any`) ?? "";
}

/** The line: slots filled ({task} cut first), a name-less "{name}" dropped with its comma, at most SUMMARY_MAX characters. */
export function situationLine(template: string, vars: Chosen["vars"], max = SUMMARY_MAX): string {
  const t = vars.name ? template : template.replace(/,?\s*\{name\}/g, "");
  if (!oneLineOf(t)) return "";
  return cutAtWord(fillIn(t, vars, max), max);
}
