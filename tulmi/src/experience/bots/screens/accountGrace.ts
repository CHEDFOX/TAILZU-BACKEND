/**
 * DELETE ACCOUNT'S SEVEN DAYS (DeleteAcct.dc.html, DDeleteAcct.dc.html; src/you/deletion.ts, routes/accountDeletion.ts).
 *
 * Asking to delete sets a date seven days out and signs the person out; until then everything is kept, and their bots are stopped
 * (you/deletion.ts isLeaving). Signing in during those days shows it plainly, at the top of Home ("Your account will be deleted on
 * 4 Nov") and on Delete account, with Keep my account, which takes the date away and starts the bots again. Here: the days as a
 * strip, the date in words, the ask and the keep, and Home's card. bots.delete-account itself is built in screens/you.ts with these.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import { DELETION_PATH, GRACE_DAYS, GRACE_MS } from "../../../you/deletion.js";
import { box, C, call, card, col, grow, meta, primaryButton, row, seq, statusMark, text, type BotsCtx } from "../kit.js";

export { DELETION_PATH, GRACE_DAYS };

/** GET /v1/account/deletion. */
export interface DeletionState {
  scheduled: { requestedAt: number; deleteAt: number } | null;
  graceDays?: number;
  /** The day it would be deleted if asked now. */
  deleteAtIfNow?: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const local = (ctx: BotsCtx, t: number) => new Date(t + ctx.tzOffsetMinutes * 60_000);
/** "4 Nov", in the person's own day. */
export const dayMonthOf = (ctx: BotsCtx, t: number): string => { const d = local(ctx, t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** Days since 1970 in the person's own day. */
const dayNo = (ctx: BotsCtx, t: number) => Math.floor((t + ctx.tzOffsetMinutes * 60_000) / DAY_MS);

const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" } : {}) } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };

/** When the account would go if they asked now (the server's word when it answered, else seven days from now). */
export const goneAt = (ctx: BotsCtx, d: DeletionState | undefined): number => d?.scheduled?.deleteAt ?? d?.deleteAtIfNow ?? ctx.live.now + GRACE_MS;

/**
 * Ask to delete: the date is set and the person is signed out (only once it is set: a failed ask must never look like a done one,
 * catalog.ts deleteAccountScreen says why).
 */
export const scheduleDeletion = (gone: string): ActionSpec => call("POST", DELETION_PATH, {}, {
  ok: seq(toast(`Your account will be deleted on ${gone}. Sign in before then to keep it.`), { kind: "signOut" } as ActionSpec),
  fail: toast("Couldn't delete the account. Try again.", true),
});

/** Keep my account: the date goes, and the page reads again. */
export const keepAccount: ActionRef = call("DELETE", DELETION_PATH, undefined, {
  ok: seq(toast("Your account is staying"), refresh),
  fail: toast("Couldn't keep it just now. Try again.", true),
});

/**
 * The seven days as a strip, from the day they asked (or today): the days gone by in ink, the rest on the track. With `labels`
 * (the window) each day's date under it: "28 Oct", "29", …, "1 Nov".
 */
export function daysStrip(ctx: BotsCtx, from: number, o: { labels?: boolean } = {}): Node {
  const today = Math.max(0, Math.min(GRACE_DAYS - 1, dayNo(ctx, ctx.live.now) - dayNo(ctx, from)));
  const cells = Array.from({ length: GRACE_DAYS }, (_, i) => {
    const bar = box([], { height: o.labels ? 6 : 5, borderRadius: 3, backgroundColor: i <= today ? C.ink : C.track, alignSelf: "stretch" });
    if (!o.labels) return box([bar], { flexGrow: 1, flexBasis: 0 });
    const d = local(ctx, from + i * DAY_MS);
    const label = i === 0 || d.getUTCDate() === 1 ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : String(d.getUTCDate());
    return col([bar, text(label, { size: 11, lineHeight: 14, color: i === today ? C.ink : C.meta, weight: i === today ? 600 : 400 })], { gap: 6, flexGrow: 1, flexBasis: 0 });
  });
  return row(cells, { gap: o.labels ? 5 : 4, alignItems: "flex-start" });
}

/**
 * HOME, WHILE THE DATE STANDS: the plain fact and the one thing to do about it, at the top. Nothing when no date is set (or the
 * read failed: a card about deleting must never come up on a guess).
 */
export function leavingCard(ctx: BotsCtx, d: DeletionState | undefined): Node[] {
  const s = d?.scheduled;
  if (!s) return [];
  const desk = ctx.client === "desktop";
  return [card([
    row([
      box([statusMark("needs")], { height: desk ? 21 : 20, justifyContent: "center", alignSelf: "flex-start" }),
      col([
        text(`Your account will be deleted on ${dayMonthOf(ctx, s.deleteAt)}`, { size: desk ? 16 : 15, weight: 600, lineHeight: desk ? 21 : 20 }),
        meta("Your bots are stopped. Keep it, and they start again.", { size: 13, lineHeight: 18 }),
      ], { gap: 3, flexGrow: 1, flexShrink: 1 }),
      ...(desk ? [grow(), primaryButton("Keep my account", keepAccount, { size: "md" })] : []),
    ], { gap: 12, alignItems: desk ? "center" : "flex-start" }),
    ...(desk ? [] : [primaryButton("Keep my account", keepAccount, { wide: true, size: "md" })]),
  ], { padding: desk ? 18 : 16, gap: 14 })];
}
