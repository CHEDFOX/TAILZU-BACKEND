/**
 * WHAT THE BOTS COST THIS MONTH, FROM THE REAL RECORDS: Xode's jobs (code_jobs.spent_paise, the brain's gateway adds to it after every model
 * call) and every other bot's answers (you_spend: one row per answer, written when the answer comes back, see limits.ts). Pure: the route reads the
 * records, this adds them up in the person's own days.
 *
 * A job counts in the month and on the day it was last worked on (as live.ts counts it for the tab ring), whole: its spend is one number, not a
 * ledger of when each paisa went.
 */
import { weekAndMonthStart } from "../experience/bots/live.js";
import type { SpendRow } from "./store.js";

export interface JobSpend { id: string; task: string; state: string; spentPaise: number; createdAt: number; updatedAt: number }

export interface SpendReport {
  /** "2026-10", in the person's own calendar. */
  month: string;
  monthStart: number;
  /** The next month's first moment: when the count starts again. */
  resetsAt: number;
  daysInMonth: number;
  /** Today's day of the month, 1-based. */
  today: number;
  monthPaise: number;
  limitPaise: number;
  leftPaise: number;
  stopAtLimit: boolean;
  /** What a day has cost on average so far. */
  perDayPaise: number;
  /** At this pace, the month's end. */
  projectionPaise: number;
  byBot: Array<{ bot: string; paise: number }>;
  /** Paise per day of the month, index 0 the 1st. Days to come are 0. */
  byDay: number[];
  busiest: { day: number; paise: number } | null;
  biggest: Array<{ id: string; task: string; paise: number; at: number; minutes: number }>;
}

const DAY = 86_400_000;

export function spendReport(i: { jobs: JobSpend[]; rows: SpendRow[]; limitPaise: number; stopAtLimit: boolean; now: number; tzOffsetMinutes: number }): SpendReport {
  const tz = i.tzOffsetMinutes;
  const { month: monthStart } = weekAndMonthStart(i.now, tz);
  const local = new Date(i.now + tz * 60_000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth();
  const resetsAt = Date.UTC(y, m + 1, 1) - tz * 60_000;
  const daysInMonth = Math.round((resetsAt - monthStart) / DAY);
  const today = local.getUTCDate();
  const dayOf = (t: number) => Math.min(daysInMonth - 1, Math.max(0, Math.floor((t - monthStart) / DAY)));

  const byDay = Array.from({ length: daysInMonth }, () => 0);
  const bots = new Map<string, number>();
  const add = (bot: string, paise: number, at: number) => {
    if (!(paise > 0) || at < monthStart || at >= resetsAt) return;
    bots.set(bot, (bots.get(bot) ?? 0) + paise);
    byDay[dayOf(at)]! += paise;
  };
  const jobs = i.jobs.filter((j) => j.updatedAt >= monthStart && j.updatedAt < resetsAt && j.spentPaise > 0);
  for (const j of jobs) add("code", Math.round(j.spentPaise), j.updatedAt);
  for (const r of i.rows) add(r.bot, Math.round(r.paise), r.at);

  const monthPaise = byDay.reduce((a, b) => a + b, 0);
  const perDayPaise = Math.round(monthPaise / Math.max(1, today));
  let busiest: SpendReport["busiest"] = null;
  byDay.forEach((p, d) => { if (p > 0 && (!busiest || p > busiest.paise)) busiest = { day: d + 1, paise: p }; });
  return {
    month: `${y}-${String(m + 1).padStart(2, "0")}`, monthStart, resetsAt, daysInMonth, today,
    monthPaise, limitPaise: i.limitPaise, leftPaise: Math.max(0, i.limitPaise - monthPaise), stopAtLimit: i.stopAtLimit,
    perDayPaise, projectionPaise: perDayPaise * daysInMonth,
    byBot: [...bots].map(([bot, paise]) => ({ bot, paise })).sort((a, b) => b.paise - a.paise || a.bot.localeCompare(b.bot)),
    byDay, busiest,
    biggest: [...jobs].sort((a, b) => b.spentPaise - a.spentPaise).slice(0, 5).map((j) => ({
      id: j.id, task: j.task.split("\n")[0]!.slice(0, 120), paise: j.spentPaise, at: j.updatedAt, minutes: Math.max(1, Math.round((j.updatedAt - j.createdAt) / 60_000)),
    })),
  };
}
