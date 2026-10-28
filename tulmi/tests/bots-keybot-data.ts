/**
 * AANYA'S LAST 30 DAYS, for Keybot's numbers (src/keybot/stats.ts) and the old You tab's lines on Keybot: the history
 * stats, the meter's month, the allowance and the personality, shaped as the reads give them. The week ends on the
 * keybot sample's (Mon 1,012, Tue 944, today 1,284 words), and the words are its words (Sharvari, Aanya, PRD…).
 *
 * Used by tests/bots-keybot*.test.ts and by scripts/bots-render/samples/index.ts (the preview and the showcase), which
 * serve the views made from it.
 */
import type { Personality, UsageSummary } from "../../shared/types/api.js";
import type { DayDetail, StatsForUser } from "../src/history/store.js";
import type { Allowance } from "../src/usage/allowance.js";
import { FIXED_NOW, IST } from "../src/experience/bots/fixtures.js";
import { homeView, wordsView } from "../src/keybot/views.js";
import { statsView } from "../src/keybot/stats.js";

/** Words a day, 29 September to today (Wednesday 28 October), today last. */
export const WORDS = [420, 0, 610, 880, 0, 0, 540, 720, 960, 1105, 830, 0, 310, 0, 690, 1240, 980, 760, 1330, 0, 450, 870, 1020, 640, 905, 1180, 560, 1012, 944, 1284];

const APPS: Array<[string, number]> = [["WhatsApp", 0.36], ["Gmail", 0.28], ["Slack", 0.2], ["Notes", 0.1], ["Generic", 0.06]];
const HOURS = [9, 10, 11, 13, 14, 16, 18, 19, 20, 21, 22];
const HOUR_SHARE = [0.06, 0.09, 0.1, 0.07, 0.08, 0.07, 0.1, 0.14, 0.13, 0.1, 0.06];
const split = (w: number, shares: number[]) => { const out = shares.map((s) => Math.floor(w * s)); out[0]! += w - out.reduce((a, b) => a + b, 0); return out; };

const days: DayDetail[] = WORDS.map((w, i) => {
  if (!w) return { words: 0, sessions: 0, saidSeconds: 0, apps: [], hours: new Array(24).fill(0), kinds: { voice: 0, typing: 0, draft: 0 }, languages: [] };
  const hours = new Array(24).fill(0) as number[];
  // Today stops at 7 pm (FIXED_NOW is 7:40 pm in India): nothing in the hours still to come.
  const hs = i === WORDS.length - 1 ? HOURS.filter((h) => h <= 19) : HOURS;
  const shares = HOUR_SHARE.slice(0, hs.length);
  const sum = shares.reduce((a, b) => a + b, 0);
  split(w, shares.map((s) => s / sum)).forEach((v, j) => { hours[hs[j]!] = v; });
  const [voice, typing, draft] = split(w, [0.8, 0.15, 0.05]);
  const [hinglish, en, hi] = split(w, [0.52, 0.4, 0.08]);
  return {
    words: w, sessions: Math.max(1, Math.round(w / 58)), saidSeconds: Math.round(w * 0.42),
    apps: APPS.map(([app], j) => ({ app, words: split(w, APPS.map((x) => x[1]))[j]! })).filter((a) => a.words > 0),
    hours, kinds: { voice: voice!, typing: typing!, draft: draft! },
    languages: [{ key: "hinglish", words: hinglish! }, { key: "en", words: en! }, { key: "hi", words: hi! }],
    first: `${String(hs[0]).padStart(2, "0")}:12`, last: `${String(hs[hs.length - 1]).padStart(2, "0")}:48`,
  };
});

const sum = (f: (d: DayDetail) => number) => days.reduce((a, d) => a + f(d), 0);
const wordsOut = sum((d) => d.words);
const requests = sum((d) => d.sessions);
const audioSeconds = sum((d) => d.saidSeconds);
const appWords = (app: string) => sum((d) => d.apps.find((a) => a.app === app)?.words ?? 0);

/** What history/store.ts statsForUser(user, "month", IST, saved words, languages) answers for her. */
export const MONTH_STATS: StatsForUser = {
  window: "month", requests, wordsOut, audioSeconds,
  minutesSaved: Math.round(wordsOut / 40 - audioSeconds / 60),
  sparklinePerDay: days.map((d) => d.sessions), wordsPerDay: WORDS,
  daysActive: WORDS.filter((w) => w > 0).length, currentStreak: 10, bestStreak: 10,
  kindWords: { voice: sum((d) => d.kinds.voice), typing: sum((d) => d.kinds.typing), draft: sum((d) => d.kinds.draft) },
  daypartSessions: { morning: 118, afternoon: 74, evening: 196, night: 61 },
  topApps: APPS.map(([app]) => ({ app: app === "Generic" ? "Other" : app, words: appWords(app) })),
  bestDay: { date: "Oct 17", words: 1330 },
  avgWordsPerSession: Math.round(wordsOut / requests),
  speakingMinutes: Math.round((audioSeconds / 60) * 10) / 10,
  languageWords: [{ language: "hinglish", words: sum((d) => d.languages[0]?.words ?? 0) }, { language: "en", words: sum((d) => d.languages[1]?.words ?? 0) }, { language: "hi", words: sum((d) => d.languages[2]?.words ?? 0) }],
  voiceWords: [{ id: "signature", words: Math.round(wordsOut * 0.71) }, { id: "professional", words: Math.round(wordsOut * 0.21) }, { id: "friendly", words: Math.round(wordsOut * 0.08) }],
  toneWords: [{ tone: "none", words: Math.round(wordsOut * 0.66) }, { tone: "formal", words: Math.round(wordsOut * 0.24) }, { tone: "casual", words: Math.round(wordsOut * 0.1) }],
  dictionary: { saved: 4, used: 3, unused: 1, scanned: requests, top: [{ word: "Aanya", uses: 12 }, { word: "PRD", uses: 9 }, { word: "Koregaon Park", uses: 4 }], unusedWords: ["Dr. Kulkarni"] },
  writtenIn: [{ key: "hinglish", words: sum((d) => d.languages[0]?.words ?? 0) }, { key: "en", words: sum((d) => d.languages[1]?.words ?? 0) }, { key: "hi", words: sum((d) => d.languages[2]?.words ?? 0) }],
  days,
  todaySessions: [
    { at: "19:22", app: "WhatsApp", words: 38, kind: "voice" }, { at: "18:51", app: "Gmail", words: 142, kind: "voice" },
    { at: "18:05", app: "Slack", words: 26, kind: "typing" }, { at: "16:30", app: "WhatsApp", words: 54, kind: "draft" },
    { at: "14:12", app: "Notes", words: 210, kind: "voice" }, { at: "11:40", app: "Gmail", words: 96, kind: "voice" },
  ],
  appDetail: APPS.map(([app], i) => ({
    app, words: appWords(app), sessions: Math.round(requests * [0.4, 0.22, 0.24, 0.08, 0.06][i]!),
    kinds: { voice: Math.round(appWords(app) * [0.86, 0.7, 0.78, 0.95, 0.8][i]!), typing: Math.round(appWords(app) * [0.08, 0.2, 0.2, 0.05, 0.2][i]!), draft: Math.round(appWords(app) * [0.06, 0.1, 0.02, 0, 0][i]!) },
    dayparts: [{ morning: 18, afternoon: 22, evening: 86, night: 40 }, { morning: 52, afternoon: 30, evening: 18, night: 2 }, { morning: 38, afternoon: 36, evening: 34, night: 4 }, { morning: 6, afternoon: 4, evening: 12, night: 10 }, { morning: 4, afternoon: 2, evening: 6, night: 5 }][i]!,
    avgWords: Math.round(appWords(app) / Math.max(1, Math.round(requests * [0.4, 0.22, 0.24, 0.08, 0.06][i]!))),
    lastAt: new Date(FIXED_NOW - [18, 49, 95, 330, 2880][i]! * 60_000).toISOString(),
    voices: i === 1 ? [{ id: "professional", words: Math.round(appWords(app) * 0.7) }, { id: "signature", words: Math.round(appWords(app) * 0.3) }] : [{ id: "signature", words: appWords(app) }],
  })),
  sessionLengths: [38, 124, 206, 82, 19],
  hourWords: Array.from({ length: 24 }, (_, h) => sum((d) => d.hours[h] ?? 0)),
  saidSecondsPerDay: days.map((d) => d.saidSeconds),
};

/** The meter's calendar month (1 to 28 October) and all time. */
export const USAGE: UsageSummary = {
  month: { words: WORDS.slice(2).reduce((a, b) => a + b, 0), audioSeconds: days.slice(2).reduce((a, d) => a + d.saidSeconds, 0), requests: days.slice(2).reduce((a, d) => a + d.sessions, 0) },
  total: { words: 61_480, audioSeconds: 26_120, requests: 2_310 },
  today: { words: 1284, audioSeconds: days[29]!.saidSeconds, requests: days[29]!.sessions },
};

/** The month against the plan, as allowanceFor reads it (no limit applies while Tailzu is free for everyone). */
export const ALLOWANCE: Allowance = {
  base: 800, earned: 380, total: 1180, used: USAGE.month.words, remaining: Math.max(0, 1180 - USAGE.month.words), streakDays: 10, grants: [], maxed: true,
  perVisit: [["2026-10-21", 40], ["2026-10-22", 55], ["2026-10-23", 30], ["2026-10-24", 60], ["2026-10-25", 45], ["2026-10-26", 50], ["2026-10-27", 35], ["2026-10-28", 65]]
    .map(([day, words]) => ({ day: day as string, words: words as number, sessions: 3, tier: "good" as const })),
};

/** A free plan with a limit (FREE_FOR_ALL off): 800 words a month, 380 earned by turning up, 240 left. */
export const FREE_PLAN: Allowance = { ...ALLOWANCE, used: 940, remaining: 240, maxed: false };

/** Her personality, as GET /v1/personality answers it: the words, the voices, the keys, the name. */
export const PERSONALITY: Personality = {
  vocabulary: "Aanya\nKoregaon Park\nPRD\nDr. Kulkarni",
  dictionary: [{ word: "Sarvari", replacement: "Sharvari" }],
  snippets: "my upi = aanya@okhdfcbank\nmy address = 14, Lane 5, Koregaon Park, Pune 411001",
  ttsVoice: "shimmer", hapticsAll: false, hapticKeys: ["space", "return", "backspace", "a", "e"], languages: ["en", "hi", "hinglish"],
  activePresetId: "signature", pinnedPresetIds: ["professional", "friendly"], assistantName: "Zara", retainHistory: true,
  stylePortrait: {
    words: [{ term: "haan", means: "yes, in chats" }, { term: "7 baje", means: "times, the way you write them" }, { term: "Hinjewadi", means: "where you work, Pune" }, { term: "Sprint demo", means: "the Friday work call" }],
    styles: [{ name: "In chats you skip the full stop", when: "chats with friends and family" }, { name: "At work you get to the point", when: "Slack and mail" }],
    sessions: 3,
  },
};

const PREFS = { tones: { chats: { preset: "casual_hinglish" }, mail: { preset: "clear_polite" }, work: { preset: "short_direct" } }, read: { speed: "1.25" as const }, train: { said: { "0": "a", "1": "b", "2": "c", "3": "d" } } };

/** Keybot's numbers as GET /v1/keybot/stats serves them: free for everyone (no limit), or the free plan's limit (`unlimited: false`). */
export const statsFor = (o: { unlimited?: boolean; stats?: StatsForUser | undefined } = {}) => statsView({
  stats: "stats" in o ? o.stats : MONTH_STATS, usage: USAGE, allowance: o.unlimited === false ? FREE_PLAN : ALLOWANCE, paid: false, free: o.unlimited ?? true,
  personality: PERSONALITY, now: FIXED_NOW, tzOffsetMinutes: IST,
});

/** Every answer Keybot's pages read, as served (the keybot sample's tone, voices, train, history and settings come from keybot.json). */
export function keybotApi(): Record<string, unknown> {
  const tz = `tz=${IST}`;
  return {
    [`GET /v1/keybot?${tz}`]: homeView({ stats: MONTH_STATS, personality: PERSONALITY, prefs: PREFS, now: FIXED_NOW, tzOffsetMinutes: IST }),
    [`GET /v1/keybot/stats?${tz}`]: statsFor(),
    [`GET /v1/keybot/words?${tz}`]: wordsView({ personality: PERSONALITY, dictionary: MONTH_STATS.dictionary, history: [] }),
    "GET /v1/personality": { personality: PERSONALITY },
  };
}
