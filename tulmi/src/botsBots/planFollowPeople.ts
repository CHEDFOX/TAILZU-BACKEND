/**
 * FOLLOW-THROUGH'S PEOPLE: WHO DOES AN ITEM (PLAN_V2_FOLLOW; docs/plan-ease.md "Follow-through").
 *
 *   setItem(user, ref, b)    PUT FOLLOW/item: how important it is and who does it, in order (the first is Who, the rest "if they can't")
 *   picker(user, ref)        GET FOLLOW/people: who can be put on it: you, and your X0 people
 *   setNumber(user, b)       PUT FOLLOW/number: a number you keep for someone, sealed, only for your own Call button (X0 never dials it)
 *   numberFor(user, member)  that number, opened (the follow page's Call, the tell push's Call button)
 *
 * WHO COUNTS (the owner's change): you always, and only people you are connected with in X0, by exactly the rules messaging uses
 * (threads.ts contacts: a space you share in which you may message, no block either way, Spaces on). There is no other people list and no
 * other invite path. A name or an id that is not among them is not saved: X0 says plainly they are not in your X0 people yet and offers
 * the existing way to bring someone in (a space's invite, as the Spaces screens do); the item is saved with the people who do count.
 * The same rules are checked again before every reach (planFollow.ts).
 */
import { BotError } from "../bots/types.js";
import type { CalEvent, CalTask, Calendar } from "../calendar/index.js";
import { eventRefOf, itemId } from "../widgets/items.js";
import type { ItemFollow, PlanFollows } from "./planFollow.js";
import type { FollowStores } from "./planFollowStore.js";
import { PEOPLE_MAX, firstName, isUuid, keyOf, type PersonKey, type PersonRef } from "./planFollowWords.js";
import { e164Of, openNumber, reachReady, sealNumber } from "./planReach.js";
import { spacesOn } from "./spacesSwitch.js";

/** The existing way to bring someone into your X0 people: a space's invite (its admin), or Spaces to start one. */
export interface InviteWay { screen: string; params?: Record<string, string> }

export interface PeoplePicker {
  item: ItemFollow | null;
  /** You first, then your X0 people by name. `number`: you keep a number for them (your Call button). */
  people: Array<{ key: PersonKey; name: string; me: boolean; number: boolean }>;
  /** Spaces is on: anyone else can be in your X0 people at all. */
  spaces: boolean;
  /** A number can be kept (CONNECTOR_TOKEN_KEY is set). */
  numbers: boolean;
  invite: InviteWay | null;
}

export interface SetItemOut {
  follow: ItemFollow | null;
  /** Names (or "Someone") that are not in your X0 people: not saved. */
  missing: string[];
  message?: string;
  invite?: InviteWay | null;
}

const ME = /^(?:me|myself|i|you|self|mujhe|main)$/i;
const MISSING_ID = "Someone";

export class FollowPeople {
  private inviteFor: ((userId: string) => Promise<InviteWay | null>) | null = null;

  constructor(private readonly o: {
    stores: FollowStores; calendar: Calendar; now: () => number;
    contacts: (userId: string) => Promise<Map<string, string>>;
    follows: () => PlanFollows;
  }) {}

  /** The existing invite path (routes: the person's spaces, as the Spaces screens offer it). */
  wire(o: { invite?: ((userId: string) => Promise<InviteWay | null>) | null }): void {
    if (o.invite !== undefined) this.inviteFor = o.invite;
  }

  private async invite(userId: string): Promise<InviteWay | null> {
    if (!spacesOn() || !this.inviteFor) return null;
    return this.inviteFor(userId).catch(() => null);
  }

  /** "Mom isn't in your X0 people yet. Invite them to a space, then add them here." (Also "Plan something"'s MadeView.missing.) */
  missingLine(list: string[]): string {
    const names = list.map((n) => (n === MISSING_ID ? "That person" : firstName(n)));
    const who = names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} and ${names[1]!.replace(/^That person$/, "that person")}` : `${names.length} people`;
    const verb = names.length === 1 ? "isn't" : "aren't";
    return spacesOn()
      ? `${who} ${verb} in your X0 people yet. Invite them to a space, then add them here.`
      : `${who} ${verb} in your X0 people yet.`;
  }

  /**
   * Your people as given (ids or names, in order) → refs of people who count; the rest by name for the message. A name matches one of
   * your X0 people by their whole name or first name (case aside); two matches is not a match.
   */
  async resolve(userId: string, raw: unknown): Promise<{ refs: PersonRef[]; missing: string[] }> {
    if (!Array.isArray(raw)) throw new BotError("bad_request", "Who does it is a list of people.");
    const contacts = await this.o.contacts(userId);
    const refs: PersonRef[] = [];
    const missing: string[] = [];
    // Each ref keeps the name the asker knows them by now, so the asker can still be told who it was if they leave later.
    const add = (id: string) => {
      if (refs.some((r) => r.id === id) || refs.length >= PEOPLE_MAX) return;
      const name = contacts.get(id);
      refs.push(name ? { k: "u", id, name: name.slice(0, 40) } : { k: "u", id });
    };
    for (const p of raw.slice(0, 20)) {
      const id = typeof p === "string" ? (isUuid(p) ? p : null) : p && typeof p === "object" && isUuid((p as { id?: unknown }).id) ? (p as { id: string }).id : null;
      if (id) {
        if (id === userId || contacts.has(id)) add(id); else missing.push(MISSING_ID);
        continue;
      }
      const name = (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string" ? (p as { name: string }).name : "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!name) continue;
      if (ME.test(name)) { add(userId); continue; }
      const want = name.toLowerCase();
      const whole = [...contacts].filter(([, n]) => n.toLowerCase() === want);
      const first = [...contacts].filter(([, n]) => firstName(n).toLowerCase() === want);
      const hit = whole.length === 1 ? whole[0] : whole.length === 0 && first.length === 1 ? first[0] : undefined;
      if (hit) add(hit[0]); else missing.push(name);
    }
    return { refs, missing: [...new Set(missing)] };
  }

  async setItem(userId: string, ref: { kind: "event" | "task"; id: string }, b: { importance?: unknown; people?: unknown }): Promise<SetItemOut> {
    if ((ref.kind !== "event" && ref.kind !== "task") || typeof ref.id !== "string" || !ref.id || ref.id.length > 120) throw new BotError("bad_request", "Say which one.");
    let importance: "normal" | "must" | null | undefined;
    if (b.importance !== undefined) {
      if (b.importance === null || b.importance === "auto" || b.importance === "") importance = null;
      else if (b.importance === "normal" || b.importance === "must") importance = b.importance;
      else throw new BotError("bad_request", "How important is normal or must.");
    }
    const r = b.people !== undefined ? await this.resolve(userId, b.people) : null;
    if (importance === undefined && !r) throw new BotError("bad_request", "Nothing to change.");
    // Only the person's own items, and never a wait (it keeps its own check-backs).
    const cur: CalTask | CalEvent = ref.kind === "task" ? await this.o.calendar.task(userId, ref.id) : await this.o.calendar.event(userId, ref.id);
    if (ref.kind === "task" && (cur as CalTask).kind === "wait") throw new BotError("bad_request", "A wait keeps its own check-backs.");
    // Someone else's (a space's plan or task): only who set it can change it (the calendar says so too).
    await this.o.calendar.setFollow(userId, { kind: ref.kind, id: ref.id }, { ...(importance !== undefined ? { importance } : {}), ...(r ? { people: r.refs } : {}) });
    const view = await this.o.follows().itemFollow(userId, ref.kind, ref.id);
    // Its open follow hears it now (back to normal stops the louder steps; a holder taken off passes it on).
    const item = ref.kind === "task" ? itemId({ kind: "pt", taskId: cur.id }) : itemId({ kind: "pe", eventRef: eventRefOf(cur.id), day: (cur as CalEvent).day });
    await this.o.follows().itemChanged(userId, item, {
      ...(importance !== undefined ? { importance } : {}), must: view?.must ?? false, ...(r ? { people: r.refs.map((x) => x.id) } : {}),
    }).catch(() => undefined);
    const out: SetItemOut = { follow: view, missing: r?.missing ?? [] };
    if (out.missing.length) { out.message = this.missingLine(out.missing); out.invite = await this.invite(userId); }
    return out;
  }

  async picker(userId: string, ref: { kind: "event" | "task"; id: string } | null): Promise<PeoplePicker> {
    const contacts = await this.o.contacts(userId);
    const kept = new Set((await this.o.stores.numbers.select({ user_id: userId }, { limit: 200 }).catch(() => [])).map((n) => n.member_id));
    const others = [...contacts].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ key: keyOf({ id }), name, me: false, number: kept.has(id) }));
    return {
      item: ref ? await this.o.follows().itemFollow(userId, ref.kind, ref.id).catch(() => null) : null,
      people: [{ key: keyOf({ id: userId }), name: "You", me: true, number: false }, ...others],
      spaces: spacesOn(), numbers: reachReady(), invite: await this.invite(userId),
    };
  }

  /** A number you keep for someone in your X0 people, for your own Call button; "" takes it away. */
  async setNumber(userId: string, b: { member?: unknown; phone?: unknown }): Promise<{ ok: true; number: boolean }> {
    if (!isUuid(b.member)) throw new BotError("bad_request", "Say who the number is for.");
    const member = b.member;
    if (!(await this.o.contacts(userId)).has(member)) throw new BotError("bad_request", "That person isn't in your X0 people yet.");
    const raw = typeof b.phone === "string" ? b.phone.trim() : "";
    if (!raw) {
      await this.o.stores.numbers.remove({ user_id: userId, member_id: member });
      return { ok: true, number: false };
    }
    if (!reachReady()) throw new BotError("not_ready", "Numbers can't be kept here yet.", 409);
    const e164 = e164Of(raw);
    if (!e164) throw new BotError("bad_request", "That number doesn't look right.");
    await this.o.stores.numbers.upsert({ user_id: userId, member_id: member, seal: sealNumber(e164), updated_ms: this.o.now() }, ["user_id", "member_id"]);
    return { ok: true, number: true };
  }

  /** The number you keep for someone, opened; null when none (or it can't be opened: a rotated key). */
  async numberFor(userId: string, memberId: string): Promise<string | null> {
    if (!isUuid(memberId) || userId === memberId || !reachReady()) return null;
    const row = (await this.o.stores.numbers.select({ user_id: userId, member_id: memberId }, { limit: 1 }))[0];
    return row ? openNumber(row.seal) : null;
  }
}
