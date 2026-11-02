/**
 * One day in Insights.
 */

import type { ScreenResponse } from "../../../../shared/types/sdui.js";
import { LANGUAGE_NAMES } from "../../history/writtenIn.js";
import { span } from "../phoneLook.js";
import { statTile, race, columns, appParts, donutWithLegend, type Part, SERIES, foldParts, splitBar } from "./charts.js";
import { type DeskContext, TYPING_WPM } from "./context.js";
import { backToInsights } from "./insights.js";
import { screen, page, text, stack, row, n, section, inline, twoUp } from "./kit.js";
import { local, dateLine, hourName, HOUR_TICKS } from "./time.js";

/**
 * ONE DAY, on its own page — reached from a filled square on Insights. The
 * square sent its place in the run (params.day); the date is read back from
 * that, and the bucket's detail is the stats read the window already made for
 * Insights, so this costs no extra work. Said against typed at the top, when in
 * the day under it, and down the side where the words went, how they were
 * written, and in what.
 */
export function deskDay(ctx: DeskContext): ScreenResponse {
  const st = ctx.stats;
  const list = st?.days ?? [];
  const idx = Math.trunc(Number(ctx.params?.day));
  const d = Number.isInteger(idx) && idx >= 0 && idx < list.length ? list[idx] : undefined;
  if (!st || !d) {
    return screen("desk_day", "Day", [page([
      backToInsights(),
      text("Insights", "d-eyebrow"),
      text("That day isn't here.", "d-h1", { marginTop: 6 }),
      text("Open it again from a filled square on Insights.", "d-lede", { marginTop: 8 }),
    ])]);
  }
  const now = local(ctx, Date.now());
  const date = new Date(now.getTime() - (list.length - 1 - idx) * 86_400_000);
  const saidMin = d.saidSeconds / 60;
  const typedMin = d.words / TYPING_WPM;
  const saved = Math.max(0, typedMin - saidMin);
  const times = d.first && d.last && d.first !== d.last ? `${d.first}–${d.last}` : (d.first || "");

  const head = stack([
    backToInsights(),
    text("Insights", "d-eyebrow"),
    text(dateLine(date), "d-h1", { marginTop: 6 }),
  ], { marginBottom: 32 });

  const tiles = row([
    statTile("Words", n(d.words), `${d.sessions} ${d.sessions === 1 ? "dictation" : "dictations"}`),
    statTile("Time back", d.words ? span(saved) : "—", `against typing at ${TYPING_WPM} wpm`),
    statTile("Per dictation", d.sessions ? n(Math.round(d.words / d.sessions)) : "—", "words, on average"),
    ...(times ? [statTile("From first to last", times, "your talking hours")] : []),
  ], { gap: 32, flexWrap: "wrap", paddingTop: 26, marginBottom: 8 }, "d-rule-top");

  const raceBlock = d.words > 0
    ? section("Said against typed", undefined, [
        stack([race(saidMin, typedMin, true)], { marginTop: 18 }),
        ...(saved >= 1 ? [inline([text(span(saved), "d-em"), text(" back on the day.", "d-inherit")], "d-written", { fontSize: 18, lineHeight: "26px", marginTop: 16 })] : []),
        text(`Typed at ${TYPING_WPM} words a minute.`, "d-margin", { marginTop: 8 }),
      ])
    : null;
  const hours = d.hours?.length === 24 ? d.hours : new Array(24).fill(0) as number[];
  const peak = hours.indexOf(Math.max(...hours));
  const hourBlock = hours.some((v) => v > 0)
    ? section("Hour by hour", `Busiest at ${hourName(peak)}.`, [columns(hours, { highlight: [peak], ticks: HOUR_TICKS })])
    : null;

  const ap = appParts((d.apps ?? []).map((a) => ({ app: a.app, words: a.words })));
  const appsBlock = ap.length > 1
    ? section("Where the words went", "By the app you were in.", [donutWithLegend(ap, { value: n(d.words), label: "words" })])
    : ap.length === 1 ? section("Where the words went", `Every word in ${ap[0]!.label}.`, []) : null;
  const kp: Part[] = [
    { label: "Spoken", value: d.kinds.voice, color: SERIES[0] },
    { label: "Typed", value: d.kinds.typing, color: SERIES[3] },
    { label: "Draft", value: d.kinds.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0);
  const lp = foldParts((d.languages ?? []).map((l) => ({ label: LANGUAGE_NAMES[l.key] ?? l.key, value: l.words })));
  const howBlock = kp.length > 1 || lp.length > 1
    ? section("How, and in what", undefined, [
        ...(kp.length > 1 ? [text("How the words came", "d-eyebrow", { marginTop: 18 }), splitBar(kp)] : []),
        ...(lp.length > 1 ? [text("Languages", "d-eyebrow", { marginTop: 30 }), splitBar(lp)] : []),
      ])
    : null;

  return screen("desk_day", dateLine(date), [page([
    head,
    tiles,
    ...twoUp(raceBlock, hourBlock),
    ...twoUp(appsBlock, howBlock),
  ])]);
}
