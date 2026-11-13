/**
 * THE CALL JUDGE: AN AI THAT DECIDES WHICH THINGS ON THE PLAN GET A PHONE CALL, AND WHEN (docs/plan-call-judge.md).
 *
 *   onChange(user, ref, what)   the calendar's change hook (calendar/service.ts setChangeHook): an item was added, changed, done or taken
 *                               out. It does no I/O and never waits: the judgement runs 15 s after the last change
 *   judge(user, ref)            one item: read it, ask the AI once per change, keep the verdict and the moment it rings
 *   tick()                      every minute: the judged moments that are due ring through the seam's ringer (planCallSeam.ts)
 *   fill()                      every 15 minutes: the safety net for restarts, for items written before the judge was on, and for
 *                               failed judgements; and the clean-up of old rows
 *   verdictFor(user, item)      the seam's read (planCall.ts asks it for a floor or follow ring, and the call's facts)
 *   forget(user)                the person took back their AI yes: every judgement of theirs goes
 *   start(log)                  the tick and the fill; returns the way to stop them
 *
 * It works for a person only with ALL of: PLAN_CALL_JUDGE on and them on PLAN_CALL_JUDGE_ALLOW, calls switched on, their own Calls
 * setting on, and their yes to AI. Without a yes nothing is sent anywhere and nothing is kept; the rules (a leave-by, a bill due today)
 * ring as they always did. The rules are a floor: the judge adds calls and picks their time, and never turns a rule's call off.
 *
 * NO MONEY LIMIT. A judged call is not counted against Plan Ease's day budget or anyone's spend gate; what judging an item cost is kept
 * on its row for the owner to read. Failure never costs a call the rules would make. Logs never hold a title, place, name, amount, note,
 * reason or the AI's reasoning.
 */
import { createHash } from "node:crypto";
import { eventRow, taskRow, type CalendarRows, type EventRow, type TaskRow } from "../calendar/store.js";
import type { Calendar, ChangeHook } from "../calendar/service.js";
import { DAY, MIN, clockAt, dayOf } from "../calendar/words.js";
import { asPerson, isAiConsentError } from "../privacy/aiGate.js";
import { inCostTally } from "../usage/cost.js";
import { eventRefOf, itemId, parseItem } from "../widgets/items.js";
import { inAllowList } from "./planCallLiveWords.js";
import type { CallJudge, CallRinger, ItemSeed, JudgeVerdict } from "./planCallSeam.js";
import {
  FAILED_RETRY_MS, FILL_AHEAD_MS, FRESH_MS, FILL_LIMIT, FILL_MS, JUDGE_CONCURRENCY, JUDGE_READ, JUDGE_SYSTEM, JUDGING_STALE_MS, KEEP_DONE_MS, LATE_MS,
  MAX_TRIES, PENDING_MAX, RETRY_FOR_MS, RETRY_MS, SERIES_AHEAD_MS, SETTLE_MAX_MS, SETTLE_MS, TICK_MS, VERDICT_CACHE_MS,
  factsOfEvent, factsOfTask, floorRings, judgeMessage, mustOf, nearFloor, nextRingAt, parseVerdict, ringMoment, ringWords, sigOf, startsOf,
  type JudgeCtx, type JudgeFacts, type RingAt, type Start,
} from "./planCallJudgeWords.js";
import type { JudgementRow, JudgementStore, JudgeState } from "./planCallJudgeStore.js";
import type { LeaveRow } from "./planPrefs.js";
import type { ReadAnswer, ReadOpts } from "./planCapture.js";

export type Ref = { kind: "event" | "task"; id: string };
type Log = { info(o: object, m: string): void; warn(o: object, m: string): void };
const QUIET: Log = { info: () => undefined, warn: () => undefined };

/** What the judge is handed (the server's, from routes/bots/planCallJudge.ts; tests hand in memory and fakes). */
export interface JudgeDeps {
  /** The calendar's rows: the judge reads an item as it is, whatever wrote it. Must be the same rows the hooked `calendar` writes (in the server, both are calendarRows()). */
  rows: CalendarRows;
  /** The calendar itself: only for a day's list (the AI is shown the item's day). */
  calendar: Pick<Calendar, "list">;
  table: JudgementStore;
  readers: { text(system: string, user: string, o?: ReadOpts): Promise<ReadAnswer> };
  ringer: () => CallRinger | null;
  now?: () => number;
  /** PLAN_CALL_JUDGE and PLAN_CALL_JUDGE_ALLOW. */
  flags: () => { on: boolean; allow: string };
  /** BOT_CALLS with Plan Ease's app and reminders steps (planSwitch.ts callsOn). */
  callsOn: () => boolean;
  /** The person's yes to AI (privacy/aiGate.ts aiAllowedFor). */
  consent: (userId: string) => Promise<boolean>;
  /** The person's own settings: Calls on or off, quiet hours. */
  settings: (userId: string) => Promise<{ notify: { calls?: boolean; quiet?: boolean; quietFrom?: number; quietTo?: number } }>;
  /** Their leave-bys worked out (planPrefs.ts). */
  leaves: (userId: string) => Promise<LeaveRow[]>;
  /** The item a follow is about ("pe:…" or "pt:…"), or null. */
  followItem: (followId: string) => Promise<string | null>;
  /** Their X0 people's first names by id; null when they could not be read. */
  names: (userId: string) => Promise<Map<string, string> | null>;
  log?: Log;
}

const hash = (userId: string, item: string): string => createHash("sha256").update(userId + item).digest("hex").slice(0, 8);
const rowKey = (ref: Ref): string => `${ref.kind === "event" ? "e" : "t"}:${ref.id}`;
const refOfKey = (key: string): Ref => ({ kind: key.startsWith("e:") ? "event" : "task", id: key.slice(2) });
const KEY_PREFIX = "judge:";

export class PlanCallJudge implements CallJudge {
  private readonly now: () => number;
  private log: Log;
  /** Items waiting to settle: the last change and the first. */
  private readonly pending = new Map<string, { userId: string; ref: Ref; first: number; timer: ReturnType<typeof setTimeout> }>();
  private queue: Array<{ userId: string; ref: Ref }> = [];
  private readonly queued = new Set<string>();
  private readonly active = new Set<string>();
  private running = 0;
  private readonly cache = new Map<string, { at: number; v: JudgeVerdict | null }>();

  constructor(private readonly d: JudgeDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? QUIET;
  }

  // ------------------------------------------------------------------ who it works for

  private allowed(userId: string): boolean {
    const f = this.d.flags();
    return f.on && inAllowList(f.allow, userId);
  }

  /** Every condition for a person, asked before each model call and again before each ring. A failed read is a no. */
  async may(userId: string): Promise<boolean> {
    if (!this.allowed(userId) || !this.d.callsOn()) return false;
    try {
      if ((await this.d.settings(userId)).notify?.calls === false) return false;
      return await this.d.consent(userId);
    } catch { return false; }
  }

  // ------------------------------------------------------------------ the hook and the settle

  /** The calendar's change hook. Synchronous, no I/O: the judgement is queued behind a short settle. */
  readonly onChange: ChangeHook = (userId, ref, what) => {
    if (!this.allowed(userId)) return;
    const k = `${userId}|${rowKey(ref)}`;
    this.cache.delete(k);
    if (what === "done" || what === "gone") {
      this.drop(k);
      void this.markEnd(userId, ref, what).catch(() => undefined);
      return;
    }
    const now = this.now();
    const had = this.pending.get(k);
    if (!had && this.pending.size >= PENDING_MAX) return;
    if (had) clearTimeout(had.timer);
    const first = had?.first ?? now;
    const wait = Math.max(0, Math.min(SETTLE_MS, first + SETTLE_MAX_MS - now));
    const timer = setTimeout(() => { this.pending.delete(k); this.enqueue(userId, ref); }, wait);
    timer.unref?.();
    this.pending.set(k, { userId, ref, first, timer });
  };

  private drop(k: string): void {
    const p = this.pending.get(k);
    if (p) { clearTimeout(p.timer); this.pending.delete(k); }
  }

  private async markEnd(userId: string, ref: Ref, what: "done" | "gone"): Promise<void> {
    const key = rowKey(ref);
    const had = (await this.d.table.select({ user_id: userId, item: key }, { limit: 1 }))[0];
    if (!had) return;
    await this.d.table.update({ user_id: userId, item: key }, { state: what, next_ring_ms: null, updated_ms: Math.max(this.now(), Number(had.updated_ms) + 1) });
  }

  // ------------------------------------------------------------------ the queue

  private enqueue(userId: string, ref: Ref): void {
    const k = `${userId}|${rowKey(ref)}`;
    if (this.queued.has(k)) return;
    this.queued.add(k);
    this.queue.push({ userId, ref });
    this.pump();
  }

  /** At most JUDGE_CONCURRENCY at once on the process, and one at a time per person. */
  private pump(): void {
    for (let i = 0; i < this.queue.length && this.running < JUDGE_CONCURRENCY;) {
      const job = this.queue[i]!;
      if (this.active.has(job.userId)) { i += 1; continue; }
      this.queue.splice(i, 1);
      this.queued.delete(`${job.userId}|${rowKey(job.ref)}`);
      this.running += 1;
      this.active.add(job.userId);
      void this.judge(job.userId, job.ref)
        .catch((err) => this.log.warn({ err: (err as Error)?.message }, "[judge] failed to judge"))
        .finally(() => { this.running -= 1; this.active.delete(job.userId); this.pump(); });
    }
  }

  // ------------------------------------------------------------------ reading an item

  private async read(userId: string, ref: Ref): Promise<{ facts: JudgeFacts; changed: number } | null> {
    const now = this.now();
    if (ref.kind === "event") {
      const [r] = await this.d.rows.events.select({ id: ref.id, user_id: userId }, { limit: 1 });
      return r ? { facts: factsOfEvent(eventRow(r as EventRow), now), changed: Number(r.updated_ms) } : null;
    }
    const [r] = await this.d.rows.tasks.select({ id: ref.id, user_id: userId }, { limit: 1 });
    return r ? { facts: factsOfTask(taskRow(r as TaskRow), now), changed: Number(r.updated_ms) } : null;
  }

  /** The id an event start has on the Plan: "<id>@<day>" for one start of a series. */
  private eventId(ref: Ref, f: JudgeFacts, s: Start): string { return f.repeat ? `${ref.id}@${s.day}` : ref.id; }

  /** The item id of one start ("pe:<eventRef>:<day>" or "pt:<taskId>", widgets/items.ts). */
  private itemOf(ref: Ref, f: JudgeFacts, s: Start): string {
    return ref.kind === "event" ? itemId({ kind: "pe", eventRef: eventRefOf(this.eventId(ref, f, s)), day: s.day }) : itemId({ kind: "pt", taskId: ref.id });
  }

  private leaveOfFor(ref: Ref, f: JudgeFacts, leaves: readonly LeaveRow[]): (s: Start) => number | null {
    if (ref.kind !== "event") return () => null;
    return (s) => leaves.find((l) => l.eventId === this.eventId(ref, f, s) && Math.abs(l.start - s.start) < MIN)?.leaveBy ?? null;
  }

  private async leavesOf(userId: string): Promise<LeaveRow[]> { return this.d.leaves(userId).catch(() => []); }

  private keyFor(ref: Ref, f: JudgeFacts, r: RingAt): string { return `${KEY_PREFIX}${this.itemOf(ref, f, r)}@${r.t}`; }

  // ------------------------------------------------------------------ one judgement

  /** The row's own writes: a compare-and-swap on `updated_ms`, which every write moves on. */
  private async cas(userId: string, key: string, was: number, patch: Partial<JudgementRow>): Promise<number | null> {
    const next = Math.max(this.now(), was + 1);
    const n = await this.d.table.update({ user_id: userId, item: key, updated_ms: was }, { ...patch, updated_ms: next });
    this.cache.delete(`${userId}|${key}`);
    return n > 0 ? next : null;
  }

  /** A state with no AI read behind it (done, gone, no time, past): written whether or not the row exists. */
  private async put(userId: string, key: string, had: JudgementRow | undefined, sig: string, state: JudgeState, why: string, changed: number): Promise<void> {
    if (had && had.sig === sig && had.state === state && had.next_ring_ms === null) return;
    const at = Math.max(this.now(), (had?.updated_ms ?? 0) + 1);
    if (had) await this.d.table.update({ user_id: userId, item: key }, { sig, state, call: false, why, next_ring_ms: null, changed_ms: changed, updated_ms: at });
    else {
      await this.d.table.insert({ user_id: userId, item: key, sig, state, call: false, at: null, why, usd: 0, tries: 0, next_ring_ms: null, ring_key: null, changed_ms: changed, judged_ms: null, updated_ms: at })
        .catch(() => undefined);
    }
    this.cache.delete(`${userId}|${key}`);
  }

  async judge(userId: string, ref: Ref): Promise<void> {
    if (!(await this.may(userId))) return;
    const now = this.now();
    const key = rowKey(ref);
    const read = await this.read(userId, ref);
    const had = (await this.d.table.select({ user_id: userId, item: key }, { limit: 1 }))[0];
    if (!read) { if (had && had.state !== "gone") await this.put(userId, key, had, had.sig, "gone", "", had.changed_ms); return; }
    const { facts, changed } = read;
    const sig = sigOf(facts);
    const tag = { item: hash(userId, key), kind: facts.kind, sig: sig.slice(0, 8) };
    if (facts.done) { await this.put(userId, key, had, sig, "done", "", changed); return; }
    if (facts.kind !== "event" && !facts.day) { await this.put(userId, key, had, sig, "off", "no time", changed); this.log.info({ ...tag, call: false, at: "" }, "[judge] off"); return; }
    const starts = startsOf(facts, now - LATE_MS - DAY, now + SERIES_AHEAD_MS).filter((s) => s.t >= now - LATE_MS);
    if (starts.length === 0) { await this.put(userId, key, had, sig, "past", "", changed); this.log.info({ ...tag, call: false, at: "" }, "[judge] past"); return; }

    // Once per change: this sig is already judged (or failed three times): nothing is asked.
    if (had && had.sig === sig) {
      if (had.state === "off" || had.state === "past") return;
      if (had.state === "failed" && (had.tries >= MAX_TRIES || now - had.updated_ms < FAILED_RETRY_MS)) return;
      if (had.state === "judging" && now - had.updated_ms < JUDGING_STALE_MS) return;
      if (had.state === "set") { await this.replan(userId, ref, had, facts, changed); return; }
    }

    // Claim the row: an insert, or a compare-and-swap on its update time. Lost: another server has it.
    let claimed: number;
    if (!had) {
      try {
        await this.d.table.insert({ user_id: userId, item: key, sig, state: "judging", call: false, at: null, why: "", usd: 0, tries: 0, next_ring_ms: null, ring_key: null, changed_ms: changed, judged_ms: null, updated_ms: now });
      } catch { return; }
      claimed = now;
    } else {
      if (had.state === "judging" && now - had.updated_ms < JUDGING_STALE_MS) return;
      const c = await this.cas(userId, key, had.updated_ms, { state: "judging" });
      if (c === null) return;
      claimed = c;
    }

    const leaves = await this.leavesOf(userId);
    const leaveOf = this.leaveOfFor(ref, facts, leaves);
    const next = starts[0]!;
    let text: ReadAnswer;
    try {
      const ctx = await this.context(userId, ref, facts, next, leaveOf(next), leaves, now);
      text = await asPerson(userId, () => inCostTally(() => this.d.readers.text(JUDGE_SYSTEM, judgeMessage(facts, ctx), { ...JUDGE_READ })));
    } catch (err) {
      // A "no" from the consent gate in the middle: nothing is kept.
      if (isAiConsentError(err)) { await this.d.table.remove({ user_id: userId, item: key }); this.cache.delete(`${userId}|${key}`); return; }
      await this.fail(userId, key, claimed, had, sig, 0, now, tag, "model");
      return;
    }
    const usd = (had?.usd ?? 0) + (Number.isFinite(text.usd) ? text.usd : 0);
    const v = parseVerdict(text.text);
    if (!v) { await this.fail(userId, key, claimed, had, sig, text.usd, now, tag, "parse"); return; }
    // The person may have switched it off while the AI read: then nothing is kept.
    if (!(await this.may(userId))) { await this.d.table.remove({ user_id: userId, item: key }); this.cache.delete(`${userId}|${key}`); return; }

    const ring = this.plan(v, facts, changed, leaveOf, now);
    const wrote = await this.cas(userId, key, claimed, {
      sig, state: v.call ? "set" : "off", call: v.call, at: v.at, why: v.why, judged_ms: now, tries: 0, usd,
      next_ring_ms: ring?.ring ?? null, ring_key: ring ? this.keyFor(ref, facts, ring) : had?.ring_key ?? null, changed_ms: changed,
    });
    if (wrote === null) return;
    this.log.info({ ...tag, call: v.call, at: v.at, ms: this.now() - now, usd: Number(text.usd.toFixed(6)) }, v.call ? "[judge] set" : "[judge] off");
  }

  private plan(v: Pick<JudgeVerdict, "call" | "at">, f: JudgeFacts, changed: number, leaveOf: (s: Start) => number | null, now: number, after?: number): RingAt | null {
    return nextRingAt(v, f, { now, changedAt: changed, leaveOf, after });
  }

  /** The same change, already judged to call, with no ring waiting (it rang, or the person had Calls off): work out the next moment, no AI. */
  private async replan(userId: string, ref: Ref, had: JudgementRow, f: JudgeFacts, changed: number): Promise<void> {
    if (!had.call || had.next_ring_ms !== null || !had.at) return;
    const now = this.now();
    const leaveOf = this.leaveOfFor(ref, f, await this.leavesOf(userId));
    const ring = this.plan({ call: true, at: had.at as JudgeVerdict["at"] }, f, changed, leaveOf, now);
    if (!ring) return;
    const key = this.keyFor(ref, f, ring);
    // A moment that has already come and been tried is not set again.
    if (key === had.ring_key && ring.ring <= now) return;
    await this.cas(userId, rowKey(ref), had.updated_ms, { next_ring_ms: ring.ring, ring_key: key });
  }

  private async fail(userId: string, key: string, claimed: number, had: JudgementRow | undefined, sig: string, usd: number, started: number, tag: object, reason: string): Promise<void> {
    const tries = (had && had.sig === sig ? had.tries : 0) + 1;
    await this.cas(userId, key, claimed, { sig, state: "failed", call: false, next_ring_ms: null, tries, usd: (had?.usd ?? 0) + (Number.isFinite(usd) ? usd : 0) });
    this.log.info({ ...tag, call: false, at: "", ms: this.now() - started, usd: Number((usd || 0).toFixed(6)), reason }, "[judge] failed");
  }

  /** What the AI is told about the person and the item's day. */
  private async context(userId: string, ref: Ref, f: JudgeFacts, next: Start, leaveBy: number | null, leaves: readonly LeaveRow[], now: number): Promise<JudgeCtx> {
    const [set, names, listed] = await Promise.all([
      this.d.settings(userId).catch(() => null),
      f.people.some((p) => p !== userId) ? this.d.names(userId).catch(() => null) : Promise.resolve(new Map<string, string>()),
      this.d.calendar.list(userId, { from: next.day, to: next.day }).catch(() => null),
    ]);
    const n = set?.notify;
    const quiet = n?.quiet && typeof n.quietFrom === "number" && typeof n.quietTo === "number" && n.quietFrom !== n.quietTo ? { from: n.quietFrom, to: n.quietTo } : null;
    const lines: string[] = [];
    for (const e of listed?.events ?? []) lines.push(`${e.allDay ? "all day" : clockAt(e.start, f.tz)} ${e.title}${e.seriesId === ref.id ? " (this)" : ""}`);
    for (const t of listed?.tasks ?? []) lines.push(`${t.kind === "due" ? "bill" : "to-do"}: ${t.title}${ref.kind === "task" && t.id === ref.id ? " (this)" : ""}`);
    const others = f.people.filter((p) => p !== userId);
    const leave = leaveBy === null ? null : leaves.find((l) => l.leaveBy === leaveBy) ?? null;
    return {
      now, tz: f.tz, quiet, next: { t: next.t, day: next.day }, dayLines: lines, names: names === null ? null : others.map((id) => names.get(id)).filter((x): x is string => !!x),
      others: others.length, leave: leave ? { leaveBy: leave.leaveBy, minutes: leave.minutes, mode: leave.mode } : null,
    };
  }

  // ------------------------------------------------------------------ the ring tick

  /** Every judged moment that is due rings through the seam's ringer: claimed first, so two ticks or two servers never both ring. */
  async tick(): Promise<void> {
    if (!this.d.flags().on) return;
    const due = await this.d.table.dueRings(this.now(), 100).catch(() => [] as JudgementRow[]);
    for (const row of due) await this.ringOne(row).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[judge] ring failed"));
  }

  private async ringOne(row: JudgementRow): Promise<void> {
    const userId = row.user_id, key = row.item, now = this.now();
    if (row.next_ring_ms === null) return;
    const claimed = await this.cas(userId, key, row.updated_ms, { next_ring_ms: null });
    if (claimed === null) return;
    const rk = row.ring_key;
    const tag = { item: hash(userId, key) };
    if (!rk || !rk.startsWith(KEY_PREFIX) || !row.call || row.state !== "set" || !row.at) return;
    if (!(await this.may(userId))) return;
    const ref = refOfKey(key);
    const read = await this.read(userId, ref);
    if (!read) { await this.put(userId, key, row, row.sig, "gone", "", row.changed_ms); return; }
    if (read.facts.done) { await this.put(userId, key, row, row.sig, "done", "", read.changed); return; }
    // The item changed since the verdict: it is being judged again, and rings nothing until then.
    if (sigOf(read.facts) !== row.sig) return;
    const f = read.facts;
    const t = Number(rk.slice(rk.lastIndexOf("@") + 1));
    const s = startsOf(f, t - DAY, t + DAY).find((x) => x.t === t);
    const verdict: Pick<JudgeVerdict, "call" | "at"> = { call: true, at: row.at as JudgeVerdict["at"] };
    const leaveOf = this.leaveOfFor(ref, f, await this.leavesOf(userId));
    let retry = false;
    if (s) {
      const leave = leaveOf(s);
      const base = Math.max(ringMoment(verdict.at, f, s, leave), row.changed_ms + FRESH_MS);
      if (nearFloor(base, floorRings(f, s, leave))) {
        this.log.info({ ...tag, lead: 0 }, "[judge] floor");
      } else {
        const seed = this.seedOf(ref, f, s, row, now);
        const w = ringWords(seed, now);
        const ringer = this.d.ringer();
        if (!ringer) this.log.info({ ...tag, lead: seed.lead, none: "no_ringer" }, "[judge] none");
        else {
          const res = await ringer.ringItem(userId, seed, { key: rk, line: w.line, more: w.more, now }).catch(() => ({ none: "not_sent" as const }));
          if ("id" in res) this.log.info({ ...tag, lead: seed.lead }, "[judge] rang");
          else {
            this.log.info({ ...tag, lead: seed.lead, none: res.none }, "[judge] none");
            // Busy or too soon: again in two minutes, while that is no later than 20 minutes after the moment and the item's time.
            retry = (res.none === "busy" || res.none === "too_soon") && now + RETRY_MS <= Math.min(base + RETRY_FOR_MS, s.t);
          }
        }
      }
    }
    if (retry) { await this.cas(userId, key, claimed, { next_ring_ms: now + RETRY_MS }); return; }
    // A series moves on to its next start; a one-off leaves nothing waiting.
    const nx = s ? this.plan(verdict, f, row.changed_ms, leaveOf, now, t) : null;
    await this.cas(userId, key, claimed, nx ? { next_ring_ms: nx.ring, ring_key: this.keyFor(ref, f, nx) } : {});
  }

  private seedOf(ref: Ref, f: JudgeFacts, s: Start, row: JudgementRow, now: number): ItemSeed {
    return {
      source: "item", item: this.itemOf(ref, f, s), kind: f.kind,
      ...(ref.kind === "event" ? { eventId: this.eventId(ref, f, s) } : { taskId: ref.id }),
      day: s.day || dayOf(s.t, f.tz), tz: f.tz, title: f.title, place: f.place, at: s.t, allDay: f.allDay, payee: f.payee, pay: f.pay,
      must: mustOf(f), lead: Math.max(0, Math.round((s.t - now) / MIN)), why: row.why.slice(0, 160),
    };
  }

  // ------------------------------------------------------------------ the fill

  /** The safety net, every 15 minutes. What it counts, for the log. */
  async fill(): Promise<{ people: number; items: number; queued: number; failed: number; cleaned: number }> {
    const now = this.now();
    const out = { people: 0, items: 0, queued: 0, failed: 0, cleaned: 0 };
    if (!this.d.flags().on) return out;
    const up = await this.d.table.upcoming(now, now + FILL_AHEAD_MS, FILL_LIMIT).catch(() => []);
    const byPerson = new Map<string, typeof up>();
    for (const u of up) { if (this.allowed(u.userId)) byPerson.set(u.userId, [...(byPerson.get(u.userId) ?? []), u]); }
    out.items = up.length;
    for (const [userId, items] of byPerson) {
      if (!(await this.may(userId))) continue;
      out.people += 1;
      for (const u of items) {
        const ref: Ref = { kind: u.kind, id: u.id };
        const had = (await this.d.table.select({ user_id: userId, item: rowKey(ref) }, { limit: 1 }))[0];
        // Judged and unchanged (and nothing left to plan): skipped without reading the item.
        if (had && had.changed_ms === u.updated && (had.state === "off" || had.state === "past" || (had.state === "set" && (had.next_ring_ms !== null || !had.call)))) continue;
        this.enqueue(userId, ref);
        out.queued += 1;
      }
    }
    for (const r of await this.d.table.retryable(now - FAILED_RETRY_MS, 100).catch(() => [])) {
      if (!this.allowed(r.user_id)) continue;
      this.enqueue(r.user_id, refOfKey(r.item));
      out.failed += 1;
    }
    out.cleaned = await this.d.table.clean(now - KEEP_DONE_MS).catch(() => 0);
    this.log.info(out, "[judge] fill");
    return out;
  }

  // ------------------------------------------------------------------ the seam

  async verdictFor(userId: string, item: string): Promise<JudgeVerdict | null> {
    try {
      if (!this.allowed(userId)) return null;
      // Consent is read every time (it is a cached lookup), so a hit never outlives a withdrawn yes.
      if (!(await this.d.consent(userId))) return null;
      const key = await this.keyOf(item);
      if (!key) return null;
      const ck = `${userId}|${key}`;
      const now = this.now();
      const hit = this.cache.get(ck);
      if (hit && now - hit.at < VERDICT_CACHE_MS) return hit.v;
      const r = (await this.d.table.select({ user_id: userId, item: key }, { limit: 1 }))[0];
      const v: JudgeVerdict | null = r && (r.state === "set" || r.state === "off") ? { call: r.call === true, at: (r.at ?? "due") as JudgeVerdict["at"], why: r.why } : null;
      if (this.cache.size >= PENDING_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(ck, { at: now, v });
      return v;
    } catch { return null; }
  }

  /** The row an item id names: "pt:" a to-do, "pe:" an event (a series' start is its series), "pf:" the item a follow is about. */
  private async keyOf(item: string, depth = 0): Promise<string | null> {
    const p = parseItem(item);
    if (!p) return null;
    if (p.kind === "pt") return `t:${p.taskId}`;
    if (p.kind === "pe") return `e:${p.eventRef.replace(/\.\d{4}-\d{2}-\d{2}$/, "")}`;
    if (p.kind === "pf" && depth === 0) { const it = await this.d.followItem(p.followId); return it ? this.keyOf(it, 1) : null; }
    return null;
  }

  /** The person took back their yes: every judgement of theirs, their waiting settles and their queued work go. */
  async forget(userId: string): Promise<void> {
    for (const [k, p] of this.pending) if (p.userId === userId) { clearTimeout(p.timer); this.pending.delete(k); }
    this.queue = this.queue.filter((j) => { const keep = j.userId !== userId; if (!keep) this.queued.delete(`${j.userId}|${rowKey(j.ref)}`); return keep; });
    for (const k of this.cache.keys()) if (k.startsWith(`${userId}|`)) this.cache.delete(k);
    await this.d.table.remove({ user_id: userId });
  }

  // ------------------------------------------------------------------ running

  /** The tick every minute and the fill every 15; returns the way to stop. A restart loses only waiting settles: the fill finds them. */
  start(log?: Log): () => void {
    if (log) this.log = log;
    let ticking = false, filling = false;
    const tick = setInterval(() => { if (ticking) return; ticking = true; void this.tick().catch(() => undefined).finally(() => { ticking = false; }); }, TICK_MS);
    const fill = setInterval(() => { if (filling) return; filling = true; void this.fill().catch(() => undefined).finally(() => { filling = false; }); }, FILL_MS);
    const first = setTimeout(() => { filling = true; void this.fill().catch(() => undefined).finally(() => { filling = false; }); }, 30_000);
    for (const t of [tick, fill, first]) t.unref?.();
    return () => {
      clearInterval(tick); clearInterval(fill); clearTimeout(first);
      for (const p of this.pending.values()) clearTimeout(p.timer);
      this.pending.clear();
    };
  }
}
