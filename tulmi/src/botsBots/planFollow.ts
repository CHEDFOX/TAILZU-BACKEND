/**
 * PLAN EASE'S FOLLOW-THROUGH: THE LADDER (PLAN_V2_FOLLOW; docs/plan-ease.md "Follow-through"). "Every item becomes a job that is not
 * finished until someone says it's done."
 *
 *   arm(user, c)            the calendar's minute tick, when an item's own reminder comes due (calendar/service.ts ReminderPolicy.follow):
 *                           a must-not-miss item, or one with someone else on it, becomes one row (plan_follows) and its own push is
 *                           not sent: the ladder sends it
 *   advance(id) / sweep()   one follow's next step, and every due one each minute (start): the push, then for a must item a louder push
 *                           (+5), X0 is calling (+10), a real phone call for someone who turned it on (+15), telling the next person (+20)
 *   reply(o)                the one door every answer comes through: the app's buttons (pf:<followId>:<n>), the X0 call screen, a real
 *                           call's keypad (Backend B). done / later / can't (+ I'll do it, Undone)
 *   view / cardsFor / itemFollow / activitySince   what the follow page, the Plan's cards and lines, the item page and Activity show
 *   taskTicked              the calendar's tick hook: a to-do ticked in the app closes its follow, one taken out drops it
 *
 * WHO CAN BE REACHED (the owner's change). The asker always; anyone else only while they are in the asker's X0 people, by exactly the
 * rules messaging uses (threads.ts contacts: a space they share in which the asker may message, no block either way, Spaces on). That is
 * checked again before every reach (a push, a louder push, X0 is calling, a real call, a tell), not only when the item was saved: someone
 * who left the space, or with a block either way, or Spaces off, is skipped (no push, no call), the job goes to the next person, and the
 * asker is told once. What they get respects their own settings: quiet hours (the push engine's verdict), their daily limit (ringMax),
 * a muted chat with the asker (nothing from that asker's items), their own yes before anything louder than a push (followFrom), and never
 * 10 pm to 7 am for someone else's item when they set no quiet hours. A read of the asker's X0 people that FAILS is never "not in their
 * people": nobody is skipped, passed on or refused for it; the step waits a minute and tries again (PeopleUnread).
 *
 * Rules decide everything here; no AI is asked. Every write after the insert is a compare-and-swap on updated_ms; every step is one
 * row (unique follow, n, rung, person), claimed before it is sent, so nothing is sent twice. Never throws into the calendar or the door.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/types.js";
import { calendar as ownCalendar, type Calendar, type CalTask, type FollowCandidate } from "../calendar/index.js";
import { clockAt, dayOf, minuteOf } from "../calendar/words.js";
import { getConfig } from "../config.js";
import { noticeGone } from "../live/notices.js";
import { botTopic, TOPIC } from "../live/topics.js";
import { livePublish } from "../live/writes.js";
import type { PushPayload } from "../push/defaults.js";
import type { PushEngine } from "../push/engine.js";
import { pushEngine } from "../push/index.js";
import { knobsOf } from "../push/plan.js";
import { no, ok, type ActResult } from "../widgets/act.js";
import { eventIdOf, eventRefOf, itemId, parseItem, type QuickItem } from "../widgets/items.js";
import { DEFAULT_SETTINGS, applyPatch, type YouSettings } from "../you/settings.js";
import { youStore } from "../you/store.js";
import { planAsks } from "./planAsks.js";
import { planCalls, type PlanCalls } from "./planCall.js";
import { planCapture } from "./planCapture.js";
import { dueReminder } from "./planDue.js";
import type { PlanAct } from "./planEase.js";
import { followChannels } from "./planFollowChannels.js";
import { FollowPeople } from "./planFollowPeople.js";
import {
  followStores, isDuplicate, type FollowRow, type FollowStores, type StepRow,
} from "./planFollowStore.js";
import {
  FOLLOW_TIMINGS, RUNG_RANK, autoMust, dueAgainAt, capDay, cleanPeople, effectiveMust, firstName, followLine, followPushWords, followTitle, forOthers, isOpenState,
  isUuid, keyOf, ladderOf, laterAt, laterChoices, looksMed, missAt, nextHolder, stepLine, tellTarget, utcDay, whenWords,
  type FollowAnswer, type FollowKind, type FollowPerson, type FollowPushKind, type FollowState, type FollowTimings, type FollowVerb,
  type FollowVia, type LadderStep, type LaterChoice, type MustWhy, type PersonHow, type PersonKey, type PushWordsIn, type StepChannel,
  type StepRung, type StepState,
} from "./planFollowWords.js";
import type { PersonLook } from "./personLook.js";
import type { NeedsCard, NeedsType } from "./planNeeds.js";
import { capGive, capTakeAll } from "./planReach.js";
import { addPlanSource } from "./planSources.js";
import { followOn, planOn } from "./planSwitch.js";
import { planPrefs } from "./planPrefs.js";
import { spacesOn } from "./spacesSwitch.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** A reply that lost its compare-and-swap reads again and decides again, this many times. */
const TRIES = 3;
/** The same answer from the same person this soon is one answer (a press handled twice). */
const SAME_ANSWER_MS = 60_000;
/** Undone works this long after a Done. */
const UNDONE_MS = 120_000;
const ANSWERS_KEPT = 20;
/** Members sent a push this recently, who did not answer, get the quiet "said done" that replaces it. */
const DONE_TELL_MS = 6 * HOUR;
/** A family member with no quiet hours of their own is never rung louder or called for someone else's item from 10 pm to 7 am. */
const NIGHT_FROM = 22 * 60, NIGHT_TO = 7 * 60;
const SWEEP_MS = 60_000;
const CLEAN_EVERY_MS = HOUR;
const KEEP_CLOSED_MS = 90 * DAY;

type Log = { info(o: object, m: string): void; warn(o: object, m: string): void };
const SILENT: Log = { info: () => undefined, warn: () => undefined };

/**
 * Someone in the asker's X0 people (threads.ts contacts): their id, the name the asker knows them by, and their tiny bot as the asker is
 * shown it (threads.ts looksKnown: the first space they share), so Plan draws them as their space does.
 */
export interface FollowContact { userId: string; name: string; bot?: PersonLook }

/**
 * Someone's X0 people could not be read just now (spaces, members or blocks failed to load). Never the same as "not in their people":
 * nobody is skipped, passed on, told about or refused because of it. The step waits a minute; a reply counts; saving who does it says
 * try again.
 */
export class PeopleUnread extends Error {
  constructor() { super("follow: X0 people could not be read"); this.name = "PeopleUnread"; }
}

export interface PlanFollowsDeps {
  stores?: FollowStores;
  calendar?: Calendar;
  engine?: () => PushEngine | null;
  calls?: () => PlanCalls;
  now?: () => number;
  /** The person's own settings (default: youStore().getSettings). */
  settingsOf?: (userId: string) => Promise<YouSettings>;
  /** Their own settings changed (the follow page's Allow / Not now): default youStore().putSettings. */
  saveSettings?: (userId: string, s: YouSettings) => Promise<void>;
  /** Who this person can message (threads.ts contacts: the same rules as messaging). Never called while Spaces is off. */
  contacts?: (userId: string) => Promise<FollowContact[]>;
  /** Whether `userId` muted their one-to-one chat with `otherId` (threads.ts directMuted). */
  muted?: (userId: string, otherId: string) => Promise<boolean>;
  /** spaceTasks.answer(..., { status: "done" }) for a family ask its holder said done. */
  spaceDone?: (userId: string, spaceId: string, taskId: string) => Promise<void>;
  /** Plan Ease's six a day (PlanEase.policy.spend). */
  spend?: (userId: string, day: string) => Promise<boolean>;
  /** The person's own offset (plan_prefs.tz_min), for "never 10 pm to 7 am in their time". */
  tzOfUser?: (userId: string) => Promise<number | null>;
  log?: Log;
}

/** What the follow page shows (GET FOLLOW/:id). */
export interface FollowView {
  id: string; item: string; kind: FollowKind; title: string; when: string; must: boolean; why: MustWhy | "set" | null;
  state: FollowState; you: "asker" | "holder" | "backup"; n: number;
  asker: { name: string; me: boolean };
  holder: { key: PersonKey; name: string; me: boolean; how: PersonHow };
  people: Array<{ key: PersonKey; name: string; me: boolean; how: PersonHow; cant: boolean }>;
  /** The asker only; [] for everyone else. */
  steps: Array<{ at: number; line: string }>;
  answers: Array<{ at: number; line: string }>;
  next: { at: number; line: string } | null;
  done: { by: string; via: FollowVia; at: number; line: string } | null;
  buttons: {
    done: boolean; later: Array<{ action: string; label: string }>; cant: boolean; take: boolean; undone: boolean;
    /** The asker keeps a number for the holder: Call dials it from the asker's own phone. */
    call: { number: string; name: string } | null;
    /** Message the holder in X0 (the one-to-one chat messaging already has). */
    message: { userId: string; name: string } | null;
  };
  /** Someone (not the asker) on a must follow who has not said yes to this asker's louder steps: the one-time question. */
  ask: { asker: string } | null;
}

/** The item page's follow part (GET .../plan/details follow). */
export interface ItemFollow {
  allowed: boolean; importance: "normal" | "must" | null; must: boolean; why: MustWhy | null;
  people: Array<{ key: PersonKey; name: string; me: boolean; how: PersonHow }>;
  open: { id: string; line: string } | null;
}

export interface FollowCards { cards: NeedsCard[]; lines: Record<string, string> }
export interface FeedFollowRow { id: string; follow: string; what: "done_by" | "passed" | "missed"; who: string; title: string; at: number; via: FollowVia | null }

export interface ReplyIn {
  followId: string; by: PersonKey; answer: FollowVerb; later?: LaterChoice;
  /** The climb the answer is about (the app's pf:<id>:<n>, a call's keypad): an old n counts for nothing for later and can't. */
  n?: number;
  via: FollowVia; ext?: string;
}

/** The ladder's timings from the push surface's flags, falling back to FOLLOW_TIMINGS. */
export function followTimings(payload: PushPayload | null): FollowTimings {
  if (!payload) return FOLLOW_TIMINGS;
  const k = knobsOf(payload);
  const t = { ...FOLLOW_TIMINGS };
  for (const key of Object.keys(t) as Array<keyof FollowTimings>) {
    const v = k.flag(`push.follow.${key}`, t[key]);
    t[key] = Number.isFinite(v) && v >= 0 ? v : t[key];
  }
  return t;
}

/** The asker's Plan rows' lines from the "follow" source (planEase.ts passes them to planPage). */
export function followLinesOf(more: Readonly<Record<string, unknown>> | undefined): Map<string, string> {
  const cards = more?.follow as FollowCards | null | undefined;
  return new Map(Object.entries(cards?.lines ?? {}));
}

const ASKER = (userId: string): FollowPerson => ({ k: "u", id: userId, name: "" });
/** One read of the asker's X0 people, shared by everything one step does. */
type Reach = { has(id: string): Promise<boolean>; names(): Promise<Map<string, string>> };
/** What the tell rung will do, decided before the climb moves (so "told" is only ever said when someone is told). */
type TellPlan = { target: FollowPerson } | { skip: "none" | "off" | "muted"; person: FollowPerson };
const isAskerOf = (f: Pick<FollowRow, "user_id">, id: string) => f.user_id === id;
const holderOf = (f: FollowRow): FollowPerson => f.people[f.holder] ?? ASKER(f.user_id);
const taskIdOf = (f: Pick<FollowRow, "item">): string | null => { const it = parseItem(f.item); return it?.kind === "pt" ? it.taskId : null; };
const VIA_WORDS: Record<FollowVia, string> = { app: "In X0", ring: "X0 call", call: "Phone call", item: "On Plan" };
/** The asker un-ticked the item on their Plan after it was said done (taskTicked "undone"). */
const untickedSince = (f: Pick<FollowRow, "answers" | "done_ms">): boolean =>
  f.answers.some((a) => a.verb === "undone" && a.via === "item" && a.at >= (f.done_ms ?? 0));
const VERB_WORDS: Record<FollowVerb, string> = { done: "said done", later: "said later", cant: "can't do it", take: "took it", undone: "said not done yet" };

/** A cost ceiling from the config (0 when it can't be read: a test with no config never pays). */
function ceiling(name: "FOLLOW_CALL_ASKER_DAY_MAX" | "FOLLOW_CALL_DAY_MAX"): number {
  try { return getConfig()[name]; } catch { return 0; }
}

export class PlanFollows {
  readonly stores: FollowStores;
  readonly people: FollowPeople;
  private readonly calendar: Calendar;
  private readonly engine: () => PushEngine | null;
  private readonly calls: () => PlanCalls;
  private readonly now: () => number;
  private settingsOf: (userId: string) => Promise<YouSettings>;
  private saveSettings: (userId: string, s: YouSettings) => Promise<void>;
  private contacts: ((userId: string) => Promise<FollowContact[]>) | null;
  private muted: ((userId: string, otherId: string) => Promise<boolean>) | null;
  private spaceDone: ((userId: string, spaceId: string, taskId: string) => Promise<void>) | null;
  private spend: ((userId: string, day: string) => Promise<boolean>) | null;
  private tzOfUser: (userId: string) => Promise<number | null>;
  private log: Log;
  private cleaned = 0;

  constructor(d: PlanFollowsDeps = {}) {
    this.stores = d.stores ?? followStores();
    this.calendar = d.calendar ?? ownCalendar();
    this.engine = d.engine ?? (() => pushEngine());
    this.calls = d.calls ?? (() => planCalls());
    this.now = d.now ?? Date.now;
    this.settingsOf = d.settingsOf ?? (async (u) => youStore().getSettings(u).catch(() => DEFAULT_SETTINGS));
    this.saveSettings = d.saveSettings ?? (async (u, s) => { await youStore().putSettings(u, s, this.now()); });
    this.contacts = d.contacts ?? null;
    this.muted = d.muted ?? null;
    this.spaceDone = d.spaceDone ?? null;
    this.spend = d.spend ?? null;
    this.tzOfUser = d.tzOfUser ?? (async (u) => (await planPrefs().get(u).catch(() => null))?.tz_min ?? null);
    this.log = d.log ?? SILENT;
    this.people = new FollowPeople({
      stores: this.stores, calendar: this.calendar, now: this.now, contacts: (u) => this.peopleOrBusy(u), follows: () => this,
    });
  }

  /** The server's parts, wired at boot (routes/bots/planFollows.ts). */
  wire(o: Partial<Pick<PlanFollowsDeps, "contacts" | "muted" | "spaceDone" | "spend" | "settingsOf" | "saveSettings" | "tzOfUser" | "log">>): void {
    if (o.contacts !== undefined) this.contacts = o.contacts;
    if (o.muted !== undefined) this.muted = o.muted;
    if (o.spaceDone !== undefined) this.spaceDone = o.spaceDone;
    if (o.spend !== undefined) this.spend = o.spend;
    if (o.settingsOf) this.settingsOf = o.settingsOf;
    if (o.saveSettings) this.saveSettings = o.saveSettings;
    if (o.tzOfUser) this.tzOfUser = o.tzOfUser;
    if (o.log) this.log = o.log;
  }

  // ------------------------------------------------------------------ who can be reached (messaging's rules)

  /**
   * Someone's X0 people now, by id: [] while Spaces is off. The person themself is not in it (the asker always counts). Throws
   * PeopleUnread when they could not be read: who may be reached is never decided on a failed read.
   */
  async peopleOf(userId: string): Promise<Map<string, string>> {
    if (!spacesOn() || !this.contacts) return new Map();
    try {
      return new Map((await this.contacts(userId)).map((p) => [p.userId, p.name]));
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, "[follow] X0 people not read");
      throw new PeopleUnread();
    }
  }

  /**
   * How someone's X0 people look to them, by id (their space's looks, threads.ts contacts' `bot`): Plan's rows and "Plan something"'s For
   * who draw a person as their space does. Empty while Spaces is off or when they could not be read (each then has their own look).
   */
  async looksOf(userId: string): Promise<Map<string, PersonLook>> {
    if (!spacesOn() || !this.contacts) return new Map();
    const list = await this.contacts(userId).catch(() => [] as FollowContact[]);
    return new Map(list.flatMap((p) => (p.bot ? [[p.userId, p.bot] as [string, PersonLook]] : [])));
  }

  /** For words only (the name in a push or on a call): [] when they could not be read. Never for who may be reached. */
  async contactsOf(userId: string): Promise<Map<string, string>> {
    return this.peopleOf(userId).catch(() => new Map<string, string>());
  }

  /** Whether `id` is in `asker`'s X0 people now; null when that could not be read (a failed read is never a no). */
  async stillIn(asker: string, id: string): Promise<boolean | null> {
    if (id === asker) return true;
    try { return (await this.peopleOf(asker)).has(id); } catch (err) { if (err instanceof PeopleUnread) return null; throw err; }
  }

  /** planFollowPeople's read: a failed one is "try again" (503), so nobody is ever left off an item because of it. */
  private async peopleOrBusy(userId: string): Promise<Map<string, string>> {
    try { return await this.peopleOf(userId); } catch (err) {
      if (err instanceof PeopleUnread) throw new BotError("busy", "Couldn't check your X0 people just now. Try again.", 503);
      throw err;
    }
  }

  /** One read of the asker's X0 people for one step (so a sweep never works from an old list). Throws PeopleUnread, like peopleOf. */
  private reachOf(asker: string): Reach {
    let got: Promise<Map<string, string>> | null = null;
    const names = () => (got ??= this.peopleOf(asker));
    return { has: async (id) => id === asker || (await names()).has(id), names };
  }

  /** How `viewer` knows `id` (their X0 people), for a push to them: "Someone" when not there. */
  private async nameIn(viewer: string, id: string): Promise<string> {
    return (await this.contactsOf(viewer)).get(id) ?? "Someone";
  }

  private async isMuted(userId: string, otherId: string): Promise<boolean> {
    if (!this.muted || userId === otherId) return false;
    return this.muted(userId, otherId).catch(() => false);
  }

  // ------------------------------------------------------------------ rows

  private async read(id: string): Promise<FollowRow | null> {
    if (!isUuid(id)) return null;
    return (await this.stores.follows.select({ id }, { limit: 1 }))[0] ?? null;
  }

  /** A compare-and-swap on updated_ms: the row as written, or null when someone else wrote first. */
  private async cas(f: FollowRow, patch: Partial<FollowRow>, now: number): Promise<FollowRow | null> {
    const updated_ms = Math.max(now, f.updated_ms + 1);
    const n = await this.stores.follows.update({ id: f.id, updated_ms: f.updated_ms }, { ...patch, updated_ms }).catch(() => 0);
    return n ? { ...f, ...patch, updated_ms } : null;
  }

  /** The row once more, just before something leaves: still the same climb and still open, else nothing is sent. */
  private async stillMine(f: FollowRow): Promise<boolean> {
    const r = await this.read(f.id).catch(() => null);
    return !!r && r.n === f.n && isOpenState(r.state);
  }

  /** The newest follow of an item of this asker's. */
  async current(userId: string, item: string): Promise<FollowRow | null> {
    return (await this.stores.follows.ofItem(userId, item, 1).catch(() => []))[0] ?? null;
  }

  private async timings(now: number): Promise<FollowTimings> {
    const e = this.engine();
    if (!e) return FOLLOW_TIMINGS;
    try { return followTimings(e.configFor({ userId: "", tokens: [], locale: null }, now)); } catch { return FOLLOW_TIMINGS; }
  }

  // ------------------------------------------------------------------ steps (one row each, claimed before anything is sent)

  /** A step that ends here (skipped): false when it was there already. */
  private async record(f: FollowRow, s: { n?: number; rung: StepRung; person: string; channel: StepChannel; state: StepState; why?: string | null; ext?: string | null }, now: number): Promise<boolean> {
    try {
      await this.stores.steps.insert({
        id: randomUUID(), follow_id: f.id, user_id: f.user_id, n: s.n ?? f.n, rung: s.rung, person: s.person, channel: s.channel,
        state: s.state, why: s.why ?? null, ext: s.ext ?? null, at_ms: now, seen_ms: null,
      });
      return true;
    } catch (err) {
      if (!isDuplicate(err)) this.log.warn({ err: (err as Error)?.message }, "[follow] step not kept");
      return false;
    }
  }

  /** Claim a step before it is sent: its id, or null when it was taken already (never twice). */
  private async claim(f: FollowRow, rung: StepRung, person: string, channel: StepChannel, now: number): Promise<string | null> {
    const id = randomUUID();
    try {
      await this.stores.steps.insert({ id, follow_id: f.id, user_id: f.user_id, n: f.n, rung, person, channel, state: "sent", why: null, ext: null, at_ms: now, seen_ms: null });
      return id;
    } catch (err) {
      if (!isDuplicate(err)) this.log.warn({ err: (err as Error)?.message }, "[follow] step not claimed");
      return null;
    }
  }

  private async finish(stepId: string, s: { state: StepState; why?: string | null; ext?: string | null }): Promise<void> {
    await this.stores.steps.update({ id: stepId }, { state: s.state, why: s.why ?? null, ext: s.ext ?? null }).catch(() => 0);
  }

  // ------------------------------------------------------------------ pushes

  private pfItem(f: FollowRow): string { return itemId({ kind: "pf", followId: f.id, n: f.n }); }

  private async notify(userId: string, kind: FollowPushKind, words: { title: string; body: string }, f: FollowRow, o: { key: string; category?: string }, now: number): Promise<{ sent: boolean; id?: string } | null> {
    const e = this.engine();
    if (!e) return null;
    return e.notify(userId, {
      kind: kind as Parameters<PushEngine["notify"]>[1]["kind"], key: o.key.slice(0, 120), vars: words,
      data: { follow: f.id, item: this.pfItem(f), day: f.day, n: String(f.n) }, ...(o.category ? { category: o.category } : {}),
      collapseId: `follow-${f.id}`,
    }, now).catch(() => null);
  }

  private when(f: FollowRow, now: number): string { return whenWords({ dueMs: f.due_ms, day: f.day, tz: f.tz_min, now }); }

  private words(kind: FollowPushKind, f: FollowRow, now: number, x: Partial<PushWordsIn> = {}): { title: string; body: string } {
    return followPushWords(kind, { title: f.title, when: this.when(f, now), must: f.importance === "must", asker: "", holder: holderOf(f).name, ...x });
  }

  /** A bill's own push (Pay, Paid) for its holder the asker, keyed for this climb's rung; no call seed (the ladder's call rings). */
  private async billPush(f: FollowRow, rung: "push" | "loud", now: number): Promise<{ sent: boolean; id?: string } | null> {
    const taskId = taskIdOf(f);
    const e = this.engine();
    if (!taskId || !e) return null;
    const t = await this.calendar.task(f.user_id, taskId).catch(() => null);
    if (!t) return null;
    const msg = dueReminder({
      id: t.id, title: t.title, due_day: t.due, due_ms: t.at, tz_min: f.tz_min, done: t.done, payee: t.payee ?? null, pay_link: t.payLink ?? null,
    }, dayOf(now, f.tz_min), now);
    const { call: _call, ...rest } = msg;
    return e.notify(f.user_id, { ...rest, key: `follow:${f.id}:${f.n}:${rung}`, data: { ...rest.data, follow: f.id }, collapseId: `follow-${f.id}` }, now).catch(() => null);
  }

  // ------------------------------------------------------------------ arming (the calendar's hook)

  /** True when this occurrence is followed (its own push is then not sent). Never throws. */
  async arm(userId: string, c: FollowCandidate): Promise<boolean> {
    try {
      if (!followOn()) return false;
      if (c.row.source.kind === "space") return await this.armAsk(userId, c);
      if (c.kind === "task" && c.row.kind === "wait") return false;
      const now = this.now();
      const stored = c.row.importance ?? null;
      const refs = cleanPeople(c.row.people);
      const today = dayOf(now, c.row.tz_min);
      const why = stored === null
        ? autoMust(c.kind === "task"
          ? { kind: c.row.kind === "due" ? "due" : "todo", title: c.row.title, timed: c.row.due_ms !== null, dueDay: c.row.due_day, today }
          : { kind: "event", title: c.row.title, timed: !c.row.all_day, dueDay: null, today })
        : null;
      const must = effectiveMust(stored, why);
      const others = refs.some((p) => p.id !== userId);
      if (!others && !must) return false;
      if (!others && must && (await this.settingsOf(userId)).notify.follow === false) return false;
      let item: string, sourceKey: string;
      if (c.kind === "task") {
        item = itemId({ kind: "pt", taskId: c.row.id });
        sourceKey = `${item}@${c.row.due_day}@${c.row.due_ms ?? "day"}`;
      } else {
        const occ = c.row.repeat ? `${c.row.id}@${c.day}` : c.row.id;
        item = itemId({ kind: "pe", eventRef: eventRefOf(occ), day: c.day });
        sourceKey = `${item}@${c.start}`;
      }
      return await this.insertFollow(userId, {
        item, sourceKey, kind: c.kind === "task" ? (c.row.kind === "due" ? "due" : "todo") : "event", title: c.row.title,
        place: c.kind === "event" ? c.row.place : "", must, why: stored === "must" ? "set" : why,
        dueMs: c.kind === "task" ? c.row.due_ms : c.start, day: c.kind === "task" ? c.row.due_day ?? today : c.day, tz: c.row.tz_min,
        refs, at: c.at, billClimb: c.kind === "task" && c.row.kind === "due" && must,
        leftAlready: c.kind === "event" && c.leftAlready,
        dueAgain: c.kind === "task" ? { due_day: c.row.due_day, tz_min: c.row.tz_min } : null,
      }, now);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, "[follow] arm failed");
      return false;
    }
  }

  /** A family ask taken by someone: followed for them when the rules say must (a pickup, medicine), the asker being who set it. */
  private async armAsk(userId: string, c: FollowCandidate): Promise<boolean> {
    const asks = planAsks();
    if (!planOn("asks") || !spacesOn() || !asks || c.row.source.kind !== "space") return false;
    const { spaceId, taskId } = c.row.source;
    const r = await asks.store.one(spaceId, taskId);
    const now = this.now();
    if (!r || r.kind !== "ask" || r.taken_by !== userId) return false;
    const tz = Number.isFinite(Number(r.ask?.tz)) ? Number(r.ask!.tz) : 330;
    const why = autoMust({ kind: "ask", title: r.title, timed: !r.all_day && r.at_ms !== null, dueDay: null, today: dayOf(now, tz) });
    if (!why) return false;
    const asker = r.set_by;
    const order = [userId, ...(r.turns?.order ?? []).filter((u) => u !== userId && u !== asker)];
    const item = itemId({ kind: "stask", spaceId, taskId });
    return this.insertFollow(asker, {
      item, sourceKey: `${item}@${c.at}`, kind: "ask", title: r.title, place: r.place ?? "", must: true, why, dueMs: r.at_ms, day: dayOf(r.at_ms ?? c.at, tz),
      tz, refs: order.map((id) => ({ k: "u" as const, id })), at: c.at, billClimb: false, leftAlready: false, dueAgain: null, noAsker: true,
    }, now);
  }

  private async insertFollow(asker: string, a: {
    item: string; sourceKey: string; kind: FollowKind; title: string; place: string; must: boolean; why: MustWhy | "set" | null;
    dueMs: number | null; day: string; tz: number; refs: Array<{ k: "u"; id: string; name?: string }>; at: number; billClimb: boolean; leftAlready: boolean;
    dueAgain: { due_day: string | null; tz_min: number } | null; noAsker?: boolean;
  }, now: number): Promise<boolean> {
    // One follow per occurrence: a second tick or a second server finds it (whatever its state).
    if ((await this.stores.follows.select({ user_id: asker, source_key: a.sourceKey }, { limit: 1 }))[0]) return true;
    // An older occurrence of the same item still going stops here (missed): a new one has come.
    for (const old of await this.stores.follows.ofItem(asker, a.item, 5)) {
      if (isOpenState(old.state)) await this.cas(old, { state: "missed", next_ms: null }, now);
    }
    // Who is on it, as the asker knows them; someone not in the asker's X0 people now starts as skipped (said once, below). A read that
    // failed skips nobody: the names saved on the item stand, and the first step checks again (and waits a minute while it can't read).
    let names: Map<string, string> | null;
    try { names = await this.peopleOf(asker); } catch (err) { if (!(err instanceof PeopleUnread)) throw err; names = null; }
    const people: FollowPerson[] = [];
    const cant: string[] = [];
    for (const r of a.refs) {
      if (people.some((p) => p.id === r.id)) continue;
      if (r.id === asker) { people.push(ASKER(asker)); continue; }
      people.push({ k: "u", id: r.id, name: names?.get(r.id) ?? r.name ?? "Someone" });
      if (names && !names.has(r.id)) cant.push(keyOf(r));
    }
    // Nobody who can be reached: the asker holds it (their item), unless it is a family ask (then its own pass-on decides).
    if (!people.length || people.every((p) => cant.includes(keyOf(p)))) {
      if (a.noAsker) return false;
      if (!people.some((p) => p.id === asker)) people.push(ASKER(asker));
    }
    const holder = people.findIndex((p) => !cant.includes(keyOf(p)));
    if (holder < 0) return false;
    const climb = a.billClimb && a.dueAgain ? Math.max(a.at, dueAgainAt(a.dueAgain, a.at) ?? a.at) : a.at;
    const t = await this.timings(now);
    const row: FollowRow = {
      id: randomUUID(), user_id: asker, item: a.item, source_key: a.sourceKey, kind: a.kind, title: a.title, place: a.place,
      importance: a.must ? "must" : "normal", why: a.why, due_ms: a.dueMs, day: a.day, tz_min: a.tz, people, holder, holder_key: keyOf(people[holder]!),
      cant, told: [], answers: [], state: "open", rung: "line", n: 1, laters: 0, base_ms: a.at, climb_ms: climb, next_ms: a.at,
      done_by: null, done_via: null, done_ms: null, created_ms: now, updated_ms: now,
    };
    // The asker's own leave-by already went: it was this occurrence's notification, but only when the asker holds it. Someone else on it
    // never got that leave-by (it goes to the event's owner), so their push still goes.
    const leftCounts = a.leftAlready && people[holder]!.id === asker;
    if (leftCounts) {
      const ladder = ladderOf({ importance: row.importance, base: row.base_ms, climb: row.climb_ms, t });
      row.rung = "push";
      row.next_ms = ladder[1]?.at ?? missAt({ base: row.base_ms, climb: row.climb_ms, t });
    }
    try {
      await this.stores.follows.insert(row);
    } catch (err) {
      // Another server armed it: followed. Anything else (the table missing before 0081): the reminder goes as before.
      if (isDuplicate(err)) return true;
      this.log.warn({ err: (err as Error)?.message }, "[follow] not armed");
      return false;
    }
    for (const k of cant) await this.record(row, { n: 1, rung: "push", person: k, channel: "push", state: "skipped", why: "gone" }, now);
    if (leftCounts) await this.record(row, { rung: "push", person: row.holder_key, channel: "push", state: "sent", why: "leave_by" }, now);
    // Someone else holds it while someone before them was skipped: the asker hears once who isn't in their X0 people.
    const h = people[holder]!;
    if (cant.length && h.id !== asker) {
      const gone = people.find((p) => cant.includes(keyOf(p)))!;
      await this.notify(asker, "plan_follow_passed", this.words("plan_follow_passed", row, now, { gone: gone.name, to: h.name }), row, { key: `${row.id}:1:gone` }, now);
    }
    await this.advance(row.id).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[follow] first step failed"));
    return true;
  }

  // ------------------------------------------------------------------ the sweep

  async sweep(nowIn?: number): Promise<number> {
    const now = nowIn ?? this.now();
    if (!followOn()) return 0;
    const due = await this.stores.follows.due(now, 100);
    for (const f of due) await this.advance(f.id, now).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[follow] step failed"));
    if (now - this.cleaned >= CLEAN_EVERY_MS) { this.cleaned = now; await this.cleanUp(now).catch(() => undefined); }
    return due.length;
  }

  /** Hourly: closed follows 90 days old go (steps with them), old caps go, and a close cut short is finished. */
  private async cleanUp(now: number): Promise<void> {
    await this.stores.follows.clean(now - KEEP_CLOSED_MS);
    await this.stores.caps.clean(new Date(now - 3 * DAY).toISOString().slice(0, 10));
    for (const f of await this.stores.follows.doneSince(now - DAY, 200)) {
      const taskId = taskIdOf(f);
      if (!taskId || f.done_via === "item" || untickedSince(f)) continue;
      const t = await this.calendar.task(f.user_id, taskId).catch(() => null);
      if (t && !t.done && t.due === f.day) await this.tickItem(f, true).catch(() => undefined);
    }
  }

  start(log?: Log): () => void {
    if (log) this.log = log;
    let busy = false;
    let warned = 0;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.sweep().catch((err) => {
        // A missing table (deploy before migration 0081): once an hour, not every minute.
        if (this.now() - warned > HOUR) { warned = this.now(); this.log.warn({ err: (err as Error)?.message }, "[follow] sweep failed"); }
      }).finally(() => { busy = false; });
    }, SWEEP_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  // ------------------------------------------------------------------ one step

  async advance(id: string, nowIn?: number): Promise<void> {
    const now = nowIn ?? this.now();
    let f = await this.read(id);
    if (!f || f.next_ms === null || f.next_ms > now || !isOpenState(f.state)) return;
    const t = await this.timings(now);
    // The item still stands?
    const live = await this.itemLive(f, now);
    if (live === "done") { await this.close(f, "done", { by: ASKER(f.user_id), via: "item" }, now); return; }
    if (live === "gone") { await this.close(f, "dropped", null, now); return; }
    if (live !== "live") f = live;
    if (now >= missAt({ base: f.base_ms, climb: f.climb_ms, t })) {
      const won = await this.cas(f, { state: "missed", next_ms: null }, now);
      if (won) this.publishAll(won);
      return;
    }
    if (f.state === "nobody") {
      const at = f.kind === "ask" ? Math.min(missAt({ base: f.base_ms, climb: f.climb_ms, t }), now + 5 * MIN) : missAt({ base: f.base_ms, climb: f.climb_ms, t });
      await this.cas(f, { next_ms: at }, now);
      return;
    }
    const rung = f.state === "snoozed" ? "line" : f.rung;
    let base = f.base_ms, climb = f.climb_ms;
    let ladder = ladderOf({ importance: f.importance, base, climb, t });
    let step: LadderStep;
    if (rung === "line") {
      // The push always goes first, whatever else is also due; late, it still goes and the climb starts again from now.
      step = ladder[0]!;
      if (step.at > now) { await this.cas(f, { next_ms: step.at }, now); return; }
      if (now - step.at > t.lateSkipMin * MIN) {
        base = now;
        climb = f.kind === "due" && f.climb_ms > now ? f.climb_ms : now;
        ladder = ladderOf({ importance: f.importance, base, climb, t });
        step = ladder[0]!;
      }
    } else {
      const due = ladder.filter((s) => RUNG_RANK[s.rung] > RUNG_RANK[rung] && s.at <= now);
      if (!due.length) {
        const next = ladder.find((s) => RUNG_RANK[s.rung] > RUNG_RANK[rung]);
        await this.cas(f, { next_ms: next ? next.at : missAt({ base, climb, t }) }, now);
        return;
      }
      // After a restart only the latest due step is taken, never two at once.
      step = due[due.length - 1]!;
    }
    // The asker's X0 people, read once for this step when it reaches someone else (or tells). A read that fails decides nothing: the step
    // waits a minute and tries again (nobody is skipped, passed on or told about for it).
    const reach = this.reachOf(f.user_id);
    if (!isAskerOf(f, holderOf(f).id) || (step.rung === "tell" && f.people.some((p) => !isAskerOf(f, p.id)))) {
      try { await reach.names(); } catch (err) {
        if (!(err instanceof PeopleUnread)) throw err;
        await this.cas(f, { next_ms: now + MIN }, now);
        return;
      }
    }
    const after = ladder.find((s) => RUNG_RANK[s.rung] > RUNG_RANK[step.rung]);
    // The tell is decided first: the follow says "told" only when someone will be told (nobody to tell keeps it open).
    const tell = step.rung === "tell" ? await this.tellPlan(f, holderOf(f), reach) : null;
    const won = await this.cas(f, {
      rung: step.rung, state: (tell && "target" in tell) || f.state === "told" ? "told" : "open",
      next_ms: after ? after.at : missAt({ base, climb, t }), base_ms: base, climb_ms: climb,
    }, now);
    if (!won) return;
    await this.runRung(won, step.rung, now, t, reach, tell).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[follow] rung failed"));
  }

  /** Whether the item still stands: "live", "done", "gone", or (a family ask taken by someone else since) the follow re-targeted. */
  private async itemLive(f: FollowRow, now: number): Promise<"live" | "done" | "gone" | FollowRow> {
    const it = parseItem(f.item);
    if (!it) return "gone";
    if (it.kind === "pt") {
      const t = await this.calendar.task(f.user_id, it.taskId).catch(() => null);
      if (!t) return "gone";
      if (t.done) return "done";
      // A to-do moved to another day or time is a new occurrence (its own follow comes at its new reminder).
      return t.due === f.day && (t.at ?? null) === f.due_ms ? "live" : "gone";
    }
    if (it.kind === "pe") {
      const e = await this.calendar.event(f.user_id, eventIdOf(it.eventRef), f.tz_min).catch(() => null);
      return e && e.day === f.day && e.start === f.due_ms ? "live" : "gone";
    }
    if (it.kind === "stask") {
      const asks = planAsks();
      if (!asks || !spacesOn()) return "gone";
      const r = await asks.store.one(it.spaceId, it.taskId).catch(() => null);
      if (!r) return "gone";
      const taker = r.taken_by;
      if (taker && (r.states?.[taker] as { status?: string } | undefined)?.status === "done") return "done";
      if (taker && taker !== holderOf(f).id) {
        const names = await this.contactsOf(f.user_id);
        let people = f.people;
        let idx = people.findIndex((p) => p.id === taker);
        if (idx < 0) { people = [...people, { k: "u", id: taker, name: names.get(taker) ?? "Someone" }]; idx = people.length - 1; }
        const won = await this.cas(f, { people, holder: idx, holder_key: keyOf(people[idx]!), n: f.n + 1, base_ms: now, climb_ms: now, rung: "push", state: "open" }, now);
        return won ?? "live";
      }
      return "live";
    }
    return "gone";
  }

  // ------------------------------------------------------------------ the rungs

  private async runRung(f: FollowRow, rung: StepRung, now: number, t: FollowTimings, reach: Reach, tell: TellPlan | null): Promise<void> {
    const holder = holderOf(f);
    switch (rung) {
      case "push": return this.runPush(f, holder, now, t, reach);
      case "loud": return this.runLoud(f, holder, now, reach);
      case "call": return this.runCall(f, holder, now, reach);
      case "phone": return this.runPhone(f, holder, now, t, reach);
      case "tell": return this.runTell(f, holder, now, tell ?? (await this.tellPlan(f, holder, reach)));
    }
  }

  /**
   * Before any reach to someone else: still in the asker's X0 people (else skipped, passed on, the asker told once: "gone") and their chat
   * with the asker not muted ("muted"). Null when it may go.
   */
  private async mayReach(f: FollowRow, holder: FollowPerson, reach: Reach): Promise<"gone" | "muted" | null> {
    if (isAskerOf(f, holder.id)) return null;
    if (!(await reach.has(holder.id))) return "gone";
    if (await this.isMuted(holder.id, f.user_id)) return "muted";
    return null;
  }

  /** Someone else's louder steps (loud, X0 is calling, a real call): their own yes for this asker, and never at night without quiet hours. */
  private async memberLouder(f: FollowRow, holder: FollowPerson, s: YouSettings, now: number): Promise<string | null> {
    if (isAskerOf(f, holder.id)) return null;
    if (!s.notify.followFrom.includes(f.user_id)) return "no_optin";
    if (!s.notify.quiet) {
      const m = minuteOf(now, (await this.tzOfUser(holder.id).catch(() => null)) ?? f.tz_min);
      if (m >= NIGHT_FROM || m < NIGHT_TO) return "quiet";
    }
    return null;
  }

  private async runPush(f: FollowRow, holder: FollowPerson, now: number, t: FollowTimings, reach: Reach): Promise<void> {
    const asker = f.user_id;
    const key = keyOf(holder);
    const block = await this.mayReach(f, holder, reach);
    if (block === "gone") { await this.skipGone(f, now); return; }
    if (block === "muted") { await this.record(f, { rung: "push", person: key, channel: "push", state: "skipped", why: "muted" }, now); await this.unreached(f, holder, now); return; }
    const mine = isAskerOf(f, holder.id);
    if (mine && f.importance === "normal" && this.spend && !(await this.spend(asker, capDay(now, f.tz_min)).catch(() => true))) {
      await this.record(f, { rung: "push", person: key, channel: "push", state: "skipped", why: "cap" }, now);
      return;
    }
    const stepId = await this.claim(f, "push", key, "push", now);
    if (!stepId) return;
    if (!(await this.stillMine(f))) { await this.finish(stepId, { state: "skipped", why: "late" }); return; }
    let res: { sent: boolean; id?: string } | null;
    if (mine && f.kind === "due") {
      res = await this.billPush(f, "push", now);
    } else if (mine) {
      const gone = await this.goneAt(f);
      res = await this.notify(asker, "plan_follow", this.words("plan_follow", f, now, gone ? { gone } : {}), f, {
        key: `${f.id}:${f.n}:push`, ...(f.laters >= t.laterMax ? { category: "x0_follow_last" } : {}),
      }, now);
    } else {
      const askerName = await this.nameIn(holder.id, asker);
      res = await this.notify(holder.id, "space_follow", this.words("space_follow", f, now, { asker: askerName }), f, {
        key: `${f.id}:${f.n}:push`, ...(f.laters >= t.laterMax ? { category: "x0_follow_last" } : {}),
      }, now);
    }
    if (!res) await this.finish(stepId, { state: "skipped", why: "not_sent" });
    else await this.finish(stepId, { state: res.sent ? "sent" : "failed", ext: res.id ?? null });
    // Someone else's push could not go at all: the asker hears at once ("X0 couldn't reach Mom"), a normal item too.
    if (!mine && (!res || !res.sent)) await this.unreached(f, holder, now);
  }

  /** Who was skipped on this climb for not being in the asker's X0 people (said once, in the asker's own push). */
  private async goneAt(f: FollowRow): Promise<string | null> {
    const rows = await this.stores.steps.select({ follow_id: f.id, n: f.n, why: "gone" }, { limit: 5 }).catch(() => [] as StepRow[]);
    const key = rows.find((r) => r.rung === "push")?.person;
    return key ? f.people.find((p) => keyOf(p) === key)?.name ?? null : null;
  }

  private async runLoud(f: FollowRow, holder: FollowPerson, now: number, reach: Reach): Promise<void> {
    const key = keyOf(holder);
    const skip = (why: string) => this.record(f, { rung: "loud", person: key, channel: "push", state: "skipped", why }, now);
    const block = await this.mayReach(f, holder, reach);
    if (block === "gone") { await this.skipGone(f, now); return; }
    if (block === "muted") { await skip("muted"); return; }
    const s = await this.settingsOf(holder.id);
    if (s.notify.follow === false) { await skip("off"); return; }
    const member = await this.memberLouder(f, holder, s, now);
    if (member) { await skip(member); return; }
    const day = capDay(now, f.tz_min);
    if (!(await capTakeAll(this.stores.caps, [{ person: key, day, max: s.notify.ringMax }]))) { await skip("cap"); return; }
    const stepId = await this.claim(f, "loud", key, "push", now);
    if (!stepId) { await capGive(this.stores.caps, key, day); return; }
    if (!(await this.stillMine(f))) { await capGive(this.stores.caps, key, day); await this.finish(stepId, { state: "skipped", why: "late" }); return; }
    const mine = isAskerOf(f, holder.id);
    const res = mine && f.kind === "due"
      ? await this.billPush(f, "loud", now)
      : mine
        ? await this.notify(holder.id, "plan_follow_loud", this.words("plan_follow_loud", f, now), f, { key: `${f.id}:${f.n}:loud` }, now)
        : await this.notify(holder.id, "space_follow_loud", this.words("space_follow_loud", f, now, { asker: await this.nameIn(holder.id, f.user_id) }), f, { key: `${f.id}:${f.n}:loud` }, now);
    if (!res) { await capGive(this.stores.caps, key, day); await this.finish(stepId, { state: "skipped", why: "not_sent" }); return; }
    await this.finish(stepId, { state: res.sent ? "sent" : "failed", ext: res.id ?? null });
  }

  private async runCall(f: FollowRow, holder: FollowPerson, now: number, reach: Reach): Promise<void> {
    const key = keyOf(holder);
    const skip = (why: string) => this.record(f, { rung: "call", person: key, channel: "ring", state: "skipped", why }, now);
    const block = await this.mayReach(f, holder, reach);
    if (block === "gone") { await this.skipGone(f, now); return; }
    if (block === "muted") { await skip("muted"); return; }
    const s = await this.settingsOf(holder.id);
    if (s.notify.follow === false) { await skip("off"); return; }
    const member = await this.memberLouder(f, holder, s, now);
    if (member) { await skip(member); return; }
    const day = capDay(now, f.tz_min);
    if (!(await capTakeAll(this.stores.caps, [{ person: key, day, max: s.notify.ringMax }]))) { await skip("cap"); return; }
    const stepId = await this.claim(f, "call", key, "ring", now);
    if (!stepId) { await capGive(this.stores.caps, key, day); return; }
    if (!(await this.stillMine(f))) { await capGive(this.stores.caps, key, day); await this.finish(stepId, { state: "skipped", why: "late" }); return; }
    const mine = isAskerOf(f, holder.id);
    const askerName = mine ? "" : firstName(await this.nameIn(holder.id, f.user_id));
    const loud = this.words(mine ? "plan_follow_loud" : "space_follow_loud", f, now, { asker: askerName });
    const r = await this.calls().ring(holder.id, {
      source: "follow", item: this.pfItem(f), followId: f.id, day: f.day, tz: f.tz_min, title: f.title, at: f.due_ms ?? f.base_ms, asker: askerName,
    }, { key: `follow:${f.id}:${f.n}`, line: loud.title, more: loud.body, now }).catch(() => ({ none: "not_sent" }));
    if ("id" in r) { await this.finish(stepId, { state: "sent", ext: r.id }); return; }
    // A ring planCall refused never uses up the day's rings.
    await capGive(this.stores.caps, key, day);
    await this.finish(stepId, { state: "skipped", why: r.none });
  }

  private async runPhone(f: FollowRow, holder: FollowPerson, now: number, t: FollowTimings, reach: Reach): Promise<void> {
    const ph = followChannels().phone;
    const key = keyOf(holder);
    const block = await this.mayReach(f, holder, reach);
    if (block === "gone") { await this.skipGone(f, now); return; }
    const s = await this.settingsOf(holder.id);
    // Only for someone who turned it on for their own number, and only once the provider is set up: else this rung passes quietly.
    if (!s.notify.phoneCall || !ph || !(() => { try { return ph.ready(); } catch { return false; } })()) return;
    const skip = (why: string) => this.record(f, { rung: "phone", person: key, channel: "phone", state: "skipped", why }, now);
    if (block === "muted") { await skip("muted"); return; }
    if (s.notify.follow === false) { await skip("off"); return; }
    const member = await this.memberLouder(f, holder, s, now);
    if (member) { await skip(member); return; }
    const tz = (await this.tzOfUser(holder.id).catch(() => null)) ?? f.tz_min;
    const can = await ph.canCall(holder.id, now, tz).catch(() => "off" as const);
    if (can !== "ok") { await skip(can); return; }
    const day = capDay(now, f.tz_min);
    // The number itself counts too (its keyed hash): however many accounts it has been on today, it rings phoneDayMax times at most.
    const number = await (ph.numberKey?.(holder.id) ?? Promise.resolve(null)).catch(() => null);
    const takes = [
      { person: key, day, max: s.notify.ringMax },
      { person: `p:${holder.id}`, day, max: t.phoneDayMax },
      ...(number ? [{ person: `n:${number}`, day, max: t.phoneDayMax }] : []),
      { person: `ap:${f.user_id}`, day, max: ceiling("FOLLOW_CALL_ASKER_DAY_MAX") },
      { person: "all:p", day: utcDay(now), max: ceiling("FOLLOW_CALL_DAY_MAX") },
    ];
    if (!(await capTakeAll(this.stores.caps, takes))) { await skip("cap"); return; }
    const giveBack = async () => { for (const c of takes) await capGive(this.stores.caps, c.person, c.day).catch(() => undefined); };
    const stepId = await this.claim(f, "phone", key, "phone", now);
    if (!stepId) { await giveBack(); return; }
    if (!(await this.stillMine(f))) { await giveBack(); await this.finish(stepId, { state: "skipped", why: "late" }); return; }
    const mine = isAskerOf(f, holder.id);
    const out = await ph.call({
      followId: f.id, n: f.n, userId: holder.id, person: key, asker: mine ? "" : firstName(await this.nameIn(holder.id, f.user_id)),
      what: forOthers(f.title), when: this.when(f, now), tz, now,
    }).catch(() => ({ ok: false as const, why: "timeout" }));
    if (out.ok) { await this.finish(stepId, { state: "sent", ext: out.ext }); return; }
    // Never left (refused before the provider took it): the caps go back. A timeout may have gone: kept.
    if (/^(?:http_4|refused)/.test(out.why)) await giveBack();
    await this.finish(stepId, { state: "failed", why: out.why.slice(0, 40) });
  }

  /**
   * Who the tell rung tells, or why nobody: "none" (nobody else on it who can be reached: a must item that is only the asker's), "off" (the
   * asker turned off telling the family), "muted" (the one to tell muted their chat with the asker).
   */
  private async tellPlan(f: FollowRow, holder: FollowPerson, reach: Reach): Promise<TellPlan> {
    const skip: string[] = [];
    for (const p of f.people) if (!(await reach.has(p.id))) skip.push(keyOf(p));
    const target = tellTarget(f, skip);
    if (!target) return { skip: "none", person: holder };
    if (isAskerOf(f, holder.id) && (await this.settingsOf(f.user_id)).notify.followTell === false) return { skip: "off", person: target };
    if (!isAskerOf(f, target.id) && (await this.isMuted(target.id, f.user_id))) return { skip: "muted", person: target };
    return { target };
  }

  private async runTell(f: FollowRow, holder: FollowPerson, now: number, plan: TellPlan): Promise<void> {
    if ("skip" in plan) { await this.record(f, { rung: "tell", person: keyOf(plan.person), channel: "push", state: "skipped", why: plan.skip }, now); return; }
    await this.sendTell(f, plan.target, holder, now, {});
  }

  /** A call still ringing for this climb on `userId`'s phone ends (they can't, they left, they were taken off). */
  private async endRing(f: FollowRow, userId: string, now: number): Promise<void> {
    await this.calls().closeFor(userId, `follow:${f.id}:${f.n}`, now).catch(() => undefined);
  }

  /** The tell to one person, claimed first (an "unreached" tell and the ladder's own at the same n are one). */
  private async sendTell(f: FollowRow, target: FollowPerson, holder: FollowPerson, now: number, o: { unreached?: boolean }): Promise<void> {
    const key = keyOf(target);
    const stepId = await this.claim(f, "tell", key, "push", now);
    if (!stepId) return;
    if (!(await this.stillMine(f))) { await this.finish(stepId, { state: "skipped", why: "late" }); return; }
    const toAsker = isAskerOf(f, target.id);
    const number = !isAskerOf(f, holder.id) || !toAsker ? await this.people.numberFor(target.id, holder.id).catch(() => null) : null;
    const category = number ? "x0_follow_tell" : "x0_follow_check";
    const words = toAsker
      ? this.words("plan_follow_tell", f, now, { holder: holder.name, unreached: o.unreached === true })
      : this.words("space_follow_tell", f, now, { holder: isAskerOf(f, holder.id) ? await this.nameIn(target.id, f.user_id) : holder.name });
    const res = await this.notify(target.id, toAsker ? "plan_follow_tell" : "space_follow_tell", words, f, { key: `${f.id}:${f.n}:tell:${target.id}`, category }, now);
    await this.finish(stepId, !res ? { state: "skipped", why: "not_sent" } : { state: res.sent ? "sent" : "failed", ext: res.id ?? null });
    // Kept on the row: the follow page and the cards say who was told.
    for (let i = 0; i < TRIES; i += 1) {
      const r = await this.read(f.id);
      if (!r || r.told.includes(key)) break;
      if (await this.cas(r, { told: [...r.told, key] }, now)) break;
    }
    this.publishAll(f);
  }

  /** Someone else's push could not go: the asker is told at once, and the follow shows as told (the asker's card). */
  private async unreached(f: FollowRow, holder: FollowPerson, now: number): Promise<void> {
    const r = await this.read(f.id);
    if (!r || r.n !== f.n || !isOpenState(r.state)) return;
    const won = r.state === "told" ? r : await this.cas(r, { state: "told" }, now);
    if (!won) return;
    await this.sendTell(won, ASKER(f.user_id), holder, now, { unreached: true });
  }

  /**
   * The holder is not in the asker's X0 people now (left the space, a block either way, Spaces off): skipped, no push and no call. The job
   * goes to the next person (whose own step re-checks them), and the asker hears once: in their own push when it comes back to them,
   * else "Mom isn't in your X0 people · Dad has it now", or with nobody left, "I'll do it".
   */
  private async skipGone(f: FollowRow, now: number): Promise<void> {
    const t = await this.timings(now);
    const holder = holderOf(f);
    const goneKey = keyOf(holder);
    const cant = [...new Set([...f.cant, goneKey])];
    const next = nextHolder(f.people, f.holder, cant);
    const n = f.n + 1;
    if (next !== null) {
      const won = await this.cas(f, {
        holder: next, holder_key: keyOf(f.people[next]!), cant, n, base_ms: now, climb_ms: now, rung: "line", state: "open", next_ms: now, told: [],
      }, now);
      if (!won) return;
      await this.endRing(f, holder.id, now);
      await this.record(won, { n, rung: "push", person: goneKey, channel: "push", state: "skipped", why: "gone" }, now);
      const to = f.people[next]!;
      if (!isAskerOf(f, to.id)) {
        await this.notify(f.user_id, "plan_follow_passed", this.words("plan_follow_passed", won, now, { gone: holder.name, to: to.name }), won, { key: `${f.id}:${n}:gone` }, now);
      }
      this.publishAll(won);
      await this.advance(f.id, now);
      return;
    }
    const won = await this.cas(f, { cant, n, rung: "line", state: "nobody", next_ms: missAt({ base: f.base_ms, climb: f.climb_ms, t }), told: [] }, now);
    if (!won) return;
    await this.endRing(f, holder.id, now);
    await this.record(won, { n, rung: "push", person: goneKey, channel: "push", state: "skipped", why: "gone" }, now);
    await this.notify(f.user_id, "plan_follow_none", this.words("plan_follow_none", won, now, { gone: holder.name }), won, { key: `${f.id}:${n}:none`, category: "x0_follow_none" }, now);
    this.publishAll(won);
  }

  // ------------------------------------------------------------------ closing

  private async close(f: FollowRow, state: "done" | "dropped" | "missed", done: { by: FollowPerson; via: FollowVia } | null, now: number, extra: Partial<FollowRow> = {}): Promise<FollowRow | null> {
    const patch: Partial<FollowRow> = state === "done" && done
      ? { state, next_ms: null, done_by: done.by, done_via: done.via, done_ms: now, ...extra }
      : { state, next_ms: null, ...extra };
    const won = await this.cas(f, patch, now);
    if (!won) return null;
    await this.afterClose(won, done, now).catch((err) => this.log.warn({ err: (err as Error)?.message }, "[follow] close cut short"));
    return won;
  }

  private async afterClose(f: FollowRow, done: { by: FollowPerson; via: FollowVia } | null, now: number): Promise<void> {
    // The item itself, when the answer came from a person (not from the item).
    if (done && done.via !== "item") await this.tickItem(f, true, done.by).catch(() => undefined);
    const steps = await this.stores.steps.select({ follow_id: f.id }, { limit: 200 }).catch(() => [] as StepRow[]);
    // A call still ringing for it ends.
    for (const s of steps.filter((x) => x.channel === "ring")) {
      await this.calls().closeFor(s.person.replace(/^u:/, ""), `follow:${f.id}:${s.n}`, now).catch(() => undefined);
    }
    if (done) {
      const byKey = keyOf(done.by);
      // Quiet replacements for what is in their trays: the asker hears who said done; members sent a push lately see it said.
      if (!isAskerOf(f, done.by.id)) {
        await this.notify(f.user_id, "plan_follow_done", this.words("plan_follow_done", f, now, { who: done.by.name || "Someone", clock: clockAt(now, f.tz_min) }), f, { key: `${f.id}:done` }, now);
      }
      const told = new Set<string>();
      const reach = this.reachOf(f.user_id);
      for (const s of steps) {
        if (s.person === byKey || s.person === `u:${f.user_id}` || s.channel !== "push" || told.has(s.person)) continue;
        if (s.state !== "sent" && s.state !== "opened") continue;
        if (now - s.at_ms > DONE_TELL_MS) continue;
        told.add(s.person);
        const id = s.person.replace(/^u:/, "");
        // Only to someone still in the asker's X0 people (a read that failed sends nothing: it is a quiet line, not a reminder).
        if (!(await reach.has(id).catch(() => false))) continue;
        const who = isAskerOf(f, done.by.id) ? await this.nameIn(id, f.user_id) : (await this.contactsOf(id)).get(done.by.id) ?? done.by.name;
        await this.notify(id, "space_follow_done", this.words("space_follow_done", f, now, { who }), f, { key: `${f.id}:done:${id}` }, now);
      }
    }
    this.publishAll(f, true);
  }

  /** The item itself: a to-do ticked, a bill paid (next month's made once), a family ask said done by its holder. */
  private async tickItem(f: FollowRow, done: boolean, by?: FollowPerson): Promise<void> {
    const it = parseItem(f.item);
    if (!it) return;
    if (it.kind === "pt") {
      const cap = planCapture();
      if (f.kind === "due" && cap) await cap.paid(f.user_id, it.taskId, done);
      else await this.calendar.tickTask(f.user_id, it.taskId, done);
      return;
    }
    if (it.kind === "stask" && done && by && this.spaceDone && by.id === holderOf(f).id) await this.spaceDone(by.id, it.spaceId, it.taskId);
  }

  /** Everyone on it hears the change live (the Plan, Home), and a notice of every climb on a computer goes. */
  private publishAll(f: FollowRow, closed = false): void {
    const ids = new Set([f.user_id, ...f.people.map((p) => p.id)]);
    for (const id of ids) {
      livePublish(id, [botTopic("plan"), TOPIC.home]);
      if (!closed) continue;
      for (let n = 1; n <= f.n; n += 1) noticeGone(id, itemId({ kind: "pf", followId: f.id, n }));
    }
    const taskId = taskIdOf(f);
    if (closed && taskId && f.kind === "due") noticeGone(f.user_id, `pt:${taskId}`);
  }

  // ------------------------------------------------------------------ replies (the one door)

  private roleOf(f: FollowRow, by: PersonKey): "asker" | "holder" | "backup" | null {
    if (by === keyOf(ASKER(f.user_id))) return "asker";
    if (by === f.holder_key) return "holder";
    return f.people.some((p) => keyOf(p) === by) ? "backup" : null;
  }

  /** Every answer, from every door. Never throws. */
  async reply(o: ReplyIn): Promise<ActResult> {
    try {
      if (!followOn()) return no(404, "follow_off", "That isn't switched on here.");
      for (let i = 0; i < TRIES; i += 1) {
        const f = await this.read(o.followId);
        if (!f) return no(404, "not_found", "That isn't there any more.");
        const out = await this.decide(f, o);
        if (out !== "lost") return out;
      }
      return no(503, "busy", "Try that again in a moment.");
    } catch (err) {
      this.log.warn({ err: (err as Error)?.message }, "[follow] reply failed");
      return no(500, "failed", "Couldn't do that just now.");
    }
  }

  private async decide(f: FollowRow, o: ReplyIn): Promise<ActResult | "lost"> {
    const now = this.now();
    const role = this.roleOf(f, o.by);
    const byId = o.by.replace(/^u:/, "");
    if (!role) return no(404, "not_found", "That isn't there any more.");
    // Someone no longer in the asker's X0 people (left, a block): nothing from them reaches this item any more. A read that failed is not
    // that: the answer counts (they are on the item).
    if (role !== "asker" && (await this.stillIn(f.user_id, byId)) === false) return no(404, "not_found", "That isn't there any more.");
    const mine = f.answers.filter((a) => a.by === o.by);
    const last = mine[mine.length - 1];
    if (last && last.verb === o.answer && now - last.at < SAME_ANSWER_MS) return ok("already");
    if ((o.answer === "later" || o.answer === "cant") && o.n !== undefined && o.n !== f.n) return ok("already");
    const answer: FollowAnswer = { by: o.by, verb: o.answer, via: o.via, at: now, n: f.n };
    const answers = [...f.answers, answer].slice(-ANSWERS_KEPT);
    const me = role === "asker" ? ASKER(f.user_id) : f.people.find((p) => keyOf(p) === o.by)!;
    const t = await this.timings(now);
    switch (o.answer) {
      case "done": {
        if (f.state === "done") return ok("already", { message: `${f.done_by && f.done_by.id !== byId ? firstName(f.done_by.name || "Someone") : "You"} already said done.` });
        // Missed or dropped, but the item itself is still open (a Done from a push still in the tray, after 3 am): it counts and the item
        // is ticked. An item that moved on, was taken out or is done already: over.
        if (!isOpenState(f.state) && (await this.closedButOpen(f, now)) !== "live") return ok("already", { message: "That one's over." });
        const won = await this.close(f, "done", { by: me, via: o.via }, now, { answers });
        if (!won) return "lost";
        return ok("done", { message: role === "holder" || f.people.length <= 1 ? "Done." : "Done. I told everyone." });
      }
      case "later": {
        if (role !== "holder" && !(role === "asker" && isAskerOf(f, holderOf(f).id))) return no(409, "not_yours", `Only ${firstName(holderOf(f).name || "who has it")} can put this off.`);
        if (!["open", "snoozed", "told"].includes(f.state)) return ok("already");
        if (f.laters >= t.laterMax) return ok("kept", { message: "That's the last Later. Done, or can't?" });
        const at = laterAt(o.later ?? "default", { now, tz: f.tz_min, must: f.importance === "must", t });
        const climb = f.kind === "due" && f.climb_ms > at ? f.climb_ms : at;
        const won = await this.cas(f, { state: "snoozed", n: f.n + 1, laters: f.laters + 1, base_ms: at, next_ms: at, climb_ms: climb, rung: "line", told: [], answers }, now);
        if (!won) return "lost";
        await this.calls().closeFor(holderOf(f).id, `follow:${f.id}:${f.n}`, now).catch(() => undefined);
        this.publishAll(won);
        for (let n = 1; n <= f.n; n += 1) noticeGone(holderOf(f).id, itemId({ kind: "pf", followId: f.id, n }));
        return ok("later", { message: `I'll remind you at ${clockAt(at, f.tz_min)}.` });
      }
      case "cant": {
        if (role !== "holder" && !(role === "asker" && isAskerOf(f, holderOf(f).id))) return no(409, "not_yours", `Only ${firstName(holderOf(f).name || "who has it")} can say that.`);
        if (!["open", "snoozed", "told"].includes(f.state)) return ok("already");
        return this.cant(f, answers, now, t);
      }
      case "take": {
        if (role === "holder" && f.state !== "nobody") return ok("already", { message: "It's yours already." });
        if (!["nobody", "told", "open", "snoozed"].includes(f.state)) return ok("already");
        let people = f.people;
        let idx = people.findIndex((p) => keyOf(p) === o.by);
        if (idx < 0) { people = [...people, me]; idx = people.length - 1; }
        const ladder = ladderOf({ importance: f.importance, base: now, climb: now, t });
        const won = await this.cas(f, {
          people, holder: idx, holder_key: keyOf(people[idx]!), cant: f.cant.filter((k) => k !== o.by), n: f.n + 1, base_ms: now, climb_ms: now,
          rung: "push", state: "open", next_ms: ladder[1]?.at ?? missAt({ base: now, climb: now, t }), answers,
        }, now);
        if (!won) return "lost";
        this.publishAll(won);
        return ok("taken", { message: "It's yours now." });
      }
      case "undone": {
        if (f.state !== "done" || !f.done_by || keyOf(f.done_by) !== o.by || f.done_ms === null || now - f.done_ms > UNDONE_MS) return ok("already");
        const ladder = ladderOf({ importance: f.importance, base: f.base_ms, climb: f.climb_ms, t });
        const next = ladder.find((s) => RUNG_RANK[s.rung] > RUNG_RANK[f.rung]);
        const won = await this.cas(f, { state: "open", done_by: null, done_via: null, done_ms: null, next_ms: next ? next.at : missAt({ base: f.base_ms, climb: f.climb_ms, t }), answers }, now);
        if (!won) return "lost";
        await this.tickItem(won, false).catch(() => undefined);
        this.publishAll(won);
        return ok("undone");
      }
    }
    return no(400, "bad_request", "That button doesn't do anything here.");
  }

  /** Can't: a family ask through its own pass-on; else the next person has it at once, or nobody is left. */
  private async cant(f: FollowRow, answers: FollowAnswer[], now: number, t: FollowTimings): Promise<ActResult | "lost"> {
    const holder = holderOf(f);
    const holderKey = keyOf(holder);
    const it = parseItem(f.item);
    if (it?.kind === "stask") {
      const asks = planAsks();
      if (asks) await asks.cant(holder.id, it.spaceId, it.taskId).catch(() => undefined);
      const r = asks ? await asks.store.one(it.spaceId, it.taskId).catch(() => null) : null;
      if (r?.taken_by && r.taken_by !== holder.id) {
        let people = f.people;
        let idx = people.findIndex((p) => p.id === r.taken_by);
        if (idx < 0) { people = [...people, { k: "u", id: r.taken_by, name: await this.nameIn(f.user_id, r.taken_by) }]; idx = people.length - 1; }
        const ladder = ladderOf({ importance: f.importance, base: now, climb: now, t });
        const won = await this.cas(f, {
          people, holder: idx, holder_key: keyOf(people[idx]!), cant: [...new Set([...f.cant, holderKey])], n: f.n + 1, base_ms: now, climb_ms: now,
          rung: "push", state: "open", next_ms: ladder[1]?.at ?? missAt({ base: now, climb: now, t }), told: [], answers,
        }, now);
        if (!won) return "lost";
        await this.endRing(f, holder.id, now);
        this.publishAll(won);
        return ok("passed", { message: `I'll ask ${firstName(people[idx]!.name)}.` });
      }
      const won = await this.cas(f, { cant: [...new Set([...f.cant, holderKey])], state: "nobody", next_ms: Math.min(missAt({ base: f.base_ms, climb: f.climb_ms, t }), now + 5 * MIN), answers }, now);
      if (!won) return "lost";
      await this.endRing(f, holder.id, now);
      this.publishAll(won);
      return ok("nobody", { message: "Okay. I'll let them know." });
    }
    const cant = [...new Set([...f.cant, holderKey])];
    const next = nextHolder(f.people, f.holder, cant);
    if (next !== null) {
      const to = f.people[next]!;
      const won = await this.cas(f, {
        holder: next, holder_key: keyOf(to), cant, n: f.n + 1, base_ms: now, climb_ms: now, rung: "line", state: "open", next_ms: now, told: [], answers,
      }, now);
      if (!won) return "lost";
      await this.endRing(f, holder.id, now);
      if (!isAskerOf(f, holder.id) && !isAskerOf(f, to.id)) {
        await this.notify(f.user_id, "plan_follow_passed", this.words("plan_follow_passed", won, now, { from: holder.name, to: to.name }), won, { key: `${f.id}:${won.n}:passed` }, now);
      } else if (!isAskerOf(f, holder.id)) {
        await this.notify(f.user_id, "plan_follow_passed", this.words("plan_follow_passed", won, now, { from: holder.name, to: "You" }), won, { key: `${f.id}:${won.n}:passed` }, now);
      }
      for (let n = 1; n <= f.n; n += 1) noticeGone(holder.id, itemId({ kind: "pf", followId: f.id, n }));
      this.publishAll(won);
      await this.advance(f.id, now).catch(() => undefined);
      return ok("passed", { message: `I'll ask ${isAskerOf(f, to.id) ? (await this.nameIn(holder.id, f.user_id)) : firstName(to.name)}.` });
    }
    if (isAskerOf(f, holder.id)) {
      const won = await this.close(f, "dropped", null, now, { cant, answers });
      if (!won) return "lost";
      return ok("dropped", { message: "Okay, not this time." });
    }
    const won = await this.cas(f, { cant, state: "nobody", next_ms: missAt({ base: f.base_ms, climb: f.climb_ms, t }), answers }, now);
    if (!won) return "lost";
    await this.endRing(f, holder.id, now);
    await this.notify(f.user_id, "plan_follow_none", this.words("plan_follow_none", won, now), won, { key: `${f.id}:${won.n}:none`, category: "x0_follow_none" }, now);
    for (let n = 1; n <= f.n; n += 1) noticeGone(holder.id, itemId({ kind: "pf", followId: f.id, n }));
    this.publishAll(won);
    return ok("nobody", { message: `Nobody else is on it. I told ${firstName(await this.nameIn(holder.id, f.user_id))}.` });
  }

  /** A member's yes or no to this asker's louder steps (the follow page's Allow / Not now). Not an answer: the follow doesn't change. */
  async allow(userId: string, followId: string, on: boolean): Promise<ActResult> {
    const f = await this.read(followId);
    if (!f || isAskerOf(f, userId) || !f.people.some((p) => p.id === userId)) return no(404, "not_found", "That isn't there any more.");
    const inPeople = await this.stillIn(f.user_id, userId);
    if (inPeople === null) return no(503, "busy", "Try that again in a moment.");
    if (!inPeople) return no(404, "not_found", "That isn't there any more.");
    const cur = await this.settingsOf(userId);
    const r = applyPatch(cur, { notify: { followFrom: { id: f.user_id, on } } });
    if (!r.ok) return no(400, "bad_request", r.message);
    await this.saveSettings(userId, r.settings);
    const asker = firstName(await this.nameIn(userId, f.user_id));
    return on
      ? ok("allowed", { message: `Okay. ${asker}'s must-not-miss reminders can ring and call you.` })
      : ok("denied", { message: `Okay. Just notifications from ${asker}.` });
  }

  // ------------------------------------------------------------------ the calendar's tick hook

  async taskTicked(userId: string, taskId: string, what: "done" | "undone" | "gone"): Promise<void> {
    if (!followOn()) return;
    const f = await this.current(userId, `pt:${taskId}`);
    if (!f) return;
    // Un-ticked (or un-paid) on the Plan after someone said done: the person meant it. Kept as their answer, so the hourly repair of a
    // close cut short never ticks it again (or makes next month's bill again). The follow stays closed.
    if (what === "undone") { if (f.state === "done" && f.done_via !== "item" && !untickedSince(f)) await this.keepUndone(f, userId); return; }
    if (!isOpenState(f.state)) return;
    const now = this.now();
    if (what === "done") await this.close(f, "done", { by: ASKER(userId), via: "item" }, now);
    else await this.close(f, "dropped", null, now);
  }

  private async keepUndone(f: FollowRow, userId: string): Promise<void> {
    for (let i = 0; i < TRIES; i += 1) {
      const r = i === 0 ? f : await this.read(f.id);
      if (!r || r.state !== "done" || untickedSince(r)) return;
      const now = this.now();
      const answer: FollowAnswer = { by: keyOf({ id: userId }), verb: "undone", via: "item", at: Math.max(now, (r.done_ms ?? 0) + 1), n: r.n };
      if (await this.cas(r, { answers: [...r.answers, answer].slice(-ANSWERS_KEPT) }, now)) return;
    }
  }

  /** A missed or dropped follow's item, still open? Only a to-do or an event's own row is read (a family ask is never re-targeted here). */
  private async closedButOpen(f: FollowRow, now: number): Promise<"live" | "done" | "gone"> {
    const it = parseItem(f.item);
    if (!it || (it.kind !== "pt" && it.kind !== "pe")) return "gone";
    const live = await this.itemLive(f, now).catch(() => "gone" as const);
    return live === "live" || live === "done" ? live : "gone";
  }

  // ------------------------------------------------------------------ a step's later news (a push opened, a call answered)

  async stepSeen(ext: string, state: Extract<StepState, "opened" | "answered" | "no_answer" | "failed">, at: number, person?: PersonKey): Promise<void> {
    if (!ext) return;
    const RANK: Record<StepState, number> = { skipped: -1, sent: 0, failed: 1, no_answer: 1, opened: 2, answered: 3 };
    for (const s of await this.stores.steps.byExt(ext)) {
      if (person && s.person !== person) continue;
      if (RANK[state] <= RANK[s.state]) continue;
      await this.stores.steps.update({ id: s.id, state: s.state }, { state, seen_ms: at }).catch(() => 0);
    }
  }

  /** The phone channel: the provider's call id replaces the request id kept as the step's ext. */
  async stepExt(oldExt: string, newExt: string): Promise<void> {
    if (!oldExt || !newExt || oldExt === newExt) return;
    await this.stores.steps.update({ ext: oldExt }, { ext: newExt }).catch(() => 0);
  }

  // ------------------------------------------------------------------ what people see

  private howOf(reachable: boolean): PersonHow { return reachable ? "app" : "gone"; }

  /** The follow page for one viewer: null for anyone not on it (or no longer in the asker's X0 people). */
  async view(viewer: string, id: string): Promise<FollowView | null> {
    const f = await this.read(id);
    if (!f) return null;
    const vKey = keyOf(ASKER(viewer));
    const role = this.roleOf(f, vKey);
    if (!role) return null;
    // The asker's X0 people, read once. A read that failed hides nothing from someone on the item and marks nobody as gone.
    let inPeople: Map<string, string> | null;
    try { inPeople = await this.peopleOf(f.user_id); } catch (err) { if (!(err instanceof PeopleUnread)) throw err; inPeople = null; }
    const reach = { has: async (id: string) => id === f.user_id || inPeople === null || inPeople.has(id) };
    if (role !== "asker" && !(await reach.has(viewer))) return null;
    const now = this.now();
    const t = await this.timings(now);
    const asker = role === "asker";
    const holder = holderOf(f);
    const nameFor = async (p: FollowPerson): Promise<string> => (p.id === viewer ? "You" : isAskerOf(f, p.id) ? (asker ? "You" : await this.nameIn(viewer, f.user_id)) : p.name || "Someone");
    const people = [];
    for (const p of f.people) people.push({ key: keyOf(p), name: await nameFor(p), me: p.id === viewer, how: this.howOf(await reach.has(p.id)), cant: f.cant.includes(keyOf(p)) });
    const askerName = asker ? "You" : await this.nameIn(viewer, f.user_id);
    const steps = asker ? (await this.stores.steps.select({ follow_id: f.id }, { order: "at_ms", limit: 100 })).sort((a, b) => a.at_ms - b.at_ms).map((s) => ({
      at: s.at_ms,
      line: stepLine({ at: s.at_ms, rung: s.rung, channel: s.channel, state: s.state, seen: s.seen_ms, who: s.person === vKey ? "You" : f.people.find((p) => keyOf(p) === s.person)?.name || "Someone", tz: f.tz_min, why: s.why }),
    })) : [];
    const answers = asker ? f.answers.map((a) => ({
      at: a.at,
      line: `${clockAt(a.at, f.tz_min)} · ${a.by === vKey ? "You" : f.people.find((p) => keyOf(p) === a.by)?.name || "Someone"} ${VERB_WORDS[a.verb]} (${VIA_WORDS[a.via]})`,
    })) : [];
    let next: FollowView["next"] = null;
    if (isOpenState(f.state) && f.next_ms !== null) {
      const ladder = ladderOf({ importance: f.importance, base: f.base_ms, climb: f.climb_ms, t });
      const tell = ladder.find((s) => s.rung === "tell");
      const holderName = await nameFor(holder);
      if (role === "holder" && !asker && tell && f.importance === "must") next = { at: tell.at, line: `If it isn't done by ${clockAt(tell.at, f.tz_min)}, X0 tells ${firstName(askerName)}.` };
      else if (f.state === "nobody") next = null;
      else if (holder.id === viewer && f.importance === "must") {
        const n = ladder.find((s) => RUNG_RANK[s.rung] > RUNG_RANK[f.state === "snoozed" ? "line" : f.rung]);
        if (n) next = { at: n.at, line: `Next: ${n.rung === "push" ? "a reminder" : n.rung === "loud" ? "a louder reminder" : n.rung === "call" ? "X0 calls" : n.rung === "phone" ? "a phone call, if you turned that on" : "X0 tells the family"} at ${clockAt(n.at, f.tz_min)}` };
      } else if (asker && holder.id !== viewer && f.importance === "must" && tell && RUNG_RANK[f.rung] < RUNG_RANK.tell) {
        next = { at: tell.at, line: `At ${clockAt(tell.at, f.tz_min)} X0 tells you if ${firstName(holderName)} hasn't said done.` };
      }
    }
    const done = f.state === "done" && f.done_by && f.done_via && f.done_ms !== null
      ? { by: await nameFor(f.done_by), via: f.done_via, at: f.done_ms, line: `${f.done_by.id === viewer ? "You" : firstName(await nameFor(f.done_by))} said done · ${clockAt(f.done_ms, f.tz_min)} · ${VIA_WORDS[f.done_via]}` }
      : null;
    const open = ["open", "snoozed", "told"].includes(f.state);
    const holds = holder.id === viewer;
    const number = asker && !holds ? await this.people.numberFor(viewer, holder.id).catch(() => null) : null;
    const s = !asker && f.importance === "must" ? await this.settingsOf(viewer) : null;
    return {
      id: f.id, item: f.item, kind: f.kind, title: f.title, when: this.when(f, now), must: f.importance === "must", why: f.why, state: f.state,
      you: role === "asker" ? "asker" : holds ? "holder" : "backup", n: f.n,
      asker: { name: askerName, me: asker },
      holder: { key: keyOf(holder), name: await nameFor(holder), me: holds, how: this.howOf(await reach.has(holder.id)) },
      people, steps, answers, next, done,
      buttons: {
        done: isOpenState(f.state),
        later: holds && open && f.laters < t.laterMax ? laterChoices(now, f.tz_min).map((c) => ({ action: `later_${c.choice}`, label: c.label })) : [],
        cant: holds && open,
        take: !holds && (f.state === "nobody" || f.state === "told"),
        undone: f.state === "done" && !!f.done_by && f.done_by.id === viewer && f.done_ms !== null && now - f.done_ms <= UNDONE_MS,
        call: number ? { number, name: firstName(holder.name) } : null,
        message: asker && !holds && spacesOn() && (await reach.has(holder.id)) ? { userId: holder.id, name: firstName(holder.name) } : null,
      },
      ask: s && !s.notify.followFrom.includes(f.user_id) ? { asker: firstName(askerName) } : null,
    };
  }

  /** The Plan's Needs-you cards (FOLLOW_NEEDS) and the asker's row lines for today. */
  async cardsFor(userId: string): Promise<FollowCards> {
    const out: FollowCards = { cards: [], lines: {} };
    if (!followOn()) return out;
    const now = this.now();
    const t = await this.timings(now);
    const inPeople = new Map<string, Promise<boolean | null>>();
    for (const f of await this.stores.follows.forHolder(`u:${userId}`, 20).catch(() => [] as FollowRow[])) {
      if (f.state !== "open" && f.state !== "told") continue;
      const mine = isAskerOf(f, userId);
      if (!mine) {
        // Someone else's item: only while they are in the asker's X0 people (a read that failed shows nothing until it can be read), and
        // never from an asker whose chat they muted (nothing from that asker's items reaches them, on the Plan or the widget either).
        if (!inPeople.has(f.user_id)) inPeople.set(f.user_id, this.stillIn(f.user_id, userId));
        if ((await inPeople.get(f.user_id)) !== true) continue;
        if (await this.isMuted(userId, f.user_id)) continue;
      }
      const askerName = mine ? "" : firstName(await this.nameIn(userId, f.user_id));
      out.cards.push({
        type: "follow", key: `follow:${f.id}:${f.n}`, until: missAt({ base: f.base_ms, climb: f.climb_ms, t }),
        question: f.title, reason: `${this.when(f, now)}${!mine ? ` · from ${askerName}` : f.importance === "must" ? " · Must not miss" : ""}`,
        // Outside the app (the widget, the Lock Screen, a Live Activity) only what the push to them says: never the asker's own words, a
        // health title or an amount (planEase.ts widgetCard uses it).
        outside: mine ? followTitle(f.title) : forOthers(f.title) || `A reminder from ${askerName}`,
        item: this.pfItem(f),
        buttons: [{ id: "done", label: "Done", primary: true, done: "Done.", undo: "undone" }, { id: "later", label: "Later", done: "I'll remind you later." }],
      });
    }
    const since = now - DAY;
    for (const f of await this.stores.follows.forAsker(userId, since, 50).catch(() => [] as FollowRow[])) {
      const holder = holderOf(f);
      if ((f.state === "told" || f.state === "nobody") && holder.id !== userId) {
        out.cards.push({
          type: "follow", key: `follow:${f.id}:${f.n}:asker`, until: missAt({ base: f.base_ms, climb: f.climb_ms, t }),
          question: f.state === "nobody" ? "Nobody can do it" : `${firstName(holder.name)} hasn't said done`, reason: `${f.title} · ${this.when(f, now)}`,
          item: this.pfItem(f),
          buttons: f.state === "nobody"
            ? [{ id: "take", label: "I'll do it", primary: true, done: "It's yours now." }]
            : [{ id: "done", label: "Done", primary: true, done: "Done." }, { id: "look", label: "Look", open: { screen: "bots.plan.follow", params: { follow: f.id } } }],
        });
      }
      if (dayOf(now, f.tz_min) !== f.day) continue;
      const it = parseItem(f.item);
      const rowId = it?.kind === "pt" ? `t:${it.taskId}` : it?.kind === "pe" ? `e:${eventIdOf(it.eventRef)}` : null;
      if (!rowId || out.lines[rowId]) continue;
      out.lines[rowId] = followLine({ state: f.state, holder: holder.name, holderIsAsker: holder.id === userId, must: f.importance === "must", doneBy: f.done_by && f.done_by.id !== userId ? f.done_by.name : null });
    }
    return out;
  }

  /** The item page's part: allowed, how important, why, who, and the open follow's line. */
  async itemFollow(userId: string, kind: "event" | "task", id: string): Promise<ItemFollow | null> {
    if (!followOn()) return null;
    const now = this.now();
    let stored: "normal" | "must" | null = null, refs: Array<{ k: "u"; id: string; name?: string }> = [], why: MustWhy | null = null, item: string;
    if (kind === "task") {
      const t: CalTask | null = await this.calendar.task(userId, id).catch(() => null);
      if (!t) return null;
      if (t.fixed || t.kind === "wait") return { allowed: false, importance: null, must: false, why: null, people: [], open: null };
      stored = t.importance ?? null; refs = t.people ?? [];
      why = autoMust({ kind: t.kind === "due" ? "due" : "todo", title: t.title, timed: t.at !== null, dueDay: t.due, today: dayOf(now, await this.calendar.tzOf(userId)) });
      item = `pt:${t.id}`;
    } else {
      const e = await this.calendar.event(userId, id).catch(() => null);
      if (!e) return null;
      if (e.fixed) return { allowed: false, importance: null, must: false, why: null, people: [], open: null };
      stored = e.importance ?? null; refs = e.people ?? [];
      why = autoMust({ kind: "event", title: e.title, timed: !e.allDay, dueDay: null, today: e.day });
      item = itemId({ kind: "pe", eventRef: eventRefOf(e.id), day: e.day });
    }
    const names = await this.contactsOf(userId);
    const people = refs.map((r) => ({ key: keyOf(r), name: r.id === userId ? "You" : names.get(r.id) ?? r.name ?? "Someone", me: r.id === userId, how: this.howOf(r.id === userId || names.has(r.id)) }));
    const f = await this.current(userId, item);
    const open = f && (isOpenState(f.state) || (f.state === "done" && f.day === dayOf(now, f.tz_min)))
      ? { id: f.id, line: followLine({ state: f.state, holder: holderOf(f).name, holderIsAsker: holderOf(f).id === userId, must: f.importance === "must", doneBy: f.done_by && f.done_by.id !== userId ? f.done_by.name : null }) }
      : null;
    return { allowed: true, importance: stored, must: effectiveMust(stored, why), why: stored === null ? why : null, people, open };
  }

  /**
   * Their account is going (routes/account/account.ts eraseAccount): numbers other people keep for them go, and their name leaves other
   * people's follows ("Someone"). Their own follows, steps and phone go with the account (on delete cascade).
   */
  async forget(userId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.stores.numbers.remove({ member_id: userId });
    for (const f of await this.stores.follows.withPerson(userId, 500)) {
      for (let i = 0; i < TRIES; i += 1) {
        const r = i === 0 ? f : await this.read(f.id);
        if (!r) break;
        const people = r.people.map((p) => (p.id === userId ? { ...p, name: "" } : p));
        const done_by = r.done_by && r.done_by.id === userId ? { ...r.done_by, name: "" } : r.done_by;
        // updated_ms + 1, not now: an old follow stays old (Activity, the 90 days it is kept).
        if (await this.stores.follows.update({ id: r.id, updated_ms: r.updated_ms }, { people, done_by, updated_ms: r.updated_ms + 1 }).catch(() => 0)) break;
      }
    }
  }

  /** Activity: someone else said done, someone couldn't do it, a must-not-miss item nobody did. */
  async activitySince(userId: string, since: number): Promise<FeedFollowRow[]> {
    if (!followOn()) return [];
    const out: FeedFollowRow[] = [];
    for (const f of await this.stores.follows.forAsker(userId, since, 50).catch(() => [] as FollowRow[])) {
      if (f.state === "done" && f.done_by && f.done_by.id !== userId && f.done_ms !== null && f.done_ms >= since) {
        out.push({ id: `follow:${f.id}:done_by`, follow: f.id, what: "done_by", who: f.done_by.name || "Someone", title: f.title, at: f.done_ms, via: f.done_via });
      }
      const cant = [...f.answers].reverse().find((a) => a.verb === "cant" && a.by !== `u:${userId}` && a.at >= since);
      if (cant) out.push({ id: `follow:${f.id}:passed`, follow: f.id, what: "passed", who: f.people.find((p) => keyOf(p) === cant.by)?.name || "Someone", title: f.title, at: cant.at, via: cant.via });
      if (f.state === "missed" && f.importance === "must" && f.updated_ms >= since) {
        out.push({ id: `follow:${f.id}:missed`, follow: f.id, what: "missed", who: "", title: f.title, at: f.updated_ms, via: null });
      }
    }
    return out;
  }

  /**
   * The item's own switch and people changed (planFollowPeople.ts setItem): its open follow hears it now. Back to normal: no louder step
   * after this; to must: the climb from now; a holder taken off: passed on as if they said can't (no "passed" push: the asker did it).
   */
  async itemChanged(userId: string, item: string, o: { importance?: "normal" | "must" | null; must: boolean; people?: string[] }): Promise<void> {
    const now = this.now();
    for (let i = 0; i < TRIES; i += 1) {
      const f = await this.current(userId, item);
      if (!f || !["open", "snoozed", "told", "nobody"].includes(f.state)) return;
      const t = await this.timings(now);
      const patch: Partial<FollowRow> = {};
      if (o.importance !== undefined) {
        if (!o.must && f.importance === "must") { patch.importance = "normal"; patch.why = null; patch.next_ms = f.state === "snoozed" ? f.next_ms : missAt({ base: f.base_ms, climb: f.climb_ms, t }); }
        if (o.must && f.importance === "normal") {
          patch.importance = "must"; patch.why = "set"; patch.climb_ms = now;
          const ladder = ladderOf({ importance: "must", base: f.base_ms, climb: now, t });
          const next = ladder.find((s) => RUNG_RANK[s.rung] > RUNG_RANK[f.state === "snoozed" ? "line" : f.rung]);
          if (f.state !== "snoozed") patch.next_ms = next ? next.at : missAt({ base: f.base_ms, climb: now, t });
        }
      }
      const holder = holderOf(f);
      if (o.people !== undefined) {
        // The order as now set ("just me" is the asker). Who was taken off is gone from it: never the next holder, never told.
        const ids = o.people.length ? [...new Set(o.people)] : [userId];
        const names = await this.contactsOf(userId);
        const people: FollowPerson[] = ids.map((id) => f.people.find((p) => p.id === id) ?? (id === userId ? ASKER(userId) : { k: "u" as const, id, name: names.get(id) ?? "Someone" }));
        const cant = f.cant.filter((k) => people.some((p) => keyOf(p) === k));
        const at = people.findIndex((p) => p.id === holder.id);
        const free = people.findIndex((p) => !cant.includes(keyOf(p)));
        if (at < 0 || (f.state === "nobody" && free >= 0)) {
          // The holder was taken off (or nobody could do it and someone new is on it): the first who can has it now; with nobody left,
          // the asker (who always counts).
          if (free < 0 && !people.some((p) => p.id === userId)) people.push(ASKER(userId));
          const next = free >= 0 ? free : people.findIndex((p) => p.id === userId);
          Object.assign(patch, {
            people, holder: next, holder_key: keyOf(people[next]!), cant: cant.filter((k) => k !== keyOf(people[next]!)), n: f.n + 1, base_ms: now, climb_ms: now,
            rung: "line", state: "open", next_ms: now, told: [],
          });
        } else if (JSON.stringify(people) !== JSON.stringify(f.people) || at !== f.holder) {
          Object.assign(patch, { people, holder: at, holder_key: keyOf(people[at]!), cant });
        }
      }
      if (!Object.keys(patch).length) return;
      const won = await this.cas(f, patch, now);
      if (!won) continue;
      if (won.n !== f.n) {
        await this.endRing(f, holder.id, now);
        for (let n = 1; n <= f.n; n += 1) noticeGone(holder.id, itemId({ kind: "pf", followId: f.id, n }));
      }
      this.publishAll(won);
      if (won.n !== f.n && won.state === "open") await this.advance(f.id, now).catch(() => undefined);
      return;
    }
  }
}

// ------------------------------------------------------------------ the shared one

let shared: PlanFollows | null = null;
/** The server's (made on first use; wired at boot by routes/bots/planFollows.ts). */
export function planFollows(): PlanFollows { return (shared ??= new PlanFollows()); }
export function setPlanFollows(p: PlanFollows | null): void { shared = p; }

/** The follow source beside the person's days (planSources.ts): the cards and the row lines. */
export function plugFollows(): void {
  addPlanSource({ name: "follow", more: async (userId) => (followOn() ? planFollows().cardsFor(userId) : null) });
}

/** The Needs-you cards: the holder's open ones, and the asker's when someone hasn't said done or nobody can. Never in a day note. */
export const FOLLOW_NEEDS: NeedsType = {
  type: "follow", step: 6, tie: 0,
  find(ctx) {
    if (!followOn()) return [];
    return ((ctx.more?.follow as FollowCards | null | undefined)?.cards ?? []).filter((c) => c.until > ctx.now);
  },
};

const viaApp = (fn: (u: string, i: Extract<QuickItem, { kind: "pf" }>) => Promise<ActResult>): PlanAct["run"] =>
  async (_p, userId, item) => (item.kind === "pf" ? fn(userId, item) : no(400, "bad_request", "That can only be opened."));
const answer = (verb: FollowVerb, later?: LaterChoice): PlanAct["run"] =>
  viaApp((u, i) => planFollows().reply({ followId: i.followId, n: i.n, by: `u:${u}`, answer: verb, ...(later ? { later } : {}), via: "app" }));

/** The buttons on pf:<followId>:<n> (planEase.ts PLAN_ACTS.pf): from a push, the Plan, the follow page, the call screen alike. */
export const FOLLOW_ACTS: Record<string, PlanAct> = {
  done: { scope: "task.done", run: answer("done") },
  later: { scope: "task.done", run: answer("later", "default") },
  later_15m: { scope: "task.done", run: answer("later", "15m") },
  later_1h: { scope: "task.done", run: answer("later", "1h") },
  later_eve: { scope: "task.done", run: answer("later", "eve") },
  later_tmrw: { scope: "task.done", run: answer("later", "tmrw") },
  cant: { scope: "task.done", run: answer("cant") },
  take: { scope: "needs.answer", run: answer("take") },
  undone: { scope: "session", run: answer("undone") },
  allow: { scope: "session", run: viaApp((u, i) => planFollows().allow(u, i.followId, true)) },
  deny: { scope: "session", run: viaApp((u, i) => planFollows().allow(u, i.followId, false)) },
};

export { looksMed };
