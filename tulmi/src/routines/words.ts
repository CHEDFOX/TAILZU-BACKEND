/**
 * A ROUTINE IN WORDS: what a person says ("every Friday at 5, sum up my week") read into a schedule and a task, the schedule said back
 * ("Every Friday at 5 pm"), and when it next runs. Pure, free, the same answer for the same words: no model is asked.
 *
 *   readRoutine(words, now, tz)    { schedule, task, timeSaid } or null when the words do not ask for something done again and again
 *   scheduleWords(schedule)        "Every day at 8 am", "Weekdays at 9:30 am", "Every Mon and Thu at 7 pm", "On the 1st of every month at 9 am"
 *   nextRun(schedule, tz, after)   the first run after `after` (ms), in the person's own time (`tz`, minutes east of UTC, as the apps send it)
 *
 * What is NOT a routine here, on purpose:
 *   "remind me every day at 8 to ..."     a reminder: Plan Ease's calendar keeps it (calendar/words.ts readLine, repeating events)
 *   "how do I back up every day?"         a question about doing something regularly, not a request to do it
 *   "every time I open Slack ..."         an event, not a time. Routines that start on an event are the next step (docs/routines.md)
 */
import { DAY, MIN, dayOf, shiftDay, startOfDay, timeOf, weekdayOf } from "../calendar/words.js";

export type Every = "day" | "weekdays" | "week" | "month";

export interface Schedule {
  every: Every;
  /** Minutes after midnight, in the person's own time. */
  minute: number;
  /** For "week": the weekdays it runs on, 0 (Sunday) to 6, sorted, at least one. */
  days?: number[];
  /** For "month": the day of the month, 1 to 28 (every month has one). */
  monthDay?: number;
}

export interface ReadRoutine {
  schedule: Schedule;
  /** What to do each time, as the person said it, the schedule's words taken out: "Sum up my week". */
  task: string;
  /** Whether they said a time. When not, the routine runs at DEFAULT_MINUTE and the card says so. */
  timeSaid: boolean;
}

/** Nine in the morning, when nobody says a time. */
export const DEFAULT_MINUTE = 9 * 60;
export const TASK_MAX = 300;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_WORD = String.raw`(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?s?`;
const dayNumber = (w: string): number | null => {
  const k = w.toLowerCase().slice(0, 3);
  const i = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(k);
  return i >= 0 ? i : null;
};

/** Parts of the day: when they run, and the words that say them. */
const PARTS: Record<string, number> = { morning: 9 * 60, afternoon: 14 * 60, evening: 18 * 60, night: 21 * 60, noon: 12 * 60, midnight: 0 };

const TIME = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?`;
const CLOCK = new RegExp(String.raw`\b(?:at|@|by|around|from)\s+(${TIME})(?=$|[\s,.;!])|\b(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))(?=$|[\s,.;!])`, "i");

/** A question, not a request: "how do I ...", "what should I do every day?" */
const QUESTION = /^(?:how|what|why|when|where|who|which|is|are|was|were|do|does|did|should|would|could|can i|can we|will i|am i)\b|\?\s*$/i;
/** A reminder: the calendar's (Plan Ease) to keep, not a bot's job to run. */
const REMINDER = /\bremind\s+(?:me|us|him|her|them)\b|\breminder\b|\balarm\b/i;
/** Not a schedule at all: "every time", "everyone", "every single one of these". */
const NOT_TIME = /\bevery\s*(?:time|one|body|thing|where|single\s+(?:one|thing|time)|other\s+(?!day|week|month))\b/i;

interface Found { every: Every; days?: number[]; monthDay?: number; part?: number }

/**
 * Hinglish and Hindi schedule words, said in English for the rules below: "har friday shaam 6 baje" is "every friday evening at 6",
 * "roz subah 8 baje" is "every day morning at 8", "हर सोमवार" is "every monday". Only the words that say when: the task stays as said.
 */
const SAID_AS: Array<[RegExp, string]> = [
  [/(?:^|\s)(?:हर|प्रत्येक)\s+(?:महीने|माह)(?=\s|$)|\bhar\s+(?:mahine|mahina|month)\b/giu, " every month"],
  [/(?:^|\s)(?:हर|प्रत्येक)\s+(?:हफ्ते|हफ़्ते|सप्ताह)(?=\s|$)|\bhar\s+(?:hafte|hafta|week)\b/giu, " every week"],
  [/(?:^|\s)(?:रोज़|रोज|रोजाना|रोज़ाना|प्रतिदिन|हर\s+दिन)(?=\s|$)|\b(?:roz|rozana|roj|rojana|har\s+din)\b/giu, " every day"],
  [/(?:^|\s)(?:हर|प्रत्येक)(?=\s)|\bhar\b(?=\s)/giu, " every"],
  [/(?:^|\s)(?:सुबह)(?=\s|$)|\bsubah\b/giu, " morning"],
  [/(?:^|\s)(?:दोपहर)(?=\s|$)|\bdopahar\b/giu, " afternoon"],
  [/(?:^|\s)(?:शाम)(?=\s|$)|\b(?:shaam|sham)\b/giu, " evening"],
  [/(?:^|\s)(?:रात)(?=\s|$)|\braat\b/giu, " night"],
  [/(\d{1,2}(?::\d{2})?)\s*(?:बजे|baje)(?=\s|$|[,.!?])/giu, "at $1"],
  [/(\d{1,2})\s*(?:tarikh|tareekh|tarik|तारीख़|तारीख)(?:\s*(?:ko|को))?(?=\s|$)/giu, "on the $1"],
  [/\b(?:somvar|somwar)\b|सोमवार/giu, "monday"], [/\b(?:mangalvar|mangalwar)\b|मंगलवार/giu, "tuesday"],
  [/\b(?:budhvar|budhwar)\b|बुधवार/giu, "wednesday"], [/\b(?:guruvar|guruwar|veervar|brihaspativar)\b|गुरुवार|बृहस्पतिवार/giu, "thursday"],
  [/\b(?:shukravar|shukrawar)\b|शुक्रवार/giu, "friday"], [/\b(?:shanivar|shaniwar)\b|शनिवार/giu, "saturday"],
  [/\b(?:ravivar|raviwar|itvaar|itwar)\b|रविवार/giu, "sunday"],
  // "friday ko", "सोमवार को": the case word after a day goes.
  [/\b((?:mon|tues|wednes|thurs|fri|satur|sun)day)\s+(?:ko|को)(?=\s|$)/giu, "$1"],
];
export function saidInEnglish(s: string): string {
  let t = s;
  for (const [re, to] of SAID_AS) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

/** The words that say how often, taken out of `s` (which is changed in place through the returned rest). */
function findEvery(s: string, now: number, tz: number): { found: Found; rest: string } | null {
  const today = dayOf(now, tz);
  const tries: Array<[RegExp, (m: RegExpExecArray) => Found | null]> = [
    // weekdays: "every weekday", "on weekdays", "weekdays", "monday to friday", "mon-fri", "every workday"
    [/\b(?:(?:every|each|on)\s+)?(?:week\s?days?|work\s?days?|working days|business days)\b|\b(?:every\s+day\s+)?(?:from\s+)?mon(?:day)?\s*(?:-|–|to|through|thru)\s*fri(?:day)?\b/i, () => ({ every: "weekdays" })],
    // the weekend: "every weekend", "on weekends"
    [/\b(?:(?:every|each|on)\s+)?weekends?\b/i, () => ({ every: "week", days: [0, 6] })],
    // named days: "every Friday", "on Mondays and Thursdays", "every Mon, Wed and Fri", "each Sunday", "every week on Friday", "weekly on fri"
    [new RegExp(String.raw`\b(?:(?:every|each)\s+(?:week\s+)?(?:on\s+)?|(?:weekly|every\s+week)\s+on\s+|on\s+(?=${DAY_WORD}s\b)|on\s+(?=(?:${DAY_WORD})(?:\s*(?:,|and|&)\s*(?:${DAY_WORD}))+\b))((?:${DAY_WORD})(?:\s*(?:,|and|&|,\s*and)\s*(?:${DAY_WORD}))*)\b`, "i"), (m) => {
      const days = [...new Set((m[1] ?? "").split(/\s*(?:,|and|&)\s*/i).map((w) => dayNumber(w.trim())).filter((d): d is number => d !== null))].sort((a, b) => a - b);
      return days.length ? { every: "week", days } : null;
    }],
    // "Mondays" alone at the start: "Mondays at 9, ..."
    [new RegExp(String.raw`^\s*((?:${DAY_WORD}))s\b`, "i"), (m) => {
      const d = dayNumber(m[1] ?? "");
      return d === null ? null : { every: "week", days: [d] };
    }],
    // the month: "every month on the 1st", "on the 15th of every month", "monthly", "every month"
    [/\b(?:(?:every|each)\s+)?(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+(?:of\s+)?(?:every|each|the)\s+month\b|\b(?:every|each)\s+month\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b|\bmonthly\s+on\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b|\b(?:every|each)\s+month\b|\bmonthly\b/i, (m) => {
      const n = Number(m[1] ?? m[2] ?? m[3] ?? new Date(`${today}T00:00:00Z`).getUTCDate());
      return n >= 1 && n <= 31 ? { every: "month", monthDay: Math.min(28, n) } : null;
    }],
    // the week with no day: "every week", "weekly" (the day it was set up on)
    [/\b(?:every|each)\s+week\b|\bweekly\b/i, () => ({ every: "week", days: [weekdayOf(today)] })],
    // a part of every day: "every morning", "each evening", "every night", "mornings"
    [/\b(?:every|each)\s+(morning|afternoon|evening|night)\b|^\s*(morning|evening)s\b/i, (m) => ({ every: "day", part: PARTS[(m[1] ?? m[2] ?? "").toLowerCase()]! })],
    // every day: "every day", "everyday", "daily", "each day", "every single day"
    [/\b(?:every\s*(?:single\s+)?day|each\s+day|daily|day\s+by\s+day)\b/i, () => ({ every: "day" })],
  ];
  for (const [re, fn] of tries) {
    const m = re.exec(s);
    if (!m) continue;
    const found = fn(m);
    if (!found) continue;
    return { found, rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` };
  }
  return null;
}

/** "at 8", "8am", "at 7:30 pm", or a part of the day ("in the evening"), taken out of the words. */
function findTime(s: string, partOfDay?: number): { minute: number | null; rest: string } {
  const m = CLOCK.exec(s);
  if (m) {
    const said = (m[1] ?? m[2] ?? "").trim();
    let minute = timeOf(said);
    // "every evening at 7": an hour said with no am or pm is read in that part of the day.
    if (minute !== null && partOfDay !== undefined && !/am|pm|a\.m|p\.m/i.test(said) && partOfDay >= 12 * 60 && minute < 12 * 60) minute += 12 * 60;
    if (minute !== null) return { minute, rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` };
  }
  const p = /\b(?:in the |at )?(morning|afternoon|evening|night|noon|midnight)\b/i.exec(s);
  if (p) return { minute: PARTS[p[1]!.toLowerCase()]!, rest: `${s.slice(0, p.index)} ${s.slice(p.index + p[0].length)}` };
  return { minute: null, rest: s };
}

/** What is left once the schedule's words are out, made a clean instruction: "Sum up my week". */
function cleanTask(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  // Joining words the schedule left at either end, and politeness that is not part of the job.
  for (let i = 0; i < 4; i++) {
    t = t
      .replace(/^(?:[,.;:\-–—]\s*|(?:and|then|please|pls|kindly|can you|could you|would you|i want you to|i'd like you to|i need you to|go ahead and|just)\b\s*)/i, "")
      .replace(/(?:\s*[,;:\-–—]|\s+(?:and|then|on|at|in|please|pls))\s*$/i, "")
      .trim();
  }
  t = t.replace(/\s+([,.;!])/g, "$1").replace(/[.!]+$/, "").trim();
  return t ? (t[0]!.toUpperCase() + t.slice(1)).slice(0, TASK_MAX) : "";
}

/**
 * What the words ask to be done again and again, or null. `now` and `tz` decide which day "every week" or "every month" falls on
 * when no day is named.
 */
export function readRoutine(words: string, now: number, tz: number): ReadRoutine | null {
  const said = saidInEnglish(words.replace(/\s+/g, " ").trim());
  if (said.length < 8 || said.length > 600) return null;
  if (QUESTION.test(said) || REMINDER.test(said) || NOT_TIME.test(said)) return null;
  const e = findEvery(said, now, tz);
  if (!e) return null;
  // "every friday evening at 6": the part of the day said beside a day of the week reads the hour (6 pm), and goes from the task.
  const partSaid = e.found.part === undefined ? /\b(?:in the )?(morning|afternoon|evening|night)\b/i.exec(e.rest) : null;
  const part = e.found.part ?? (partSaid ? PARTS[partSaid[1]!.toLowerCase()] : undefined);
  const t0 = findTime(e.rest, part);
  const t = partSaid && t0.minute !== null ? { ...t0, rest: t0.rest.replace(/\b(?:in the )?(?:morning|afternoon|evening|night)\b/i, " ") } : t0;
  const task = cleanTask(t.rest);
  // A schedule with nothing to do ("every day at 8"), or only a word or two ("daily stuff"), is not a routine.
  if (task.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < 2) return null;
  const minute = t.minute ?? part ?? DEFAULT_MINUTE;
  const schedule: Schedule = { every: e.found.every, minute, ...(e.found.days ? { days: e.found.days } : {}), ...(e.found.monthDay ? { monthDay: e.found.monthDay } : {}) };
  return { schedule, task, timeSaid: t.minute !== null || part !== undefined };
}

/** A schedule that can be kept: the right fields for its kind, in range. Null when it cannot. */
export function cleanSchedule(v: unknown): Schedule | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const every = o.every;
  const minute = Number(o.minute);
  if (every !== "day" && every !== "weekdays" && every !== "week" && every !== "month") return null;
  if (!Number.isInteger(minute) || minute < 0 || minute >= 24 * 60) return null;
  if (every === "week") {
    const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    return days.length ? { every, minute, days } : null;
  }
  if (every === "month") {
    const d = Number(o.monthDay);
    return Number.isInteger(d) && d >= 1 && d <= 28 ? { every, minute, monthDay: d } : null;
  }
  return { every, minute };
}

/** "8 am", "7:30 pm". */
export function clockWords(minute: number): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

const ordinal = (n: number): string => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const listWords = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The schedule said back, as the card and the list show it: "Every day at 8 am". */
export function scheduleWords(s: Schedule): string {
  const at = `at ${clockWords(s.minute)}`;
  if (s.every === "day") return `Every day ${at}`;
  if (s.every === "weekdays") return `Weekdays ${at}`;
  if (s.every === "month") return `On the ${ordinal(s.monthDay ?? 1)} of every month ${at}`;
  const days = s.days ?? [];
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return `Weekends ${at}`;
  if (days.length === 1) return `Every ${WEEKDAY_LONG[days[0]!]} ${at}`;
  return `Every ${listWords(days.map((d) => WEEKDAY_SHORT[d]!))} ${at}`;
}

/** Whether the schedule runs on the day `key` ("YYYY-MM-DD"). */
function runsOn(s: Schedule, key: string): boolean {
  const wd = weekdayOf(key);
  if (s.every === "day") return true;
  if (s.every === "weekdays") return wd >= 1 && wd <= 5;
  if (s.every === "week") return (s.days ?? []).includes(wd);
  return Number(key.slice(8, 10)) === (s.monthDay ?? 1);
}

/** The first run strictly after `after` (ms). Every schedule runs at least once in 62 days, so this always finds one. */
export function nextRun(s: Schedule, tz: number, after: number): number {
  let key = dayOf(after, tz);
  for (let i = 0; i < 62; i++, key = shiftDay(key, 1)) {
    if (!runsOn(s, key)) continue;
    const at = startOfDay(key, tz) + s.minute * MIN;
    if (at > after) return at;
  }
  return after + DAY;
}

/** When it runs next, as a person says it: "Today at 8 pm", "Tomorrow at 8 am", "Fri 7 Nov at 5 pm". */
export function nextWords(at: number, tz: number, now: number): string {
  const today = dayOf(now, tz), day = dayOf(at, tz);
  const minute = Math.floor((at - startOfDay(day, tz)) / MIN);
  const d = new Date(`${day}T00:00:00Z`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = day === today ? "Today" : day === shiftDay(today, 1) ? "Tomorrow" : `${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  return `${name} at ${clockWords(minute)}`;
}
