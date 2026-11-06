/**
 * PLAN EASE, STEP 5: FAMILY ASKS, REPEATS AND TURNS (PLAN_V2_ASKS, and only while Spaces is on; docs/plan-ease-people.md; design A7, B8).
 *
 * Priya types "Who picks Kabir up Wednesday?" in Plan Ease's box. A preview comes first ("Ask Ghar: who picks Kabir up Wednesday?"
 * [Ask]); nothing goes to anyone until she taps. Then everyone else in the space gets one push and a Needs-you card with her tiny bot,
 * [I'll do it]. The first tap wins: it lands on that person's day as "Kabir pickup" with Priya's tiny bot, Priya hears quietly who
 * took it, and the other cards go. Halfway to the take-by the family gets one quiet nudge by itself; if nobody took it by then, Priya
 * hears "Nobody's taken Wednesday's pickup yet" [I'll do it], and it stays open for the family until the time.
 *
 * "Arjun and Rohan take turns watering the plants every Sunday" sets up turns in the order named; with no names it asks "Who's in?"
 * and the turns go in the order people tapped. Each turn lands on that person's Sunday ("Plants · your turn") with one push the evening
 * before, [Can't do it], which passes it to the next. Doing nothing means they're doing it; a Done moves the turn on.
 *
 * THE DATA. An ask is a space task of kind "ask" (space_tasks, migration 0074): `assignees` holds who may take it while it is open, and
 * once taken it is that one person's, an ordinary task in the space ("their Done answers as today"). It is never posted to the space's
 * chat and never sends "Priya gave you a task": the ask's own push is the one ping. An open ask lands on nobody's day (spaceTasks.ts
 * leaves asks to this module).
 *
 *   PlanAsks.preview(user, read, words, tz)   the box's preview (planBox.ts STEP_5_FIRST): draft rows, sent by [Ask]
 *   send / take / untake / in / unin / cant   the buttons (PLAN_ACTS.stask below), from the page, the widget and a notification alike
 *   answered(user, row, status)               a Done or a "Can't do it" from the person's day or the space (spaceTasks.ts onAnswer)
 *   cardsFor(user)                            the Needs-you cards (ASK_NEEDS) and the evening note's "who's doing what" lines
 *   tick()                                    every minute: the nudge, the take-by, a turn's evening-before push, the next week
 *
 * Every word that leaves the app is made from the ask's parts (planAskWords.ts), lock-safe: no amount, a health visit is plain.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { calendar } from "../calendar/index.js";
import { DAY, MIN, dayOf, minuteOf, startOfDay } from "../calendar/words.js";
import { botTopic, TOPIC } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import { noticeGone } from "../live/notices.js";
import { no, ok, type ActResult } from "../widgets/act.js";
import { itemId, type QuickItem } from "../widgets/items.js";
import { looksIn, shownLook, type PersonLook } from "./personLook.js";
import type { BoxReply, BoxSlot } from "./planBox.js";
import type { PlanAct } from "./planEase.js";
import type { NeedsCard, NeedsType } from "./planNeeds.js";
import { addPlanSource } from "./planSources.js";
import { planOn } from "./planSwitch.js";
import { MemoryTable } from "./rows.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import type { MemberRow, Spaces } from "./spaces.js";
import { spacesOn } from "./spacesSwitch.js";
import type { SpaceDays, TaskRow } from "./spaceTasks.js";
import {
  askQuestion, askReason, clockOf, dayLong, daysWords, eveBefore, everyWords, lateWords, noneWords, nextDayOf, nudgeAtOf, readAsk,
  takeByOf, takenWords, thirdPerson, turnWords, untilOf, whoLine, type AskRead, type AskRepeat,
} from "./planAskWords.js";

/** An unsent preview is kept this long. */
const DRAFT_MS = DAY;
/** "I'll do it" can be undone this long after (the page's 10 seconds, with room for a slow network). */
const UNTAKE_MS = 2 * 60 * MIN;
/** Asks read in one space. */
const SPACE_ASKS_MAX = 300;

/** What the ask's words were made into (space_tasks.ask). Ids and short words only. */
export interface AskBits {
  /** The doing, base form ("pick Kabir up"): every question is made from it. */
  base?: string;
  /** Days asked at once are one ask each: the first one's id, so one tap on Ask sends them all. */
  batch?: string;
  /** Turns with no names yet ("Who's in?"). */
  open?: boolean;
  /** The asker's offset: the days and evenings are theirs. */
  tz?: number;
  /** This time: who said they can't (a turn passes to the next). */
  cant?: string[];
  /** Who did it last time (turns). */
  last?: { id: string; name: string } | null;
  /** The time (at_ms) whose evening-before turn push went. */
  told?: number | null;
  /** Who it was passed on from this time ("Arjun can't this time"). */
  passedBy?: string | null;
}

/** A space task with step 5's columns (0074). */
export interface AskRow extends TaskRow {
  asked_ms?: number | null; take_by_ms?: number | null; nudged_ms?: number | null; taken_by?: string | null; taken_ms?: number | null;
  repeat?: AskRepeat | null; turns?: { order: string[]; next: number } | null; told_ms?: number | null; next_ms?: number | null; ask?: AskBits;
}

const n = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const obj = <T>(v: unknown): T | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null);

/** Supabase hands bigints back as strings or numbers: one shape either way. */
export function askRow(r: AskRow): AskRow {
  const turns = obj<{ order?: unknown; next?: unknown }>(r.turns);
  return {
    ...r, at_ms: n(r.at_ms), end_ms: n(r.end_ms), all_day: r.all_day === true, assignees: Array.isArray(r.assignees) ? r.assignees : [],
    states: obj(r.states) ?? {}, created_ms: Number(r.created_ms) || 0, updated_ms: Number(r.updated_ms) || 0,
    asked_ms: n(r.asked_ms), take_by_ms: n(r.take_by_ms), nudged_ms: n(r.nudged_ms), taken_by: typeof r.taken_by === "string" ? r.taken_by : null,
    taken_ms: n(r.taken_ms), told_ms: n(r.told_ms), next_ms: n(r.next_ms), repeat: obj<AskRepeat>(r.repeat),
    turns: turns ? { order: Array.isArray(turns.order) ? (turns.order as string[]) : [], next: Number(turns.next) || 0 } : null,
    ask: obj<AskBits>(r.ask) ?? {},
  };
}

const tzOf = (r: AskRow): number => (Number.isFinite(Number(r.ask?.tz)) ? Number(r.ask!.tz) : 330);
const dayOfAsk = (r: AskRow): string => dayOf(r.at_ms ?? r.created_ms, tzOf(r));
const timeOf = (r: AskRow): number | null => (r.all_day || r.at_ms === null ? null : minuteOf(r.at_ms!, tzOf(r)));
const untilOfAsk = (r: AskRow): number => untilOf(dayOfAsk(r), timeOf(r), tzOf(r));
const isOpenTurns = (r: AskRow): boolean => !!r.turns && r.ask?.open === true;

/**
 * When the job should next look at an ask: an unsent preview's end; while open, the nudge, then the take-by, then its time; taken, a
 * turn's evening before and (repeating) its time, to go on to the next one. Null: nothing more to do.
 */
export function nextLookOf(r: AskRow): number | null {
  if (!r.asked_ms) return r.created_ms + DRAFT_MS;
  const until = untilOfAsk(r);
  const times: number[] = [];
  if (!r.taken_by) {
    const nudge = r.take_by_ms ? nudgeAtOf(r.asked_ms, r.take_by_ms) : null;
    if (nudge !== null && !r.nudged_ms) times.push(nudge);
    if (r.take_by_ms && !r.told_ms) times.push(r.take_by_ms);
    times.push(until);
  } else {
    if (r.turns && r.ask?.told !== r.at_ms) times.push(eveBefore(dayOfAsk(r), tzOf(r)));
    if (r.repeat || r.turns) times.push(until);
  }
  return times.length ? Math.min(...times) : null;
}

// ------------------------------------------------------------------ the store

/** The space_tasks table, as asks need it: a space's asks, a take only while nobody has it, the job's due rows. */
export class AskStore {
  constructor(readonly rows: PagedTable<AskRow>, private readonly client: SupabaseClient | null) {}

  async inSpace(spaceId: string): Promise<AskRow[]> {
    return (await this.rows.select({ space_id: spaceId, kind: "ask" } as Partial<AskRow>, { limit: SPACE_ASKS_MAX })).map(askRow);
  }

  async one(spaceId: string, id: string): Promise<AskRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [r] = await this.rows.select({ id, space_id: spaceId } as Partial<AskRow>, { limit: 1 });
    return r && r.kind === "ask" ? askRow(r) : null;
  }

  /** The first tap wins: changed only while nobody has taken it. */
  async take(id: string, patch: Partial<AskRow>): Promise<boolean> {
    if (this.rows instanceof MemoryTable) {
      const r = (this.rows as MemoryTable<AskRow>).rows.find((x) => x.id === id && !x.taken_by);
      if (!r) return false;
      Object.assign(r, JSON.parse(JSON.stringify(patch)));
      return true;
    }
    if (!this.client) return false;
    const { data, error } = await this.client.from("space_tasks").update(patch).eq("id", id).is("taken_by", null).select("id");
    if (error) throw new Error(`space_tasks take: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async due(now: number, limit: number): Promise<AskRow[]> {
    if (this.rows instanceof MemoryTable) {
      return (this.rows as MemoryTable<AskRow>).rows.filter((r) => r.kind === "ask" && n(r.next_ms) !== null && Number(r.next_ms) <= now)
        .sort((a, b) => Number(a.next_ms) - Number(b.next_ms)).slice(0, limit).map((r) => askRow(JSON.parse(JSON.stringify(r)) as AskRow));
    }
    if (!this.client) return [];
    const { data, error } = await this.client.from("space_tasks").select("*").eq("kind", "ask").not("next_ms", "is", null).lte("next_ms", now).order("next_ms").limit(limit);
    if (error) throw new Error(`space_tasks asks: ${error.message}`);
    return ((data ?? []) as AskRow[]).map(askRow);
  }
}

// ------------------------------------------------------------------ the service

export type AskPushKind = "space_ask" | "space_ask_nudge" | "space_ask_none" | "space_ask_taken" | "space_turn";
export type AskNotify = (userId: string, msg: { kind: AskPushKind; key: string; vars: Record<string, string>; data: Record<string, string>; category?: string }) => Promise<unknown>;

/** A family space of the person's: one with someone else in it. */
interface Family { id: string; name: string; members: MemberRow[] }

/** The card data the page, the widget, Today and the evening note read. */
export interface AskCards { cards: NeedsCard[]; lines: Record<string, string[]> }

export class PlanAsks {
  readonly store: AskStore;
  private readonly now: () => number;
  private readonly days: SpaceDays | null;
  private notify: AskNotify | null;
  private readonly publish: (userIds: Iterable<string>) => void;
  /** Who has a block between them and someone (blocks.ts): never asked by them, never their ask's push. */
  private readonly blocks: { hiddenFor(viewer: string): Promise<Set<string>> } | null;

  constructor(private readonly spaces: Spaces, o: {
    rows?: PagedTable<AskRow>; client?: SupabaseClient | null; now?: () => number; days?: SpaceDays | null; notify?: AskNotify | null;
    publish?: (userIds: Iterable<string>) => void; blocks?: { hiddenFor(viewer: string): Promise<Set<string>> } | null;
  } = {}) {
    const rows = o.rows ?? spaceTable<AskRow>("space_tasks");
    this.store = new AskStore(rows, o.client !== undefined ? o.client : rows instanceof MemoryTable ? null : supabase());
    this.now = o.now ?? Date.now;
    this.days = o.days !== undefined ? o.days : calendar();
    this.notify = o.notify ?? null;
    this.blocks = o.blocks ?? null;
    this.publish = o.publish ?? ((ids) => { for (const id of new Set(ids)) livePublish(id, [botTopic("plan"), TOPIC.home]); });
  }

  /** The push engine (wired at boot: routes/bots/botsPlanPeople.ts). */
  wire(o: { notify?: AskNotify | null }): void { if (o.notify !== undefined) this.notify = o.notify; }

  private on(): boolean { return planOn("asks") && spacesOn(); }

  private async push(userId: string, kind: AskPushKind, r: AskRow, words: { title: string; body: string }, key: string, category?: string): Promise<void> {
    if (!this.notify) return;
    await this.notify(userId, {
      kind, key: `${r.id}:${key}`.slice(0, 120), vars: words,
      data: { spaceId: r.space_id, taskId: r.id, item: `stask:${r.space_id}:${r.id}` }, ...(category ? { category } : {}),
    }).catch(() => undefined);
  }

  /** The person's spaces with someone else in them: where a family ask can go. */
  async family(userId: string): Promise<Family[]> {
    const out: Family[] = [];
    for (const s of await this.spaces.mine(userId)) {
      const members = await this.spaces.memberRows(s.id);
      if (members.some((m) => m.user_id !== userId)) out.push({ id: s.id, name: s.name, members });
    }
    return out;
  }

  private nameIn(f: Pick<Family, "members">, id: string | null | undefined, fallback = "Someone"): string {
    return f.members.find((m) => m.user_id === id)?.name ?? fallback;
  }

  /**
   * Everyone in the space but the asker: who an open ask is for. Never someone with a block between them and the asker, either way
   * round: a block means neither hears from the other, an ask and its push included.
   */
  private async others(f: Pick<Family, "members">, asker: string): Promise<string[]> {
    const hidden = this.blocks ? await this.blocks.hiddenFor(asker).catch(() => new Set<string>()) : new Set<string>();
    return f.members.map((m) => m.user_id).filter((id) => id !== asker && !hidden.has(id)).slice(0, 20);
  }

  private async land(r: AskRow, userId: string, spaceName: string): Promise<void> {
    if (!this.days) return;
    const turns = !!r.turns;
    const timed = !r.all_day && r.at_ms !== null;
    // A timed ask lands as a plan (its time on the left); a day's chore or a turn as a to-do, whose tick is their Done.
    await this.days.landSpace(userId, {
      taskId: r.id, spaceId: r.space_id, spaceName, kind: timed && !turns ? "plan" : "task",
      title: turns ? `${r.title} · your turn` : r.title, notes: r.notes, place: r.place, at: r.at_ms, end: timed ? r.end_ms ?? r.at_ms! + 30 * MIN : null,
      allDay: !timed, by: r.set_by, name: r.set_by === userId ? "You" : r.set_name, done: false,
    }).catch(() => undefined);
  }

  // ------------------------------------------------------------------ the box's preview, and Ask

  /** Which space: the one the words name, else the one they ask in most (then the biggest, then the first). */
  private async pick(userId: string, fam: Family[], named: string): Promise<Family> {
    const want = named.toLowerCase();
    const hit = want ? fam.find((f) => f.name.toLowerCase() === want) ?? fam.find((f) => f.name.toLowerCase().startsWith(want)) : undefined;
    if (hit || fam.length === 1) return hit ?? fam[0]!;
    const since = this.now() - 60 * DAY;
    const used = await Promise.all(fam.map(async (f) => (await this.store.inSpace(f.id)).filter((r) => r.set_by === userId && r.created_ms >= since).length));
    return [...fam].map((f, i) => ({ f, i, used: used[i]! })).sort((a, b) => b.used - a.used || b.f.members.length - a.f.members.length || a.i - b.i)[0]!.f;
  }

  /**
   * The box's words, shown first and sent by nobody: draft rows (one a day), and "Ask Ghar: who picks Kabir up Wed and Thu at 1 pm?"
   * [Ask]. Not in a space with anyone: the chat answers, as before.
   */
  async preview(userId: string, read: AskRead, words: string, tz: number): Promise<BoxReply> {
    if (!this.on()) return { slot: "chat", kind: "chat", line: "" };
    const fam = await this.family(userId);
    if (!fam.length) return { slot: "chat", kind: "chat", line: "" };
    const f = await this.pick(userId, fam, read.space);
    const now = this.now();
    const me = f.members.find((m) => m.user_id === userId);
    const myName = me?.name ?? "Someone";
    // Named turns: each name someone in the space ("me" is the asker).
    let order: string[] = [];
    if (read.turns?.names.length) {
      for (const name of read.turns.names) {
        if (name === "me") { order.push(userId); continue; }
        const first = name.split(" ")[0]!.toLowerCase();
        const m = f.members.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? f.members.find((x) => x.name.toLowerCase().split(" ")[0] === first);
        if (!m) return { slot: "ask", kind: "said", line: `I can't find ${name} in ${f.name}.`, edit: words };
        order.push(m.user_id);
      }
      order = [...new Set(order)];
    }
    const others = await this.others(f, userId);
    if (!others.length && !order.length) return { slot: "chat", kind: "chat", line: "" };
    // A new preview takes the place of an unsent one.
    for (const r of await this.store.inSpace(f.id)) if (r.set_by === userId && !r.asked_ms) await this.store.rows.remove({ id: r.id } as Partial<AskRow>);
    const days = read.days.filter((d) => untilOf(d, read.time, tz) > now);
    if (!days.length) return { slot: "ask", kind: "said", line: "That time has passed. Say another day.", edit: words };
    const batch = randomUUID();
    const question = (day: string) => (read.turns && order.length
      ? `${read.title} ${everyWords(read.repeat!)}, taking turns.`
      : askQuestion({ base: read.base, title: read.title, day, repeat: read.repeat, openTurns: !!read.turns }, now, tz));
    for (const [i, day] of (read.turns ? days.slice(0, 1) : days).entries()) {
      const at = startOfDay(day, tz) + (read.time ?? 0) * MIN;
      const row: AskRow = {
        id: i === 0 ? batch : randomUUID(), space_id: f.id, kind: "ask", title: read.title.slice(0, 120), notes: question(day).slice(0, 1000),
        assignees: order.length ? order : others, states: {}, set_by: userId, set_name: myName.slice(0, 40),
        at_ms: at, end_ms: read.time !== null ? at + 30 * MIN : null, all_day: read.time === null, place: read.place.slice(0, 80),
        created_ms: now, updated_ms: now,
        asked_ms: null, take_by_ms: null, nudged_ms: null, taken_by: null, taken_ms: null, repeat: read.repeat,
        turns: read.turns ? { order, next: 0 } : null, told_ms: null, next_ms: now + DRAFT_MS,
        ask: { base: read.base, batch, ...(read.turns && !order.length ? { open: true } : {}), tz, cant: [] },
      };
      await this.store.rows.insert(row);
    }
    const at = read.time !== null ? ` at ${clockOf(read.time)}` : "";
    let line: string;
    if (read.turns && order.length) line = `Ask ${f.name}: ${read.title.toLowerCase()} ${everyWords(read.repeat!)}, ${order.map((id) => (id === userId ? "you" : this.nameIn(f, id))).join(" then ")}?`;
    else if (read.turns) line = `Ask ${f.name}: ${question(days[0]!)}`;
    else if (read.repeat) line = `Ask ${f.name} ${everyWords(read.repeat)}: who ${thirdPerson(read.base.split(" ")[0]!)}${read.base.includes(" ") ? ` ${read.base.split(" ").slice(1).join(" ")}` : ""}${at}?`;
    else line = `Ask ${f.name}: who ${thirdPerson(read.base.split(" ")[0]!)}${read.base.includes(" ") ? ` ${read.base.split(" ").slice(1).join(" ")}` : ""} ${daysWords(days, now, tz)}${at}?`;
    return { slot: "ask", kind: "said", line, act: { item: `stask:${f.id}:${batch}`, action: "ask", label: "Ask" }, edit: words };
  }

  /** [Ask]: the preview goes to the family (or the named turns are set up). The line that takes the preview's place. */
  async send(userId: string, spaceId: string, id: string): Promise<ActResult> {
    if (!this.on()) return no(404, "off", "That isn't there any more.");
    const a = await this.spaces.access(userId, spaceId);
    const lead = await this.store.one(spaceId, id);
    if (!lead || lead.set_by !== userId) return no(404, "not_found", "That ask isn't there any more. Type it again.");
    const members = await this.spaces.memberRows(spaceId);
    const f = { members };
    const batch = lead.ask?.batch ?? lead.id;
    const rows = (await this.store.inSpace(spaceId)).filter((r) => r.set_by === userId && (r.ask?.batch ?? r.id) === batch);
    const now = this.now();
    let firstTakeBy: number | null = null, sent = 0;
    const tell = new Set<string>([userId]);
    const everyone = await this.others(f, userId);
    for (const r0 of rows) {
      if (r0.asked_ms) { sent += 1; continue; }
      if (untilOfAsk(r0) <= now) { await this.store.rows.remove({ id: r0.id } as Partial<AskRow>); continue; }
      const tz = tzOf(r0), day = dayOfAsk(r0);
      // Who it's for now (people may have come or gone since the preview); named turns keep their names, those still here.
      const order = r0.turns ? r0.turns.order.filter((u) => members.some((m) => m.user_id === u) && (u === userId || everyone.includes(u))) : [];
      const named = !!r0.turns && !r0.ask?.open;
      // Named turns are told the evening before; an ask (or "Who's in?") has its take-by.
      const takeBy = named ? eveBefore(day, tz) : takeByOf(day, timeOf(r0), tz, now);
      if (named && !order.length) continue;
      const r: AskRow = {
        ...r0, asked_ms: now, take_by_ms: takeBy, updated_ms: now,
        ...(named
          ? { taken_by: order[0]!, taken_ms: now, assignees: [order[0]!], states: { [order[0]!]: { status: "todo", note: "", at: now } }, turns: { order, next: 0 } }
          : { assignees: everyone.length ? everyone : [userId] }),
      };
      r.next_ms = nextLookOf(r);
      const { id: _id, ...patch } = r;
      if (!(await this.store.rows.update({ id: r0.id, space_id: spaceId } as Partial<AskRow>, patch as Partial<AskRow>))) continue;
      sent += 1;
      firstTakeBy ??= takeBy;
      if (named) {
        await this.land(r, order[0]!, a.s.name);
        await this.spaces.note(spaceId, userId, "ask", `${a.me.name}: ${r.title} ${everyWords(r.repeat!)}, taking turns`);
      } else {
        for (const u of r.assignees) {
          if (u === userId) continue;
          tell.add(u);
          await this.push(u, "space_ask", r, { title: r.notes, body: askBody(r, a.me.name, now) }, `ask:${now}`, isOpenTurns(r) ? "x0_in" : undefined);
        }
        await this.spaces.note(spaceId, userId, "ask", `${a.me.name} asked: ${r.notes}`);
      }
    }
    if (!sent) return no(404, "not_found", "That ask isn't there any more. Type it again.");
    await this.spaces.changed(spaceId);
    this.publish(tell);
    const lead2 = askRow({ ...lead, asked_ms: now });
    const day = dayLong(dayOfAsk(lead2), now, tzOf(lead2));
    let line: string;
    if (lead.turns && !lead.ask?.open) line = `Done. ${lead.turns.order[0] === userId ? "You're" : `${this.nameIn(f, lead.turns.order[0])}'s`} first, ${day}. I'll tell each one the evening before.`;
    else if (lead.turns) line = `Asked ${a.s.name}. The turns start ${day}, with whoever's in.`;
    else line = `Asked ${a.s.name}. If nobody takes it by ${firstTakeBy ? whenWords(firstTakeBy, now, tzOf(lead)) : "then"}, I'll tell you.`;
    return ok("asked", { slot: "ask", kind: "said", line });
  }

  // ------------------------------------------------------------------ the buttons

  /** I'll do it: the first tap wins, and it lands on their day. A late tap hears who has it. */
  async take(userId: string, spaceId: string, id: string): Promise<ActResult> {
    if (!this.on()) return no(404, "off", "That isn't there any more.");
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.store.one(spaceId, id);
    if (!r || !r.asked_ms) return no(404, "not_found", "That ask isn't there any more.");
    if (r.taken_by === userId) return ok("taken", { message: "It's on your day." });
    const now = this.now();
    if (untilOfAsk(r) <= now) return no(409, "not_waiting", "That's passed.");
    const members = await this.spaces.memberRows(spaceId);
    // Too late: quietly, who has it. Nobody gets a second push for the same thing.
    const late = async (takerId: string | null | undefined): Promise<ActResult> => {
      const taker = this.nameIn({ members }, takerId, "Someone");
      await this.push(userId, "space_ask_taken", r, lateWords({ base: r.ask?.base ?? "", title: r.title, day: dayOfAsk(r), taker }, now, tzOf(r)), `late:${userId}`);
      return no(409, "not_waiting", `${taker}'s already got it.`);
    };
    if (r.taken_by) return late(r.taken_by);
    if (!r.assignees.includes(userId) && r.set_by !== userId && !(r.turns?.order.includes(userId))) return no(403, "not_allowed", "That ask isn't for you.");
    const patch: Partial<AskRow> = { taken_by: userId, taken_ms: now, assignees: [userId], states: { [userId]: { status: "todo", note: "", at: now } }, updated_ms: now };
    const next = askRow({ ...r, ...patch } as AskRow);
    patch.next_ms = nextLookOf(next);
    if (!(await this.store.take(r.id, patch))) return late((await this.store.one(spaceId, id))?.taken_by);
    await this.land(next, userId, a.s.name);
    if (r.set_by !== userId) {
      await this.push(r.set_by, "space_ask_taken", r, takenWords({ base: r.ask?.base ?? "", title: r.title, day: dayOfAsk(r), taker: a.me.name }, now, tzOf(r)), `taken:${userId}:${r.at_ms}`);
    }
    await this.spaces.note(spaceId, userId, "ask", `${a.me.name} took ${r.title}`);
    await this.spaces.changed(spaceId);
    this.publish([...r.assignees, r.set_by, userId]);
    // Everyone else's notice of the ask goes from their computers too (the taker's goes with their own answer, widgets/act.ts).
    for (const other of new Set([...r.assignees, r.set_by])) if (other !== userId) noticeGone(other, itemId({ kind: "stask", spaceId, taskId: id }));
    return ok("taken", { message: "It's on your day." });
  }

  /** The page's Undo on "I'll do it", within a couple of minutes: open again for the family, with no new pushes. */
  async untake(userId: string, spaceId: string, id: string): Promise<ActResult> {
    if (!this.on()) return no(404, "off", "That isn't there any more.");
    await this.spaces.access(userId, spaceId);
    const r = await this.store.one(spaceId, id);
    const now = this.now();
    if (!r || r.taken_by !== userId || now - (r.taken_ms ?? 0) > UNTAKE_MS) return no(409, "not_waiting", "That can't be undone now.");
    const members = await this.spaces.memberRows(spaceId);
    const assignees = r.turns && !r.ask?.open ? r.turns.order : await this.others({ members }, r.set_by);
    const back = askRow({ ...r, taken_by: null, taken_ms: null, assignees: assignees.length ? assignees : [r.set_by], states: {}, updated_ms: now });
    back.next_ms = nextLookOf(back);
    const { id: _id, ...patch } = back;
    await this.store.rows.update({ id: r.id, space_id: spaceId, taken_by: userId } as Partial<AskRow>, patch as Partial<AskRow>);
    await this.days?.unlandSpace(r.id, userId);
    await this.spaces.changed(spaceId);
    this.publish([...back.assignees, r.set_by, userId]);
    return ok("undone");
  }

  /** I'm in: turns with no names yet, in the order people tap. */
  async join(userId: string, spaceId: string, id: string, inOut: boolean): Promise<ActResult> {
    if (!this.on()) return no(404, "off", "That isn't there any more.");
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.store.one(spaceId, id);
    if (!r || !r.asked_ms || !isOpenTurns(r)) return no(404, "not_found", "That isn't there any more.");
    if (r.taken_by && inOut) return ok("in", { message: "The turns have started." });
    const order = inOut ? [...new Set([...(r.turns?.order ?? []), userId])] : (r.turns?.order ?? []).filter((u) => u !== userId);
    const next = askRow({ ...r, turns: { order, next: 0 }, updated_ms: this.now() });
    await this.store.rows.update({ id: r.id, space_id: spaceId } as Partial<AskRow>, { turns: next.turns, updated_ms: next.updated_ms, next_ms: nextLookOf(next) } as Partial<AskRow>);
    if (inOut) await this.spaces.note(spaceId, userId, "ask", `${a.me.name} is in for ${r.title}`);
    this.publish([userId, r.set_by]);
    return ok(inOut ? "in" : "undone");
  }

  /** "Can't do it" on a turn: the next in the order has it, with one push; nobody left, and the asker hears. */
  async cant(userId: string, spaceId: string, id: string): Promise<ActResult> {
    if (!this.on()) return no(404, "off", "That isn't there any more.");
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.store.one(spaceId, id);
    if (!r || r.taken_by !== userId) return no(409, "not_waiting", "That isn't yours now.");
    await this.passOn(r, userId, a.s.name, a.me.name);
    return ok("passed", { message: "I'll ask the next one." });
  }

  /** The one who has it can't: a turn goes to the next who hasn't said no this time; a one-off is open again for the rest. */
  private async passOn(r: AskRow, userId: string, spaceName: string, myName: string): Promise<void> {
    const now = this.now();
    const members = await this.spaces.memberRows(r.space_id);
    const here = (u: string) => members.some((m) => m.user_id === u);
    const cant = [...new Set([...(r.ask?.cant ?? []), userId])];
    await this.days?.unlandSpace(r.id, userId);
    if (r.turns) {
      const order = r.turns.order.filter(here);
      const at = order.indexOf(userId);
      const nextId = order.length ? [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].find((u) => !cant.includes(u)) : undefined;
      if (nextId) {
        const moved = askRow({ ...r, taken_by: nextId, taken_ms: now, assignees: [nextId], states: { [nextId]: { status: "todo", note: "", at: now } }, turns: { order, next: order.indexOf(nextId) }, ask: { ...r.ask, cant, told: r.at_ms, passedBy: myName }, updated_ms: now });
        moved.next_ms = nextLookOf(moved);
        const { id: _id, ...patch } = moved;
        if (!(await this.store.rows.update({ id: r.id, taken_by: userId } as Partial<AskRow>, patch as Partial<AskRow>))) return;
        await this.land(moved, nextId, spaceName);
        await this.push(nextId, "space_turn", moved, turnWords({ base: r.ask?.base ?? "", title: r.title, day: dayOfAsk(r), last: null, passedBy: myName }, now, tzOf(r)), `turn:${r.at_ms}:${nextId}`, "x0_turn");
        await this.spaces.note(r.space_id, userId, "ask", `${myName} can't do ${r.title} this time`);
        this.publish([userId, nextId, r.set_by]);
        return;
      }
      // Everyone said they can't: the asker hears, and may take it.
      const open = askRow({ ...r, taken_by: null, taken_ms: null, assignees: [r.set_by], states: {}, ask: { ...r.ask, cant }, told_ms: now, updated_ms: now });
      open.next_ms = nextLookOf(open);
      const { id: _id, ...patch } = open;
      if (!(await this.store.rows.update({ id: r.id, taken_by: userId } as Partial<AskRow>, patch as Partial<AskRow>))) return;
      await this.push(r.set_by, "space_ask_none", open, noneWords({ base: r.ask?.base ?? "", title: r.title, day: dayOfAsk(r), time: timeOf(r), turns: true }, now, tzOf(r)), `none:${r.at_ms}`, "x0_claim");
      this.publish([userId, r.set_by]);
      return;
    }
    // A one-off they took and now can't: open again for everyone else, asked again; the asker hears at the take-by as before.
    const rest = (await this.others({ members }, r.set_by)).filter((u) => !cant.includes(u));
    const open = askRow({ ...r, taken_by: null, taken_ms: null, assignees: rest.length ? rest : [r.set_by], states: {}, ask: { ...r.ask, cant }, told_ms: null, updated_ms: now });
    open.next_ms = nextLookOf(open);
    const { id: _id, ...patch } = open;
    if (!(await this.store.rows.update({ id: r.id, taken_by: userId } as Partial<AskRow>, patch as Partial<AskRow>))) return;
    for (const u of rest) await this.push(u, "space_ask", open, { title: open.notes, body: askBody(open, r.set_name, now) }, `again:${now}`);
    await this.spaces.note(r.space_id, userId, "ask", `${myName} can't do ${r.title}`);
    this.publish([userId, r.set_by, ...rest]);
  }

  /**
   * A Done or a "Can't do it" from the person's own day or the space's list (spaceTasks.ts onAnswer). A turn's Done moves the turn on;
   * a "Can't do it" passes it on (a turn) or opens it again for the family (a one-off).
   */
  async answered(userId: string, row: TaskRow, status: "done" | "todo" | "cant"): Promise<void> {
    if (row.kind !== "ask" || !this.on()) return;
    const r = await this.store.one(row.space_id, row.id);
    if (!r || r.taken_by !== userId) return;
    const members = await this.spaces.memberRows(r.space_id);
    const spaceName = await this.spaces.nameOf(r.space_id);
    const myName = this.nameIn({ members }, userId);
    if (status === "cant") { await this.passOn(r, userId, spaceName, myName); return; }
    if (status === "done" && r.turns) await this.roll(r, this.now(), { members, spaceName }, { doneBy: { id: userId, name: myName } });
  }

  // ------------------------------------------------------------------ what the person sees

  /** The Needs-you cards for this person (others' open asks, and their own nobody took), and who's doing what, by day. */
  async cardsFor(userId: string): Promise<AskCards> {
    const out: AskCards = { cards: [], lines: {} };
    if (!this.on()) return out;
    const now = this.now();
    // An ask from someone with a block between them and this person is not theirs to see, even one sent before the block.
    const hidden = this.blocks ? await this.blocks.hiddenFor(userId).catch(() => new Set<string>()) : new Set<string>();
    for (const f of await this.family(userId)) {
      const rows = (await this.store.inSpace(f.id)).filter((r) => r.asked_ms && untilOfAsk(r) > now && !hidden.has(r.set_by));
      if (!rows.length) continue;
      const looks = looksIn(f.members.map((m) => m.user_id));
      for (const r of rows) {
        const day = dayOfAsk(r), until = untilOfAsk(r);
        const asker = this.nameIn(f, r.set_by, r.set_name);
        const item = `stask:${f.id}:${r.id}`;
        const person = { look: shownLook(looks, r.set_by, userId) as PersonLook, name: asker };
        if (!r.taken_by && r.set_by !== userId && r.assignees.includes(userId)) {
          if (isOpenTurns(r)) {
            if (r.turns?.order.includes(userId) || (r.take_by_ms && now >= r.take_by_ms)) continue;
            out.cards.push({
              type: "ask", key: `in:${r.id}:${r.asked_ms}`, until: r.take_by_ms ?? until, question: r.notes, reason: askReason({ asker, time: timeOf(r), place: r.place }),
              person, item, category: "x0_in",
              buttons: [{ id: "in", label: "I'm in", primary: true, done: "You're in. I'll tell you when it's your turn.", undo: "unin" }],
            });
          } else if (!(r.ask?.cant ?? []).includes(userId)) {
            out.cards.push({
              type: "ask", key: `ask:${r.id}:${r.asked_ms}`, until, question: r.notes, reason: askReason({ asker, time: timeOf(r), place: r.place }),
              person, item, category: "x0_claim",
              buttons: [{ id: "take", label: "I'll do it", primary: true, done: "It's on your day.", undo: "untake" }],
            });
          }
        }
        if (!r.taken_by && r.set_by === userId && r.take_by_ms && now >= r.take_by_ms) {
          const w = nobodyWords(r, now);
          out.cards.push({
            type: "nobody", key: `nobody:${r.id}:${r.at_ms}`, until, question: w.title, reason: w.body, item, category: "x0_claim",
            buttons: [{ id: "take", label: "I'll do it", primary: true, done: "It's on your day.", undo: "untake" }],
          });
        }
        if (r.taken_by && r.taken_by !== userId) {
          (out.lines[day] ??= []).push(whoLine(r.title, r.ask?.base ?? "", this.nameIn(f, r.taken_by).split(" ")[0]!));
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ the job

  /** The next time of a repeat (or a turn): the next person in the order, or the family asked again. */
  private async roll(r: AskRow, now: number, ctx: { members: MemberRow[]; spaceName: string }, o: { doneBy?: { id: string; name: string } } = {}): Promise<boolean> {
    const tz = tzOf(r);
    const repeat: AskRepeat = r.repeat ?? { every: "week", days: [] };
    let day = nextDayOf(dayOfAsk(r), repeat);
    const time = timeOf(r);
    while (untilOf(day, time, tz) <= now) day = nextDayOf(day, repeat);
    const at = startOfDay(day, tz) + (time ?? 0) * MIN;
    const end = time !== null ? at + 30 * MIN : null;
    const here = (u: string) => ctx.members.some((m) => m.user_id === u);
    let next: AskRow;
    if (r.turns && r.turns.order.filter(here).length) {
      const order = r.turns.order.filter(here);
      const was = r.taken_by ?? order[r.turns.next % order.length]!;
      const idx = (Math.max(0, order.indexOf(was)) + 1) % order.length;
      const by = o.doneBy ?? (r.taken_by ? { id: r.taken_by, name: this.nameIn(ctx, r.taken_by) } : r.ask?.last ?? null);
      next = askRow({
        ...r, at_ms: at, end_ms: end, taken_by: order[idx]!, taken_ms: now, assignees: [order[idx]!], states: { [order[idx]!]: { status: "todo", note: "", at: now } },
        turns: { order, next: idx }, take_by_ms: eveBefore(day, tz), told_ms: null, nudged_ms: null, updated_ms: now,
        ask: { ...r.ask, cant: [], told: null, passedBy: null, last: by ? { id: by.id, name: by.name.split(" ")[0]! } : null },
      });
    } else if (r.repeat) {
      // Asked again: the family for a repeat; "Who's in?" again for turns nobody joined.
      const others = await this.others(ctx, r.set_by);
      next = askRow({
        ...r, at_ms: at, end_ms: end, taken_by: null, taken_ms: null, assignees: others.length ? others : [r.set_by], states: {},
        asked_ms: now, take_by_ms: takeByOf(day, time, tz, now), nudged_ms: null, told_ms: null, updated_ms: now, ask: { ...r.ask, cant: [], told: null },
        notes: askQuestion({ base: r.ask?.base ?? "", title: r.title, day, repeat: r.repeat, openTurns: isOpenTurns(r) }, now, tz),
      });
    } else return false;
    next.next_ms = nextLookOf(next);
    const { id: _id, ...patch } = next;
    if (!(await this.store.rows.update({ id: r.id, at_ms: r.at_ms } as Partial<AskRow>, patch as Partial<AskRow>))) return false;
    if (next.turns && next.taken_by) await this.land(next, next.taken_by, ctx.spaceName);
    else for (const u of next.assignees) if (u !== r.set_by) await this.push(u, "space_ask", next, { title: next.notes, body: askBody(next, r.set_name, now) }, `ask:${next.at_ms}`, isOpenTurns(next) ? "x0_in" : undefined);
    this.publish([...next.assignees, r.set_by, ...(r.taken_by ? [r.taken_by] : [])]);
    return true;
  }

  /** One step for one ask whose look is due: claimed by moving next_ms on first, so two servers never send twice. */
  private async step(r: AskRow, now: number): Promise<boolean> {
    const was = r.next_ms!;
    // An unsent preview past its day: out.
    if (!r.asked_ms) {
      if (now < r.created_ms + DRAFT_MS) return false;
      return (await this.store.rows.remove({ id: r.id, next_ms: was } as Partial<AskRow>)) > 0;
    }
    const tz = tzOf(r), day = dayOfAsk(r);
    const members = await this.spaces.memberRows(r.space_id);
    const spaceName = await this.spaces.nameOf(r.space_id);
    const claim = async (patch: Partial<AskRow>): Promise<AskRow | null> => {
      const next = askRow({ ...r, ...patch, updated_ms: now } as AskRow);
      next.next_ms = nextLookOf(next);
      const { id: _id, ...all } = next;
      return (await this.store.rows.update({ id: r.id, next_ms: was } as Partial<AskRow>, all as Partial<AskRow>)) ? next : null;
    };
    // Its time has passed: the next one (a repeat, a turn), or done with (one nobody took goes; a taken one stays as the space's task).
    if (now >= untilOfAsk(r)) {
      if ((r.repeat || r.turns) && (await this.store.rows.update({ id: r.id, next_ms: was } as Partial<AskRow>, { next_ms: now + 5 * MIN } as Partial<AskRow>))) {
        const rolled = await this.roll({ ...r, next_ms: now + 5 * MIN }, now, { members, spaceName });
        // Nobody left to ask (the space emptied): leave it be.
        if (!rolled) await this.store.rows.update({ id: r.id } as Partial<AskRow>, { next_ms: null } as Partial<AskRow>);
        return rolled;
      }
      if (!r.taken_by) return (await this.store.rows.remove({ id: r.id, next_ms: was } as Partial<AskRow>)) > 0;
      return !!(await claim({ next_ms: null }));
    }
    if (!r.taken_by) {
      // Turns with no names: at the evening before, they start with whoever's in.
      if (isOpenTurns(r) && r.take_by_ms && now >= r.take_by_ms && (r.turns?.order ?? []).length) {
        const first = r.turns!.order.find((u) => members.some((m) => m.user_id === u));
        if (first) {
          const next = await claim({ taken_by: first, taken_ms: now, assignees: [first], states: { [first]: { status: "todo", note: "", at: now } }, turns: { order: r.turns!.order, next: r.turns!.order.indexOf(first) }, ask: { ...r.ask, told: r.at_ms } });
          if (!next) return false;
          await this.land(next, first, spaceName);
          await this.push(first, "space_turn", next, turnWords({ base: r.ask?.base ?? "", title: r.title, day, last: null }, now, tz), `turn:${r.at_ms}:${first}`, "x0_turn");
          this.publish([first, r.set_by]);
          return true;
        }
      }
      // Halfway: one quiet nudge to those who haven't answered.
      const nudge = r.take_by_ms ? nudgeAtOf(r.asked_ms, r.take_by_ms) : null;
      if (nudge !== null && !r.nudged_ms && now >= nudge && (!r.take_by_ms || now < r.take_by_ms)) {
        const next = await claim({ nudged_ms: now });
        if (!next) return false;
        const waiting = r.assignees.filter((u) => u !== r.set_by && !(r.turns?.order ?? []).includes(u) && !(r.ask?.cant ?? []).includes(u));
        for (const u of waiting) await this.push(u, "space_ask_nudge", next, { title: next.notes, body: askBody(next, r.set_name, now) }, "nudge", isOpenTurns(r) ? "x0_in" : undefined);
        return true;
      }
      // The take-by: the asker hears nobody took it, with [I'll do it]. It stays open for the family until its time.
      if (r.take_by_ms && now >= r.take_by_ms && !r.told_ms) {
        const next = await claim({ told_ms: now });
        if (!next) return false;
        await this.push(r.set_by, "space_ask_none", next, nobodyWords(r, now), `none:${r.at_ms}`, "x0_claim");
        this.publish([r.set_by]);
        return true;
      }
      return !!(await claim({}));
    }
    // A turn: the evening before, its one push with [Can't do it]. Doing nothing means they're doing it.
    if (r.turns && r.ask?.told !== r.at_ms && now >= eveBefore(day, tz)) {
      const next = await claim({ ask: { ...r.ask, told: r.at_ms } });
      if (!next) return false;
      await this.push(r.taken_by, "space_turn", next, turnWords({ base: r.ask?.base ?? "", title: r.title, day, last: r.ask?.last?.name ?? null, passedBy: r.ask?.passedBy ?? null }, now, tz), `turn:${r.at_ms}:${r.taken_by}`, "x0_turn");
      return true;
    }
    return !!(await claim({}));
  }

  /** Every minute: the asks whose next look is due. How many did something. */
  async tick(limit = 100): Promise<number> {
    if (!this.on()) return 0;
    const now = this.now();
    let done = 0;
    for (const r of await this.store.due(now, limit)) {
      try { if (await this.step(r, now)) done += 1; } catch { /* the next tick */ }
    }
    return done;
  }

  start(log?: { warn: (o: object, m: string) => void }): () => void {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.tick().catch((err) => log?.warn({ err: (err as Error)?.message }, "plan ease: asks")).finally(() => { busy = false; });
    }, 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

/** To the asker once the take-by passed: nobody took it; turns nobody joined say so. */
function nobodyWords(r: AskRow, now: number): { title: string; body: string } {
  const w = noneWords({ base: r.ask?.base ?? "", title: r.title, day: dayOfAsk(r), time: timeOf(r), turns: !!r.turns }, now, tzOf(r));
  return isOpenTurns(r) && !(r.turns?.order ?? []).length ? { ...w, body: "Nobody said they're in yet." } : w;
}

/** The push's grey line: "1 pm at Little Steps. Priya asked." (lock-safe: askReason's parts). */
function askBody(r: AskRow, asker: string, _now: number): string {
  const reason = askReason({ asker, time: timeOf(r), place: r.place });
  const [who, when] = reason.split(" · ");
  return when ? `${when.charAt(0).toUpperCase()}${when.slice(1)}. ${who}.` : `${who}.`;
}

/** "6 pm Tuesday", "3 pm today". */
function whenWords(ms: number, now: number, tz: number): string {
  return `${clockOf(minuteOf(ms, tz))} ${dayLong(dayOf(ms, tz), now, tz)}`;
}

// ------------------------------------------------------------------ the shared one

let shared: PlanAsks | null = null;

/** The server's (made at boot with the server's Spaces: routes/bots/botsPlanPeople.ts); null until then. */
export function planAsks(): PlanAsks | null { return shared; }
export function setPlanAsks(a: PlanAsks | null): void { shared = a; }

// ================================================================== THE SEAMS

/** The family's asks beside the person's days (planSources.ts), for the cards and the evening note: once at start. */
export function plugAsks(): void {
  addPlanSource({ name: "ask", more: async (userId) => (planOn("asks") && spacesOn() ? planAsks()?.cardsFor(userId) ?? null : null) });
}

/**
 * The Needs-you cards (planNeeds.ts LATER_TYPES): an open ask for this person ("Who picks Kabir up Wednesday?", the asker's tiny bot,
 * [I'll do it]); turns with no names ([I'm in]); the asker's own once nobody took it. And the evening note's "Kabir pickup: Mom".
 */
export const ASK_NEEDS: NeedsType = {
  type: "ask", step: 5, tie: 0,
  find(ctx) {
    if (!planOn("asks") || !spacesOn()) return [];
    return ((ctx.more?.ask as AskCards | null | undefined)?.cards ?? []).filter((c) => c.until > ctx.now);
  },
  notes(ctx, day) {
    if (!planOn("asks") || !spacesOn()) return [];
    return (ctx.more?.ask as AskCards | null | undefined)?.lines[day] ?? [];
  },
};

/** The box (planBox.ts STEP_5_FIRST): a family ask, read first, shown as a preview with [Ask]. */
export const ASK_SLOT: BoxSlot<AskRead> = {
  slot: "ask", step: 5,
  read: (words, ctx) => (planOn("asks") && spacesOn() && planAsks() ? readAsk(words, ctx.now, ctx.tz) : null),
  async run(read, words, ctx): Promise<BoxReply> {
    const a = planAsks();
    return a ? a.preview(ctx.userId, read, words, ctx.tz) : { slot: "chat", kind: "chat", line: "" };
  },
};

const off = (): ActResult => no(404, "off", "That isn't there any more.");
const withAsk = (fn: (a: PlanAsks, userId: string, spaceId: string, taskId: string) => Promise<ActResult>): PlanAct["run"] =>
  async (_p, userId, item: QuickItem) => {
    const a = planAsks();
    if (!a || item.kind !== "stask" || !planOn("asks") || !spacesOn()) return off();
    return fn(a, userId, item.spaceId, item.taskId);
  };

/**
 * The buttons on a space task's item (stask:<space>:<task>, planEase.ts PLAN_ACTS.stask; the act door's own "done" stays Spaces'):
 * Ask (the preview, the app only), I'll do it, I'm in (a widget may answer these in place), Can't do it, and the page's Undos.
 */
export const ASK_ACTS: Record<string, PlanAct> = {
  ask: { scope: "session", run: withAsk((a, u, s, t) => a.send(u, s, t)) },
  take: { scope: "needs.answer", run: withAsk((a, u, s, t) => a.take(u, s, t)) },
  untake: { scope: "session", run: withAsk((a, u, s, t) => a.untake(u, s, t)) },
  in: { scope: "needs.answer", run: withAsk((a, u, s, t) => a.join(u, s, t, true)) },
  unin: { scope: "session", run: withAsk((a, u, s, t) => a.join(u, s, t, false)) },
  cant: { scope: "task.done", run: withAsk((a, u, s, t) => a.cant(u, s, t)) },
};
