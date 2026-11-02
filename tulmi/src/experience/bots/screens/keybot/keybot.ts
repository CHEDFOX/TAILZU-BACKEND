/**
 * The Keybot's keybot screen, on the phone and in the window (keybotPhone, keybotDesk).
 */

import type { Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import type { KeybotStatsView } from "../../../../keybot/stats.js";
import { groupOfApp } from "../../../../keybot/tones.js";
import type { KeybotHomeView } from "../../../../keybot/views.js";
import { sw } from "../../../settingsWords.js";
import { dayPart } from "../../../touches.js";
import {
  card, text, meta, type BotsCtx, open, SCREENS, divider, row, grow, meter, col, C, icon, sectionLabel, switchMark, seq, listCard, listRow,
  box, peekKey, back, botAvatar, headerBuddy, page, when, title, button,
} from "../../kit.js";
import { DEVICE_STATE } from "../firstRun.js";
import { keybotCard } from "../firstRun/keybotCard.js";
import {
  CLAY, span, plural, hbars, sectionHead, n, columns, HOUR_TICKS, type Glyph, type BarRow, appSquare, pct, calendar, figure, save, KEYBOT,
  couldntLoad, figures, kbd, DESK_WIDTH, twoCols,
} from "../keybotParts.js";
import { speakVerb, laptopKeys, keyList } from "./parts.js";

// ===================================================================== bots.keybot

/**
 * Keylessbord's home carries what the old Stats and You tabs had (docs/bots-keybot-parity.md): the numbers up top (the
 * month, the words left, the week, today, where the words went, how you speak, the days, six figures), then the old
 * You tab's lines in groups, each opening its page, then what the key does. Two reads, each with its own honest state:
 * GET /v1/keybot (the week, and a line for each page) and GET /v1/keybot/stats (the numbers).
 */
export interface HomeData { home?: KeybotHomeView; stats?: KeybotStatsView }

const MODES = [
  { name: "Speak", blurb: "Tap and talk, clean text comes out" },
  { name: "Rewrite", blurb: "Select text, say how to change it" },
  { name: "Translate", blurb: "Hindi, Hinglish, English" },
  { name: "Reply", blurb: "Drafts an answer in your tone" },
];

function modeCard(m: (typeof MODES)[number], i: number, hint?: Node, desk = false): Node {
  return card([
    text(m.name, { size: 15, weight: 600, lineHeight: 20 }),
    meta(i === 0 && desk ? m.blurb.replace("Tap", "Hold") : m.blurb, { size: 12 }),
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
function weekCard(w: KeybotHomeView["week"], desk = false): Node {
  const said = w.words > 0 && w.spoken >= w.words * 0.9 ? "spoken this week instead of typed" : "written with Keylessbord this week";
  return card([
    sectionHead("This week"),
    col([
      text(plural(w.words, "word", "words"), { size: 22, weight: 700, tracking: -0.4, lineHeight: 28 }),
      meta(w.words > 0 ? `${said} · about ${plural(w.minutesSaved, "minute", "minutes")} saved` : `${speakVerb(desk)} the Keylessbord key and speak in any app. Your week fills in here.`, { size: 13, lineHeight: 18 }),
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

/** The week's apps, when the month's numbers could not be read (Keylessbord's own by-app card). */
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
      { empty: "Talk for a few days and this fills in, read from what Keylessbord wrote." }),
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

/** Make it yours: how Keylessbord writes for you. */
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
    { label: "What you call it", value: d ? (d.nickname ? `X0, or ${d.nickname}` : "X0") : "", onPress: open(SCREENS.keyName) },
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

/**
 * The phone keyboard, drawn as it is (keyboard/toolsRow.ts makeToolsRow and the letter page): on top, the tools row (the X0 key,
 * the round window with the bot peeking in, at the left; the suggestions; the tone pill at the right), then the four rows of
 * keys. `keyAt` left / right: the X0 key sits beside the space bar instead (keybot/keyboard.ts micBesideSpace), the same
 * round key.
 */
export function phoneKeys(keyAt: "left" | "right" | "top" = "top", scale = 1): Node {
  const z = (n: number) => Math.round(n * scale);
  const k = (g: number, bg: string, kids: Node[] = [], h = 34): Node =>
    box(kids, { flexGrow: g, flexBasis: 0, height: z(h), borderRadius: z(6), backgroundColor: bg, alignItems: "center", justifyContent: "center" });
  const keys = (n: number) => Array.from({ length: n }, () => k(1, C.paper));
  const gap = { gap: z(5) };
  const xKey = (h: number) => box([peekKey(z(h))], { width: z(h), height: z(h), borderRadius: z(h / 2), flexShrink: 0 });
  const word = (w: number) => box([], { width: z(w), height: z(5), borderRadius: z(3), backgroundColor: C.track });
  const tools = row([
    ...(keyAt === "top" ? [xKey(32)] : []),
    row([word(34), box([], { width: 1, height: z(14), backgroundColor: C.line }), word(46), box([], { width: 1, height: z(14), backgroundColor: C.line }), word(28)], { gap: z(10), flexGrow: 1, justifyContent: "center", alignItems: "center" }),
    box([text("Tone", { size: Math.max(9, z(11)), weight: 500, lineHeight: z(14) })], { width: z(64), height: z(26), borderRadius: z(13), borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
  ], { gap: z(8), alignItems: "center", height: z(36) });
  const half = box([], { flexGrow: 0.5, flexBasis: 0 });
  const bottom = [k(1.3, C.track), k(1, C.track), ...(keyAt === "left" ? [xKey(34)] : []), k(5, C.paper), ...(keyAt === "right" ? [xKey(34)] : []), k(2, C.track)];
  return col([
    tools,
    row(keys(10), gap),
    row([half, ...keys(9), half], gap),
    row([k(1.4, C.track), ...keys(7), k(1.4, C.track)], gap),
    row(bottom, { ...gap, alignItems: "center" }),
  ], { gap: z(9), backgroundColor: C.surface, borderRadius: z(22), paddingTop: z(8), paddingBottom: z(14), paddingHorizontal: z(6) });
}

export function keybotPhone(ctx: BotsCtx, d: HomeData | undefined) {
  const home = d?.home, s = d?.stats;
  const head = row([
    box([icon("back", { size: 24, label: "Back" })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()),
    botAvatar(KEYBOT, 40),
    col([text("Keylessbord", { size: 19, weight: 600, lineHeight: 24 }), meta("Your keyboard, in every app")], { gap: 2, flexShrink: 1 }),
    // Keylessbord's own tiny bot, hopping his keys at the head's right end (where the build draws it).
    ...headerBuddy(ctx, "keybot").flatMap((b) => [grow(), b]),
  ], { gap: 10 });
  return page(ctx, {
    back: false, nav: "keybot", title: "Keylessbord", gap: 18, state: homeState(d),
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
      col([phoneKeys(), meta("The X0 key, top left, is Keylessbord. Tap it and speak; tap it again when you're done, and Keylessbord tidies your words and types them in. The pill on the right sets the tone.", { size: 12, lineHeight: 17 })], { gap: 10 }),
    ],
  });
}

export function keybotDesk(ctx: BotsCtx, d: HomeData | undefined) {
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
    nav: "keybot", title: "Keylessbord", gap: 18, maxWidth: DESK_WIDTH, state: homeState(d),
    body: [
      row([
        botAvatar(KEYBOT, 48),
        col([title("Keylessbord", { size: 26 }), text(`Your keyboard, in every app. ${dayLine(ctx)}`, { size: 14, color: C.grey70, lineHeight: 19 })], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...headerBuddy(ctx, "keybot"),
        when({ truthy: "desktop.hold" }, row([kbd("Fn", "desktop.holdKey"), text("Hold to speak in any app", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 8 })),
        when({ falsy: "desktop.hold" }, row([kbd("Ctrl+Space", "desktop.hotkey"), text("Press to speak in any app", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 8 })),
        button("Settings", open(SCREENS.keySettings), { kind: "secondary", size: "md", icon: "settings" }),
      ], { gap: 14, flexWrap: "wrap" }),
      // This computer's Accessibility and microphone, where the window can tell, until they are on.
      ...keybotCard(ctx),
      // ---- the numbers (the old Stats tab, the desk's Insights)
      twoCols([s ? monthCard(s) : couldntLoad("your numbers")], [home ? weekCard(home.week, true) : couldntLoad("your week")], { gap: 16 }),
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
          when({ truthy: "desktop.oneKey" }, meta("The clay key is Keylessbord. Hold to talk, tap to keep listening. Ask, notes and your bots are on it too: just say so.", { size: 12 })),
          when({ falsy: "desktop.oneKey" }, meta("The clay key is Keylessbord. Hold to speak, tap twice to keep listening.", { size: 12 })),
          keyList(),
        ], { gap: 10, radius: 18 }),
      ], { gap: 16 }),
      col([sectionLabel("What the key does"), row(MODES.map((m, i) => box([modeCard(m, i, hints[i], true)], { flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 12, alignItems: "stretch" })], { gap: 10 }),
    ],
  });
}
