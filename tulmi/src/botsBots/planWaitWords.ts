/**
 * WAITING ON SOMEONE: WHAT THE WORDS SAY (docs/plan-ease-people.md; design A6, B7). Rules only, so it costs nothing: what the one box, or
 * a meeting's to-do, says someone owes the person, and when Plan Ease should check back. Rules and templates only, no contacts: a number or an email is only
 * ever one that was in the words themselves.
 *
 *   readWait(words, now, tz)   "Rahul will send the numbers by Thursday": waiting on Rahul for the numbers, check Thu 6 pm.
 *                              "Plumber said Tuesday": a visit, "Did the plumber come?" Tue 4 pm. Null for anything else
 *   waitFromTodo(todo, ...)    a meeting's to-do whose "who" is a real name ("Speaker 2", "You" and "Others" never are)
 *   draftOf(w, hinglish)       the follow-up, ready to send: "Hi Rahul, just checking on the numbers. Could you send them today?"
 *   handoffOf(message, reach)  where Send goes: WhatsApp to the number, WhatsApp's own chat picker with none, the mail app for an email
 *   checkAt / againAt / afterSend   when to check back: the promised day at 6 pm (a visit 4 pm; a time said: an hour after), "this
 *                              week" Fri 6 pm, no day in 3 days; left alone, the next evening; after Send, 2 days on
 *
 * Pure: the calendar's day words and the hand-off link builders only.
 */
import { DAY, MIN, dayOf, minuteOf, readLine, shiftDay, startOfDay, weekdayOf } from "../calendar/words.js";
import { phoneDigits, whatsappLink } from "../connectors/handoffs/links.js";

/** What the words said someone owes the person. */
export interface WaitRead {
  /** Who: "Rahul", "the plumber". */
  who: string;
  /** What: "the numbers"; "" when nothing was named ("Rahul will call back"). */
  thing: string;
  /** The verb they'll do it with: "send", "call", "reply"; "" when none was said. */
  verb: string;
  /** What the list shows: "The numbers", "Call back", "Plumber visit". */
  title: string;
  /** A visit or a delivery: it asks "Did they come?" first. */
  came: boolean;
  /** The promised day, when one was said. */
  day: string | null;
  /** Minutes after midnight, when a time was said. */
  time: number | null;
  /** "This week" (Friday evening). */
  week: boolean;
  /** A phone number (digits with the country code) or an email found in the words. */
  reach: string | null;
}

/** Check-backs at most; after the last one it stays quietly on the list. */
export const CHECKS_MAX = 3;
/** The evening check, and a visit's afternoon one. */
export const CHECK_MIN = 18 * 60;
export const VISIT_MIN = 16 * 60;

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ------------------------------------------------------------------ who

/** Words that are never a person to chase. */
const NOBODY = /^(?:i|me|we|us|you|he|she|they|it|this|that|there|who|what|someone|somebody|anyone|anybody|everyone|everybody|nobody|others?|all|speaker(?:\s*\d+)?|unknown|the speaker)$/i;

/** People whose visit or delivery is waited for: they "come". */
const TRADE = String.raw`plumber|electrician|carpenter|painter|mechanic|technician|ac (?:guy|man|repair|service|technician)|repair ?man|cable guy|wi-?fi guy|internet guy|cleaner|pest control|maid|cook|tailor|driver|delivery(?: guy| boy| man)?|courier|parcel|package|order|gas cylinder|cylinder|water can`;
/** Of those, the ones that are a thing that arrives, not a person: "It was due today." */
const ARRIVES = /^(?:delivery|courier|parcel|package|order|gas cylinder|cylinder|water can)$/i;

const VISIT = new RegExp(String.raw`^(?:the |my |our )?(${TRADE})\b(?:\s+(?:said(?:\s+(?:he|she|they)(?:'d|'ll| would| will)?\s+(?:come|be here))?|says|is coming|will come|will be here|should come|comes|coming|arrives|will arrive|is due|due|is expected|expected))?\s*(.*)$`, "i");

/** "Rahul will", "Rahul said he'd", "Rahul promised to", "Rahul is going to". */
const MODAL = String.raw`will|'ll|is going to|is gonna|promised(?: to)?|said(?: (?:he|she|they)(?:'d|'ll| would| will)?)?|has to|should|needs to|was supposed to|is supposed to|has promised(?: to)?`;
const PERSON = new RegExp(String.raw`^((?:the )?[A-Za-z][\w.'-]*(?: [A-Z][\w.'-]*)?)\s*(?:${MODAL})\s+(.+)$`, "i");
/** A meeting's way of writing it: "Rahul sends numbers by Thursday". */
const PERSON_S = /^([A-Z][\w.'-]*(?: [A-Z][\w.'-]*)?)\s+(sends|shares|gives|returns|pays|transfers|forwards|mails|emails|submits|delivers|brings|confirms|finishes|completes|fixes|calls|replies|reverts|gets back)\b\s*(.*)$/;
const WAITING = /^(?:i'?m |i am |still )?waiting (?:on|for) (.+)$/i;

/** The verbs a thing is owed with, as said, and the base form a draft uses. */
const VERB = /^(send|share|give|return|pay|transfer|forward|mail|email|submit|deliver|bring|drop|confirm|finish|complete|fix|sign|approve|check|get|book|buy|arrange|prepare|make|write|review|organi[sz]e|call(?: me)?(?: back)?|ring(?: me)?(?: back)?|reply|revert|get back(?: to (?:me|us))?|let (?:me|us) know|tell (?:me|us)|update (?:me|us))\b(?:\s+(?:me|us)\b)?\s*(.*)$/i;
const VERB_S: Record<string, string> = {
  sends: "send", shares: "share", gives: "give", returns: "return", pays: "pay", transfers: "transfer", forwards: "forward", mails: "mail",
  emails: "email", submits: "submit", delivers: "deliver", brings: "bring", confirms: "confirm", finishes: "finish", completes: "complete",
  fixes: "fix", calls: "call", replies: "reply", reverts: "revert", "gets back": "get back",
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s: string): string => s.replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "").trim();

/** A person's name as written ("rahul" is Rahul), or null for a pronoun or an empty one. */
function nameOf(raw: string): string | null {
  const s = clean(raw);
  if (!s || s.length > 40 || NOBODY.test(s) || NOBODY.test(s.split(" ")[0]!)) return null;
  if (/^the /i.test(s)) return `the ${s.slice(4)}`;
  return s.split(" ").map(cap).join(" ");
}

// ------------------------------------------------------------------ what and when

/** A number or an email in the words, taken out of them. */
function reachOf(words: string): { rest: string; reach: string | null } {
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(words);
  if (email) return { rest: words.replace(email[0], " ").replace(/\(\s*\)/g, " "), reach: email[0].toLowerCase() };
  const phone = /\+?\d[\d\s-]{8,15}\d/.exec(words);
  const digits = phone ? phoneDigits(phone[0]) : null;
  if (phone && digits) return { rest: words.replace(phone[0], " ").replace(/\(\s*\)/g, " ").replace(/\s+(?:on|at)\s*(?=[,.]|$)/i, " "), reach: digits };
  return { rest: words, reach: null };
}

/** The day, the time and "this week" said in the rest, and what is left of the words. */
function whenOf(rest: string, now: number, tz: number): { left: string; day: string | null; time: number | null; week: boolean } {
  let s = ` ${rest} `;
  let week = false;
  s = s.replace(/\s(?:by |before |till |until )?(?:the )?(?:end of (?:the |this )?week|this week|by eow|eow)\b/i, () => { week = true; return " "; });
  const r = readLine(s.trim() || "x", now, tz, { place: false });
  return {
    left: r.title === "X" ? "" : r.title,
    day: r.daySaid || r.time !== undefined ? r.day ?? null : null,
    time: r.time ?? null,
    week,
  };
}

/** "the numbers", "his notes" (a draft to him says "your notes"), "" for nothing. A "The" the line reader capitalised goes back. */
function thingOf(s: string): string {
  const t = clean(s.replace(/^(?:to|me|us)\s+/i, "").replace(/\s+(?:to|for)\s+(?:me|us)$/i, ""));
  return /^(?:The|My|Our|His|Her|Their|A|An|Some|All|These|Those|That|This)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function titleOf(thing: string, verb: string, who: string): string {
  if (thing) return cap(thing.replace(/^(?:his|her|their)\s+/i, ""));
  if (verb) return cap(verb.replace(/ me\b| us\b/gi, "").replace(/^ring/, "call"));
  return `Hear back from ${who}`;
}

/** What someone owes, from the words; null when it isn't one. */
export function readWait(words: string, now: number, tz: number): WaitRead | null {
  const raw = words.replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 300 || /\?\s*$/.test(raw)) return null;
  const { rest: said, reach } = reachOf(raw);
  const s = clean(said);

  // A visit or a delivery: "Plumber said Tuesday", "the courier is coming tomorrow at 11".
  const v = VISIT.exec(s);
  if (v) {
    const trade = v[1]!.toLowerCase();
    const w = whenOf(v[2] ?? "", now, tz);
    // Without a day or a word saying they come, "Plumber" alone is a to-do, not a wait.
    const saidCome = s.length > v[1]!.length + 2;
    if (!w.day && !w.week && !saidCome) return null;
    // More words than a day ("Order the cake by Friday", "the plumber said the pipe needs a part"): not a visit to wait for.
    if (w.left && !/^(?:on|at|by|to come|to be here|for)$/i.test(w.left)) return null;
    return {
      who: `the ${trade}`, thing: "", verb: "", title: ARRIVES.test(trade) ? cap(trade) : `${cap(trade)} visit`, came: true,
      day: w.day, time: w.time, week: w.week, reach,
    };
  }

  // "Waiting on Rahul for the numbers", "waiting for Rahul's reply", "waiting for the numbers from Rahul".
  const wt = WAITING.exec(s);
  if (wt) {
    const w = whenOf(wt[1]!, now, tz);
    const body = clean(w.left);
    const trade = VISIT.exec(body);
    if (trade && !/\b(?:for|from)\b/i.test(body)) {
      const t = trade[1]!.toLowerCase();
      return { who: `the ${t}`, thing: "", verb: "", title: ARRIVES.test(t) ? cap(t) : `${cap(t)} visit`, came: true, day: w.day, time: w.time, week: w.week, reach };
    }
    let who: string | null = null, thing = "";
    let m = /^(.+?)\s+for\s+(.+)$/i.exec(body);
    if (m) { who = nameOf(m[1]!); thing = thingOf(m[2]!); }
    if (!who && (m = /^(.+?)\s+from\s+(.+)$/i.exec(body))) { who = nameOf(m[2]!); thing = thingOf(m[1]!); }
    if (!who && (m = /^([\w.-]+(?: [A-Z][\w.-]*)?)'s\s+(.+)$/i.exec(body))) { who = nameOf(m[1]!); thing = thingOf(m[2]!); }
    if (!who && !/\s/.test(body)) who = nameOf(body);
    if (!who) return null;
    const verb = /^(?:reply|answer|call(?: back)?|confirmation|response)$/i.test(thing) ? (thing.startsWith("call") ? "call" : "reply") : "";
    return { who, thing: verb ? "" : thing, verb, title: titleOf(verb ? "" : thing, verb, who), came: false, day: w.day, time: w.time, week: w.week, reach };
  }

  // "Rahul will send the numbers by Thursday", "Priya promised to call back Monday", "Rahul sends numbers by Thu".
  let who: string | null = null, rest = "", verbS = "";
  const p = PERSON.exec(s);
  if (p) { who = nameOf(p[1]!); rest = p[2]!; }
  if (!who) {
    const q = PERSON_S.exec(s);
    if (q) { who = nameOf(q[1]!); verbS = VERB_S[q[2]!.toLowerCase()] ?? ""; rest = q[3] ?? ""; }
  }
  if (!who) return null;
  const w = whenOf(verbS ? `${verbS} ${rest}` : rest, now, tz);
  // The meeting's way ("Rahul sends numbers") only with a day: "Mom calls" alone is nothing to wait for.
  if (verbS && !w.day && !w.week) return null;
  const vm = VERB.exec(w.left);
  let verb = "", thing = "";
  if (vm) { verb = vm[1]!.toLowerCase(); thing = thingOf(vm[2] ?? ""); }
  else if (/^(?:come|be here|visit|drop by|turn up)\b/i.test(w.left)) {
    return { who, thing: "", verb: "", title: `${cap(who.replace(/^the /, ""))} visit`, came: true, day: w.day, time: w.time, week: w.week, reach };
  } else if (w.left || (!w.day && !w.week && w.time === null)) {
    // "The meeting will start at 5", "Mom will pick Kabir up": nothing owed to the person. "Rahul said tomorrow" is (a day, no words).
    return null;
  }
  return { who, thing, verb, title: titleOf(thing, verb, who), came: false, day: w.day, time: w.time, week: w.week, reach };
}

// ------------------------------------------------------------------ a meeting's to-do

/**
 * A meeting's to-do (notes/extract.ts: its words, "who" and "when") as a wait, when its "who" is a real name: a speaker's label is
 * written as the name the person gave that speaker, and "You", "Speaker 2" or "Others" are never someone to chase.
 */
export function noteWho(who: string | undefined, people: ReadonlyArray<{ label: string; name?: string }> = []): string | null {
  const raw = (who ?? "").trim();
  if (!raw) return null;
  const named = people.find((p) => p.label === raw)?.name?.trim() || raw;
  return nameOf(named);
}

export function waitFromTodo(todo: { text: string; who?: string; when?: string }, people: ReadonlyArray<{ label: string; name?: string }>, now: number, tz: number): WaitRead | null {
  const who = noteWho(todo.who, people);
  if (!who) return null;
  // "Rahul to send the numbers", "Send the numbers to Neha": the words without the name.
  const words = clean(todo.text.replace(new RegExp(`^${who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:to|will|should|:)?\\s*`, "i"), ""));
  const w = whenOf(`${words} ${todo.when ?? ""}`, now, tz);
  const vm = VERB.exec(w.left);
  const verb = vm ? vm[1]!.toLowerCase() : "";
  const thing = thingOf(vm ? vm[2] ?? "" : w.left).replace(/\s+to\s+\S+$/i, "");
  return { who, thing, verb, title: titleOf(thing, verb, who), came: false, day: w.day, time: w.time, week: w.week, reach: null };
}

// ------------------------------------------------------------------ when to check back

const roundUp = (ms: number): number => Math.ceil(ms / (5 * MIN)) * 5 * MIN;

/** The first check-back: the promised day at 6 pm (a visit 4 pm; a time said: an hour after), "this week" Fri 6 pm, no day in 3 days. */
export function checkAt(w: Pick<WaitRead, "day" | "time" | "week" | "came">, now: number, tz: number): number {
  const today = dayOf(now, tz);
  let at: number;
  if (w.day) at = startOfDay(w.day, tz) + (w.time !== null ? w.time + 60 : w.came ? VISIT_MIN : CHECK_MIN) * MIN;
  else if (w.week) {
    const wd = weekdayOf(today);
    at = startOfDay(wd >= 1 && wd <= 5 ? shiftDay(today, 5 - wd) : today, tz) + CHECK_MIN * MIN;
  } else if (w.came) at = startOfDay(minuteOf(now, tz) < VISIT_MIN - 30 ? today : shiftDay(today, 1), tz) + (w.time !== null ? w.time + 60 : VISIT_MIN) * MIN;
  else at = startOfDay(shiftDay(today, 3), tz) + CHECK_MIN * MIN;
  // Said too late for that ("by today" at 7 pm): an hour from now.
  return at > now + 30 * MIN ? at : roundUp(now + 60 * MIN);
}

/** Left alone: asked again the next evening (a visit: the next afternoon). */
export function againAt(now: number, tz: number, came: boolean): number {
  return startOfDay(shiftDay(dayOf(now, tz), 1), tz) + (came ? VISIT_MIN : CHECK_MIN) * MIN;
}

/** After Send: checked again 2 days on, in the evening. */
export function afterSend(now: number, tz: number): number {
  return startOfDay(shiftDay(dayOf(now, tz), 2), tz) + CHECK_MIN * MIN;
}

/** "Thursday evening", "tomorrow at 4 pm", "this evening": when Plan Ease will ask, for the box's reply. */
export function askWords(at: number, now: number, tz: number): string {
  const day = dayOf(at, tz), today = dayOf(now, tz);
  const m = minuteOf(at, tz);
  const name = day === today ? "" : day === shiftDay(today, 1) ? "tomorrow" : WEEKDAYS_LONG[weekdayOf(day)]!;
  const h = Math.floor(m / 60), mm = m % 60;
  const clock = `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  if (m === CHECK_MIN) return name ? `${name} evening` : "this evening";
  return name ? `${name} at ${clock}` : `at ${clock} today`;
}

/**
 * "Thursday": a day as a check-back says it. Never "today": a push may be read the next morning, and a day's name stays true. Further
 * than a week either way: "Thu 12 Nov".
 */
export function dueWord(day: string, now: number, tz: number): string {
  const today = dayOf(now, tz);
  const d = new Date(`${day}T00:00:00Z`);
  if (day >= shiftDay(today, -6) && day <= shiftDay(today, 6)) return WEEKDAYS_LONG[d.getUTCDay()]!;
  return `${WEEKDAYS_LONG[d.getUTCDay()]!.slice(0, 3)} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/** "Thu": a day for the row's grey line. */
export const shortDay = (day: string): string => WEEKDAYS_LONG[weekdayOf(day)]!.slice(0, 3);

// ------------------------------------------------------------------ the follow-up

const plural = (thing: string): boolean => /s$/i.test(thing) && !/(?:ss|us|is)$/i.test(thing) && !/^(?:this|the news|the status|the address)$/i.test(thing);
const yours = (thing: string): string => thing.replace(/^(?:his|her|their)\s+/i, "your ");
/** The name a message starts with: "Rahul" (first word only), none for "the plumber" or "the bank". */
const hiTo = (who: string): string => (/^the /i.test(who) ? "" : who.split(" ")[0]!);

const SEND_LIKE = /^(?:send|share|give|return|pay|transfer|forward|mail|email|submit|deliver|bring|drop|sign|approve|finish|complete|fix|check|get|book|buy|arrange|prepare|make|write|review|organi[sz]e)$/;
const CALL_LIKE = /^(?:call|ring)/;
const REPLY_LIKE = /^(?:reply|revert|get back|let (?:me|us) know|tell|update|confirm)/;

/**
 * The follow-up, ready to send, in the app's language (English or Hinglish). A fixed template, with nothing in it the person didn't
 * say. It is opened in WhatsApp (or the mail app) for them to read and send themselves.
 */
export function draftOf(w: Pick<WaitRead, "who" | "thing" | "verb" | "came">, hinglish = false): string {
  const name = hiTo(w.who);
  const hi = name ? `Hi ${name},` : "Hi,";
  if (w.came) return hinglish ? `${hi} aaj aa rahe ho?` : `${hi} are you coming today?`;
  const thing = yours(w.thing);
  const verb = w.verb.split(" ")[0]!.replace(/^ring$/, "call");
  if (hinglish) {
    const what = thing.replace(/^(?:the|my|your)\s+/i, "");
    if (CALL_LIKE.test(verb)) return `${hi} aaj call kar loge?`;
    if (what) return `${hi} ${what} ka kya hua? Aaj ho jayega?`;
    return `${hi} kya update hai? Aaj bata doge?`;
  }
  if (CALL_LIKE.test(verb)) return `${hi} just checking in. Could you call me today?`;
  if (REPLY_LIKE.test(w.verb)) return thing ? `${hi} just checking on ${thing}. Could you let me know today?` : `${hi} just checking in. Could you let me know today?`;
  if (SEND_LIKE.test(verb)) return thing ? `${hi} just checking on ${thing}. Could you ${verb} ${plural(thing) ? "them" : "it"} today?` : `${hi} just checking in. Could you ${verb} it today?`;
  return thing ? `${hi} just checking on ${thing}. Any update?` : `${hi} just checking in. Any update?`;
}

/** "Hi, are you coming today?" for a visit that didn't happen. */
export const notComingDraft = (who: string, hinglish = false): string => draftOf({ who, thing: "", verb: "", came: true }, hinglish);

/**
 * Where Send goes: WhatsApp to the number found in the words, the mail app for an email, else WhatsApp's own chat picker. Built here,
 * so it doesn't wait on the connected apps' switch; every part is encoded, and the phone checks it against its hand-off list again.
 */
export function handoffOf(message: string, reach: string | null | undefined): string {
  const text = message.slice(0, 600);
  if (reach && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(reach)) return `mailto:${reach}?body=${encodeURIComponent(text)}`;
  if (reach && /^\d{8,15}$/.test(reach)) return whatsappLink(text, reach);
  return whatsappLink(text);
}

/** A day key's evening: when the check-back on it goes. */
export const eveningOf = (day: string, tz: number): number => startOfDay(day, tz) + CHECK_MIN * MIN;
/** The end of a day, for a card that goes then. */
export const endOfDay = (day: string, tz: number): number => startOfDay(day, tz) + DAY - MIN;
