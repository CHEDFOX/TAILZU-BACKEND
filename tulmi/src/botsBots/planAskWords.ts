/**
 * FAMILY ASKS: WHAT THE WORDS SAY (docs/plan-ease-people.md; design A7, B8). Rules only, free: a question for the family typed in Plan
 * Ease's one box, taken apart into what, which days, what time, where, whether it repeats and whether people take turns.
 *
 *   readAsk(words, now, tz)  "Who picks Kabir up Wednesday and Thursday at 1 pm?" -> pick Kabir up, Wed and Thu, 1 pm (two asks).
 *                            "Arjun and Rohan take turns watering the plants every Sunday" -> plants, every Sunday, Arjun then Rohan.
 *                            "Plants every Sunday, taking turns" -> the same, "Who's in?". Null for anything else
 *   askQuestion / takenWords / noneWords / turnWords   what the family, the asker and whose turn it is are told, lock-safe
 *   takeByOf(...)            if nobody took it by then, the asker hears: 6 pm the day before; asked after that, 2 hours on but at
 *                            least an hour before the thing
 *
 * The words that go outside the app are made from these parts, never the asker's own sentence, and go through planSafe.ts: no amount,
 * a health word makes it plain ("Who can help Saturday?").
 */
import { DAY, MIN, dayFrom, dayOf, readLine, shiftDay, startOfDay, weekdayOf } from "../calendar/words.js";
import { cutAt, lockSafe, looksHealth, noAmounts } from "./planSafe.js";

export interface AskRepeat { every: "week" | "day"; days: number[] }

export interface AskRead {
  /** The doing, in the base form: "pick Kabir up", "water the plants". */
  base: string;
  /** What lands on the taker's day: "Kabir pickup", "Plants". */
  title: string;
  /** The days asked, one ask each (two days are two asks). */
  days: string[];
  /** Minutes after midnight, when a time was said. */
  time: number | null;
  /** Where, when said ("at Little Steps"). */
  place: string;
  repeat: AskRepeat | null;
  /** People taking turns: the names in the order said ("me" is the asker); empty: "Who's in?". Null: not turns. */
  turns: { names: string[] } | null;
  /** A space named in the words ("ask Ghar: who..."). */
  space: string;
}

const HOUR = 60 * MIN;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD = String.raw`(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?`;
const ONE_DAY = String.raw`(?:day after tomorrow|tomorrow|tmrw|today|tonight|kal|parso|(?:this |next )?${WD}|\d{1,2}(?:st|nd|rd|th)?(?: of)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)`;

/** "Who picks", "can someone", "who's doing", "anyone free to". */
const WHO = /^(?:ask\s+([\w'-]+(?:\s[\w'-]+)?)\s*[:,]\s*|ask\s+([\w'-]+)\s+(?=who|can|could|will|is|anyone))?(?:who(?:'s|'ll| is| will| can| could| wants to| is going to| is free to| has time to)?|(?:can|could|will) (?:someone|somebody|anyone|anybody)(?: please)?|(?:is )?(?:anyone|anybody|someone) free to)\s+(.+?)\s*\??$/i;
/** "Arjun and Rohan take turns watering the plants every Sunday", "Me and Arjun will take turns to do the dishes every day". */
const TURNS_NAMED = /^(.+?)\s+(?:will |can |should )?(?:take|takes) turns?\s+(?:to\s+|at\s+|with\s+|for\s+)?(.+)$/i;
/** "Let's take turns watering the plants every Sunday", "take turns: dishes every day". */
const TURNS_OPEN = /^(?:let'?s |we(?:'ll| will| can| should)? |can we )?take turns?\s*[:,-]?\s*(?:to\s+|at\s+|with\s+|for\s+)?(.+)$/i;
/** "Plants every Sunday, taking turns", "dishes every day - turns". */
const TURNS_TAIL = /^(.+?)[,;\s-]+(?:taking|take|in) turns\.?$/i;

/** Words that are no task to ask for: "Who's free Saturday?", "Who's coming tomorrow?". */
const NOT_A_TASK = /^(?:free|there|here|coming|home|in|up|available|around|awake|going|on|it|this|that|ready|back|joining|it\??)$/i;

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lower1 = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const tidy = (s: string): string => s.replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "").trim();

// ------------------------------------------------------------------ verbs

/** Verbs whose base form ends in "e" ("taking" is take). */
const E_VERBS = new Set(["take", "make", "drive", "give", "come", "use", "have", "move", "share", "serve", "bake", "write", "prepare", "arrive", "leave", "wake", "ride", "hide", "change", "charge", "manage", "arrange", "organise", "organize", "iron", "dance", "practise", "practice", "skate", "shave", "save", "dine", "pickle", "close", "dispose", "rinse", "store", "squeeze", "handle"]);
const DOUBLED = new Set(["drop", "shop", "get", "put", "run", "sit", "stop", "plan", "swim", "chat", "mop", "pat", "jog", "tip", "hug", "dig", "set", "cut", "let", "hit"]);

/** "doing" do, "taking" take, "dropping" drop, "watering" water; "picks" pick, "does" do, "carries" carry. */
export function baseVerb(w: string): string {
  const x = w.toLowerCase();
  if (/ing$/.test(x) && x.length > 4) {
    const stem = x.slice(0, -3);
    if (/(.)\1$/.test(stem) && !/(?:ll|ss|zz|ff)$/.test(stem) && DOUBLED.has(stem.slice(0, -1))) return stem.slice(0, -1);
    if (E_VERBS.has(`${stem}e`)) return `${stem}e`;
    return stem;
  }
  if (/ies$/.test(x) && x.length > 4) return `${x.slice(0, -3)}y`;
  if (/(?:ches|shes|sses|xes|oes)$/.test(x)) return x.slice(0, -2);
  if (/[^s]s$/.test(x) && x.length > 2 && !/^(?:is|has|was|does|bus|gas)$/.test(x)) return x.slice(0, -1);
  if (x === "does") return "do";
  if (x === "has") return "have";
  return x;
}

/** "pick" picks, "do" does, "carry" carries, "fetch" fetches. */
export function thirdPerson(base: string): string {
  if (base === "have") return "has";
  if (base === "do" || base === "go") return `${base}es`;
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  if (/(?:ch|sh|ss|x|z|o)$/.test(base)) return `${base}es`;
  return `${base}s`;
}

/** "pick" picking, "take" taking, "drop" dropping. */
export function ingOf(base: string): string {
  if (/ee$/.test(base) || base === "be") return `${base}ing`;
  if (/ie$/.test(base)) return `${base.slice(0, -2)}ying`;
  if (/e$/.test(base) && base.length > 2) return `${base.slice(0, -1)}ing`;
  if (DOUBLED.has(base)) return `${base}${base.slice(-1)}ing`;
  return `${base}ing`;
}

/** A phrase's first word in another form ("pick Kabir up" with thirdPerson is "picks Kabir up"). */
const withVerb = (base: string, fn: (v: string) => string): string => {
  const [v, ...rest] = base.split(" ");
  return [fn(v!), ...rest].join(" ");
};

// ------------------------------------------------------------------ what lands on the day

const strip = (s: string): string => s.replace(/^(?:the|a|an|my|our|his|her|their)\s+/i, "");

/** "Kabir pickup", "Riya drop", "Take Amma to the clinic", "Groceries", "Plants" (turns: the thing, not the doing). */
export function titleOf(base: string, turns: boolean): string {
  let m = /^pick\s+(.+?)\s+up\b(.*)$/i.exec(base) ?? /^pick\s+up\s+(.+?)()$/i.exec(base);
  if (m) return cap(`${strip(m[1]!)} pickup`);
  m = /^drop\s+(?:off\s+)?(.+?)(?:\s+off)?(?:\s+(?:at|to)\s+.+)?$/i.exec(base);
  if (m) return cap(`${strip(m[1]!)} drop`);
  const [verb, ...rest] = base.split(" ");
  const object = rest.join(" ");
  if (turns && object) return cap(strip(object));
  if (/^(?:do|handle|manage|sort)$/i.test(verb!) && object) return cap(strip(object));
  return cap(base);
}

// ------------------------------------------------------------------ reading

/** The days said ("Wednesday and Thursday", "Wed, Thu", "tomorrow"), and the words without them. */
function daysOf(s: string, today: string): { days: string[]; rest: string } {
  const days: string[] = [];
  const re = new RegExp(String.raw`(?:^|\s)(?:on\s+|this\s+coming\s+)?(${ONE_DAY})(?=[\s,.!?]|$)`, "gi");
  const rest = s.replace(re, (all, d: string) => {
    const key = dayFrom(d, today);
    if (!key) return all;
    if (!days.includes(key)) days.push(key);
    return " ";
  });
  return { days: days.sort(), rest: rest.replace(/\s+(?:and|&|,)\s*(?=\s|$)/gi, " ").replace(/\s+(?:and|&|,)$/i, "") };
}

/** "every Sunday", "every day", "weekly on Wed". */
function repeatOf(s: string, today: string): { repeat: AskRepeat | null; day: string | null; rest: string } {
  let repeat: AskRepeat | null = null, day: string | null = null;
  const rest = s
    .replace(new RegExp(String.raw`\s?(?:every|each|har)\s+(${WD})\b`, "i"), (_a, d: string) => {
      day = dayFrom(d, today);
      if (day) repeat = { every: "week", days: [weekdayOf(day)] };
      return " ";
    })
    .replace(/\s?(?:every ?day|daily|each day|roz)\b/i, () => { repeat = { every: "day", days: [] }; return " "; });
  return { repeat, day, rest };
}

/** Names in "Arjun, Rohan and Meera" ("me" and "I" are the asker), or null when they don't read as names. */
function namesOf(s: string): string[] | null {
  const parts = s.split(/\s*,\s*|\s+and\s+|\s*&\s*/i).map(tidy).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const out: string[] = [];
  for (const p of parts) {
    if (/^(?:me|i|myself)$/i.test(p)) { out.push("me"); continue; }
    if (!/^[A-Za-z][\w'.-]*(?:\s[A-Z][\w'.-]*)?$/.test(p) || /^(?:we|us|they|you|everyone|all|the kids|kids)$/i.test(p)) return null;
    out.push(p.split(" ").map(cap).join(" "));
  }
  return [...new Set(out)];
}

/** The doing, its time and place, from what is left once the days are out: "picks Kabir up at Little Steps at 1 pm". */
function doingOf(s: string, now: number, tz: number): { base: string; words: string; time: number | null; place: string; day: string | null } | null {
  const r = readLine(` ${s} `.replace(/\s+/g, " ").trim() || "x", now, tz, { place: true });
  let words = tidy(lower1(r.title === "X" ? "" : r.title)).replace(/^(?:free to|going to|able to|happy to|up for|available to)\s+/i, "");
  if (!words || NOT_A_TASK.test(words)) return null;
  words = words.replace(/\s+(?:for me|please|pls|plz)$/i, "");
  const [first, ...rest] = words.split(" ");
  const base = [baseVerb(first!), ...rest].join(" ");
  if (!/^[a-z]/.test(base) || NOT_A_TASK.test(base.split(" ")[0]!)) return null;
  return { base, words, time: r.time ?? null, place: r.place ?? "", day: r.daySaid || r.time !== undefined ? r.day ?? null : null };
}

/** A question for the family, or a turns set-up; null for anything else. */
export function readAsk(words: string, now: number, tz: number): AskRead | null {
  const s = words.replace(/\s+/g, " ").trim();
  if (!s || s.length > 240) return null;
  const today = dayOf(now, tz);

  // Turns: named, or open ("Who's in?").
  let turnNames: string[] | null = null, turnRest = "";
  const named = TURNS_NAMED.exec(s.replace(/[.!]+$/, ""));
  const open = TURNS_OPEN.exec(s.replace(/[.!]+$/, "")) ?? TURNS_TAIL.exec(s.replace(/[.!]+$/, ""));
  if (open && !(named && namesOf(named[1]!) && !/^(?:let'?s|we|can we)$/i.test(named[1]!.trim()))) { turnNames = []; turnRest = open[1]!; }
  else if (named) {
    const names = namesOf(named[1]!);
    if (names && names.length >= 2) { turnNames = names; turnRest = named[2]!; }
  }
  if (turnNames) {
    const rp = repeatOf(` ${turnRest} `, today);
    if (!rp.repeat) return null;
    const ds = daysOf(rp.rest, today);
    const d = doingOf(ds.rest, now, tz);
    if (!d) return null;
    // A bare thing ("Plants every Sunday, taking turns") is looked after: the doing is "do".
    const base = /^(?:water|feed|walk|clean|wash|cook|do|take|buy|get|make|iron|mop|sweep|dust|empty|fold|tidy|pick|drop|pay)\b/.test(d.base) ? d.base : `do ${d.words}`;
    const first = rp.day ?? ds.days[0] ?? (rp.repeat.every === "day" ? today : null);
    return {
      base, title: titleOf(base, true), days: first ? [first] : [today], time: d.time, place: d.place, repeat: rp.repeat,
      turns: { names: turnNames }, space: "",
    };
  }

  // A question for the family.
  const m = WHO.exec(s);
  if (!m) return null;
  const space = tidy(m[1] ?? m[2] ?? "");
  const rp = repeatOf(` ${m[3]!} `, today);
  const ds = daysOf(rp.rest, today);
  const d = doingOf(ds.rest, now, tz);
  if (!d) return null;
  const days = rp.day ? [rp.day] : ds.days.length ? ds.days.slice(0, 7) : d.day ? [d.day] : [];
  // A question with no day ("Who is Rahul?") is the chat's.
  if (!days.length) return null;
  return { base: d.base, title: titleOf(d.base, false), days, time: d.time, place: d.place, repeat: rp.repeat, turns: null, space };
}

// ------------------------------------------------------------------ days and times in words

/**
 * "Wednesday" (within the week), else "Wed 18 Nov". Never "today" or "tomorrow": these words go to pushes, the widget and notes, which
 * are read later, and a day's name stays true.
 */
export function dayLong(day: string, now: number, tz: number): string {
  const today = dayOf(now, tz);
  const d = new Date(`${day}T00:00:00Z`);
  if (day >= today && day <= shiftDay(today, 6)) return WEEKDAYS_LONG[d.getUTCDay()]!;
  return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/** "Wed and Thu", "Wednesday". */
export function daysWords(days: string[], now: number, tz: number): string {
  if (days.length === 1) return dayLong(days[0]!, now, tz);
  const short = days.map((k) => WEEKDAYS_SHORT[weekdayOf(k)]!);
  return `${short.slice(0, -1).join(", ")} and ${short[short.length - 1]}`;
}

/** "1 pm", "6:30 pm". */
export function clockOf(minute: number): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** "every Sunday", "every day". */
export function everyWords(r: AskRepeat): string {
  return r.every === "day" ? "every day" : `every ${r.days.map((d) => WEEKDAYS_LONG[d]).join(" and ")}`;
}

// ------------------------------------------------------------------ when

/** When the thing starts (a timed one), or the morning of its day; and when it stops being useful (its start, or its day's end). */
export function startOf(day: string, time: number | null, tz: number): number {
  return startOfDay(day, tz) + (time ?? 9 * 60) * MIN;
}
export function untilOf(day: string, time: number | null, tz: number): number {
  return time !== null ? startOfDay(day, tz) + time * MIN : startOfDay(day, tz) + DAY - MIN;
}
/** 6 pm the evening before: the take-by, and when a turn is told. */
export function eveBefore(day: string, tz: number): number {
  return startOfDay(shiftDay(day, -1), tz) + 18 * 60 * MIN;
}

/** The take-by: 6 pm the day before; asked after that, 2 hours on, but at least an hour before the thing (and never in the past). */
export function takeByOf(day: string, time: number | null, tz: number, asked: number): number {
  const eve = eveBefore(day, tz);
  if (asked <= eve - 30 * MIN) return eve;
  const start = startOf(day, time, tz);
  return Math.max(asked + 15 * MIN, Math.min(asked + 2 * HOUR, start - HOUR));
}

/** Halfway to the take-by: the one quiet nudge (none when there's under an hour to go). */
export function nudgeAtOf(asked: number, takeBy: number): number | null {
  return takeBy - asked >= HOUR ? asked + Math.round((takeBy - asked) / 2) : null;
}

/** The next occurrence's day after `day`, for a repeat. */
export function nextDayOf(day: string, r: AskRepeat): string {
  return shiftDay(day, r.every === "day" ? 1 : 7);
}

// ------------------------------------------------------------------ words for the family, the asker and whose turn it is

/** Health words make a question plain: who's taking whom to the doctor is nobody else's business. */
const plain = (s: string): boolean => looksHealth(s);

/** "Who picks Kabir up Wednesday?"; turns with no names: "Plants every Sunday, taking turns. Who's in?". Lock-safe. */
export function askQuestion(a: { base: string; title: string; day: string; repeat: AskRepeat | null; openTurns?: boolean }, now: number, tz: number): string {
  const day = dayLong(a.day, now, tz);
  if (a.openTurns && a.repeat) {
    if (plain(a.base)) return cutAt(`Taking turns ${everyWords(a.repeat)}. Who's in?`, 90);
    return cutAt(noAmounts(`${a.title} ${everyWords(a.repeat)}, taking turns. Who's in?`), 90);
  }
  if (plain(a.base)) return `Who can help ${day}?`;
  // A repeating ask is asked again each time: this one is for its own day.
  return cutAt(noAmounts(`Who ${withVerb(a.base, thirdPerson)} ${day}?`), 90);
}

/** The grey line beside the asker's tiny bot: "Priya asked · 1 pm, Little Steps". Lock-safe. */
export function askReason(a: { asker: string; time: number | null; place: string }): string {
  const where = a.place && !plain(a.place) ? a.place : "";
  const when = [a.time !== null ? clockOf(a.time) : "", where].filter(Boolean).join(", ");
  return lockSafe(`${a.asker} asked${when ? ` · ${when}` : ""}`, 60);
}

/** "Wednesday's pickup" (a pickup or a drop), else "Kabir pickup on Wednesday": the thing, by its day. */
function thingOnDay(title: string, base: string, day: string): string {
  const m = /^(.+)\s(pickup|drop)$/i.exec(title);
  if (m && !plain(base)) return `${day}'s ${m[2]!.toLowerCase()}`;
  if (plain(base)) return `${day}'s appointment`;
  return `${lower1(title)} on ${day}`;
}

/** To the asker, once the take-by passes: "Nobody's taken Wednesday's pickup yet" / "Kabir, 1 pm.". Turns: "Nobody can do the plants this Sunday". */
export function noneWords(a: { base: string; title: string; day: string; time: number | null; turns: boolean }, now: number, tz: number): { title: string; body: string } {
  const day = dayLong(a.day, now, tz);
  if (a.turns) {
    const what = plain(a.base) ? "it" : lower1(a.title);
    return { title: lockSafe(`Nobody can do ${what === "it" ? "it" : `the ${strip(what)}`} this ${day}`, 70), body: "Everyone said they can't." };
  }
  const m = /^(.+)\s(?:pickup|drop)$/i.exec(a.title);
  const who = m && !plain(a.base) ? m[1]! : "";
  const body = [who, a.time !== null ? clockOf(a.time) : ""].filter(Boolean).join(", ");
  return { title: lockSafe(`Nobody's taken ${thingOnDay(a.title, a.base, day)} yet`, 70), body: lockSafe(body ? `${body}.` : "It's still open for the family.", 60) };
}

/** To the asker when it's taken: "Mom's picking Kabir up Wednesday" / "It's on their day.". To a late tap: "Mom's already got it". */
export function takenWords(a: { base: string; title: string; day: string; taker: string }, now: number, tz: number): { title: string; body: string } {
  const day = dayLong(a.day, now, tz);
  if (plain(a.base)) return { title: lockSafe(`${a.taker}'s got ${day}'s appointment`, 70), body: "It's on their day." };
  return { title: lockSafe(`${a.taker}'s ${withVerb(a.base, ingOf)} ${day}`, 70), body: "It's on their day." };
}
export function lateWords(a: { base: string; title: string; day: string; taker: string }, now: number, tz: number): { title: string; body: string } {
  const day = dayLong(a.day, now, tz);
  return { title: lockSafe(`${a.taker}'s already got it`, 60), body: lockSafe(`${cap(thingOnDay(a.title, a.base, day))} is sorted.`, 70) };
}

/** Whose turn it is, the evening before: "Your turn: plants on Sunday" / "Arjun did it last time." [Can't do it]. */
export function turnWords(a: { base: string; title: string; day: string; last: string | null; passedBy?: string | null }, now: number, tz: number): { title: string; body: string } {
  const day = dayLong(a.day, now, tz);
  const what = plain(a.base) ? "" : lower1(a.title);
  return {
    title: lockSafe(what ? `Your turn: ${what} on ${day}` : `Your turn on ${day}`, 70),
    body: lockSafe(a.passedBy ? `${a.passedBy} can't this time.` : a.last ? `${a.last} did it last time.` : "You're first.", 60),
  };
}

/** The evening note's line about who's doing what: "Kabir pickup: Mom". */
export function whoLine(title: string, base: string, taker: string): string {
  return lockSafe(`${plain(base) ? "Appointment" : title}: ${taker}`, 50);
}
