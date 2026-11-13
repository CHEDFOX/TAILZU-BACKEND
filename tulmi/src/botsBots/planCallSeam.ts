/**
 * THE SEAM BETWEEN THE CALL (planCall.ts, routes/bots/planCalls.ts, privacy/aiConsent.ts) AND THE CALL JUDGE (planCallJudge.ts,
 * routes/bots/planCallJudge.ts; docs/plan-call-judge.md). Written once, verbatim from the realtime spec §11.9; changed only by both
 * sides together. No imports: either side compiles against it alone.
 *
 *   ItemSeed                                   what a judged call knows (plan_calls.seed for source "item"); the server's own, never in a push
 *   CallRinger, setCallRinger, callRinger      planCall.ts offers ringItem; the judge's tick calls it at the judged moment
 *   CallJudge, setCallJudge, callJudge         the judge offers verdictFor; planCall.ts reads it in hook, ring, answer and the live prepare
 *   onAiConsentOff, aiConsentWentOff           run when a person takes back their AI yes (aiConsent.ts calls the second)
 */

/** A judged call's seed. `item` is the Plan Ease item of this start ("pe:<eventRef>:<day>" or "pt:<taskId>", widgets/items.ts). */
export interface ItemSeed {
  source: "item";
  item: string;
  kind: "event" | "todo" | "due" | "wait";
  /** Events: the row id, or "<id>@<day>" for one start of a series. */
  eventId?: string;
  /** To-dos, bills and waits. */
  taskId?: string;
  /** The day of `at`, "YYYY-MM-DD", in `tz`. */
  day: string;
  /** The offset its words are written in (minutes east of UTC). */
  tz: number;
  /** The raw title (server only). */
  title: string;
  /** "" when none. */
  place: string;
  /** The item's own time: an event's start; a to-do's or bill's due time, or 10:00 on its day when it has none. */
  at: number;
  allDay: boolean;
  /** Bills: who it is paid to, and whether it has a safe pay link; "" and false otherwise. */
  payee: string;
  pay: boolean;
  /** Must-not-miss, as the person set it or the rules decide (planFollowWords.ts effectiveMust). */
  must: boolean;
  /** Minutes before `at` that this call rings (0: at the item's time). */
  lead: number;
  /** The judge's one-line reason, at most 160 characters: context for the call's bot; never said word for word, never in a push or a log. */
  why: string;
}

/** Why a ring was not placed: planCall.ts ring()'s reasons, and one that only ringItem gives. */
export type RingNone =
  | "off" | "no_phone" | "desk" | "called" | "quiet" | "busy" | "too_soon" | "not_sent"
  | "item_recent";  // a call for the same item rang in the last 60 minutes, whatever rang it

export interface CallRinger {
  /**
   * Rings now for a judged item, with every check a follow-through ring has (the Calls switch and flag, a phone that takes calls, no
   * desk in use, this key not called already, the person's own say for "plan_call": Calls off and quiet hours, one call at a time, the
   * 15-minute gap) except the 3 a day, which a judged ring skips and does not count toward; then item_recent. There is no cap on
   * judged rings in a day: everything the AI judges necessary gets the call. `key`
   * becomes plan_calls.source_key (unique per person); `line` and `more` are the ring's and the missed call's lock-safe words. Never throws.
   */
  ringItem(userId: string, seed: ItemSeed, o: { key: string; line: string; more: string; now?: number }): Promise<{ id: string } | { none: RingNone }>;
}

/** The judge's say about one item. */
export interface JudgeVerdict {
  call: boolean;
  at: "leave_by" | "due" | `before:${number}`;
  why: string;
}

export interface CallJudge {
  /**
   * The current verdict for the item behind `item` ("pe:<eventRef>:<day>", "pt:<taskId>", or "pf:<followId>:<n>", which it follows to
   * the followed item), or null: the judge is off for this person, they have no AI yes, or the item was never judged. At most one
   * indexed read; never throws (null on any error).
   */
  verdictFor(userId: string, item: string): Promise<JudgeVerdict | null>;
}

let ringer: CallRinger | null = null;
let judge: CallJudge | null = null;
const offListeners = new Set<(userId: string) => void | Promise<void>>();

/** routes/bots/planCalls.ts installs planCalls() at boot, and null on close. */
export function setCallRinger(r: CallRinger | null): void { ringer = r; }
export function callRinger(): CallRinger | null { return ringer; }

/** routes/bots/planCallJudge.ts installs the judge at boot, and null on close. */
export function setCallJudge(j: CallJudge | null): void { judge = j; }
export function callJudge(): CallJudge | null { return judge; }

/** Run when a person takes back their AI yes. Returns the way to take the listener away. */
export function onAiConsentOff(fn: (userId: string) => void | Promise<void>): () => void {
  offListeners.add(fn);
  return () => { offListeners.delete(fn); };
}

/** privacy/aiConsent.ts setAiConsent(user, false): every listener, each on its own; one that throws never stops the others. */
export async function aiConsentWentOff(userId: string): Promise<void> {
  await Promise.all([...offListeners].map(async (fn) => { try { await fn(userId); } catch { /* the consent write stands */ } }));
}
