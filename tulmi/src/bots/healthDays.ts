/**
 * A FITNESS BOT'S DAILY STEPS AND WORKOUTS (migration 0090_bot_health_days.sql; docs: perms §4).
 *
 *   healthDays().put(userId, botId, days)     stores or replaces those days
 *   healthDays().list(userId, botId, limit)   the newest days first
 *   healthDays().dropBot(userId, botId)       every row for one bot: the switch going off, in the same request
 *   healthDays().dropUser(userId)             every row of one person: Delete my data
 *   healthDays().sweep(before)                rows for days before `before` (a day key), across everyone: the 31-day sweeper
 *
 * WHAT MAY IMPORT THIS FILE is fixed, and `tests/health-never.test.ts` fails if anything else does: the route that stores the
 * days, the bot's edit page and its page's Moves line, the sweeper, the export and Delete my data (both in bots/service.ts and
 * you/data.ts), and this file's own test. So `bots/run.ts`, `bots/memory.ts`, `bots/shared.ts`, the prompts, the tools, the
 * voice kit, the push builders and the widget and Live Activity builders CANNOT reach a health number: no model sees one, no
 * notification carries one, and nothing of it reaches the bot's facts, its rolling summary or the shared facts every bot uses.
 * That is the whole of rule "never sent to an AI service" in this build, held up by the import graph rather than by care.
 *
 * Supabase with the service key when the server has one, else memory (tests, and a server with none), as the other stores do.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** The kinds a workout may be, mapped on the PHONE from Apple Health's and Health Connect's own long lists. */
export const WORKOUT_KINDS = ["run", "walk", "cycle", "strength", "cardio", "swim", "yoga", "sport", "other"] as const;
export type WorkoutKind = (typeof WORKOUT_KINDS)[number];

/** How many days are ever kept, and the most one call may carry. */
export const HEALTH_KEEP_DAYS = 31;
/** The caps the route checks, kept here with the table's own checks so the two cannot drift. */
export const HEALTH_LIMITS = { steps: 200_000, workoutsADay: 8, minutes: { min: 1, max: 600 } } as const;

export interface Workout { kind: WorkoutKind; minutes: number }
/** One local day, as the phone worked it out: "2026-11-12". `updatedAt` is when it last came in (reads only). */
export interface HealthDay { day: string; steps: number; workouts: Workout[]; updatedAt?: number }

export interface HealthDaysStore {
  put(userId: string, botId: string, days: HealthDay[]): Promise<number>;
  list(userId: string, botId: string, limit?: number): Promise<HealthDay[]>;
  dropBot(userId: string, botId: string): Promise<number>;
  dropUser(userId: string): Promise<number>;
  /** Every row whose day is before this day key, across everyone. How many went. */
  sweep(beforeDay: string): Promise<number>;
}

/** A day key as the table holds it, or "" when it is not one. */
export const dayKey = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");

/** The day key `n` days before the one `now` falls in, in UTC: the window the route and the sweeper both measure against. */
export function dayKeyBefore(now: number, n: number): string {
  return new Date(now - n * 86_400_000).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ memory

class MemoryHealthDays implements HealthDaysStore {
  /** key: `${userId}|${botId}|${day}`. */
  private readonly rows = new Map<string, { userId: string; botId: string; day: HealthDay }>();

  async put(userId: string, botId: string, days: HealthDay[]): Promise<number> {
    const at = Date.now();
    for (const d of days) this.rows.set(`${userId}|${botId}|${d.day}`, { userId, botId, day: { ...d, updatedAt: at, workouts: d.workouts.map((w) => ({ ...w })) } });
    return days.length;
  }

  async list(userId: string, botId: string, limit = HEALTH_KEEP_DAYS): Promise<HealthDay[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.botId === botId)
      .map((r) => ({ ...r.day, workouts: r.day.workouts.map((w) => ({ ...w })) }))
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, limit);
  }

  private drop(keep: (r: { userId: string; botId: string; day: HealthDay }) => boolean): number {
    let n = 0;
    for (const [k, r] of [...this.rows]) if (!keep(r)) { this.rows.delete(k); n += 1; }
    return n;
  }

  async dropBot(userId: string, botId: string): Promise<number> { return this.drop((r) => !(r.userId === userId && r.botId === botId)); }
  async dropUser(userId: string): Promise<number> { return this.drop((r) => r.userId !== userId); }
  async sweep(beforeDay: string): Promise<number> { return this.drop((r) => r.day.day >= beforeDay); }
}

// ------------------------------------------------------------------ supabase

const T = "bot_health_days";

class SupabaseHealthDays implements HealthDaysStore {
  constructor(private readonly sb: SupabaseClient) {}

  async put(userId: string, botId: string, days: HealthDay[]): Promise<number> {
    if (!days.length) return 0;
    const at = new Date().toISOString();
    const { error } = await this.sb.from(T).upsert(
      days.map((d) => ({ user_id: userId, bot_id: botId, day: d.day, steps: d.steps, workouts: d.workouts, updated_at: at })),
      { onConflict: "user_id,bot_id,day" },
    );
    if (error) throw new Error(`health days: write: ${error.message}`);
    return days.length;
  }

  async list(userId: string, botId: string, limit = HEALTH_KEEP_DAYS): Promise<HealthDay[]> {
    const { data, error } = await this.sb.from(T).select("day, steps, workouts, updated_at")
      .eq("user_id", userId).eq("bot_id", botId).order("day", { ascending: false }).limit(limit);
    if (error) throw new Error(`health days: read: ${error.message}`);
    return (data ?? []).map((r) => ({
      day: String((r as { day: unknown }).day).slice(0, 10),
      steps: Number((r as { steps: unknown }).steps) || 0,
      workouts: Array.isArray((r as { workouts: unknown }).workouts) ? ((r as { workouts: Workout[] }).workouts) : [],
      updatedAt: Date.parse(String((r as { updated_at?: unknown }).updated_at ?? "")) || 0,
    }));
  }

  private async remove(q: (b: ReturnType<SupabaseClient["from"]>) => unknown): Promise<number> {
    const b = this.sb.from(T).delete({ count: "exact" }) as unknown as ReturnType<SupabaseClient["from"]>;
    const { error, count } = (await q(b)) as { error: { message: string } | null; count: number | null };
    if (error) throw new Error(`health days: delete: ${error.message}`);
    return count ?? 0;
  }

  async dropBot(userId: string, botId: string): Promise<number> {
    return this.remove((b) => (b as unknown as { eq: (c: string, v: string) => { eq: (c: string, v: string) => unknown } }).eq("user_id", userId).eq("bot_id", botId));
  }

  async dropUser(userId: string): Promise<number> {
    return this.remove((b) => (b as unknown as { eq: (c: string, v: string) => unknown }).eq("user_id", userId));
  }

  async sweep(beforeDay: string): Promise<number> {
    return this.remove((b) => (b as unknown as { lt: (c: string, v: string) => unknown }).lt("day", beforeDay));
  }
}

let made: HealthDaysStore | undefined;

/** The store: Supabase with the service key, else memory. */
export function healthDays(): HealthDaysStore {
  if (!made) {
    const sb = supabase();
    made = sb ? new SupabaseHealthDays(sb) : new MemoryHealthDays();
  }
  return made;
}

/** Tests: a fresh store. */
export function resetHealthDaysForTests(store?: HealthDaysStore): void { made = store ?? new MemoryHealthDays(); }

/**
 * WHAT THE PHONE SENT, CHECKED (docs: perms §4.5). Anything outside the bounds is refused, not trimmed: a number out of range
 * is a bug on the phone, and quietly storing a wrong one would be worse than saying so.
 *
 * `now` is only for the window: a day must be one of the last 31, so an old or future day cannot be slipped in.
 */
export function readHealthDays(body: unknown, now = Date.now()): HealthDay[] {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { days?: unknown };
  if (!Array.isArray(b.days)) throw new Error("days is the list of days the phone counted.");
  if (b.days.length > HEALTH_KEEP_DAYS) throw new Error(`days is ${HEALTH_KEEP_DAYS} days at most.`);
  const oldest = dayKeyBefore(now, HEALTH_KEEP_DAYS);
  const newest = dayKeyBefore(now, -1);
  const out: HealthDay[] = [];
  const seen = new Set<string>();
  for (const raw of b.days) {
    const d = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as { day?: unknown; steps?: unknown; workouts?: unknown };
    const day = dayKey(d.day);
    if (!day) throw new Error("each day is a date like 2026-11-12.");
    if (day < oldest || day > newest) throw new Error(`each day is one of the last ${HEALTH_KEEP_DAYS}.`);
    if (seen.has(day)) throw new Error("a day is sent once.");
    seen.add(day);
    const steps = Number(d.steps ?? 0);
    if (!Number.isInteger(steps) || steps < 0 || steps > HEALTH_LIMITS.steps) throw new Error(`steps is a whole number from 0 to ${HEALTH_LIMITS.steps}.`);
    const list = d.workouts === undefined ? [] : d.workouts;
    if (!Array.isArray(list)) throw new Error("workouts is a list.");
    if (list.length > HEALTH_LIMITS.workoutsADay) throw new Error(`a day has ${HEALTH_LIMITS.workoutsADay} workouts at most.`);
    const workouts: Workout[] = [];
    for (const w of list) {
      const o = (w && typeof w === "object" && !Array.isArray(w) ? w : {}) as { kind?: unknown; minutes?: unknown };
      if (!(WORKOUT_KINDS as readonly string[]).includes(String(o.kind))) throw new Error(`a workout's kind is one of ${WORKOUT_KINDS.join(", ")}.`);
      const minutes = Number(o.minutes);
      if (!Number.isInteger(minutes) || minutes < HEALTH_LIMITS.minutes.min || minutes > HEALTH_LIMITS.minutes.max) {
        throw new Error(`a workout is ${HEALTH_LIMITS.minutes.min} to ${HEALTH_LIMITS.minutes.max} minutes.`);
      }
      workouts.push({ kind: o.kind as WorkoutKind, minutes });
    }
    out.push({ day, steps, workouts });
  }
  return out;
}

// ------------------------------------------------------------------ the 31-day sweeper

/** How often the sweeper looks. A day's rows are a day late at worst, which the 31 days already allow for. */
const SWEEP_EVERY_MS = 6 * 3600_000;

/** One pass: every row older than 31 days, across everyone. How many went. */
export async function sweepHealthDays(now: number, store: HealthDaysStore = healthDays()): Promise<number> {
  return store.sweep(dayKeyBefore(now, HEALTH_KEEP_DAYS));
}

/**
 * A pass at once, then one every `everyMs`, never two at the same time. Returns the way to stop.
 *
 * The 31 days are a promise on the card, in the policy and on Play's form, so they are kept by something that runs whether or
 * not anyone opens the app: a person who stops using a fitness bot still has their last month swept away behind them.
 */
export function startHealthSweeper(o: {
  store?: HealthDaysStore;
  everyMs?: number;
  now?: () => number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
} = {}): () => void {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const days = await sweepHealthDays((o.now ?? Date.now)(), o.store ?? healthDays());
      if (days) o.log?.info({ days }, "health days older than 31 days deleted");
    } catch (err) {
      o.log?.warn({ error: (err as Error)?.name }, "health day sweep failed");
    } finally {
      busy = false;
    }
  };
  void run();
  const every = setInterval(run, o.everyMs ?? SWEEP_EVERY_MS);
  every.unref?.();
  return () => clearInterval(every);
}

// ------------------------------------------------------------------ the Moves line

/**
 * WHAT THE BOT'S PAGE SAYS, worked out here and not on the phone: "9 workouts this month · last Tuesday, 48 min · as of
 * today 9:40". Numbers only — the screen puts them into words in the person's own clock (docs: perms §4.3).
 *
 * `asOf` is when the days last came in, NOT now: there is no background delivery, so the numbers are as of the last time the
 * person opened this bot, and the line has to say so rather than look live.
 */
export interface Moves {
  /** Workouts over the days kept. */
  workouts: number;
  /** The day of the last workout, as the phone's own day key ("2026-11-10"); null when there is none. */
  lastDay: string | null;
  /** How long that last workout was. */
  lastMinutes: number;
  /** Steps over the days kept, and the days that carry one. */
  steps: number;
  stepDays: number;
  /** When the days last came in (ms), or 0. */
  asOf: number;
}

export function movesOf(days: HealthDay[]): Moves {
  const out: Moves = { workouts: 0, lastDay: null, lastMinutes: 0, steps: 0, stepDays: 0, asOf: 0 };
  for (const d of [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    out.workouts += d.workouts.length;
    out.steps += d.steps;
    if (d.steps > 0) out.stepDays += 1;
    if (d.workouts.length) {
      // THE DAY KEY ITSELF, not a timestamp. The key is already the local day the phone worked out, and a timestamp made
      // from it is read back through the reader's own offset, which lands on the day before (or after) at every offset
      // but zero. The screen names this key directly.
      out.lastDay = d.day;
      out.lastMinutes = d.workouts.reduce((n, w) => Math.max(n, w.minutes), 0);
    }
    out.asOf = Math.max(out.asOf, d.updatedAt ?? 0);
  }
  return out;
}
