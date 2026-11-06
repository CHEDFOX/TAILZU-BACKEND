/**
 * WHAT ELSE IS ON THE PERSON'S DAYS, BESIDES THEIR OWN CALENDAR (docs/plan-ease.md "Sources"). Plan Ease reads the person's own events and
 * to-dos (src/calendar); a source adds what lives somewhere else, and everything that reads the days sees it with no plumbing of its own:
 * the page and its one next thing, the Needs-you cards (a work meeting is busy time a Move must keep clear of, and is never moved itself),
 * the clash lines, the day notes, the widget's line and the Plan Ease chat's list of the person's days.
 *
 *   addPlanSource(s)                  a source, once at start (planLinks.ts: the work calendar by its link)
 *   sourceItems(user, window)          every source's items in the window, as DayItems
 *   sourceMore(user, window)           what each source's Needs-you cards read (NeedsCtx.more[source name])
 *   sourceEvening(user, window)        lines for the next evening note that would otherwise need a push of their own
 *   sourceMorning(user, window)        the same, for the morning note
 *   beforeNote(user)                   a source brings itself up to date before a note is written (the work calendar read again)
 *   sourceSeen(user, tz)               the Plan page was opened (the work calendar is read when stale, within the page's wait)
 *   sourceLines(user, window)          the chat's list (calendar/bots.ts list_events): one line each, the words a bot reads back
 *
 * A source that fails gives nothing: the person's own days never wait on it or break with it. Kept free of runtime imports, so the
 * calendar's bot tools and Plan Ease can both read it without a cycle.
 */
import type { DayItem } from "./planRows.js";

export interface SourceWindow {
  fromMs: number; toMs: number; from: string; to: string; tz: number; now: number;
  /** For the evening note: the item its one question is about (a capture's "pc:<id>"), so a source never says it a second time. */
  asked?: string;
}

export interface PlanSource {
  name: string;
  items?(userId: string, w: SourceWindow): Promise<DayItem[]>;
  more?(userId: string, w: SourceWindow): Promise<unknown>;
  evening?(userId: string, w: SourceWindow): Promise<string[]>;
  morning?(userId: string, w: SourceWindow): Promise<string[]>;
  beforeNote?(userId: string): Promise<void>;
  seen?(userId: string, tz: number, now: number): Promise<void>;
  lines?(userId: string, w: SourceWindow): Promise<string[]>;
}

const sources: PlanSource[] = [];

/** A source, by its name: a second one of the same name takes its place (a test, a server made again). */
export function addPlanSource(s: PlanSource): void {
  const i = sources.findIndex((x) => x.name === s.name);
  if (i >= 0) sources[i] = s; else sources.push(s);
}
export function removePlanSource(name: string): void {
  const i = sources.findIndex((x) => x.name === name);
  if (i >= 0) sources.splice(i, 1);
}

/** Never longer than this for one source: the page waits 1.2 s at most for anything outside it. */
const WAIT_MS = 1200;

async function each<T>(fn: (s: PlanSource) => Promise<T> | undefined, waitMs = WAIT_MS): Promise<Array<{ name: string; v: T }>> {
  const out = await Promise.all(sources.map(async (s) => {
    const p = fn(s);
    if (!p) return null;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((res) => { timer = setTimeout(() => res(null), waitMs); timer.unref?.(); });
    try {
      const v = await Promise.race([p.catch(() => null), late]);
      return v === null || v === undefined ? null : { name: s.name, v: v as T };
    } finally { if (timer) clearTimeout(timer); }
  }));
  return out.filter((x): x is { name: string; v: T } => !!x);
}

export async function sourceItems(userId: string, w: SourceWindow): Promise<DayItem[]> {
  return (await each((s) => s.items?.(userId, w))).flatMap((x) => x.v);
}

export async function sourceMore(userId: string, w: SourceWindow): Promise<Record<string, unknown>> {
  return Object.fromEntries((await each((s) => s.more?.(userId, w))).map((x) => [x.name, x.v]));
}

export async function sourceEvening(userId: string, w: SourceWindow): Promise<string[]> {
  return (await each((s) => s.evening?.(userId, w))).flatMap((x) => x.v).slice(0, 2);
}

export async function sourceMorning(userId: string, w: SourceWindow): Promise<string[]> {
  return (await each((s) => s.morning?.(userId, w))).flatMap((x) => x.v).slice(0, 1);
}

/** Up to 8 s, for a note that goes in the background: the work calendar read once more before tomorrow is written down. */
export async function beforeNote(userId: string): Promise<void> {
  await each((s) => s.beforeNote?.(userId).then(() => true), 8000);
}

/** The Plan page was opened: each source may bring itself up to date (1.2 s at most, the page's own wait). */
export async function sourceSeen(userId: string, tz: number, now: number): Promise<void> {
  await each((s) => s.seen?.(userId, tz, now).then(() => true));
}

export async function sourceLines(userId: string, w: SourceWindow): Promise<string[]> {
  return (await each((s) => s.lines?.(userId, w), 4000)).flatMap((x) => x.v);
}
