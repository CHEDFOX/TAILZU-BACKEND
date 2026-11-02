/**
 * The person's numbers from their history: words, time saved, by day, app, language and voice
 * (statsForUser, for Stats, the desk's Insights and Keybot).
 */

import { type AuthedUser, dataClientFor } from "../auth/supabase.js";
import { usageEventsSince } from "../usage/metering.js";
import { memoryRows } from "./store.js";
import { writtenIn } from "./writtenIn.js";

/**
 * Baseline typing throughput assumed when estimating "minutes saved". 40 wpm
 * is a middle-of-the-road adult typing speed; tuned here as a single constant
 * so a product-facing decision (should we assume 30? 60?) is one edit away.
 */
export const TYPING_WORDS_PER_MINUTE = 40;

/** Sum-of-cleanups over a rolling window, plus a per-day sparkline and the
 * deep projections the Stats tab charts (all optional — old clients ignore
 * them, old servers omit them). Day bucketing honors the caller's UTC offset
 * when provided so "today" and "evening" mean the user's day, not Greenwich's. */
export interface StatsForUser {
  window: "week" | "month" | "all";
  requests: number;
  wordsOut: number;
  audioSeconds: number;
  minutesSaved: number;
  sparklinePerDay: number[];
  /** Words written per day, same buckets/order as sparklinePerDay. */
  wordsPerDay?: number[];
  /** Days in the window with at least one session. */
  daysActive?: number;
  /** Consecutive active days ending today (or yesterday, so an unfinished
   * today doesn't read as a broken streak). */
  currentStreak?: number;
  /** Longest run of consecutive active days inside the window. */
  bestStreak?: number;
  /** Words by capture kind — the "how you write" split. */
  kindWords?: { voice: number; typing: number; draft: number };
  /** Sessions by local time-of-day band — the "when you write" split. */
  daypartSessions?: { morning: number; afternoon: number; evening: number; night: number };
  /** Top target apps by words (max 5, remainder as "Other"). */
  topApps?: Array<{ app: string; words: number }>;
  /** The single biggest day in the window. */
  bestDay?: { date: string; words: number };
  /** wordsOut / sessions, rounded. */
  avgWordsPerSession?: number;
  /** Minutes of speech processed (voice rows), rounded to one decimal. */
  speakingMinutes?: number;
  /**
   * Words by language, biggest first — the "what you write in" split.
   * Rows with no language recorded are folded into "auto" rather than
   * dropped, so the slices always sum to the words in the window.
   */
  languageWords?: Array<{ language: string; words: number }>;
  /**
   * Words by voice, biggest first. A row with no voice recorded counts under
   * Zu, which is what an unmarked request was written in.
   *
   * NO TONE HERE. A voice can be written in any register, so a single tone
   * beside it could only ever be a sample of one of them — and it was in
   * practice whichever row happened to be read first, which reads as a fact
   * and is an accident of ordering. `toneWords` answers that question
   * properly, over every row.
   */
  voiceWords?: Array<{ id: string; words: number }>;
  /**
   * How much of the saved dictionary is doing any work.
   *
   * `used` and `unused` are counts of SAVED WORDS, not of occurrences — the
   * question is what share of the list earns its place. `top` names the ones
   * that appear most, with the number of cleanups each turned up in.
   *
   * Absent, not zeroed, when the text needed to count is not there: history
   * off, or nothing written yet. Zero would read as "none of your words are
   * used", which is a different and untrue statement.
   */
  dictionary?: {
    saved: number;
    used: number;
    unused: number;
    /** Cleanups scanned to produce the counts. */
    scanned: number;
    top?: Array<{ word: string; uses: number }>;
    /**
     * The words that have never turned up. Named, not just counted, because
     * "six unused" is a fact and "these six" is something you can act on —
     * the list is there to be pruned or spelled differently.
     */
    unusedWords?: string[];
  };
  /**
   * Words by register — which tone the writing was actually asked for in.
   *
   * Separate from voiceWords because they answer different questions: a voice
   * is who is writing, a tone is how. "none" is Zu, their own voice, which is
   * what an unmarked request was written in.
   */
  toneWords?: Array<{ tone: string; words: number }>;
  /**
   * Words by the language they were WRITTEN in, read from the text (see
   * writtenIn.ts), biggest first. Absent when there is no text to read —
   * history off, or nothing written yet.
   */
  writtenIn?: Array<{ key: string; words: number }>;
  /**
   * THE DETAIL BEHIND A DAY'S SQUARE, one per day bucket (same order as
   * wordsPerDay, today last): how much, how long it was said for, where it
   * went, when in the day, how it was written and in what.
   */
  days?: DayDetail[];
  /** Today's sessions, newest first (at most 40): local time, app, words. */
  todaySessions?: Array<{ at: string; app?: string; words: number; kind?: string }>;
  /** Each app the words went to: how much, how, when, how long a piece. */
  appDetail?: AppDetail[];
  /** Sessions by length in words: 1–5, 6–15, 16–40, 41–100, more. */
  sessionLengths?: number[];
  /** Words by local hour across the window, 24 buckets. */
  hourWords?: number[];
  /** Seconds of speech per day, from the meter, same buckets as wordsPerDay. */
  saidSecondsPerDay?: number[];
}

export interface DayDetail {
  words: number;
  sessions: number;
  /** Seconds of speech that day, from the meter. */
  saidSeconds: number;
  apps: Array<{ app: string; words: number }>;
  /** Words by local hour, 24 buckets. */
  hours: number[];
  kinds: { voice: number; typing: number; draft: number };
  /** Written-in keys (writtenIn.ts), biggest first. */
  languages: Array<{ key: string; words: number }>;
  /** First and last session, local "HH:MM". */
  first?: string;
  last?: string;
}

export interface AppDetail {
  app: string;
  words: number;
  sessions: number;
  kinds: { voice: number; typing: number; draft: number };
  dayparts: { morning: number; afternoon: number; evening: number; night: number };
  avgWords: number;
  /** ISO time of the newest session there. */
  lastAt: string;
  /** The voices written in there, by words, biggest first (at most 3). */
  voices: Array<{ id: string; words: number }>;
}

/**
 * Aggregate the user's history + usage over a rolling window. Reads
 * cleanup_history rather than usage_events so we only reflect entries the
 * user has consented to keep — this screen is about *their* history, not the
 * meter behind it.
 */
export async function statsForUser(
  user: AuthedUser,
  window: "week" | "month" | "all",
  tzOffsetMinutes = 0,
  /**
   * The user's saved dictionary, for the density breakdown.
   *
   * Passed in rather than read here: this module knows history, not people,
   * and the caller already holds the personality. Omitted → no dictionary
   * breakdown, which is the honest answer when we don't know the list.
   */
  savedWords: string[] = [],
  /** The person's chosen languages, to tell apart the languages that share a
   *  script. Omitted → each script's most common language. */
  languages: readonly string[] = [],
): Promise<StatsForUser> {
  const sinceMs = windowSinceMs(window);
  const sinceIso = sinceMs != null ? new Date(Date.now() - sinceMs).toISOString() : undefined;
  const days = windowDayCount(window);

  const sb = dataClientFor(user);
  let rows = sb
    ? await fetchStatRowsSupabase(sb, user.id, sinceIso)
    : fetchStatRowsMemory(user.id, sinceIso);

  // FALLBACK: cleanup_history only holds rows for users who explicitly opted
  // into retention (personality.learnFromSent / retainHistory), so for
  // everyone else it is empty BY DESIGN — and the Stats tab read zeros
  // forever, which looks broken rather than gated. usage_events is written
  // for every request and holds no content, so it can back the whole tab.
  // `audioSeconds > 0` is the voice/typing discriminator; targetApp is the
  // one thing it can't provide, so the "where you write" breakdown stays
  // history-only.
  // The meter, for seconds of speech: history does not keep a recording's
  // length (a live dictation lands as a refine of text), and every request is
  // metered with its audio. Read once, used for the fallback below too.
  const events = await usageEventsSince(user, sinceIso).catch(() => []);
  if (!rows.length) {
    // Ask's rows are questions and steps, not dictations: their seconds of
    // speech still count below, but they are not sessions here.
    rows = events.filter((e) => e.source !== "agent").map((e) => ({
      createdAt: e.createdAt,
      wordsOut: e.words,
      audioSeconds: e.audioSeconds,
      kind: e.audioSeconds > 0 ? "voice" : "typing",
    }));
  }

  // All day/hour bucketing runs in the CALLER'S local time: shift every
  // timestamp by their UTC offset, then bucket on UTC fields of the shifted
  // value. Clamp the offset to the real-world range so a bogus client value
  // can't fling buckets days away.
  const tz = Math.max(-14 * 60, Math.min(14 * 60, Math.round(tzOffsetMinutes || 0))) * 60_000;
  const localMidnight = (ms: number) => utcMidnightMs(ms + tz);

  let requests = 0;
  let wordsOut = 0;
  let audioSeconds = 0;
  const spark = new Array<number>(days).fill(0);
  const wordsPerDay = new Array<number>(days).fill(0);
  const kindWords = { voice: 0, typing: 0, draft: 0 };
  const daypartSessions = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const appWords = new Map<string, number>();
  // The three breakdowns the cards chart. Words, not requests: a slice should
  // grow with how much was written in it, not how often it was reached for.
  const langWords = new Map<string, number>();
  const voiceWords = new Map<string, number>();
  const toneWordsMap = new Map<string, number>();
  const outputs: string[] = [];
  const writtenWords = new Map<string, number>();
  const todayMidnight = localMidnight(Date.now());
  const clock = (ms: number) => {
    const d = new Date(ms + tz);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const emptyKinds = () => ({ voice: 0, typing: 0, draft: 0 });
  const dayAcc = Array.from({ length: days }, () => ({
    words: 0, sessions: 0, saidSeconds: 0, apps: new Map<string, number>(),
    hours: new Array<number>(24).fill(0), kinds: emptyKinds(), langs: new Map<string, number>(),
    firstMs: Infinity, lastMs: -Infinity,
  }));
  const apps = new Map<string, AppDetail>();
  const appVoices = new Map<string, Map<string, number>>();
  const sessionLengths = [0, 0, 0, 0, 0];
  const hourWords = new Array<number>(24).fill(0);
  const todaySessions: Array<{ ms: number; app?: string; words: number; kind?: string }> = [];

  for (const r of rows) {
    requests += 1;
    const words = r.wordsOut ?? 0;
    wordsOut += words;
    audioSeconds += r.audioSeconds ?? 0;
    if (r.kind === "voice") kindWords.voice += words;
    else if (r.kind === "draft") kindWords.draft += words;
    else kindWords.typing += words;
    if (r.targetApp) appWords.set(r.targetApp, (appWords.get(r.targetApp) ?? 0) + words);
    // Unrecorded language is "auto" — the setting that produced it — rather
    // than a dropped row, so the slices sum to the words in the window.
    const lang = (r.language ?? "auto").trim() || "auto";
    langWords.set(lang, (langWords.get(lang) ?? 0) + words);
    // A row with no voice recorded was written in Zu. That is not a guess:
    // "no register asked for" IS Zu, and it is what every row predating the
    // column was written in.
    const vid = (r.presetId ?? "signature").trim() || "signature";
    voiceWords.set(vid, (voiceWords.get(vid) ?? 0) + words);
    // A row with no register asked for was written in Zu. Same reading as the
    // voice above, for the same reason.
    const tid = (r.tone ?? "none").trim() || "none";
    toneWordsMap.set(tid, (toneWordsMap.get(tid) ?? 0) + words);
    let langKey: string | undefined;
    if (r.output) {
      outputs.push(r.output);
      langKey = writtenIn(r.output, languages) || undefined;
      if (langKey) writtenWords.set(langKey, (writtenWords.get(langKey) ?? 0) + words);
    }
    const kindKey = r.kind === "voice" ? "voice" : r.kind === "draft" ? "draft" : "typing";
    sessionLengths[words <= 5 ? 0 : words <= 15 ? 1 : words <= 40 ? 2 : words <= 100 ? 3 : 4]! += 1;

    const created = Date.parse(r.createdAt);
    if (!Number.isFinite(created)) continue;
    const dayOffset = Math.floor((todayMidnight - localMidnight(created)) / MS_PER_DAY);
    // Newest bucket is the last element in the array.
    const idx = days - 1 - dayOffset;
    const hour = new Date(created + tz).getUTCHours();
    const part = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
    hourWords[hour]! += words;
    if (idx >= 0 && idx < days) {
      spark[idx]! += 1;
      wordsPerDay[idx]! += words;
      const d = dayAcc[idx]!;
      d.words += words; d.sessions += 1; d.hours[hour]! += words; d.kinds[kindKey] += words;
      if (r.targetApp) d.apps.set(r.targetApp, (d.apps.get(r.targetApp) ?? 0) + words);
      if (langKey) d.langs.set(langKey, (d.langs.get(langKey) ?? 0) + words);
      d.firstMs = Math.min(d.firstMs, created); d.lastMs = Math.max(d.lastMs, created);
      if (idx === days - 1 && todaySessions.length < 200) todaySessions.push({ ms: created, app: r.targetApp, words, kind: r.kind });
    }
    if (r.targetApp) {
      const a = apps.get(r.targetApp) ?? {
        app: r.targetApp, words: 0, sessions: 0, kinds: emptyKinds(),
        dayparts: { morning: 0, afternoon: 0, evening: 0, night: 0 }, avgWords: 0, lastAt: r.createdAt, voices: [],
      };
      a.words += words; a.sessions += 1; a.kinds[kindKey] += words; a.dayparts[part] += 1;
      if (created > Date.parse(a.lastAt)) a.lastAt = r.createdAt;
      apps.set(r.targetApp, a);
      const av = appVoices.get(r.targetApp) ?? new Map<string, number>();
      av.set(vid, (av.get(vid) ?? 0) + words);
      appVoices.set(r.targetApp, av);
    }
    daypartSessions[part] += 1;
  }

  // Seconds of speech per day, from the meter (see above).
  const saidSecondsPerDay = new Array<number>(days).fill(0);
  for (const e of events) {
    const at = Date.parse(e.createdAt);
    if (!Number.isFinite(at) || !(e.audioSeconds > 0)) continue;
    const idx = days - 1 - Math.floor((todayMidnight - localMidnight(at)) / MS_PER_DAY);
    if (idx >= 0 && idx < days) { saidSecondsPerDay[idx]! += e.audioSeconds; dayAcc[idx]!.saidSeconds += e.audioSeconds; }
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
  const dayDetails: DayDetail[] = dayAcc.map((d) => ({
    words: d.words, sessions: d.sessions, saidSeconds: Math.round(d.saidSeconds),
    apps: top(d.apps, 4).map(([app, words]) => ({ app, words })),
    hours: d.hours, kinds: d.kinds,
    languages: top(d.langs, 4).map(([key, words]) => ({ key, words })),
    ...(d.sessions ? { first: clock(d.firstMs), last: clock(d.lastMs) } : {}),
  }));
  const appDetail = [...apps.values()]
    .sort((a, b) => b.words - a.words)
    .slice(0, 6)
    .map((a) => ({
      ...a,
      avgWords: a.sessions ? Math.round(a.words / a.sessions) : 0,
      voices: top(appVoices.get(a.app) ?? new Map(), 3).map(([id, words]) => ({ id, words })),
    }));

  // Streaks over the day buckets. The current streak may start at today OR
  // yesterday — a day that isn't over yet must not read as a broken streak.
  let daysActive = 0;
  let bestStreak = 0;
  let run = 0;
  for (let i = 0; i < days; i++) {
    if (spark[i]! > 0) { daysActive += 1; run += 1; bestStreak = Math.max(bestStreak, run); }
    else run = 0;
  }
  let currentStreak = 0;
  for (let i = days - 1 - (spark[days - 1]! > 0 ? 0 : 1); i >= 0 && spark[i]! > 0; i--) {
    currentStreak += 1;
  }

  // Best single day, dated in the caller's local calendar.
  let bestDay: StatsForUser["bestDay"];
  let bestIdx = -1;
  for (let i = 0; i < days; i++) {
    if (wordsPerDay[i]! > (bestIdx >= 0 ? wordsPerDay[bestIdx]! : 0)) bestIdx = i;
  }
  if (bestIdx >= 0 && wordsPerDay[bestIdx]! > 0) {
    const d = new Date(todayMidnight - (days - 1 - bestIdx) * MS_PER_DAY);
    bestDay = {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      words: wordsPerDay[bestIdx]!,
    };
  }

  // Top apps by words — five named slices; the tail folds into "Other".
  const ranked = [...appWords.entries()].sort((a, b) => b[1] - a[1]);
  const topApps = ranked.slice(0, 5).map(([app, words]) => ({ app, words }));
  const tail = ranked.slice(5).reduce((s, [, w]) => s + w, 0);
  if (tail > 0) topApps.push({ app: "Other", words: tail });

  // Languages and voices, biggest first. Zero-word slices are dropped: a
  // language someone selected but never wrote a word in is a setting, and
  // this is a picture of what they did.
  const languageWords = [...langWords.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([language, words]) => ({ language, words }));
  const voiceList = [...voiceWords.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, words]) => ({ id, words }));
  const toneList = [...toneWordsMap.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tone, words]) => ({ tone, words }));

  return {
    window,
    requests,
    wordsOut,
    audioSeconds,
    minutesSaved: minutesSavedFor(wordsOut),
    sparklinePerDay: spark,
    wordsPerDay,
    daysActive,
    currentStreak,
    bestStreak,
    kindWords,
    daypartSessions,
    topApps: topApps.length ? topApps : undefined,
    bestDay,
    avgWordsPerSession: requests > 0 ? Math.round(wordsOut / requests) : 0,
    speakingMinutes: Math.round((audioSeconds / 60) * 10) / 10,
    languageWords: languageWords.length ? languageWords : undefined,
    voiceWords: voiceList.length ? voiceList : undefined,
    toneWords: toneList.length ? toneList : undefined,
    dictionary: dictionaryDensity(savedWords, outputs),
    writtenIn: writtenWords.size
      ? [...writtenWords.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([key, words]) => ({ key, words }))
      : undefined,
    days: dayDetails,
    todaySessions: todaySessions
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 40)
      .map((t) => ({ at: clock(t.ms), ...(t.app ? { app: t.app } : {}), words: t.words, ...(t.kind ? { kind: t.kind } : {}) })),
    appDetail: appDetail.length ? appDetail : undefined,
    sessionLengths,
    hourWords,
    saidSecondsPerDay,
  };
}

/**
 * How much of the saved dictionary is doing any work.
 *
 * The question the card answers is "what share of this list earns its place",
 * so the counts are of SAVED WORDS, not of occurrences — one word used two
 * hundred times is still one word used.
 *
 * A word counts as used when it appears in the cleaned output of a cleanup,
 * matched whole and case-insensitively. Whole-word matching is the part that
 * matters: a dictionary entry like "Ana" would otherwise be "used" by every
 * "analysis" the person ever wrote, and the chart would say the list is
 * working when it is not.
 *
 * Returns undefined rather than zeros when there is nothing to scan. Zero
 * would read as "none of your words are used", which is a different claim and
 * an untrue one.
 */
function dictionaryDensity(
  saved: string[],
  outputs: string[],
): StatsForUser["dictionary"] {
  if (!saved.length) return undefined;
  if (!outputs.length) return undefined;
  // One pass over the text per word would be saved.length × outputs.length
  // scans. Tokenise once instead and count membership.
  const seen = new Map<string, number>();
  for (const text of outputs) {
    const words = new Set(
      text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [],
    );
    for (const w of words) seen.set(w, (seen.get(w) ?? 0) + 1);
  }
  const uses: Array<{ word: string; uses: number }> = [];
  for (const raw of saved) {
    // A multi-word entry ("Sequoia Capital") counts when every part of it
    // turned up in the same cleanup. Approximated by its rarest part, which
    // is the closest answer available without re-scanning per entry.
    const parts = raw.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
    if (!parts.length) continue;
    const n = Math.min(...parts.map((pt) => seen.get(pt) ?? 0));
    uses.push({ word: raw, uses: n });
  }
  if (!uses.length) return undefined;
  const used = uses.filter((u) => u.uses > 0);
  const idle = uses.filter((u) => u.uses === 0).map((u) => u.word);
  return {
    saved: uses.length,
    used: used.length,
    unused: uses.length - used.length,
    scanned: outputs.length,
    top: used.sort((a, b) => b.uses - a.uses).slice(0, 5),
    // Capped: the point is a list you can read and act on, and a hundred
    // names is a wall, not a prompt to prune.
    unusedWords: idle.length ? idle.slice(0, 12) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC midnight of the calendar day containing `ms`. */
function utcMidnightMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function minutesSavedFor(wordsOut: number): number {
  if (wordsOut <= 0) return 0;
  // Rounded to the nearest tenth so the number looks precise but doesn't
  // pretend to be more accurate than the WPM heuristic behind it.
  return Math.round((wordsOut / TYPING_WORDS_PER_MINUTE) * 10) / 10;
}

function windowSinceMs(window: "week" | "month" | "all"): number | null {
  if (window === "week") return 7 * MS_PER_DAY;
  if (window === "month") return 30 * MS_PER_DAY;
  return null;
}

function windowDayCount(window: "week" | "month" | "all"): number {
  if (window === "week") return 7;
  if (window === "month") return 30;
  // For "all" we still cap the sparkline at 30 days so the array shape stays
  // renderable; the totals still cover everything.
  return 30;
}

interface StatRow {
  createdAt: string;
  wordsOut?: number;
  audioSeconds?: number;
  kind?: string;
  targetApp?: string;
  /** Language hint in effect — backs the Languages breakdown. */
  language?: string;
  /** Register asked for — backs the Voices breakdown. */
  tone?: string;
  /** Voice that was active — backs the Voices breakdown. */
  presetId?: string;
  /**
   * The cleaned text. ONLY read to count which saved words a person actually
   * uses, and never returned to the client. It exists on history rows and
   * nowhere else, so the Dictionary breakdown is the one of the three that
   * cannot fall back to usage_events — see statsForUser.
   */
  output?: string;
}

const STATS_PAGE = 1000;
const STATS_MAX_ROWS = 20_000;

async function fetchStatRowsSupabase(
  sb: NonNullable<ReturnType<typeof dataClientFor>>,
  userId: string,
  sinceIso: string | undefined,
): Promise<StatRow[]> {
  // PAGED, newest first. PostgREST caps an unpaged select at its max-rows
  // (1000 on Supabase), so "all" — and a busy month — silently summed an
  // arbitrary thousand rows. Bounded at STATS_MAX_ROWS so one account cannot
  // pull an unbounded amount of text into memory.
  const data: Array<Record<string, unknown>> = [];
  for (let from = 0; from < STATS_MAX_ROWS; from += STATS_PAGE) {
    let q = sb
      .from("cleanup_history")
      .select("created_at, words_out, duration_ms, kind, target_app, language, tone, preset_id, output")
      .eq("user_id", userId)
      .is("deleted_at", null);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { data: page, error } = await q
      .order("created_at", { ascending: false })
      .range(from, from + STATS_PAGE - 1);
    if (error || !page) {
      if (error) console.error(`[history] stats failed for ${userId}:`, error.message);
      if (!data.length) return [];
      break;
    }
    data.push(...page);
    if (page.length < STATS_PAGE) break;
  }
  return (data as Array<{
    created_at?: string;
    words_out?: number | null;
    duration_ms?: number | null;
    kind?: string;
    target_app?: string | null;
    language?: string | null;
    tone?: string | null;
    preset_id?: string | null;
    output?: string | null;
  }>).map((r) => ({
    createdAt: r.created_at ?? new Date(0).toISOString(),
    wordsOut: r.words_out ?? 0,
    // We don't have per-row audio seconds in the DB; approximate voice rows
    // by their duration_ms (best-effort — this feeds a UI number, not billing).
    audioSeconds: r.kind === "voice" && r.duration_ms ? r.duration_ms / 1000 : 0,
    kind: r.kind,
    targetApp: r.target_app ?? undefined,
    language: r.language ?? undefined,
    tone: r.tone ?? undefined,
    presetId: r.preset_id ?? undefined,
    output: r.output ?? undefined,
  }));
}

function fetchStatRowsMemory(userId: string, sinceIso: string | undefined): StatRow[] {
  const rows = memoryRows(userId).filter((r) => !r.deletedAt);
  return rows
    .filter((r) => !sinceIso || r.createdAt >= sinceIso)
    .map((r) => ({
      createdAt: r.createdAt,
      wordsOut: r.wordsOut ?? 0,
      audioSeconds: r.audioSeconds ?? 0,
      kind: r.kind,
      targetApp: r.targetApp,
      language: r.language,
      tone: r.tone,
      presetId: r.presetId,
      output: r.output,
    }));
}
