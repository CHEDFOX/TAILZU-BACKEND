/**
 * PAYMENT REQUESTS IN A SPACE: someone who may ask ("ask for payments") asks for an amount to a UPI ID; someone who may approve says
 * yes or no. Nothing here moves money: a yes hands the approver the UPI payment, filled in, to check and pay in their own UPI app
 * (bots.approve, the app's one way to pay), and they say when they have.
 *
 *   list(user, space)                        the space's requests, newest first (its history)
 *   ask(user, space, { amount, to, name, note })
 *   decide(user, space, id, "approve" | "decline")   by someone who approves, never on their own request
 *   paid(user, space, id)                    the approver says they paid
 *   cancel(user, space, id)                  the asker takes it back while it waits
 */
import { randomUUID } from "node:crypto";
import { BotError } from "../bots/index.js";
import { upiOf } from "../shell/parse.js";
import { spaceTable, type PagedTable } from "./spaceRows.js";
import type { Spaces } from "./spaces.js";

export type PayStatus = "waiting" | "approved" | "declined" | "paid" | "cancelled";
export interface PaymentRow {
  [k: string]: unknown; id: string; space_id: string; asked_by: string; asked_name: string; amount_paise: number; payee_name: string; payee_vpa: string; note: string;
  status: PayStatus; decided_by: string | null; decided_name: string; decided_ms: number | null; paid_ms: number | null; created_ms: number;
}
export interface PaymentView {
  id: string; amountPaise: number; payee: string; vpa: string; note: string; status: PayStatus; at: number;
  askedBy: string; byYou: boolean; decidedBy: string; decidedAt: number | null; paidAt: number | null;
  /** The filled-in UPI payment, for the approver who said yes (bots.approve opens it). */
  upi: string | null;
  canDecide: boolean; canCancel: boolean; canMarkPaid: boolean;
}

export const PAY_MAX_PAISE = 100_000 * 100;
const OPEN_MAX = 30;
const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
const clean = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rupeesOf = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "1240", "1,240.50", "₹ 99": paise, or NaN. */
export function paiseOf(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  if (typeof v !== "string") return NaN;
  const s = v.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN;
}

/** The UPI payment for a request, as bots.approve reads it. */
export function upiFor(r: Pick<PaymentRow, "payee_vpa" | "payee_name" | "amount_paise" | "note">): string | null {
  const q = new URLSearchParams({ pa: r.payee_vpa, pn: r.payee_name, am: (r.amount_paise / 100).toFixed(2), cu: "INR", ...(r.note ? { tn: r.note } : {}) });
  return upiOf(`upi://pay?${q.toString()}`)?.link ?? null;
}

export class Payments {
  constructor(private readonly spaces: Spaces, private readonly now: () => number = Date.now, private readonly rows: PagedTable<PaymentRow> = spaceTable<PaymentRow>("space_payments")) {
    spaces.onMembers(async (e) => { if (e.deleted) await this.rows.remove({ space_id: e.spaceId }); });
  }

  private view(userId: string, r: PaymentRow, approve: boolean): PaymentView {
    return {
      id: r.id, amountPaise: Number(r.amount_paise), payee: r.payee_name, vpa: r.payee_vpa, note: r.note, status: r.status, at: Number(r.created_ms),
      askedBy: r.asked_by === userId ? "You" : r.asked_name, byYou: r.asked_by === userId,
      decidedBy: r.decided_by === userId ? "You" : r.decided_name, decidedAt: r.decided_ms ? Number(r.decided_ms) : null, paidAt: r.paid_ms ? Number(r.paid_ms) : null,
      upi: r.status === "approved" && r.decided_by === userId ? upiFor(r) : null,
      canDecide: approve && r.status === "waiting" && r.asked_by !== userId,
      canCancel: r.status === "waiting" && r.asked_by === userId,
      canMarkPaid: r.status === "approved" && r.decided_by === userId,
    };
  }

  async list(userId: string, spaceId: string, limit = 30): Promise<PaymentView[]> {
    const a = await this.spaces.access(userId, spaceId);
    const rows = await this.rows.before({ space_id: spaceId }, "created_ms", null, Math.max(1, Math.min(limit, 100)));
    return rows.map((r) => this.view(userId, r, a.perms.includes("approve")));
  }

  /** How many wait for this person's yes in each of their spaces. */
  async waitingFor(userId: string, spaceId: string): Promise<number> {
    const perms = await this.spaces.permsFor(userId, spaceId);
    if (!perms?.includes("approve")) return 0;
    return (await this.rows.select({ space_id: spaceId, status: "waiting" }, { limit: OPEN_MAX })).filter((r) => r.asked_by !== userId).length;
  }

  async ask(userId: string, spaceId: string, b: Record<string, unknown>): Promise<PaymentView> {
    const a = await this.spaces.need(userId, spaceId, "askPay");
    const amount = paiseOf(b.amount);
    if (!(amount > 0 && amount <= PAY_MAX_PAISE)) throw new BotError("bad_amount", "Say how much, up to ₹1,00,000.");
    const vpa = clean(b.to, 320);
    if (!VPA.test(vpa)) throw new BotError("bad_vpa", "That UPI ID doesn't look right. It's like name@okhdfcbank.");
    const name = clean(b.name, 80) || vpa;
    const note = clean(b.note, 120);
    if ((await this.rows.select({ space_id: spaceId, status: "waiting" }, { limit: OPEN_MAX + 1 })).length >= OPEN_MAX) throw new BotError("pay_limit", `${a.s.name} has ${OPEN_MAX} requests waiting. Answer some first.`, 409);
    const r: PaymentRow = {
      id: randomUUID(), space_id: spaceId, asked_by: userId, asked_name: a.me.name, amount_paise: amount, payee_name: name, payee_vpa: vpa, note,
      status: "waiting", decided_by: null, decided_name: "", decided_ms: null, paid_ms: null, created_ms: this.now(),
    };
    if (!upiFor(r)) throw new BotError("bad_vpa", "That UPI ID doesn't look right. It's like name@okhdfcbank.");
    await this.rows.insert(r);
    await this.spaces.note(spaceId, userId, "pay", `${a.me.name} asked for ${rupeesOf(amount)} to ${name}${note ? ` for ${note}` : ""}`);
    await this.spaces.changed(spaceId);
    return this.view(userId, r, a.perms.includes("approve"));
  }

  private async one(spaceId: string, id: string): Promise<PaymentRow> {
    const [r] = UUID.test(id) ? await this.rows.select({ id, space_id: spaceId }, { limit: 1 }) : [];
    if (!r) throw new BotError("not_found", "That request isn't there any more.", 404);
    return r;
  }

  async decide(userId: string, spaceId: string, id: string, what: unknown): Promise<PaymentView> {
    if (what !== "approve" && what !== "decline") throw new BotError("bad_request", "approve or decline.");
    const a = await this.spaces.need(userId, spaceId, "approve");
    const r = await this.one(spaceId, id);
    if (r.asked_by === userId) throw new BotError("not_allowed", "Someone else has to answer your own request.", 403);
    if (r.status !== "waiting") throw new BotError("answered", "That request has been answered already.", 409);
    const status: PayStatus = what === "approve" ? "approved" : "declined";
    const at = this.now();
    // Only the first answer counts: the update matches a request still waiting.
    if (!(await this.rows.update({ id, space_id: spaceId, status: "waiting" }, { status, decided_by: userId, decided_name: a.me.name, decided_ms: at }))) {
      throw new BotError("answered", "That request has been answered already.", 409);
    }
    await this.spaces.note(spaceId, userId, "pay", `${a.me.name} ${status === "approved" ? "approved" : "said no to"} ${rupeesOf(Number(r.amount_paise))} to ${r.payee_name}`);
    await this.spaces.changed(spaceId);
    return this.view(userId, { ...r, status, decided_by: userId, decided_name: a.me.name, decided_ms: at }, true);
  }

  async paid(userId: string, spaceId: string, id: string): Promise<PaymentView> {
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.one(spaceId, id);
    if (r.status !== "approved" || r.decided_by !== userId) throw new BotError("not_allowed", "Only who approved it can say it's paid.", 403);
    const at = this.now();
    await this.rows.update({ id, space_id: spaceId }, { status: "paid", paid_ms: at });
    await this.spaces.note(spaceId, userId, "pay", `${a.me.name} paid ${rupeesOf(Number(r.amount_paise))} to ${r.payee_name}`);
    await this.spaces.changed(spaceId);
    return this.view(userId, { ...r, status: "paid", paid_ms: at }, a.perms.includes("approve"));
  }

  async cancel(userId: string, spaceId: string, id: string): Promise<void> {
    const a = await this.spaces.access(userId, spaceId);
    const r = await this.one(spaceId, id);
    if (r.asked_by !== userId) throw new BotError("not_allowed", "Only who asked can take it back.", 403);
    if (!(await this.rows.update({ id, space_id: spaceId, status: "waiting" }, { status: "cancelled" }))) throw new BotError("answered", "That request has been answered already.", 409);
    await this.spaces.note(spaceId, userId, "pay", `${a.me.name} took back ${rupeesOf(Number(r.amount_paise))} to ${r.payee_name}`);
    await this.spaces.changed(spaceId);
  }
}
