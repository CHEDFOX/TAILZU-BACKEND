/**
 * THE PERSON'S OWN SETTINGS ON THE YOU TAB, AND THE ONE PLACE THEY ARE CHECKED.
 *
 *   monthLimitPaise   kept from when a person set their own monthly limit; no screen sets or shows it now. The limits are ours, per plan, and
 *   stopAtLimit       the person sees only the usage meter (usage.ts, limits.ts). Both stay readable for older clients.
 *   notify            what pings them (push.ts reads it): needs you always does; done "quiet" (sent without a sound) or "ping"; a daily summary at an
 *                     hour; quiet hours, when nothing makes a sound and done waits; bots turned off (their done pings stop; needs you still comes);
 *                     Calls, Plan Ease calling the phone for a leave-by or a bill due today instead of the push (on by default).
 *                     Must not miss (follow-through, botsBots/planFollow.ts): Keep at it (louder pings, then a call, until they say done),
 *                     Tell my family (the next person on it hears when they don't answer), how many louder pings a day (3, 6 or 10), and
 *                     the people whose must-not-miss items may ring them louder and call them (their own yes, asked once), and
 *                     whether X0 may call their own phone for real when they miss something important (off unless they turn it on).
 *                     The defaults are what the pushes did before the screen existed: done pings, no summary, no quiet hours.
 *   privacy           the screen-picture choice they made on the desktop ("ask" first, or "allow"), so the screens show it back; and whether
 *                     what they told their bots personalises every answer (personalise, on unless they turn it off: src/bots/shared.ts)
 */
import { cleanMarks, type SpaceMarks } from "./spaceMarks.js";
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
  /** Plan Ease calls the phone when it's time to leave or a bill is due today (botsBots/planCall.ts). On unless they turn it off. */
  calls: boolean;
  /** Keep at it: their own must-not-miss items get louder until they say done (botsBots/planFollow.ts). On unless they turn it off. */
  follow: boolean;
  /** Tell my family: when they don't answer, the next person on it hears. On unless they turn it off. */
  followTell: boolean;
  /** The louder pings and X0 calls a day for followed items: 3, 6 or 10. */
  ringMax: number;
  /**
   * The people (auth ids) whose must-not-miss items may ring this person louder and call them. Only they set it (the follow page's Allow,
   * What pings you's Remove). Calls is on by default and quiet hours are off by default: without this, anyone in a family space could
   * have X0 ring someone at 3 am who never said yes.
   */
  followFrom: string[];
  /**
   * "X0 may call my phone if I miss something important": a real phone call as a must-not-miss item's loud step, to their own proved
   * number (botsBots/planFollowChannels.ts). Off unless they turn it on, and it never rings while the phone channel isn't set up.
   */
  phoneCall: boolean;
}

export interface YouSettings {
  monthLimitPaise: number;
  stopAtLimit: boolean;
  notify: NotifySettings;
  /** cleared: Activity rows the person took off their list ("job:<id>", "words:<day>"), newest last. Kept in the privacy column. */
  privacy: { personalise: boolean; cleared?: string[]; space?: SpaceMarks };
}

export const DEFAULT_SETTINGS: YouSettings = {
  monthLimitPaise: DEFAULT_MONTH_BUDGET_PAISE,
  stopAtLimit: false,
  notify: {
    done: "ping", summary: false, summaryAt: 21 * 60, quiet: false, quietFrom: 23 * 60, quietTo: 7 * 60, botsOff: [], calls: true,
    follow: true, followTell: true, ringMax: 6, followFrom: [], phoneCall: false,
  },
  privacy: { personalise: true },
};

/** 1,00,00,000 paise a month is the most a stored limit may be. */
const LIMIT_MAX_PAISE = 10_000_000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The louder pings a day a person may choose. */
export const RING_MAX_CHOICES = [3, 6, 10] as const;
const FOLLOW_FROM_MAX = 50;
const cleanFollowFrom = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, FOLLOW_FROM_MAX) : [];

const minuteOfDay = (v: unknown, d: number): number => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1440 ? (v as number) : d);
/** 10:30 pm as { h: 10, m: 30, ap: "pm" } → 1350, the minute of the day; null when it isn't a time. */
function minuteOfClock(v: unknown): number | null {
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
      calls: n.calls !== false,
      follow: n.follow !== false,
      followTell: n.followTell !== false,
      ringMax: (RING_MAX_CHOICES as readonly number[]).includes(n.ringMax as number) ? (n.ringMax as number) : 6,
      followFrom: cleanFollowFrom(n.followFrom),
      phoneCall: n.phoneCall === true,
    },
    privacy: {
      personalise: p.personalise !== false,
      ...(Array.isArray(p.cleared) ? { cleared: cleanCleared(p.cleared) } : {}),
      // Your space's switched-off sections, pinned lines and moved lines (src/you/spaceMarks.ts).
      ...(p.space && typeof p.space === "object" ? { space: cleanMarks(p.space) } : {}),
    },
  };
}

/** The most Activity rows a person's cleared list keeps: the oldest drop off (by then they are past the feed's days anyway). */
const CLEARED_MAX = 600;
const FEED_ID = /^(job|task|ask|pay|words|call|follow):[A-Za-z0-9_.:-]{1,80}$/;
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
  for (const k of ["summary", "quiet", "calls", "follow", "followTell", "phoneCall"] as const) {
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
  if (n.ringMax !== undefined) {
    if (!(RING_MAX_CHOICES as readonly unknown[]).includes(n.ringMax)) return { ok: false, message: "ringMax is 3, 6 or 10." };
    next.notify.ringMax = n.ringMax as number;
  }
  if (n.followFrom !== undefined) {
    const f = obj(n.followFrom);
    if (typeof f.id !== "string" || !UUID.test(f.id) || typeof f.on !== "boolean") return { ok: false, message: "followFrom is { id, on }." };
    const set = new Set(next.notify.followFrom);
    if (f.on) set.add(f.id); else set.delete(f.id);
    next.notify.followFrom = [...set].slice(0, FOLLOW_FROM_MAX);
  }
  if (n.bot !== undefined) {
    if (typeof n.bot !== "string" || !SLUG.test(n.bot) || typeof n.on !== "boolean") return { ok: false, message: "A bot's pings are { bot, on }." };
    const off = new Set(next.notify.botsOff);
    if (n.on) off.delete(n.bot); else off.add(n.bot);
    next.notify.botsOff = [...off].slice(0, 50);
  }
  const p = obj(b.privacy);
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
