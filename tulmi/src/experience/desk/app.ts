/**
 * One app in Insights.
 */

import type { ScreenResponse } from "../../../../shared/types/sdui.js";
import { appName, statTile, pct, columns, type Part, SERIES, foldParts, splitBar } from "./charts.js";
import type { DeskContext } from "./context.js";
import { backToInsights, voiceNamer } from "./insights.js";
import { screen, page, text, stack, row, n, section, twoUp } from "./kit.js";
import { local, dateLine, MONTHS, DAYPARTS } from "./time.js";

/**
 * ONE APP, on its own page — reached from a bar on Insights. The bar sent the
 * key the client wrote the words into (params.app); its detail is matched out
 * of the same stats read. How much went there and in how many pieces, the time
 * of day it happens, and how it was written.
 */
export function deskApp(ctx: DeskContext): ScreenResponse {
  const st = ctx.stats;
  const key = String(ctx.params?.app ?? "");
  const a = (st?.appDetail ?? []).find((x) => x.app === key);
  if (!st || !a) {
    return screen("desk_app", "App", [page([
      backToInsights(),
      text("Insights", "d-eyebrow"),
      text("Nothing for that app.", "d-h1", { marginTop: 6 }),
      text("Open it again from a bar on Insights.", "d-lede", { marginTop: 8 }),
    ])]);
  }
  const disp = appName(a.app) || "Other";
  const now = local(ctx, Date.now());
  const lastAt = Date.parse(a.lastAt);
  const lastLine = Number.isFinite(lastAt) ? `Last used ${dateLine(local(ctx, lastAt))}` : "";

  const head = stack([
    backToInsights(),
    text("Where the words went", "d-eyebrow"),
    text(disp, "d-h1", { marginTop: 6 }),
    ...(lastLine ? [text(lastLine, "d-margin", { marginTop: 10 })] : []),
  ], { marginBottom: 32 });

  // Its place among the others: the share of every word that went to an app,
  // and where it ranks — the same read Insights draws its donut from.
  const all = [...(st.appDetail ?? [])].sort((x, y) => y.words - x.words);
  const allWords = all.reduce((s, x) => s + x.words, 0) || 1;
  const rank = all.findIndex((x) => x.app === a.app) + 1;
  const overallAvg = st.avgWordsPerSession ?? 0;
  const perDay = (st.days ?? []).map((d) => d.apps.find((x) => x.app === a.app)?.words ?? 0);
  const daysUsed = perDay.filter((v) => v > 0).length;
  const avgDelta = overallAvg > 0 && a.avgWords > 0 ? Math.round(((a.avgWords - overallAvg) / overallAvg) * 100) : null;

  const tiles = row([
    statTile("Words", n(a.words), `${pct(a.words, allWords)}% of all your words`),
    statTile("Dictations", n(a.sessions), rank > 0 ? (rank === 1 ? "your most-used app" : `number ${rank} of ${all.length} apps`) : undefined),
    statTile("Per dictation", a.avgWords > 0 ? n(a.avgWords) : "—",
      avgDelta == null ? "words, on average" : avgDelta === 0 ? "the same as everywhere else" : `${Math.abs(avgDelta)}% ${avgDelta > 0 ? "longer" : "shorter"} than your usual`),
    ...(perDay.length ? [statTile("Days used", `${daysUsed}`, `of the last ${perDay.length}`)] : []),
  ], { gap: 32, flexWrap: "wrap", paddingTop: 26 }, "d-rule-top");

  const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const dayBlock = daysUsed > 1
    ? section("Day by day", `${disp}, every day of the last ${perDay.length}. The amber column is the biggest.`,
        [columns(perDay, { highlight: [perDay.indexOf(Math.max(...perDay))], ticks: [dayLabel(perDay.length - 1), dayLabel(Math.floor((perDay.length - 1) / 2)), "Today"] })],
        { flex: "none", width: "100%", marginTop: 52 })
    : null;

  const dp =[a.dayparts.morning, a.dayparts.afternoon, a.dayparts.evening, a.dayparts.night];
  const dpPeak = dp.indexOf(Math.max(...dp));
  const whenBlock = dp.some((v) => v > 0)
    ? section("When in the day", `Mostly in the ${DAYPARTS[dpPeak]!.toLowerCase()}${dpPeak === 3 ? "" : "s"}. Dictations by time of day.`,
        [stack([columns(dp, { highlight: [dpPeak], labels: [...DAYPARTS], height: 110 })], { maxWidth: 360, marginTop: 18 })])
    : null;

  const kp: Part[] = [
    { label: "Spoken", value: a.kinds.voice, color: SERIES[0] },
    { label: "Typed", value: a.kinds.typing, color: SERIES[3] },
    { label: "Draft", value: a.kinds.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0);
  const voiceName = voiceNamer(ctx);
  const vp = foldParts((a.voices ?? []).map((v) => ({ label: voiceName(v.id), value: v.words })));
  const howBlock = kp.length > 1 || vp.length > 1
    ? section("How it was written", undefined, [
        ...(kp.length > 1 ? [text("Spoken, typed, drafted", "d-eyebrow", { marginTop: 18 }), splitBar(kp)] : []),
        ...(vp.length > 1 ? [text("In which voice", "d-eyebrow", { marginTop: 30 }), splitBar(vp)] : []),
      ])
    : kp.length === 1 ? section("How it was written", `All ${kp[0]!.label.toLowerCase()}.`, []) : null;

  const blocks = [...(dayBlock ? [dayBlock] : []), ...twoUp(whenBlock, howBlock)];
  return screen("desk_app", disp, [page([
    head,
    tiles,
    ...(blocks.length ? blocks : [text("Talk into this app for a few days and its shape fills in here.", "d-lede", { marginTop: 32 })]),
  ])]);
}
