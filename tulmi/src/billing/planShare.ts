/**
 * SHARING A PLAN (migration 0096, docs/plan-share.md, PLAN_SHARE — off): the store, and the one rule everything else hangs off.
 *
 * A plan is a MONTH'S ALLOWANCE OF SPEND ON ONE ACCOUNT (you/usage.ts). Sharing it means other accounts draw on that same
 * allowance: one shared pot, no per-seat price and no seat count, because the allowance itself is the ceiling. Sharing with
 * thirty people cannot cost more than sharing with one; it only empties sooner. Nothing else is shared — not chats, not bots,
 * not things.
 *
 *   payerFor(userId)   who the spend is metered against: themselves, unless they have no plan of their own and someone is
 *                      sharing one with them. THE ONE RULE. you/limits.ts keys the whole meter on its answer, so a member's
 *                      spend lands on the owner's month and the owner's plan decides what they get
 *   payerNow(userId)   the same answer with no round trip, for the one caller that cannot await (Spending.record); null when
 *                      it is not known yet
 *   the store          plan_shares (who is on whose plan) and plan_share_asks (someone asking to be put on one)
 *   the mutations      share / unshare / ask / answer. Each one clears the payer cache for everyone it touches, because a cache
 *                      that outlives a "Stop sharing" is somebody spending money they were just taken off
 *
 * THE RULE, in full:
 *
 *   - Their own live entitlement ALWAYS wins. `payerFor` only looks at plan_shares when the person has no entitlement of their own.
 *   - A person may be on at most ONE plan. The table's key is (owner_id, member_id), which only stops the same pair twice, so the
 *     single-plan rule is enforced here, in `shareWith`.
 *   - If the owner's plan lapses the rows STAY and simply stop resolving, so renewing brings everyone back without asking again.
 *   - A held account (abuse prevention, docs/trust.md §actions) draws on nobody's plan and lends to nobody.
 *   - With PLAN_SHARE off, `payerFor` answers "themselves" for everyone, before any read: nothing about the meter changes.
 *
 * Cached the way getEntitlement is (short, in-process), and cleared on every share, every unshare and every entitlement change
 * (entitlements.ts `onEntitlementChange`, which both the RevenueCat and the Razorpay paths already fire through forgetEntitlement).
 *
 * Supabase with the service key when the server has one, else memory (a restart forgets it, as the other stores here).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabase } from "../auth/supabase.js";
import { getConfig } from "../config.js";
import { heldFreeUse } from "../you/usage.js";
import { getEntitlement, onEntitlementChange } from "./entitlements.js";

// ===================================================================== the switch

function switches(): { on: boolean; only: string } {
  try {
    const c = getConfig();
    return { on: c.PLAN_SHARE, only: c.PLAN_SHARE_USERS };
  } catch {
    return { on: (process.env.PLAN_SHARE ?? "").toLowerCase() === "true", only: process.env.PLAN_SHARE_USERS ?? "" };
  }
}

/** The switch alone, whoever asks: what a route checks before it knows who is asking. */
export function planShareSwitchOn(): boolean { return switches().on; }

/**
 * Is sharing a plan on for this person? Read on every call, so a test can flip it with resetConfigForTests. With PLAN_SHARE_USERS
 * set, only the accounts it names, even with the switch on.
 */
export function planShareOn(userId?: string | null): boolean {
  const { on, only } = switches();
  if (!on) return false;
  const list = only.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return !!userId && list.includes(userId);
}

// ===================================================================== the rows

export type AskState = "waiting" | "promised" | "shared" | "declined" | "withdrawn";
/** The two states an ask is still open in: the owner has not finished with it, so the pair cannot have another. */
export const OPEN_ASKS: readonly AskState[] = ["waiting", "promised"];

export interface ShareRow { ownerId: string; memberId: string; createdAt: number }
export interface AskRow { id: string; askerId: string; ownerId: string; about?: string; state: AskState; createdAt: number; answeredAt?: number }

export interface PlanShareStore {
  /** Everyone on this person's plan, oldest first. */
  membersOf(ownerId: string): Promise<ShareRow[]>;
  /** The plan this person is on, or null. At most one (the single-plan rule). */
  shareOf(memberId: string): Promise<ShareRow | null>;
  addShare(row: ShareRow): Promise<void>;
  removeShare(ownerId: string, memberId: string): Promise<void>;
  /** Asks in these states, by the person who would answer them. */
  asksForOwner(ownerId: string, states: readonly AskState[]): Promise<AskRow[]>;
  /** Asks in these states, by the person who made them. */
  asksByAsker(askerId: string, states: readonly AskState[]): Promise<AskRow[]>;
  askById(id: string): Promise<AskRow | null>;
  addAsk(row: AskRow): Promise<void>;
  setAskState(id: string, state: AskState, answeredAt: number): Promise<void>;
}

// -------------------------------------------------------------------- memory

export class MemoryPlanShareStore implements PlanShareStore {
  readonly shares: ShareRow[] = [];
  readonly asks: AskRow[] = [];

  async membersOf(ownerId: string) { return this.shares.filter((s) => s.ownerId === ownerId).sort((a, b) => a.createdAt - b.createdAt).map((s) => ({ ...s })); }
  async shareOf(memberId: string) { const s = this.shares.find((r) => r.memberId === memberId); return s ? { ...s } : null; }
  async addShare(row: ShareRow) { await this.removeShare(row.ownerId, row.memberId); this.shares.push({ ...row }); }
  async removeShare(ownerId: string, memberId: string) {
    for (let i = this.shares.length - 1; i >= 0; i -= 1) if (this.shares[i]!.ownerId === ownerId && this.shares[i]!.memberId === memberId) this.shares.splice(i, 1);
  }
  async asksForOwner(ownerId: string, states: readonly AskState[]) { return this.asks.filter((a) => a.ownerId === ownerId && states.includes(a.state)).map((a) => ({ ...a })); }
  async asksByAsker(askerId: string, states: readonly AskState[]) { return this.asks.filter((a) => a.askerId === askerId && states.includes(a.state)).map((a) => ({ ...a })); }
  async askById(id: string) { const a = this.asks.find((r) => r.id === id); return a ? { ...a } : null; }
  async addAsk(row: AskRow) { this.asks.push({ ...row }); }
  async setAskState(id: string, state: AskState, answeredAt: number) {
    const a = this.asks.find((r) => r.id === id);
    if (a) { a.state = state; a.answeredAt = answeredAt; }
  }
}

// -------------------------------------------------------------------- supabase

const ms = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : 0) || 0;
const iso = (t: number): string => new Date(t).toISOString();

class SupabasePlanShareStore implements PlanShareStore {
  constructor(private readonly sb: SupabaseClient) {}

  private share(r: Record<string, unknown>): ShareRow {
    return { ownerId: String(r.owner_id), memberId: String(r.member_id), createdAt: ms(r.created_at) };
  }
  private ask(r: Record<string, unknown>): AskRow {
    return {
      id: String(r.id), askerId: String(r.asker_id), ownerId: String(r.owner_id), state: String(r.state) as AskState,
      ...(r.about ? { about: String(r.about) } : {}), createdAt: ms(r.created_at), ...(r.answered_at ? { answeredAt: ms(r.answered_at) } : {}),
    };
  }

  async membersOf(ownerId: string) {
    const { data, error } = await this.sb.from("plan_shares").select("*").eq("owner_id", ownerId).order("created_at", { ascending: true });
    if (error) throw new Error(`plan share: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => this.share(r));
  }
  async shareOf(memberId: string) {
    const { data, error } = await this.sb.from("plan_shares").select("*").eq("member_id", memberId).limit(1);
    if (error) throw new Error(`plan share: ${error.message}`);
    const r = (data ?? [])[0] as Record<string, unknown> | undefined;
    return r ? this.share(r) : null;
  }
  async addShare(row: ShareRow) {
    const { error } = await this.sb.from("plan_shares").upsert(
      { owner_id: row.ownerId, member_id: row.memberId, created_at: iso(row.createdAt) }, { onConflict: "owner_id,member_id" },
    );
    if (error) throw new Error(`plan share: ${error.message}`);
  }
  async removeShare(ownerId: string, memberId: string) {
    const { error } = await this.sb.from("plan_shares").delete().eq("owner_id", ownerId).eq("member_id", memberId);
    if (error) throw new Error(`plan share: ${error.message}`);
  }
  private async asksBy(column: "owner_id" | "asker_id", id: string, states: readonly AskState[]) {
    const { data, error } = await this.sb.from("plan_share_asks").select("*").eq(column, id).in("state", [...states]).order("created_at", { ascending: true });
    if (error) throw new Error(`plan share: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => this.ask(r));
  }
  async asksForOwner(ownerId: string, states: readonly AskState[]) { return this.asksBy("owner_id", ownerId, states); }
  async asksByAsker(askerId: string, states: readonly AskState[]) { return this.asksBy("asker_id", askerId, states); }
  async askById(id: string) {
    const { data, error } = await this.sb.from("plan_share_asks").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`plan share: ${error.message}`);
    return data ? this.ask(data as Record<string, unknown>) : null;
  }
  async addAsk(row: AskRow) {
    const { error } = await this.sb.from("plan_share_asks").insert({
      id: row.id, asker_id: row.askerId, owner_id: row.ownerId, about: row.about ?? null, state: row.state, created_at: iso(row.createdAt),
    });
    if (error) throw new Error(`plan share: ${error.message}`);
  }
  async setAskState(id: string, state: AskState, answeredAt: number) {
    const { error } = await this.sb.from("plan_share_asks").update({ state, answered_at: iso(answeredAt) }).eq("id", id);
    if (error) throw new Error(`plan share: ${error.message}`);
  }
}

let current: PlanShareStore | null = null;

/** The process's store: Supabase when the server has the service key, else memory. */
export function planShareStore(): PlanShareStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabasePlanShareStore(sb) : new MemoryPlanShareStore();
  }
  return current;
}

export function setPlanShareStoreForTests(s: PlanShareStore | null): void { current = s; forgetAllPayers(); }

// ===================================================================== whose name, for the one line that says it

/**
 * The owner's name, for "You are on Rahul's Lite". Names live in Spaces, which this file must not depend on (the meter reads
 * `payerFor` on every request and Spaces reads rows of its own), so the lookup is INSTALLED by the routes at boot, the way the
 * hold check is installed on the meter. Nothing installed means no name, never an error: the rule works without it.
 */
export type NameOf = (userId: string) => Promise<string>;
let nameOf: NameOf | null = null;
export function installPlanShareNames(fn: NameOf | null): void { nameOf = fn; }
async function ownerName(userId: string): Promise<string> {
  if (!nameOf) return "";
  try { return (await nameOf(userId)) || ""; } catch { return ""; }
}

// ===================================================================== the rule

/** Who pays for what this person does: themselves, or whoever is sharing a plan with them. */
export interface Payer {
  /** The account the spend is metered against — the person, unless they are on someone else's plan. */
  userId: string;
  /** Set only when this is not their own plan. */
  sharedFrom?: { userId: string; name: string };
}

/** As short as getEntitlement's own cache, and cleared on every change, so nobody spends a minute on a plan they were taken off. */
const CACHE_MS = 30_000;
const payers = new Map<string, { at: number; payer: Payer }>();
const PAYERS_MAX = 50_000;

/** Forget one person's answer (they were shared with, unshared, or their entitlement changed). */
export function forgetPayer(userId: string): void { payers.delete(userId); }
/** Forget this owner's answer and every member's: their plan starting or lapsing changes what each of them may spend. */
export async function forgetPayersOf(ownerId: string): Promise<void> {
  forgetPayer(ownerId);
  try { for (const m of await planShareStore().membersOf(ownerId)) forgetPayer(m.memberId); } catch { /* a cache that cannot be narrowed is cleared whole */ payers.clear(); }
}
export function forgetAllPayers(): void { payers.clear(); }

async function resolvePayer(userId: string): Promise<Payer> {
  const self: Payer = { userId };
  // Their own entitlement always wins: a person with a plan never draws on anybody else's, whatever rows exist.
  const mine = await getEntitlement({ id: userId }).catch(() => null);
  if (mine?.active) return self;
  // A held account (docs/trust.md §actions) is on its own free month, and is never quietly given someone else's.
  if (heldFreeUse(userId)) return self;
  const row = await planShareStore().shareOf(userId).catch(() => null);
  if (!row || row.ownerId === userId) return self;
  // The owner's plan must be LIVE. Lapsed, the row stays and simply stops resolving, so renewing brings everyone back.
  const theirs = await getEntitlement({ id: row.ownerId }).catch(() => null);
  if (!theirs?.active || heldFreeUse(row.ownerId)) return self;
  return { userId: row.ownerId, sharedFrom: { userId: row.ownerId, name: await ownerName(row.ownerId) } };
}

/**
 * Their own plan always wins. Only someone with no plan of their own draws on another's.
 *
 * Every metered path in the server goes through this (you/limits.ts `Spending.read` and `record`), so it is asked on the hot path
 * and answered from a short cache. It never throws: a store or a billing read that fails answers "themselves", which is what the
 * server did before any of this existed.
 */
export async function payerFor(userId: string): Promise<Payer> {
  if (!userId || !planShareOn(userId)) return { userId };
  const hit = payers.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.payer;
  let payer: Payer;
  try { payer = await resolvePayer(userId); } catch { payer = { userId }; }
  if (payers.size > PAYERS_MAX) payers.clear();
  payers.set(userId, { at: Date.now(), payer });
  return payer;
}

/**
 * The same answer with no round trip, or null when it is not known yet.
 *
 * `Spending.record` writes a cost down from a place that cannot await (it is called as an answer comes back and must not hold it
 * up). With PLAN_SHARE off this is always an answer, so recording stays exactly as synchronous as it has always been; with it on,
 * the gate that ran moments earlier has already warmed the cache for this person, so it almost always answers too. When it does
 * not, `record` falls back to `payerFor` and writes a moment later.
 */
export function payerNow(userId: string): Payer | null {
  if (!userId || !planShareOn(userId)) return { userId };
  const hit = payers.get(userId);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.payer : null;
}

// ===================================================================== the mutations

export class PlanShareError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); this.name = "PlanShareError"; }
}

/** Does this person have a live plan of their own? The only thing about another person's billing anything here ever says. */
export async function hasOwnPlan(userId: string): Promise<boolean> {
  return !!(await getEntitlement({ id: userId }).catch(() => null))?.active;
}

/**
 * Put `memberId` on `ownerId`'s plan. Never says whose plan somebody is already on: "They are already on a plan." is all anyone
 * is ever told, because saying whose would hand out a fact about two other people's money.
 */
export async function shareWith(ownerId: string, memberId: string, now = Date.now()): Promise<void> {
  if (ownerId === memberId) throw new PlanShareError("bad_request", "That is your own plan.");
  const store = planShareStore();
  const already = await store.shareOf(memberId);
  if (already && already.ownerId !== ownerId) throw new PlanShareError("already_shared", "They are already on a plan.", 409);
  if (!already) await store.addShare({ ownerId, memberId, createdAt: now });
  forgetPayer(memberId);
  // An open ask between the two is answered by the share itself, so nothing is left waiting on a screen.
  for (const a of await store.asksByAsker(memberId, OPEN_ASKS)) if (a.ownerId === ownerId) await store.setAskState(a.id, "shared", now);
}

/** Take someone off a plan. Takes effect at once: the next request they make is their own again. */
export async function stopSharing(ownerId: string, memberId: string): Promise<void> {
  await planShareStore().removeShare(ownerId, memberId);
  forgetPayer(memberId);
}

/** How many people are on this person's plan. */
export async function membersOn(ownerId: string): Promise<ShareRow[]> {
  return planShareStore().membersOf(ownerId).catch(() => []);
}

/** The plan this person is on, or null — the row, whether or not the owner's plan is live. */
export async function shareOf(memberId: string): Promise<ShareRow | null> {
  return planShareStore().shareOf(memberId).catch(() => null);
}

/** "Not now" is quiet, and the same person cannot be asked again for a week. */
export const ASK_AGAIN_MS = 7 * 86_400_000;

/** Ask someone to share their plan. One open ask between two people at a time. */
export async function askFor(askerId: string, ownerId: string, about: string | undefined, now = Date.now()): Promise<AskRow> {
  if (askerId === ownerId) throw new PlanShareError("bad_request", "That is your own plan.");
  const store = planShareStore();
  const open = await store.asksByAsker(askerId, OPEN_ASKS);
  if (open.length) throw new PlanShareError("already_asked", "You already asked someone. Wait for their answer first.", 409);
  const recent = await store.asksByAsker(askerId, ["declined"]);
  const said = recent.filter((a) => a.ownerId === ownerId).map((a) => a.answeredAt ?? a.createdAt).sort((a, b) => b - a)[0];
  if (said !== undefined && now - said < ASK_AGAIN_MS) throw new PlanShareError("asked_recently", "You asked them recently. Try again in a few days.", 409);
  const row: AskRow = { id: randomUUID(), askerId, ownerId, ...(about ? { about } : {}), state: "waiting", createdAt: now };
  await store.addAsk(row);
  return row;
}

export async function askById(id: string): Promise<AskRow | null> { return planShareStore().askById(id).catch(() => null); }
export async function asksWaitingFor(ownerId: string): Promise<AskRow[]> { return planShareStore().asksForOwner(ownerId, ["waiting"]).catch(() => []); }
export async function myOpenAsk(askerId: string): Promise<AskRow | null> {
  const open = await planShareStore().asksByAsker(askerId, OPEN_ASKS).catch(() => []);
  return open.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/** The owner's answer to an ask: share it now, promise it (they have no plan yet), or quietly decline. */
export async function answerAsk(ask: AskRow, decision: "share" | "promise" | "decline", now = Date.now()): Promise<void> {
  const store = planShareStore();
  if (decision === "decline") { await store.setAskState(ask.id, "declined", now); return; }
  if (decision === "promise") { await store.setAskState(ask.id, "promised", now); return; }
  await shareWith(ask.ownerId, ask.askerId, now);
  await store.setAskState(ask.id, "shared", now);
}

/** Withdraw my own ask. */
export async function withdrawAsk(ask: AskRow, now = Date.now()): Promise<void> {
  await planShareStore().setAskState(ask.id, "withdrawn", now);
}

// ===================================================================== buying completes a promise

/**
 * WHAT HAPPENS THE MOMENT A PLAN IS PAID FOR: every `promised` ask by that account becomes a real share, and the asker is told.
 *
 * That is the whole of the owner's "if they don't have a plan they have to buy and then can share". The person pressed one button
 * ("See plans and share"), bought a plan, and the share they promised is waiting when the payment lands — nobody has to come back
 * to a screen and press anything again. Called from entitlements.ts on every grant, both stores' paths; never throws.
 */
export type SharedToldFn = (o: { ownerId: string; memberId: string }) => void;
let told: SharedToldFn | null = null;
/** How the asker is told (a push, from the routes). Nothing installed: the share still happens, quietly. */
export function installSharedTold(fn: SharedToldFn | null): void { told = fn; }

export async function settlePromisedAsks(ownerId: string, now = Date.now()): Promise<number> {
  if (!planShareOn(ownerId)) return 0;
  let n = 0;
  try {
    if (!(await hasOwnPlan(ownerId))) return 0;
    for (const a of await planShareStore().asksForOwner(ownerId, ["promised"])) {
      try {
        await shareWith(ownerId, a.askerId, now);
        n += 1;
        try { told?.({ ownerId, memberId: a.askerId }); } catch { /* a missed push is not a lost share */ }
      } catch { /* already on someone's plan, or the row would not take: the next grant tries again */ }
    }
  } catch { /* the store could not be read: the grant itself still stands */ }
  return n;
}

/**
 * Entitlement changes reach here through entitlements.ts, which fires on every grant and every revoke, from both the RevenueCat
 * webhook and Razorpay. Two things follow: the payer cache for this account AND everyone on its plan is wrong now, and on a grant
 * every promise this account made comes due.
 */
onEntitlementChange((userId, o) => {
  void (async () => {
    await forgetPayersOf(userId);
    if (o.granted) await settlePromisedAsks(userId);
  })().catch(() => undefined);
});
