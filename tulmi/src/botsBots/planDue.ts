/**
 * BILLS DUE (PLAN_V2_CAPTURE; docs/plan-ease.md "Bills due"; design A8). A due is a to-do with money: the calendar's kind "due", its
 * amount, who it's paid to and, when it is safe, a pay link. It comes from a capture (a bill SMS, a circular, a screenshot) or the box
 * ("Electricity 2140 due 14th", "Pay rent by the 5th every month").
 *
 *   amountOf(words)        ₹ 2,140 · Rs. 300 · INR 1500 · 2140 rupees · 300/- · 1.2k: in paise, or null
 *   rupees(paise)          "₹2,140": inside the app only, on the person's own row
 *   payLinkOf(link, src)   the Pay button's link, only when it is safe: a upi:// pay link (the UPI app shows the payee before anything
 *                          is paid) or a known biller's https page, and never from words that push ("disconnected tonight")
 *   DUE_ROW                the row: "Electricity ₹2,140", "Due today", Pay on the right with a safe link, the round tick is Paid
 *   dueNext(items, ...)    the one thing's rung 2: "Pay ₹2,140 for electricity today"
 *   dueLine(items, day)    the evening note's "Electricity due." (no amount: a note is read on the lock screen)
 *   dueReminder(task, ...) the push on the day at 10 am, and once more at 6 pm if it isn't paid: "Electricity due today" [Pay] [Paid]
 *   DUE_SLOT               the box: a bill in words becomes a due ("Added: Rent, due the 5th each month · Undo")
 *
 * The amount never leaves the app: not a push, not a note, not the widget, not a space (planSafe.ts). A month's next bill shows no
 * amount until its own bill comes: we never guess one.
 */
import type { BoxSlot } from "./planBox.js";
import type { DayItem, RowCtx, RowKind, RowView } from "./planRows.js";
import { lockSafe, looksHealth, safeTitle } from "./planSafe.js";
import { planOn } from "./planSwitch.js";
import { dayFrom, readLine } from "../calendar/words.js";

const MIN = 60_000, HOUR = 60 * MIN;

// ------------------------------------------------------------------ amounts

const MULT: Record<string, number> = { k: 1000, K: 1000, lakh: 100_000, lac: 100_000, cr: 10_000_000, crore: 10_000_000 };
/** Every way an amount is written here, with its number captured. */
const AMOUNT = [
  /(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d{1,2})?)\s?(k|K|lakh|lac|cr|crore)?\b/,
  /\b(\d[\d,]*(?:\.\d{1,2})?)\s?(k|K|lakh|lac|cr|crore)?\s?(?:rupees|rupaye|rupaiye|rs|INR)\b/i,
  /\b(\d[\d,]*)\/-/,
];

/** The first amount in the words, in paise; null when there is none (a bare number is not money). */
export function amountOf(words: string): number | null {
  for (const re of AMOUNT) {
    const m = re.exec(words);
    if (!m) continue;
    const n = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    const paise = Math.round(n * (m[2] ? MULT[m[2]] ?? 1 : 1) * 100);
    if (paise > 0 && paise <= 10_000_000_000) return paise;
  }
  return null;
}

/**
 * Every number the words hold, as paise, sizes applied ("₹1,200" 120000, "25k" 2500000, "2140" 214000): what a read amount must
 * equal exactly to be kept, so 1250 is never taken from "12500" and never stands in for another line's ₹300.
 */
export function amountsIn(words: string): Set<number> {
  const out = new Set<number>();
  for (const m of words.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d{1,2})?(?:\s?(k|lakhs?|lacs?|cr|crores?)\b)?/gi)) {
    const n = Number(`${m[1]!.replace(/,/g, "")}${m[2] ?? ""}`);
    const size = m[3] ? MULT[m[3].toLowerCase().replace(/s$/, "")] ?? 1 : 1;
    if (Number.isFinite(n) && n > 0) out.add(Math.round(n * size * 100));
  }
  return out;
}

/** "₹2,140", "₹1,200.50": Indian grouping. Inside the app only. */
export function rupees(paise: number): string {
  const r = Math.floor(paise / 100), p = paise % 100;
  const s = String(r);
  const grouped = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}`;
  return `₹${grouped}${p ? `.${String(p).padStart(2, "0")}` : ""}`;
}

// ------------------------------------------------------------------ a safe pay link

/**
 * Billers' and bill-pay pages whose https links may carry a Pay button. Kept short and on the server: anything not on it gets Paid only,
 * and the details say "Pay it from your bank or UPI app."
 */
export const KNOWN_BILLERS: readonly string[] = [
  "paytm.com", "phonepe.com", "billdesk.com", "mobikwik.com", "amazon.in", "airtel.in", "jio.com", "myjio.com", "vi.in",
  "bescom.co.in", "bescom.karnataka.gov.in", "tatapower.com", "tatapower-ddl.com", "adanielectricity.com", "bsesdelhi.com", "mahadiscom.in",
  "cesc.co.in", "tangedco.org", "tnebltd.gov.in", "torrentpower.com", "msedcl.in", "mahanagargas.com", "igl.co.in", "bharatgas.in", "hpgas.com",
  "indane.co.in", "lic.in", "licindia.in", "actcorp.in", "hathway.com", "tatasky.com", "tataplay.com", "dishtv.in", "sundirect.in",
];

/** Words that push someone to pay at once: the shape of a scam. Such a source never gets a Pay button. */
const PUSHY = /\b(?:disconnect(?:ed|ion)?|cut (?:off|tonight)|tonight|within (?:\d+ )?(?:hours?|minutes?|mins?)|immediately|urgent|suspend(?:ed)?|blocked|kyc|last warning|final notice|legal action|call (?:this|our) (?:number|officer))\b/i;

/** The Pay button's link: a upi://pay link with a payee, or a known biller's https page, found word for word in the source. Else null. */
export function payLinkOf(link: unknown, source: string): string | null {
  if (typeof link !== "string" || !link || link.length > 600) return null;
  if (PUSHY.test(source)) return null;
  // Found word for word in what was shared: never one we made up or were handed.
  if (!source.includes(link)) return null;
  if (/^upi:\/\/pay\?/i.test(link)) {
    try {
      const q = new URL(link.replace(/^upi:\/\//i, "https://upi.invalid/")).searchParams;
      return q.get("pa") && /^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/.test(q.get("pa")!) ? link : null;
    } catch { return null; }
  }
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    return KNOWN_BILLERS.some((b) => host === b || host.endsWith(`.${b}`)) ? u.href : null;
  } catch { return null; }
}

/** The links in some words (a bill SMS), in the order they come: upi:// and https:// only. */
export function linksIn(words: string): string[] {
  return [...words.matchAll(/(?:upi:\/\/pay\?[^\s<>"']+|https:\/\/[^\s<>"']+)/gi)].map((m) => m[0].replace(/[.,;:)\]]+$/, ""));
}

// ------------------------------------------------------------------ on the list

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayKey = (ms: number, tz: number) => new Date(ms + tz * MIN).toISOString().slice(0, 10);
const shift = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);
const dateWords = (key: string) => { const d = new Date(`${key}T00:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const short = (t: string) => t.split(" · ")[0]!.trim() || t;
const inLine = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/** "Due today", "Due tomorrow", "Due Wed 11 Nov", "Was due Mon 9 Nov". */
export function dueWords(day: string, today: string): string {
  if (day === today) return "Due today";
  if (day === shift(today, 1)) return "Due tomorrow";
  return day < today ? `Was due ${dateWords(day)}` : `Due ${dateWords(day)}`;
}

/** A bill's title with its amount, inside the app ("Electricity ₹2,140"); next month's has none until its bill comes. */
export const dueTitle = (it: Pick<DayItem, "title" | "amountPaise">): string => (it.amountPaise ? `${it.title} ${rupees(it.amountPaise)}` : it.title);

/** The row: the amount once, in the title; "Due today" as its grey line; Pay on the right with a safe link; the tick is Paid. */
export const DUE_ROW: RowKind = {
  kind: "due", step: 3,
  match: (it) => it.ref === "task" && it.kind === "due",
  row(it: DayItem, ctx: RowCtx): RowView {
    const today = dayKey(ctx.now, ctx.tz);
    const title = dueTitle(it);
    return {
      id: `t:${it.id}`, kind: "due", time: "",
      tick: { item: `pt:${it.id}`, action: it.done ? "unpaid" : "paid", label: it.done ? `${title}. Paid. Tap to put it back.` : `${title}. Tap when it's paid.` },
      title, line: it.done ? "Paid" : ctx.clashes.get(it.id) ?? dueWords(it.day, today),
      ...(it.payLink && !it.done ? { action: { label: "Pay", url: it.payLink } } : {}),
      done: it.done, open: { kind: "task", id: it.id }, at: it.start ?? (Date.parse(`${it.day}T00:00:00Z`) + 22 * HOUR),
    };
  },
};

// ------------------------------------------------------------------ the one thing, the notes, the widget

/** Rung 2 of the one thing: a bill due today and not paid. "Pay ₹2,140 for electricity today" [Pay] with a safe link. */
export function dueNext(items: DayItem[], today: string): { big: string; grey: string; button?: { label: string; url: string }; rowId: string; rung: 2 } | null {
  if (!planOn("capture")) return null;
  const due = items.filter((it) => it.ref === "task" && it.kind === "due" && !it.done && it.day === today)
    .sort((a, b) => (b.amountPaise ?? 0) - (a.amountPaise ?? 0))[0];
  if (!due) return null;
  return {
    big: due.amountPaise ? `Pay ${rupees(due.amountPaise)} for ${inLine(short(due.title))} today` : `Pay ${inLine(short(due.title))} today`,
    grey: due.payee ?? "", ...(due.payLink ? { button: { label: "Pay", url: due.payLink } } : {}), rowId: `t:${due.id}`, rung: 2,
  };
}

/** The evening note's money line, with no amount: "Electricity due." Tomorrow's bills, two at most. */
export function dueLine(items: DayItem[], day: string): string | null {
  if (!planOn("capture")) return null;
  const dues = items.filter((it) => it.ref === "task" && it.kind === "due" && !it.done && it.day === day);
  if (!dues.length) return null;
  const names = dues.slice(0, 2).map((it) => short(safeTitle(it.title)));
  return lockSafe(`${names.join(", ")} due${dues.length > 2 ? `, ${dues.length - 2} more` : ""}`, 80);
}

/** The widget's line for a bill due today: "Electricity due today" (32), never its amount. */
export function dueWidget(items: DayItem[], today: string): string | null {
  if (!planOn("capture")) return null;
  const due = items.find((it) => it.ref === "task" && it.kind === "due" && !it.done && it.day === today);
  return due ? lockSafe(`${short(safeTitle(due.title))} due today`, 32) : null;
}

// ------------------------------------------------------------------ the reminder

export interface DueTask {
  id: string; title: string; due_day: string | null; due_ms: number | null; tz_min: number; done: boolean;
  payee?: string | null; pay_link?: string | null; amount_paise?: number | null;
}

/** 6 pm on the due day: the second time a bill not yet paid comes back by itself. */
export const dueAgainAt = (t: Pick<DueTask, "due_day" | "tz_min">, at: number): number | null => {
  if (!t.due_day) return null;
  const six = Date.parse(`${t.due_day}T18:00:00Z`) - t.tz_min * MIN;
  return at < six - 30 * MIN ? six : null;
};

/**
 * The push for a bill on its day: "Electricity due today" / "BESCOM", [Pay] [Paid] with a safe link, else [Paid] alone. The tap and Pay
 * open the hand-off screen, which opens the pay link (a button can't open another app by itself).
 */
export function dueReminder(t: DueTask, today: string, at: number): { kind: "plan_due"; key: string; vars: Record<string, string>; data: Record<string, string>; category: string } {
  const title = safeTitle(t.title);
  const payee = t.payee && !looksHealth(t.payee) && !looksHealth(t.title) ? lockSafe(t.payee, 60) : "";
  const day = t.due_day ?? today;
  return {
    kind: "plan_due", key: `due:${t.id}:${at}`,
    vars: { title: lockSafe(`${short(title)} ${day === today ? "due today" : "due"}`, 80), body: payee || "Tap to see it" },
    data: { day, task: t.id, item: `pt:${t.id}`, ...(t.pay_link ? { go: "pay" } : {}) },
    category: t.pay_link ? "x0_due" : "x0_paid",
  };
}

// ------------------------------------------------------------------ the box

/** A bill said in words: a word for one, and a day. */
const BILL = /\b(?:due|bill|rent|emi|fees?|recharge|premium|electricity|water|gas|broadband|wifi|maintenance|subscription|insurance|credit card|loan|pay|paying|bharna|bhugtan)\b/i;
const MONTHLY = /\b(?:every month|each month|monthly|per month|a month|har mahine|har mahina)\b/i;

/** A weekday beside a written date ("Sat 14 Nov") is the date's: the weekday is taken out so the date decides. */
export function dateFirst(line: string): string {
  return /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b\d{1,2}[/.-]\d{1,2}\b(?!\s?(?:k|lakhs?|lacs?|cr|crores?)\b)/i.test(line)
    ? line.replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|rsday|urday)?\b,?\s*/gi, "").replace(/\s{2,}/g, " ").trim()
    : line;
}

/**
 * A bill's bare number ("Electricity 2140 due 14th", "Rent 25k", "2,140"): not a day ("14th"), a time ("5 pm", "9:30") or a year.
 * A money size counts ("25k" is ₹25,000, not ₹25), and a grouped number is read whole ("2,140" is not 140).
 */
export function bareAmount(s: string): number | null {
  const re = /(?<![\d/:.,-])(\d{1,3}(?:,\d{2,3})+|\d{1,7})(\.\d{1,2})?(?:\s?(k|lakhs?|lacs?|cr|crores?)\b)?(?![\d/:,]|\s*(?:st|nd|rd|th|am|pm|a\.m|p\.m|hrs?|min)\b)/gi;
  for (const m of s.matchAll(re)) {
    const n = Number(`${m[1]!.replace(/,/g, "")}${m[2] ?? ""}`);
    const size = m[3] ? MULT[m[3].toLowerCase().replace(/s$/, "")] ?? 1 : 1;
    if (size > 1) { if (n > 0 && n * size <= 100_000_000) return Math.round(n * size * 100); continue; }
    if (n >= 10 && !(n >= 1900 && n <= 2100 && Number.isInteger(n))) return Math.round(n * 100);
  }
  return null;
}

/** "Electricity 2140 due 14th", "Pay rent by the 5th every month": what a due needs, or null when it isn't one. */
export function readDue(words: string, now: number, tz: number): { title: string; day: string; amountPaise: number | null; repeat: "" | "monthly" } | null {
  const s = words.replace(/\s+/g, " ").trim();
  if (!s || s.length > 200 || !BILL.test(s) || /\?\s*$/.test(s)) return null;
  const amount = amountOf(s) ?? bareAmount(s);
  const repeat = MONTHLY.test(s) ? "monthly" as const : "" as const;
  // The day: "14th", "the 5th", "by Friday", "on 20/11". "every month" is taken out first: its "mon" is not a Monday.
  const plain = dateFirst(s.replace(MONTHLY, " ").replace(/\s+/g, " ").trim());
  const today = dayKey(now, tz);
  const ord = /\b(?:on |by |before )?(?:the )?(\d{1,2})(?:st|nd|rd|th)\b/i.exec(plain);
  let day: string | null = ord ? dayFrom(`${ord[1]}th`, today) : null;
  if (!day) { const r = readLine(plain, now, tz, { place: false }); day = r.daySaid && r.day ? r.day : null; }
  if (!day) return null;
  if (!amount && !/\b(?:due|bill|rent|emi|fees?|pay)\b/i.test(s)) return null;
  // The calendar's own reader takes out the day words ("today", "by Friday"); the rest of the filler goes here.
  const title = cleanTitle(readLine(plain, now, tz, { place: false }).title || plain);
  return title ? { title, day, amountPaise: amount, repeat } : null;
}

/** A bill's name from its words: the amount, the day and the filler taken out ("Pay rent by the 5th" is "Rent"). */
export function cleanTitle(words: string): string {
  const t = words
    .replace(/(?:₹|\bRs\.?|\bINR)\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K|lakh|lac|cr|crore)?/g, " ")
    .replace(/\b\d[\d,]*(?:\.\d+)?\s?(?:rupees|rupaye|rs|INR)\b/gi, " ")
    .replace(/\b\d[\d,]*\/-/g, " ")
    .replace(/\b(?:on |by |before )?(?:the )?\d{1,2}(?:st|nd|rd|th)\b/gi, " ")
    .replace(/\b(?:by|on|before)\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*\b/gi, " ")
    .replace(/\b(?:by|on|before)\s+\d{1,2}[/-]\d{1,2}\b/gi, " ")
    .replace(/^\s*(?:pay|paying|bharna)\s+(?:the\s+)?/i, " ")
    .replace(/\b(?:is |are )?due\b/gi, " ")
    // What is left of a bill's numbers is its amount, said bare: "School fee 50", "Rent 25k", "Electricity bill 2,140".
    .replace(/\b\d[\d,]*(?:\.\d+)?\s?(?:k|lakhs?|lacs?|cr|crores?)\b/gi, " ")
    .replace(/\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\b|\b\d{2,}(?:\.\d+)?\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .trim();
  const one = t.slice(0, 80);
  return one ? one.charAt(0).toUpperCase() + one.slice(1) : "";
}

/** What the box needs to add a due (planCapture.ts's addDue, wired by the routes). */
export type AddDue = (userId: string, d: { title: string; day: string; amountPaise: number | null; repeat: "" | "monthly"; tz: number }) => Promise<{ id: string; monthly: boolean }>;
let addDueFn: AddDue | null = null;
export function setAddDue(fn: AddDue | null): void { addDueFn = fn; }

/** The box's due slot: before a plain item reads "Pay rent by Friday" as a to-do, it is a bill with its day (and each month, said so). */
export const DUE_SLOT: BoxSlot<{ title: string; day: string; amountPaise: number | null; repeat: "" | "monthly" }> = {
  slot: "due", step: 3,
  read(words, ctx) {
    if (!planOn("capture") || !addDueFn) return null;
    return readDue(words, ctx.now, ctx.tz);
  },
  async run(r, _w, ctx) {
    let made: { id: string; monthly: boolean };
    try {
      made = await addDueFn!(ctx.userId, { ...r, tz: ctx.tz });
    } catch {
      // A bill can't be kept as one here (a database before migration 0072): it is still added, as a plain to-do on its day.
      const t = await ctx.calendar.addTask(ctx.userId, { title: r.title, day: r.day, time: "", tz: ctx.tz });
      return { slot: "due", kind: "added", line: `Added: ${t.title}, ${ctx.dayWords(r.day)}`, undo: { item: `pt:${t.id}`, action: "undo" } };
    }
    const dayN = Number(r.day.slice(8, 10));
    const nth = `${dayN}${dayN % 10 === 1 && dayN !== 11 ? "st" : dayN % 10 === 2 && dayN !== 12 ? "nd" : dayN % 10 === 3 && dayN !== 13 ? "rd" : "th"}`;
    const when = made.monthly ? `due the ${nth} each month` : `due ${ctx.dayName(r.day) === "Today" || ctx.dayName(r.day) === "Tomorrow" ? ctx.dayName(r.day).toLowerCase() : ctx.dayWords(r.day)}`;
    return { slot: "due", kind: "added", line: `Added: ${r.title}, ${when}`, undo: { item: `pt:${made.id}`, action: "undo" } };
  },
};
