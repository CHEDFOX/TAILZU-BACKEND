/**
 * "PLAN SOMETHING": THE SERVICE (PLAN_V2_MAKE, PLAN_V2_MAKE_AI; routes/bots/planMake.ts; docs/plan-ease.md "Plan something").
 *
 *   setup(user, tz)      GET .../plan/make: today, the people to pick (You first, as their tiny bots), follow-through on, the AI's state
 *   draft(user, body)    POST .../plan/make/draft: the box's words as drafts (rules, then one small AI read only when the rules are
 *                        unsure, with the person's yes, inside Plan Ease's budget), a bill's or a wait's preview, or the box's own answer
 *   check(user, body)    POST .../plan/make/check: the card (and every draft) checked by rules, a fix or Take out applied
 *   done(user, body)     POST .../plan/make: everything checked again, then made through the calendar and follow-through's setItem
 *   undo(user, body)     POST .../plan/make/undo: exactly the rows that Done made
 *
 * The server keeps no draft: the screen's state does (planMake.ts types). Every draft and check answer carries a fresh key, which only
 * names the rows Done makes (`make:<key>:<n>`, unique per person: a retry answers the same rows). Nothing goes on the Plan and nobody
 * is told until Done; nothing is pushed at Done either (a follow starts by itself when the item's reminder comes due). No money moves.
 *
 * Logs carry counts and outcomes only: never words, titles, names, ids of others or places.
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/types.js";
import type { Calendar } from "../calendar/index.js";
import { dayOf, isDayKey, shiftDay, startOfDay, weekdayOf } from "../calendar/words.js";
import type { YouSettings } from "../you/settings.js";
import { youStore } from "../you/store.js";
import { lookOf, looksIn, selfLook, type PersonLook } from "./personLook.js";
import type { PlanCapture } from "./planCapture.js";
import { planCapture } from "./planCapture.js";
import type { PlanEase } from "./planEase.js";
import { planEase } from "./planEase.js";
import type { FollowPeople } from "./planFollowPeople.js";
import { planFollows } from "./planFollow.js";
import { firstName, idOfKey, isUuid } from "./planFollowWords.js";
import {
  AI_WORDS_MAX, DRAFTS_MAX, PICK_MAX, ROWS_MAX, WORDS_MAX, addedWhen, aiPromptNow, aiUser, applyFix, cardOf, changeOf, checkAi, checksOf,
  draftOf, emptyCard, keepClock, keepPicks, looksChange, messyOf, politeItem, remindOf, remindWords, rulesDraft, startsOf, titleOf, unsure, viewOf,
  type CardDraft, type Draft, type MadeView, type MakeCheckReply, type MakeCtx, type MakeDraftReply, type MakeSetup, type MakeUndoReply,
} from "./planMake.js";
import { dueWords, readDue, rupees } from "./planDue.js";
import { dayItems, type DayItem } from "./planRows.js";
import { sourceItems } from "./planSources.js";
import { followOn, makeAiOn } from "./planSwitch.js";

type Log = { info(o: object, m: string): void };
type Body = Record<string, unknown>;

const BAD = "That doesn't look right. Try again.";
const bad = (message = BAD) => new BotError("bad_request", message);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const objOf = (b: unknown): Body => (b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : {});

/** An offset that can be true: −720 to 840, else India's. */
export function tzIn(v: unknown): number {
  const n = typeof v === "string" && v.trim() ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= -720 && n <= 840 ? Math.round(n) : 330;
}

/** "0".."2" (or 0..2), within `len` (+1 when it may append). */
function slotOf(v: unknown, len: number, o: { append?: boolean } = {}): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[0-2]$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > DRAFTS_MAX - 1 || n > (o.append ? len : len - 1)) throw bad();
  return n;
}

/** A card as the screen sent it, cleaned field by field (unknown fields dropped; a structural field that is not one of its values: 400). */
export function cleanCard(raw: unknown): CardDraft {
  const c = objOf(raw);
  const str = (k: string, max: number): string => (typeof c[k] === "string" ? (c[k] as string).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, max) : "");
  const title = typeof c.title === "string" ? c.title : "";
  if (title.length > 200) throw bad();
  const day = typeof c.day === "string" ? c.day : "";
  if (day !== "" && day !== "other" && !isDayKey(day)) throw bad();
  const time = typeof c.time === "string" ? c.time : "";
  if (time !== "" && time !== "other" && !HHMM.test(time)) throw bad();
  const repeat = typeof c.repeat === "string" ? c.repeat : "";
  if (!["", "daily", "weekly", "monthly"].includes(repeat)) throw bad();
  const imp = typeof c.imp === "string" ? c.imp : "";
  if (!["", "normal", "must"].includes(imp)) throw bad();
  const daysIn = c.days === undefined ? [] : c.days;
  if (!Array.isArray(daysIn) || daysIn.length > 7 || !daysIn.every((d) => typeof d === "string" && /^[0-6]$/.test(d))) throw bad();
  const who = typeof c.who === "string" ? c.who : "";
  if (who !== "" && who !== "me" && !isUuid(who)) throw bad();
  const guessed = c.guessed === "1" ? "1" : "";
  return {
    title: title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120), day, dayWords: str("dayWords", 40), time,
    timeWords: str("timeWords", 20), repeat: repeat as CardDraft["repeat"], days: [...new Set(daysIn as string[])], who, whoName: str("whoName", 40).trim(),
    imp: imp as CardDraft["imp"], place: str("place", 160).trim(), guessed,
  };
}

function cleanList(raw: unknown): CardDraft[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > DRAFTS_MAX) throw bad();
  return raw.map(cleanCard);
}

const dayOrEmpty = (v: unknown): string => {
  if (v === undefined || v === null || v === "") return "";
  if (!isDayKey(v)) throw bad();
  return v;
};

/**
 * A bill's preview, what Done would add: "Electricity ₹2,140 · due Sat 14 Nov" ("· due the 14th each month"), read by the box's own
 * due reader (planDue.ts readDue), nothing added. "" when it can't say (the preview then shows the words).
 */
export function dueSum(words: string, ctx: Pick<MakeCtx, "now" | "tz" | "today">): string {
  const r = readDue(words, ctx.now, ctx.tz);
  if (!r) return "";
  const n = Number(r.day.slice(8, 10));
  const nth = `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  const when = r.repeat === "monthly" ? `due the ${nth} each month` : dueWords(r.day, ctx.today).replace(/^Due/, "due").replace(/^Was due/, "was due");
  return `${r.title}${r.amountPaise ? ` ${rupees(r.amountPaise)}` : ""} · ${when}`;
}

export interface PlanMakeDeps {
  ease: () => PlanEase;
  calendar: () => Calendar;
  people: () => FollowPeople | null;
  capture: () => PlanCapture | null;
  /** How the person's X0 people look to them (follow-through's looksOf: their space's looks), for For who; none: their own looks. */
  looks?: (userId: string) => Promise<ReadonlyMap<string, PersonLook>>;
  settingsOf?: (userId: string) => Promise<YouSettings>;
  now?: () => number;
  log?: Log;
}

type AiOutcome = "used" | "consent" | "spent" | "busy" | "failed" | "off" | "not_needed";

export class PlanMake {
  private readonly now: () => number;
  /** One Done per person and key at a time on this server: a second one waits for the first and answers its result. */
  private readonly doing = new Map<string, Promise<MadeView>>();

  constructor(private readonly d: PlanMakeDeps) {
    this.now = d.now ?? Date.now;
  }

  // ------------------------------------------------------------------ what the rules read beyond the words

  /** The person's X0 people (id → name), by the rules messaging uses (follow-through's picker); none with follow-through off. */
  private async contacts(userId: string): Promise<Map<string, string>> {
    const people = followOn() ? this.d.people() : null;
    if (!people) return new Map();
    const p = await people.picker(userId, null).catch(() => null);
    return new Map((p?.people ?? []).filter((x) => !x.me).map((x) => [idOfKey(x.key), x.name] as [string, string]).filter(([id]) => isUuid(id) && id !== userId));
  }

  private async ctxFor(userId: string, tz: number): Promise<MakeCtx> {
    const now = this.now();
    const follow = followOn();
    const [contacts, settings] = await Promise.all([
      this.contacts(userId),
      (this.d.settingsOf ?? ((u: string) => youStore().getSettings(u)))(userId).catch(() => null),
    ]);
    return {
      now, tz, today: dayOf(now, tz), me: userId, contacts, items: [], follow,
      notify: settings?.notify ?? ({ follow: true } as MakeCtx["notify"]),
    };
  }

  /** The person's items on the days the drafts start on (3 at most, each read alone), with what lives outside the own calendar. */
  private async withItems(ctx: MakeCtx, userId: string, drafts: readonly Draft[]): Promise<MakeCtx> {
    const days = [...new Set(drafts.flatMap((d) => startsOf(d, ctx).days.slice(0, 1)))].slice(0, DRAFTS_MAX);
    const lists = await Promise.all(days.map(async (day) => {
      const w = { from: day, to: day, fromMs: startOfDay(day, ctx.tz), toMs: startOfDay(shiftDay(day, 1), ctx.tz), tz: ctx.tz, now: ctx.now };
      const [listed, extra] = await Promise.all([
        this.d.calendar().list(userId, { from: day, to: day, tz: ctx.tz }).catch(() => null),
        sourceItems(userId, w).catch(() => [] as DayItem[]),
      ]);
      return [...(listed ? dayItems(listed) : []), ...extra].filter((it) => it.day === day);
    }));
    return { ...ctx, items: lists.flat() };
  }

  private aiOff(): boolean { return !makeAiOn() || !this.d.capture(); }

  // ------------------------------------------------------------------ setup

  async setup(userId: string, tzRaw: unknown): Promise<MakeSetup> {
    const tz = tzIn(tzRaw);
    const today = dayOf(this.now(), tz);
    const follow = followOn();
    let people: MakeSetup["people"] = [];
    let invite: MakeSetup["invite"] = null;
    const fp = follow ? this.d.people() : null;
    if (fp) {
      const [p, known] = await Promise.all([fp.picker(userId, null).catch(() => null), (this.d.looks?.(userId) ?? Promise.resolve(new Map())).catch(() => new Map())]);
      if (p) {
        // The picker gives keys ("u:<id>"), not ids; its number flag is dropped (the screen never learns who has a kept number). Each
        // person is the tiny bot their space shows (known); anyone without one gets a look no one else in the list has (looksIn).
        const ids = p.people.filter((x) => !x.me).map((x) => idOfKey(x.key));
        const spare = looksIn(ids.filter((id) => !known.has(id)));
        people = p.people.map((x) => {
          const id = x.me ? userId : idOfKey(x.key);
          return { id: x.me ? "" : id, name: x.me ? "You" : x.name, me: x.me, look: x.me ? selfLook(userId) : known.get(id) ?? spare.get(id) ?? lookOf(id) };
        }).filter((x) => x.me || isUuid(x.id)).slice(0, PICK_MAX);
        invite = p.invite ?? null;
      }
    }
    const cap = this.d.capture();
    const ai: MakeSetup["ai"] = this.aiOff() || !cap ? "off" : (await cap.aiOk(userId)) ? "on" : "ask";
    return { today, tomorrow: shiftDay(today, 1), people, follow, ai, invite };
  }

  // ------------------------------------------------------------------ draft

  /**
   * One AI read, when it may be asked (4.5): makeAiOn() and a reader; 300 characters at most; the rules gave a reason; the person's yes;
   * no other read of theirs running; ₹1 of today's reading left. Any failure is the rules' drafts, said nowhere but `view.unsure`.
   */
  private async readAi(userId: string, ctx: MakeCtx, words: string, reasons: string[], card: Draft | null): Promise<{ text: string } | AiOutcome> {
    if (this.aiOff()) return "off";
    if (!reasons.length || words.length > AI_WORDS_MAX) return "not_needed";
    const got = await this.d.capture()!.readWords(userId, ctx.tz, aiPromptNow(ctx), aiUser(words, card ? { draft: card } : null)).catch(() => null);
    if (got === null) return "failed";
    if (typeof got === "string") return got;
    return { text: got.text };
  }

  async draft(userId: string, raw: unknown, o: { log?: Log } = {}): Promise<MakeDraftReply> {
    const t0 = Date.now();
    const b = objOf(raw);
    const said = typeof b.words === "string" ? b.words.replace(/\r/g, "").trim() : "";
    if (!said) throw bad("Say what to plan, like Dentist Fri 5 pm.");
    if (said.length > WORDS_MAX) throw new BotError("too_large", "That's a lot of words. Try a shorter one.", 413);
    const tz = tzIn(b.tz);
    const list = cleanList(b.list);
    const d = b.d === undefined ? null : cleanCard(b.d);
    const at = b.at === undefined ? 0 : slotOf(b.at, list.length, { append: true });
    const day = dayOrEmpty(b.day);
    if (b.keep !== undefined && b.keep !== "1") throw bad();
    const keep = b.keep === "1";
    const log = (how: "rules" | "ai", items: number, ai: AiOutcome) => (o.log ?? this.d.log)?.info({ how, items, ai, ms: Date.now() - t0 }, "plan make: draft");

    const base = await this.ctxFor(userId, tz);
    const day0 = day || base.today;
    // The list with the card on screen at `at` (appended when it is new).
    const cards = [...list];
    if (d) { if (at === cards.length) cards.push(d); else cards[at] = d; }

    let next: Draft[];
    let atOut = 0;
    let how: "rules" | "ai" = "rules";
    let ai: AiOutcome = "not_needed";
    let unsureWhy: string[] = [];
    let extra = false;

    if (keep) {
      // "Read it with AI": the card's own What words, always an item; only the draft at `at` is replaced, the person's picks stay.
      const card = cards[at];
      if (!card) throw bad();
      const rules = rulesDraft(said, base, { day });
      const reasons = unsure(said, rules.drafts, rules.parts);
      const got = await this.readAi(userId, base, said, reasons, null);
      const checked = typeof got === "object" ? checkAi(got.text, rules.drafts, base, { words: said, card, keep: true, day0 }) : null;
      ai = typeof got === "object" ? (checked && checked.drafts.length ? "used" : "failed") : got;
      const fresh = checked && checked.drafts.length ? checked.drafts : rules.drafts.map((x) => keepPicks(x, card, base, day0));
      if (checked && checked.drafts.length) how = "ai";
      unsureWhy = how === "rules" ? reasons : [];
      const others = cards.map((c) => draftOf(c, base));
      next = [...others.slice(0, at), ...fresh, ...others.slice(at + 1)];
      extra = next.length > DRAFTS_MAX || rules.extra;
      atOut = at;
    } else {
      const changed = d && d.title ? changeOf(said, d, base) : null;
      if (changed) {
        // Only what was said changes; everything else, and every other draft, stays.
        cards[at] = changed;
        next = cards.map((c) => draftOf(c, base));
        atOut = at;
      } else {
        // The box's own slots first: an item is always a draft here, a bill or a wait a preview, the rest the box's answer.
        let words = said;
        const slot = this.d.ease().slotOf(userId, said, tz);
        if (slot === "due" || slot === "wait") {
          log("rules", 0, "not_needed");
          const sum = slot === "due" ? dueSum(said, base) : "";
          return { kind: "preview", preview: { slot, words: said, line: slot === "due" ? "Looks like a bill. Add it?" : "Looks like you're waiting on someone. Add it?", ...(sum ? { sum } : {}) } };
        }
        if (slot === "chat") {
          const item = politeItem(said);
          // A question is the chat's: its own AI call with its own gate and budget, so it never pays twice.
          if (!item) { log("rules", 0, "not_needed"); return { kind: "box", box: { slot: "chat", kind: "chat", line: "" } }; }
          words = item;
        } else if (slot !== "item") {
          const box = await this.d.ease().box(userId, said, tz);
          log("rules", 0, "not_needed");
          return { kind: "box", box };
        }
        const rules = rulesDraft(words, base, { day });
        // A polite ask with nothing to plan in it ("Can you remind me tomorrow at 5?"): the chat's, as the box always answered it.
        if (slot === "chat" && !rules.drafts.some((x) => x.title)) { log("rules", 0, "not_needed"); return { kind: "box", box: { slot: "chat", kind: "chat", line: "" } }; }
        const reasons = unsure(words, rules.drafts, rules.parts);
        const onScreen = d && d.title && looksChange(words) ? draftOf(d, base) : null;
        const got = await this.readAi(userId, base, words, reasons, onScreen);
        const checked = typeof got === "object" ? checkAi(got.text, rules.drafts, base, { words, card: onScreen ? d : null, day0 }) : null;
        ai = typeof got === "object" ? (checked && checked.drafts.length ? "used" : "failed") : got;
        extra = rules.extra;
        if (checked && checked.drafts.length && checked.change) {
          how = "ai";
          cards[at] = cardOf(checked.drafts[0]!, base.today, [day0]);
          next = cards.map((c) => draftOf(c, base));
          atOut = at;
        } else {
          if (checked && checked.drafts.length) how = "ai";
          next = how === "ai" ? checked!.drafts : rules.drafts;
          unsureWhy = how === "rules" ? reasons : [];
          atOut = 0;
        }
      }
    }
    next = next.slice(0, DRAFTS_MAX);
    atOut = Math.min(atOut, Math.max(0, next.length - 1));
    const ctx = await this.withItems(base, userId, next);
    const drafts = next.map((x) => cardOf(x, ctx.today, [day0]));
    const view = viewOf(next, ctx, { unsure: unsureWhy, extra });
    log(how, next.length, ai);
    return { kind: "draft", drafts, d: drafts[atOut] ?? emptyCard(day0), at: String(atOut), view, how, key: randomUUID() };
  }

  // ------------------------------------------------------------------ check

  async check(userId: string, raw: unknown): Promise<MakeCheckReply> {
    const b = objOf(raw);
    const tz = tzIn(b.tz);
    const list = cleanList(b.list);
    const d = b.d === undefined ? null : cleanCard(b.d);
    const at = b.at === undefined ? 0 : slotOf(b.at, list.length, { append: !!d });
    const day0 = b.day0 === undefined ? undefined : dayOrEmpty(b.day0);
    if (b.fix !== undefined && b.drop !== undefined) throw bad();
    const base = await this.ctxFor(userId, tz);
    const cards = [...list];
    if (d) { if (at === cards.length) cards.push(d); else cards[at] = d; }
    let atOut = at;
    if (b.fix !== undefined) {
      const f = objOf(b.fix);
      const item = slotOf(f.item, cards.length);
      cards[item] = applyFix(cards[item]!, f.id, base);
      atOut = item;
    } else if (b.drop !== undefined) {
      cards.splice(slotOf(b.drop, cards.length), 1);
      atOut = 0;
    }
    const next = cards.map((c) => draftOf(c, base, day0 !== undefined ? { day0 } : {}));
    const ctx = await this.withItems(base, userId, next);
    const chips = day0 ? [day0] : [];
    const drafts = next.map((x) => cardOf(x, ctx.today, chips));
    const key = randomUUID();
    if (!next.length) return { drafts: [], d: emptyCard(day0 ?? ctx.today), at: "0", view: viewOf([], ctx), key };
    atOut = Math.min(atOut, next.length - 1);
    const messy = !!d && messyOf(next[at] ?? next[atOut]!, { fromCard: true, aiOn: !this.aiOff() });
    return { drafts, d: drafts[atOut]!, at: String(atOut), view: viewOf(next, ctx, { messy }), key };
  }

  // ------------------------------------------------------------------ done

  async done(userId: string, raw: unknown, o: { log?: Log } = {}): Promise<MadeView> {
    const b = objOf(raw);
    if (typeof b.key !== "string" || !UUID_V4.test(b.key)) throw bad();
    const list = cleanList(b.list);
    if (!list.length) throw bad();
    const tz = tzIn(b.tz);
    const key = b.key.toLowerCase();
    const k = `${userId}:${key}`;
    const running = this.doing.get(k);
    if (running) return running;
    const p = this.make(userId, key, list, tz, o.log ?? this.d.log);
    this.doing.set(k, p);
    try { return await p; } finally { if (this.doing.get(k) === p) this.doing.delete(k); }
  }

  private async make(userId: string, key: string, list: CardDraft[], tz: number, log?: Log): Promise<MadeView> {
    const t0 = Date.now();
    const cal = this.d.calendar();
    const base = await this.ctxFor(userId, tz);
    const plain = list.map((c) => draftOf(c, base));
    const ctx = await this.withItems(base, userId, plain);
    // Weekly on several days (not Monday to Friday): one weekly event per weekday, each on its first date still ahead.
    const plan = plain.map((dr) => {
      const starts = startsOf(dr, ctx).days;
      return { dr, each: dr.kind === "event" && dr.repeat === "weekly" && dr.days.length > 1 ? starts : [starts[0] ?? null] };
    });
    const total = plan.reduce((t, x) => t + x.each.length, 0);
    if (total < 1 || total > ROWS_MAX) throw bad();
    // A retry (a lost answer, a second tap) finds the rows this key already made and makes nothing new. Read before the checks: a
    // Done that worked was checked then, and checked again now ("That time has passed" a few minutes on) it would be refused although
    // its rows are there, and the person would add it a second time.
    const had = new Map((await cal.keyed(userId, key, total)).map((r) => [r.sourceKey, r]));
    // Everything else is checked again: the day may have moved on since the check face (a time passed, midnight).
    if (!had.size) {
      for (const dr of plain) {
        const stop = checksOf(dr, ctx).find((n) => n.stop);
        if (stop) throw new BotError("fix_first", stop.text, 400);
      }
    }
    const made: Array<{ kind: "event" | "task"; id: string }> = [];
    const rows: Array<{ kind: "event" | "task"; id: string; day: string }> = [];
    // Who could not be put on it ("Mom" who is not one of their people; someone who left since the card was made): saved for them, said.
    const missing: string[] = ctx.follow ? plain.flatMap((dr) => (dr.notContact ? ["Someone"] : dr.whoName && !dr.who ? [dr.whoName] : [])) : [];
    let n = 0;
    try {
      for (const { dr, each } of plan) {
        const title = titleOf(dr);
        for (const start of each) {
          const sourceKey = `make:${key}:${n}`;
          n += 1;
          const one: Draft = { ...dr, day: start ?? dr.day, ...(dr.repeat === "weekly" && start ? { days: [weekdayOf(start)] } : {}) };
          const found = had.get(sourceKey);
          let ref: { kind: "event" | "task"; id: string; day: string };
          if (found) ref = { kind: found.kind, id: found.id, day: found.day };
          else {
            const got = await this.create(userId, cal, one, title, sourceKey, ctx).then((x) => ({ ...x, mine: true }), async (err) => {
              // A second server made it first (the unique (user_id, source_key)): read it and use it. It is that request's row, never
              // this one's: a failure later here must not take it out from under the other, which may already have answered "Added".
              const again = (await cal.keyed(userId, key, total).catch(() => [])).find((r) => r.sourceKey === sourceKey);
              if (again) return { kind: again.kind, id: again.id, day: again.day, mine: false };
              throw err;
            });
            ref = { kind: got.kind, id: got.id, day: got.day };
            if (got.mine) made.push({ kind: ref.kind, id: ref.id });
          }
          rows.push(ref);
          // Who and how important: follow-through's own setItem (the item page's path), only when picked. Safe to run twice.
          const people = this.d.people();
          if (ctx.follow && people && (dr.imp !== null || dr.who)) {
            const out = await people.setItem(userId, { kind: ref.kind, id: ref.id }, { ...(dr.imp ? { importance: dr.imp } : {}), ...(dr.who ? { people: [{ id: dr.who }] } : {}) });
            missing.push(...out.missing);
          }
        }
      }
    } catch (err) {
      // Half way: take out what this call made (never a row an earlier Done made), then say why.
      for (const r of made.reverse()) {
        await (r.kind === "event" ? cal.removeEvent(userId, r.id) : cal.removeTask(userId, r.id)).catch(() => undefined);
      }
      throw err;
    }
    const days = rows.map((r) => r.day).filter(Boolean).sort();
    const view: MadeView = { ok: true, key, n, day: days[0] ?? "", line: this.lineOf(plain, ctx) };
    const people = this.d.people();
    if (missing.length && people) view.missing = people.missingLine([...new Set(missing)]);
    log?.info({ n, ms: Date.now() - t0 }, "plan make: added");
    return view;
  }

  /** One row through the calendar, checked title as it is (parsed: true): never read again for a day, a time or a place. */
  private async create(userId: string, cal: Calendar, d: Draft, title: string, key: string, ctx: MakeCtx): Promise<{ kind: "event" | "task"; id: string; day: string }> {
    if (d.kind === "event") {
      const r = remindOf(d, ctx);
      const e = await cal.addEvent(userId, {
        title, day: d.day, time: d.time === null ? "" : hhmm(d.time), repeat: d.repeat, place: d.place, tz: ctx.tz,
        ...(r.remind !== undefined ? { remind: r.remind } : {}),
      }, { kind: "me" }, { key, parsed: true });
      return { kind: "event", id: e.id.split("@")[0]!, day: e.day };
    }
    const t = await cal.addTask(userId, { title, ...(d.day ? { day: d.day } : {}), time: "", tz: ctx.tz }, { kind: "me" }, key, {}, { parsed: true });
    return { kind: "task", id: t.id, day: t.due ?? "" };
  }

  /** "Added: Dentist, Fri 13 Nov, 5 pm · X0 reminds Dad at 8:45 pm", or "Added 2 things to your Plan". In the app only. */
  private lineOf(drafts: readonly Draft[], ctx: MakeCtx): string {
    if (drafts.length > 1) return `Added ${drafts.length} things to your Plan`;
    const d = drafts[0]!;
    const starts = startsOf(d, ctx).days;
    const when = addedWhen({ day: starts[0] ?? d.day, minute: d.time, repeat: d.repeat, ...(d.repeat === "weekly" ? { weekdays: d.days } : {}) }, ctx.today);
    let line = `Added: ${titleOf(d)}${when ? `, ${when}` : ""}`;
    if (ctx.follow && d.who) {
      const at = remindWords(d, ctx);
      if (at) line += ` · X0 reminds ${firstName(ctx.contacts.get(d.who) ?? "Someone")} ${at}`;
    }
    return keepClock(line);
  }

  // ------------------------------------------------------------------ undo

  async undo(userId: string, raw: unknown, o: { log?: Log } = {}): Promise<MakeUndoReply> {
    const b = objOf(raw);
    if (typeof b.key !== "string" || !UUID_V4.test(b.key)) throw bad();
    const n = typeof b.n === "number" ? b.n : typeof b.n === "string" && /^\d{1,2}$/.test(b.n) ? Number(b.n) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > ROWS_MAX) throw bad();
    const cal = this.d.calendar();
    let removed = 0;
    // Only rows with this person's make:<key>:<n> source key: never anything else.
    for (const r of await cal.keyed(userId, b.key.toLowerCase(), n)) {
      const ok = await (r.kind === "event" ? cal.removeEvent(userId, r.id) : cal.removeTask(userId, r.id)).then(() => true, () => false);
      if (ok) removed += 1;
    }
    (o.log ?? this.d.log)?.info({ removed }, "plan make: undone");
    return { ok: true, removed };
  }
}

// ------------------------------------------------------------------ the one the server uses

let shared: PlanMake | null = null;

/** The server's: over Plan Ease's calendar, follow-through's people and capture's reader (each read when used). */
export function planMake(): PlanMake {
  return (shared ??= new PlanMake({
    ease: planEase, calendar: () => planEase().calendar, people: () => (followOn() ? planFollows().people : null), capture: planCapture,
    looks: (u) => (followOn() ? planFollows().looksOf(u) : Promise.resolve(new Map())),
  }));
}
export function setPlanMake(p: PlanMake | null): void { shared = p; }
