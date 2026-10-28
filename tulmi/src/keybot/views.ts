/**
 * WHAT THE KEYBOT PAGES READ: one view per page, made here from the real records with no I/O (the route reads, these
 * shape), so each is tested directly. routes/botsKeybot.ts serves them at GET /v1/bots/keybot[/<page>]; the screens
 * (experience/bots/screens/keybot.ts) draw them.
 *
 *   home      the week's words by day (history stats, the person's own day, Monday on), the minutes that saved,
 *             the apps they went to, a line for each page under "Make it yours", and the old You tab's lines (the voice,
 *             languages, haptics, what it learned, its name, history kept, spellings, shortcuts)
 *   (the month's numbers, the old Stats tab's, are src/keybot/stats.ts)
 *   tone      the three kinds of app, the preset and little things chosen for each (prefs.ts)
 *   words     the words added (vocabulary, and the dictionary's "heard as" pairs), the words it learned (the style
 *             portrait's words), how often each was said (stats' dictionary counts) and where it was said last; every
 *             pair as stored, the shortcuts (snippets), and how the saved words do this month
 *   voices    the read-aloud voices (ttsVoices.ts), the one in use, and the read-aloud choices
 *   train     the ten lines, what was said for each, and what it learned (the portrait's words and modes)
 *   history   what they said (history), newest first, searched
 *   settings  the phone keyboard's choices (with their defaults) and the languages they write in
 */
import type { HistoryEntry, Personality } from "../../../shared/types/api.js";
import type { StatsForUser } from "../history/store.js";
import { LANGS } from "../experience/languages.js";
import { DEFAULT_TTS_VOICE, isValidTtsVoice, TTS_VOICES, ttsVoiceById, type TtsVoice } from "../experience/ttsVoices.js";
import { applyPresetOverrides } from "../experience/personalityPresets.js";
import { nicknameOf } from "../experience/assistantName.js";
import type { KeybotPrefs, ToneGroup } from "./prefs.js";
import { groupOfApp, presetById, TONE_GROUP_DEFS } from "./tones.js";

/** Typing speed the minutes saved are counted against (history/store.ts TYPING_WORDS_PER_MINUTE). */
const WPM = 40;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ------------------------------------------------------------------ home

export interface KeybotHomeView {
  week: {
    words: number;
    /** Of them, said rather than typed or drafted. */
    spoken: number;
    minutesSaved: number;
    /** Monday to Sunday; the days after today are `ahead` (nothing yet). */
    days: Array<{ label: string; words: number; today: boolean; ahead: boolean }>;
  };
  /** The apps the week's words went to, most first (at most 5): words, and "Mail · Clear and polite". */
  apps: Array<{ app: string; words: number; line: string }>;
  /** The preset chosen for each kind of app, by name; null when none is. */
  tones: Record<ToneGroup, string | null>;
  words: { added: number; learned: number };
  train: { done: number; total: number };
  voice: { label: string; speed: string };
  /** Words today. */
  today: number;
  /** The phone keyboard in a line: "Light keys · haptics on". */
  keyboard: string;
  // ---- what the old You tab carried (docs/bots-keybot-parity.md)
  /** The voice it writes in (personality presets, renamed as the person renamed it): "Zu", and what it does. */
  style: { id: string; name: string; tagline: string };
  /** The languages they write in, by name, in their order. */
  languages: string[];
  /** Key haptics: every key, or how many keys were picked one by one. */
  haptics: { all: boolean; keys: number };
  /** What it has learned of them (the style portrait): things it knows, and the sittings it learned them in. */
  learned: { known: number; sittings: number };
  /** The name they call it besides Tailzu; null for Tailzu alone. */
  nickname: string | null;
  /** What they say is kept, to copy again (history on; on unless they turned it off). */
  keepHistory: boolean;
  /** Spellings fixed for them, heard as and written as (the first three, as the old Dictionary card showed). */
  fixes: Array<{ was: string; word: string }>;
  /** Shortcuts: say a name, the whole thing is written (personality.snippets). */
  snippets: number;
}

type DayBucket = { words: number; apps?: Array<{ app: string; words: number }>; kinds?: { voice: number } };

/** This week, Monday on, in the person's own day: stats' buckets are the last seven days, today last. */
export function weekFrom(st: Pick<StatsForUser, "days" | "wordsPerDay"> | undefined, now: number, tzOffsetMinutes: number): {
  days: KeybotHomeView["week"]["days"]; buckets: DayBucket[];
} {
  const dow = new Date(now + tzOffsetMinutes * 60_000).getUTCDay();
  const sinceMonday = (dow + 6) % 7;
  const all: DayBucket[] = st?.days ?? (st?.wordsPerDay ?? []).map((words) => ({ words }));
  const at = (i: number): DayBucket | undefined => all[all.length - 1 - (sinceMonday - i)];
  const buckets: DayBucket[] = [];
  const days = DAY_NAMES.map((label, i) => {
    if (i > sinceMonday) return { label, words: 0, today: false, ahead: true };
    const b = at(i);
    if (b) buckets.push(b);
    return { label: i === sinceMonday ? "Today" : label, words: Math.max(0, Math.round(b?.words ?? 0)), today: i === sinceMonday, ahead: false };
  });
  return { days, buckets };
}

/** An app's name as people say it ("Generic" is no app at all). */
export function appLabel(app: string | undefined): string {
  if (!app || app === "Generic") return "Other apps";
  if (app === "Desktop") return "Computer";
  return app;
}

export function homeView(o: {
  stats?: Pick<StatsForUser, "days" | "wordsPerDay">;
  personality: Personality;
  prefs: KeybotPrefs;
  now: number;
  tzOffsetMinutes: number;
}): KeybotHomeView {
  const { days, buckets } = weekFrom(o.stats, o.now, o.tzOffsetMinutes);
  const words = days.reduce((s, d) => s + d.words, 0);
  const spoken = buckets.reduce((s, b) => s + (b.kinds?.voice ?? 0), 0);
  const byApp = new Map<string, number>();
  for (const b of buckets) for (const a of b.apps ?? []) byApp.set(appLabel(a.app), (byApp.get(appLabel(a.app)) ?? 0) + a.words);
  const tones = toneNames(o.prefs);
  const apps = [...byApp.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([app, w]) => {
    const g = groupOfApp(app);
    return { app, words: w, line: g ? `${g.label} · ${tones[g.id] ?? "As you say it"}` : "As you say it" };
  });
  const said = Object.keys(o.prefs.train?.said ?? {}).length;
  const voiceId = isValidTtsVoice(o.personality.ttsVoice) ? o.personality.ttsVoice : DEFAULT_TTS_VOICE;
  const kb = keyboardChoices(o.prefs);
  return {
    week: { words, spoken, minutesSaved: Math.round(words / WPM), days },
    apps,
    tones,
    words: { added: addedWords(o.personality).length, learned: learnedWords(o.personality).length },
    train: { done: Math.min(said, TRAIN_LINES.length), total: TRAIN_LINES.length },
    voice: { label: ttsVoiceById(voiceId)?.label ?? voiceId, speed: speedLabel(o.prefs.read?.speed) },
    today: days.find((d) => d.today)?.words ?? 0,
    keyboard: `${kb.look === "dark" ? "Dark" : "Light"} keys · haptics ${o.personality.hapticsAll ? "on" : "off"}`,
    ...youOf(o.personality),
  };
}

/** The old You tab's lines, read from the personality the same way its cards read them. */
function youOf(p: Personality): Pick<KeybotHomeView, "style" | "languages" | "haptics" | "learned" | "nickname" | "keepHistory" | "fixes" | "snippets"> {
  const presets = applyPresetOverrides(p.presetOverrides);
  const active = presets.find((x) => x.id === (p.activePresetId || "signature")) ?? presets[0]!;
  const sp = p.stylePortrait ?? {};
  return {
    style: { id: active.id, name: active.name, tagline: active.tagline ?? "" },
    languages: (p.languages ?? []).map(String).filter((l) => l && l !== "auto").map(languageLabel),
    haptics: { all: p.hapticsAll === true, keys: (p.hapticKeys ?? []).length },
    learned: {
      known: (sp.words?.length ?? 0) + (sp.styles?.length ?? 0) + (sp.rhythms?.length ?? 0) + Object.keys(sp.tones ?? {}).length,
      sittings: sp.sessions ?? 0,
    },
    nickname: nicknameOf(p) ?? null,
    keepHistory: p.retainHistory !== false,
    fixes: (p.dictionary ?? []).filter((d) => d?.word && d?.replacement).slice(0, 3).map((d) => ({ was: String(d.word), word: String(d.replacement) })),
    snippets: snippetsOf(p).length,
  };
}

/** Shortcuts as stored ("my upi = aanya@okhdfc", one a line; a line break inside one is kept as the two characters \n). */
export function snippetsOf(p: Personality): Array<{ say: string; get: string }> {
  return String(p.snippets ?? "").split(/\r?\n/).map((l) => {
    const i = l.indexOf("=");
    return i > 0 ? { say: l.slice(0, i).trim(), get: l.slice(i + 1).trim().replace(/\\n/g, "\n") } : null;
  }).filter((x): x is { say: string; get: string } => !!x && !!x.say && !!x.get);
}

export const speedLabel = (s: string | undefined): string => (!s || s === "1" ? "Normal" : `${s}×`);

function toneNames(prefs: KeybotPrefs): Record<ToneGroup, string | null> {
  const out = {} as Record<ToneGroup, string | null>;
  for (const g of TONE_GROUP_DEFS) out[g.id] = presetById(prefs.tones?.[g.id]?.preset)?.name ?? null;
  return out;
}

// ------------------------------------------------------------------ tone

export interface KeybotToneView {
  groups: Array<{ id: ToneGroup; label: string; appsLine: string; preset: string | null; noStop: boolean; latin: boolean; signOff: boolean }>;
  /** The kind last changed: the page opens on it. */
  focus: ToneGroup;
  train: { done: number; total: number };
}

export function toneView(prefs: KeybotPrefs, focus?: ToneGroup): KeybotToneView {
  return {
    groups: TONE_GROUP_DEFS.map((g) => {
      const t = prefs.tones?.[g.id] ?? {};
      return {
        id: g.id, label: g.label, appsLine: g.appsLine, preset: presetById(t.preset)?.id ?? null,
        noStop: !!t.noStop, latin: !!t.latin, signOff: !!t.signOff,
      };
    }),
    focus: focus ?? "chats",
    train: { done: Math.min(Object.keys(prefs.train?.said ?? {}).length, TRAIN_LINES.length), total: TRAIN_LINES.length },
  };
}

// ------------------------------------------------------------------ words

export interface SaidAt { text: string; at: string; app: string }

export interface KeybotWordsView {
  added: Array<{ word: string; was?: string; kind: "word" | "pair"; uses?: number; recent?: SaidAt }>;
  learned: Array<{ word: string; means: string; uses?: number; recent?: SaidAt }>;
  /** The search it was made for. */
  q: string;
  total: { added: number; learned: number };
  /** Every spelling pair as stored (personality.dictionary), unsearched: adding one writes the whole list back. */
  pairs: Array<{ word: string; replacement: string }>;
  /** Shortcuts: say a name, get the whole thing (personality.snippets), searched. */
  snippets: Array<{ say: string; get: string }>;
  /** How the saved words do this month (stats' dictionary); null when it was not read. */
  use: null | { saved: number; used: number; unused: number; scanned: number; inUse: number; top: Array<{ word: string; uses: number }>; unusedWords: string[] };
}

/** What they added: the dictionary's pairs (written as, heard as) and the vocabulary's lines. */
export function addedWords(p: Personality): Array<{ word: string; was?: string; kind: "word" | "pair" }> {
  const pairs = (p.dictionary ?? []).filter((d) => d?.word && d?.replacement).map((d) => ({ word: d.replacement, was: d.word, kind: "pair" as const }));
  const marked = new Set(pairs.map((x) => x.word.toLowerCase()));
  const vocab = String(p.vocabulary ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((w) => !marked.has(w.toLowerCase())).map((w) => ({ word: w, kind: "word" as const }));
  return [...pairs, ...vocab];
}

/** What it learned of their words on its own (the style portrait's), with what each means to them. */
export function learnedWords(p: Personality): Array<{ word: string; means: string }> {
  return (p.stylePortrait?.words ?? []).filter((w) => w?.term).map((w) => ({ word: w.term, means: String(w.means ?? "") }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The newest line of theirs that has this word in it. */
function lastSaid(word: string, history: HistoryEntry[]): SaidAt | undefined {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(word)}($|[^\\p{L}\\p{N}])`, "iu");
  const hit = history.find((h) => re.test(h.output ?? ""));
  return hit ? { text: hit.output, at: hit.createdAt, app: appLabel(hit.targetApp) } : undefined;
}

export function wordsView(o: {
  personality: Personality;
  /** Stats' dictionary counts, when they were read. */
  dictionary?: StatsForUser["dictionary"];
  history: HistoryEntry[];
  q?: string;
}): KeybotWordsView {
  const uses = new Map<string, number>();
  for (const t of o.dictionary?.top ?? []) uses.set(t.word.toLowerCase(), t.uses);
  for (const w of o.dictionary?.unusedWords ?? []) uses.set(w.toLowerCase(), 0);
  const q = String(o.q ?? "").trim().toLowerCase();
  const match = (w: string, also = "") => !q || w.toLowerCase().includes(q) || also.toLowerCase().includes(q);
  const added = addedWords(o.personality);
  const learned = learnedWords(o.personality);
  return {
    added: added.filter((w) => match(w.word, w.was)).map((w) => ({
      ...w, ...(uses.has(w.word.toLowerCase()) ? { uses: uses.get(w.word.toLowerCase())! } : {}),
      ...(lastSaid(w.word, o.history) ? { recent: lastSaid(w.word, o.history)! } : {}),
    })),
    learned: learned.filter((w) => match(w.word, w.means)).map((w) => ({
      ...w, ...(lastSaid(w.word, o.history) ? { recent: lastSaid(w.word, o.history)! } : {}),
    })),
    q: String(o.q ?? "").trim(),
    total: { added: added.length, learned: learned.length },
    pairs: (o.personality.dictionary ?? []).filter((d) => d?.word && d?.replacement).map((d) => ({ word: String(d.word), replacement: String(d.replacement) })),
    snippets: snippetsOf(o.personality).filter((x) => match(x.say, x.get)),
    use: o.dictionary ? {
      saved: o.dictionary.saved, used: o.dictionary.used, unused: o.dictionary.unused, scanned: o.dictionary.scanned,
      inUse: o.dictionary.saved > 0 ? Math.round((o.dictionary.used / o.dictionary.saved) * 100) : 0,
      top: o.dictionary.top ?? [], unusedWords: o.dictionary.unusedWords ?? [],
    } : null,
  };
}

// ------------------------------------------------------------------ voices

export interface KeybotVoicesView {
  current: string;
  voices: TtsVoice[];
  read: { speed: string; driving: boolean; draftBack: boolean };
}

export function voicesView(p: Personality, prefs: KeybotPrefs): KeybotVoicesView {
  return {
    current: isValidTtsVoice(p.ttsVoice) ? p.ttsVoice : DEFAULT_TTS_VOICE,
    voices: TTS_VOICES,
    read: { speed: prefs.read?.speed ?? "1", driving: !!prefs.read?.driving, draftBack: !!prefs.read?.draftBack },
  };
}

// ------------------------------------------------------------------ train

/** The ten everyday lines, and the kind of app each is for. */
export const TRAIN_LINES: Array<{ text: string; kind: string }> = [
  { text: "Happy birthday! Have a lovely year.", kind: "Chats" },
  { text: "Sorry, I missed your call. Will call back.", kind: "Work" },
  { text: "Can you send me the address?", kind: "Chats" },
  { text: "Yes, I will reach by 7 pm.", kind: "Chats" },
  { text: "Thank you for the update. I will check and get back.", kind: "Work" },
  { text: "Please share the invoice by Friday.", kind: "Mail" },
  { text: "Good morning! Did you have breakfast?", kind: "Chats" },
  { text: "Let us move the call to tomorrow.", kind: "Work" },
  { text: "Congratulations on the new job!", kind: "Chats" },
  { text: "I am on my way, see you soon.", kind: "Chats" },
];

export interface KeybotTrainView {
  lines: Array<{ text: string; kind: string; said?: string; skipped: boolean }>;
  /** The line to say now; -1 when every line is said or skipped. */
  current: number;
  /** The last line said before it, for the conversation; -1 when none. */
  previous: number;
  done: number;
  /** What it learned: their words and the modes they write in (the style portrait), each one they can take back. */
  learned: Array<{ kind: "word" | "style"; key: string; title: string; sub?: string }>;
}

export function trainView(p: Personality, prefs: KeybotPrefs): KeybotTrainView {
  const said = prefs.train?.said ?? {};
  const skipped = new Set(prefs.train?.skipped ?? []);
  const lines = TRAIN_LINES.map((l, i) => ({ ...l, ...(said[String(i)] ? { said: said[String(i)] } : {}), skipped: skipped.has(i) && !said[String(i)] }));
  const current = lines.findIndex((l) => !l.said && !l.skipped);
  let previous = -1;
  for (let i = (current < 0 ? lines.length : current) - 1; i >= 0; i--) if (lines[i]!.said) { previous = i; break; }
  const words = (p.stylePortrait?.words ?? []).filter((w) => w?.term).slice(0, 6)
    .map((w) => ({ kind: "word" as const, key: w.term, title: `You say “${w.term}”`, ...(w.means ? { sub: String(w.means) } : {}) }));
  const styles = (p.stylePortrait?.styles ?? []).filter((s) => s?.name).slice(0, 4)
    .map((s) => ({ kind: "style" as const, key: s.name, title: s.name, ...(s.when ? { sub: String(s.when) } : {}) }));
  return { lines, current, previous, done: lines.filter((l) => l.said).length, learned: [...words, ...styles] };
}

// ------------------------------------------------------------------ history

export interface KeybotHistoryView {
  entries: HistoryEntry[];
  q: string;
  /** History is switched off for them (nothing is kept). */
  off: boolean;
}

export function historyView(entries: HistoryEntry[], p: Personality, q?: string): KeybotHistoryView {
  const s = String(q ?? "").trim().toLowerCase();
  return {
    entries: s ? entries.filter((e) => (e.output ?? "").toLowerCase().includes(s) || (e.input ?? "").toLowerCase().includes(s)) : entries,
    q: String(q ?? "").trim(),
    off: p.retainHistory === false,
  };
}

// ------------------------------------------------------------------ settings

export interface KeybotSettingsView {
  keyboard: { look: "light" | "dark"; haptics: "off" | "light" | "strong"; height: "short" | "normal" | "tall"; sounds: boolean; holdSpace: boolean; keyAt: "left" | "right" | "top" };
  /** The languages they write in, in their order. */
  languages: Array<{ value: string; label: string }>;
}

/** The keyboard's choices with their defaults; haptics follows what the keyboard actually reads when not chosen here. */
export function keyboardChoices(prefs: KeybotPrefs, p?: Personality): KeybotSettingsView["keyboard"] {
  const k = prefs.keyboard ?? {};
  return {
    look: k.look ?? "light",
    haptics: k.haptics ?? (p?.hapticsAll ? "light" : "off"),
    height: k.height ?? "normal",
    sounds: !!k.sounds,
    holdSpace: k.holdSpace ?? true,
    keyAt: k.keyAt ?? "left",
  };
}

/** A language value as people read it ("hinglish" → Hinglish, "hi" → Hindi). */
export function languageLabel(v: string): string {
  if (v === "auto") return "Any language";
  if (v === "hinglish") return "Hinglish";
  return LANGS.find((l) => l.code === v)?.name ?? (v === "en" ? "English" : v);
}

export function settingsView(p: Personality, prefs: KeybotPrefs): KeybotSettingsView {
  return {
    keyboard: keyboardChoices(prefs, p),
    languages: (p.languages ?? []).map(String).filter(Boolean).map((value) => ({ value, label: languageLabel(value) })),
  };
}
