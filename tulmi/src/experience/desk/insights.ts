/**
 * Insights: the person's words over time, by app, voice and hour.
 */

import type { ScreenResponse, Node, ActionRef } from "../../../../shared/types/sdui.js";
import { LANGUAGE_NAMES } from "../../history/writtenIn.js";
import { TONE_LABELS, applyPresetOverrides } from "../personalityPresets.js";
import { span } from "../phoneLook.js";
import {
  statTile, trend, appParts, donutWithLegend, type Part, SERIES, pct, heatmap, columns, foldParts, splitBar, OTHER, barList, race,
} from "./charts.js";
import { type DeskContext, TYPING_WPM } from "./context.js";
import { inline, text, n, row, section, stack, screen, page, link, twoUp } from "./kit.js";
import { local, MONTHS, hourName, HOUR_TICKS } from "./time.js";

// ---- INSIGHTS ------------------------------------------------------------------------

/**
 * INSIGHTS — the month, read every way it can honestly be read.
 *
 * The statement and the race say the one thing first: what was said, what
 * typing it would have cost. Then the figures, then the month as a line (day
 * by day) and as a running total with where it is heading, and then each
 * breakdown in the form its data wants: parts of a whole as donuts (apps, how
 * the words came, which voice), a split of a few as one bar (register), an
 * order as columns (hours, weekdays, lengths), days as a calendar, languages as
 * type specimens, the dictionary as a ranking. An app opens its own page, a
 * day opens its own; nothing is hidden behind a tap that a page has room for.
 */
export function deskInsights(ctx: DeskContext): ScreenResponse {
  const now = local(ctx, Date.now());
  const words = ctx.usage?.month.words ?? ctx.stats?.wordsOut ?? 0;
  const saidMin = (ctx.usage?.month.audioSeconds ?? 0) / 60;
  const typedMin = words / TYPING_WPM;
  const st = ctx.stats;
  const month = MONTHS[now.getUTCMonth()]!;

  const statement: Node = words > 0
    ? inline([
        text(`You said ${n(words)} words this month. Typed, they would have taken `, "d-inherit"),
        text(span(typedMin), "d-typed", { whiteSpace: "nowrap" }),
        text(". Said, ", "d-inherit"),
        text(`${span(saidMin)}.`, "d-em", { whiteSpace: "nowrap" }),
      ], "d-statement", { marginTop: 20, marginBottom: 32 })
    : text("Nothing said yet this month. Tap twice in any app, and this page starts counting.", "d-statement", { marginTop: 20, marginBottom: 32 });

  // ---- the figures ------------------------------------------------------------------
  const wpd = st?.wordsPerDay ?? st?.days?.map((d) => d.words) ?? [];
  const tiles: Node[] = [];
  if (words > 0) tiles.push(statTile("Words this month", n(words), `${n(ctx.usage?.month.requests ?? st?.requests ?? 0)} dictations`));
  if ((st?.minutesSaved ?? 0) > 0) tiles.push(statTile("Time back", span(st!.minutesSaved), `against typing at ${TYPING_WPM} wpm`));
  if (st?.daysActive != null && wpd.length) tiles.push(statTile("Days you talked", `${st.daysActive}`, `of the last ${wpd.length}`));
  if ((st?.currentStreak ?? 0) > 0) tiles.push(statTile("Day streak", n(st!.currentStreak!), `longest run ${st!.bestStreak ?? st!.currentStreak}`));
  if ((st?.avgWordsPerSession ?? 0) > 0) tiles.push(statTile("Per dictation", n(st!.avgWordsPerSession!), "words, on average"));
  if (st?.bestDay) tiles.push(statTile("Best day", n(st.bestDay.words), `words · ${st.bestDay.date}`));
  const tilesRow: Node[] = tiles.length
    ? [row(tiles.map((t) => ({ ...t, style: { ...(t.style ?? {}), minWidth: 200 } })), { gap: 32, flexWrap: "wrap", marginTop: 36, paddingTop: 28 }, "d-rule-top")]
    : [];

  // ---- the month as a line, and as a running total ------------------------------------
  const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const sumW = wpd.reduce((s, v) => s + v, 0);
  const activeW = wpd.filter((v) => v > 0).length;
  const lineTicks = wpd.length > 2 ? [dayLabel(wpd.length - 1), dayLabel(Math.floor((wpd.length - 1) / 2)), "Today"] : [];
  const trendBlock: Node | null = sumW > 0
    ? section("Day by day", `${n(sumW)} words over ${activeW} of the last ${wpd.length} days. The amber point is today.`,
        [trend(wpd, { ticks: lineTicks })], { flex: "none", width: "100%", marginTop: 56 })
    : null;
  const cum: number[] = [];
  wpd.reduce((s, v) => { cum.push(s + v); return s + v; }, 0);
  const dom = now.getUTCDate();
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = words > 0 && dom > 0 ? Math.round((words / dom) * dim) : 0;
  const cumBlock: Node | null = sumW > 0
    ? section("Running total", projected && dom < dim
        ? `${n(words)} words so far in ${month}. At this pace, about ${n(projected)} by the end of it.`
        : `${n(sumW)} words across the last ${wpd.length} days, added up day by day.`,
        [trend(cum, { ticks: lineTicks, avg: false, height: 150 })], { flex: "none", width: "100%", marginTop: 56 })
    : null;

  // ---- where the words went, and how they came -----------------------------------------
  // An app opens its own page (desk_app), looked up by the key the client
  // sent; the "Other" bucket is an aggregate with no page.
  const hasApp = new Set((st?.appDetail ?? []).map((a) => a.app));
  const ap = appParts((st?.topApps ?? []).map((a) => ({ app: a.app, words: a.words })),
    (app) => (hasApp.has(app) ? { kind: "navigate", screenId: "desk_app", params: { app } } as ActionRef : undefined));
  const apTotal = ap.reduce((s, p) => s + p.value, 0);
  const appsBlock = ap.length > 1
    ? section("Where the words went", hasApp.size ? "By the app you were in. Open one to see its own page." : "By the app you were in.",
        [donutWithLegend(ap, { value: n(apTotal), label: "words" })])
    : null;

  const kw = st?.kindWords;
  const kindParts: Part[] = kw ? [
    { label: "Spoken", value: kw.voice, color: SERIES[0] },
    { label: "Typed", value: kw.typing, color: SERIES[3] },
    { label: "Draft", value: kw.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0) : [];
  const kindsBlock = kindParts.length > 1
    ? section("How the words came", "Spoken, typed into the keyboard, or written for you as a draft.",
        [donutWithLegend(kindParts, { value: `${pct(kindParts[0]!.value, kindParts.reduce((s, p) => s + p.value, 0))}%`, label: kindParts[0]!.label.toLowerCase() })])
    : null;

  // ---- languages, and the days -----------------------------------------------------------
  // The languages as type specimens, each set at a size that is its share.
  const langs = (st?.writtenIn ?? []).slice(0, 5);
  const ltotal = langs.reduce((s, l) => s + l.words, 0) || 1;
  const langBlock = section("How you speak", "Your words this month, by language, each set at its share.", langs.length
    ? [stack(langs.map((l) => {
        const size = Math.round(16 + 26 * Math.sqrt(l.words / ltotal));
        return row([
          text(LANGUAGE_NAMES[l.key] ?? l.key, "d-spec", { fontSize: size, ...(/[^\u0000-ɏ]/.test(LANGUAGE_NAMES[l.key] ?? "") ? { fontFamily: "var(--f-deva)", fontWeight: 400 } : {}) }),
          text(`${pct(l.words, ltotal)}%`, "d-num"),
        ], { justify: "between", align: "end", gap: 16, paddingTop: 10, paddingBottom: 10 }, "d-rule-bottom");
      }), { marginTop: 12 })]
    : [text("Talk for a few days and this fills in, read from what X0 Bot wrote.", "d-lede", { marginTop: 12 })]);

  const heatBlock = wpd.length
    ? section("Days you talked", `${st?.daysActive ?? activeW} of the last ${wpd.length} days. The longest run was ${st?.bestStreak ?? 0}. Open a day to see it.`,
        [heatmap(wpd, now, { press: (i) => (st?.days?.[i] ? { kind: "navigate", screenId: "desk_day", params: { day: i } } : undefined) })])
    : section("Days you talked", "Your days show here once you have talked.", []);

  // ---- when: the hour, and the day of the week ------------------------------------------
  const hours = st?.hourWords ?? [];
  const peakHour = hours.indexOf(Math.max(...hours));
  const dp = st?.daypartSessions;
  const dpTotal = dp ? dp.morning + dp.afternoon + dp.evening + dp.night : 0;
  const dpTop = dp && dpTotal ? ([["morning", dp.morning], ["afternoon", dp.afternoon], ["evening", dp.evening], ["night", dp.night]] as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])[0] : undefined;
  const hourBlock = hours.some((v) => v > 0)
    ? section("Hour by hour", `Busiest at ${hourName(peakHour)}.${dpTop ? ` Mostly in the ${dpTop[0]} — ${pct(dpTop[1], dpTotal)}% of your dictations.` : ""}`,
        [columns(hours, { highlight: [peakHour], ticks: HOUR_TICKS })])
    : null;

  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const wdSum = new Array(7).fill(0) as number[], wdCount = new Array(7).fill(0) as number[];
  wpd.forEach((v, i) => {
    const d = new Date(now.getTime() - (wpd.length - 1 - i) * 86_400_000);
    const k = (d.getUTCDay() + 6) % 7;
    wdSum[k] += v; wdCount[k] += 1;
  });
  const wdAvg = wdSum.map((s, k) => (wdCount[k] ? s / wdCount[k]! : 0));
  const wdPeak = wdAvg.indexOf(Math.max(...wdAvg));
  const weekdayBlock = wdAvg.some((v) => v > 0)
    ? section("Day of the week", `${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][wdPeak]} are your biggest — about ${n(wdAvg[wdPeak]!)} words.`,
        [columns(wdAvg, { highlight: [wdPeak], labels: WD })])
    : null;

  // ---- voice, register, length ---------------------------------------------------------
  // A voice is named the way the person renamed it; a register reads ZU's own as Zu.
  const voiceName = voiceNamer(ctx);
  const toneName = (t: string) => {
    const key = (t || "").trim() || "none";
    return key === "none" ? "Zu" : (TONE_LABELS[key as keyof typeof TONE_LABELS] ?? key);
  };
  const vp = foldParts((st?.voiceWords ?? []).map((v) => ({ label: voiceName(v.id), value: v.words })));
  const voiceBlock = vp.length > 1
    ? section("Who writes for you", "Your words this month, by the voice that wrote them.",
        [donutWithLegend(vp, { value: `${vp.length}`, label: vp.length === 1 ? "voice" : "voices" })])
    : null;
  const tp = foldParts((st?.toneWords ?? []).map((t) => ({ label: toneName(t.tone), value: t.words })));
  const toneBlock = tp.length > 1
    ? section("In which register", "How formal the writing came out.", [splitBar(tp)])
    : null;

  const LENGTH_NAMES = ["1–5", "6–15", "16–40", "41–100", "100+"];
  const sl = st?.sessionLengths?.length === 5 ? st.sessionLengths : [];
  const slPeak = sl.indexOf(Math.max(...sl));
  const lengthBlock = sl.some((v) => v > 0)
    ? section("How long, in words", `Most dictations run ${LENGTH_NAMES[slPeak]} words.`,
        [columns(sl, { highlight: [slPeak], labels: LENGTH_NAMES })])
    : null;

  const dict = st?.dictionary;
  const dictBlock = dict
    ? section("What earns its place", `${n(dict.used)} of ${n(dict.saved)} saved words turned up this month.`, [
        ...(dict.saved > 0 ? [splitBar([
          { label: "Used", value: dict.used, color: SERIES[1] },
          { label: "Not yet", value: Math.max(0, dict.saved - dict.used), color: OTHER },
        ].filter((p) => p.value > 0))] : []),
        ...(dict.top?.length
          ? [text("Most used", "d-eyebrow", { marginTop: 22, marginBottom: 2 }),
             barList(dict.top.map((w) => ({ label: w.word, words: w.uses, value: `${n(w.uses)}×` })))]
          : []),
        ...(dict.unusedWords?.length
          ? [text("Never turned up", "d-eyebrow", { marginTop: 18, marginBottom: 4 }),
             text(dict.unusedWords.join(", "), "d-lede")]
          : []),
      ])
    : null;

  // THE ALLOWANCE METER, only when the window was handed the allowance.
  const allowanceSection: Node[] = ctx.allowance && (ctx.allowance.total ?? 0) > 0
    ? (() => {
        const used = ctx.allowance!.used ?? 0;
        const total = ctx.allowance!.total ?? 0;
        const p = Math.max(2, Math.min(100, Math.round((used / total) * 100)));
        return [section("This month's words", `${n(used)} of ${n(total)} words this month.`, [
          stack([stack([], { width: `${p}%`, height: 8, radius: 4, background: "var(--d-ink)" })],
            { height: 8, radius: 4, background: "var(--d-press)", marginTop: 16, maxWidth: 520 }),
        ], { flex: "none", width: "100%", marginTop: 56 })];
      })()
    : [];

  return screen("desk_insights", "Insights", [page([
    row([
      text(`Insights · ${month}`, "d-eyebrow"),
      link("Full history", { kind: "navigate", screenId: "desk_history" }),
    ], { justify: "between", align: "center" }),
    statement,
    ...(words > 0 ? [race(saidMin, typedMin, true), text(`Typed at ${TYPING_WPM} words a minute. Said is the time you spent talking.`, "d-margin", { marginTop: 10 })] : []),
    ...tilesRow,
    ...(trendBlock ? [trendBlock] : []),
    ...twoUp(appsBlock, kindsBlock),
    ...twoUp(langBlock, heatBlock),
    ...twoUp(hourBlock, weekdayBlock),
    ...twoUp(voiceBlock, toneBlock),
    ...twoUp(lengthBlock, dictBlock),
    ...(cumBlock ? [cumBlock] : []),
    ...allowanceSection,
  ])]);
}

// ---- INSIGHTS: a day, and an app ------------------------------------------------------

/** A small back cue over a detail page — the window's own chevron pops the
 *  stack, this says where back goes and reads the same on every page. */
export const backToInsights = () =>
  row([link("← Insights", { kind: "switchTab", tabId: "desk_insights" })], { marginBottom: 20 });

/** A voice's name the way the person renamed it; Zu's own signature reads as Zu. */
export function voiceNamer(ctx: DeskContext): (id: string) => string {
  const named = applyPresetOverrides(ctx.personality?.presetOverrides);
  return (id: string) => {
    const key = (id || "").trim();
    if (!key || key === "none" || key === "signature") return "Zu";
    return named.find((p) => p.id === key)?.name ?? key;
  };
}
