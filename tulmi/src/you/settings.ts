/**
 * THE PERSON'S OWN SETTINGS ON THE YOU TAB, AND THE ONE PLACE THEY ARE CHECKED.
 *
 *   monthLimitPaise   the monthly limit (₹500 until they set one: the Budget board's example, live.ts DEFAULT_MONTH_BUDGET_PAISE)
 *   stopAtLimit       off until they turn it on: then a Code bot job is held to what is left of the month (it pauses and asks for more, as it does
 *                     when its own budget runs out) and a bot's answer is refused once the month is used up (limits.ts)
 *   notify            what pings them (push.ts reads it): needs you always does; done "quiet" (sent without a sound) or "ping"; a daily summary at an
 *                     hour; quiet hours, when nothing makes a sound and done waits; bots turned off (their done pings stop; needs you still comes).
 *                     The defaults are what the pushes did before the screen existed: done pings, no summary, no quiet hours.
 *   privacy           the screen-picture choice they made on the desktop ("ask" first, or "allow"), so the screens show it back
 */
import { DEFAULT_MONTH_BUDGET_PAISE } from "../experience/bots/live.js";

export interface NotifySettings {
  done: "quiet" | "ping";
  summary: boolean;
  /** Minutes after the person's midnight: 1260 is 9:00 pm. */
  summaryAt: number;
  quiet: boolean;
  quietFrom: number;
  quietTo: number;
  /** Bots whose done pings are off, by slug. */
  botsOff: string[];
}

export interface YouSettings {
  monthLimitPaise: number;
  stopAtLimit: boolean;
  notify: NotifySettings;
  privacy: { screenPictures: "ask" | "allow" };
}

export const DEFAULT_SETTINGS: YouSettings = {
  monthLimitPaise: DEFAULT_MONTH_BUDGET_PAISE,
  stopAtLimit: false,
  notify: { done: "ping", summary: false, summaryAt: 21 * 60, quiet: false, quietFrom: 23 * 60, quietTo: 7 * 60, botsOff: [] },
  privacy: { screenPictures: "ask" },
};

/** ₹1,00,000 a month is the most a limit may be. */
export const LIMIT_MAX_PAISE = 10_000_000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const minuteOfDay = (v: unknown, d: number): number => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1440 ? (v as number) : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Whatever was stored, as settings: a field that is missing or wrong is its default. */
export function cleanSettings(raw: unknown): YouSettings {
  const r = obj(raw), n = obj(r.notify), p = obj(r.privacy), d = DEFAULT_SETTINGS;
  const limit = Number(r.monthLimitPaise);
  return {
    monthLimitPaise: Number.isInteger(limit) && limit >= 0 && limit <= LIMIT_MAX_PAISE ? limit : d.monthLimitPaise,
    stopAtLimit: r.stopAtLimit === true,
    notify: {
      done: n.done === "quiet" ? "quiet" : "ping",
      summary: n.summary === true,
      summaryAt: minuteOfDay(n.summaryAt, d.notify.summaryAt),
      quiet: n.quiet === true,
      quietFrom: minuteOfDay(n.quietFrom, d.notify.quietFrom),
      quietTo: minuteOfDay(n.quietTo, d.notify.quietTo),
      botsOff: Array.isArray(n.botsOff) ? [...new Set(n.botsOff.filter((s): s is string => typeof s === "string" && SLUG.test(s) && s.length <= 64))].slice(0, 50) : [],
    },
    privacy: { screenPictures: p.screenPictures === "allow" ? "allow" : "ask" },
  };
}

export type Patched = { ok: true; settings: YouSettings } | { ok: false; message: string };

/**
 * A change the screens send, on top of what is stored. Only the fields sent change; a field of the wrong shape is refused with a sentence. `bot` +
 * `on` turns one bot's pings on or off.
 */
export function applyPatch(cur: YouSettings, raw: unknown): Patched {
  const b = obj(raw);
  const next = structuredClone(cur);
  if (b.monthLimitPaise !== undefined) {
    const v = Number(b.monthLimitPaise);
    if (!Number.isInteger(v) || v < 100 || v > LIMIT_MAX_PAISE) return { ok: false, message: "The limit is ₹1 to ₹1,00,000 a month." };
    next.monthLimitPaise = v;
  }
  if (b.monthLimitRupees !== undefined) {
    const v = Math.round(Number(String(b.monthLimitRupees).replace(/[₹,\s]/g, "")) * 100);
    if (!Number.isFinite(v) || v < 100 || v > LIMIT_MAX_PAISE) return { ok: false, message: "Type an amount from ₹1 to ₹1,00,000." };
    next.monthLimitPaise = v;
  }
  if (b.stopAtLimit !== undefined) {
    if (typeof b.stopAtLimit !== "boolean") return { ok: false, message: "stopAtLimit is true or false." };
    next.stopAtLimit = b.stopAtLimit;
  }
  const n = obj(b.notify);
  if (n.done !== undefined) {
    if (n.done !== "quiet" && n.done !== "ping") return { ok: false, message: 'done is "quiet" or "ping".' };
    next.notify.done = n.done;
  }
  for (const k of ["summary", "quiet"] as const) {
    if (n[k] !== undefined) {
      if (typeof n[k] !== "boolean") return { ok: false, message: `${k} is true or false.` };
      next.notify[k] = n[k] as boolean;
    }
  }
  for (const k of ["summaryAt", "quietFrom", "quietTo"] as const) {
    if (n[k] !== undefined) {
      if (!Number.isInteger(n[k]) || (n[k] as number) < 0 || (n[k] as number) >= 1440) return { ok: false, message: `${k} is minutes after midnight, 0 to 1439.` };
      next.notify[k] = n[k] as number;
    }
  }
  if (n.bot !== undefined) {
    if (typeof n.bot !== "string" || !SLUG.test(n.bot) || typeof n.on !== "boolean") return { ok: false, message: "A bot's pings are { bot, on }." };
    const off = new Set(next.notify.botsOff);
    if (n.on) off.delete(n.bot); else off.add(n.bot);
    next.notify.botsOff = [...off].slice(0, 50);
  }
  const p = obj(b.privacy);
  if (p.screenPictures !== undefined) {
    if (p.screenPictures !== "ask" && p.screenPictures !== "allow") return { ok: false, message: 'screenPictures is "ask" or "allow".' };
    next.privacy.screenPictures = p.screenPictures;
  }
  return { ok: true, settings: next };
}

/** "9:00 pm", "11 pm" (short: whole hours without the minutes). */
export function clock(minute: number, short = false): string {
  const h = Math.floor(minute / 60) % 24, m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "am" : "pm";
  return short && m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Is this minute of the person's day inside their quiet hours? A window may run past midnight (11 pm to 7 am). */
export function inQuietHours(n: NotifySettings, minute: number): boolean {
  if (!n.quiet || n.quietFrom === n.quietTo) return false;
  return n.quietFrom < n.quietTo ? minute >= n.quietFrom && minute < n.quietTo : minute >= n.quietFrom || minute < n.quietTo;
}
