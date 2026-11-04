/**
 * Today: the day so far, what was said and what it became.
 */

import type { HistoryEntry, Personality } from "../../../../shared/types/api.js";
import type { Node, ScreenResponse } from "../../../../shared/types/sdui.js";
import { span } from "../phoneLook.js";
import { sw as say } from "../settingsWords.js";
import { dayPart } from "../touches.js";
import { statTile, columns, race, appParts, donutWithLegend, type Part, SERIES, splitBar, trend } from "./charts.js";
import { type DeskContext, TYPING_WPM } from "./context.js";
import { stack, text, row, keys, n, room, blip, section, inline, link, twoUp, screen, page } from "./kit.js";
import { local, dayKey, DAYS, dateLine, hourName, HOUR_TICKS, MONTHS } from "./time.js";

function weekSquares(ctx: DeskContext, titled = true): Node {
  const now = local(ctx, Date.now());
  // The stats read has thirty days, newest last. Without it (it can miss its
  // deadline), the history in hand says which days had a note.
  const spark = ctx.stats?.sparklinePerDay;
  const had = new Set((ctx.history ?? []).map((e) => dayKey(local(ctx, Date.parse(e.createdAt)))));
  const cells: Node[] = [], letters: Node[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const on = spark && spark.length >= 7 ? (spark[spark.length - 1 - i] ?? 0) > 0 : had.has(dayKey(d));
    cells.push(stack([], {}, `d-sq${on ? " d-sq-on" : ""}${i === 0 ? " d-sq-now" : ""}`));
    letters.push(text(DAYS[d.getUTCDay()]!.slice(0, 1), "d-margin", { width: 16, textAlign: "center" }));
  }
  return stack([
    ...(titled ? [text("This week", "d-eyebrow")] : []),
    row(cells, { gap: 6, marginTop: titled ? 10 : 0 }),
    row(letters, { gap: 6, marginTop: 6 }),
  ]);
}

/** The keys that start a dictation, as the room shows them. The one key (a window that has it bound says
 *  desktop.oneKeyOn, and names it as its hotkey) is held; otherwise the pair tapped, or the chord pressed. */
const talkKeys = (): Node[] => [
  row([keys("hotkey", true), text("hold in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 })],
    { align: "center", gap: 0 }, undefined, { visibleIf: { truthy: "desktop.oneKeyOn" } }),
  row([keys("tap", true), text("tap twice, in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 })],
    { align: "center", gap: 0 }, undefined, { visibleIf: { all: [{ falsy: "desktop.oneKeyOn" }, { truthy: "desktop.tap" }] } }),
  row([keys("hotkey", true), text("in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 })],
    { align: "center", gap: 0 }, undefined, { visibleIf: { all: [{ falsy: "desktop.oneKeyOn" }, { falsy: "desktop.tap" }] } }),
];

/**
 * TODAY — the day as numbers, not as a list.
 *
 * The room carries the day's four figures; the page under it says where they
 * came from: the day by the hour, said against typed, where the words went and
 * how they came, the last two weeks, the week's squares, training. The notes
 * themselves are one link away, in History, where each can be copied or
 * removed with its reason — a page that listed them here as well was two lists
 * of the same thing, the second without its delete. And there is no "Talk now":
 * the keys in the room are how anyone talks, from wherever they already are.
 *
 * On a day with nothing said yet the page still has its month to show — the
 * usual hours, the usual apps — and says so in each heading.
 */
export function deskToday(ctx: DeskContext): ScreenResponse {
  const now = local(ctx, Date.now());
  const today = dayKey(now);
  const all = ctx.history ?? [];
  const st = ctx.stats;
  const at = (e: HistoryEntry) => local(ctx, Date.parse(e.createdAt));
  const todays = all.filter((e) => dayKey(at(e)) === today);
  const wordsToday = ctx.usage?.today?.words ?? todays.reduce((s, e) => s + (e.wordsOut ?? 0), 0);
  // The history read stops at fifty; on a day past that, the meter counts.
  const dictations = todays.length >= 50 ? Math.max(todays.length, ctx.usage?.today?.requests ?? 0) : todays.length;
  const saidMin = (ctx.usage?.today?.audioSeconds ?? 0) / 60;
  const typedMin = wordsToday / TYPING_WPM;
  const back = Math.max(0, typedMin - saidMin);

  // The month's days, today last (the stats read); without it, the history in hand.
  const perDay = st?.wordsPerDay?.length ? st.wordsPerDay : (() => {
    const out = new Array(14).fill(0) as number[];
    for (const e of all) {
      const ago = Math.floor((Date.parse(today) - Date.parse(dayKey(at(e)))) / 86_400_000);
      if (ago >= 0 && ago < 14) out[13 - ago] += e.wordsOut ?? 0;
    }
    return out;
  })();
  const before = perDay.slice(0, -1).filter((v) => v > 0);
  const avgDay = before.length ? before.reduce((s, v) => s + v, 0) / before.length : 0;
  // A MORNING IS NOT A DAY. Set against a whole day's average, every morning
  // reads as a bad day. With the month's hours in hand, today is set against
  // where a usual day stands BY THIS MINUTE; without them, against a day.
  const hw = st?.hourWords?.length === 24 ? st.hourWords : null;
  const hwTotal = hw ? hw.reduce((s, v) => s + v, 0) : 0;
  const h = now.getUTCHours();
  const shareNow = hw && hwTotal > 0
    ? (hw.slice(0, h).reduce((s, v) => s + v, 0) + (hw[h] ?? 0) * (now.getUTCMinutes() / 60)) / hwTotal
    : 1;
  const expected = avgDay * shareNow;
  const delta = expected >= 15 && wordsToday > 0 ? Math.round((wordsToday / expected - 1) * 100) : null;
  const paceLabel = hw ? "Against your pace" : "Against your day";
  const paceSub = !avgDay ? "an average needs a few days"
    : expected < 15 ? "too early in your day to say"
    : hw ? `by now you usually have ${n(expected)}` : `your average is ${n(avgDay)} words`;

  // ---- the room: the day's four figures --------------------------------------------
  const figures = row([
    statTile("Words today", n(wordsToday), wordsToday ? `${dictations} ${dictations === 1 ? "dictation" : "dictations"}` : "Nothing yet today", true, true),
    statTile("Time back", wordsToday ? span(back) : "—", `against typing at ${TYPING_WPM} wpm`, true),
    statTile(paceLabel, delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`, paceSub, true),
    statTile("Day streak", n(st?.currentStreak ?? 0), st?.bestStreak ? `best run ${st.bestStreak} days` : "days in a row", true),
  ], { gap: 36, flexWrap: "wrap", marginTop: 26, paddingTop: 22, borderTop: "1px solid rgba(243,226,198,.12)", width: "100%" });

  // BLIP'S GREETING, by the person's own time of day: a small Blip waving
  // beside the date, with one line. The only Blip on this page.
  const band = room([
    row([
      blip("wave-l", 0.5),
      stack([
        text("Today", "d-eyebrow"),
        text(dateLine(now), "d-h1", { marginTop: 6 }),
        text(say(`g.${dayPart(ctx.tzOffsetMinutes)}`), "d-count d-on-room", { marginTop: 10 }),
      ], { minWidth: 0 }),
    ], { align: "center", gap: 22, minWidth: 0 }),
    ...talkKeys(),
    figures,
  ]);

  // ---- the day by the hour ----------------------------------------------------------
  const hoursToday = new Array(24).fill(0) as number[];
  for (const e of todays) hoursToday[at(e).getUTCHours()] += e.wordsOut ?? 0;
  const hasToday = hoursToday.some((v) => v > 0);
  const usualHours = st?.hourWords?.length === 24 ? st.hourWords : [];
  const hourVals = hasToday ? hoursToday : usualHours;
  const busiest = hourVals.indexOf(Math.max(...hourVals));
  const hourBlock = hourVals.some((v) => v > 0)
    ? section(hasToday ? "Today, hour by hour" : "Your usual day",
        hasToday ? `Busiest at ${hourName(busiest)}. Now is the amber hour.` : `Nothing yet today — this is your month, by the hour. Busiest at ${hourName(busiest)}.`,
        [columns(hourVals, { highlight: hasToday ? [now.getUTCHours()] : [busiest], ticks: HOUR_TICKS })])
    : null;

  const raceBlock = wordsToday > 0
    ? section("Said against typed", "The time it took you to say today's words, and the time typing them would have.", [
        stack([race(saidMin, typedMin, true)], { marginTop: 20 }),
        ...(back >= 1 ? [inline([text(span(back), "d-em"), text(" back today.", "d-inherit")], "d-written", { fontSize: 20, lineHeight: "28px", marginTop: 18 })] : []),
        text(`Typed at ${TYPING_WPM} words a minute. Said is the time you spent talking.`, "d-margin", { marginTop: 8 }),
      ])
    : null;

  // ---- where the words went, and how they came ----------------------------------------
  const todayApps = new Map<string, number>();
  for (const e of todays) { const a = e.targetApp || "Other"; todayApps.set(a, (todayApps.get(a) ?? 0) + (e.wordsOut ?? 0)); }
  const appRows = hasToday
    ? [...todayApps].map(([app, words]) => ({ app, words }))
    : (st?.topApps ?? []).map((a) => ({ app: a.app, words: a.words }));
  const ap = appParts(appRows);
  const appTotal = ap.reduce((s, p) => s + p.value, 0);
  const appsBlock = ap.length > 1
    ? section(hasToday ? "Where today's words went" : "Where your words go",
        hasToday ? "By the app you were in when you talked." : "Your month, by app — today fills this in.",
        [donutWithLegend(ap, { value: n(appTotal), label: "words" })])
    : ap.length === 1
      ? section(hasToday ? "Where today's words went" : "Where your words go", undefined,
          [statTile(ap[0]!.label, `${n(ap[0]!.value)} words`, hasToday ? "every word today, one app" : "this month")], { marginTop: 0 })
      : null;

  const kindsToday = { voice: 0, typing: 0, draft: 0 };
  for (const e of todays) kindsToday[(e.kind ?? "voice") as keyof typeof kindsToday] += e.wordsOut ?? 0;
  const kindSrc = hasToday ? kindsToday : (st?.kindWords ?? kindsToday);
  const kindParts: Part[] = [
    { label: "Spoken", value: kindSrc.voice, color: SERIES[0] },
    { label: "Typed", value: kindSrc.typing, color: SERIES[3] },
    { label: "Draft", value: kindSrc.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0);
  const perSession = dictations ? Math.round(wordsToday / dictations) : 0;
  const monthPerSession = st?.avgWordsPerSession ?? 0;
  const kindsBlock = kindParts.length || perSession
    ? section(hasToday ? "How today's words came" : "How your words come", "Spoken, typed into the keyboard, or written for you as a draft.", [
        ...(kindParts.length > 1 ? [splitBar(kindParts)]
          : kindParts.length === 1 ? [text(`All ${kindParts[0]!.label.toLowerCase()}.`, "d-written", { fontSize: 17, marginTop: 14 })] : []),
        ...(perSession ? [row([
          statTile("Per dictation", `${n(perSession)}`, "words today"),
          ...(monthPerSession ? [statTile("Your usual", `${n(monthPerSession)}`, "words, this month")] : []),
        ], { gap: 32, marginTop: 30 })] : []),
      ])
    : null;

  // ---- the last two weeks --------------------------------------------------------------
  const last14 = perDay.slice(-14);
  const daysAgoLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const sum14 = last14.reduce((s, v) => s + v, 0);
  const active14 = last14.filter((v) => v > 0).length;
  const trendBlock = sum14 > 0
    ? section("The last two weeks", `${n(sum14)} words over ${active14} of the last 14 days. Today is the amber point.`,
        [trend(last14, { ticks: [daysAgoLabel(last14.length - 1), daysAgoLabel(Math.floor((last14.length - 1) / 2)), "Today"] })],
        { marginTop: 52, flex: "none", width: "100%" })
    : null;

  // ---- the week, training, and the notes themselves ------------------------------------
  const weekBlock = section("This week", undefined, [
    stack([weekSquares(ctx, false)], { marginTop: 16 }),
    text(st?.currentStreak ? `${st.currentStreak} ${st.currentStreak === 1 ? "day" : "days"} in a row${st.bestStreak ? ` · your longest run is ${st.bestStreak}` : ""}.` : "Talk today to start a run.",
      "d-lede", { marginTop: 14 }),
  ]);
  const trainBlock = section(say("tab.train"), undefined, [
    text(trainLine(ctx.personality), "d-written", { fontSize: 16, lineHeight: "25px", marginTop: 12, marginBottom: 14, maxWidth: 360 }),
    row([link("Train X0 Bot", { kind: "switchTab", tabId: "desk_train" })]),
  ]);

  // THE TALKING HISTORY, ONE LINK AWAY. What was said today and before lives
  // in History, where every note can be copied and removed with its reason.
  const recent = all.filter((e) => Date.now() - Date.parse(e.createdAt) < 14 * 86_400_000).length;
  const historyBlock: Node = {
    ...row([
      stack([
        text("Your dictations", "d-eyebrow"),
        text(dictations
          ? `${dictations} today${recent > dictations ? `, ${recent} in the last two weeks` : ""} — what you said above what X0 Bot wrote.`
          : all.length ? `Nothing today yet. ${recent || all.length} in the last two weeks, said above written.` : "Everything you say shows up here, said above written.",
          "d-written", { fontSize: 17, lineHeight: "25px", marginTop: 8, maxWidth: 560 }),
      ], { flex: 1, minWidth: 0 }),
      link("Open history  →", { kind: "navigate", screenId: "desk_history" }, "d-btn"),
    ], { align: "center", gap: 28, flexWrap: "wrap", marginTop: 56, paddingTop: 28, paddingBottom: 28, paddingLeft: 26, paddingRight: 26,
      borderRadius: 14, border: "1px solid var(--d-rule)", cursor: "pointer" }),
    on: { onPress: { kind: "navigate", screenId: "desk_history" } },
  };

  const body: Node[] = [
    ...twoUp(hourBlock, raceBlock, { marginTop: 0 }),
    ...twoUp(appsBlock, kindsBlock),
    ...(trendBlock ? [trendBlock] : []),
    ...twoUp(weekBlock, trainBlock),
    historyBlock,
  ];
  return screen("desk_today", "Today", [band, page(body)]);
}

function trainLine(p: Personality): string {
  const ex = p.stylePortrait?.examples ?? 0;
  if (ex <= 0) return "A few minutes of talking, and X0 Bot writes more like you.";
  return `${ex} ${ex === 1 ? "round" : "rounds"} so far. A few more and it knows how you punctuate.`;
}
