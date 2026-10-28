/**
 * KEYBOT: the keyboard bot's pages, for the phone and the window (one id each, ctx.client picks the layout).
 *
 *   bots.keybot            Keybot / DKeybot         everything the old Stats and You tabs had, in Keybot's look
 *                          (docs/bots-keybot-parity.md): the month typed against said, the words left, the week, today,
 *                          where the words went, how you speak, the days, six figures; then the You tab's lines in
 *                          groups (Make it yours, Keyboard and voice, What you said); what the key does. Account and help live in the You tab: Keybot is part of the app, not an app of its own
 *   bots.keybot.tone       KeyTone / DKeyTone       a tone for each kind of app (Chats, Mail, Work chat)
 *   bots.keybot.words      KeyWords / DKeyWords     the words it spells your way: added, learned, how often said
 *   bots.keybot.voices     KeyVoices / DKeyVoices   the read-aloud voice, speed, when it reads
 *   bots.keybot.train      KeyTrain / DKeyTrain     ten everyday lines said your way, and what it learned
 *   bots.keybot.history    KeyHistory / DKeyHistory what you said: copy it, forget it, clear it
 *   bots.keybot.settings   KeySettings / DKeySettings  the phone keyboard (look, feel, typing, the key); in the window,
 *                          this computer's keys, the pill and listening (desktop.config), and the languages
 *
 * Each page reads one view from routes/botsKeybot.ts (GET /v1/keybot[/page], shaped in src/keybot/views.ts) and
 * writes through it or the routes that were already there (PUT /v1/personality, POST /v1/words, DELETE /v1/history).
 * A failed read draws the page's honest "couldn't load" state, never a made-up number.
 *
 * The numbers' own pages are screens/keybotStats.ts (month, day, apps, speak, days), the old You tab's that had no
 * Keybot page are screens/keybotYou.ts (style, haptics, name); the small parts and the charts, screens/keybotParts.ts.
 *
 * Not here: bots.keybot.on and the keyboard and microphone cards shown on Keybot (screens/firstRun.ts). bots.keybot.pill / .reply / .rewrite are the desktop's
 * own windows (TAILZU-DESKTOP pill.html and guide.html, behind the same switch), and the phone keyboard's KeyLive,
 * KeyReply and KeyRewrite are the keyboard extension itself: neither is a server-drawn screen.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../shared/types/sdui.js";
import type { HistoryEntry } from "../../../../../shared/types/api.js";
import type {
  KeybotHistoryView, KeybotHomeView, KeybotSettingsView, KeybotToneView, KeybotTrainView, KeybotVoicesView, KeybotWordsView,
} from "../../../keybot/views.js";
import type { KeybotStatsView } from "../../../keybot/stats.js";
import { TONE_GROUP_DEFS, TONE_PRESETS, TONE_SAID, groupOfApp } from "../../../keybot/tones.js";
import { dayPart } from "../../touches.js";
import { sw } from "../../settingsWords.js";
import {
  back, blip, botAvatar, box, button, C, call, card, chip, col, divider, emptyState, grow, icon, listCard, listRow,
  meta, meter, open, page, primaryButton, quietButton, row, SCREENS, sectionLabel, segmented, seq, statusMark,
  switchMark, switchRow, text, title, when, whenEq, headerBuddy, type BotsCtx,
} from "../kit.js";
import type { BotsDeps } from "../live.js";
import { screen, type BotsScreen } from "../registry.js";
import { canPlay, playButton, playingLine, playingSub } from "../media.js";
import { DEVICE_STATE, keybotCard } from "./firstRun.js";
import {
  appSquare, both, calendar, CLAY, clock, columns, couldntLoad, dayKey, dayLabel, deskCard, deskHead, DESK_WIDTH, field, figure, figures,
  glyph, hbars, HOUR_TICKS, kbd, KEYBOT, load, n, oops, pct, phoneHead, plural, save, searchField, searchLine, sectionHead, span, statRow, toast,
  toggleRow, twoCols, write, type BarRow, type Glyph,
} from "./keybotParts.js";
import { keybotStatsScreens } from "./keybotStats.js";
import { keybotYouScreens } from "./keybotYou.js";

// ===================================================================== bots.keybot

/**
 * Keybot's home carries what the old Stats and You tabs had (docs/bots-keybot-parity.md): the numbers up top (the
 * month, the words left, the week, today, where the words went, how you speak, the days, six figures), then the old
 * You tab's lines in groups, each opening its page, then what the key does. Two reads, each with its own honest state:
 * GET /v1/keybot (the week, and a line for each page) and GET /v1/keybot/stats (the numbers).
 */
interface HomeData { home?: KeybotHomeView; stats?: KeybotStatsView }

const loadHome = async (ctx: BotsCtx, deps: Pick<BotsDeps, "api">): Promise<HomeData> => {
  const [home, stats] = await Promise.all([
    load<KeybotHomeView>("/v1/keybot")(ctx, deps).catch(() => undefined),
    load<KeybotStatsView>("/v1/keybot/stats")(ctx, deps).catch(() => undefined),
  ]);
  return { home, stats };
};

const MODES = [
  { name: "Speak", blurb: "Hold and talk, clean text comes out" },
  { name: "Rewrite", blurb: "Select text, say how to change it" },
  { name: "Translate", blurb: "Hindi, Hinglish, English" },
  { name: "Reply", blurb: "Drafts an answer in your tone" },
];

function modeCard(m: (typeof MODES)[number], i: number, hint?: Node): Node {
  return card([
    text(m.name, { size: 15, weight: 600, lineHeight: 20 }),
    meta(m.blurb, { size: 12 }),
    ...(hint ? [hint] : []),
  ], { gap: 6, padding: 14, radius: 18, ...(i === 0 ? { selected: CLAY } : {}) });
}

/** Blip's line for the part of the day, as the old You tab said it under his wave ("Good evening. Anything to write up…"). */
const dayLine = (ctx: BotsCtx) => sw(`g.${dayPart(ctx.tzOffsetMinutes, ctx.live.now)}`);

// ---------------------------------------------------------------- the numbers

/** The month as the meter counts it: its name, its words, typed against said, and the words left. Opens This month. */
function monthCard(s: KeybotStatsView): Node {
  const m = s.month;
  const lanes = [
    ...(m.saidMinutes > 0 ? [{ label: "Said", value: m.saidMinutes, text: span(m.saidMinutes) }] : []),
    { label: "Typed", value: m.typedMinutes, text: span(m.typedMinutes) },
  ];
  const body: Node[] = s.empty && m.words === 0
    ? [text("Nothing here yet.", { size: 20, weight: 600, lineHeight: 26 }),
      meta("Say a few things in any app and this fills in: how much you said, where it went, the days you talked.", { size: 13, lineHeight: 18 })]
    : m.words === 0
      ? [text("Nothing yet this month.", { size: 20, weight: 600, lineHeight: 26 })]
      : [
        text(plural(m.words, "word", "words"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
        meta(m.saidMinutes > 0
          ? `Typed, they'd take ${span(m.typedMinutes)}. Said, ${span(m.saidMinutes)}. About ${span(m.savedMinutes)} saved.`
          : `Typed by hand, they'd take ${span(m.typedMinutes)}.`, { size: 13, lineHeight: 18 }),
        hbars(lanes, { labelWidth: 56 }),
      ];
  return card([
    sectionHead(`${m.name} so far`),
    ...body,
    ...wordsLeft(s),
  ], { gap: 10, radius: 18, onPress: open(SCREENS.keyMonth) });
}

/** The words this month against the plan: what is left (and what turning up earned), or no limit at all. */
function wordsLeft(s: KeybotStatsView): Node[] {
  const a = s.allowance;
  if (!a) return [];
  if (a.unlimited) {
    return [divider(), row([text("Words this month", { size: 14, lineHeight: 19 }), grow(), text(n(a.used), { size: 14, weight: 600, lineHeight: 19 })]),
      meta("No limit on your plan.", { size: 12 })];
  }
  return [
    divider(),
    meter(a.remaining, a.total, { label: "Words left", valueText: `${n(a.remaining)} of ${n(a.total)}`, color: CLAY }),
    meta(`Back on the 1st.${a.earned > 0 ? (a.maxed ? ` ${n(a.earned)} earned, the most there is this month.` : ` ${n(a.earned)} of these you earned by turning up.`) : ""}`, { size: 12 }),
  ];
}

/** The week by day: a column a day, today in clay, the days still to come a flat line. */
function weekBars(days: KeybotHomeView["week"]["days"]): Node {
  return columns(days.map((d) => d.words), {
    height: 74, mark: days.flatMap((d, i) => (d.today ? [i] : [])), ahead: days.flatMap((d, i) => (d.ahead ? [i] : [])),
    tops: "all", ticks: days.map((d) => d.label), perColumnTicks: true,
  });
}

/** "3,240 words" this week and what it saved; the honest zero when nothing was said yet. Opens Days and sessions. */
function weekCard(w: KeybotHomeView["week"]): Node {
  const said = w.words > 0 && w.spoken >= w.words * 0.9 ? "spoken this week instead of typed" : "written with Keybot this week";
  return card([
    sectionHead("This week"),
    col([
      text(plural(w.words, "word", "words"), { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
      meta(w.words > 0 ? `${said} · about ${plural(w.minutesSaved, "minute", "minutes")} saved` : "Hold the Keybot key and speak in any app. Your week fills in here.", { size: 13, lineHeight: 18 }),
    ], { gap: 2 }),
    weekBars(w.days),
  ], { gap: 12, radius: 18, onPress: open(SCREENS.keyDays) });
}

/** Today: its words and how long they took to say, and the day so far hour by hour. Opens today's page. */
function todayCard(ctx: BotsCtx, s: KeybotStatsView): Node {
  const t = s.days[s.days.length - 1];
  const hourNow = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000).getUTCHours();
  const words = t?.words ?? 0;
  return card([
    sectionHead("Today"),
    words > 0
      ? text(`${plural(words, "word", "words")}${t!.saidSeconds > 0 ? `, said in ${span(t!.saidSeconds / 60)}` : ""}.`, { size: 17, weight: 600, lineHeight: 23 })
      : text("Nothing yet today.", { size: 17, weight: 600, lineHeight: 23, color: C.grey70 }),
    ...(t && t.hours.some((v) => v > 0)
      ? [columns(t.hours, { height: 56, mark: [hourNow], ahead: t.hours.map((_, h) => h).filter((h) => h > hourNow), tops: "none", ticks: HOUR_TICKS })]
      : [meta("Say something in any app and it shows here, hour by hour.", { size: 12 })]),
  ], { gap: 10, radius: 18, onPress: open(SCREENS.keyDay) });
}

/** The kind of app's glyph for an app's name. */
const kindGlyph = (app: string): Glyph => (groupOfApp(app)?.id as Glyph | undefined) ?? "app";
/** "Mail · Clear and polite", for an app of a kind with a tone. */
const toneLine = (app: string, tones: KeybotHomeView["tones"] | undefined) => {
  const g = groupOfApp(app);
  return g ? `${g.label} · ${tones?.[g.id] ?? "As you say it"}` : undefined;
};

/** Where the last 30 days' words went: the apps, most first, each opening its own page; Tone per app on top. */
function appsCard(s: KeybotStatsView, home: KeybotHomeView | undefined): Node {
  const total = s.topApps.reduce((a, b) => a + b.words, 0);
  const rows: BarRow[] = s.apps.length
    ? s.apps.slice(0, 4).map((a) => ({
      label: a.app, value: a.words, text: `${a.share}%`, sub: toneLine(a.key, home?.tones), lead: appSquare(kindGlyph(a.key), 32),
      onPress: open(SCREENS.keyApps, { app: a.key }),
    }))
    : s.topApps.slice(0, 4).map((a) => ({ label: a.label, value: a.words, text: `${pct(a.words, total)}%`, lead: appSquare(kindGlyph(a.label), 32) }));
  return card([
    sectionHead("Where the words went", { label: "Tone per app", onPress: open(SCREENS.keyTone) }),
    hbars(rows, { empty: "Nothing yet. Speak in any app and it shows up here, by app." }),
    ...(rows.length ? [row([text(`Every app · last ${s.window.days} days`, { size: 13, lineHeight: 17 }), grow(), icon("chevron", { size: 14 })], { minHeight: 36 }, open(SCREENS.keyApps))] : []),
  ], { gap: 8, radius: 18 });
}

/** The week's apps, when the month's numbers could not be read (Keybot's own by-app card). */
function weekAppsCard(d: KeybotHomeView): Node {
  return card([
    sectionHead("By app · this week", { label: "Tone per app", onPress: open(SCREENS.keyTone) }),
    hbars(d.apps.map((a) => ({ label: a.app, sub: a.line, value: a.words, text: n(a.words), lead: appSquare(kindGlyph(a.app), 32) })),
      { empty: "Nothing yet this week. Speak in any app and it shows up here, by app." }),
  ], { gap: 8, radius: 18 });
}

/** How you speak: the languages, and how the words came (said, typed, drafted). Opens How you speak. */
function speakCard(s: KeybotStatsView): Node {
  const lt = s.languages.reduce((a, b) => a + b.words, 0);
  const k = s.kinds;
  const kt = k ? k.said + k.typed + k.drafted : 0;
  return card([
    sectionHead(s.languages.length ? `How you speak · ${plural(s.languages.length, "language", "languages")}` : "How you speak"),
    hbars(s.languages.slice(0, 3).map((l) => ({ label: l.label, value: l.words, text: `${pct(l.words, lt)}%` })),
      { empty: "Talk for a few days and this fills in, read from what Keybot wrote." }),
    ...(k && kt ? [sectionLabel("How the words came"), hbars([
      { label: "Said", value: k.said, text: `${pct(k.said, kt)}%` },
      { label: "Typed", value: k.typed, text: `${pct(k.typed, kt)}%` },
      { label: "Drafted", value: k.drafted, text: `${pct(k.drafted, kt)}%` },
    ].filter((x) => x.value > 0), { labelWidth: 64 })] : []),
  ], { gap: 8, radius: 18, onPress: open(SCREENS.keySpeak) });
}

/** The days, as a calendar: each opens its page; the line under it opens Days and sessions. */
function daysCard(s: KeybotStatsView, cell = 40): Node {
  const w = s.window;
  return card([
    sectionHead("Days you talked"),
    calendar(s.days, (i) => open(SCREENS.keyDay, { day: i }), { cell }),
    row([
      meta(w.daysActive ? `${n(w.daysActive)} of the last ${n(w.days)} days. The longest run was ${plural(w.bestStreak, "day", "days")}.` : `None of the last ${n(w.days)} days yet.`, { size: 13, style: { flexShrink: 1 } }),
      grow(), icon("chevron", { size: 14, color: C.meta }),
    ], { gap: 8, minHeight: 36 }, open(SCREENS.keyDays)),
  ], { gap: 10, radius: 18 });
}

/** The six figures of the last 30 days, each opening what is behind it. */
function figureTiles(s: KeybotStatsView): Node[] {
  const w = s.window;
  const top = s.voices[0];
  const vt = s.voices.reduce((a, b) => a + b.words, 0);
  return [
    figure("Sessions", n(w.sessions), { onPress: open(SCREENS.keyDays) }),
    figure("Day streak", n(w.streak), { unit: w.streak === 1 ? "day" : "days", live: w.streakLive, onPress: open(SCREENS.keyDays) }),
    figure("Per session", n(w.perSession), { unit: "words", onPress: open(SCREENS.keyDays) }),
    figure("Spoken", n(w.spokenMinutes), { unit: "min", onPress: open(SCREENS.keyMonth) }),
    figure("Voices", top ? `${pct(top.words, vt)}%` : "—", { unit: top ? top.label : undefined, onPress: open(SCREENS.keySpeak) }),
    figure("Your words", s.dictionary && s.dictionary.saved ? `${s.dictionary.inUse}%` : "—", { unit: s.dictionary && s.dictionary.saved ? "in use" : undefined, onPress: open(SCREENS.keyWords) }),
  ];
}

// ---------------------------------------------------------------- the old You tab's lines


interface Line { label: string; value?: string; sub?: string; onPress: ActionRef; right?: Node }

/** Make it yours: how Keybot writes for you. */
function yoursLines(d: KeybotHomeView | undefined): Line[] {
  const fix = d?.fixes[0];
  return [
    { label: "Voice", value: d?.style.name ?? "", sub: d?.style.tagline || "The voice it writes in", onPress: open(SCREENS.keyStyle) },
    { label: "Tone per app", value: d ? `Chats · ${d.tones.chats ?? "as you say it"}` : "", onPress: open(SCREENS.keyTone) },
    {
      label: "Teach your style", value: d ? (d.train.done ? `${d.train.done} of ${d.train.total} done` : "Ten lines, about 3 min") : "",
      sub: d && d.learned.known ? `Knows ${plural(d.learned.known, "thing", "things")} about how you write${d.learned.sittings ? `, from ${plural(d.learned.sittings, "sitting", "sittings")}` : ""}` : undefined,
      onPress: open(SCREENS.keyTrain),
    },
    {
      label: "Your words", value: d ? plural(d.words.added + d.words.learned, "word", "words") : "",
      sub: fix ? `“${fix.was}” is written “${fix.word}”${d!.snippets ? ` · ${plural(d!.snippets, "shortcut", "shortcuts")}` : ""}` : d?.snippets ? plural(d.snippets, "shortcut", "shortcuts") : "Names, places, shortcuts",
      onPress: open(SCREENS.keyWords),
    },
    { label: "Languages", value: d ? (d.languages.join(", ") || "Found as you talk") : "", onPress: open(SCREENS.language) },
    { label: "What you call it", value: d ? (d.nickname ? `Tailzu, or ${d.nickname}` : "Tailzu") : "", onPress: open(SCREENS.keyName) },
  ];
}

/** The keyboard, its keys under the finger, and the voice that reads to you. */
function keyboardLines(d: KeybotHomeView | undefined, desk: boolean): Line[] {
  return [
    { label: desk ? "Keys and the pill" : "Keyboard", value: desk ? "Shortcut, pill, languages" : (d?.keyboard ?? ""), onPress: open(SCREENS.keySettings) },
    { label: "Haptics", value: d ? (d.haptics.all ? "Every key" : d.haptics.keys ? plural(d.haptics.keys, "key", "keys") : "Off") : "", sub: "Your phone's keyboard", onPress: open(SCREENS.keyHaptics) },
    { label: "Read aloud", value: d ? `${d.voice.label} · ${d.voice.speed}` : "", onPress: open(SCREENS.keyVoices) },
  ];
}

/** What you said, and whether it is kept. */
function saidLines(d: KeybotHomeView | undefined): Line[] {
  return [
    { label: "What you said", value: d ? `Today · ${plural(d.today, "word", "words")}` : "", sub: "Copy anything you spoke, or forget it", onPress: open(SCREENS.keyHistory) },
    {
      label: "Keep what I say", sub: "So you can copy it again. Only the text, never the audio.", right: switchMark("keep"),
      onPress: seq({ kind: "toggleState", path: "keep" }, save("PUT", "/v1/personality", { retainHistory: "$state.keep" }, "Couldn't change that. Try again.")),
    },
  ];
}

const lines = (title: string, ls: Line[]): Node =>
  listCard(ls.map((l) => listRow({ label: l.label, value: l.value || undefined, sub: l.sub, right: l.right, chevron: !l.right, onPress: l.onPress })), { title });

// ---------------------------------------------------------------- the pages

const homeState = (d: HomeData | undefined) => ({ ...DEVICE_STATE, micAsked: false, keep: d?.home?.keepHistory ?? true });

/** The phone keyboard, drawn: two rows of keys, the clay Keybot key beside the space bar. */
function phoneKeys(keyAt: "left" | "right" | "top" = "left", scale = 1): Node {
  const k = (grow_: number, bg: string, kids: Node[] = [], h = 36): Node =>
    box(kids, { flexGrow: grow_, flexBasis: 0, height: Math.round(h * scale), borderRadius: 7 * scale, backgroundColor: bg, alignItems: "center", justifyContent: "center" });
  const mic = icon("mic", { size: Math.round(18 * scale), color: C.paper });
  const top = keyAt === "top"
    ? row([k(1, CLAY, [mic]), ...Array.from({ length: 9 }, () => k(1, C.paper))], { gap: 5 * scale })   // the keyboard's mic starts its top row
    : row(Array.from({ length: 10 }, () => k(1, C.paper)), { gap: 5 * scale });
  const bottom = keyAt === "right"
    ? row([k(1.4, C.track, [], 38), k(4, C.paper, [], 38), k(1, CLAY, [mic], 38), k(1.4, C.track, [], 38)], { gap: 5 * scale })
    : keyAt === "top"
      ? row([k(1.4, C.track, [], 38), k(5, C.paper, [], 38), k(1.4, C.track, [], 38)], { gap: 5 * scale })
      : row([k(1.4, C.track, [], 38), k(1, CLAY, [mic], 38), k(4, C.paper, [], 38), k(1.4, C.track, [], 38)], { gap: 5 * scale });
  return col([top, bottom], { gap: 8 * scale, backgroundColor: C.surface, borderRadius: 22 * scale, paddingTop: 12 * scale, paddingBottom: 14 * scale, paddingHorizontal: 8 * scale });
}

function keybotPhone(ctx: BotsCtx, d: HomeData | undefined) {
  const home = d?.home, s = d?.stats;
  const head = row([
    box([icon("back", { size: 24, label: "Back" })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()),
    botAvatar(KEYBOT, 40),
    col([text("Keybot", { size: 19, weight: 600, lineHeight: 24 }), meta("Your keyboard, in every app")], { gap: 2, flexShrink: 1 }),
    // Keybot's own tiny bot, hopping his keys at the head's right end (where the build draws it).
    ...headerBuddy(ctx, "keybot").flatMap((b) => [grow(), b]),
  ], { gap: 10 });
  return page(ctx, {
    back: false, nav: "keybot", title: "Keybot", gap: 18, state: homeState(d),
    body: [
      head,
      text(dayLine(ctx), { size: 14, color: C.grey70, lineHeight: 20 }),
      // The keyboard with Full Access and the microphone, until this phone has them.
      ...keybotCard(ctx),
      // ---- the numbers (the old Stats tab)
      ...(s ? [monthCard(s)] : [couldntLoad("your numbers")]),
      ...(home ? [weekCard(home.week)] : [couldntLoad("your week")]),
      ...(s ? [
        todayCard(ctx, s),
        appsCard(s, home),
        speakCard(s),
        daysCard(s),
        col([sectionLabel(`The last ${s.window.days} days`), figures(figureTiles(s), 2)], { gap: 10 }),
      ] : home ? [weekAppsCard(home)] : []),
      // ---- the old You tab's lines
      lines("Make it yours", yoursLines(home)),
      lines("Keyboard and voice", keyboardLines(home, false)),
      lines("What you said", saidLines(home)),
      // ---- what the key does
      col([sectionLabel("What the key does"), col([
        row([modeCard(MODES[0]!, 0), modeCard(MODES[1]!, 1)].map((c) => box([c], { flexGrow: 1, flexBasis: 0 })), { gap: 10, alignItems: "stretch" }),
        row([modeCard(MODES[2]!, 2), modeCard(MODES[3]!, 3)].map((c) => box([c], { flexGrow: 1, flexBasis: 0 })), { gap: 10, alignItems: "stretch" }),
      ], { gap: 10 })], { gap: 10 }),
      col([phoneKeys(), meta("The clay key is Keybot. Hold to speak, tap for more.", { size: 12 })], { gap: 10 }),
    ],
  });
}

/** A Mac's bottom row and a PC's, [label, width]; the one key's place in each by its id (desktop.oneKey, main.js oneKey.js). */
const MAC_ROW: Array<[string, number]> = [["fn", 1], ["control", 1.05], ["option", 1], ["command", 1.3], ["", 4.4], ["command", 1.3], ["option", 1]];
const PC_ROW: Array<[string, number]> = [["ctrl", 1.2], ["win", 1], ["alt", 1.1], ["", 4.6], ["alt", 1.1], ["ctrl", 1.2]];
const KEY_AT: Array<{ id: string; row: Array<[string, number]>; at: number }> = [
  { id: "rightCommand", row: MAC_ROW, at: 5 }, { id: "rightOption", row: MAC_ROW, at: 6 },
  { id: "rightCtrl", row: PC_ROW, at: 5 }, { id: "rightAlt", row: PC_ROW, at: 4 },
];

/** The laptop's bottom row, the Keybot key in clay where the chosen key is, named as this computer has it bound. A window
 *  from before the one key (no desktop.oneKey), or Fn: the Mac's row with Fn in clay. */
function laptopKeys(): Node {
  const k = (f: number, label: string, clay: boolean): Node => box([
    ...(clay ? [icon("mic", { size: 13, color: C.paper })] : []),
    text(label, { size: clay ? 10.5 : 10, weight: clay ? 600 : 400, color: clay ? C.paper : C.meta, lineHeight: 13, ...(clay ? { bind: "desktop.holdKey" } : {}) }),
  ], { flexGrow: f, flexBasis: 0, height: 42, borderRadius: 7, backgroundColor: clay ? CLAY : C.paper, alignItems: "center", justifyContent: "center", gap: 2, minWidth: 0 });
  const keys = (r: Array<[string, number]>, at: number): Node =>
    row(r.map(([label, f], i) => k(f, label, i === at)), { gap: 5, padding: 9, borderRadius: 14, backgroundColor: C.surface });
  return col([
    ...KEY_AT.map((x) => when({ eq: ["desktop.oneKey", x.id] }, keys(x.row, x.at))),
    when({ not: { in: ["desktop.oneKey", KEY_AT.map((x) => x.id)] } }, keys(MAC_ROW, 0)),
  ], { gap: 0 });
}

/** This computer's key, as main.js has it bound (desktop state): one line. The one key is held (desktop.hold, its name in
 *  desktop.holdKey); a window from before it names the chord it presses. */
function keyList(): Node {
  const line = (label: string, key: string, bind: string) => row([text(label, { size: 13, lineHeight: 18 }), grow(), kbd(key, bind)], { gap: 10, paddingVertical: 6 });
  return col([
    when({ truthy: "desktop.hold" }, line("Hold to talk, tap to keep listening", "Fn", "desktop.holdKey")),
    when({ falsy: "desktop.hold" }, line("Press to talk", "Ctrl+Space", "desktop.hotkey")),
  ], { gap: 0 });
}

/** The one key's choices (gap 17): a Mac's three, a PC's two, for a window that has the one key (desktop.oneKey). Picked,
 *  main.js binds it at once (app:setConfig oneKey) and answers with the keys as bound. */
const MAC_KEYS = [{ label: "Fn", value: "fn" }, { label: "Right ⌥", value: "rightOption" }, { label: "Right ⌘", value: "rightCommand" }];
const PC_KEYS = [{ label: "Right Ctrl", value: "rightCtrl" }, { label: "Right Alt", value: "rightAlt" }];
function keyChoice(): Node[] {
  const pick = { kind: "desktop.config", key: "oneKey", value: "$state.desktop.oneKey" } as ActionSpec;
  const has: Condition = { truthy: "desktop.oneKey" };
  return [
    when({ all: [has, { eq: ["desktop.os", "mac"] }] }, segmented(MAC_KEYS, "desktop.oneKey", { onChange: pick })),
    when({ all: [has, { eq: ["desktop.os", "windows"] }] }, segmented(PC_KEYS, "desktop.oneKey", { onChange: pick })),
    when({ all: [has, { falsy: "desktop.oneKeyOn" }] }, meta("This key can't be used on this computer right now, so Keybot listens on the key above.", { size: 12 })),
    when({ eq: ["desktop.oneKey", "fn"] }, meta("If Fn opens emoji, set “Press 🌐 key to” to “Do Nothing” in Keyboard settings.", { size: 12 })),
  ];
}

function keybotDesk(ctx: BotsCtx, d: HomeData | undefined) {
  const home = d?.home, s = d?.stats;
  const holdHint = (verb: string) => [
    when({ truthy: "desktop.hold" }, row([text(verb, { size: 12, color: C.grey70, lineHeight: 16 }), kbd("Fn", "desktop.holdKey")], { gap: 5 })),
    when({ falsy: "desktop.hold" }, row([text("Press", { size: 12, color: C.grey70, lineHeight: 16 }), kbd("Ctrl+Space", "desktop.hotkey")], { gap: 5 })),
  ];
  const hints: Node[] = [
    col(holdHint("Hold"), { gap: 0 }),
    col(holdHint("Select, then hold"), { gap: 0 }),
    text("End with “in Hindi”", { size: 12, color: C.grey70, lineHeight: 16 }),
    text("Speak in the reply box", { size: 12, color: C.grey70, lineHeight: 16 }),
  ];
  return page(ctx, {
    nav: "keybot", title: "Keybot", gap: 18, maxWidth: DESK_WIDTH, state: homeState(d),
    body: [
      row([
        botAvatar(KEYBOT, 48),
        col([title("Keybot", { size: 26 }), text(`Your keyboard, in every app. ${dayLine(ctx)}`, { size: 14, color: C.grey70, lineHeight: 19 })], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...headerBuddy(ctx, "keybot"),
        when({ truthy: "desktop.hold" }, row([kbd("Fn", "desktop.holdKey"), text("Hold to speak in any app", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 8 })),
        when({ falsy: "desktop.hold" }, row([kbd("Ctrl+Space", "desktop.hotkey"), text("Press to speak in any app", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 8 })),
        button("Settings", open(SCREENS.keySettings), { kind: "secondary", size: "md", icon: "settings" }),
      ], { gap: 14, flexWrap: "wrap" }),
      // This computer's Accessibility and microphone, where the window can tell, until they are on.
      ...keybotCard(ctx),
      // ---- the numbers (the old Stats tab, the desk's Insights)
      twoCols([s ? monthCard(s) : couldntLoad("your numbers")], [home ? weekCard(home.week) : couldntLoad("your week")], { gap: 16 }),
      ...(s ? [
        twoCols([todayCard(ctx, s), speakCard(s)], [appsCard(s, home)], { gap: 16 }),
        twoCols([daysCard(s, 44)], [col([sectionLabel(`The last ${s.window.days} days`), figures(figureTiles(s), 2)], { gap: 10 })], { gap: 16 }),
      ] : home ? [weekAppsCard(home)] : []),
      // ---- the old You tab's lines, and this computer's keys
      twoCols([
        lines("Make it yours", yoursLines(home)),
        lines("What you said", saidLines(home)),
      ], [
        lines("Keyboard and voice", keyboardLines(home, true)),
        card([
          sectionLabel("Shortcut keys"), laptopKeys(),
          when({ truthy: "desktop.oneKey" }, meta("The clay key is Keybot. Hold to talk, tap to keep listening. Ask, notes and your bots are on it too: just say so.", { size: 12 })),
          when({ falsy: "desktop.oneKey" }, meta("The clay key is Keybot. Hold to speak, tap twice to keep listening.", { size: 12 })),
          keyList(),
        ], { gap: 10, radius: 18 }),
      ], { gap: 16 }),
      col([sectionLabel("What the key does"), row(MODES.map((m, i) => box([modeCard(m, i, hints[i])], { flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 12, alignItems: "stretch" })], { gap: 10 }),
    ],
  });
}

// ===================================================================== bots.keybot.tone

const GROUP_GLYPH: Record<string, Glyph> = { chats: "chats", mail: "mail", work: "work" };
const presetName = (id: string | null) => TONE_PRESETS.find((p) => p.id === id)?.name ?? null;

/** The state a tone page starts from: the kind it opens on, each kind's preset (and its name), the little things. */
function toneState(d: KeybotToneView): Record<string, unknown> {
  const tone: Record<string, string> = {}, toneName: Record<string, string> = {}, little: Record<string, unknown> = {};
  for (const g of d.groups) {
    tone[g.id] = g.preset ?? "";
    toneName[g.id] = presetName(g.preset) ?? "As you say it";
    little[g.id] = { noStop: g.noStop, latin: g.latin, signOff: g.signOff };
  }
  return { group: d.focus, tone, toneName, little };
}

/** A kind of app in the list: picked shows on the surface grey. */
function groupRow(g: KeybotToneView["groups"][number], desk: boolean): Node {
  const def = TONE_GROUP_DEFS.find((x) => x.id === g.id)!;
  const on = whenEq("group", g.id, C.surface, C.paper);
  return row([
    appSquare(GROUP_GLYPH[g.id]!, desk ? 34 : 32, whenEq("group", g.id, C.paper, C.surface)),
    desk
      ? col([text(def.label, { size: 15, weight: 500, lineHeight: 20 }), meta(def.appsLine, { size: 12 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 })
      : text(def.label, { size: 15, weight: 500, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }),
    text(presetName(g.preset) ?? "As you say it", { size: 13, color: C.grey70, lineHeight: 17, bind: `toneName.${g.id}`, align: "right" }),
    ...(desk ? [] : [icon("chevron", { size: 16, color: C.meta })]),
  ], { gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, backgroundColor: on, minHeight: 56 }, { kind: "setState", path: "group", value: g.id });
}

/** The four presets for one kind: the chosen one in clay. A tap chooses and saves it. */
function presetGrid(groupId: string): Node {
  const cardOf = (p: (typeof TONE_PRESETS)[number]) => col([
    text(p.name, { size: 15, weight: 600, lineHeight: 20 }),
    meta(p.blurb, { size: 12 }),
  ], {
    gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, backgroundColor: C.paper,
    borderColor: whenEq(`tone.${groupId}`, p.id, CLAY, C.line), flexGrow: 1, flexBasis: 0, minWidth: 0,
  }, seq(
    { kind: "setState", path: `tone.${groupId}`, value: p.id },
    { kind: "setState", path: `toneName.${groupId}`, value: p.name },
    save("POST", "/v1/keybot/tone", { group: groupId, preset: p.id }, "Couldn't change the tone. Try again."),
  ));
  return col([0, 2].map((i) => row([cardOf(TONE_PRESETS[i]!), cardOf(TONE_PRESETS[i + 1]!)], { gap: 10, alignItems: "stretch" })), { gap: 10 });
}

/** One kind's line in its chosen tone (or as said, when none is chosen), following the state. */
function sampleFor(groupId: string, desk: boolean): Node[] {
  const label = TONE_GROUP_DEFS.find((g) => g.id === groupId)!.label;
  const variant = (preset: string, name: string, line: string): Node => when({ eq: [`tone.${groupId}`, preset] }, col([
    meta(`${label} · ${name}`, { size: 12 }),
    text(line, { size: desk ? 15 : 14, lineHeight: desk ? 21 : 19 }),
  ], { gap: desk ? 6 : 2 }));
  return [...TONE_PRESETS.map((p) => variant(p.id, p.name, p.sample)), variant("", "As you say it", TONE_SAID)];
}

function tonePhone(ctx: BotsCtx, d: KeybotToneView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Tone per app", gap: 14, body: [phoneHead("Tone per app"), couldntLoad("your tones")] });
  return page(ctx, {
    nav: "keybot", title: "Tone per app", gap: 14, state: toneState(d),
    body: [
      phoneHead("Tone per app"),
      text("Keybot writes like you, a bit different per app.", { size: 14, color: C.grey70, lineHeight: 19 }),
      box(d.groups.flatMap((g, i) => [...(i ? [divider()] : []), groupRow(g, false)]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ...TONE_GROUP_DEFS.map((g) => when({ eq: ["group", g.id] }, col([sectionLabel(`Presets for ${g.label}`), presetGrid(g.id)], { gap: 10 }))),
      col([sectionLabel("One line, each tone"), box([
        row([glyph("chats", { size: 16, color: C.meta }), meta(`You said: “${TONE_SAID}”`, { size: 13, style: { flexShrink: 1 } })], { gap: 8, paddingVertical: 12, paddingHorizontal: 16 }),
        ...TONE_GROUP_DEFS.flatMap((g) => [divider(), col(sampleFor(g.id, false), { paddingVertical: 10, paddingHorizontal: 16 })]),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 10 }),
    ],
    footer: [row([text(`Teach Keybot your style · ${d.train.done} of ${d.train.total} done`, { size: 14, weight: 500, lineHeight: 18 }), icon("chevron", { size: 16 })],
      { gap: 8, justifyContent: "center", minHeight: 44 }, open(SCREENS.keyTrain))],
  });
}

function toneDesk(ctx: BotsCtx, d: KeybotToneView | undefined) {
  const head = deskHead("Tone per app", "Keybot writes like you, a bit different per app.", d
    ? [button(`Teach Keybot your style · ${d.train.done} of ${d.train.total} done`, open(SCREENS.keyTrain), { kind: "secondary", size: "md" })] : []);
  if (!d) return page(ctx, { nav: "keybot", title: "Tone per app", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your tones")] });
  const little = (g: (typeof TONE_GROUP_DEFS)[number]) => when({ eq: ["group", g.id] }, deskCard(`Little things in ${g.label}`, [
    toggleRow("Skip the full stop at the end", `little.${g.id}.noStop`, save("POST", "/v1/keybot/tone", { group: g.id, noStop: `$state.little.${g.id}.noStop` }), "No full stop to end a message"),
    toggleRow("Write Hindi words in English letters", `little.${g.id}.latin`, save("POST", "/v1/keybot/tone", { group: g.id, latin: `$state.little.${g.id}.latin` }), "“haan”, “kal”, “7 baje”"),
    toggleRow("Add a sign-off", `little.${g.id}.signOff`, save("POST", "/v1/keybot/tone", { group: g.id, signOff: `$state.little.${g.id}.signOff` }), "Your name at the end, where it fits"),
  ], { gap: 0 }));
  return page(ctx, {
    nav: "keybot", title: "Tone per app", gap: 18, maxWidth: DESK_WIDTH, state: toneState(d),
    body: [
      head,
      twoCols([
        col([sectionLabel("Apps"), box(d.groups.flatMap((g, i) => [...(i ? [divider()] : []), groupRow(g, true)]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
        ...TONE_GROUP_DEFS.map(little),
      ], [
        ...TONE_GROUP_DEFS.map((g) => when({ eq: ["group", g.id] }, col([sectionLabel(`Presets for ${g.label}`), presetGrid(g.id)], { gap: 8 }))),
        col([sectionLabel("One line, each tone"), card([
          row([text("You said:", { size: 13, color: C.meta, lineHeight: 17 }), text(`“${TONE_SAID}”`, { size: 13, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8 }),
          row(TONE_GROUP_DEFS.map((g) => col(sampleFor(g.id, true), {
            flexGrow: 1, flexBasis: 0, minWidth: 0, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5,
            borderColor: whenEq("group", g.id, CLAY, C.line),
          })), { gap: 10, alignItems: "stretch" }),
        ], { gap: 12, radius: 18 })], { gap: 8 }),
        meta("Keybot picks the tone from the app you’re in. Say “make it formal” any time to change just one message.", { size: 12 }),
      ], { left: 330, gap: 24 }),
    ],
  });
}

// ===================================================================== bots.keybot.words

type WordRow = { key: string; word: string; source: "added" | "learned"; kind: string; heard: string; was?: string; recent?: KeybotWordsView["added"][number]["recent"]; forget: ActionSpec };

function wordRows(d: KeybotWordsView): WordRow[] {
  const said = (u: number | undefined) => (u === undefined ? "" : u === 0 ? "not heard yet" : `said ${plural(u, "time", "times")}`);
  return [
    ...d.added.map((w): WordRow => ({
      key: `a:${w.word}`, word: w.word, source: "added", kind: w.kind === "pair" ? "Spelling" : "Word", was: w.was,
      heard: said(w.uses) || (w.was ? `heard as “${w.was}”` : "you added it"), recent: w.recent,
      forget: write("POST", "/v1/words", { remove: w.word, kind: w.kind }, `Forgot “${w.word}”`, "Couldn't forget that word. Try again."),
    })),
    ...d.learned.map((w): WordRow => ({
      key: `l:${w.word}`, word: w.word, source: "learned", kind: "Your word", heard: w.means || "heard in what you say", recent: w.recent,
      forget: write("POST", "/v1/keybot/learned/forget", { kind: "word", key: w.word }, `Forgot “${w.word}”`, "Couldn't forget that word. Try again."),
    })),
  ];
}

const sourceIs = (src: "added" | "learned"): Condition => ({ any: [{ eq: ["filter", "all"] }, { eq: ["filter", src] }] });

function badge(source: "added" | "learned"): Node {
  return source === "added"
    ? row([text("Added", { size: 12, lineHeight: 16 })], { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: C.outline, flexShrink: 0 })
    : row([text("Learned from you", { size: 12, color: C.grey70, lineHeight: 16 })], { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 10, backgroundColor: C.surface, flexShrink: 0 });
}

/** Adding a word: Enter or Add saves it (POST /v1/words), and Keybot spells it that way from then on. */
const addWord: ActionSpec = {
  kind: "condition", if: { falsy: "newWord" }, then: toast("Type the word first"),
  else: call("POST", "/v1/words", { add: "$state.newWord" }, {
    ok: seq({ kind: "clearState", path: "newWord" }, { kind: "setState", path: "adding", value: false }, toast("Added. Keybot spells it your way now."), { kind: "refresh" }),
    fail: oops("Couldn't add that word. Try again."),
  }),
};

function addRow(): Node {
  return row([
    box([field("newWord", "A name, a place, a work word", { onSubmit: addWord, label: "New word" })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    button("Add", addWord, { size: "md" }),
    quietButton("Cancel", { kind: "setState", path: "adding", value: false }, { size: "md" }),
  ], { gap: 8 });
}

function wordsChips(d: KeybotWordsView): Node {
  const c = (label: string, value: string) => row([text(label, { size: 13, lineHeight: 17, style: { color: whenEq("filter", value, C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq("filter", value, C.ink, C.outline), backgroundColor: whenEq("filter", value, C.ink, C.paper),
  }, { kind: "setState", path: "filter", value });
  return row([c("All", "all"), c(`Learned from you · ${n(d.learned.length)}`, "learned"), c(`Added · ${n(d.added.length)}`, "added")], { gap: 8, flexWrap: "wrap" });
}

/**
 * How the saved words do (the old Stats tab's Dictionary card): the share that turned up this month, the most used,
 * the list's counts, and the ones never heard, named so they can be pruned or spelled the way they are said.
 */
function wordUse(d: KeybotWordsView): Node | null {
  const u = d.use;
  if (!u || !u.saved) return null;
  return card([
    sectionHead("Your words at work · this month"),
    row([text(`${u.inUse}%`, { size: 26, weight: 700, tracking: -0.5, lineHeight: 32 }), meta(`in use · ${n(u.used)} of ${n(u.saved)} saved words turned up`, { size: 13, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-end", flexWrap: "wrap" }),
    meter(u.used, u.saved, { color: CLAY }),
    ...(u.top.length ? [sectionLabel("Most used"), hbars(u.top.slice(0, 5).map((w) => ({ label: w.word, value: w.uses, text: `${n(w.uses)}×` })))] : []),
    col([
      statRow("Saved", n(u.saved)), statRow("Used", n(u.used)), statRow("Never used", n(u.unused)), statRow("What you said, read for them", n(u.scanned)),
    ]),
    ...(u.unusedWords.length ? [col([sectionLabel("Never turned up"), text(u.unusedWords.join(", "), { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 6 })] : []),
  ], { gap: 10, radius: 18 });
}

/** A spelling: when Keybot hears this, it writes that (the old Dictionary's pairs). The whole list goes back, with the new one. */
function addSpelling(d: KeybotWordsView): ActionSpec {
  return {
    kind: "condition", if: { any: [{ falsy: "heard" }, { falsy: "writeAs" }] }, then: toast("Say what it hears, and how to write it"),
    else: call("PUT", "/v1/profile", { dictionary: [...d.pairs, { word: "$state.heard", replacement: "$state.writeAs" }] }, {
      ok: seq({ kind: "clearState", path: "heard" }, { kind: "clearState", path: "writeAs" }, toast("Added. Keybot writes it your way now."), { kind: "refresh" }),
      fail: oops("Couldn't add that spelling. Try again."),
    }),
  };
}

/** Spellings: what it hears, what it writes; the pairs already kept are in the list above, as Spelling. */
function spellingsCard(d: KeybotWordsView): Node {
  return card([
    sectionHead("Spellings"),
    meta("When Keybot hears one thing, it writes another: a name it mishears, a short form you want written out.", { size: 13, lineHeight: 18 }),
    field("heard", "When I say, like “sarvari”", { label: "When I say" }),
    field("writeAs", "Write it as, like “Sharvari”", { label: "Write it as", onSubmit: addSpelling(d) }),
    button("Add the spelling", addSpelling(d), { kind: "secondary", size: "md" }),
  ], { gap: 10, radius: 18 });
}

const addShortcut: ActionSpec = {
  kind: "condition", if: { any: [{ falsy: "say" }, { falsy: "get" }] }, then: toast("Give it a name and what it writes"),
  else: call("POST", "/v1/snippets", { say: "$state.say", get: "$state.get" }, {
    ok: seq({ kind: "clearState", path: "say" }, { kind: "clearState", path: "get" }, toast("Added. Say its name and the whole thing is written."), { kind: "refresh" }),
    fail: oops("Couldn't add that shortcut. Try again."),
  }),
};

/** Shortcuts (the desk's Words page, "Said short, written long"): say a name, the whole thing is written. */
function shortcutsCard(d: KeybotWordsView): Node {
  const one = (x: { say: string; get: string }): Node => row([
    col([text(x.say, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(x.get, { size: 12, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    box([glyph("forget", { size: 18, color: C.grey70, label: `Remove ${x.say}` })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
      write("POST", "/v1/snippets", { remove: x.say }, `Removed “${x.say}”`, "Couldn't remove that shortcut. Try again.")),
  ], { gap: 8, minHeight: 48 });
  return card([
    sectionHead(d.snippets.length ? `Shortcuts · ${n(d.snippets.length)}` : "Shortcuts"),
    meta("Say a shortcut's name and the whole thing is written: an address, a UPI id, a sign-off you type every day.", { size: 13, lineHeight: 18 }),
    ...(d.snippets.length ? [col(d.snippets.slice(0, 40).map(one))] : []),
    field("say", "Its name, like “my upi”", { label: "Shortcut name" }),
    field("get", "What it writes", { label: "What it writes", onSubmit: addShortcut }),
    button("Add the shortcut", addShortcut, { kind: "secondary", size: "md" }),
  ], { gap: 10, radius: 18 });
}

const WORDS_STATE = { heard: "", writeAs: "", say: "", get: "" };

function wordsPhone(ctx: BotsCtx, d: KeybotWordsView | undefined) {
  const q = String(ctx.params.q ?? "");
  if (!d) return page(ctx, { nav: "keybot", title: "Your words", gap: 14, body: [phoneHead("Your words"), couldntLoad("your words")] });
  const total = d.total.added + d.total.learned;
  const rows = wordRows(d);
  const section = (src: "added" | "learned", label: string): Node => {
    const list = rows.filter((r) => r.source === src).slice(0, 40);
    if (!list.length) return { type: "Stack", style: { height: 0 } };
    const more = rows.filter((r) => r.source === src).length - list.length;
    return when(sourceIs(src), col([
      sectionLabel(`${label} · ${n(rows.filter((r) => r.source === src).length)}`),
      box(list.flatMap((r, i) => [
        ...(i ? [divider()] : []),
        row([
          col([text(r.word, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(r.heard, { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          badge(r.source),
        ], { gap: 8, paddingVertical: 11, paddingLeft: 16, paddingRight: 14 }, { kind: "setState", path: "sel", value: r.key }),
        when({ eq: ["sel", r.key] }, row([
          meta(r.recent ? `Last said: “${r.recent.text}”` : "Not said since it was learned.", { size: 12, lines: 2, style: { flexGrow: 1, flexShrink: 1 } }),
          button("Forget it", r.forget, { kind: "secondary", size: "md" }),
        ], { gap: 10, paddingHorizontal: 16, paddingBottom: 12 })),
      ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ...(more > 0 ? [meta(`And ${n(more)} more. Search to find one.`, { size: 12 })] : []),
    ], { gap: 8 }));
  };
  return page(ctx, {
    nav: "keybot", title: "Your words", gap: 14, state: { q, filter: "all", sel: "", adding: false, newWord: "", ...WORDS_STATE },
    body: [
      phoneHead("Your words"),
      col([text(plural(total, "word", "words"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
        meta(`Keybot knows now · ${n(d.total.learned)} learned from you`, { size: 13 })], { gap: 2 }),
      searchField(SCREENS.keyWords, "Search names, places, work words"),
      ...(q ? [searchLine(SCREENS.keyWords, q)] : []),
      ...(total ? [wordsChips(d)] : []),
      ...(!total
        ? [emptyState({ pose: "hello", title: "No words yet", body: "Names, places, the words only your team uses. Add one and Keybot spells it your way, everywhere." })]
        : !rows.length ? [meta("No word matches that. Try fewer letters.", { size: 14 })]
        : [section("added", "Added by you"), section("learned", "Learned from you")]),
      ...(wordUse(d) ? [wordUse(d)!] : []),
      spellingsCard(d),
      shortcutsCard(d),
    ],
    footer: [
      when({ falsy: "adding" }, primaryButton("Add a word", { kind: "setState", path: "adding", value: true }, { icon: "plus", wide: true })),
      when({ truthy: "adding" }, addRow()),
    ],
  });
}

function wordsDesk(ctx: BotsCtx, d: KeybotWordsView | undefined) {
  const q = String(ctx.params.q ?? "");
  const head = deskHead("Your words", d ? `${plural(d.total.added + d.total.learned, "word", "words")} Keybot knows now · ${n(d.total.learned)} learned from you` : "The words Keybot spells your way",
    [when({ falsy: "adding" }, button("Add a word", { kind: "setState", path: "adding", value: true }, { size: "md", icon: "plus" }))]);
  if (!d) return page(ctx, { nav: "keybot", title: "Your words", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your words")] });
  const rows = wordRows(d).slice(0, 80);
  const COLS = [{ w: 1.2 }, { fixed: 92 }, { w: 1 }, { fixed: 132 }] as const;
  const cellStyle = (j: number) => ("fixed" in COLS[j]! ? { width: (COLS[j] as { fixed: number }).fixed, flexShrink: 0 } : { flexGrow: (COLS[j] as { w: number }).w, flexBasis: 0, minWidth: 0 });
  const headRow = row(["Word", "Kind", "Heard", "From"].map((h, j) => box([sectionLabel(h, { size: 10.5 })], cellStyle(j))), { gap: 12, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 });
  const wordRow = (r: WordRow): Node => row([
    box([text(r.word, { size: 14, weight: 600, lineHeight: 19, lines: 1 })], cellStyle(0)),
    box([text(r.kind, { size: 13, color: C.grey70, lineHeight: 17 })], cellStyle(1)),
    box([meta(r.heard, { size: 13, lines: 1 })], cellStyle(2)),
    box([text(r.source === "added" ? "Added" : "Learned from you", { size: 13, color: r.source === "added" ? C.ink : C.grey70, lineHeight: 17 })], cellStyle(3)),
  ], { gap: 12, paddingHorizontal: 16, minHeight: 40, backgroundColor: whenEq("sel", r.key, C.surface, C.paper) }, { kind: "setState", path: "sel", value: r.key });
  const group = (src: "added" | "learned", label: string): Node[] => {
    const list = rows.filter((r) => r.source === src);
    return list.length ? [when(sourceIs(src), col([
      box([sectionLabel(`${label} · ${n(list.length)}`)], { paddingTop: 8, paddingBottom: 6, paddingHorizontal: 16 }),
      ...list.map(wordRow),
    ]))] : [];
  };
  const panel = (r: WordRow): Node => when({ eq: ["sel", r.key] }, col([
    col([sectionLabel("Selected word"), text(r.word, { size: 24, weight: 700, tracking: -0.4, lineHeight: 30 }),
      meta(`${r.kind} · ${r.source === "added" ? "Added by you" : "Learned from you"}`, { size: 12 })], { gap: 2 }),
    col([
      ...(r.heard ? [row([meta(r.source === "learned" ? "Means" : "Heard", { size: 13 }), grow(), text(r.heard, { size: 13, lineHeight: 17, align: "right", style: { flexShrink: 1 } })], { gap: 10, paddingVertical: 8 })] : []),
      ...(r.was ? [divider(), row([meta("Keybot writes it as", { size: 13 }), grow(), text(r.word, { size: 13, weight: 600, lineHeight: 17 })], { gap: 10, paddingVertical: 8 })] : []),
    ]),
    ...(r.recent ? [col([meta("Recently said", { size: 13 }), col([
      text(`“${r.recent.text}”`, { size: 13, lineHeight: 18, lines: 3 }),
      meta(`${dayLabel(ctx, Date.parse(r.recent.at))} · ${r.recent.app}`, { size: 12 }),
    ], { gap: 2, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 })], { gap: 6 })] : []),
    row([button("Forget it", r.forget, { kind: "secondary", size: "md" })], { gap: 8 }),
  ], { gap: 12 }));
  return page(ctx, {
    nav: "keybot", title: "Your words", gap: 18, maxWidth: DESK_WIDTH,
    state: { q, filter: "all", sel: rows[0]?.key ?? "", adding: false, newWord: "", ...WORDS_STATE },
    body: [
      head,
      when({ truthy: "adding" }, card([addRow()], { padding: 12, radius: 18 })),
      row([box([searchField(SCREENS.keyWords, "Search your words")], { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 220 }), wordsChips(d)], { gap: 8, flexWrap: "wrap" }),
      ...(q ? [searchLine(SCREENS.keyWords, q)] : []),
      !rows.length
        ? (d.total.added + d.total.learned
          ? meta("No word matches that. Try fewer letters.", { size: 14 })
          : emptyState({ pose: "hello", title: "No words yet", body: "Names, places, the words only your team uses. Add one and Keybot spells it your way, everywhere.", action: { label: "Add a word", onPress: { kind: "setState", path: "adding", value: true } } }))
        : twoCols([
          box([headRow, divider(), ...group("added", "Added by you"), ...group("learned", "Learned from you")], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden", paddingBottom: 6 }),
        ], [
          card(rows.map(panel), { radius: 18, gap: 0 }),
        ], { leftWeight: 2.6, rightWeight: 1, gap: 16 }),
      twoCols([...(wordUse(d) ? [wordUse(d)!] : []), spellingsCard(d)], [shortcutsCard(d)], { gap: 16 }),
    ],
  });
}

// ===================================================================== bots.keybot.voices

const SPEEDS = [{ label: "0.8×", value: "0.8" }, { label: "Normal", value: "1" }, { label: "1.25×", value: "1.25" }, { label: "1.5×", value: "1.5" }];

function voiceCard(v: KeybotVoicesView["voices"][number], desk: boolean, play = false): Node {
  const choose = seq({ kind: "setState", path: "voice", value: v.id }, save("PUT", "/v1/personality", { ttsVoice: v.id }, "Couldn't change the voice. Try again."));
  const frame = {
    borderRadius: 18, borderWidth: 1.5, backgroundColor: C.paper,
    borderColor: whenEq("voice", v.id, CLAY, C.line), ...(desk ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : {}),
  };
  if (!play) {
    return row([
      col([text(v.label, { size: 15, weight: 600, lineHeight: 20 }), meta(v.blurb, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      when({ eq: ["voice", v.id] }, text("In use", { size: 12, weight: 600, lineHeight: 16 })),
    ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 60, ...frame }, choose);
  }
  // With a play button (KeyVoices): hear it without choosing it; the rest of the card chooses it. One plays at a time
  // (the app's own), at the speed picked below, and it stops when they leave the page.
  return col([
    row([
      playButton(v.id, `/v1/keybot/voices/${v.id}/sample?speed=$state.read.speed`, `Hear ${v.label}`),
      row([
        col([text(v.label, { size: 15, weight: 600, lineHeight: 20 }), ...playingSub(v.id, v.blurb)], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        when({ eq: ["voice", v.id] }, text("In use", { size: 12, weight: 600, lineHeight: 16 })),
      ], { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44 }, choose),
    ], { gap: 12 }),
    playingLine(v.id, CLAY),
  ], { gap: 10, paddingVertical: 10, paddingLeft: 10, paddingRight: 14, minHeight: 64, ...frame });
}

const readSave = (key: string) => save("PUT", "/v1/keybot/prefs", { read: { [key]: `$state.read.${key}` } });

function voicesPhone(ctx: BotsCtx, d: KeybotVoicesView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Read aloud", gap: 14, body: [phoneHead("Read aloud"), couldntLoad("the voices")] });
  return page(ctx, {
    nav: "keybot", title: "Read aloud", gap: 14, state: { voice: d.current, read: d.read, playing: null },
    body: [
      phoneHead("Read aloud"),
      text("Pick the voice Keybot reads aloud in.", { size: 14, color: C.grey70, lineHeight: 19 }),
      col([sectionLabel("Voices"), ...d.voices.map((v) => voiceCard(v, false, canPlay(ctx)))], { gap: 8 }),
      col([sectionLabel("Speed"), segmented(SPEEDS, "read.speed", { onChange: readSave("speed") })], { gap: 8 }),
      meta("Keybot reads Ask’s answers to you in this voice.", { size: 12 }),
    ],
  });
}

function voicesDesk(ctx: BotsCtx, d: KeybotVoicesView | undefined) {
  const head = deskHead("Read aloud", "Pick the voice Keybot reads aloud in.");
  if (!d) return page(ctx, { nav: "keybot", title: "Read aloud", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("the voices")] });
  const pairs: Node[] = [];
  for (let i = 0; i < d.voices.length; i += 2) {
    pairs.push(row([voiceCard(d.voices[i]!, true, canPlay(ctx)), d.voices[i + 1] ? voiceCard(d.voices[i + 1]!, true, canPlay(ctx)) : box([], { flexGrow: 1, flexBasis: 0 })], { gap: 10, alignItems: "stretch" }));
  }
  return page(ctx, {
    nav: "keybot", title: "Read aloud", gap: 18, maxWidth: DESK_WIDTH, state: { voice: d.current, read: d.read, playing: null },
    body: [
      head,
      twoCols([
        col([sectionLabel("Voices"), ...pairs], { gap: 10 }),
        col([sectionLabel("Speed"), segmented(SPEEDS, "read.speed", { onChange: readSave("speed") })], { gap: 8 }),
      ], [
        box([text("Keybot reads Ask’s answers to you in this voice, here and on your phone.", { size: 13, color: C.grey70, lineHeight: 18 })],
          { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }),
      ], { leftWeight: 1.7, rightWeight: 1, gap: 24 }),
    ],
  });
}

// ===================================================================== bots.keybot.train

/** Keybot's turn: its face, what it says, and the line to say (in clay when it is the one now). */
function botTurn(says: string, line: string, now: boolean): Node {
  return row([
    botAvatar(KEYBOT, 30),
    col([
      text(says, { size: 14, color: C.grey70, lineHeight: 19 }),
      box([text(`“${line}”`, { size: 15, lineHeight: 21 })], {
        alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 14, borderWidth: now ? 1.5 : 1, borderColor: now ? CLAY : C.line,
        borderTopLeftRadius: 6, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
      }),
    ], { gap: 6, flexShrink: 1, minWidth: 0 }),
  ], { gap: 10, alignItems: "flex-start" });
}

function youTurn(said: string): Node {
  return col([
    box([text(said, { size: 15, color: C.paper, lineHeight: 21 })], {
      backgroundColor: C.ink, paddingVertical: 10, paddingHorizontal: 14,
      borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 6, maxWidth: "85%",
    }),
    meta("You said", { size: 12 }),
  ], { gap: 4, alignItems: "flex-end" });
}

const kindFor = (k: string) => (k === "Work" ? "for work" : k === "Mail" ? "for mail" : "for a chat");

function conversation(d: KeybotTrainView): Node[] {
  const cur = d.lines[d.current];
  if (!cur) return [];
  if (d.previous < 0) return [botTurn("Say this your way:", cur.text, true)];
  const prev = d.lines[d.previous]!;
  return [botTurn("Say this your way:", prev.text, false), youTurn(prev.said ?? ""), botTurn(`Got it. Next one, ${kindFor(cur.kind)}:`, cur.text, true)];
}

function progress(d: KeybotTrainView): Node {
  const left = d.lines.filter((l) => !l.said && !l.skipped).length;
  return col([
    row([text(`${d.done} of ${d.lines.length}`, { size: 14, weight: 600, lineHeight: 18 }), grow(),
      meta(left ? `about ${Math.max(1, Math.round(left * 0.3))} min left` : "all done", { size: 12 })]),
    row(d.lines.map((l, i) => box([], { flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3, backgroundColor: l.said ? C.ink : i === d.current ? CLAY : C.track })), { gap: 4 }),
  ], { gap: 8 });
}

function learnedCard(d: KeybotTrainView, desk: boolean): Node {
  if (!d.learned.length) return col([sectionLabel("What I learned"), meta("Nothing yet. Say a line your way, and what it hears shows up here.", { size: 13 })], { gap: 8 });
  return col([sectionLabel("What I learned"), box(d.learned.flatMap((l, i) => [
    ...(i ? [divider()] : []),
    row([
      col([text(l.title, { size: 14, lineHeight: 19 }), ...(l.sub ? [meta(l.sub, { size: 12, lines: 2 })] : [])], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 10 }),
      desk
        ? row([text("Not me", { size: 12, color: C.grey70, lineHeight: 16 })], { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line },
          write("POST", "/v1/keybot/learned/forget", { kind: l.kind, key: l.key }, "Forgotten", "Couldn't forget that. Try again."))
        : box([text("Not me", { size: 12, color: C.meta, lineHeight: 16 })], { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
          write("POST", "/v1/keybot/learned/forget", { kind: l.kind, key: l.key }, "Forgotten", "Couldn't forget that. Try again.")),
    ], { gap: 10, paddingLeft: 16, paddingRight: 6, minHeight: 52 }),
  ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 });
}

function trainActions(d: KeybotTrainView, client: "phone" | "desktop"): Node[] {
  if (d.current < 0) return [];
  const next: ActionSpec = {
    kind: "condition", if: { falsy: "said" }, then: toast("Say it your way first"),
    else: call("POST", "/v1/keybot/train", { line: d.current, said: "$state.said" }, {
      ok: seq({ kind: "clearState", path: "said" }, { kind: "refresh" }), fail: oops("Couldn't learn from that. Try again."),
    }),
  };
  const skip = write("POST", "/v1/keybot/train/skip", { line: d.current }, undefined, "Couldn't skip it. Try again.");
  return [
    field("said", client === "desktop" ? "Type it, or hold your Keybot key and say it" : "Type it, or hold the clay key and say it", { onSubmit: next, label: "Your way", returnKey: "send" }),
    row([
      box([button("Skip", skip, { kind: "secondary", wide: true, size: client === "desktop" ? "md" : "lg" })], { flexGrow: 1, flexBasis: 0 }),
      box([button("That's how I say it", next, { wide: true, icon: "check", size: client === "desktop" ? "md" : "lg" })], { flexGrow: 2.4, flexBasis: 0 }),
    ], { gap: 8 }),
  ];
}

function trainDone(): Node {
  return col([
    blip("done", 140),
    text("All ten done", { size: 18, weight: 600, lineHeight: 24, align: "center" }),
    meta("Keybot writes more like you now. It keeps learning from what you say.", { size: 13, align: "center" }),
    button("Start again", write("POST", "/v1/keybot/train/restart", undefined, undefined, "Couldn't start again. Try again."), { kind: "secondary", size: "md" }),
  ], { gap: 10, alignItems: "center", paddingVertical: 8 });
}

function trainPhone(ctx: BotsCtx, d: KeybotTrainView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Teach your style", gap: 14, body: [phoneHead("Teach your style"), couldntLoad("your lines")] });
  return page(ctx, {
    nav: "keybot", title: "Teach your style", gap: 14, state: { said: "" },
    body: [
      phoneHead("Teach your style"),
      progress(d),
      ...(d.current < 0 ? [trainDone()] : [col(conversation(d), { gap: 10 })]),
      learnedCard(d, false),
    ],
    footer: trainActions(d, "phone"),
  });
}

function trainDesk(ctx: BotsCtx, d: KeybotTrainView | undefined) {
  const head = deskHead("Teach your style", "Say 10 everyday lines your way. Keybot picks up how you really talk.");
  if (!d) return page(ctx, { nav: "keybot", title: "Teach your style", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your lines")] });
  const lastDone = d.lines.reduce((m, l, i) => (l.said || l.skipped ? i + 1 : m), 0);
  const lineRow = (l: KeybotTrainView["lines"][number], i: number): Node => row([
    box([l.said ? statusMark("done") : i === d.current ? statusMark("working", { color: CLAY }) : l.skipped ? statusMark("waiting") : box([], { width: 8, height: 8 })], { width: 12, alignItems: "center" }),
    text(String(i + 1), { size: 12, color: C.meta, lineHeight: 16, style: { width: 20 } }),
    text(`“${l.text}”`, { size: 13, weight: i === d.current ? 600 : 400, color: l.said || l.skipped ? C.idle : C.ink, lineHeight: 18, style: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 4 } }),
    meta(l.kind, { size: 12 }),
  ], { gap: 8, minHeight: 30 });
  return page(ctx, {
    nav: "keybot", title: "Teach your style", gap: 18, maxWidth: DESK_WIDTH, state: { said: "" },
    body: [
      head,
      twoCols([
        card([
          progress(d),
          ...(lastDone ? [row([text(lastDone === 1 ? "Line 1 done" : `Lines 1 to ${lastDone} done`, { size: 11, color: C.meta, lineHeight: 14 })],
            { alignSelf: "center", backgroundColor: C.surface, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 10 })] : []),
          ...(d.current < 0 ? [trainDone()] : conversation(d)),
          ...trainActions(d, "desktop"),
        ], { gap: 14, radius: 18, style: { paddingHorizontal: 18 } }),
      ], [
        learnedCard(d, true),
        col([sectionLabel(`All ${d.lines.length} lines`), card(d.lines.map(lineRow), { gap: 0, radius: 18, style: { paddingVertical: 6 } })], { gap: 6 }),
      ], { leftWeight: 1.15, rightWeight: 1, gap: 20 }),
    ],
  });
}

// ===================================================================== bots.keybot.history


const HOW: Record<HistoryEntry["kind"], string> = { voice: "Spoken", typing: "Rewritten", draft: "Reply" };
const words = (e: HistoryEntry) => e.wordsOut ?? (e.output ? e.output.trim().split(/\s+/).filter(Boolean).length : 0);

function byDay(ctx: BotsCtx, entries: HistoryEntry[]): Array<{ label: string; words: number; entries: HistoryEntry[] }> {
  const out: Array<{ key: string; label: string; words: number; entries: HistoryEntry[] }> = [];
  for (const e of entries) {
    const ms = Date.parse(e.createdAt);
    const key = Number.isFinite(ms) ? dayKey(ctx, ms) : "earlier";
    let g = out.find((x) => x.key === key);
    if (!g) { g = { key, label: dayLabel(ctx, ms), words: 0, entries: [] }; out.push(g); }
    g.entries.push(e);
    g.words += words(e);
  }
  return out;
}

/** The kind of app a line went to, for the chips: chats, mail, work, or none of them. */
const kindOf = (e: HistoryEntry) => groupOfApp(e.targetApp)?.id ?? "other";
const shownFor = (e: HistoryEntry): Condition => ({ any: [{ eq: ["app", "all"] }, { eq: ["app", kindOf(e)] }] });
const appOf = (e: HistoryEntry) => groupOfApp(e.targetApp)?.label ?? (e.targetApp && e.targetApp !== "Generic" ? (e.targetApp === "Desktop" ? "Computer" : e.targetApp) : "");

function copyAction(client: "phone" | "desktop", textToCopy: string): ActionSpec {
  return client === "desktop" ? { kind: "copyText", text: textToCopy, message: "Copied" } : { kind: "copyToClipboard", text: textToCopy, toastMessage: "Copied" };
}
/** Forget a line: first ask why (the old History card did), so "doesn't sound like me" can teach the writer. */
const forgetLine = (e: HistoryEntry): ActionSpec => ({ kind: "setState", path: "askDelete", value: e.id });
const forgetFor = (reason: "not_me" | "cleanup"): ActionSpec =>
  call("DELETE", `/v1/history/$state.askDelete?reason=${reason}`, undefined, {
    ok: seq({ kind: "setState", path: "askDelete", value: false }, toast("Gone for good"), { kind: "refresh" }),
    fail: oops("Couldn't forget that. Try again."),
  });

/** Why should it go? Asked before a line is forgotten. Either way it is gone for good, and the writer stops learning from it. */
function whyCard(): Node {
  return when({ truthy: "askDelete" }, card([
    text("Forget this line", { size: 11, weight: 600, tracking: 0.4, upper: true, color: C.meta, lineHeight: 15 }),
    text("Why should it go?", { size: 20, weight: 700, tracking: -0.3, lineHeight: 26 }),
    meta("Either way it's gone for good, and Tailzu stops learning from it.", { size: 13 }),
    col([
      button("It doesn't sound like me", forgetFor("not_me"), { size: "md" }),
      button("Just a clean-up", forgetFor("cleanup"), { kind: "secondary", size: "md" }),
      quietButton("Leave it", { kind: "setState", path: "askDelete", value: false }, { size: "md" }),
    ], { gap: 8 }),
  ], { gap: 8, padding: 16, radius: 18 }));
}

function historyChips(): Node {
  const c = (label: string, value: string) => row([text(label, { size: 13, lineHeight: 17, style: { color: whenEq("app", value, C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq("app", value, C.ink, C.outline), backgroundColor: whenEq("app", value, C.ink, C.paper),
  }, { kind: "setState", path: "app", value });
  return row([c("All", "all"), ...TONE_GROUP_DEFS.map((g) => c(g.label, g.id))], { gap: 8, flexWrap: "wrap" });
}

const clearAll = write("POST", "/v1/keybot/history/clear", undefined, "Cleared", "Couldn't clear it. Try again.");

function clearConfirm(): Node {
  return when({ truthy: "confirmClear" }, card([
    text("Clear everything you said? This can't be undone.", { size: 14, weight: 500, lineHeight: 19 }),
    row([button("Clear it all", clearAll, { size: "md" }), quietButton("Keep it", { kind: "setState", path: "confirmClear", value: false }, { size: "md" })], { gap: 8 }),
  ], { gap: 10, padding: 14, radius: 18 }));
}

function historyEmpty(d: KeybotHistoryView): Node {
  if (d.off) {
    return emptyState({ pose: "think", title: "Nothing is kept", body: "History is off, so what you say isn't saved anywhere. Turn it on to copy things you said before.",
      action: { label: "Keep what I say", onPress: write("PUT", "/v1/personality", { retainHistory: true }, "History is on") } });
  }
  if (d.q) return meta("Nothing you said matches that.", { size: 14 });
  return emptyState({ pose: "listen", title: "Nothing here yet", body: "Hold the Keybot key and speak in any app. What you said shows up here, to copy again." });
}

function historyPhone(ctx: BotsCtx, d: KeybotHistoryView | undefined) {
  const q = String(ctx.params.q ?? "");
  if (!d) return page(ctx, { nav: "keybot", title: "What you said", gap: 14, body: [phoneHead("What you said"), couldntLoad("what you said")] });
  const days = byDay(ctx, d.entries.slice(0, 80));
  const actionBtn = (g: Glyph, label: string, a: ActionRef) => box([glyph(g, { size: 18, color: C.grey70, label })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 }, a);
  return page(ctx, {
    nav: "keybot", title: "What you said", gap: 14, state: { q, app: "all", confirmClear: false, askDelete: false },
    body: [
      phoneHead("What you said"),
      searchField(SCREENS.keyHistory, "Search what you said"),
      ...(q ? [searchLine(SCREENS.keyHistory, q)] : []),
      ...(d.entries.length ? [historyChips()] : []),
      ...(!d.entries.length ? [historyEmpty(d)] : days.map((g) => col([
        row([sectionLabel(g.label), grow(), meta(plural(g.words, "word", "words"), { size: 12 })]),
        box(g.entries.flatMap((e, i) => [
          ...(i ? [when(shownFor(e), divider())] : []),
          when(shownFor(e), row([
            col([
              meta([clock(ctx, Date.parse(e.createdAt)), appOf(e), HOW[e.kind]].filter(Boolean).join(" · "), { size: 12 }),
              text(e.output, { size: 14, lineHeight: 19, lines: 3 }),
            ], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
            actionBtn("copy", "Copy", copyAction("phone", e.output)),
            actionBtn("forget", "Forget this", forgetLine(e)),
          ], { gap: 2, paddingVertical: 10, paddingLeft: 16, paddingRight: 4 })),
        ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ], { gap: 8 }))),
    ],
    footer: d.off ? [] : [
      whyCard(),
      clearConfirm(),
      row([
        icon("lock", { size: 16, color: C.grey70 }),
        text("Kept with your account until you clear it.", { size: 13, color: C.grey70, lineHeight: 17, style: { flexGrow: 1, flexShrink: 1 } }),
        box([text("Clear now", { size: 13, weight: 600, lineHeight: 17 })], { minHeight: 40, paddingHorizontal: 10, justifyContent: "center" }, { kind: "setState", path: "confirmClear", value: true }),
      ], { gap: 10, backgroundColor: C.surface, borderRadius: 18, paddingVertical: 4, paddingLeft: 14, paddingRight: 6 }),
    ],
  });
}

function historyDesk(ctx: BotsCtx, d: KeybotHistoryView | undefined) {
  const q = String(ctx.params.q ?? "");
  const head = deskHead("What you said", "Copy anything you spoke, or forget it.", d && d.entries.length
    ? [button("Clear now", { kind: "setState", path: "confirmClear", value: true }, { kind: "secondary", size: "md" })] : []);
  if (!d) return page(ctx, { nav: "keybot", title: "What you said", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("what you said")] });
  const COLS: Array<{ w?: number; fixed?: number; label: string }> = [
    { fixed: 70, label: "Time" }, { fixed: 108, label: "App" }, { w: 1, label: "What you said" }, { fixed: 52, label: "Words" }, { fixed: 78, label: "How" }, { fixed: 84, label: "" },
  ];
  const cell = (j: number, kid: Node) => box([kid], COLS[j]!.fixed ? { width: COLS[j]!.fixed, flexShrink: 0 } : { flexGrow: 1, flexBasis: 0, minWidth: 0 });
  const round = (g: Glyph, label: string, a: ActionRef) => box([glyph(g, { size: 16, color: C.grey70, label })], {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center",
  }, a);
  const line = (e: HistoryEntry): Node => when(shownFor(e), row([
    cell(0, text(clock(ctx, Date.parse(e.createdAt)), { size: 13, color: C.grey70, lineHeight: 17 })),
    cell(1, text(appOf(e) || "—", { size: 13, lineHeight: 17, lines: 1 })),
    cell(2, text(e.output, { size: 14, lineHeight: 19, lines: 2 })),
    cell(3, text(n(words(e)), { size: 13, color: C.grey70, lineHeight: 17 })),
    cell(4, meta(HOW[e.kind], { size: 12 })),
    cell(5, row([round("copy", "Copy", copyAction("desktop", e.output)), round("forget", "Forget this", forgetLine(e))], { gap: 6 })),
  ], { gap: 12, paddingVertical: 4, paddingLeft: 16, paddingRight: 12, minHeight: 48 }));
  const days = byDay(ctx, d.entries.slice(0, 150));
  return page(ctx, {
    nav: "keybot", title: "What you said", gap: 18, maxWidth: DESK_WIDTH, state: { q, app: "all", confirmClear: false, askDelete: false },
    body: [
      head,
      whyCard(),
      clearConfirm(),
      row([box([searchField(SCREENS.keyHistory, "Search what you said")], { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 220 }), ...(d.entries.length ? [historyChips()] : [])], { gap: 8, flexWrap: "wrap" }),
      ...(q ? [searchLine(SCREENS.keyHistory, q)] : []),
      ...(!d.entries.length ? [historyEmpty(d)] : [
        box([
          row(COLS.map((c, j) => cell(j, sectionLabel(c.label, { size: 10.5 }))), { gap: 12, paddingTop: 10, paddingBottom: 8, paddingLeft: 16, paddingRight: 12 }),
          ...days.flatMap((g) => [
            row([text(g.label, { size: 11, weight: 600, tracking: 0.4, upper: true, lineHeight: 15 }), grow(), meta(plural(g.words, "word", "words"), { size: 12 })],
              { paddingTop: 9, paddingBottom: 7, paddingHorizontal: 16, backgroundColor: C.surface }),
            ...g.entries.map(line),
          ]),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ]),
      ...(d.off ? [] : [row([icon("lock", { size: 14, color: C.meta }), meta("Kept with your account until you clear it. Only you can see it.", { size: 12 })], { gap: 8 })]),
    ],
  });
}

// ===================================================================== bots.keybot.settings

const kbSave = (key: string) => save("PUT", "/v1/keybot/prefs", { keyboard: { [key]: `$state.kb.${key}` } });

/** A small keyboard in the light or dark look. */
function lookPreview(dark: boolean): Node {
  const key = dark ? C.grey70 : C.paper, side = dark ? C.meta : C.track;
  const k = (f: number, bg: string, h = 14) => box([], { flexGrow: f, flexBasis: 0, height: h, borderRadius: 3, backgroundColor: bg });
  return col([
    row(Array.from({ length: 7 }, () => k(1, key)), { gap: 3 }),
    row(Array.from({ length: 7 }, () => k(1, key)), { gap: 3 }),
    row([k(1.2, side, 15), k(1, CLAY, 15), k(4, key, 15), k(1.4, side, 15)], { gap: 3 }),
  ], { gap: 4, backgroundColor: dark ? C.ink : C.surface, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 6 });
}

function lookCard(value: "light" | "dark", label: string, note: string): Node {
  return col([
    lookPreview(value === "dark"),
    row([text(label, { size: 14, weight: 600, lineHeight: 18 }), grow(), when({ eq: ["kb.look", value] }, meta("In use", { size: 12 })), when({ neq: ["kb.look", value] }, meta(note, { size: 12 }))], { paddingHorizontal: 2 }),
  ], {
    gap: 8, padding: 10, borderRadius: 18, borderWidth: 1.5, borderColor: whenEq("kb.look", value, CLAY, C.line), flexGrow: 1, flexBasis: 0, minWidth: 0,
  }, seq({ kind: "setState", path: "kb.look", value }, kbSave("look")));
}

/** A segmented control whose words need the room: less side padding in each segment. */
function tight(seg: Node): Node {
  return { ...seg, children: (seg.children ?? []).map((c) => ({ ...c, style: { ...(c.style ?? {}), paddingHorizontal: 4 } })) };
}

/** A label with a small segmented control on its right. */
function segRow(label: string, options: Array<{ label: string; value: string }>, path: string, onChange: ActionRef, width = 200): Node {
  return row([text(label, { size: 15, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }), box([segmented(options, path, { onChange })], { width, flexShrink: 0 })],
    { gap: 10, paddingVertical: 10, paddingLeft: 16, paddingRight: 12, minHeight: 52 });
}

function settingsPhone(ctx: BotsCtx, d: KeybotSettingsView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Keyboard", gap: 14, body: [phoneHead("Keyboard"), couldntLoad("your keyboard")] });
  const langs = d.languages.map((l) => l.label).join(", ") || "Not set";
  return page(ctx, {
    nav: "keybot", title: "Keyboard", gap: 14, state: { kb: d.keyboard },
    body: [
      phoneHead("Keyboard"),
      col([sectionLabel("Look"), row([lookCard("light", "Light", "Bright keys"), lookCard("dark", "Dark", "Easy at night")], { gap: 10, alignItems: "stretch" }),
        when({ eq: ["kb.look", "phone"] }, meta("Follows your phone until you pick one.", { size: 12 }))], { gap: 8 }),
      col([sectionLabel("Feel"), box([
        segRow("Haptics", [{ label: "Off", value: "off" }, { label: "Light", value: "light" }, { label: "Strong", value: "strong" }], "kb.haptics", kbSave("haptics")),
        divider(),
        segRow("Key height", [{ label: "Short", value: "short" }, { label: "Normal", value: "normal" }, { label: "Tall", value: "tall" }], "kb.height", kbSave("height"), 210),
        divider(),
        segRow("Key sounds", [{ label: "On", value: "on" }, { label: "Off", value: "off" }], "kb.sounds", kbSave("sounds"), 140),
        when({ eq: ["kb.sounds", "phone"] }, row([meta("Follows your phone until you pick one.", { size: 12 })], { paddingLeft: 16, paddingRight: 12, paddingBottom: 10 })),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
      listCard([
        listRow({ label: "Languages", value: langs, onPress: open(SCREENS.language) }),
        switchRow("Hold space to speak", "kb.holdSpace", { sub: "Hold still to speak, like the clay key. Slide to move the cursor.", onChange: kbSave("holdSpace") }),
      ], { title: "Typing" }),
      col([sectionLabel("Keybot key"), card([
        tight(segmented([{ label: "Left of space", value: "left" }, { label: "Right of space", value: "right" }, { label: "Top row", value: "top" }], "kb.keyAt", { onChange: kbSave("keyAt") })),
        ...(["left", "right", "top"] as const).map((at) => when({ eq: ["kb.keyAt", at] }, phoneKeys(at, 0.9))),
      ], { gap: 10, padding: 12, radius: 18 })], { gap: 8 }),
    ],
  });
}

const COMMON_LANGS = [{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "hinglish", label: "Hinglish" }];

function settingsDesk(ctx: BotsCtx, d: KeybotSettingsView | undefined) {
  const cfg = (key: string): ActionSpec => ({ kind: "desktop.config", key, value: "$toggle" } as ActionSpec);
  const deskToggle = (label: string, key: string, sub: string) => row([
    col([text(label, { size: 14, lineHeight: 19 }), meta(sub, { size: 12 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    switchMark(`desktop.${key}`),
  ], { gap: 14, paddingVertical: 8, minHeight: 44 }, cfg(key));
  const chosen = new Set((d?.languages ?? []).map((l) => l.value));
  const langChips = [...(d?.languages ?? []), ...COMMON_LANGS.filter((l) => !chosen.has(l.value))].map((l) => chip(l.label, {
    selected: chosen.has(l.value),
    onPress: write("POST", "/v1/keybot/language", { value: l.value, on: !chosen.has(l.value) }, undefined, "Couldn't change your languages. Try again."),
  }));
  const pillPreview = col([
    box([], { height: 6, width: "70%", borderRadius: 3, backgroundColor: C.track }),
    row([box([], { height: 6, width: "34%", borderRadius: 3, backgroundColor: C.track }), box([], { width: 1.5, height: 12, backgroundColor: C.ink })], { gap: 2 }),
    row([
      box([icon("mic", { size: 10, color: C.paper })], { width: 16, height: 16, borderRadius: 8, backgroundColor: CLAY, alignItems: "center", justifyContent: "center" }),
      row([4, 8, 5, 10, 6, 3, 7].map((h) => box([], { width: 2, height: h, borderRadius: 1, backgroundColor: CLAY })), { gap: 2 }),
      text("kal 7 baje", { size: 11, lineHeight: 14 }),
    ], { gap: 6, alignSelf: "flex-start", backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 }),
  ], { gap: 6, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 });
  return page(ctx, {
    nav: "keybot", title: "Keyboard", gap: 18, maxWidth: DESK_WIDTH,
    body: [
      deskHead("Keyboard", "How Keybot listens and shows up on this computer."),
      twoCols([
        deskCard("Shortcut", [
          row([text("Keybot key", { size: 14, lineHeight: 19 }), grow(),
            when({ truthy: "desktop.hold" }, kbd("Fn", "desktop.holdKey")), when({ falsy: "desktop.hold" }, kbd("Ctrl+Space", "desktop.hotkey"))], { gap: 12, minHeight: 32 }),
          // The one key (gap 17): picked here, on a window that has it.
          ...keyChoice(),
          laptopKeys(),
          keyList(),
          divider(),
          when({ truthy: "desktop.oneKey" }, deskToggle("Tap to keep listening", "tap", "Hands free. Tap the key again to stop.")),
          when({ falsy: "desktop.oneKey" }, deskToggle("Tap twice to keep listening", "tap", "Hands free. Tap the key again to stop.")),
          when({ truthy: "desktop.oneKey" }, meta("One key for everything. Keybot types it, Ask answers it, “take notes” starts notes, and a task goes to the right bot.", { size: 12 })),
          when({ falsy: "desktop.oneKey" }, row([meta("Change these keys in Settings.", { size: 12 }), grow(),
            quietButton("Open Settings", open(ctx.desk.pages ? "desk_settings" : "settings"), { size: "md" })], { gap: 8 })),
        ]),
        deskCard("Languages", d ? [
          row([...langChips, row([text("+ Add a language", { size: 13, color: C.meta, lineHeight: 17 })], {
            paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline, borderStyle: "dashed",
          }, open(SCREENS.language))], { gap: 6, flexWrap: "wrap", paddingTop: 2, paddingBottom: 4 }),
          meta("Keybot hears and writes these, and switches mid-sentence, like you do.", { size: 12 }),
        ] : [couldntLoad("your languages")]),
      ], [
        deskCard("Pill", [
          pillPreview,
          deskToggle("Show the pill", "pill", "By your text cursor while Keybot listens"),
          deskToggle("Show the words as I speak", "live", "A line of what it heard, as you say it"),
        ]),
        deskCard("Listening", [
          deskToggle("Write while I pause", "pauseFlush", "Each pause puts in what you said so far"),
          deskToggle("Start with the computer", "autoStart", "Ready when you sign in"),
        ]),
      ], { gap: 14 }),
    ],
  });
}

// ===================================================================== the list

const withQ = (base: string) => (ctx: BotsCtx) => (ctx.params.q ? `${base}?q=${encodeURIComponent(String(ctx.params.q))}` : base);

export const keybotScreens: BotsScreen[] = [
  screen<HomeData>({ id: SCREENS.keybot, load: loadHome, build: both(keybotPhone, keybotDesk) }),
  screen<KeybotToneView>({ id: SCREENS.keyTone, load: load<KeybotToneView>("/v1/keybot/tone"), build: both(tonePhone, toneDesk) }),
  screen<KeybotWordsView>({ id: SCREENS.keyWords, load: (ctx, deps) => load<KeybotWordsView>(withQ("/v1/keybot/words")(ctx))(ctx, deps), build: both(wordsPhone, wordsDesk) }),
  screen<KeybotVoicesView>({ id: SCREENS.keyVoices, load: load<KeybotVoicesView>("/v1/keybot/voices"), build: both(voicesPhone, voicesDesk) }),
  screen<KeybotTrainView>({ id: SCREENS.keyTrain, load: load<KeybotTrainView>("/v1/keybot/train"), build: both(trainPhone, trainDesk) }),
  screen<KeybotHistoryView>({ id: SCREENS.keyHistory, load: (ctx, deps) => load<KeybotHistoryView>(withQ("/v1/keybot/history")(ctx))(ctx, deps), build: both(historyPhone, historyDesk) }),
  screen<KeybotSettingsView>({ id: SCREENS.keySettings, load: load<KeybotSettingsView>("/v1/keybot/settings"), build: both(settingsPhone, settingsDesk) }),
  // The old Stats and You tabs' pages (docs/bots-keybot-parity.md).
  ...keybotStatsScreens,
  ...keybotYouScreens,
];

