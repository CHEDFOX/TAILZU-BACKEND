/**
 * PLAN EASE, STEP 4: WAITING ON SOMEONE (PLAN_V2_WAITS; docs/plan-ease-people.md; design A6, B7). The person says "Rahul will send the
 * numbers by Thursday" (or taps "Add to my tasks" on a meeting's to-do that is Rahul's), and Plan Ease does the chasing: at 6 pm on
 * Thursday it asks "Still waiting on Rahul. Send this?" with the follow-up already written, and Send opens WhatsApp with it.
 *
 * A wait is one of the person's to-dos, of kind "wait" (calendar_tasks, migrations 0070 and 0073), so Today, Tasks, ticks and the Plan
 * Ease chat's tools see it with nothing new. On top of a to-do it keeps who it waits on, where a message to them goes (only a number or
 * an email that was in the words: never contacts), the follow-up, and when to check back.
 *
 *   PlanWaits.add(user, read, o)       a wait, from the box's words (planWaitWords.ts readWait) or a meeting's to-do (fromNote)
 *   open(user)                         their open waits (the Needs-you cards read these)
 *   sorted / unsort / send / came / notCame   the buttons (PLAN_ACTS below: the page, the widget and a notification alike)
 *   handoff(user, id, go)              the link Send (or a visit's No) opens: WhatsApp with the words, or the mail app
 *   tick()                             every minute: the check-backs that are due (one push each, then the next evening, 3 at most)
 *
 * WHAT IT PLUGS INTO (the foundation's seams, docs/plan-ease.md):
 *   plugWaits()  planSources.ts the person's open waits, for the cards (NeedsCtx.more.wait), whatever day they're on
 *   WAIT_NEEDS   planNeeds.ts   "Still waiting on Rahul. Send this?" [Send] [Sorted], the draft in a message; "Did the plumber come?" [Yes] [No]
 *   WAIT_ROWS    planRows.ts    "The numbers" / "Waiting on Rahul · by Thu", its tick is Sorted
 *   WAIT_SLOT    planBox.ts     the box's words, with "I'll check with you Thursday evening · Undo"
 *   WAIT_ACTS    planEase.ts    pt: sorted, unsort, send, came, notcame
 *   plan_wait, plan_came        planKinds.ts (x0_wait: Send opens the hand-off screen, Sorted answers at once; x0_came: Yes, No)
 *
 * After Send it checks again in 2 days; "Sorted" closes it; left alone it asks the next evening; after 3 check-backs it stays quietly
 * on the list. Nothing is ever sent for the person: Send opens WhatsApp with the words, and they press send there.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { BotError } from "../bots/types.js";
import { calendarRows, taskRow, type Source, type TaskRow, type TaskTable } from "../calendar/store.js";
import { DAY, MIN, dayOf } from "../calendar/words.js";
import { botTopic, TOPIC } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { no, ok, type ActResult } from "../widgets/act.js";
import type { QuickItem } from "../widgets/items.js";
import type { BoxReply, BoxSlot } from "./planBox.js";
import type { PlanAct } from "./planEase.js";
import type { NeedsCard, NeedsType } from "./planNeeds.js";
import type { DayItem, RowKind } from "./planRows.js";
import { lockSafe, looksHealth } from "./planSafe.js";
import { addPlanSource } from "./planSources.js";
import { planOn } from "./planSwitch.js";
import { MemoryTable } from "./rows.js";
import {
  CHECKS_MAX, afterSend, againAt, askWords, checkAt, draftOf, dueWord, endOfDay, handoffOf, notComingDraft, readWait, shortDay,
  waitFromTodo, type WaitRead,
} from "./planWaitWords.js";

/** A check-back this late (the server was down) is not pushed: the card still shows in the app. */
const LATE_MS = 6 * 60 * MIN;
/** Sorted waits are kept this long, then the daily clean-up takes them out. */
const KEEP_DONE_MS = 30 * DAY;
/** Open waits a person may have. */
const OPEN_MAX = 200;

/** A to-do row with step 4's columns (0073). */
export interface WaitRow extends TaskRow {
  who_name?: string | null; who_reach?: string | null; draft?: string | null;
  check_ms?: number | null; checks?: number; asked_ms?: number | null; sent_ms?: number | null; came?: boolean;
}

/** A wait as the cards and the hand-off read it. */
export interface WaitView {
  id: string; title: string; day: string | null; tz: number; done: boolean;
  who: string; reach: string; draft: string; came: boolean;
  check: number | null; checks: number; asked: number | null; sent: number | null;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function waitView(raw: WaitRow): WaitView {
  const r = taskRow(raw) as WaitRow;
  return {
    id: r.id, title: r.title, day: r.due_day, tz: r.tz_min, done: r.done,
    who: typeof raw.who_name === "string" ? raw.who_name : "", reach: typeof raw.who_reach === "string" ? raw.who_reach : "",
    draft: typeof raw.draft === "string" ? raw.draft : "", came: raw.came === true,
    check: numOrNull(raw.check_ms), checks: Number(raw.checks ?? 0) || 0, asked: numOrNull(raw.asked_ms), sent: numOrNull(raw.sent_ms),
  };
}

/** What a check-back push is sent with (the push engine's notify). */
export type WaitSend = (userId: string, msg: { kind: "plan_wait" | "plan_came"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

export interface WaitsDeps {
  /** The person's to-dos: the calendar's own table (calendar/store.ts), so a wait is on their days with no second copy. */
  tasks?: TaskTable;
  /** Supabase, for the job's reads across everyone (null: the table is in memory). */
  client?: SupabaseClient | null;
  now?: () => number;
  publish?: (userId: string) => void;
  send?: WaitSend | null;
  /** Plan Ease's six a day (planEase.ts policy.spend): a check-back counts. */
  spend?: ((userId: string, day: string) => Promise<boolean>) | null;
  /** The app's language for this person: the draft is written in Hinglish when it is. */
  hinglish?: ((userId: string) => Promise<boolean>) | null;
}

export class PlanWaits {
  private readonly tasks: TaskTable;
  private readonly client: SupabaseClient | null;
  private readonly now: () => number;
  private readonly publish: (userId: string) => void;
  private send: WaitSend | null;
  private spend: ((userId: string, day: string) => Promise<boolean>) | null;
  private hinglish: ((userId: string) => Promise<boolean>) | null;
  private lastClean = 0;

  constructor(d: WaitsDeps = {}) {
    this.tasks = d.tasks ?? calendarRows().tasks;
    this.client = d.client !== undefined ? d.client : this.tasks instanceof MemoryTable ? null : supabase();
    this.now = d.now ?? Date.now;
    this.publish = d.publish ?? ((userId) => livePublish(userId, [TOPIC.calendar, TOPIC.tasks, botTopic("plan"), TOPIC.home]));
    this.send = d.send ?? null;
    this.spend = d.spend ?? null;
    this.hinglish = d.hinglish ?? null;
  }

  /** The push engine, Plan Ease's day cap and the app's language (wired at boot: routes/bots/botsPlanPeople.ts). */
  wire(o: { send?: WaitSend | null; spend?: ((userId: string, day: string) => Promise<boolean>) | null; hinglish?: ((userId: string) => Promise<boolean>) | null }): void {
    if (o.send !== undefined) this.send = o.send;
    if (o.spend !== undefined) this.spend = o.spend;
    if (o.hinglish !== undefined) this.hinglish = o.hinglish;
  }

  private async hg(userId: string): Promise<boolean> {
    return this.hinglish ? this.hinglish(userId).catch(() => false) : false;
  }

  /** A wait on the person's list, checked back on by itself. `key`: one row per meeting to-do (a second add answers the first). */
  async add(userId: string, w: WaitRead, o: { tz: number; source?: Source; key?: string | null }): Promise<WaitView> {
    if (o.key) {
      const [had] = await this.tasks.select({ user_id: userId, source_key: o.key } as Partial<TaskRow>, { limit: 1 });
      if (had) return waitView(had as WaitRow);
    }
    if ((await this.tasks.select({ user_id: userId, kind: "wait", done: false } as Partial<TaskRow>, { limit: OPEN_MAX })).length >= OPEN_MAX) {
      throw new BotError("calendar_full", "You're waiting on a lot already. Sort some out first.", 409);
    }
    const now = this.now();
    const check = checkAt(w, now, o.tz);
    const row: WaitRow = {
      id: randomUUID(), user_id: userId, title: w.title.slice(0, 120), notes: `Waiting on ${w.who}.`.slice(0, 1000), list: "",
      // On the list on the day it's checked: "Waiting on Rahul · by Thu".
      due_day: dayOf(check, o.tz), due_ms: null, tz_min: o.tz, done: false, done_ms: null,
      // No to-do reminder: the check-back is its reminder.
      remind_min: null, next_remind_ms: null,
      source: o.source ?? { kind: "me" }, source_key: o.key ?? null, created_ms: now, updated_ms: now,
      kind: "wait", who_name: w.who.slice(0, 60), who_reach: w.reach, draft: draftOf(w, await this.hg(userId)).slice(0, 600),
      check_ms: check, checks: 0, asked_ms: null, sent_ms: null, came: w.came,
    };
    await this.tasks.insert(row);
    this.publish(userId);
    return waitView(row);
  }

  /** A meeting's to-do that is someone else's (its "who" is a real name), as a wait: "Add to my tasks" on it, from the Notes page. */
  async fromNote(userId: string, b: { noteId: string; todoId: string; noteTitle: string; text: string; who?: string; when?: string; people?: ReadonlyArray<{ label: string; name?: string }>; tz: number }): Promise<WaitView | null> {
    const w = waitFromTodo({ text: b.text, ...(b.who ? { who: b.who } : {}), ...(b.when ? { when: b.when } : {}) }, b.people ?? [], this.now(), b.tz);
    if (!w) return null;
    return this.add(userId, w, { tz: b.tz, source: { kind: "note", noteId: b.noteId, todoId: b.todoId, title: b.noteTitle.slice(0, 80) }, key: `note:${b.noteId}:${b.todoId}` });
  }

  /** The person's open waits, as the cards read them. */
  async open(userId: string): Promise<WaitView[]> {
    return (await this.tasks.select({ user_id: userId, kind: "wait", done: false } as Partial<TaskRow>, { limit: OPEN_MAX })).map((r) => waitView(r as WaitRow));
  }

  private async own(userId: string, id: string): Promise<WaitRow> {
    const [r] = /^[0-9a-f-]{36}$/i.test(id) ? await this.tasks.select({ id, user_id: userId } as Partial<TaskRow>, { limit: 1 }) : [];
    if (!r || (r as WaitRow).kind !== "wait") throw new BotError("not_found", "That isn't there any more.", 404);
    return r as WaitRow;
  }

  private async change(userId: string, id: string, patch: Partial<WaitRow>): Promise<void> {
    await this.tasks.update({ id, user_id: userId } as Partial<TaskRow>, { ...patch, updated_ms: this.now() } as Partial<TaskRow>);
    this.publish(userId);
  }

  /** "Sorted": it came in. Closed, no more check-backs. */
  async sorted(userId: string, id: string): Promise<void> {
    const r = await this.own(userId, id);
    if (r.done) return;
    await this.change(userId, id, { done: true, done_ms: this.now(), check_ms: null });
  }

  /** Undo "Sorted" (or a visit's Yes): open again, asked again the next evening unless it already asked three times. */
  async unsort(userId: string, id: string): Promise<void> {
    const r = waitView(await this.own(userId, id));
    await this.change(userId, id, { done: false, done_ms: null, check_ms: r.checks < CHECKS_MAX ? againAt(this.now(), r.tz, r.came) : null });
  }

  /** Send: WhatsApp (or mail) opens with the follow-up; it checks again in 2 days. The link, for the screen to open. */
  async sent(userId: string, id: string): Promise<string> {
    const r = waitView(await this.own(userId, id));
    const now = this.now();
    if (!r.done) await this.change(userId, id, { sent_ms: now, check_ms: r.checks < CHECKS_MAX ? afterSend(now, r.tz) : null });
    return handoffOf(r.draft || draftOf({ who: r.who, thing: "", verb: "", came: false }), r.reach);
  }

  /** "Did the plumber come?" Yes. */
  async came(userId: string, id: string): Promise<void> { await this.sorted(userId, id); }

  /** No: WhatsApp opens with "Hi, are you coming today?", and it asks again the next afternoon. The link. */
  async notCame(userId: string, id: string): Promise<string> {
    const r = waitView(await this.own(userId, id));
    const now = this.now();
    if (!r.done) await this.change(userId, id, { sent_ms: now, check_ms: r.checks < CHECKS_MAX ? againAt(now, r.tz, true) : null });
    return handoffOf(notComingDraft(r.who, await this.hg(userId)), r.reach);
  }

  /** The link Send (go "send") or a visit's No (go "notcame") opens, without changing anything: for the hand-off screen to show. */
  async handoff(userId: string, id: string, go: string): Promise<string> {
    const r = waitView(await this.own(userId, id));
    if (go === "notcame") return handoffOf(notComingDraft(r.who, await this.hg(userId)), r.reach);
    return handoffOf(r.draft || draftOf({ who: r.who, thing: "", verb: "", came: false }), r.reach);
  }

  // ------------------------------------------------------------------ the job

  /** Open waits whose check-back is due, across everyone, soonest first. */
  private async due(now: number, limit: number): Promise<WaitRow[]> {
    if (this.tasks instanceof MemoryTable) {
      return (this.tasks as MemoryTable<TaskRow>).rows
        .filter((r) => (r as WaitRow).kind === "wait" && !r.done && numOrNull((r as WaitRow).check_ms) !== null && Number((r as WaitRow).check_ms) <= now)
        .sort((a, b) => Number((a as WaitRow).check_ms) - Number((b as WaitRow).check_ms)).slice(0, limit)
        .map((r) => JSON.parse(JSON.stringify(r)) as WaitRow);
    }
    if (!this.client) return [];
    const { data, error } = await this.client.from("calendar_tasks").select("*").eq("kind", "wait").eq("done", false)
      .not("check_ms", "is", null).lte("check_ms", now).order("check_ms").limit(limit);
    if (error) throw new Error(`calendar_tasks waits: ${error.message}`);
    return (data ?? []) as WaitRow[];
  }

  /** Sorted waits past their 30 days: out, once a day. */
  private async clean(now: number): Promise<void> {
    if (now - this.lastClean < DAY) return;
    this.lastClean = now;
    const before = now - KEEP_DONE_MS;
    if (this.tasks instanceof MemoryTable) {
      const t = this.tasks as MemoryTable<TaskRow>;
      for (const r of t.rows.filter((x) => (x as WaitRow).kind === "wait" && x.done && Number(x.done_ms ?? now) < before)) await t.remove({ id: r.id } as Partial<TaskRow>);
      return;
    }
    await this.client?.from("calendar_tasks").delete().eq("kind", "wait").eq("done", true).lt("done_ms", before);
  }

  /**
   * Every minute: each check-back that is due. Claimed by moving check_ms on (to the next evening, or none after the third), so two
   * servers never send one twice; then one push: "Still waiting on Rahul" [Send] [Sorted], or "Did the plumber come?" [Yes] [No].
   */
  async tick(limit = 200): Promise<number> {
    if (!planOn("waits")) return 0;
    const now = this.now();
    let sent = 0;
    for (const raw of await this.due(now, limit)) {
      const r = waitView(raw);
      const was = r.check!;
      const checks = r.checks + 1;
      const next = checks < CHECKS_MAX ? againAt(now, r.tz, r.came) : null;
      const claimed = await this.tasks.update({ id: r.id, check_ms: was } as Partial<TaskRow>, { check_ms: next, checks, asked_ms: now, updated_ms: now } as Partial<TaskRow>);
      if (!claimed) continue;
      this.publish(raw.user_id);
      if (now - was > LATE_MS || !this.send) continue;
      // Plan Ease's own push: it counts toward the day's six (the card is in the app either way).
      if (this.spend && !(await this.spend(raw.user_id, dayOf(now, r.tz)).catch(() => true))) continue;
      const words = checkBackWords(r, now);
      await this.send(raw.user_id, {
        kind: r.came ? "plan_came" : "plan_wait", key: `${r.id}:${checks}`, vars: words,
        data: { item: `pt:${r.id}`, ...(r.day ? { day: r.day } : {}), go: r.came ? "notcame" : "send" },
      }).catch(() => undefined);
      sent += 1;
    }
    await this.clean(now).catch(() => undefined);
    return sent;
  }

  /** The job, every minute. Returns the stop. */
  start(log?: { warn: (o: object, m: string) => void }): () => void {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.tick().catch((err) => log?.warn({ err: (err as Error)?.message }, "plan ease: waits")).finally(() => { busy = false; });
    }, 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

// ------------------------------------------------------------------ words outside the app (lock-safe: planSafe.ts)

/** Who, as a push or the widget may say it: a name, never a health word ("Dr. Mehta" is "a reply"). */
const whoOut = (w: Pick<WaitView, "who" | "title">): string => (looksHealth(w.who) || looksHealth(w.title) ? "a reply" : w.who);

/** The check-back's push: "Still waiting on Rahul" / "The numbers were due today."; "Did the plumber come?" / "They said today." */
export function checkBackWords(w: WaitView, now: number): { title: string; body: string } {
  const day = dueWord(w.day ?? dayOf(now, w.tz), now, w.tz);
  if (w.came) {
    const who = whoOut(w);
    const thing = /^the (?:delivery|courier|parcel|package|order|gas cylinder|cylinder|water can)$/i.test(w.who);
    return { title: lockSafe(`Did ${who === "a reply" ? "they" : who} come?`, 60), body: lockSafe(thing ? `It was due ${day}.` : `They said ${day}.`, 80) };
  }
  const health = looksHealth(w.title) || looksHealth(w.who);
  const plural = /s$/i.test(w.title) && !/(?:ss|us|is)$/i.test(w.title);
  const body = health || /^Hear back from /.test(w.title) ? `They said ${day}.` : `${w.title} ${plural ? "were" : "was"} due ${day}.`;
  return { title: lockSafe(`Still waiting on ${whoOut(w)}`, 60), body: lockSafe(body, 100) };
}

// ------------------------------------------------------------------ the shared one

let shared: PlanWaits | null = null;

/** The server's (wired at boot over the calendar's table); one over that same table until then. */
export function planWaits(): PlanWaits { return (shared ??= new PlanWaits()); }
export function setPlanWaits(w: PlanWaits | null): void { shared = w; }

// ================================================================== THE SEAMS

/** The hand-off screen (experience/bots/ids.ts planSend): WhatsApp or the mail app with the words, then back to the page. */
const SEND_SCREEN = "bots.plan.send";

/** The card shows from a check-back until the next one (or a day after the last), unless Send or Sorted answered it. */
function waitCard(w: WaitView, now: number): NeedsCard | null {
  if (w.done || w.checks < 1 || w.asked === null || (w.sent !== null && w.sent >= w.asked)) return null;
  const until = w.check ?? (w.came ? endOfDay(dayOf(w.asked, w.tz), w.tz) : w.asked + DAY);
  if (until <= now) return null;
  const item = `pt:${w.id}`;
  if (w.came) {
    const who = whoOut(w);
    const day = dueWord(w.day ?? dayOf(w.asked, w.tz), now, w.tz);
    return {
      type: "came", key: `came:${w.id}:${w.checks}`, until: Math.min(until, endOfDay(dayOf(w.asked, w.tz), w.tz)),
      question: `Did ${who === "a reply" ? "they" : who} come?`, outside: `Did ${who === "a reply" ? "they" : who} come?`, reason: `They said ${day}.`, item,
      buttons: [
        { id: "came", label: "Yes", primary: true, done: "Good. That's sorted.", undo: "unsort" },
        { id: "notcame", label: "No", open: { screen: SEND_SCREEN, params: { item, go: "notcame", from: "page" } } },
      ],
    };
  }
  return {
    type: "wait", key: `wait:${w.id}:${w.checks}`, until, question: `Still waiting on ${whoOut(w)}. Send this?`, outside: `Still waiting on ${whoOut(w)}`, reason: "",
    ...(w.draft ? { message: w.draft } : {}), item,
    buttons: [
      { id: "send", label: "Send", primary: true, open: { screen: SEND_SCREEN, params: { item, go: "send", from: "page" } } },
      { id: "sorted", label: "Sorted", done: "Sorted", undo: "unsort" },
    ],
  };
}

/** The person's open waits beside their days (planSources.ts), for the cards: once at start. */
export function plugWaits(): void {
  addPlanSource({ name: "wait", more: async (userId) => (planOn("waits") ? planWaits().open(userId) : []) });
}

/**
 * The Needs-you cards (planNeeds.ts LATER_TYPES): "Still waiting on Rahul. Send this?" with the draft in a message and [Send] [Sorted],
 * and a visit's "Did the plumber come?" [Yes] [No]. Send and No open the hand-off screen (WhatsApp with the words), so the widget
 * shows only what answers in place, and the evening note asks the question with no buttons (the card has no category).
 */
export const WAIT_NEEDS: NeedsType = {
  type: "wait", step: 4, tie: 1,
  find(ctx) {
    if (!planOn("waits")) return [];
    const waits = (ctx.more?.wait as WaitView[] | undefined) ?? [];
    return waits.map((w) => waitCard(w, ctx.now)).filter((c): c is NeedsCard => !!c);
  },
};

/** A wait's row (planRows.ts STEP_4_ROWS): "The numbers" / "Waiting on Rahul · by Thu", its tick is Sorted. */
export const WAIT_ROW: RowKind = {
  kind: "wait", step: 4,
  match: (it: DayItem) => it.ref === "task" && it.kind === "wait" && planOn("waits"),
  row(it, ctx) {
    const today = dayOf(ctx.now, ctx.tz);
    const who = it.who ?? "";
    const by = !it.day || it.day === today ? "today" : `by ${shortDay(it.day)}`;
    return {
      id: `t:${it.id}`, kind: "wait", time: "",
      tick: { item: `pt:${it.id}`, action: it.done ? "unsort" : "sorted", label: it.done ? `${it.title}. Sorted. Tap to put it back.` : `${it.title}. Tap when it's sorted.` },
      title: it.title, line: it.done ? "" : ctx.clashes.get(it.id) ?? (who ? `Waiting on ${who} · ${by}` : `Waiting · ${by}`),
      done: it.done, open: { kind: "task", id: it.id },
      at: it.start ?? (Date.parse(`${it.day}T00:00:00Z`) + 23 * 60 * MIN),
    };
  },
};

/** The box (planBox.ts STEP_4_WAIT): "Rahul will send the numbers by Thursday" is a wait, with when it'll ask and Undo. */
export const WAIT_SLOT: BoxSlot<WaitRead> = {
  slot: "wait", step: 4,
  read: (words, ctx) => (planOn("waits") ? readWait(words, ctx.now, ctx.tz) : null),
  async run(w, _words, ctx): Promise<BoxReply> {
    const v = await planWaits().add(ctx.userId, w, { tz: ctx.tz });
    const when = askWords(v.check ?? ctx.now, ctx.now, ctx.tz);
    return { slot: "wait", kind: "added", line: w.came ? `I'll ask you ${when}` : `I'll check with you ${when}`, undo: { item: `pt:${v.id}`, action: "undo" } };
  },
};

const idOf = (item: QuickItem): string => (item.kind === "pt" ? item.taskId : "");
const off = (): ActResult => no(404, "off", "That isn't there any more.");

/**
 * The buttons (planEase.ts PLAN_ACTS, on pt: items). Send needs the app (it opens WhatsApp there, and a widget can't), so a widget is
 * told to open X0; Sorted and Yes answer in place.
 */
export const WAIT_ACTS: Record<string, PlanAct> = {
  sorted: { scope: "task.done", run: async (_p, u, i) => { if (!planOn("waits")) return off(); await planWaits().sorted(u, idOf(i)); return ok("sorted"); } },
  unsort: { scope: "session", run: async (_p, u, i) => { if (!planOn("waits")) return off(); await planWaits().unsort(u, idOf(i)); return ok("undone"); } },
  send: { scope: "session", run: async (_p, u, i) => { if (!planOn("waits")) return off(); return ok("sent", { url: await planWaits().sent(u, idOf(i)) }); } },
  came: { scope: "needs.answer", run: async (_p, u, i) => { if (!planOn("waits")) return off(); await planWaits().came(u, idOf(i)); return ok("sorted"); } },
  notcame: { scope: "session", run: async (_p, u, i) => { if (!planOn("waits")) return off(); return ok("asked", { url: await planWaits().notCame(u, idOf(i)) }); } },
};
