/**
 * WHAT A BOT'S API KEYS USED: requests and paise per key per day, for the keys page ("1,284 requests in October · ₹38.50").
 *
 *   record(owner, slug, masked, paise)   one answered request on a key (the route's onSend hook in routes/botsBots.ts writes it)
 *   month(owner, slug, now, tz)          this month: the totals, each key's, and each day's
 *
 * A key is told apart by its masked prefix (what GET /v1/bots/:slug/keys shows), never by the key. Counted after the answer went out;
 * a count that fails to write is lost, never the answer.
 */
import { table, type Table } from "./rows.js";

export interface UsageRow {
  [k: string]: unknown;
  user_id: string;
  slug: string;
  masked: string;
  /** YYYY-MM-DD in the owner's day (IST, the app's home zone, when the request comes from an app). */
  day: string;
  requests: number;
  paise: number;
  last_ms: number;
}

export interface MonthUsage {
  month: string;
  requests: number;
  paise: number;
  byKey: Record<string, { requests: number; paise: number; lastAt: number }>;
  days: Array<{ day: string; requests: number }>;
}

/** The app's home zone: a request from someone's app has no zone of its own. */
export const HOME_OFFSET_MIN = 330;

export const dayKey = (ms: number, offsetMin: number): string => new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export class KeyUsage {
  constructor(private readonly now: () => number = Date.now, private readonly rows: Table<UsageRow> = table<UsageRow>("bot_key_usage")) {}

  async record(userId: string, slug: string, masked: string, paise: number): Promise<void> {
    const at = this.now();
    const day = dayKey(at, HOME_OFFSET_MIN);
    const [cur] = await this.rows.select({ user_id: userId, slug, masked, day }, { limit: 1 });
    await this.rows.upsert({
      user_id: userId, slug, masked, day, requests: (Number(cur?.requests) || 0) + 1, paise: (Number(cur?.paise) || 0) + Math.max(0, Math.round(paise) || 0), last_ms: at,
    }, ["user_id", "slug", "masked", "day"]);
  }

  async month(userId: string, slug: string, offsetMin = HOME_OFFSET_MIN): Promise<MonthUsage> {
    const today = dayKey(this.now(), offsetMin);
    const prefix = today.slice(0, 7);
    const rows = (await this.rows.select({ user_id: userId, slug }, { limit: 5000 })).filter((r) => r.day.startsWith(prefix));
    const byKey: MonthUsage["byKey"] = {};
    const byDay = new Map<string, number>();
    let requests = 0, paise = 0;
    for (const r of rows) {
      const k = (byKey[r.masked] ??= { requests: 0, paise: 0, lastAt: 0 });
      k.requests += Number(r.requests) || 0;
      k.paise += Number(r.paise) || 0;
      k.lastAt = Math.max(k.lastAt, Number(r.last_ms) || 0);
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + (Number(r.requests) || 0));
      requests += Number(r.requests) || 0;
      paise += Number(r.paise) || 0;
    }
    const last = Number(today.slice(8, 10));
    const days = Array.from({ length: last }, (_, i) => {
      const day = `${prefix}-${String(i + 1).padStart(2, "0")}`;
      return { day, requests: byDay.get(day) ?? 0 };
    });
    return { month: MONTHS[Number(today.slice(5, 7)) - 1]!, requests, paise, byKey, days };
  }
}
