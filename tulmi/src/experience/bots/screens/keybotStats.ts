/**
 * KEYBOT'S NUMBERS, PAGE BY PAGE: what the old Stats tab opened in its cards (catalog.ts statsScreen's panels) and the
 * desk's Insights pages (desk.ts deskInsights, deskDay, deskApp), in Keybot's look, for the phone and the window.
 *
 *   bots.keybot.month   This month: typed against said, the words left and what turning up earned, words a day, by
 *                       week, the running total, spoken, against typing, all time, and every day as a list
 *   bots.keybot.day     one day (params: day, its place in the last 30; none is today): the hours, how, where, in
 *                       what, its time, and today's every session; earlier and later days a tap away
 *   bots.keybot.apps    where the words went, every app (params: app, one app's page: its share, rank, days, when,
 *                       how and in which voice, last used, its tone)
 *   bots.keybot.speak   how you speak: languages, how the words came, pace, the voices that wrote, the register
 *   bots.keybot.days    days and sessions: the streak against the best, the calendar, written and quiet, sessions a
 *                       day, time of day, hour by hour, day of the week, how long, a session by week, by app, the shape
 *
 * Every page reads GET /v1/keybot/stats (src/keybot/stats.ts). A failed read draws "couldn't load", never a number.
 * docs/bots-keybot-parity.md says which old card or page each part comes from.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import type { KeybotStatsApp, KeybotStatsDay, KeybotStatsView } from "../../../keybot/stats.js";
import { PART_NAMES, TYPING_WPM } from "../../../keybot/stats.js";
import { groupOfApp } from "../../../keybot/tones.js";
import { button, card, col, meta, meter, open, page, row, SCREENS, sectionLabel, text, type BotsCtx } from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import {
  appSquare, calendar, CLAY, clock, columns, couldntLoad, dayLabel, dayTicks, deskHead, DESK_WIDTH, figure, figures, hbars,
  hhmm, HOUR_TICKS, hourName, isoDay, load, n, pager, pct, peakOf, phoneHead, plural, sectionHead, span, statRow, twoCols,
  type BarRow, type Glyph,
} from "./keybotParts.js";

type Stats = KeybotStatsView;

// ===================================================================== the page around them

/** One page for both clients: the phone stacks the blocks; the window sets `left` and `right` side by side. */
function statsPage(ctx: BotsCtx, o: { title: string; sub: string; top?: Node[]; left: Node[]; right: Node[]; right2?: Node[] }) {
  if (ctx.client === "desktop") {
    return page(ctx, {
      nav: "keybot", title: o.title, gap: 18, maxWidth: DESK_WIDTH,
      body: [deskHead(o.title, o.sub), ...(o.top ?? []), ...(o.left.length || o.right.length ? [twoCols(o.left, o.right, { gap: 16 })] : [])],
    });
  }
  return page(ctx, {
    nav: "keybot", title: o.title, gap: 14,
    body: [phoneHead(o.title), meta(o.sub, { size: 13, lineHeight: 18 }), ...(o.top ?? []), ...o.left, ...o.right],
  });
}

const unread = (ctx: BotsCtx, title: string, sub: string) => statsPage(ctx, { title, sub, top: [couldntLoad("your numbers")], left: [], right: [] });

/** A block of a page: its label (and a way on), what it shows. */
const block = (label: string, kids: Node[], more?: { label: string; onPress: ActionRef }): Node =>
  card([sectionHead(label, more), ...kids], { gap: 10, radius: 18 });

/** A few rows, the numbers behind a chart. */
const rows = (list: Array<[string, string] | [string, string, ActionRef]>): Node =>
  col(list.map(([l, v, a]) => statRow(l, v, a ? { onPress: a } : {})));

const tiles = (ctx: BotsCtx, list: Node[]) => figures(list, ctx.client === "desktop" ? (list.length === 6 ? 3 : Math.min(list.length, 4)) : 2);
const replaceWith = (screenId: string, params?: Record<string, unknown>): ActionSpec => ({ ...open(screenId, params), replace: true } as ActionSpec);

/** Said, typed, drafted, as lanes with their share. */
function kindBars(k: { said: number; typed: number; drafted: number } | null): Node {
  const t = k ? k.said + k.typed + k.drafted : 0;
  return hbars(k && t ? [
    { label: "Said", value: k.said, text: `${pct(k.said, t)}%` },
    { label: "Typed", value: k.typed, text: `${pct(k.typed, t)}%`, sub: "cleaned up" },
    { label: "Drafted", value: k.drafted, text: `${pct(k.drafted, t)}%`, sub: "replies" },
  ].filter((x) => x.value > 0) : [], { labelWidth: 72, empty: "Nothing yet." });
}

/** Shares as lanes: the words, and the share of them. */
function shareBars(list: Array<{ label: string; words: number }>, o: { onPress?: (label: string) => ActionRef | undefined; empty?: string } = {}): Node {
  const t = list.reduce((a, b) => a + b.words, 0);
  return hbars(list.map((x) => ({ label: x.label, value: x.words, text: `${pct(x.words, t)}%`, sub: plural(x.words, "word", "words"), onPress: o.onPress?.(x.label) })), { empty: o.empty });
}

const kindGlyph = (app: string): Glyph => (groupOfApp(app)?.id as Glyph | undefined) ?? "app";

// ===================================================================== bots.keybot.month

function monthPage(ctx: BotsCtx, s: Stats | undefined) {
  const title = "This month";
  if (!s) return unread(ctx, title, "Typed against said, and the words left");
  const m = s.month, w = s.window, a = s.allowance;
  const typedSaid: BarRow[] = [
    ...(m.saidMinutes > 0 ? [{ label: "Said", value: m.saidMinutes, text: span(m.saidMinutes) }] : []),
    { label: "Typed", value: m.typedMinutes, text: span(m.typedMinutes) },
  ];
  const top: Node[] = [
    col([
      text(plural(m.words, "word", "words"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
      meta(m.words ? `in ${m.name} so far, as the meter counts them` : `Nothing yet in ${m.name}. Say something in any app and it starts counting.`, { size: 13 }),
    ], { gap: 2 }),
    tiles(ctx, [
      figure("Typed, it takes", span(m.typedMinutes)),
      figure("Said, it took", m.saidMinutes > 0 ? span(m.saidMinutes) : "—"),
      figure("Saved", span(m.savedMinutes)),
    ]),
  ];
  const allowance: Node[] = !a ? [] : a.unlimited
    ? [block("Words this month", [rows([["Plan", "No limit"], ["Used", n(a.used)], ...(a.streakDays ? [["Day streak", plural(a.streakDays, "day", "days")] as [string, string]] : [])])])]
    : [block("Words left", [
      meter(a.remaining, a.total, { label: `${n(a.remaining)} of ${n(a.total)} left`, valueText: "back on the 1st", color: CLAY }),
      rows([["Your plan's words", n(a.base)], ["Earned by turning up", n(a.earned)], ["Used", n(a.used)], ["Left", n(a.remaining)],
        ...(a.streakDays ? [["Day streak", plural(a.streakDays, "day", "days")] as [string, string]] : [])]),
      ...(a.perVisit.length ? [sectionLabel("Earned each visit"), columns(a.perVisit.map((v) => v.words), {
        height: 64, tops: "all", ticks: a.perVisit.map((v) => isoDay(v.day)), perColumnTicks: true, mark: [a.perVisit.length - 1],
      })] : []),
      ...(a.maxed ? [meta("You have earned the most you can this month.", { size: 12 })] : []),
    ])];
  const words = s.days.map((d) => d.words);
  const cum: number[] = [];
  words.reduce((t, v) => { cum.push(t + v); return t + v; }, 0);
  const today = [s.days.length - 1];
  const said = s.days.map((d) => Math.round(d.saidSeconds / 6) / 10);
  const left: Node[] = [
    block("Said against typing", [hbars(typedSaid, { labelWidth: 56 }), meta(`Typed at ${TYPING_WPM} words a minute. Said is the time you spent talking.`, { size: 12 })]),
    ...allowance,
    block("Spoken", [
      tiles(ctx, [
        figure(`Said, last ${w.days} days`, w.spokenMinutes ? span(w.spokenMinutes) : "—"),
        figure("Words a minute", w.wordsPerMinute ? n(w.wordsPerMinute) : "—"),
      ]),
      ...(said.some((v) => v > 0) ? [sectionLabel("Minutes said, a day"), columns(said, { height: 56, mark: today, format: (v) => `${v}`, ticks: dayTicks(s.days) })] : []),
      rows([
        [`Spoken, last ${w.days} days`, w.spokenMinutes ? span(w.spokenMinutes) : "—"],
        ["Words out", n(w.words)],
        ["Words a minute, said", w.wordsPerMinute ? n(w.wordsPerMinute) : "—"],
        ...(s.lifetime ? [["All time", span(s.lifetime.spokenMinutes)] as [string, string]] : []),
      ]),
    ]),
    block(`Against typing, last ${w.days} days`, [rows([
      ["Words written", n(w.words)],
      [`At ${TYPING_WPM} a minute, typed`, span(w.words / TYPING_WPM)],
      ...(w.spokenMinutes ? [["Said", span(w.spokenMinutes)] as [string, string]] : []),
      ["Minutes saved", n(w.minutesSaved)],
    ])]),
    ...(s.lifetime ? [block("All time", [rows([["Words", n(s.lifetime.words)], ["Sessions", n(s.lifetime.sessions)], ["Spoken", span(s.lifetime.spokenMinutes)]])])] : []),
  ];
  const right: Node[] = [
    block(`Words a day · last ${w.days} days`, [
      columns(words, { height: 90, mark: today, ticks: dayTicks(s.days) }),
      meta(w.words ? `${n(w.words)} words over ${w.daysActive} of the last ${w.days} days.${w.bestDay ? ` The biggest day: ${w.bestDay.label}, ${plural(w.bestDay.words, "word", "words")}.` : ""} Today is in clay.` : "Nothing yet in these days.", { size: 12 }),
    ]),
    block("By week", [columns(s.weeks.map((x) => x.words), { height: 70, tops: "all", mark: [3], ticks: s.weeks.map((x) => x.label), perColumnTicks: true })]),
    block("Running total", [
      columns(cum, { height: 70, mark: today, ticks: dayTicks(s.days) }),
      meta(m.projected ? `${n(m.words)} words so far in ${m.name}. At this pace, about ${n(m.projected)} by the end of it.` : `${n(w.words)} words across the last ${w.days} days, added up day by day.`, { size: 12 }),
    ]),
    block("Where it went", [shareBars(s.apps.length ? s.apps.map((a) => ({ label: a.app, words: a.words })) : s.topApps, { empty: "No app was named for these words." })],
      { label: "Every app", onPress: open(SCREENS.keyApps) }),
    block("Every day", [col([...s.days].reverse().map((d) => statRow(d.label, d.words ? plural(d.words, "word", "words") : "Quiet", { onPress: open(SCREENS.keyDay, { day: d.i }) })))]),
  ];
  return statsPage(ctx, { title, sub: `${m.name}: typed against said, the words left, and every day`, top, left, right });
}

// ===================================================================== bots.keybot.day

function dayIndex(ctx: BotsCtx, s: Stats): number {
  const raw = ctx.params.day;
  if (raw === undefined || raw === "") return s.days.length - 1;
  const i = Math.trunc(Number(raw));
  return Number.isInteger(i) && i >= 0 && i < s.days.length ? i : -1;
}

function dayPage(ctx: BotsCtx, s: Stats | undefined) {
  if (!s) return unread(ctx, "A day", "What you said that day");
  const i = dayIndex(ctx, s);
  const d: KeybotStatsDay | undefined = s.days[i];
  if (!d) {
    return statsPage(ctx, {
      title: "A day", sub: "What you said that day",
      top: [card([text("That day isn't here.", { size: 15, weight: 600 }), meta(`Open it from the calendar on Keybot: the last ${s.window.days} days are there.`, { size: 13 })], { gap: 6 })],
      left: [], right: [],
    });
  }
  const typed = d.words / TYPING_WPM, said = d.saidSeconds / 60;
  const nav = pager(i > 0 ? replaceWith(SCREENS.keyDay, { day: i - 1 }) : undefined, i < s.days.length - 1 ? replaceWith(SCREENS.keyDay, { day: i + 1 }) : undefined);
  const peak = peakOf(d.hours);
  const top: Node[] = [
    nav,
    col([
      text(d.words ? plural(d.words, "word", "words") : d.today ? "Nothing yet today" : "A quiet day", { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
      meta(d.words ? (said > 0 ? `said in ${span(said)}` : "written with Keybot")
        : d.today ? "Nothing yet today. Say something in any app and it shows here, hour by hour." : "Nothing was said or written on this day. Days off count too.", { size: 13 }),
    ], { gap: 2 }),
  ];
  if (!d.words) return statsPage(ctx, { title: d.label, sub: d.today ? "Today, so far" : d.short, top, left: [], right: [] });
  top.push(tiles(ctx, [
    figure("Sessions", n(d.sessions)),
    figure("Said in", said > 0 ? span(said) : "—"),
    figure("Typing time", span(typed)),
    figure("Per session", d.sessions ? n(Math.round(d.words / d.sessions)) : "—", { unit: d.sessions ? "words" : undefined }),
  ]));
  const left: Node[] = [
    block("Through the day", d.hours.length
      ? [columns(d.hours, { height: 70, mark: peak >= 0 ? [peak] : [], ticks: HOUR_TICKS }), ...(peak >= 0 ? [meta(`Busiest at ${hourName(peak)}.`, { size: 12 })] : [])]
      : [meta("The hours of this day weren't read.", { size: 12 })]),
    block("Said against typing", [hbars([
      ...(said > 0 ? [{ label: "Said", value: said, text: span(said) }] : []),
      { label: "Typed", value: typed, text: span(typed) },
    ], { labelWidth: 56 }), meta(`Typed at ${TYPING_WPM} words a minute.`, { size: 12 })]),
    block("Time", [rows([
      ["Said for", said > 0 ? span(said) : "—"],
      ["Typed, it would take", span(typed)],
      ...(said > 0 && typed > said ? [["Time saved", span(typed - said)] as [string, string]] : []),
      ...(d.first ? [["First words", hhmm(d.first)] as [string, string], ["Last words", hhmm(d.last ?? d.first)] as [string, string]] : []),
    ])]),
    ...(d.today && s.todaySessions.length ? [block("Every session", [col(s.todaySessions.slice(0, 40).map((x) => statRow(
      [hhmm(x.at), x.app].filter(Boolean).join(" · "), `${plural(x.words, "word", "words")}${x.how ? `, ${x.how}` : ""}`,
    )))])] : []),
  ];
  const right: Node[] = [
    block("How it was written", [kindBars(d.kinds)]),
    block("Where it went", [shareBars(d.apps, { empty: "No app was named for these words." })]),
    ...(d.languages.length ? [block("Written in", [shareBars(d.languages)])] : []),
  ];
  return statsPage(ctx, { title: d.label, sub: d.today ? "Today, so far" : d.short, top, left, right });
}

// ===================================================================== bots.keybot.apps

function appOne(ctx: BotsCtx, s: Stats, a: KeybotStatsApp) {
  const total = s.apps.length;
  const usual = s.window.perSession;
  const delta = usual > 0 && a.perSession > 0 ? Math.round(((a.perSession - usual) / usual) * 100) : null;
  const parts = [a.parts.morning, a.parts.afternoon, a.parts.evening, a.parts.night];
  const partPeak = peakOf(parts);
  const dayPeak = peakOf(a.perDay);
  const kt = a.kinds.said + a.kinds.typed + a.kinds.drafted || 1;
  const usedFor = ([["Dictation", a.kinds.said], ["Typed, cleaned up", a.kinds.typed], ["Replies drafted", a.kinds.drafted]] as Array<[string, number]>)
    .filter(([, v]) => v > 0).map(([k, v]) => `${k} ${pct(v, kt)}%`).join(", ");
  const g = groupOfApp(a.key);
  const lastAt = a.lastAt ? Date.parse(a.lastAt) : NaN;
  const top: Node[] = [
    row([appSquare(kindGlyph(a.key), 40), col([text(plural(a.words, "word", "words"), { size: 28, weight: 700, tracking: -0.6, lineHeight: 34 }),
      meta(`${a.share}% of all your words · last ${s.window.days} days`, { size: 13 })], { gap: 2, flexShrink: 1 })], { gap: 12 }),
    tiles(ctx, [
      figure("Sessions", n(a.sessions), { sub: a.rank === 1 ? "your most-used app" : `number ${a.rank} of ${total}` }),
      figure("Per session", a.perSession ? n(a.perSession) : "—", { unit: a.perSession ? "words" : undefined, sub: delta == null ? undefined : delta === 0 ? "the same as everywhere" : `${Math.abs(delta)}% ${delta > 0 ? "longer" : "shorter"} than your usual` }),
      figure("Days used", `${a.daysUsed}`, { sub: `of the last ${s.window.days}` }),
    ]),
  ];
  const left: Node[] = [
    block("Day by day", a.daysUsed
      ? [columns(a.perDay, { height: 70, mark: dayPeak >= 0 ? [dayPeak] : [], ticks: dayTicks(s.days) }), meta("The biggest day is in clay.", { size: 12 })]
      : [meta("No day's words were read for this app.", { size: 12 })]),
    block("When in the day", partPeak >= 0
      ? [columns(parts, { height: 64, tops: "all", mark: [partPeak], ticks: [...PART_NAMES], perColumnTicks: true }), meta(`Mostly in the ${PART_NAMES[partPeak]!.toLowerCase()}. Sessions by part of the day.`, { size: 12 })]
      : [meta("Not known yet.", { size: 12 })]),
  ];
  const right: Node[] = [
    block("How it was written", [kindBars(a.kinds)]),
    block("About it", [rows([
      ...(usedFor ? [["Used for", usedFor] as [string, string]] : []),
      ...(partPeak >= 0 ? [["Mostly", `${PART_NAMES[partPeak]!.toLowerCase()}s, ${n(parts[partPeak]!)} of ${n(a.sessions)}`] as [string, string]] : []),
      ...(a.voices.length ? [["Written as", a.voices.join(", ")] as [string, string]] : []),
      ...(Number.isFinite(lastAt) ? [["Last used", `${dayLabel(ctx, lastAt)}, ${clock(ctx, lastAt)}`] as [string, string]] : []),
      ...(g ? [["Its tone", `${g.label}`, open(SCREENS.keyTone)] as [string, string, ActionRef]] : []),
    ])]),
  ];
  return statsPage(ctx, { title: a.app, sub: "Where the words went", top, left, right });
}

function appsPage(ctx: BotsCtx, s: Stats | undefined) {
  const title = "Where the words went";
  if (!s) return unread(ctx, title, "By the app you were in");
  const key = String(ctx.params.app ?? "");
  if (key) {
    const a = s.apps.find((x) => x.key === key);
    if (a) return appOne(ctx, s, a);
    return statsPage(ctx, {
      title, sub: "By the app you were in",
      top: [card([text("Nothing for that app.", { size: 15, weight: 600 }), meta("It may not have had words in the last 30 days.", { size: 13 }),
        button("Every app", replaceWith(SCREENS.keyApps), { kind: "secondary", size: "md" })], { gap: 8 })],
      left: [], right: [],
    });
  }
  const list = s.apps.length ? s.apps.map((a) => ({ label: a.app, words: a.words, key: a.key })) : s.topApps.map((a) => ({ label: a.label, words: a.words, key: "" }));
  const t = list.reduce((x, y) => x + y.words, 0);
  const top: Node[] = [col([
    text(list.length ? plural(list.length, "app", "apps") : "No apps yet", { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
    meta(list.length ? `${n(t)} words in the last ${s.window.days} days. Open one to see its own page.` : "Speak in any app and it shows up here, by app.", { size: 13 }),
  ], { gap: 2 })];
  const left: Node[] = [block("Share of words", [hbars(list.map((a) => ({
    label: a.label, value: a.words, text: `${pct(a.words, t)}%`, sub: plural(a.words, "word", "words"), lead: appSquare(kindGlyph(a.key || a.label), 32),
    onPress: a.key ? open(SCREENS.keyApps, { app: a.key }) : undefined,
  })), { empty: "Nothing yet." })], { label: "Tone per app", onPress: open(SCREENS.keyTone) })];
  const right: Node[] = s.apps.length ? [block("Words a session, by app", [hbars(s.apps.map((a) => ({ label: a.app, value: a.perSession, text: `${n(a.perSession)} words` })))])] : [];
  return statsPage(ctx, { title, sub: "By the app you were in", top, left, right });
}

// ===================================================================== bots.keybot.speak

function speakPage(ctx: BotsCtx, s: Stats | undefined) {
  const title = "How you speak";
  if (!s) return unread(ctx, title, "Your languages, your pace, the voices that wrote");
  const w = s.window;
  const k = s.kinds;
  const vt = s.voices.reduce((a, b) => a + b.words, 0);
  const top: Node[] = [col([
    text(s.languages.length ? plural(s.languages.length, "language", "languages") : "No languages yet", { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
    meta(`What Keybot wrote in the last ${w.days} days, read from the words themselves.`, { size: 13 }),
  ], { gap: 2 })];
  const left: Node[] = [
    block("What you write in", [shareBars(s.languages, { empty: "Talk for a few days and this fills in." }),
      button("Add languages", open(SCREENS.language), { kind: "secondary", size: "md" })]),
    block("How the words came", [kindBars(k), ...(k ? [rows([["Said", plural(k.said, "word", "words")], ["Typed", plural(k.typed, "word", "words")], ["Replies drafted", plural(k.drafted, "word", "words")]])] : [])]),
    block("Pace", [rows([["Words a minute, said", w.wordsPerMinute ? n(w.wordsPerMinute) : "—"], [`Spoken, last ${w.days} days`, w.spokenMinutes ? span(w.spokenMinutes) : "—"]])]),
  ];
  const right: Node[] = [
    block(s.voices.length ? `Who writes for you · ${s.voices[0]!.label} ${pct(s.voices[0]!.words, vt)}%` : "Who writes for you",
      [shareBars(s.voices, { empty: "No writing yet." })], { label: "Voice", onPress: open(SCREENS.keyStyle) }),
    block("In which register", [shareBars(s.registers, { empty: "No writing yet." }), meta("A voice is who writes; a register is how formal it came out. Zu is your own.", { size: 12 })]),
  ];
  return statsPage(ctx, { title, sub: "Your languages, your pace, the voices that wrote", top, left, right });
}

// ===================================================================== bots.keybot.days

function daysPage(ctx: BotsCtx, s: Stats | undefined) {
  const title = "Days and sessions";
  if (!s) return unread(ctx, title, "Your streak, your days, how you talk");
  const w = s.window;
  const today = [s.days.length - 1];
  const sessions = s.days.map((d) => d.sessions);
  const hours = s.hours ?? [];
  const hourPeak = peakOf(hours);
  const parts = s.parts ? [s.parts.morning, s.parts.afternoon, s.parts.evening, s.parts.night] : [];
  const partPeak = peakOf(parts);
  const wd = s.weekdays.map((x) => x.words);
  const wdPeak = peakOf(wd);
  const lengths = s.lengths?.map((x) => x.sessions) ?? [];
  const lenPeak = peakOf(lengths);
  const k = s.kinds;
  const WD_LONG = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  const top: Node[] = [tiles(ctx, [
    figure(`Sessions, ${w.days} days`, n(w.sessions)),
    figure("A writing day", String(w.sessionsPerActiveDay), { unit: "sessions" }),
    figure("Words each", n(w.perSession)),
    figure("Day streak", n(w.streak), { unit: w.streak === 1 ? "day" : "days", live: w.streakLive, sub: w.streakLive ? "running now" : w.streak ? "write today to keep it" : undefined }),
    figure("Best run", n(w.bestStreak), { unit: w.bestStreak === 1 ? "day" : "days" }),
    figure("Days written", `${w.daysActive}/${w.days}`),
  ])];
  const left: Node[] = [
    block("Now, against your best", [hbars([
      { label: "Now", value: w.streak, text: plural(w.streak, "day", "days") },
      { label: "Best", value: w.bestStreak, text: plural(w.bestStreak, "day", "days") },
    ], { labelWidth: 48, max: Math.max(1, w.bestStreak) })]),
    block("Days you talked", [calendar(s.days, (i) => open(SCREENS.keyDay, { day: i }), { cell: ctx.client === "desktop" ? 44 : 40 })]),
    block("Written and quiet", [hbars([
      { label: "Written", value: w.daysActive, text: plural(w.daysActive, "day", "days") },
      { label: "Quiet", value: Math.max(0, w.days - w.daysActive), text: plural(Math.max(0, w.days - w.daysActive), "day", "days") },
    ], { labelWidth: 64, max: w.days })]),
    block("Sessions a day", [columns(sessions, { height: 64, mark: today, ticks: dayTicks(s.days) })]),
    block("Shape", [rows([
      ["Average per session", plural(w.perSession, "word", "words")],
      ["Active days", `${n(w.daysActive)} of ${n(w.days)}`],
      ["Average per active day", plural(w.perActiveDay, "word", "words")],
      ...(w.bestDay ? [["Biggest day", `${w.bestDay.label} · ${plural(w.bestDay.words, "word", "words")}`] as [string, string]] : []),
      ...(k ? [["Said", plural(k.said, "word", "words")] as [string, string], ["Typed", plural(k.typed, "word", "words")] as [string, string], ["Replies drafted", plural(k.drafted, "word", "words")] as [string, string]] : []),
    ])]),
  ];
  const right: Node[] = [
    ...(partPeak >= 0 ? [block("Time of day", [columns(parts, { height: 64, tops: "all", mark: [partPeak], ticks: [...PART_NAMES], perColumnTicks: true }),
      meta(`Mostly in the ${PART_NAMES[partPeak]!.toLowerCase()}. Sessions by part of the day.`, { size: 12 })])] : []),
    ...(hourPeak >= 0 ? [block("Hour by hour", [columns(hours, { height: 64, mark: [hourPeak], ticks: HOUR_TICKS }), meta(`Busiest at ${hourName(hourPeak)}.`, { size: 12 })])] : []),
    ...(wdPeak >= 0 ? [block("Day of the week", [columns(wd, { height: 64, mark: [wdPeak], ticks: s.weekdays.map((x) => x.label), perColumnTicks: true }),
      meta(`${WD_LONG[wdPeak]} are your biggest, about ${plural(wd[wdPeak]!, "word", "words")}.`, { size: 12 })])] : []),
    ...(lenPeak >= 0 ? [block("How long, in words", [columns(lengths, { height: 64, tops: "all", mark: [lenPeak], ticks: s.lengths!.map((x) => x.label), perColumnTicks: true }),
      meta(`Most sessions run ${s.lengths![lenPeak]!.label} words.`, { size: 12 })])] : []),
    block("Words a session, by week", [columns(s.weeks.map((x) => x.perSession), { height: 64, tops: "all", mark: [3], ticks: s.weeks.map((x) => x.label), perColumnTicks: true })]),
    ...(s.apps.length ? [block("By app", [hbars(s.apps.map((a) => ({ label: a.app, value: a.perSession, text: `${n(a.perSession)} words`, onPress: open(SCREENS.keyApps, { app: a.key }) })))])] : []),
  ];
  return statsPage(ctx, { title, sub: "Your streak, your days, how you talk", top, left, right });
}

// ===================================================================== the list

const stats = load<KeybotStatsView>("/v1/keybot/stats");

export const keybotStatsScreens: BotsScreen[] = [
  screen<Stats>({ id: SCREENS.keyMonth, load: stats, build: monthPage }),
  screen<Stats>({ id: SCREENS.keyDay, load: stats, build: dayPage }),
  screen<Stats>({ id: SCREENS.keyApps, load: stats, build: appsPage }),
  screen<Stats>({ id: SCREENS.keySpeak, load: stats, build: speakPage }),
  screen<Stats>({ id: SCREENS.keyDays, load: stats, build: daysPage }),
];
