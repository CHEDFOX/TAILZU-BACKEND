/**
 * KEYBOT'S NUMBERS: everything the old Stats tab (experience/catalog.ts statsScreen, phoneLook.ts phoneStatsBody) and
 * the desk's Insights pages (experience/desk.ts deskInsights, deskDay, deskApp) showed, as one view for the Bots app's
 * Keybot pages (experience/bots/screens/keybot*.ts). docs/bots-keybot-parity.md lists every figure and where it lives.
 *
 * Pure: routes/botsKeybot.ts GET /v1/keybot/stats makes the old screens' own reads and this shapes them.
 *
 *   stats      history/store.ts statsForUser(user, "month", tz, saved words, languages): the last 30 days, a bucket a day
 *              in the person's own day, today last; by app, language, voice, register, hour, part of the day; the
 *              dictionary's use; each day's detail; today's sessions
 *   usage      usage/metering.ts usageSummary: the calendar month and all time, as the meter counted them
 *   allowance  usage/metering.ts allowanceFor: the month's words, earned and left (null when unread)
 *   paid/free  a live entitlement, or Tailzu free for everyone (FREE_FOR_ALL): no limit to show
 *
 * A figure that was not read is absent or null, never a zero standing in for it.
 */
import type { Personality, UsageSummary } from "../../../shared/types/api.js";
import type { DayDetail, StatsForUser } from "../history/store.js";
import type { Allowance } from "../usage/allowance.js";
import { applyPresetOverrides, TONE_LABELS, type PresetTone } from "../experience/personalityPresets.js";
import { appLabel, languageLabel } from "./views.js";

/** Typing speed the minutes saved are counted against (history/store.ts TYPING_WORDS_PER_MINUTE). */
export const TYPING_WPM = 40;
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEK_NAMES = ["3 weeks ago", "2 weeks ago", "Last week", "This week"];
export const LENGTH_NAMES = ["1–5", "6–15", "16–40", "41–100", "100+"];
export const PART_NAMES = ["Morning", "Afternoon", "Evening", "Night"] as const;

export interface Kinds { said: number; typed: number; drafted: number }
export interface Share { label: string; words: number }
export interface Parts { morning: number; afternoon: number; evening: number; night: number }

export interface KeybotStatsDay {
  /** Its place in the window, oldest 0, today last. */
  i: number;
  /** "Today", "Yesterday", "Tue 14 Oct". */
  label: string;
  /** "14 Oct". */
  short: string;
  /** Day of the month. */
  date: number;
  /** Monday 0 … Sunday 6. */
  weekday: number;
  today: boolean;
  words: number;
  sessions: number;
  /** Seconds of speech that day, from the meter. */
  saidSeconds: number;
  /** Words by local hour, 24 (empty when the day's detail was not read). */
  hours: number[];
  apps: Share[];
  kinds: Kinds;
  languages: Share[];
  /** First and last session, local "HH:MM". */
  first: string | null;
  last: string | null;
}

export interface KeybotStatsApp {
  /** The key the words were written under (the app's own). */
  key: string;
  /** As people say it: "Other apps", "Computer". */
  app: string;
  words: number;
  /** Of every word that went to an app, in per cent. */
  share: number;
  /** 1 is the most used. */
  rank: number;
  sessions: number;
  perSession: number;
  kinds: Kinds;
  parts: Parts;
  /** ISO time of the newest session there; null when only the total is known. */
  lastAt: string | null;
  /** The voices written in there, by name, most first. */
  voices: string[];
  daysUsed: number;
  /** Words a day there, same days as `days`. */
  perDay: number[];
}

export interface KeybotStatsView {
  /** Nothing said or written yet in the window, and none this month. */
  empty: boolean;
  /** The calendar month, as the meter counts it: "October", its words, typed against said. */
  month: {
    name: string; words: number; saidMinutes: number; typedMinutes: number; savedMinutes: number;
    dayOfMonth: number; daysInMonth: number;
    /** At this pace, the month's words by its end; null on its last day or before any word. */
    projected: number | null;
  };
  /** The month's words against the plan (null when it could not be read). */
  allowance: null | {
    /** No limit applies: a paid plan, or Tailzu is free for everyone. */
    unlimited: boolean;
    used: number; total: number; remaining: number; base: number; earned: number; maxed: boolean; streakDays: number;
    /** What each visit earned, oldest first (the last eight). */
    perVisit: Array<{ day: string; words: number }>;
  };
  /** The last `days` days (the stats window). */
  window: {
    days: number; words: number; sessions: number; daysActive: number;
    /** Days in a row, to today (or yesterday); `streakLive` while today is written on. */
    streak: number; streakLive: boolean; bestStreak: number;
    perSession: number; perActiveDay: number; sessionsPerActiveDay: number;
    spokenMinutes: number; minutesSaved: number;
    /** Words out per minute said; null before any speech. */
    wordsPerMinute: number | null;
    bestDay: { label: string; words: number } | null;
  };
  /** All time, as the meter counted it (null when unread). */
  lifetime: { words: number; sessions: number; spokenMinutes: number } | null;
  days: KeybotStatsDay[];
  /** Today's sessions, newest first: "14:32", the app, the words, how. */
  todaySessions: Array<{ at: string; app: string; words: number; how: string }>;
  /** The window in four parts, oldest first (WEEK_NAMES). */
  weeks: Array<{ label: string; words: number; sessions: number; perSession: number }>;
  /** Average words on each day of the week, Monday first. */
  weekdays: Array<{ label: string; words: number }>;
  /** Words by local hour across the window (24); null when not read. */
  hours: number[] | null;
  /** Sessions by part of the day; null when not read. */
  parts: Parts | null;
  /** Sessions by length in words (LENGTH_NAMES); null when not read. */
  lengths: Array<{ label: string; sessions: number }> | null;
  /** How the words came: said, typed and cleaned up, drafted as replies; null when not read. */
  kinds: Kinds | null;
  /** Where the words went: the app detail, most first (or the top apps, when only those were read). */
  apps: KeybotStatsApp[];
  /** The top apps as the stats count them (at most five and "Other apps"). */
  topApps: Share[];
  languages: Share[];
  voices: Share[];
  registers: Share[];
  dictionary: null | { saved: number; used: number; unused: number; scanned: number; inUse: number; top: Array<{ word: string; uses: number }>; unusedWords: string[] };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const kindsOf = (k: { voice: number; typing: number; draft: number } | undefined): Kinds =>
  ({ said: k?.voice ?? 0, typed: k?.typing ?? 0, drafted: k?.draft ?? 0 });
const HOW: Record<string, string> = { voice: "said", typing: "typed", draft: "drafted" };

/** The day buckets' dates in the person's own day (oldest first, today last): history/store.ts counts into the same. */
export function windowDays(count: number, now: number, tzOffsetMinutes: number): Array<Pick<KeybotStatsDay, "label" | "short" | "date" | "weekday">> {
  const tz = Math.max(-840, Math.min(840, Math.round(tzOffsetMinutes)));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now + tz * 60_000 - (count - 1 - i) * DAY);
    const short = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    return {
      label: i === count - 1 ? "Today" : i === count - 2 ? "Yesterday" : `${DAY_NAMES[d.getUTCDay()]} ${short}`,
      short, date: d.getUTCDate(), weekday: (d.getUTCDay() + 6) % 7,
    };
  });
}

/** A voice's name as the person renamed it; Zu's own (and an unmarked row) reads as Zu. */
function voiceNamer(p: Personality | undefined): (id: string) => string {
  const named = applyPresetOverrides(p?.presetOverrides);
  return (id: string) => {
    const key = (id || "").trim();
    if (!key || key === "none" || key === "signature") return "Zu";
    return named.find((x) => x.id === key)?.name ?? key;
  };
}

const registerName = (t: string) => {
  const key = (t || "").trim() || "none";
  return key === "none" ? "Zu" : (TONE_LABELS[key as PresetTone] ?? key);
};

/** Fold rows with the same name together (two ids can name one voice), most first. */
function fold(rows: Share[]): Share[] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.words > 0) m.set(r.label, (m.get(r.label) ?? 0) + r.words);
  return [...m.entries()].map(([label, words]) => ({ label, words })).sort((a, b) => b.words - a.words);
}

/** Split a series into `count` buckets from the oldest (the old Stats tab's weeks). */
function bucket(src: number[], count: number): number[] {
  if (!src.length) return new Array(count).fill(0);
  const size = Math.ceil(src.length / count);
  return Array.from({ length: count }, (_, i) => src.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0));
}

export function statsView(o: {
  stats?: StatsForUser;
  usage?: UsageSummary | null;
  allowance?: Allowance | null;
  /** A live entitlement (a paid plan). */
  paid: boolean;
  /** Tailzu is free for everyone (FREE_FOR_ALL). */
  free: boolean;
  personality?: Personality;
  now: number;
  tzOffsetMinutes: number;
}): KeybotStatsView {
  const st = o.stats;
  const usage = o.usage ?? undefined;
  const perDay = st?.wordsPerDay ?? st?.days?.map((d) => d.words) ?? [];
  const count = perDay.length;
  const labels = windowDays(count, o.now, o.tzOffsetMinutes);
  const detail: Array<DayDetail | undefined> = st?.days?.length === count ? st.days : [];
  const saidPerDay = st?.saidSecondsPerDay?.length === count ? st.saidSecondsPerDay : undefined;
  const sessionsPerDay = st?.sparklinePerDay?.length === count ? st.sparklinePerDay : undefined;
  const name = voiceNamer(o.personality);

  const days: KeybotStatsDay[] = perDay.map((w, i) => {
    const d = detail[i];
    return {
      i, ...labels[i]!, today: i === count - 1,
      words: Math.max(0, Math.round(w)),
      sessions: d?.sessions ?? sessionsPerDay?.[i] ?? 0,
      saidSeconds: d?.saidSeconds ?? saidPerDay?.[i] ?? 0,
      hours: d?.hours?.length === 24 ? d.hours : [],
      apps: fold((d?.apps ?? []).map((a) => ({ label: appLabel(a.app), words: a.words }))),
      kinds: kindsOf(d?.kinds),
      languages: fold((d?.languages ?? []).map((l) => ({ label: languageLabel(l.key), words: l.words }))),
      first: d?.first ?? null,
      last: d?.last ?? d?.first ?? null,
    };
  });

  // ---- the window (the old Stats tab's "last 30 days")
  const words = st?.wordsOut ?? usage?.month.words ?? 0;
  const sessions = st?.requests ?? usage?.month.requests ?? 0;
  const daysActive = st?.daysActive ?? perDay.filter((v) => v > 0).length;
  const streak = st?.currentStreak ?? 0;
  const wroteToday = (perDay[count - 1] ?? 0) > 0;
  const spokenMinutes = st?.speakingMinutes ?? (usage ? round1(usage.month.audioSeconds / 60) : 0);
  const best = days.reduce<KeybotStatsDay | undefined>((m, d) => (d.words > (m?.words ?? 0) ? d : m), undefined);

  // ---- the calendar month (the meter's): its words are the allowance's own count when there is one
  const local = new Date(o.now + o.tzOffsetMinutes * 60_000);
  const dayOfMonth = local.getUTCDate();
  const daysInMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  const monthWords = o.allowance?.used ?? usage?.month.words ?? words;
  const saidMinutes = usage ? usage.month.audioSeconds / 60 : spokenMinutes;
  const typedMinutes = monthWords / TYPING_WPM;

  // ---- apps: the detail when it was read, else the top apps' totals
  const appDetail = [...(st?.appDetail ?? [])].sort((a, b) => b.words - a.words);
  const allAppWords = appDetail.reduce((s, a) => s + a.words, 0) || 1;
  const apps: KeybotStatsApp[] = appDetail.length
    ? appDetail.map((a, i) => {
      const perAppDay = days.map((_, j) => detail[j]?.apps.find((x) => x.app === a.app)?.words ?? 0);
      return {
        key: a.app, app: appLabel(a.app), words: a.words, share: Math.round((a.words / allAppWords) * 100), rank: i + 1,
        sessions: a.sessions, perSession: a.avgWords, kinds: kindsOf(a.kinds), parts: a.dayparts, lastAt: a.lastAt || null,
        voices: fold((a.voices ?? []).map((v) => ({ label: name(v.id), words: v.words }))).map((v) => v.label),
        daysUsed: perAppDay.filter((v) => v > 0).length, perDay: perAppDay,
      };
    })
    : [];
  const topApps = fold((st?.topApps ?? []).map((a) => ({ label: a.app === "Other" ? "Other apps" : appLabel(a.app), words: a.words })));

  // ---- languages: as written (read from the text), else as asked for
  const languages = st?.writtenIn?.length
    ? fold(st.writtenIn.map((l) => ({ label: languageLabel(l.key), words: l.words })))
    : fold((st?.languageWords ?? []).filter((l) => l.language !== "auto").map((l) => ({ label: languageLabel(l.language), words: l.words })));

  const weekWords = bucket(perDay, 4);
  const weekSessions = bucket(sessionsPerDay ?? [], 4);
  const wdSum = new Array(7).fill(0) as number[], wdCount = new Array(7).fill(0) as number[];
  days.forEach((d) => { wdSum[d.weekday]! += d.words; wdCount[d.weekday]! += 1; });

  const dict = st?.dictionary;
  const a = o.allowance;
  return {
    empty: sessions === 0 && words === 0 && monthWords === 0,
    month: {
      name: MONTHS_LONG[local.getUTCMonth()]!, words: monthWords, saidMinutes: round1(saidMinutes), typedMinutes: round1(typedMinutes),
      savedMinutes: round1(Math.max(0, typedMinutes - saidMinutes)), dayOfMonth, daysInMonth,
      projected: monthWords > 0 && dayOfMonth < daysInMonth ? Math.round((monthWords / dayOfMonth) * daysInMonth) : null,
    },
    allowance: a ? {
      unlimited: o.paid || o.free, used: a.used, total: a.total, remaining: a.remaining, base: a.base, earned: a.earned, maxed: a.maxed,
      streakDays: a.streakDays, perVisit: a.perVisit.slice(-8).map((v) => ({ day: v.day, words: v.words })),
    } : null,
    window: {
      days: count || 30, words, sessions, daysActive, streak, streakLive: streak > 0 && wroteToday,
      bestStreak: Math.max(st?.bestStreak ?? 0, streak),
      perSession: st?.avgWordsPerSession ?? (sessions ? Math.round(words / sessions) : 0),
      perActiveDay: daysActive ? Math.round(words / daysActive) : 0,
      sessionsPerActiveDay: daysActive ? round1(sessions / daysActive) : 0,
      spokenMinutes, minutesSaved: st?.minutesSaved ?? Math.max(0, Math.round((usage?.total.words ?? 0) / TYPING_WPM)),
      wordsPerMinute: spokenMinutes > 0 ? Math.round(words / spokenMinutes) : null,
      bestDay: best ? { label: best.label, words: best.words } : null,
    },
    lifetime: usage ? { words: usage.total.words, sessions: usage.total.requests, spokenMinutes: Math.round(usage.total.audioSeconds / 60) } : null,
    days,
    todaySessions: (st?.todaySessions ?? []).map((x) => ({ at: x.at, app: x.app ? appLabel(x.app) : "", words: x.words, how: HOW[x.kind ?? ""] ?? "" })),
    weeks: WEEK_NAMES.map((label, i) => ({
      label, words: weekWords[i]!, sessions: weekSessions[i]!, perSession: weekSessions[i] ? Math.round(weekWords[i]! / weekSessions[i]!) : 0,
    })),
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, k) => ({ label, words: wdCount[k] ? Math.round(wdSum[k]! / wdCount[k]!) : 0 })),
    hours: st?.hourWords?.length === 24 ? st.hourWords : null,
    parts: st?.daypartSessions ?? null,
    lengths: st?.sessionLengths?.length === 5 ? st.sessionLengths.map((sessions, i) => ({ label: LENGTH_NAMES[i]!, sessions })) : null,
    kinds: st?.kindWords ? kindsOf(st.kindWords) : null,
    apps,
    topApps,
    languages,
    voices: fold((st?.voiceWords ?? []).map((v) => ({ label: name(v.id), words: v.words }))),
    registers: fold((st?.toneWords ?? []).map((t) => ({ label: registerName(t.tone), words: t.words }))),
    dictionary: dict ? {
      saved: dict.saved, used: dict.used, unused: dict.unused, scanned: dict.scanned,
      inUse: dict.saved > 0 ? Math.round((dict.used / dict.saved) * 100) : 0,
      top: dict.top ?? [], unusedWords: dict.unusedWords ?? [],
    } : null,
  };
}
