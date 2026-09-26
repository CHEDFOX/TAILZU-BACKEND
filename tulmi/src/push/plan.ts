/**
 * WHETHER, WHY AND WHEN — one person, right now.
 *
 * Pure: everything it knows arrives in `Facts`, everything it may do is in the
 * knobs, and the answer is either one push (its reason, its moment, its words)
 * or the reason there is none. The engine asks again every hour, so a skip is
 * never final; a person who dictates at 18:40 simply stops qualifying for the
 * 19:00 streak nudge.
 *
 * The reasons, in the default order:
 *   streak   — a streak of two days or more that ends today unless they write
 *   refill   — a free account that ran out last month, in the first days of
 *              the new one, before it has been used
 *   weekly   — once a week, on their busiest weekday: what they wrote
 *   winback  — gone three days to a month; weekly at most, and never more
 *              than three unanswered in a row
 *   lowWords — a free account near the end of its month's words (off)
 */
import { computeAllowance } from "../usage/allowance.js";
import type { PushPayload, PushKind } from "./defaults.js";
import { PUSH_KINDS } from "./defaults.js";
import { busiestWeekday, pickTime, rhythm, type Moment, type Rhythm, type TimingKnobs } from "./timing.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface LogEntry {
  id?: string;
  kind: string;
  periodKey: string;
  status: string;
  sentAt: number | null;
  openedAt: number | null;
}

export interface Facts {
  userId: string;
  now: number;
  /** Dictations since the start of last month at least, newest or oldest first. */
  moments: Moment[];
  lastSeenAt: number | null;
  createdAt: number | null;
  /** Minutes east of UTC, as the app last reported it; null when never. */
  tzOffsetMin: number | null;
  entitled: boolean;
  /** This person's recent pushes. */
  log: LogEntry[];
}

export type Decision =
  | {
      kind: PushKind;
      periodKey: string;
      sendAt: number;
      basis: "rhythm" | "fallback" | "seen";
      title: string;
      body: string;
      screenId: string;
      ttlSec: number;
    }
  | { skip: string };

/** Typed reads over the payload the control plane produced. */
export interface Knobs {
  flag<T extends number | boolean | string | string[]>(key: string, fallback: T): T;
  label(key: string, fallback: string, vars?: Record<string, string | number>): string;
}

export function knobsOf(p: PushPayload): Knobs {
  return {
    flag<T extends number | boolean | string | string[]>(key: string, fallback: T): T {
      const v = p.flags?.[key];
      if (Array.isArray(fallback)) {
        return (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : fallback) as T;
      }
      if (typeof fallback === "number") return (typeof v === "number" && Number.isFinite(v) ? v : fallback) as T;
      return (typeof v === typeof fallback ? v : fallback) as T;
    },
    label(key, fallback, vars) {
      const v = p.labels?.[key];
      const s = typeof v === "string" ? v : fallback;
      return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
    },
  };
}

export function timingKnobs(k: Knobs): TimingKnobs {
  return {
    halfLifeDays: k.flag("push.smart.halfLifeDays", 14),
    dayBlend: k.flag("push.smart.dayBlend", 0.35),
    minEvents: k.flag("push.smart.minEvents", 5),
    minDays: k.flag("push.smart.minDays", 3),
    leadMin: k.flag("push.smart.leadMin", 10),
    jitterMin: k.flag("push.smart.jitterMin", 8),
    quietStartHour: k.flag("push.smart.quietStartHour", 22),
    quietEndHour: k.flag("push.smart.quietEndHour", 8),
    fallbackLocalHour: k.flag("push.smart.fallbackLocalHour", 19),
  };
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const utcDayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
const monthStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const lastMonthStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1); };
/** Monday-based week number since the epoch (1970-01-01 was a Thursday). */
const weekKey = (ms: number) => `w${Math.floor((Math.floor(ms / DAY) + 3) / 7)}`;

/** Pushes that went out and were answered by neither a tap nor a dictation within a day. */
function cold(e: LogEntry, moments: readonly Moment[]): boolean {
  if (e.sentAt === null) return false;
  if (e.openedAt !== null) return false;
  const until = e.sentAt + DAY;
  return !moments.some((m) => m.at >= e.sentAt! && m.at <= until);
}

export function plan(f: Facts, k: Knobs): Decision {
  const now = f.now;
  if (!k.flag("push.smart.enabled", true)) return { skip: "off" };
  if (f.createdAt !== null && now - f.createdAt < k.flag("push.smart.minAccountHours", 24) * HOUR) {
    return { skip: "new account" };
  }

  const sent = f.log
    .filter((e) => e.sentAt !== null && e.status === "sent")
    .sort((a, b) => (b.sentAt! - a.sentAt!));
  if (sent.filter((e) => now - e.sentAt! < DAY).length >= k.flag("push.smart.maxPerDay", 1)) return { skip: "daily cap" };
  if (sent.filter((e) => now - e.sentAt! < 7 * DAY).length >= k.flag("push.smart.maxPerWeek", 3)) return { skip: "weekly cap" };

  const moments = f.moments.filter((m) => Number.isFinite(m.at) && m.at <= now).sort((a, b) => a.at - b.at);
  const lastMoment = moments.length ? moments[moments.length - 1].at : null;
  const lastActive = Math.max(lastMoment ?? -Infinity, f.lastSeenAt ?? -Infinity);

  let earliest = now;
  if (sent.length) earliest = Math.max(earliest, sent[0].sentAt! + k.flag("push.smart.minGapHours", 20) * HOUR);
  if (Number.isFinite(lastActive)) earliest = Math.max(earliest, lastActive + k.flag("push.smart.recentUseHours", 6) * HOUR);

  // Fatigue: judged only on pushes old enough to have been answered.
  const ignoreLimit = k.flag("push.smart.ignoreLimit", 3);
  const judged = sent.filter((e) => now - e.sentAt! >= DAY).slice(0, ignoreLimit);
  if (ignoreLimit > 0 && judged.length >= ignoreLimit && judged.every((e) => cold(e, moments))) {
    earliest = Math.max(earliest, judged[0].sentAt! + k.flag("push.smart.pauseDays", 14) * DAY);
  }

  const lookback = k.flag("push.smart.lookbackDays", 42) * DAY;
  const r: Rhythm = rhythm(moments.filter((m) => now - m.at <= lookback), now, k.flag("push.smart.halfLifeDays", 14));
  const tk = timingKnobs(k);
  const done = new Set(f.log.map((e) => e.periodKey));
  const today = dayKey(now);
  const dayEnd = utcDayStart(now) + DAY;
  const thisMonth = moments.filter((m) => m.at >= monthStart(now));

  const time = (from: number, to: number) => pickTime({
    rhythm: r, from, to, tzOffsetMin: f.tzOffsetMin, lastSeenAt: f.lastSeenAt, seed: f.userId, knobs: tk,
  });

  const priority = k.flag("push.smart.priority", [...PUSH_KINDS] as string[])
    .filter((x): x is PushKind => (PUSH_KINDS as readonly string[]).includes(x));
  const reasons: string[] = [];

  for (const kind of priority) {
    if (!k.flag(`push.${kind}.enabled`, kind !== "lowWords")) continue;
    let periodKey = "", from = earliest, to = earliest + DAY;
    let vars: Record<string, string | number> = {};

    if (kind === "streak") {
      const allowance = computeAllowance(thisMonth, now, f.userId);
      const wroteToday = lastMoment !== null && lastMoment >= utcDayStart(now);
      if (wroteToday || allowance.streakDays < k.flag("push.streak.minDays", 2)) continue;
      periodKey = `streak:${today}`;
      to = dayEnd - k.flag("push.streak.cutoffMin", 60) * MIN;
      vars = { n: allowance.streakDays + 1 };
    } else if (kind === "refill") {
      if (f.entitled) continue;
      if (new Date(now).getUTCDate() > k.flag("push.refill.days", 3)) continue;
      if (thisMonth.length) continue;
      const prev = moments.filter((m) => m.at >= lastMonthStart(now) && m.at < monthStart(now));
      if (!prev.length) continue;
      const last = computeAllowance(prev, monthStart(now) - 1, f.userId);
      if (last.remaining > 0) continue;
      periodKey = `refill:${monthKey(now)}`;
    } else if (kind === "weekly") {
      if (!confidentEnough(r, tk)) continue;
      if (new Date(now).getUTCDay() !== busiestWeekday(r)) continue;
      const words = moments.filter((m) => now - m.at < 7 * DAY).reduce((n, m) => n + (m.words || 0), 0);
      if (words < k.flag("push.weekly.minWords", 200)) continue;
      periodKey = `weekly:${weekKey(now)}`;
      to = dayEnd;
      vars = { words: words.toLocaleString("en-US") };
    } else if (kind === "winback") {
      if (!Number.isFinite(lastActive)) continue;
      const away = (now - lastActive) / DAY;
      if (away < k.flag("push.winback.afterDays", 3) || away > k.flag("push.winback.maxDays", 30)) continue;
      const winbacks = sent.filter((e) => e.kind === "winback");
      if (winbacks.length && now - winbacks[0].sentAt! < k.flag("push.winback.everyDays", 7) * DAY) continue;
      const unanswered = winbacks.filter((e) => e.sentAt! > lastActive && e.openedAt === null).length;
      if (unanswered >= k.flag("push.winback.maxUnanswered", 3)) continue;
      periodKey = `winback:${today}`;
    } else if (kind === "lowWords") {
      if (f.entitled) continue;
      const a = computeAllowance(thisMonth, now, f.userId);
      if (!(a.total > 0) || a.remaining <= 0 || a.remaining / a.total > k.flag("push.lowWords.fraction", 0.1)) continue;
      periodKey = `lowWords:${monthKey(now)}`;
      vars = { n: a.remaining.toLocaleString("en-US") };
    }

    if (done.has(periodKey)) { reasons.push(`${kind}: sent`); continue; }
    if (!(to > from)) { reasons.push(`${kind}: no time left`); continue; }
    const t = time(from, to);
    if (!t) { reasons.push(`${kind}: no allowed hour`); continue; }
    return {
      kind,
      periodKey,
      sendAt: t.sendAt,
      basis: t.basis,
      title: k.label(`push.${kind}.title`, "", vars),
      body: k.label(`push.${kind}.body`, "", vars),
      screenId: k.flag(`push.${kind}.screenId`, kind === "lowWords" ? "paywall" : kind === "streak" || kind === "weekly" ? "stats" : "home"),
      ttlSec: Math.max(60, Math.round(k.flag("push.smart.ttlMin", 180) * 60)),
    };
  }
  return { skip: reasons.length ? reasons.join("; ") : "nothing to say" };
}

function confidentEnough(r: Rhythm, k: TimingKnobs): boolean {
  return r.events >= k.minEvents && r.days >= k.minDays;
}
