/**
 * THE PERSON'S OWN SETTINGS ON THE YOU TAB, AND THE ONE PLACE THEY ARE CHECKED.
 *
 *   monthLimitPaise   kept from when a person set their own monthly limit; no screen sets or shows it now. The limits are ours, per plan, and
 *   stopAtLimit       the person sees only the usage meter (usage.ts, limits.ts). Both stay readable for older clients.
 *   notify            what pings them (push.ts reads it): needs you always does; done "quiet" (sent without a sound) or "ping"; a daily summary at an
 *                     hour; quiet hours, when nothing makes a sound and done waits; bots turned off (their done pings stop; needs you still comes).
 *                     The defaults are what the pushes did before the screen existed: done pings, no summary, no quiet hours.
 *   privacy           the screen-picture choice they made on the desktop ("ask" first, or "allow"), so the screens show it back; and whether
 *                     what they told their bots personalises every answer (personalise, on unless they turn it off: src/bots/shared.ts)
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
  /** cleared: Activity rows the person took off their list ("job:<id>", "words:<day>"), newest last. Kept in the privacy column. */
  privacy: { screenPictures: "ask" | "allow"; personalise: boolean; cleared?: string[] };
}

export const DEFAULT_SETTINGS: YouSettings = {
  monthLimitPaise: DEFAULT_MONTH_BUDGET_PAISE,
  stopAtLimit: false,
  notify: { done: "ping", summary: false, summaryAt: 21 * 60, quiet: false, quietFrom: 23 * 60, quietTo: 7 * 60, botsOff: [] },
  privacy: { screenPictures: "ask", personalise: true },
};

/** 1,00,00,000 paise a month is the most a stored limit may be. */
export const LIMIT_MAX_PAISE = 10_000_000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const minuteOfDay = (v: unknown, d: number): number => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1440 ? (v as number) : d);
/** 10:30 pm as { h: 10, m: 30, ap: "pm" } → 1350, the minute of the day; null when it isn't a time. */
export function minuteOfClock(v: unknown): number | null {
  const t = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const h = Number(t.h), m = Number(t.m), ap = t.ap;
  if (!Number.isInteger(h) || h < 1 || h > 12 || !Number.isInteger(m) || m < 0 || m > 59 || (ap !== "am" && ap !== "pm")) return null;
  return ((h % 12) + (ap === "pm" ? 12 : 0)) * 60 + m;
}
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
    privacy: {
      screenPictures: p.screenPictures === "allow" ? "allow" : "ask",
      personalise: p.personalise !== false,
      ...(Array.isArray(p.cleared) ? { cleared: cleanCleared(p.cleared) } : {}),
    },
  };
}

/** The most Activity rows a person's cleared list keeps: the oldest drop off (by then they are past the feed's days anyway). */
export const CLEARED_MAX = 600;
const FEED_ID = /^(job|task|ask|pay|words):[A-Za-z0-9_.:-]{1,80}$/;
const cleanCleared = (v: unknown[]): string[] => [...new Set(v.filter((x): x is string => typeof x === "string" && FEED_ID.test(x)))].slice(-CLEARED_MAX);

/** One more Activity row cleared from the list; null when the id isn't one. */
export function withCleared(s: YouSettings, id: unknown): YouSettings | null {
  if (typeof id !== "string" || !FEED_ID.test(id)) return null;
  const cleared = cleanCleared([...(s.privacy.cleared ?? []).filter((x) => x !== id), id]);
  return { ...s, privacy: { ...s.privacy, cleared } };
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
    if (!Number.isInteger(v) || v < 100 || v > LIMIT_MAX_PAISE) return { ok: false, message: "That limit is out of range." };
    next.monthLimitPaise = v;
  }
  if (b.monthLimitRupees !== undefined) {
    const v = Math.round(Number(String(b.monthLimitRupees).replace(/[₹,\s]/g, "")) * 100);
    if (!Number.isFinite(v) || v < 100 || v > LIMIT_MAX_PAISE) return { ok: false, message: "That limit is out of range." };
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
    // As the time picker sends it: { h: 1-12, m: 0-59, ap: "am" | "pm" }.
    if (n[k] && typeof n[k] === "object") {
      const t = minuteOfClock(n[k]);
      if (t === null) return { ok: false, message: `${k} is { h: 1 to 12, m: 0 to 59, ap: "am" or "pm" }.` };
      next.notify[k] = t;
      continue;
    }
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
  if (p.personalise !== undefined) {
    if (typeof p.personalise !== "boolean") return { ok: false, message: "personalise is true or false." };
    next.privacy.personalise = p.personalise;
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
