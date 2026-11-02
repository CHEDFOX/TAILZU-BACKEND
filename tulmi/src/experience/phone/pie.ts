/**
 * Pie charts of how the person writes: slices by app, voice, language and dictionary.
 */

import type { StatsResponse, Personality } from "../../../../shared/types/api.js";
import type { Node } from "../../../../shared/types/sdui.js";
import { LANGS as ALL_LANGS } from "../languages.js";
import { applyPresetOverrides } from "../personalityPresets.js";

/**
 * THE CHARTS — one place that turns measured stats into slices.
 *
 * Every number here came off the user's own history. Nothing is smoothed,
 * padded or invented: a card with no data returns no slices and the ring says
 * so in words, because an empty ring is the truthful picture of "you have not
 * done this yet" and a full one of a single grey slice is not.
 *
 * COLOURS ARE PER SURFACE, and that is why they are arguments rather than
 * constants: the same slice needs a different ink on a different ground. A
 * palette is one hue at falling weight rather than a spectrum — a chart of
 * five unrelated colours invites the reader to look for meaning in the hue,
 * and here the only meaning is size.
 */
export type Slice = { label: string; value: number; color: string };

/** Language codes as people read them. Anything unlisted shows its own code. */
export const LANGUAGE_NAMES: Record<string, string> = {
  ...Object.fromEntries(ALL_LANGS.map((l) => [l.slug === "hinglish" ? "hinglish" : l.code, l.name])),
  auto: "Auto", en: "English", hi: "Hindi", hinglish: "Hinglish", mr: "Marathi",
  bn: "Bengali", ta: "Tamil", te: "Telugu", gu: "Gujarati", kn: "Kannada",
  ml: "Malayalam", pa: "Punjabi", ur: "Urdu", es: "Spanish", fr: "French",
  de: "German", it: "Italian", pt: "Portuguese", ru: "Russian", ar: "Arabic",
  ja: "Japanese", ko: "Korean", zh: "Chinese",
};

/**
 * Top N slices, with the tail folded into one.
 *
 * Five is the ceiling because a ring is read by comparing arcs, and past five
 * the arcs are too close to tell apart — the sixth-largest thing is better
 * served by the word "Other" than by a slice nobody can measure.
 */
function topSlices(
  rows: Array<{ label: string; words: number }>,
  palette: string[],
  tailLabel = "Other",
): Slice[] {
  const ranked = [...rows].filter((r) => r.words > 0).sort((a, b) => b.words - a.words);
  const head = ranked.slice(0, palette.length - 1);
  const tail = ranked.slice(palette.length - 1).reduce((sum, r) => sum + r.words, 0);
  const out: Slice[] = head.map((r, i) => ({
    label: r.label, value: r.words, color: palette[i]!,
  }));
  if (tail > 0) out.push({ label: tailLabel, value: tail, color: palette[palette.length - 1]! });
  return out;
}

/** What share of the saved dictionary is doing any work. */
export function dictionarySlices(stats: StatsResponse | undefined, palette: string[]): Slice[] {
  const d = stats?.dictionary;
  if (!d || d.saved <= 0) return [];
  return [
    { label: "Used", value: d.used, color: palette[0]! },
    { label: "Never used", value: d.unused, color: palette[palette.length - 1]! },
  ].filter((sl) => sl.value > 0);
}

/** Which voice actually writes. Ids resolve to the names the user sees. */
export function voiceSlices(
  stats: StatsResponse | undefined,
  personality: Personality | undefined,
  palette: string[],
): Slice[] {
  const rows = stats?.voiceWords ?? [];
  if (!rows.length) return [];
  const named = applyPresetOverrides(personality?.presetOverrides);
  return topSlices(
    rows.map((r) => ({
      label: named.find((p) => p.id === r.id)?.name ?? r.id,
      words: r.words,
    })),
    palette,
  );
}

/** What they write in. */
export function languageSlices(stats: StatsResponse | undefined, palette: string[]): Slice[] {
  const rows = stats?.languageWords ?? [];
  if (!rows.length) return [];
  return topSlices(
    rows.map((r) => ({ label: LANGUAGE_NAMES[r.language] ?? r.language, words: r.words })),
    palette,
  );
}

/**
 * The ring, as a node.
 *
 * `centerValue` is the one number worth reading without the legend — the share
 * of the dictionary in use, the count of languages written in. It is computed
 * here from the same rows the slices come from, so the hole can never disagree
 * with the ring around it.
 */
export function pieNode(opts: {
  slices: Slice[];
  size: number;
  thickness?: number;
  gap?: number;
  legend?: boolean;
  legendColor?: string;
  centerValue?: string;
  centerLabel?: string;
  emptyLabel: string;
  style?: Record<string, unknown>;
}): Node {
  return {
    type: "PieChart",
    props: {
      slices: opts.slices,
      size: opts.size,
      thickness: opts.thickness ?? Math.round(opts.size * 0.17),
      ...(opts.gap !== undefined ? { gap: opts.gap } : {}),
      legend: opts.legend ?? false,
      ...(opts.legendColor ? { legendColor: opts.legendColor } : {}),
      ...(opts.centerValue ? { centerValue: opts.centerValue } : {}),
      ...(opts.centerLabel ? { centerLabel: opts.centerLabel } : {}),
      emptyLabel: opts.emptyLabel,
    },
    ...(opts.style ? { style: opts.style } : {}),
  };
}
