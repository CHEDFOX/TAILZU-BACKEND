/**
 * PLAN EASE'S FOLLOW-THROUGH: THE WORDS AND THE RULES (PLAN_V2_FOLLOW; docs/plan-ease.md "Follow-through"). Pure: every decision the
 * ladder makes that can be said without a database is said here, so it can be tested on its own, and the phone channel (Backend B)
 * reads the same words and types.
 *
 *   PersonRef / cleanPeople      who does an item (the first is Who, the rest "if they can't"), as stored on the calendar row
 *   autoMust / effectiveMust     must-not-miss by plain rules (medicine, a pickup, a bill due today, a flight); the person's switch wins
 *   ladderOf / missAt / laterAt  the climb: a push, then for a must item a louder push, X0 is calling, a real phone call (only for someone
 *                                who turned it on for their own number), then telling the next person
 *   nextHolder / tellTarget      who has it after a "can't", who hears when nobody says done
 *   looksMed / followTitle / forOthers   what may be said on a lock screen, to someone else, or aloud on a call
 *   followPushWords / stepLine / followLine / howWords   every fixed line (no AI writes any of them)
 *
 * WHO CAN BE ON AN ITEM (the owner's change, docs/plan-ease.md): the asker, and only people the asker is connected with in X0, decided by
 * exactly the rules messaging uses (threads.ts contacts: a space they share in which the asker may message, no block either way, Spaces
 * on). Everyone on an item has X0. Those rules are checked by planFollowPeople.ts and again before every reach (planFollow.ts); this file
 * only keeps the refs.
 *
 * Imports only planSafe.ts, calendar/words.ts and planDue.ts (dueAgainAt), and planKinds.ts as a type.
 */
import { APPOINTMENT, cutAt, lockSafe, looksHealth, safeTitle } from "./planSafe.js";
import { DAY, MIN, clockAt, dayOf, dayWords, minuteOf, shiftDay, startOfDay } from "../calendar/words.js";
import { dueAgainAt } from "./planDue.js";
import type { FOLLOW_KIND_IDS } from "./planKinds.js";

export { dueAgainAt };

// ------------------------------------------------------------------ who is on an item

/**
 * An X0 user on an item: their auth id, and the name the asker knew them by when they were put on it (so "Mom isn't in your X0 people"
 * can still say who, after she left). An empty list means the asker.
 */
export type PersonRef = { k: "u"; id: string; name?: string };
export type PersonKey = `u:${string}`;
export const keyOf = (p: { id: string }): PersonKey => `u:${p.id}`;
export const idOfKey = (key: string): string => (key.startsWith("u:") ? key.slice(2) : "");
export const PEOPLE_MAX = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * Raw jsonb → refs: X0 users only ({ k: "u", id: <uuid> }), in order; anything malformed, a duplicate and anything past PEOPLE_MAX is
 * dropped. Rows written by an earlier draft (a "c" ref for someone without X0, an "s" space id) lose those parts.
 */
export function cleanPeople(raw: unknown): PersonRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonRef[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (out.length >= PEOPLE_MAX) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (o.k !== "u" || !isUuid(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    out.push(name ? { k: "u", id: o.id, name } : { k: "u", id: o.id });
  }
  return out;
}

// ------------------------------------------------------------------ importance, by plain rules

export type MustWhy = "medicine" | "pickup" | "bill_today" | "flight";

const MEDICINE = /\b(?:medicines?|medication|meds|tablets?|pills?|capsules?|insulin|inhaler|eye ?drops?|syrup|dose|dawa(?:i|ai)?|davai|goli)\b|दवा|दवाई|गोली|மருந்து/i;
const PICKUP = /\b(?:pick(?:ing)?[\s-]?up|pick\s+\w+(?:\s+\w+)?\s+up|collect\s+\w+\s+from|school\s+(?:pick ?up|drop)|drop\s+\w+\s+(?:at|to|off)|le\s+aana|lene\s+jaana|chhod(?:na|ne)(?:\s+jaana)?)\b/i;
const TRAVEL = /\b(?:flight|fly(?:ing)?\s+to|boarding|airport|departure|train|rajdhani|shatabdi|vande\s+bharat|duronto|pnr|bus\s+to)\b/i;

/** The "flight" rule's words, also used for the 2 h default reminder of a new event (calendar/service.ts FLIGHT_REMIND_MIN). */
export const looksTravel = (title: string): boolean => TRAVEL.test(title);

/** Must-not-miss by the rules alone, and why; null when no rule says so. A wait never is. */
export function autoMust(x: {
  kind: "todo" | "due" | "wait" | "event" | "ask"; title: string; timed: boolean; dueDay: string | null; today: string;
}): MustWhy | null {
  if (x.kind === "wait") return null;
  if (x.kind === "due") return x.dueDay !== null && x.dueDay === x.today ? "bill_today" : null;
  if (x.timed && MEDICINE.test(x.title)) return "medicine";
  if (x.timed && PICKUP.test(x.title)) return "pickup";
  if (x.kind === "event" && x.timed && TRAVEL.test(x.title)) return "flight";
  return null;
}

/** The person's switch wins ("normal" turns a rule off, "must" turns anything on); unset, the rules decide. */
export function effectiveMust(stored: "normal" | "must" | null | undefined, why: MustWhy | null): boolean {
  if (stored === "must") return true;
  if (stored === "normal") return false;
  return why !== null;
}

// ------------------------------------------------------------------ the shared types

export const FOLLOW = "/v1/botsapp/bots/plan/follow";              // the app routes (routes/bots/planFollows.ts)
export type FollowKind = "todo" | "due" | "event" | "ask";
export type FollowState = "open" | "snoozed" | "told" | "nobody" | "done" | "missed" | "dropped";
/**
 * The climb: the quiet line on the Plan, the push, a louder push, X0 is calling (in the app), a real phone call (only for someone who
 * turned it on in What pings you for their own number), then telling the next person.
 */
export type FollowRung = "line" | "push" | "loud" | "call" | "phone" | "tell";
export type StepRung = "push" | "loud" | "call" | "phone" | "tell";
/** push: a notification; ring: X0 is calling (planCall.ts); phone: a real phone call (the phone channel, planFollowChannels.ts). */
export type StepChannel = "push" | "ring" | "phone";
export type StepState = "sent" | "failed" | "skipped" | "opened" | "answered" | "no_answer";
/**
 * How an answer came: a button in the app (a push, the Plan, the follow page), the X0 call screen, the keypad of a real phone call (1
 * done, 2 later, 3 can't), or the item itself (ticked, paid, taken out).
 */
export type FollowVia = "app" | "ring" | "call" | "item";
export type FollowVerb = "done" | "later" | "cant" | "take" | "undone";
export type LaterChoice = "default" | "15m" | "1h" | "eve" | "tmrw";
/** app: in the asker's X0 people now (messaging's rules). gone: not any more (left the space, a block, Spaces off): skipped. */
export type PersonHow = "app" | "gone";
/** One person on a follow as it was armed: an X0 user, with the name the asker knows them by ("" for the asker). */
export interface FollowPerson { k: "u"; id: string; name: string }
export interface FollowAnswer { by: PersonKey; verb: FollowVerb; via: FollowVia; at: number; n: number }
export type FollowPushKind = (typeof FOLLOW_KIND_IDS)[number];

/** The states in which a follow is still going (the sweep reads these). */
export const OPEN_STATES: readonly FollowState[] = ["open", "snoozed", "told", "nobody"];
export const CLOSED_STATES: readonly FollowState[] = ["done", "missed", "dropped"];
export const isOpenState = (s: FollowState): boolean => OPEN_STATES.includes(s);

/** Timings, from the push surface's flags (planKinds.ts followPushFlags); FOLLOW_TIMINGS are the defaults. */
export interface FollowTimings {
  loudAfterMin: number; callAfterMin: number; phoneAfterMin: number; tellAfterMin: number; missAfterMin: number;
  laterMustMin: number; laterMin: number; laterMax: number; phoneDayMax: number; lateSkipMin: number;
}
export const FOLLOW_TIMINGS: FollowTimings = {
  loudAfterMin: 5, callAfterMin: 10, phoneAfterMin: 15, tellAfterMin: 20, missAfterMin: 360,
  laterMustMin: 15, laterMin: 60, laterMax: 3, phoneDayMax: 3, lateSkipMin: 5,
};

// ------------------------------------------------------------------ the ladder

export interface LadderStep { rung: StepRung; at: number }

/** The order of the rungs: a step is taken only when it ranks above the last one. */
export const RUNG_RANK: Record<FollowRung, number> = { line: 0, push: 1, loud: 2, call: 3, phone: 4, tell: 5 };

/**
 * normal: [{ push, base }]. must: [{ push, base }, { loud, climb === base ? climb + loudAfter : climb }, { call, climb + callAfter },
 * { phone, climb + phoneAfter }, { tell, climb + tellAfter }]. climb is the bill's 6 pm (dueAgainAt) when that is later than base, else
 * base. The phone rung is always on the ladder; it rings only for a holder who turned real calls on for their own number (else it passes
 * without a step).
 */
export function ladderOf(o: { importance: "normal" | "must"; base: number; climb: number; t?: FollowTimings }): LadderStep[] {
  const t = o.t ?? FOLLOW_TIMINGS;
  const out: LadderStep[] = [{ rung: "push", at: o.base }];
  if (o.importance !== "must") return out;
  out.push(
    { rung: "loud", at: o.climb === o.base ? o.climb + t.loudAfterMin * MIN : o.climb },
    { rung: "call", at: o.climb + t.callAfterMin * MIN },
    { rung: "phone", at: o.climb + t.phoneAfterMin * MIN },
    { rung: "tell", at: o.climb + t.tellAfterMin * MIN },
  );
  return out;
}

/** When the occurrence closes as "missed" when nobody answered: max(base, climb) + missAfter. */
export function missAt(o: { base: number; climb: number; t?: FollowTimings }): number {
  return Math.max(o.base, o.climb) + (o.t ?? FOLLOW_TIMINGS).missAfterMin * MIN;
}

const nineTomorrow = (now: number, tz: number): number => startOfDay(shiftDay(dayOf(now, tz), 1), tz) + 9 * 60 * MIN;

/**
 * Later: default = must ? +laterMustMin : (local minute >= 20:00 ? 9 am tomorrow : +laterMin); "15m" +15; "1h" +60; "eve" 7 pm today
 * (only before 6:30 pm, else +60); "tmrw" 9 am tomorrow.
 */
export function laterAt(choice: LaterChoice, o: { now: number; tz: number; must: boolean; t?: FollowTimings }): number {
  const t = o.t ?? FOLLOW_TIMINGS;
  const minute = minuteOf(o.now, o.tz);
  switch (choice) {
    case "15m": return o.now + 15 * MIN;
    case "1h": return o.now + 60 * MIN;
    case "eve": return minute < 18 * 60 + 30 ? startOfDay(dayOf(o.now, o.tz), o.tz) + 19 * 60 * MIN : o.now + 60 * MIN;
    case "tmrw": return nineTomorrow(o.now, o.tz);
    default:
      if (o.must) return o.now + t.laterMustMin * MIN;
      return minute >= 20 * 60 ? nineTomorrow(o.now, o.tz) : o.now + t.laterMin * MIN;
  }
}

/** The Later choices a screen may offer now: [{ choice, label }] ("In 15 min", "In 1 hour", "This evening", "Tomorrow morning"). */
export function laterChoices(now: number, tz: number): Array<{ choice: Exclude<LaterChoice, "default">; label: string }> {
  const out: Array<{ choice: Exclude<LaterChoice, "default">; label: string }> = [
    { choice: "15m", label: "In 15 min" },
    { choice: "1h", label: "In 1 hour" },
  ];
  if (minuteOf(now, tz) < 18 * 60 + 30) out.push({ choice: "eve", label: "This evening" });
  out.push({ choice: "tmrw", label: "Tomorrow morning" });
  return out;
}

/** The next holder: the first person after `holder` in order whose key is not in `cant`; null when none is left. */
export function nextHolder(people: readonly FollowPerson[], holder: number, cant: readonly string[]): number | null {
  for (let i = holder + 1; i < people.length; i += 1) if (!cant.includes(keyOf(people[i]!))) return i;
  return null;
}

/**
 * Who the tell rung tells: the asker when the holder is someone else; else the first person after the holder who is not the asker, has
 * not said can't and is not in `skip` (not in the asker's X0 people now); null when nobody can be told.
 */
export function tellTarget(f: { user_id: string; people: readonly FollowPerson[]; holder: number; cant: readonly string[] }, skip: readonly string[] = []): FollowPerson | null {
  const h = f.people[f.holder];
  if (h && h.id !== f.user_id) return { k: "u", id: f.user_id, name: "" };
  for (let i = f.holder + 1; i < f.people.length; i += 1) {
    const p = f.people[i]!;
    const key = keyOf(p);
    if (p.id === f.user_id || f.cant.includes(key) || skip.includes(key)) continue;
    return p;
  }
  return null;
}

// ------------------------------------------------------------------ what may be said outside the app

/**
 * Health by planSafe's looksHealth OR by the MEDICINE rule. planSafe's HEALTH list does not hold "meds", "capsule", "inhaler", "eye
 * drops", "syrup", "dose", "goli" or "गोली", which autoMust makes must: without this, "Mom's meds" would reach another person's lock
 * screen and a spoken call. planSafe.ts itself is not changed (its tests and every other Plan Ease line stay as they are).
 */
export const looksMed = (title: string): boolean => looksHealth(title) || MEDICINE.test(title);

/** The asker's own lock-screen title for a follow push: "Reminder" for medicine, APPOINTMENT for other health, else safeTitle; cut at 60. */
export function followTitle(title: string): string {
  if (MEDICINE.test(title)) return MED_TITLE;
  return looksMed(title) ? APPOINTMENT : cutAt(safeTitle(title), 60);
}

/** Medicine on the asker's own lock screen and widget: never the medicine, and not "Appointment" either. */
export const MED_TITLE = "Reminder";

/** A title for someone else's eyes or ears (their lock screen, a call that may be on speaker): "" when looksMed, else safeTitle cut at 60. */
export function forOthers(title: string): string {
  return looksMed(title) ? "" : cutAt(safeTitle(title), 60);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (key: string): string => WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]!;
/** "Thu" within the coming week, "Thu 19 Nov" further on or in the past. */
const dayShort = (key: string, today: string): string => (key > today && key <= shiftDay(today, 6) ? weekday(key) : dayWords(key));

/** "9 pm", "Thu 9 pm", "today", "Thu": the item's time in the follow's offset, as the pushes say it. */
export function whenWords(o: { dueMs: number | null; day: string; tz: number; now: number }): string {
  const today = dayOf(o.now, o.tz);
  if (o.dueMs !== null && Number.isFinite(o.dueMs)) {
    const d = dayOf(o.dueMs, o.tz);
    const clock = clockAt(o.dueMs, o.tz);
    return d === today ? clock : `${dayShort(d, today)} ${clock}`;
  }
  return o.day === today ? "today" : dayShort(o.day, today);
}

/** A person's first name, for a push ("Mom", "Rahul"); "Someone" when there is none. */
export const firstName = (name: string): string => (name.replace(/\s+/g, " ").trim().split(" ")[0] ?? "").slice(0, 24) || "Someone";

export interface PushWordsIn {
  title: string; when: string; must: boolean; asker: string; holder: string; from?: string; to?: string; who?: string; clock?: string;
  /** A tell sent because the holder's push could not go at all ("unreached"): the title is "X0 couldn't reach H". */
  unreached?: boolean;
  /**
   * Someone on it who is not in the asker's X0 people now (left the space, a block, Spaces off), whose turn was skipped: said once, in the
   * asker's own push (they hold it now), in "passed" (someone else has it) or in "none" (nobody is left).
   */
  gone?: string;
}

/** Every push's words. Each line through lockSafe(…, 100). Never an amount, a place, or a health title to anyone else. */
export function followPushWords(kind: FollowPushKind, x: PushWordsIn): { title: string; body: string } {
  const T = followTitle(x.title);
  const W = forOthers(x.title);
  const C = x.when;
  const A = firstName(x.asker);
  const H = firstName(x.holder);
  const med = looksMed(x.title);
  const theReminder = `The ${C} reminder`;
  const notHere = (name: string) => `${firstName(name)} isn't in your X0 people`;
  const say = (title: string, body: string) => ({ title: lockSafe(title, 100), body: lockSafe(body, 100) });
  switch (kind) {
    case "plan_follow": return say(T, x.gone ? `${notHere(x.gone)} · ${C}` : x.must ? `${C} · Must not miss` : C);
    case "plan_follow_loud": return say(T, `Not done yet · ${C}`);
    case "space_follow": return say(W || `A reminder from ${A}`, W ? `From ${A} · ${C}` : C);
    case "space_follow_loud": return say(W || `A reminder from ${A}`, `Not done yet · ${C}`);
    case "plan_follow_tell": return say(x.unreached ? `X0 couldn't reach ${H}` : `${H} hasn't said done`, med ? theReminder : `${T} · ${C}`);
    case "space_follow_tell": return say(`${H} hasn't said done`, W ? `${W} · ${C}` : theReminder);
    case "plan_follow_none": return say(x.gone ? notHere(x.gone) : "Nobody can do it", `${T} · ${C}`);
    case "plan_follow_passed": return say(x.gone ? notHere(x.gone) : `${firstName(x.from ?? "")} can't do it`, `${firstName(x.to ?? "")} has it now`);
    case "plan_follow_done": return say(`${firstName(x.who ?? "")} said done`, `${T} · ${x.clock ?? C}`);
    case "space_follow_done": return say(`${firstName(x.who ?? "")} said done`, W || theReminder);
    default: return say(T, C);
  }
}

/** How a person on an item reads on the People list and the follow page. */
export function howWords(how: PersonHow): string {
  return how === "gone" ? "Not in your X0 people now" : "Has X0";
}

const CHANNEL_WORDS: Record<StepChannel, string> = { push: "Notification", ring: "X0 call", phone: "Phone call" };
const WHY_WORDS: Record<string, string> = {
  gone: "not in your X0 people now", muted: "they muted your chat", quiet: "quiet hours", cap: "daily limit", off: "switched off",
  no_phone: "no phone", no_number: "no number yet", stopped: "asked to stop", late: "already answered", busy: "on another call",
  not_sent: "not sent", abroad: "number abroad", day_max: "3 calls today", too_soon: "too soon after a call", desk: "on their computer",
  leave_by: "the leave-by reminder", called: "called already", none: "nobody else to tell",
};

/** The asker's view of one step: "9:00 pm · Mom · Notification · opened 9:02", "9:10 pm · Mom · X0 call · skipped: quiet hours". */
export function stepLine(s: { at: number; rung: StepRung; channel: StepChannel; state: StepState; seen: number | null; who: string; tz: number; why?: string | null }): string {
  const clock = clockAt(s.at, s.tz);
  const what = s.rung === "tell" ? "Told"
    : s.rung === "loud" && s.channel === "push" ? "Louder notification"
    : CHANNEL_WORDS[s.channel] ?? "Notification";
  const seen = s.seen !== null ? ` ${clockAt(s.seen, s.tz)}` : "";
  let state: string;
  switch (s.state) {
    case "sent": state = "sent"; break;
    case "failed": state = "didn't go"; break;
    case "opened": state = `opened${seen}`; break;
    case "answered": state = "answered"; break;
    case "no_answer": state = "no answer"; break;
    default: {
      const why = s.why ?? "";
      // A family member's louder steps wait for their own yes (Allow on the follow page): "not allowed yet".
      state = why === "no_optin" ? "not allowed yet" : `skipped${WHY_WORDS[why] ? `: ${WHY_WORDS[why]}` : ""}`;
    }
  }
  return [clock, s.who, what, state].filter(Boolean).join(" · ");
}

/** The row's grey line on the asker's Plan for an open or just-closed follow ("Mom · not done yet", "Mom said done"). */
export function followLine(o: { state: FollowState; holder: string; holderIsAsker: boolean; must: boolean; doneBy: string | null }): string {
  const H = firstName(o.holder);
  switch (o.state) {
    case "done": return o.doneBy ? `${firstName(o.doneBy)} said done` : "Done";
    case "open": return o.holderIsAsker ? (o.must ? "Must not miss · not done yet" : "Not done yet") : `${H} · not done yet`;
    case "snoozed": return o.holderIsAsker ? "Later" : `${H} · later`;
    case "told": return o.holderIsAsker ? "Not done yet · told the family" : `${H} hasn't said done`;
    case "nobody": return "Nobody can do it";
    case "missed": return o.holderIsAsker ? "Not done" : `${H} · not done`;
    case "dropped": return "Not this time";
  }
}

/** The day a follow's caps count on (the follow's offset). */
export const capDay = (now: number, tz: number): string => dayOf(now, tz);
/** The whole server's caps count on the UTC day. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);
export { DAY, MIN };
