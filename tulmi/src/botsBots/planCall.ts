/**
 * "X0 IS CALLING": THE SERVICE (BOT_CALLS; docs/plan-ease.md "Calls"). A leave-by or a bill due today, for a person with Calls on, rings
 * their phone instead of the push: an ordinary notification titled "<Name> is calling" with Answer and Not now, our own ringtone on an
 * iPhone that has it, then "Missed call from <Name>" if nobody answered. Answer opens the call screen (screens/bots/planCall.ts), where
 * Plan Ease speaks first and the person can talk back.
 *
 *   hook                  asked by the push engine before a leave-by or a bill due today goes (push/engine.ts setCallHook): rings the
 *                         phones that take calls, or says why not (and the push goes the existing way)
 *   ring(user, seed, o)   follow-through's call step (planFollow.ts): the same checks and the same ring, with no push of its own; says
 *                         why not ({ none }) and the ladder carries on
 *   closeFor(user, key)   a followed item said done: its ringing call ends (no ring 2, no missed call)
 *   advance(id)           a call's next step, from its timers and from the sweep: ring 2 at +23 s, the missed call at +45 s (both only to
 *                         the phones that took ring 1), an answered call left alone 5 minutes ended
 *   start(log)            the sweep every 10 s (a restart loses the timers, never a step) and the 90-day clean-up
 *   view / answer / decline / end / back   the call screen's and the notification's doors (routes/bots/planCalls.ts)
 *   said / voiceText / prepare / voice     a reply kept for the voice route, and the voice made ahead so it plays at once
 *   ringItem(user, seed)  a call the call judge asked for, about one thing on the Plan (planCallSeam.ts): every follow-ring check
 *                         except the 3 a day, which a judged ring skips and does not count toward
 *   facts(user, row)      the call's facts for the chat and for the live session, with the judge's reason when it gave one
 *   addCost / markRt / noteActed / liveRows   what the realtime part writes on the row (planCallLive.ts)
 *   bumpCost(user, id, usd)   one more piece of what the call cost, for the parts with no running total: a turn and its voice
 *   missedSince(user, t)  missed calls for Activity (shell/feed.ts)
 *
 * Every change of state is a compare-and-swap on it (and on next_ms where a timer acts), so two servers or two timers never both act;
 * the pushes are claimed in push_log too ("plan_call:<id>:1"). Nothing here throws into the engine: a call that can't be placed lets
 * the push go as it always did. Logs say why, never who or what.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase, type AuthedUser } from "../auth/supabase.js";
import { ASSISTANT_NAME, nicknameOf } from "../experience/assistantName.js";
import { getPersonality } from "../personality/store.js";
import { hasAiConsent } from "../privacy/aiConsent.js";
import type { CallHook, PushEngine, RingPush } from "../push/engine.js";
import { pushEngine } from "../push/index.js";
import { knobsOf } from "../push/plan.js";
import { tokenHash, type Candidate, type Token } from "../push/store.js";
import { clockAt } from "../calendar/words.js";
import { deskHere } from "../live/notices.js";
import { getConfig } from "../config.js";
import { MemoryTable, SupabaseTable, type Table } from "./rows.js";
import { callsOn, planOn } from "./planSwitch.js";
import { GOODBYE_LEAD_SEC, inAllowList, maxSecOf } from "./planCallLiveWords.js";
import { callJudge, type ItemSeed, type RingNone } from "./planCallSeam.js";
import {
  CHECK_CAP, CHECK_WAIT_MS, askCheck, holdCall, holdOf, holdWhy, type CheckState, type CheckWant,
} from "./planCallCheck.js";
import { busyOverlap, planBusy } from "./planBusy.js";
import { focusHolding, planPrefs } from "./planPrefs.js";

/**
 * BUILD 8.9.1'S LAUNCH-DARK SWITCHES, read here rather than through `experience/bots/kit.ts` (which draws screens and must not
 * be reachable from the call engine). The same `PERM_*` the rows are drawn behind: with one off there is no row to turn the
 * hold off from, so nothing may be held behind it either (docs: perms2 §1 rule 3).
 */
const focusLive = (): boolean => getConfig().PERM_FOCUS === true;
const motionDriveLive = (): boolean => getConfig().PERM_MOTION_DRIVE === true;
const calendarReadLive = (): boolean => getConfig().PERM_CALENDAR_READ === true;
/** The driving check's Android half: its own switch AND the steps switch, because the grant behind both is the same one. */
export const motionDriveAndroidLive = (): boolean =>
  getConfig().PERM_MOTION_DRIVE_ANDROID === true && getConfig().PERM_MOTION_ANDROID === true;
/**
 * WHICH WORDS EACH PLATFORM IS ASKED (docs: perms2 §5.2, OWNER.md warning 1). Every 8.9.1 Android binary declares
 * `CallCheck1`, because the Focus half is always live there — so asking it `want` whole asked Android phones whether they
 * were driving while `PERM_MOTION_DRIVE_ANDROID` was off, and their answer held the call behind a row they cannot see.
 * The Focus word has no Android half, so it goes to both. A platform left with no word is sent no push at all.
 */
export const checkWantFor = (want: readonly CheckWant[]) => (p: "ios" | "android"): CheckWant[] =>
  (p === "android" && !motionDriveAndroidLive() ? want.filter((w) => w !== "driving") : [...want]);
import { youStore } from "../you/store.js";
import {
  BACK_MAX, CALLS, FRESH_MS, GRACE_MS, RING2_MS, RING_MS, SWEEP_MS, TALK_IDLE_MS, backsToday, blockedBy, callContext, cardOf,
  missedBody, openingLine, type CallSeed, type CallState, type CallView,
} from "./planCallWords.js";

export type { CallSeed, CallState, CallView } from "./planCallWords.js";
export { BACK_MAX, CALLS, DAY_MAX, FRESH_MS, GAP_MS, GRACE_MS, MAX_TURNS, RING2_MS, RING_MS, STALE_RING_MS, SWEEP_MS, TALK_IDLE_MS } from "./planCallWords.js";

/** The iPhone's ringtone, as a phone with the BotRingtone cap installed it in its app group's Library/Sounds. */
export const RINGTONE = "x0_ring_1.wav";
/** The token caps (push/tokens.ts PUSH_CAPS): this JS takes calls; this iPhone has the ringtone. */
export const CALL_CAP = "BotCall";
export const RINGTONE_CAP = "BotRingtone";
const TIME_SENSITIVE_CAP = "PushTimeSensitive";

const DAY = 24 * 60 * 60_000;
/** Calls are kept this long, then the clean-up deletes them. */
const KEEP_MS = 90 * DAY;
/** Spoken replies kept per call for the voice route. */
const TURNS_KEPT = 12;
/** Voice made ahead is kept this long, and this many at most (one server's memory). */
const VOICE_KEEP_MS = 2 * 60_000;
const VOICE_MAX = 200;
/** A judged ring is not placed when a call about the same item rang this recently, whatever rang it. */
export const ITEM_RECENT_MS = 60 * 60_000;

// ------------------------------------------------------------------ the row (migration 0079)

/** `rt`: the bot said it on a live call. MAX_TURNS is the turn call's own limit (planCallWords.ts turnCallTurns). */
export interface CallTurn { n: number; said: string; at: number; rt?: true }

export interface CallRow {
  [k: string]: unknown;
  id: string;
  user_id: string;
  source: "leave" | "due" | "follow" | "item";
  source_key: string;
  origin: "server" | "user";
  parent_id: string | null;
  state: CallState;
  why: "not_sent" | "timeout" | "hung_up" | "done" | "max_len" | "idle" | "consent" | null;
  name: string;
  item: string;
  seed: CallSeed;
  line: string;
  more: string;
  opening: string;
  turns: CallTurn[];
  tz_min: number;
  ring_at_ms: number;
  ring_until_ms: number;
  next_ms: number | null;
  rings: number;
  /** The phones that took ring 1, as hashes of their push tokens (push/store.ts tokenHash; the row never keeps a token). */
  rang: string[];
  answered_ms: number | null;
  ended_ms: number | null;
  // ---- the live part (migration 0085)
  /** The OpenAI id of the current or last live part. */
  rt_call: string | null;
  rt_state: "starting" | "live" | "stopped" | "ended" | "fell_back" | null;
  /** Live seconds used over every part: the hard length reads it. */
  rt_sec: number;
  /** What this call cost. A RECORD FOR THE OWNER, NEVER A CAP: no call is refused, shortened or stopped for money. */
  cost_usd: number;
  /** The call's own actions already done out loud: "paid", "done", "later", "cant". */
  acted: string[];
  /** It rang because the call judge said call: not counted toward the 3 a day, and not held to them. */
  judged: boolean;
}

const num = (v: unknown, d = 0): number => (v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** A row as it was read (bigints may come back as strings), in its own types. */
export function callRowOf(r: Record<string, unknown>): CallRow {
  return {
    ...(r as CallRow),
    turns: Array.isArray(r.turns) ? (r.turns as CallTurn[]) : [],
    rang: Array.isArray(r.rang) ? (r.rang as unknown[]).filter((x): x is string => typeof x === "string") : [],
    more: typeof r.more === "string" ? r.more : "",
    opening: typeof r.opening === "string" ? r.opening : "",
    tz_min: num(r.tz_min, 330), ring_at_ms: num(r.ring_at_ms), ring_until_ms: num(r.ring_until_ms), next_ms: numOrNull(r.next_ms),
    rings: num(r.rings, 1), answered_ms: numOrNull(r.answered_ms), ended_ms: numOrNull(r.ended_ms),
    parent_id: typeof r.parent_id === "string" ? r.parent_id : null, why: (r.why ?? null) as CallRow["why"],
    rt_call: typeof r.rt_call === "string" ? r.rt_call : null, rt_state: (r.rt_state ?? null) as CallRow["rt_state"],
    rt_sec: num(r.rt_sec), cost_usd: num(r.cost_usd),
    acted: Array.isArray(r.acted) ? (r.acted as unknown[]).filter((x): x is string => typeof x === "string") : [],
    judged: r.judged === true,
  };
}

/**
 * A NEW ROW AS THE INSERT SENDS IT. The live part's own columns (migration 0085) are left out while they still hold their defaults,
 * so a server carrying this code before that migration has run still rings: PostgREST refuses a column it does not know, place()
 * reads that as "failed", and every leave-by, bill due and follow-through call would stop without a word. markRt, addCost and
 * noteActed write those columns later, and they only ever run for a call that really went live or that the judge asked for.
 */
export function rowForInsert(row: CallRow): CallRow {
  const fresh = row.rt_call === null && row.rt_state === null && row.rt_sec === 0 && row.cost_usd === 0
    && row.acted.length === 0 && row.judged === false;
  if (!fresh) return row;
  const { rt_call: _c, rt_state: _s, rt_sec: _n, cost_usd: _u, acted: _a, judged: _j, ...rest } = row;
  void _c; void _s; void _n; void _u; void _a; void _j;
  return rest as CallRow;
}

/** The calls table, with the two reads across everyone: the sweep's due calls, and the clean-up. */
export interface CallTable extends Table<CallRow> {
  /** Calls still ringing or answered whose next step is due, soonest first. */
  due(now: number, limit: number): Promise<CallRow[]>;
  /** Deletes every call that rang before `before`. */
  clean(before: number): Promise<void>;
  /** Calls still marked starting or live, across everyone: the boot sweep hangs them up. */
  liveRows(limit: number): Promise<CallRow[]>;
}

function withSweep(t: Table<CallRow>, client: SupabaseClient | null): CallTable {
  const mem = t instanceof MemoryTable ? (t as MemoryTable<CallRow>) : null;
  const copy = (r: CallRow) => JSON.parse(JSON.stringify(r)) as CallRow;
  return {
    select: (m, o) => t.select(m, o), insert: (r) => t.insert(r), update: (m, p) => t.update(m, p), remove: (m) => t.remove(m), upsert: (r, k) => t.upsert(r, k),
    due: async (now, limit) => {
      if (mem) {
        return mem.rows.filter((r) => (r.state === "ringing" || r.state === "answered") && typeof r.next_ms === "number" && r.next_ms <= now)
          .sort((a, b) => Number(a.next_ms) - Number(b.next_ms)).slice(0, limit).map(copy);
      }
      if (!client) return [];
      const { data, error } = await client.from("plan_calls").select("*").in("state", ["ringing", "answered"]).not("next_ms", "is", null)
        .lte("next_ms", now).order("next_ms").limit(limit);
      if (error) throw new Error(`plan_calls due: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map(callRowOf);
    },
    clean: async (before) => {
      if (mem) { for (let i = mem.rows.length - 1; i >= 0; i -= 1) if (Number(mem.rows[i]!.ring_at_ms) < before) mem.rows.splice(i, 1); return; }
      if (!client) return;
      const { error } = await client.from("plan_calls").delete().lt("ring_at_ms", before);
      if (error) throw new Error(`plan_calls clean: ${error.message}`);
    },
    liveRows: async (limit) => {
      if (mem) return mem.rows.filter((r) => r.rt_state === "starting" || r.rt_state === "live").slice(0, limit).map(copy);
      if (!client) return [];
      const { data, error } = await client.from("plan_calls").select("*").in("rt_state", ["starting", "live"]).limit(limit);
      if (error) throw new Error(`plan_calls live: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map(callRowOf);
    },
  };
}

/** The server's: Supabase when the service client exists, else memory. */
export function callTable(): CallTable {
  const c = supabase();
  return withSweep(c ? new SupabaseTable<CallRow>(c, "plan_calls") : new MemoryTable<CallRow>(), c);
}
/** A fresh one in memory (tests). */
export const memoryCallTable = (): CallTable => withSweep(new MemoryTable<CallRow>(), null);

// ------------------------------------------------------------------ the service

/** Words read aloud (routes/writing/speak.ts speakFor), with what the read cost, or why not. */
export type CallAudio = { audio: Buffer; contentType: string; usd?: number } | { status: number; code: string; message: string };

export interface PlanCallsDeps {
  table?: CallTable;
  engine?: () => PushEngine | null;
  now?: () => number;
  /** The name it calls as: the person's own name for it (Keylessbord's "What you call it"), else X0. */
  name?: (userId: string) => Promise<string>;
  /** Whether the person agreed to AI (privacy/aiConsent.ts): the server voice and talking back. */
  consent?: (userId: string) => Promise<boolean>;
  /** "Wait while I'm driving" and "Hold calls during a Focus", as the person set them (you/settings.ts). */
  holds?: (userId: string) => Promise<{ driveWait: boolean; focusHold: boolean }>;
  log?: Log;
}
type Log = { info(o: object, m: string): void; warn(o: object, m: string): void };
const QUIET: Log = { info: () => undefined, warn: () => undefined };

/**
 * What the call service needs of the live session manager (botsBots/planCallLive.ts), wired at boot. Null everywhere a build has no
 * realtime call, and then every call behaves exactly as it did.
 */
export interface LiveCalls {
  /** The session is built ahead and kept for two minutes, so the phone's offer is answered at once. */
  prepare(user: AuthedUser, id: string): void;
  /** Ends the live part of this call (the call itself may stay answered). */
  stop(id: string, why: string): Promise<void>;
  /** The turn call is taking over: the live part closes and writes its total, before the turn puts anything more on the row. */
  fellBack(userId: string, id: string): Promise<void>;
  /** Every live call of this person ends now (they took their AI permission back). */
  stopFor(userId: string): Promise<void>;
  /** At boot: every row another process left marked live is hung up. */
  sweepOrphans(): Promise<void>;
  /** Whether this call is live on this process right now. */
  isLive(id: string): boolean;
}

/** The answer route's reply (section 1.7 of the contract). */
export type AnswerOut =
  | { state: "answered"; opening: string; voice: string | null; answeredAt: number | null; fresh: boolean }
  | { state: Exclude<CallState, "answered"> };

const defaultName = async (userId: string): Promise<string> =>
  nicknameOf(await getPersonality({ id: userId } as AuthedUser).catch(() => null)) ?? ASSISTANT_NAME;

/** The phones a call may ring: their JS takes calls; with needTimeSensitive, an iPhone also needs the entitlement. */
export function callTokens(tokens: readonly Token[], needTimeSensitive: boolean): Token[] {
  return tokens.filter((t) => !!t.caps?.includes(CALL_CAP) && (!needTimeSensitive || t.platform !== "ios" || t.caps.includes(TIME_SENSITIVE_CAP)));
}

/**
 * The phones that took this call's first ring, among `tokens`. Ring 2 and the missed call go only to them: a phone whose ring-1 ticket failed
 * was given the reminder's own push instead, and must not then be rung and told it missed the call too. Until ring 1 is on the row (another
 * server's ring still on its way, or a write that failed), every one of them, as before.
 */
export function rangAmong(row: Pick<CallRow, "rang">, tokens: readonly Token[]): Token[] {
  if (!row.rang.length) return [...tokens];
  const took = new Set(row.rang);
  return tokens.filter((t) => took.has(tokenHash(t.token)));
}

export class PlanCalls {
  readonly table: CallTable;
  private readonly engine: () => PushEngine | null;
  private readonly now: () => number;
  private readonly name: (userId: string) => Promise<string>;
  private readonly consent: (userId: string) => Promise<boolean>;
  private readonly holds: (userId: string) => Promise<{ driveWait: boolean; focusHold: boolean }>;
  private log: Log;
  /** What the call's voice route reads aloud and the note of how a call began: the server's chat and voice (routes/bots/planCalls.ts). */
  private chat: { note(userId: string, slug: string, text: string, o?: { quiet?: boolean }): Promise<void> } | null = null;
  private speak: ((user: AuthedUser, text: string) => Promise<CallAudio>) | null = null;
  /** The realtime session manager, when this build has one (routes/bots/planCalls.ts wires it). */
  private live: LiveCalls | null = null;
  private readonly voices = new Map<string, { at: number; audio: Promise<CallAudio> }>();
  /** The cost writes of one call, one after another (bumpCost). */
  private readonly bumps = new Map<string, Promise<void>>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastClean = 0;

  constructor(d: PlanCallsDeps = {}) {
    this.table = d.table ?? callTable();
    this.engine = d.engine ?? pushEngine;
    this.now = d.now ?? (() => Date.now());
    this.name = d.name ?? defaultName;
    this.consent = d.consent ?? hasAiConsent;
    // Each hold is the person's own switch AND the server's own, live (docs: perms2 §1 rule 3). A switch the server turns off
    // takes its row off the screen, so a hold still acting behind it would be one the person could no longer turn off.
    this.holds = d.holds ?? (async (userId) => {
      const n = (await youStore().getSettings(userId).catch(() => null))?.notify;
      return { driveWait: n?.driveWait === true && motionDriveLive(), focusHold: n?.focusHold === true && focusLive() };
    });
    this.log = d.log ?? QUIET;
  }

  /** The chat that keeps how a call began, and the voice that reads it (wired at boot: routes/bots/planCalls.ts). */
  wire(o: { chat?: PlanCalls["chat"]; speak?: PlanCalls["speak"]; live?: LiveCalls | null; log?: Log }): void {
    if (o.chat !== undefined) this.chat = o.chat;
    if (o.speak !== undefined) this.speak = o.speak;
    if (o.live !== undefined) this.live = o.live;
    if (o.log) this.log = o.log;
  }

  private none(why: string): null {
    this.log.info({}, `[calls] none: ${why}`);
    return null;
  }

  // ------------------------------------------------------------------ ringing

  /**
   * THE ENGINE ASKS HERE (push/engine.ts notify): a leave-by or a bill due today carrying its seed. The tokens it rang get no push; null
   * (or a ring no phone took) and the push goes the existing way. Never a call in quiet hours, with Calls or Plan Ease off, to a phone
   * whose JS doesn't take calls, while one is on, past 3 today, or within 15 minutes of the last. A reminder that called already never
   * calls again, and never pushes the phones it rang either.
   */
  readonly hook: CallHook = async ({ c, msg, payload, now, gate }) => {
    if (!msg.call || !callsOn()) return null;
    const seed = msg.call;
    try {
      const k = knobsOf(payload);
      if (!k.flag("push.plan_call.enabled", true)) return this.none("off");
      const tokens = callTokens(c.tokens, k.flag<boolean>("push.plan_call.needTimeSensitive", false));
      if (!tokens.length) return this.none("no phone takes calls");
      // This reminder called already: the same key again (a tick that couldn't mark it sent, another server just behind). Asked before
      // the say and the limits, because that very call trips them ("busy", "too soon") and the push would then go as well: when a call
      // replaces the push, the engine claims no push_log row for it, so this is what keeps the same reminder from reaching a phone twice.
      const had = await this.byKey(c.userId, msg.key);
      if (had) return this.again(had, tokens);
      // The reminder's own verdict first: a push that would go silent (quiet hours) or not at all never becomes a ring. Then the call's
      // own: the Calls switch, Plan Ease's, quiet hours (you/push.ts verdict).
      if ((await gate(msg.kind)) !== "send" || (await gate("plan_call")) !== "send") return this.none("what pings you");
      // The call judge's say about this very item (planCallSeam.ts). It can only ADD: a floor ring the judge wants is placed judged,
      // so the 3 a day neither stops it nor counts it. No verdict ever refuses a leave-by or a bill due today.
      const judged = await this.judged(c.userId, seed.item);
      // What goes INSTEAD of the call when the phone says the person is driving or in a Focus, and the reminder must wait: the
      // very push this hook was asked about, re-sent under its own key once the wait is over (botsBots/planCallCheck.ts).
      const held = c;
      const notice = async () => this.engine()?.notify(held.userId, {
        // The reminder's own kind, so its words, screen, category and the person's own say for it are all the ones it had.
        kind: msg.kind as Parameters<PushEngine["notify"]>[1]["kind"],
        key: `${msg.key}:held`, ...(msg.vars ? { vars: msg.vars } : {}), ...(msg.data ? { data: msg.data } : {}),
      }, this.now());
      const r = await this.placeCall(c, seed, { key: msg.key, line: String(msg.vars?.title ?? ""), more: String(msg.vars?.body ?? ""), tokens, now, judged, notice });
      if ("none" in r) {
        // "driving" (a leave-by, skipped) and "held" (it waits) both take the PUSH away too: the reminder is not a call now and
        // is not a notification now either. "notice" and every other reason let the push go exactly as it always did.
        if (r.none === "driving" || r.none === "held") {
          this.none(r.none);
          return { rang: new Set(c.tokens.map((t) => t.token)) };
        }
        return this.none(r.none);
      }
      // Another server got there between the look above and this insert.
      if ("taken" in r) return this.again(r.taken, tokens);
      // Only the phones that took the ring skip the push: one whose ticket failed still hears the reminder.
      return { rang: r.ok };
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, "[calls] none: failed");
      return null;
    }
  };

  /**
   * What the hook and ring() share once a call may ring: the limits (one at a time, 3 a day, 15 minutes apart), the row, ring 1, the
   * phones that took it, ring 2 and the missed call on their timers. `none` says why not; `taken` is a call another server placed first.
   */
  private async placeCall(c: Candidate, seed: CallSeed, o: { key: string; line: string; more: string; tokens: Token[]; now: number; judged?: boolean; notice?: () => Promise<unknown> }):
    Promise<{ row: CallRow; ok: ReadonlySet<string> } | { taken: CallRow } | { none: string }> {
    const now = o.now;
    const rows = (await this.table.select({ user_id: c.userId }, { order: "ring_at_ms", desc: true, limit: 20 })).map(callRowOf);
    const blocked = blockedBy(rows, now, seed.tz, { judged: !!o.judged });
    if (blocked) return { none: blocked };
    // THE PRE-RING CHECK (botsBots/planCallCheck.ts): is the person in a car, or in a Focus? Asked of the phone itself, and
    // only when they turned one of those on. No answer means ring, exactly as today.
    const check = await this.beforeRing(c, seed, { key: o.key, line: o.line, notice: o.notice, now });
    if (check) return check;
    const row: CallRow = {
      id: randomUUID(), user_id: c.userId, source: seed.source, source_key: o.key, origin: "server", parent_id: null, state: "ringing", why: null,
      name: (await this.name(c.userId).catch(() => ASSISTANT_NAME)) || ASSISTANT_NAME, item: seed.item, seed,
      line: o.line, more: o.more, opening: "", turns: [], tz_min: seed.tz,
      ring_at_ms: now, ring_until_ms: now + RING_MS, next_ms: now + RING2_MS, rings: 1, rang: [], answered_ms: null, ended_ms: null,
      rt_call: null, rt_state: null, rt_sec: 0, cost_usd: 0, acted: [], judged: !!o.judged,
    };
    const placed = await this.place(row);
    if (placed === "failed") return { none: "not_sent" };
    if (placed !== "placed") return { taken: placed.taken };
    const r = await this.sendRing(c, row, o.tokens, 1, 40, now).catch(() => null);
    if (!r?.ok.size) {
      await this.table.update({ id: row.id, user_id: row.user_id, state: "ringing" }, { state: "ended", why: "not_sent", next_ms: null, ended_ms: now }).catch(() => 0);
      return { none: "not_sent" };
    }
    // Ring 2 and the missed call follow only to the phones that took this one (rangAmong). A write that fails leaves it empty: then
    // every phone that takes calls, as before.
    await this.table.update({ id: row.id, user_id: row.user_id }, { rang: [...r.ok].map((t) => tokenHash(t)) }).catch(() => 0);
    this.later(row);
    this.log.info({}, "[calls] rang");
    return { row, ok: r.ok };
  }

  /**
   * FOLLOW-THROUGH'S CALL STEP (planFollow.ts): the same checks and steps as the hook, without any push of its own. Calls switched off
   * or the call flag off ("off"), no phone that takes calls ("no_phone"), a computer in use ("desk"), this climb called already
   * ("called"), What pings you says no (Calls off, quiet hours: "quiet"), or the limits ("busy", "day_max", "too_soon"). Never throws:
   * the ladder never assumes it rang.
   */
  async ring(userId: string, seed: Extract<CallSeed, { source: "follow" }>, o: { key: string; line: string; more: string; now?: number }): Promise<{ id: string } | { none: string }> {
    // Follow-through's own ring reads the verdict too: when the judge wants this item called, the 3 a day do not stop the ladder.
    return this.ringNow(userId, seed, o, { judged: await this.judged(userId, seed.item), where: "follow" });
  }

  /**
   * THE CALL JUDGE'S RING (planCallSeam.ts CallRinger): a call for one thing on the Plan, at the moment the judge picked. Every check
   * a follow-through ring has, EXCEPT the 3 a day, which a judged ring skips and does not count toward (the owner's answer: there are
   * no limits, everything the AI judges necessary gets the call). There is NO cap on judged rings in a day. The one guard of its own
   * is `item_recent`, so two calls never come about the same thing within the hour. Never throws.
   */
  readonly ringItem = async (userId: string, seed: ItemSeed, o: { key: string; line: string; more: string; now?: number }): Promise<{ id: string } | { none: RingNone }> => {
    const r = await this.ringNow(userId, seed, o, { judged: true, where: "judged" });
    return "id" in r ? r : { none: r.none as RingNone };
  };

  /** What ring() and ringItem() share: the checks, then the row, the ring and its timers. */
  private async ringNow(userId: string, seed: CallSeed, o: { key: string; line: string; more: string; now?: number },
    w: { judged: boolean; where: "follow" | "judged" }): Promise<{ id: string } | { none: string }> {
    try {
      if (!callsOn()) return { none: "off" };
      const engine = this.engine();
      if (!engine) return { none: "off" };
      const now = o.now ?? this.now();
      const c = await engine.candidate(userId, now);
      if (!c || !c.tokens.length) return { none: "no_phone" };
      const k = knobsOf(engine.configFor(c, now));
      if (!k.flag("push.plan_call.enabled", true)) return { none: "off" };
      if (deskHere(userId, now)) return { none: "desk" };
      const tokens = callTokens(c.tokens, k.flag<boolean>("push.plan_call.needTimeSensitive", false));
      if (!tokens.length) return { none: "no_phone" };
      if (await this.byKey(userId, o.key)) return { none: "called" };
      if ((await engine.gateFor(c, "plan_call", now)) !== "send") return { none: "quiet" };
      if (w.where === "judged") {
        const guard = await this.judgedGuards(userId, seed, now);
        if (guard) return { none: guard };
      }
      const r = await this.placeCall(c, seed, { key: o.key, line: o.line, more: o.more, tokens, now, judged: w.judged });
      if ("none" in r) return { none: r.none };
      if ("taken" in r) return { none: "called" };
      return { id: r.row.id };
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, `[calls] ${w.where} ring failed`);
      return { none: "not_sent" };
    }
  }

  /**
   * THE PRE-RING CHECK (docs: perms2 §4.1 and §5.3). Null means ring; anything else is the reason not to.
   *
   *   nothing turned on      no push, no wait, no change: this is every person until they turn one of the two rows on
   *   no phone with CallCheck1  the same: an older binary answers nothing, so nothing is asked of it
   *   no answer in 20 s      RING. A silent push never arrives after a force quit, and a check may simply not come back, so a
   *                          phone that says nothing gets the call it would have got before this code existed
   *   driving, a leave-by    skipped, and no notice either: they are already on their way
   *   driving, anything else held, looked at again every 10 minutes, and sent as a notice after an hour
   *   a Focus, must-not-miss RINGS. Time Sensitive breaks through a Focus today and keeps doing so
   *   a Focus, anything else held: it arrives as a notice instead of a call, and one notice lists what waited when it ends
   *
   * `notice` is how the reminder goes as an ordinary notification instead (the hook's own push, re-sent under its own key). A
   * ring with no push of its own (follow-through's ladder, the judge's) has none, and a hold there simply places no call.
   */
  private async beforeRing(c: Candidate, seed: CallSeed, o: { key: string; line: string; notice?: () => Promise<unknown>; now: number }): Promise<{ none: string } | null> {
    // A FOLLOW-THROUGH RING IS ALWAYS MUST-NOT-MISS. The ladder's call rung exists only for items the person marked must not
    // miss (planFollow.ts), and `ItemSeed` is the only seed shape with a `must` field — so without this a followed item was
    // held inside a Focus or a busy block, against "a must-not-miss item still rings" (perms2 §2.3).
    const must = seed.source === "follow" || ("must" in seed && seed.must === true);
    const state: CheckState = {};
    // The person's own busy times, if they turned "Plan around my calendar" on AND the switch is still live: a call inside a
    // block is a notice, not a ring (perms2 §2.3). One indexed read, and a failure means "not busy", which is today's
    // behaviour. Behind `calendarReadLive()` because a switch the server has turned off must stop holding calls back.
    if (calendarReadLive()) {
      try {
        const blocks = await planBusy().inRange(c.userId, o.now, o.now + 1);
        if (busyOverlap(blocks, o.now, o.now + 1, o.now)) state.inBlock = true;
      } catch { /* not busy, as far as we know */ }
    }
    const want: CheckWant[] = [];
    let holds = { driveWait: false, focusHold: false };
    try { holds = await this.holds(c.userId); } catch { /* no switches read: the check is simply not made */ }
    if (holds.driveWait) want.push("driving");
    if (holds.focusHold) {
      // THE FILTER ALREADY TOLD US, usually: iOS runs X0 Bot's Focus Filter when a Focus starts and when it ends, and that
      // post is what plan_prefs.focus holds (widgets/focus.ts). So the phone is asked only when nothing is on the row — which
      // is Android (Do Not Disturb, read at this moment) and the days before a phone's widgets token carries "focus.set".
      try {
        const row = await planPrefs().get(c.userId);
        // AN ANDROID ROW IS A SNAPSHOT, NOT A FEED. The iPhone's Focus Filter posts the END of a Focus itself, so a row it
        // wrote can be trusted for its 12 hours. Android only posts Do Not Disturb on Plan Ease page appear, so a row that
        // says `on` is stale the moment DND is switched off — and trusting it held calls for up to 12 hours after. A `dnd`
        // row is therefore never trusted on its own: the phone is asked at ring time, as it is when the row is empty.
        if (focusHolding(row?.focus, o.now) && row?.focus?.source !== "dnd") {
          state.focus = true;
          // Which of the filter's two choices they picked: "calls and other pings" holds the reminder too (perms2 §4.2).
          state.hold = row?.focus?.hold === "callsAndPings" ? "callsAndPings" : "calls";
        }
      } catch { /* nothing said */ }
      if (state.focus === undefined) want.push("focus");
    }
    const engine = this.engine();
    // Only a binary that said it answers these pushes is ever sent one.
    if (want.length && engine && c.tokens.some((t) => t.caps?.includes(CHECK_CAP))) {
      const waitMs = knobsOf(engine.configFor(c, o.now)).flag("push.plan_call.checkWaitMs", CHECK_WAIT_MS);
      try {
        const ans = await askCheck({ userId: c.userId, want, push: engine, waitMs, now: o.now, wantFor: checkWantFor(want) });
        if (ans.driving !== undefined) state.driving = ans.driving;
        if (ans.focus !== undefined) state.focus = ans.focus;
      } catch { /* no answer is a ring, as today */ }
    }
    const decided = holdOf(state, { source: seed.source, must });
    if (decided === "ring") return null;
    this.log.info({}, `[calls] not ringing: ${holdWhy(decided, state)}`);
    if (decided === "hold") {
      if (o.notice) {
        holdCall({ userId: c.userId, why: state.driving === true ? "driving" : "focus", line: o.line, notice: o.notice, now: o.now });
        return { none: "held" };
      }
      // NO PUSH OF ITS OWN (the ladder's call rung, the judge's), so there is nothing to send when the wait is over and
      // nothing is queued. Saying "held" here would have claimed a wait that did not exist and the rung would have vanished;
      // the reason goes back instead, and whatever rang it records the rung as not sent and climbs again on its own terms.
      return { none: state.driving === true ? "driving" : "focus" };
    }
    // Skipped: no call and no push either. A notice: no call, and the reminder's own push goes as it always did.
    return { none: decided === "skip" ? "driving" : "notice" };
  }

  /** The judged ring's one guard: a call about the same item rang in the last hour. There is no cap on judged rings in a day. */
  private async judgedGuards(userId: string, seed: CallSeed, now: number): Promise<"item_recent" | null> {
    const rows = (await this.table.select({ user_id: userId }, { order: "ring_at_ms", desc: true, limit: 40 })).map(callRowOf)
      .filter((r) => r.why !== "not_sent");
    if (rows.some((r) => r.item === seed.item && now - r.ring_at_ms < ITEM_RECENT_MS)) return "item_recent";
    return null;
  }

  /** Whether the call judge says this item is worth a call. Null, off, or a failure all mean "no change": today's ring, exactly. */
  private async judged(userId: string, item: string): Promise<boolean> {
    const v = await callJudge()?.verdictFor(userId, item).catch(() => null) ?? null;
    return v?.call === true;
  }

  /** The judge's one-line reason for this call, when it said to call. "" otherwise. Never said out loud word for word. */
  private async whyOf(userId: string, row: Pick<CallRow, "seed" | "item">): Promise<string> {
    if (row.seed.source === "item") return row.seed.why ?? "";
    const v = await callJudge()?.verdictFor(userId, row.item).catch(() => null) ?? null;
    return v?.call ? (v.why ?? "") : "";
  }

  /**
   * The call's facts, as the Plan Ease chat and the live session both read them (data, never instructions), with "Why it matters"
   * when the judge gave a reason. One indexed read at most.
   */
  async facts(userId: string, row: Pick<CallRow, "seed" | "item" | "opening" | "tz_min">): Promise<string> {
    return callContext(row.seed, row.opening, row.tz_min, await this.whyOf(userId, row));
  }

  /** A followed item said done: its call still ringing ends now (no ring 2, no missed call). Anything else stays as it is. */
  async closeFor(userId: string, sourceKey: string, now = this.now()): Promise<void> {
    const had = await this.byKey(userId, sourceKey).catch(() => null);
    if (!had || had.state !== "ringing") return;
    await this.table.update({ id: had.id, user_id: userId, state: "ringing" }, { state: "ended", why: "done", next_ms: null, ended_ms: now }).catch(() => 0);
  }

  /** The call this reminder (its push key) placed, if it placed one. */
  private async byKey(userId: string, sourceKey: string): Promise<CallRow | null> {
    const r = (await this.table.select({ user_id: userId, source_key: sourceKey }, { limit: 1 }))[0];
    return r ? callRowOf(r) : null;
  }

  /**
   * That reminder's call exists: the phones it rang get nothing more (every phone that takes calls while its ring is still on its way). A
   * ring that never left let the push go, and the push's own claim decides now.
   */
  private again(had: CallRow, tokens: readonly Token[]): { rang: ReadonlySet<string> } | null {
    if (had.why === "not_sent") return this.none("never sent");
    this.log.info({}, "[calls] none: called already");
    return { rang: new Set(rangAmong(had, tokens).map((t) => t.token)) };
  }

  /** "placed", taken already (that reminder's call exists), or "failed" (a missing table never swallows a reminder). */
  private async place(row: CallRow): Promise<"placed" | { taken: CallRow } | "failed"> {
    try {
      const had = await this.byKey(row.user_id, row.source_key);
      if (had) return { taken: had };
      await this.table.insert(rowForInsert(row));
      return "placed";
    } catch (err) {
      // A second server inserted it first: Supabase's error arrives as a plain message (rows.ts), and memory has no unique index.
      if (/duplicate key|unique constraint/i.test(String((err as Error)?.message ?? ""))) {
        const had = await this.byKey(row.user_id, row.source_key).catch(() => null);
        return had ? { taken: had } : "failed";
      }
      return "failed";
    }
  }

  private needTs(c: Candidate, now: number): boolean {
    const engine = this.engine();
    return !!engine && knobsOf(engine.configFor(c, now)).flag<boolean>("push.plan_call.needTimeSensitive", false);
  }

  /** A ring (1 or 2): "<Name> is calling", the reminder's line, our ringtone where installed, Time Sensitive where entitled. */
  private async sendRing(c: Candidate, row: CallRow, tokens: Token[], n: 1 | 2, ttlSec: number, now: number) {
    const engine = this.engine();
    if (!engine) return null;
    const k = knobsOf(engine.configFor(c, now));
    const vars = { name: row.name, line: row.line };
    const push: RingPush = {
      kind: "plan_call", periodKey: `plan_call:${row.id}:${n}`, tokens,
      title: k.label("push.plan_call.title", "{name} is calling", vars), body: k.label("push.plan_call.body", "{line}", vars),
      data: { call: row.id, state: "ringing", day: row.seed.day }, screenId: k.flag("push.plan_call.screenId", "bots.plan.call"),
      ttlSec, categoryId: k.flag("push.plan_call.category", "x0_call"), channelId: k.flag("push.plan_call.channelId", "calls"),
      priority: "high", collapseId: `call-${row.id}`,
      sound: (t) => (t.platform === "ios" && t.caps?.includes(RINGTONE_CAP) ? RINGTONE : "default"),
      level: (t) => (planOn("app") && t.platform === "ios" && t.caps?.includes(TIME_SENSITIVE_CAP) ? "time-sensitive" : undefined),
    };
    return engine.ring(c, push, now);
  }

  /** The missed call: no sound (the ring rang), quietly into the list on an iPhone, kept as long as the reminder would have been. */
  private async sendMissed(c: Candidate, row: CallRow, tokens: Token[], now: number) {
    const engine = this.engine();
    if (!engine) return null;
    const k = knobsOf(engine.configFor(c, now));
    const vars = { name: row.name, line: missedBody(row.line, row.more) };
    const push: RingPush = {
      kind: "plan_call_missed", periodKey: `plan_call_missed:${row.id}`, tokens,
      title: k.label("push.plan_call_missed.title", "Missed call from {name}", vars), body: k.label("push.plan_call_missed.body", "{line}", vars),
      data: { call: row.id, state: "missed", day: row.seed.day }, screenId: k.flag("push.plan_call_missed.screenId", "bots.plan.call"),
      ttlSec: this.missedTtlSec(row, k), categoryId: k.flag("push.plan_call_missed.category", "x0_call_missed"),
      channelId: k.flag("push.plan_call_missed.channelId", "calls_missed"), priority: "normal", collapseId: `call-${row.id}`,
      sound: () => null, level: (t) => (t.platform === "ios" ? "passive" : undefined),
    };
    return engine.ring(c, push, now);
  }

  /** The reminder's own expiry (push.<kind>.ttlMin): a missed leave-by is no use an hour on; a bill's lasts the day; a follow's an hour. */
  private missedTtlSec(row: CallRow, k: ReturnType<typeof knobsOf>): number {
    if (row.source === "follow") return Math.max(60, Math.round(k.flag("push.plan_follow.ttlMin", 60) * 60));
    const kind = row.source === "leave" ? "plan_leave" : "plan_due";
    return Math.max(60, Math.round(k.flag(`push.${kind}.ttlMin`, row.source === "leave" ? 20 : 8 * 60) * 60));
  }

  /** Ring 2 and the missed call, on time in this process; the sweep catches what a restart lost. */
  private later(row: CallRow): void {
    for (const at of [RING2_MS, RING_MS]) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void this.advance(row.id).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[calls] step failed"));
      }, at);
      t.unref?.();
      this.timers.add(t);
    }
  }

  /**
   * A call's next step, when it is due (the timers and the sweep both run this). Ringing: ring 2 while 5 s of the window remain, else
   * missed (a sweep that comes late after a restart never rings after the window), with the missed push unless its own expiry passed
   * too. Answered and left alone 5 minutes: ended.
   */
  async advance(id: string, now = this.now()): Promise<void> {
    const raw = (await this.table.select({ id }, { limit: 1 }))[0];
    if (!raw) return;
    const row = callRowOf(raw);
    if (row.next_ms === null || row.next_ms > now) return;
    if (row.state === "ringing") {
      const engine = this.engine();
      if (row.rings === 1 && row.next_ms < row.ring_until_ms && now < row.ring_until_ms - 5_000) {
        const won = await this.table.update({ id, state: "ringing", next_ms: row.next_ms }, { rings: 2, next_ms: row.ring_until_ms });
        if (!won || !engine) return;
        const c = await engine.candidate(row.user_id, now);
        if (!c) return;
        const tokens = rangAmong(row, callTokens(c.tokens, this.needTs(c, now)));
        if (!tokens.length) return;
        await this.sendRing(c, { ...row, rings: 2 }, tokens, 2, Math.max(1, Math.min(20, Math.floor((row.ring_until_ms - now) / 1000))), now);
        return;
      }
      const won = await this.table.update({ id, state: "ringing", next_ms: row.next_ms }, { state: "missed", next_ms: null, ended_ms: now });
      if (!won || !engine) return;
      const c = await engine.candidate(row.user_id, now);
      if (!c) return;
      if (now > row.ring_until_ms + this.missedTtlSec(row, knobsOf(engine.configFor(c, now))) * 1000) return this.quietly("missed, too late to say");
      const tokens = rangAmong(row, callTokens(c.tokens, this.needTs(c, now)));
      if (tokens.length) await this.sendMissed(c, row, tokens, now);
      return;
    }
    if (row.state === "answered") {
      if (this.live?.isLive(id)) await this.live.stop(id, "timeout").catch(() => undefined);
      await this.table.update({ id, state: "answered", next_ms: row.next_ms }, { state: "ended", why: "timeout", next_ms: null, ended_ms: now });
    }
  }

  private quietly(why: string): void { this.log.info({}, `[calls] ${why}`); }

  /** One pass of the sweep: every call whose step is due, then (once an hour) the 90-day clean-up. */
  async sweep(now = this.now()): Promise<number> {
    const due = await this.table.due(now, 100);
    for (const r of due) await this.advance(r.id, now).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[calls] step failed"));
    if (now - this.lastClean > 60 * 60_000) {
      this.lastClean = now;
      await this.table.clean(now - KEEP_MS).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[calls] clean-up failed"));
    }
    return due.length;
  }

  /** The sweep every 10 s, one pass at a time. Returns the stop (which also drops this process's timers). */
  start(log?: Log): () => void {
    if (log) this.log = log;
    // A restart leaves rows marked live that no socket holds any more: hang them up once, so OpenAI is not left talking to nobody.
    void this.live?.sweepOrphans().catch((err) => this.log.warn({ err: (err as Error)?.message }, "[calls] orphan sweep failed"));
    let busy = false;
    let warned = 0;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.sweep().catch((err) => {
        // A missing table (deploy before migration 0079): once an hour, not every 10 s.
        if (this.now() - warned > 60 * 60_000) { warned = this.now(); this.log.warn({ err: (err as Error)?.message }, "[calls] sweep failed"); }
      }).finally(() => { busy = false; });
    }, SWEEP_MS);
    timer.unref?.();
    return () => {
      clearInterval(timer);
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
    };
  }

  // ------------------------------------------------------------------ the screen's doors

  /** One of this person's calls; null for anyone else's, or none. */
  async get(userId: string, id: string): Promise<CallRow | null> {
    const r = (await this.table.select({ id, user_id: userId }, { limit: 1 }))[0];
    return r ? callRowOf(r) : null;
  }

  /** What the call screen draws (GET CALLS/:id). */
  async view(userId: string, id: string): Promise<CallView | null> {
    const row = await this.get(userId, id);
    if (!row) return null;
    const now = this.now();
    return {
      id: row.id, state: row.state, origin: row.origin, name: row.name, source: row.source, line: row.line, ringAt: row.ring_at_ms,
      missedClock: clockAt(row.ring_at_ms, row.tz_min), answeredAt: row.answered_ms, endedAt: row.ended_ms,
      late: row.state === "ringing" || (row.state === "missed" && now <= row.ring_until_ms + GRACE_MS),
      ai: await this.consent(userId).catch(() => false),
      rt: realtimeOn(userId, row),
      acted: row.acted,
      card: cardOf(row.seed, row.tz_min),
    };
  }

  /**
   * Answer: a ringing call, or a missed one inside the grace (Face ID, a slow launch), becomes answered; one already answered stays so.
   * `fresh`: this request answered it, nothing has been said yet, or it was answered under 10 s ago (a retry after a lost response): only
   * then does the screen speak. `talk` asks "Want me to do anything?" only when the screen can listen AND the person agreed to AI.
   */
  async answer(user: AuthedUser, id: string, talkAsked: unknown, rtAsked: unknown = false): Promise<AnswerOut | null> {
    let row = await this.get(user.id, id);
    if (!row) return null;
    const now = this.now();
    // A ring the sweep never got to (the server was down) is missed by now: settle it first, as the sweep would have.
    if (row.state === "ringing" && now > row.ring_until_ms + GRACE_MS) {
      await this.advance(id, now).catch(() => undefined);
      row = await this.get(user.id, id);
      if (!row) return null;
    }
    let fresh = false;
    if (row.state === "ringing" || (row.state === "missed" && now <= row.ring_until_ms + GRACE_MS)) {
      const won = await this.table.update({ id, user_id: user.id, state: row.state }, { state: "answered", answered_ms: now, next_ms: now + TALK_IDLE_MS });
      if (won) { fresh = true; row = { ...row, state: "answered", answered_ms: now, next_ms: now + TALK_IDLE_MS }; }
      else { row = await this.get(user.id, id); if (!row) return null; }
    }
    if (row.state !== "answered") return { state: row.state };
    const ai = await this.consent(user.id).catch(() => false);
    // A followed item's call never asks "Want me to do anything?": its Done, Later and Can't are on the screen.
    const talk = talkAsked === true && ai && row.source !== "follow";
    fresh = fresh || row.opening === "" || (row.answered_ms !== null && now - row.answered_ms < FRESH_MS);
    // A realtime call makes no voice ahead: the model speaks the opening itself over the live link, and voice/0 is made on demand
    // only if the call falls back. The live session is built now instead, so the phone's offer is answered at once.
    const rt = rtAsked === true && ai && realtimeOn(user.id, row);
    let opening = row.opening;
    if (fresh) {
      // The mild "Hello." belongs to the live call, which then follows whatever language the person speaks. A turn call — every
      // build without the realtime switch — opens on the moment itself, word for word as it always has.
      const line = openingLine(row.seed, { back: row.origin === "user", talk, now, tz: row.tz_min, hello: rt });
      if (line !== row.opening) {
        await this.table.update({ id, user_id: user.id }, { opening: line });
        if (ai) {
          if (!rt) this.prepare(user, id, 0, line);
          await this.chat?.note(user.id, "plan", line, { quiet: true }).catch(() => undefined);
        }
      }
      opening = line;
    }
    if (rt) this.live?.prepare(user, id);
    return { state: "answered", opening, voice: ai ? `${CALLS}/${id}/voice/0` : null, answeredAt: row.answered_ms, fresh };
  }

  /** Not now: a ringing call is declined (no ring 2, no missed call). Anything else stays as it is. Never fails: the button retries. */
  async decline(userId: string, id: string): Promise<{ ok: true; state: CallState | "gone" }> {
    const row = await this.get(userId, id);
    if (!row) return { ok: true, state: "gone" };
    if (row.state !== "ringing") return { ok: true, state: row.state };
    const won = await this.table.update({ id, user_id: userId, state: "ringing" }, { state: "declined", next_ms: null, ended_ms: this.now() });
    if (won) return { ok: true, state: "declined" };
    return { ok: true, state: (await this.get(userId, id))?.state ?? "gone" };
  }

  /** End call: an answered call ends; a ringing one is declined; anything else stays. Null: no such call of theirs. */
  async end(userId: string, id: string, why: NonNullable<CallRow["why"]> = "hung_up"): Promise<{ ok: true; state: CallState } | null> {
    const row = await this.get(userId, id);
    if (!row) return null;
    // The live part goes first: the person hung up, so nothing more should be heard or generated.
    if (this.live?.isLive(id)) await this.live.stop(id, why).catch(() => undefined);
    const now = this.now();
    if (row.state === "answered") {
      const won = await this.table.update({ id, user_id: userId, state: "answered" }, { state: "ended", why, next_ms: null, ended_ms: now });
      if (won) return { ok: true, state: "ended" };
    } else if (row.state === "ringing") {
      const won = await this.table.update({ id, user_id: userId, state: "ringing" }, { state: "declined", next_ms: null, ended_ms: now });
      if (won) return { ok: true, state: "declined" };
    } else {
      return { ok: true, state: row.state };
    }
    return { ok: true, state: (await this.get(userId, id))?.state ?? row.state };
  }

  /**
   * Call back: the person's own call, about the same thing, answered as it starts (it never rings, and the ring limits don't apply). A
   * call still ringing or on is that call. Null: no such call of theirs; "off": calls are switched off; "limit": they have made
   * BACK_MAX Call backs in this day already — the one limit a Call back has, so the button cannot be pressed into an endless string
   * of fresh calls, each with its own set of turns.
   */
  async back(userId: string, id: string): Promise<{ call: string } | "off" | "limit" | null> {
    if (!callsOn()) return "off";
    const parent = await this.get(userId, id);
    if (!parent) return null;
    if (parent.state === "ringing" || parent.state === "answered") return { call: parent.id };
    const now = this.now();
    const mine = (await this.table.select({ user_id: userId, origin: "user" }, { order: "ring_at_ms", desc: true, limit: BACK_MAX + 1 })).map(callRowOf);
    if (backsToday(mine, now, parent.tz_min) >= BACK_MAX) return "limit";
    const row: CallRow = {
      id: randomUUID(), user_id: userId, source: parent.source, source_key: `back:${parent.id}:${now}`, origin: "user", parent_id: parent.id,
      state: "answered", why: null, name: parent.name, item: parent.item, seed: parent.seed, line: parent.line, more: parent.more,
      opening: "", turns: [], tz_min: parent.tz_min, ring_at_ms: now, ring_until_ms: now, next_ms: now + TALK_IDLE_MS, rings: 0, rang: [],
      answered_ms: now, ended_ms: null,
      rt_call: null, rt_state: null, rt_sec: 0, cost_usd: 0, acted: [], judged: parent.judged,
    };
    await this.table.insert(rowForInsert(row));
    return { call: row.id };
  }

  // ------------------------------------------------------------------ talking

  /** A spoken reply kept for the voice route; the call stays open another 5 minutes. Its turn number. `rt`: said on the live link. */
  async said(userId: string, id: string, spoken: string, o: { rt?: boolean } = {}): Promise<number> {
    const row = await this.get(userId, id);
    if (!row) return 0;
    const now = this.now();
    const n = (row.turns.reduce((m, t) => Math.max(m, Number(t.n) || 0), 0)) + 1;
    const turns = [...row.turns, { n, said: spoken, at: now, ...(o.rt ? { rt: true as const } : {}) }].slice(-TURNS_KEPT);
    await this.table.update({ id, user_id: userId, state: "answered" }, { turns, next_ms: now + TALK_IDLE_MS });
    return n;
  }

  /** What turn `n` said: the opening for 0, a reply after. Null when there is no such call of theirs, or no such turn. */
  async voiceText(userId: string, id: string, n: number): Promise<string | null> {
    const row = await this.get(userId, id);
    if (!row) return null;
    if (n === 0) return row.opening || null;
    return row.turns.find((t) => Number(t.n) === n)?.said ?? null;
  }

  /** The voice for a turn, made now so the screen's GET plays at once (kept 2 minutes, in this server's memory). */
  prepare(user: AuthedUser, id: string, n: number, text: string): void {
    if (!this.speak || !text) return;
    const now = this.now();
    for (const [k, v] of this.voices) if (now - v.at > VOICE_KEEP_MS) this.voices.delete(k);
    while (this.voices.size >= VOICE_MAX) this.voices.delete(this.voices.keys().next().value as string);
    this.voices.set(`${id}:${n}`, { at: now, audio: this.readAloud(user, id, text) });
  }

  /** One read aloud, with what it cost put on the call's own row. Never throws: a read that fails is a 500 for that one turn. */
  private readAloud(user: AuthedUser, id: string, text: string): Promise<CallAudio> {
    const speak = this.speak!;
    return speak(user, text).then((out) => {
      // A record for the owner, not a cap: the read already happened, and nothing waits on the write.
      if (!("status" in out) && out.usd) void this.bumpCost(user.id, id, out.usd);
      return out;
    }).catch((): CallAudio => ({ status: 500, code: "tts_failed", message: "Couldn't read that aloud." }));
  }

  /** Turn `n` read aloud for this person's call: made ahead, or now. Null: no such call of theirs, or no such turn. */
  async voice(user: AuthedUser, id: string, n: number): Promise<CallAudio | null> {
    const text = await this.voiceText(user.id, id, n);
    if (text === null) return null;
    const key = `${id}:${n}`;
    const hit = this.voices.get(key);
    if (hit && this.now() - hit.at <= VOICE_KEEP_MS) {
      const got = await hit.audio;
      if (!("status" in got)) return got;
      this.voices.delete(key);
    }
    if (!this.speak) return { status: 500, code: "tts_failed", message: "Couldn't read that aloud." };
    return this.readAloud(user, id, text);
  }

  // ------------------------------------------------------------------ the live part's marks (planCallLive.ts writes through these)

  /**
   * What this call has cost so far, in US dollars. A RECORD FOR THE OWNER, NEVER A CAP: nothing here refuses, shortens or stops a
   * call, nothing is charged to the person's day budget, spend gate or plan quota, and no usage row is written. `sum` is the
   * manager's own running total, which is the source: a write that fails is picked up by the next one.
   */
  async addCost(userId: string, id: string, sum: number): Promise<void> {
    await this.table.update({ id, user_id: userId }, { cost_usd: Math.max(0, Number(sum) || 0) }).catch(() => 0);
  }

  /**
   * One more piece of cost on this call, in US dollars: the row is read again, `usd` is added, and the sum written. For the parts
   * that have no running total of their own — a turn's answer and a turn's voice. Same record, same promise: never a cap.
   *
   * One at a time per call, so a turn and its voice landing together cannot lose each other's dollars.
   */
  async bumpCost(userId: string, id: string, usd: number): Promise<void> {
    const add = Math.max(0, Number(usd) || 0);
    if (!add) return;
    const after = (this.bumps.get(id) ?? Promise.resolve()).then(async () => {
      const row = await this.get(userId, id).catch(() => null);
      if (row) await this.addCost(userId, id, row.cost_usd + add);
    }).catch(() => undefined);
    this.bumps.set(id, after);
    await after;
    if (this.bumps.get(id) === after) this.bumps.delete(id);
  }

  /** The live part's own marks: its OpenAI id, where it is, and how many live seconds it has used. */
  async markRt(userId: string, id: string, p: Partial<Pick<CallRow, "rt_call" | "rt_state" | "rt_sec">>): Promise<void> {
    await this.table.update({ id, user_id: userId }, p).catch(() => 0);
  }

  /** A call-local action the bot did out loud ("paid", "done", "later", "cant"): the screen ticks its button from it. */
  async noteActed(userId: string, id: string, name: string): Promise<void> {
    const row = await this.get(userId, id).catch(() => null);
    if (!row || row.acted.includes(name)) return;
    await this.table.update({ id, user_id: userId }, { acted: [...row.acted, name].slice(-8) }).catch(() => 0);
  }

  /** Every row still marked starting or live, across everyone: the boot sweep's own read. */
  async liveRows(limit = 200): Promise<CallRow[]> {
    return this.table.liveRows(limit).catch(() => []);
  }

  // ------------------------------------------------------------------ Activity

  /** Missed calls since `since`, newest first (Activity's "Missed call from X0"). The person's own Call backs never miss. */
  async missedSince(userId: string, since: number): Promise<Array<{ id: string; name: string; line: string; at: number }>> {
    const rows = await this.table.select({ user_id: userId, state: "missed", origin: "server" }, { order: "ring_at_ms", desc: true, limit: 50 });
    return rows.map(callRowOf).filter((r) => r.ring_at_ms >= since).map((r) => ({ id: r.id, name: r.name, line: r.line, at: r.ring_at_ms }));
  }
}

/**
 * Whether realtime calls are switched on for this person at all: the switch, a key, the Calls switch and the allow-list. NO MONEY IS
 * ASKED — not Plan Ease's day budget, not the spend gate, not the plan quota. The route asks this first, so it can tell a person
 * whose live time is used up (`rt_max_len`) from one the switch is simply off for (`rt_off`).
 */
export function realtimeFor(userId: string): boolean {
  const cfg = getConfig();
  if (!cfg.PLAN_CALL_REALTIME || !cfg.OPENAI_API_KEY || !callsOn()) return false;
  return inAllowList(cfg.PLAN_CALL_RT_ALLOW, userId);
}

/**
 * Whether this call may have a live part right now: realtime is on for the person, the call has not fallen back (it never flaps), and
 * it has live time left (the hard length against a stuck session, never a money cap). This is the screen's own `rt`.
 */
export function realtimeOn(userId: string, row: Pick<CallRow, "rt_sec" | "rt_state">): boolean {
  if (!realtimeFor(userId)) return false;
  if (row.rt_state === "fell_back") return false;
  return maxSecOf(row.rt_sec, getConfig().PLAN_CALL_RT_MAX_SEC) > GOODBYE_LEAD_SEC;
}

let shared: PlanCalls | null = null;
/** The server's. */
export function planCalls(): PlanCalls { return (shared ??= new PlanCalls()); }
/** Tests: one of their own (null: a fresh one next time). */
export function setPlanCalls(p: PlanCalls | null): void { shared = p; }
