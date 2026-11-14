/**
 * THE PRE-RING CHECK, AND WHAT WAITS (docs: perms2 §4.1, §5.3). Two questions, asked of the phone itself about 30 seconds
 * before a Plan Ease call would ring, and only of a phone whose person turned one of them on:
 *
 *   driving   Motion & Fitness, read on the phone: an `automotive` activity in the last 3 minutes. "Wait while I'm driving"
 *   focus     whether a Focus (iPhone's own X0 Bot Focus Filter) or Do Not Disturb (Android) is on. "Hold calls during a Focus"
 *
 *   askCheck(...)          one silent push to the phones whose binary says CallCheck1, then a wait of `waitMs` for the answer
 *   answerCheck(...)       POST /v1/botsapp/plan/calls/:id/check hands the answer back here (routes/bots/planCallCheck.ts)
 *   holdOf(...)            PURE: ring, skip or hold, from the answer and what the call is about
 *   holdCall(...)          what waits, and the notice that goes instead when the wait is over
 *   focusEnded(...)        the Focus ended: ONE notice for everything that waited, and the list is cleared
 *
 * WHAT COMES BACK IS TWO WORDS. "driving" or "not driving"; "a Focus is on" or not. Never where the person is, never which
 * Focus, never a speed, a place or a time finer than the call it was asked for. Nothing of the answer is stored: it lives in
 * this server's memory for the seconds the call is being placed, and the hold list keeps only a push key and its words.
 *
 * NO ANSWER MEANS RING, ALWAYS. A silent push is best effort: it never arrives after a force quit, and it may not arrive at
 * all. So a phone that says nothing in `waitMs` gets the call exactly as it does today — the check can only ever hold a call
 * back on a clear yes, never cause one to be missed.
 *
 * THE HOLD LIST IS THIS SERVER'S MEMORY, on purpose and not by accident: it holds at most a push key and words that were
 * already going to that phone, for an hour at most, and a restart loses the wait — after which the person's next page read
 * shows the item on their Plan, where it was all along. Nothing of a person is kept anywhere by this file.
 *
 * Nothing here reaches an AI service: the answers are read by this file and by `planCall.ts` alone.
 */
import { randomUUID } from "node:crypto";
import type { PushMessage } from "../push/expo.js";

/** The data push's own kind, which the phone's background task switches on (F:src/notifications/backgroundCore.ts). */
export const CHECK_KIND = "plan_call_check";
/** The token cap (push/tokens.ts PUSH_CAPS) a binary must have said for the check to be asked of it at all. */
export const CHECK_CAP = "CallCheck1";
/** How long the server waits for the answer, unless the knob says otherwise. */
export const CHECK_WAIT_MS = 20_000;
/** A held call is looked at again this often, and let go as a notice after this long. */
export const HOLD_RECHECK_MS = 10 * 60_000;
export const HOLD_MAX_MS = 60 * 60_000;

/** What one check asks for. */
export type CheckWant = "driving" | "focus";
/** What the phone answered. A word left out is "the phone did not say", which is never a reason to hold a call. */
export interface CheckAnswer { driving?: boolean; focus?: boolean }

// ------------------------------------------------------------------ the one pure decision

/**
 * What the call is about, as the decision needs it: a leave-by is the one SKIPPED while driving (the person is already on
 * their way), and a must-not-miss item rings through a Focus or a busy calendar block, as Time Sensitive does today.
 */
export interface CheckAbout { source: "leave" | "due" | "follow" | "item"; must?: boolean }
/**
 * Is the person busy in their own calendar right now (botsBots/planBusy.ts), from the busy times they switched on? And, for
 * a Focus, which of the filter's two choices they picked (`plan_prefs.focus.hold`, docs: perms2 §4.2).
 */
export interface CheckState extends CheckAnswer { inBlock?: boolean; hold?: "calls" | "callsAndPings" }

/**
 * RING, SKIP, NOTICE OR HOLD. The whole decision, in one pure function, so the words of the cards can be checked against it:
 *
 *   nothing said       ring. A silent push is best effort (above), so a phone that says nothing gets the call it gets today
 *   driving, leave-by  skip, with no notice either: they are already on their way, and a ping about leaving is worth nothing
 *   driving, else      hold: looked at again every 10 minutes, and sent as a notice after an hour
 *   must-not-miss      ring, through a Focus and through a busy block alike (perms2 §2.3: "a must-not-miss item still rings")
 *   a Focus or a block, a leave-by or a bill due today   notice: it arrives as an ordinary notification instead of a call
 *   a Focus whose filter says "calls and other pings", a leave-by or a bill due today   hold: the reminder waits too, and the
 *                      one end-of-Focus notice lists it. That is the whole difference the filter's second choice makes
 *                      (FOCUS.holdAll), and it is a choice the person made in Settings; a busy calendar block is not, so a
 *                      block still lets the reminder through as a notice
 *   a Focus or a block, anything else                    hold: it waits, and one notice lists what waited when the Focus ends
 */
export function holdOf(state: CheckState, about: CheckAbout): "ring" | "skip" | "notice" | "hold" {
  if (state.driving === true) return about.source === "leave" ? "skip" : "hold";
  if (state.focus === true || state.inBlock === true) {
    if (about.must === true) return "ring";
    if (about.source === "leave" || about.source === "due") {
      return state.focus === true && state.hold === "callsAndPings" ? "hold" : "notice";
    }
    return "hold";
  }
  return "ring";
}

/** Why a call was not placed, for the log line and for `planCall.ts`'s own reasons. Never who or what. */
export const holdWhy = (d: "skip" | "notice" | "hold", state: CheckState): string =>
  d === "skip" ? "already on the way" : state.driving === true ? "driving" : state.focus === true ? "a focus is on" : "busy in their calendar";

// ------------------------------------------------------------------ asking the phone

/** One wait, while it is out. Nothing of it is stored. */
interface Pending { userId: string; want: CheckWant[]; settle: (a: CheckAnswer) => void; at: number }
const pending = new Map<string, Pending>();

/** What `askCheck` needs of the push engine, so a test can hand in two functions. */
export interface CheckPusher {
  devicesWith(userId: string, platform: "ios" | "android", cap: string, now?: number): Promise<Array<{ token: string; locale: string | null }>>;
  sendData(messages: PushMessage[]): Promise<unknown>;
}

/**
 * The silent push itself: `data` and nothing else, so nothing is ever drawn by the notification system. `call` is the check's
 * own id, which is also the last part of the route the phone answers on (`/v1/botsapp/plan/calls/<call>/check`): the call's own
 * row does not exist yet — this is what decides whether it ever will.
 */
export function checkPush(token: string, platform: "ios" | "android", o: { call: string; want: CheckWant[] }): PushMessage {
  const data = { kind: CHECK_KIND, call: o.call, want: o.want };
  return {
    to: token,
    title: "", body: "",
    // iOS: the existing remote-notification background mode, which Apple requires at priority 5. Android: data only, high, so
    // FCM wakes the background task that answers.
    ...(platform === "ios" ? { contentAvailable: true as const, priority: "normal" as const } : { dataOnly: true as const, priority: "high" as const }),
    // A check is worth nothing a minute later: the call it was for has rung or has not.
    ttl: 60,
    collapseId: `${CHECK_KIND}:${o.call}`,
    tag: CHECK_KIND,
    data,
  };
}

/**
 * Asks the phone, and waits. Empty when there is no phone that can answer, when the push could not be sent, or when nothing
 * came back in time — all of which mean "ring as today".
 */
export async function askCheck(o: {
  userId: string;
  want: CheckWant[];
  push: CheckPusher;
  waitMs?: number;
  now?: number;
  /**
   * WHAT EACH PLATFORM IS ASKED, WHEN THE TWO DIFFER. A feature whose Android half is still off must not be asked of an
   * Android phone — every 8.9.1 Android binary declares `CallCheck1` (Focus is always live there), so without this the
   * driving check went to Android phones whose server switch was off, and their answer held calls. A platform whose list
   * comes back empty is sent nothing at all. Left out, every phone is asked `want`, as before.
   */
  wantFor?: (p: "ios" | "android") => CheckWant[];
  /** Tests: the id to mint instead of a fresh uuid. */
  id?: string;
}): Promise<CheckAnswer> {
  if (!o.want.length) return {};
  const wantFor = (p: "ios" | "android"): CheckWant[] => (o.wantFor ? o.wantFor(p).filter((w) => o.want.includes(w)) : o.want);
  const now = o.now ?? Date.now();
  const phones = await Promise.all([
    wantFor("ios").length ? o.push.devicesWith(o.userId, "ios", CHECK_CAP, now).catch(() => []) : Promise.resolve([]),
    wantFor("android").length ? o.push.devicesWith(o.userId, "android", CHECK_CAP, now).catch(() => []) : Promise.resolve([]),
  ]);
  const messages: PushMessage[] = [];
  const id = o.id ?? randomUUID();
  // Only what was actually asked of a phone is read back: a word nobody was asked is dropped by `answerCheck`.
  const asked = new Set<CheckWant>();
  (["ios", "android"] as const).forEach((platform, i) => {
    const want = wantFor(platform);
    if (!want.length) return;
    for (const p of phones[i] ?? []) {
      messages.push(checkPush(p.token, platform, { call: id, want }));
      for (const w of want) asked.add(w);
    }
  });
  if (!messages.length) return {};
  const waitMs = Math.max(1_000, Math.min(60_000, o.waitMs ?? CHECK_WAIT_MS));
  const answer = new Promise<CheckAnswer>((resolve) => {
    let done = false;
    const settle = (a: CheckAnswer) => { if (!done) { done = true; pending.delete(id); resolve(a); } };
    pending.set(id, { userId: o.userId, want: [...asked], settle, at: now });
    const t = setTimeout(() => settle({}), waitMs);
    t.unref?.();
  });
  try { await o.push.sendData(messages); } catch { pending.get(id)?.settle({}); }
  return answer;
}

/**
 * The phone's answer, from its own route. True when a wait was still out for it: a late answer, or one for a call this server
 * never asked about, is dropped — it has nowhere to go and nothing to change.
 */
export function answerCheck(userId: string, id: unknown, ans: CheckAnswer): boolean {
  const p = typeof id === "string" ? pending.get(id) : undefined;
  if (!p || p.userId !== userId) return false;
  p.settle({
    ...(p.want.includes("driving") && typeof ans.driving === "boolean" ? { driving: ans.driving } : {}),
    ...(p.want.includes("focus") && typeof ans.focus === "boolean" ? { focus: ans.focus } : {}),
  });
  return true;
}

/** Tests: nothing out. */
export function resetChecksForTests(): void {
  for (const [, p] of pending) p.settle({});
  pending.clear();
  held.length = 0;
}

// ------------------------------------------------------------------ what waits

/** One held call: the words that were going to the phone, and how to send them as an ordinary notice instead. */
interface Held {
  userId: string;
  /** The reason it is holding, so a Focus ending lets go of exactly the ones it holds. */
  why: "driving" | "focus";
  at: number;
  checkedAt: number;
  /** Sends it as a notice now. Never throws. */
  notice: () => Promise<unknown>;
  /** One line for the end-of-Focus notice: "Pay the electricity bill". Already lock-safe (planSafe.ts did that). */
  line: string;
}
const held: Held[] = [];

/** What waits, and the notice that goes when the wait is over. At most 20 a person: a 21st simply goes as a notice now. */
export function holdCall(o: { userId: string; why: "driving" | "focus"; line: string; notice: () => Promise<unknown>; now?: number }): "held" | "sent" {
  const now = o.now ?? Date.now();
  const mine = held.filter((h) => h.userId === o.userId).length;
  if (mine >= 20) { void o.notice().catch(() => undefined); return "sent"; }
  held.push({ userId: o.userId, why: o.why, at: now, checkedAt: now, notice: o.notice, line: o.line });
  return "held";
}

/** How many are waiting for one person (tests, and the end-of-Focus notice's count). */
export const heldFor = (userId: string): number => held.filter((h) => h.userId === userId).length;

/**
 * THE FOCUS ENDED: everything it was holding goes now, as ONE notice (the card promises "when the Focus ends, one notice lists
 * what waited"), and the list is cleared. A single held thing goes as its own notice instead, which says more.
 */
export async function focusEnded(userId: string, now = Date.now(), o: { summary?: (userId: string, lines: string[]) => Promise<unknown> } = {}): Promise<number> {
  const mine: Held[] = [];
  for (let i = held.length - 1; i >= 0; i--) {
    const h = held[i]!;
    if (h.userId === userId && h.why === "focus") { mine.unshift(h); held.splice(i, 1); }
  }
  if (!mine.length) return 0;
  if (mine.length === 1) { await mine[0]!.notice().catch(() => undefined); return 1; }
  const summary = o.summary ?? waitedSummary;
  await summary(userId, mine.map((h) => h.line)).catch(() => undefined);
  void now;
  return mine.length;
}

/** How the one end-of-Focus notice is sent. `routes/bots/planCalls.ts` wires Plan Ease's own sender in at boot. */
let waitedSummary: (userId: string, lines: string[]) => Promise<unknown> = async () => undefined;
export function setWaitedSummary(fn: ((userId: string, lines: string[]) => Promise<unknown>) | null): void {
  waitedSummary = fn ?? (async () => undefined);
}

/** The one notice's words: "3 things waited while your Focus was on" / "Pay the electricity bill, and 2 more". */
export function waitedWords(lines: string[]): { title: string; body: string } {
  const n = lines.length;
  return {
    title: `${n} things waited`,
    body: `${lines[0] ?? "They're on your Plan"}${n > 1 ? `, and ${n - 1} more` : ""}. Your Focus is over.`,
  };
}

/**
 * ONE PASS OF THE WAIT (every minute, from `startHoldSweeper`): a held call is looked at again after 10 minutes and let go as a
 * notice after an hour, whatever the phone says by then. A driving hold is let go the same way; `focusEnded` is what releases a
 * Focus's own early.
 */
export type HeldRecheck = (h: { userId: string; why: "driving" | "focus" }) => Promise<CheckAnswer>;

export async function sweepHeld(now: number, o: { recheck?: HeldRecheck } = {}): Promise<number> {
  let sent = 0;
  for (let i = held.length - 1; i >= 0; i--) {
    const h = held[i]!;
    const old = now - h.at >= HOLD_MAX_MS;
    let free = old;
    // WITH NO WAY TO ASK AGAIN, THE HOLD STANDS until HOLD_MAX_MS. Reading a missing answer as "not driving, no Focus" freed
    // every hold at its first 10-minute look, which broke the row's own promise that the rest waits until the Focus ends.
    if (!old && o.recheck && now - h.checkedAt >= HOLD_RECHECK_MS) {
      h.checkedAt = now;
      // Asked again: still driving (or still in a Focus) keeps it waiting.
      const ans = await o.recheck(h).catch(() => ({} as CheckAnswer));
      free = h.why === "driving" ? ans.driving !== true : ans.focus !== true;
    }
    if (!free) continue;
    held.splice(i, 1);
    await h.notice().catch(() => undefined);
    sent += 1;
  }
  return sent;
}

const SWEEP_EVERY_MS = 60_000;

/** A pass every minute, never two at once. Returns the way to stop. */
export function startHoldSweeper(o: {
  everyMs?: number;
  now?: () => number;
  recheck?: HeldRecheck;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
} = {}): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const sent = await sweepHeld((o.now ?? Date.now)(), o.recheck ? { recheck: o.recheck } : {});
      if (sent) o.log?.info({ sent }, "[calls] held calls sent as notices");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "[calls] held call sweep failed");
    } finally {
      busy = false;
    }
  };
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}
