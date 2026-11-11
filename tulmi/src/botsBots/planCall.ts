/**
 * "X0 IS CALLING": THE SERVICE (BOT_CALLS; docs/plan-ease.md "Calls"). A leave-by or a bill due today, for a person with Calls on, rings
 * their phone instead of the push: an ordinary notification titled "<Name> is calling" with Answer and Not now, our own ringtone on an
 * iPhone that has it, then "Missed call from <Name>" if nobody answered. Answer opens the call screen (screens/bots/planCall.ts), where
 * Plan Ease speaks first and the person can talk back.
 *
 *   hook                  asked by the push engine before a leave-by or a bill due today goes (push/engine.ts setCallHook): rings the
 *                         phones that take calls, or says why not (and the push goes the existing way)
 *   advance(id)           a call's next step, from its timers and from the sweep: ring 2 at +23 s, the missed call at +45 s (both only to
 *                         the phones that took ring 1), an answered call left alone 5 minutes ended
 *   start(log)            the sweep every 10 s (a restart loses the timers, never a step) and the 90-day clean-up
 *   view / answer / decline / end / back   the call screen's and the notification's doors (routes/bots/planCalls.ts)
 *   said / voiceText / prepare / voice     a reply kept for the voice route, and the voice made ahead so it plays at once
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
import { MemoryTable, SupabaseTable, type Table } from "./rows.js";
import { callsOn, planOn } from "./planSwitch.js";
import {
  CALLS, FRESH_MS, GRACE_MS, RING2_MS, RING_MS, SWEEP_MS, TALK_IDLE_MS, blockedBy, cardOf, missedBody, openingLine,
  type CallSeed, type CallState, type CallView,
} from "./planCallWords.js";

export type { CallSeed, CallState, CallView } from "./planCallWords.js";
export { CALLS, DAY_MAX, FRESH_MS, GAP_MS, GRACE_MS, MAX_TURNS, RING2_MS, RING_MS, STALE_RING_MS, SWEEP_MS, TALK_IDLE_MS } from "./planCallWords.js";

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

// ------------------------------------------------------------------ the row (migration 0079)

export interface CallTurn { n: number; said: string; at: number }

export interface CallRow {
  [k: string]: unknown;
  id: string;
  user_id: string;
  source: "leave" | "due";
  source_key: string;
  origin: "server" | "user";
  parent_id: string | null;
  state: CallState;
  why: "not_sent" | "timeout" | "hung_up" | "done" | null;
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
  };
}

/** The calls table, with the two reads across everyone: the sweep's due calls, and the clean-up. */
export interface CallTable extends Table<CallRow> {
  /** Calls still ringing or answered whose next step is due, soonest first. */
  due(now: number, limit: number): Promise<CallRow[]>;
  /** Deletes every call that rang before `before`. */
  clean(before: number): Promise<void>;
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

/** Words read aloud (routes/writing/speak.ts speakFor), or why not. */
export type CallAudio = { audio: Buffer; contentType: string } | { status: number; code: string; message: string };

export interface PlanCallsDeps {
  table?: CallTable;
  engine?: () => PushEngine | null;
  now?: () => number;
  /** The name it calls as: the person's own name for it (Keylessbord's "What you call it"), else X0. */
  name?: (userId: string) => Promise<string>;
  /** Whether the person agreed to AI (privacy/aiConsent.ts): the server voice and talking back. */
  consent?: (userId: string) => Promise<boolean>;
  log?: Log;
}
type Log = { info(o: object, m: string): void; warn(o: object, m: string): void };
const QUIET: Log = { info: () => undefined, warn: () => undefined };

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
  private log: Log;
  /** What the call's voice route reads aloud and the note of how a call began: the server's chat and voice (routes/bots/planCalls.ts). */
  private chat: { note(userId: string, slug: string, text: string): Promise<void> } | null = null;
  private speak: ((user: AuthedUser, text: string) => Promise<CallAudio>) | null = null;
  private readonly voices = new Map<string, { at: number; audio: Promise<CallAudio> }>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastClean = 0;

  constructor(d: PlanCallsDeps = {}) {
    this.table = d.table ?? callTable();
    this.engine = d.engine ?? pushEngine;
    this.now = d.now ?? (() => Date.now());
    this.name = d.name ?? defaultName;
    this.consent = d.consent ?? hasAiConsent;
    this.log = d.log ?? QUIET;
  }

  /** The chat that keeps how a call began, and the voice that reads it (wired at boot: routes/bots/planCalls.ts). */
  wire(o: { chat?: PlanCalls["chat"]; speak?: PlanCalls["speak"]; log?: Log }): void {
    if (o.chat !== undefined) this.chat = o.chat;
    if (o.speak !== undefined) this.speak = o.speak;
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
      const rows = (await this.table.select({ user_id: c.userId }, { order: "ring_at_ms", desc: true, limit: 20 })).map(callRowOf);
      const blocked = blockedBy(rows, now, seed.tz);
      if (blocked) return this.none(blocked);
      const row: CallRow = {
        id: randomUUID(), user_id: c.userId, source: seed.source, source_key: msg.key, origin: "server", parent_id: null, state: "ringing", why: null,
        name: (await this.name(c.userId).catch(() => ASSISTANT_NAME)) || ASSISTANT_NAME, item: seed.item, seed,
        line: String(msg.vars?.title ?? ""), more: String(msg.vars?.body ?? ""), opening: "", turns: [], tz_min: seed.tz,
        ring_at_ms: now, ring_until_ms: now + RING_MS, next_ms: now + RING2_MS, rings: 1, rang: [], answered_ms: null, ended_ms: null,
      };
      const placed = await this.place(row);
      if (placed === "failed") return this.none("not placed");
      // Another server got there between the look above and this insert.
      if (placed !== "placed") return this.again(placed.taken, tokens);
      const r = await this.sendRing(c, row, tokens, 1, 40, now).catch(() => null);
      if (!r?.ok.size) {
        await this.table.update({ id: row.id, user_id: row.user_id, state: "ringing" }, { state: "ended", why: "not_sent", next_ms: null, ended_ms: now }).catch(() => 0);
        return this.none("not sent");
      }
      // Ring 2 and the missed call follow only to the phones that took this one (rangAmong). A write that fails leaves it empty: then
      // every phone that takes calls, as before.
      await this.table.update({ id: row.id, user_id: row.user_id }, { rang: [...r.ok].map((t) => tokenHash(t)) }).catch(() => 0);
      this.later(row);
      this.log.info({}, "[calls] rang");
      // Only the phones that took the ring skip the push: one whose ticket failed still hears the reminder.
      return { rang: r.ok };
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, "[calls] none: failed");
      return null;
    }
  };

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
      await this.table.insert(row);
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

  /** The reminder's own expiry (push.<kind>.ttlMin): a missed leave-by is no use an hour on; a bill's lasts the day. */
  private missedTtlSec(row: CallRow, k: ReturnType<typeof knobsOf>): number {
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
      card: cardOf(row.seed, row.tz_min),
    };
  }

  /**
   * Answer: a ringing call, or a missed one inside the grace (Face ID, a slow launch), becomes answered; one already answered stays so.
   * `fresh`: this request answered it, nothing has been said yet, or it was answered under 10 s ago (a retry after a lost response): only
   * then does the screen speak. `talk` asks "Want me to do anything?" only when the screen can listen AND the person agreed to AI.
   */
  async answer(user: AuthedUser, id: string, talkAsked: unknown): Promise<AnswerOut | null> {
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
    const talk = talkAsked === true && ai;
    fresh = fresh || row.opening === "" || (row.answered_ms !== null && now - row.answered_ms < FRESH_MS);
    let opening = row.opening;
    if (fresh) {
      const line = openingLine(row.seed, { back: row.origin === "user", talk, now, tz: row.tz_min });
      if (line !== row.opening) {
        await this.table.update({ id, user_id: user.id }, { opening: line });
        if (ai) {
          this.prepare(user, id, 0, line);
          await this.chat?.note(user.id, "plan", line).catch(() => undefined);
        }
      }
      opening = line;
    }
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
  async end(userId: string, id: string, why: "hung_up" | "done" = "hung_up"): Promise<{ ok: true; state: CallState } | null> {
    const row = await this.get(userId, id);
    if (!row) return null;
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
   * Call back: the person's own call, about the same thing, answered as it starts (it never rings, and the limits don't apply). A call
   * still ringing or on is that call. Null: no such call of theirs; "off": calls are switched off.
   */
  async back(userId: string, id: string): Promise<{ call: string } | "off" | null> {
    if (!callsOn()) return "off";
    const parent = await this.get(userId, id);
    if (!parent) return null;
    if (parent.state === "ringing" || parent.state === "answered") return { call: parent.id };
    const now = this.now();
    const row: CallRow = {
      id: randomUUID(), user_id: userId, source: parent.source, source_key: `back:${parent.id}:${now}`, origin: "user", parent_id: parent.id,
      state: "answered", why: null, name: parent.name, item: parent.item, seed: parent.seed, line: parent.line, more: parent.more,
      opening: "", turns: [], tz_min: parent.tz_min, ring_at_ms: now, ring_until_ms: now, next_ms: now + TALK_IDLE_MS, rings: 0, rang: [],
      answered_ms: now, ended_ms: null,
    };
    await this.table.insert(row);
    return { call: row.id };
  }

  // ------------------------------------------------------------------ talking

  /** A spoken reply kept for the voice route; the call stays open another 5 minutes. Its turn number. */
  async said(userId: string, id: string, spoken: string): Promise<number> {
    const row = await this.get(userId, id);
    if (!row) return 0;
    const now = this.now();
    const n = (row.turns.reduce((m, t) => Math.max(m, Number(t.n) || 0), 0)) + 1;
    const turns = [...row.turns, { n, said: spoken, at: now }].slice(-TURNS_KEPT);
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
    const speak = this.speak;
    this.voices.set(`${id}:${n}`, { at: now, audio: speak(user, text).catch((): CallAudio => ({ status: 500, code: "tts_failed", message: "Couldn't read that aloud." })) });
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
    return this.speak(user, text).catch((): CallAudio => ({ status: 500, code: "tts_failed", message: "Couldn't read that aloud." }));
  }

  // ------------------------------------------------------------------ Activity

  /** Missed calls since `since`, newest first (Activity's "Missed call from X0"). The person's own Call backs never miss. */
  async missedSince(userId: string, since: number): Promise<Array<{ id: string; name: string; line: string; at: number }>> {
    const rows = await this.table.select({ user_id: userId, state: "missed", origin: "server" }, { order: "ring_at_ms", desc: true, limit: 50 });
    return rows.map(callRowOf).filter((r) => r.ring_at_ms >= since).map((r) => ({ id: r.id, name: r.name, line: r.line, at: r.ring_at_ms }));
  }
}

let shared: PlanCalls | null = null;
/** The server's. */
export function planCalls(): PlanCalls { return (shared ??= new PlanCalls()); }
/** Tests: one of their own (null: a fresh one next time). */
export function setPlanCalls(p: PlanCalls | null): void { shared = p; }
