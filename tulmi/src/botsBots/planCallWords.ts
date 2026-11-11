/**
 * "X0 IS CALLING": WHAT A CALL SAYS, AND WHEN IT MAY RING (planCall.ts is the service; docs/plan-ease.md "Calls"). Pure: no imports
 * beyond Plan Ease's lock-screen words (planSafe.ts) and the calendar's clock words, so every line here is tested directly.
 *
 *   openingLine(seed, o)    what the bot says first when the call is answered ("It's time to leave for the parent-teacher meeting at
 *                           Green Valley School. Want me to do anything?"), or after a Call back ("I called because ...")
 *   missedBody(line, more)  the missed call's words: the reminder's own line, and its second half ("25 min drive to ...")
 *   cardOf(seed, tz)        the call screen's item card: the full title (inside the app), the leave-by or due line, its ids
 *   spokenOf(text)          a reply as it is said aloud: no markdown, two sentences, 280 characters at most
 *   endsCall(words)         "no", "bye", "that's all", "bas": the person is done, and nothing more is asked of the chat
 *   callContext(...)        the facts the Plan Ease chat is handed with each turn (what it is, its ids, what was said)
 *   blockedBy(rows, ...)    why a call may not ring now: one already on, three today, or the last one under 15 minutes ago
 *
 * The words said aloud follow the lock-screen rules (planSafe.ts): an appointment is "your appointment", there is never an amount, and
 * a health place is left out. Someone may be standing beside the person when the phone speaks.
 */
import { cutAt, lockSafe, looksHealth, safeTitle, APPOINTMENT } from "./planSafe.js";
import { clockAt, dayOf, hhmm, minuteOf } from "../calendar/words.js";

/** Where the call's routes live (routes/bots/planCalls.ts). */
export const CALLS = "/v1/botsapp/bots/plan/calls";

// ------------------------------------------------------------------ timings and limits (planCall.ts re-exports them)

/** The ring window. */
export const RING_MS = 45_000;
/** The second ring (the 20 s tone has ended). */
export const RING2_MS = 23_000;
/** A late Answer (Face ID, a slow launch) still connects this long after the ring window. */
export const GRACE_MS = 120_000;
/**
 * An answered call with no turn this long is ended. Leaving the screen without End call is common, and nothing on the phone reliably
 * says so: until this passes the person counts as busy.
 */
export const TALK_IDLE_MS = 5 * 60_000;
/** Server-started calls per person per local day (a call that never left counts for nothing). */
export const DAY_MAX = 3;
/** Since the last call's ring, server-started or a Call back. */
export const GAP_MS = 15 * 60_000;
/** The phone: a ringing notification older than this is stale (RING_MS + 5 s). */
export const STALE_RING_MS = 50_000;
/** The person's turns per call. */
export const MAX_TURNS = 8;
/** An answer this recent still speaks the opening (a retry after a lost response). */
export const FRESH_MS = 10_000;
/** The safety-net sweep. */
export const SWEEP_MS = 10_000;

// ------------------------------------------------------------------ what the server knows when it rings

/**
 * What the reminder knew, kept with the call on the server only (never in a push): the raw title, its ids, the place and the times.
 * `tz` is the offset the reminder's own words were written in, so the opening, the card and "Missed call · 8:12 am" say the clock the
 * push would have said.
 */
export type CallSeed =
  | { source: "leave"; item: string; eventId: string; day: string; tz: number; title: string; place: string; start: number; leaveBy: number; minutes: number; mode: "drive" | "walk" }
  | { source: "due"; item: string; taskId: string; day: string; tz: number; title: string; payee: string; pay: boolean };

export type CallState = "ringing" | "answered" | "declined" | "missed" | "ended";

/** The call screen's read (GET CALLS/:id). */
export interface CallView {
  id: string;
  state: CallState;
  origin: "server" | "user";
  /** The name it called as (kept at ring time). */
  name: string;
  source: "leave" | "due";
  /** The lock-safe reminder line (the ring's body). */
  line: string;
  ringAt: number;
  /** "8:12 am": when it rang, in the person's clock then. */
  missedClock: string;
  answeredAt: number | null;
  endedAt: number | null;
  /** Answerable now: ringing, or missed and still inside the grace after its window. */
  late: boolean;
  /** The person has agreed to AI (privacy/aiConsent.ts): the server voice, and talking back. */
  ai: boolean;
  card: {
    /** The full title, as the Plan page shows it (inside the app). */
    title: string;
    /** "Leave by 5:05 pm · 25 min drive to Green Valley School", "To BESCOM · due today", "Due today". */
    sub: string;
    item: string;
    eventId?: string;
    /** The place, for Open map. */
    to?: string;
    mode?: "driving" | "walking";
    taskId?: string;
    /** A bill with a safe pay link. */
    pay?: boolean;
  };
}

// ------------------------------------------------------------------ the opening line

/** A title starting with one of these is a thing to go and do: "to pick up Kabir". */
const VERBS = new Set(["pick", "drop", "meet", "call", "visit", "see", "collect", "get", "buy", "go", "take", "bring", "fetch"]);
const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "prof"]);

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** The title as it may be said: no amount, an appointment as such, and only the part before " · ". */
const sayable = (title: string): string => { const t = safeTitle(title); return t.split(" · ")[0]!.trim() || t; };

/** "for the parent-teacher meeting", "to pick up Kabir", "for PTM", "for your appointment". */
function goingTo(title: string): { prep: "for" | "to"; what: string } {
  const t = sayable(title);
  if (t === APPOINTMENT) return { prep: "for", what: "your appointment" };
  const [first = "", second] = t.split(/\s+/);
  if (VERBS.has(first.toLowerCase())) return { prep: "to", what: lowerFirst(t) };
  const honorific = HONORIFICS.has(first.toLowerCase().replace(/\.$/, ""));
  if (/^[A-Z][a-z]/.test(first) && !/['’]/.test(first) && !honorific && (second === undefined || /^[a-z]/.test(second))) {
    return { prep: "for", what: `the ${lowerFirst(t)}` };
  }
  return { prep: "for", what: t };
}

/** The bill as it may be said: "Electricity bill" (never its amount); "A bill" when its title reads as health. */
function billOf(title: string, capital: boolean): string {
  const t = cutAt(sayable(title), 60);
  if (t === APPOINTMENT) return capital ? "A bill" : "a bill";
  if (capital) return upperFirst(t);
  const first = t.split(/\s+/)[0] ?? "";
  return first.length > 1 && first === first.toUpperCase() ? t : lowerFirst(t);
}

/**
 * What the bot says first. A live call says what the moment is; a Call back says why it called, and whether the thing has started.
 * `talk`: the person can answer (AI permission and a screen that listens), so it asks. Never a "$": the phone fills "$state." in speech.
 */
export function openingLine(seed: CallSeed, o: { back: boolean; talk: boolean; now: number; tz: number }): string {
  let line: string;
  if (seed.source === "leave") {
    const { prep, what } = goingTo(seed.title);
    const place = looksHealth(seed.title) || looksHealth(seed.place) ? "" : lockSafe(seed.place, 60);
    const at = place ? ` at ${place}` : "";
    if (!o.back) line = `It's time to leave ${prep} ${what}${at}.`;
    else if (o.now < seed.start) line = `I called because it was time to leave ${prep} ${what}${at}. It starts at ${clockAt(seed.start, o.tz)}.`;
    else line = `I called because it was time to leave ${prep} ${what}. It started at ${clockAt(seed.start, o.tz)}.`;
  } else {
    line = o.back ? `I called because ${billOf(seed.title, false)} is due today.` : `${billOf(seed.title, true)} is due today.`;
  }
  if (o.talk) line += " Want me to do anything?";
  return line.replace(/\$/g, "");
}

// ------------------------------------------------------------------ the missed call and the card

/** The missed call's body: the reminder's line, and its second half when it says something ("Tap to see it" says nothing). */
export function missedBody(line: string, more: string): string {
  return lockSafe(more && more !== "Tap to see it" ? `${line} · ${more}` : line, 140);
}

/** The call screen's item card, inside the app: the full title, its leave-by or due line, and what its buttons need. */
export function cardOf(seed: CallSeed, tz: number): CallView["card"] {
  const title = cutAt(seed.title, 120);
  if (seed.source === "leave") {
    const place = cutAt(seed.place, 80);
    return {
      title, item: seed.item, eventId: seed.eventId, mode: seed.mode === "walk" ? "walking" : "driving",
      sub: `Leave by ${clockAt(seed.leaveBy, tz)} · ${seed.minutes} min ${seed.mode === "walk" ? "walk" : "drive"}${place ? ` to ${place}` : ""}`,
      ...(seed.place ? { to: seed.place.slice(0, 160) } : {}),
    };
  }
  const payee = cutAt(seed.payee, 60);
  return { title, item: seed.item, taskId: seed.taskId, pay: seed.pay, sub: payee ? `To ${payee} · due today` : "Due today" };
}

// ------------------------------------------------------------------ talking

/** A reply as it is said aloud: no markdown, at most two sentences and 280 characters, cut at a word. Never empty. */
export function spokenOf(text: string): string {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/[*_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [];
  const two = sentences.slice(0, 2).join("").trim() || plain;
  return cutAt(two, 280) || "Done.";
}

const ENDS = new Set([
  "no", "nope", "nothing", "no thanks", "no thank you", "thats all", "thats it", "bye", "goodbye", "ok bye", "okay bye", "thanks",
  "thank you", "nahi", "kuch nahi", "bas", "theek hai", "ok thanks", "all good",
]);

/**
 * The person said they're done ("No, that's all.", "Bye!", "Bas"): the call closes without asking the chat anything. The whole of what
 * they said must be these words, one phrase or a few in a row ("No, thanks, bye", "no that's all" as a phone hears it), so "No, move it
 * to 6" still goes to the chat.
 */
export function endsCall(words: string): boolean {
  const w = String(words ?? "").toLowerCase().replace(/[’']/g, "").replace(/[.!?…,;:]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 8) return false;
  // Can the words be cut into phrases that are each a way of saying "that's all"? (ends[i]: the first i words can.)
  const ends: boolean[] = [true];
  for (let i = 1; i <= w.length; i += 1) {
    ends[i] = false;
    for (let j = Math.max(0, i - 3); j < i && !ends[i]; j += 1) ends[i] = !!ends[j] && ENDS.has(w.slice(j, i).join(" "));
  }
  return !!ends[w.length];
}

/** The facts the Plan Ease chat reads with each turn of the call (an attachment, read as data): what, which one, and what was said. */
export function callContext(seed: CallSeed, opening: string, tz: number): string {
  const clock = (ms: number) => hhmm(minuteOf(ms, tz));
  const lines = [`What: ${seed.title}`, `Kind: ${seed.source === "leave" ? "leave-by" : "bill due today"}`];
  if (seed.source === "leave") {
    lines.push(`Event id: ${seed.eventId}`, `Day: ${seed.day}`, `Starts: ${clock(seed.start)}`, `Leave by: ${clock(seed.leaveBy)}`,
      `${seed.minutes} min ${seed.mode === "walk" ? "walk" : "drive"}`, ...(seed.place ? [`Place: ${seed.place}`] : []));
  } else {
    lines.push(`To-do id: ${seed.taskId}`, `Due: ${seed.day}`, ...(seed.payee ? [`Payee: ${seed.payee}`] : []), `Pay link: ${seed.pay ? "yes" : "no"}`);
  }
  if (opening) lines.push(`You said: "${opening}"`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ the limits

/** As much of a call as the limits read. */
export interface LimitRow {
  state: string; why?: string | null; origin: string; ring_at_ms: number; ring_until_ms: number; next_ms: number | null;
}

/**
 * Why a call may not ring now, over the person's newest calls: one ringing or on ("busy"), three server calls today already
 * ("day_max"), or the last call rang under 15 minutes ago ("too_soon"). A ring that never left counts for nothing. The person's own Call
 * backs count for busy and for the 15 minutes (a ring two minutes after hanging up is what that rule forbids), not for the three.
 */
export function blockedBy(rows: readonly LimitRow[], now: number, tz: number): "busy" | "day_max" | "too_soon" | null {
  const real = rows.filter((r) => r.why !== "not_sent");
  if (real.some((r) => (r.state === "ringing" && r.ring_until_ms > now) || (r.state === "answered" && (r.next_ms ?? 0) > now))) return "busy";
  const today = dayOf(now, tz);
  if (real.filter((r) => r.origin === "server" && dayOf(r.ring_at_ms, tz) === today).length >= DAY_MAX) return "day_max";
  if (real.some((r) => now - r.ring_at_ms < GAP_MS)) return "too_soon";
  return null;
}
