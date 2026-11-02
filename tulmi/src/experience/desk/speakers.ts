/**
 * Who spoke in a note: each speaker's colour, chip and box.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { SERIES } from "./charts.js";
import { stack, row, text } from "./kit.js";

/**
 * THE SPEAKERS' COLOURS. A note's page gives every voice one colour, the same
 * wherever it appears: the dot by its name at the top, its box in "What
 * mattered", its swatch, slice and lane in the numbers. The colour follows
 * the speaker, never their rank, so a quiet voice keeps its colour whoever
 * talked most.
 *
 * "You" is always the desk's accent. "Speaker n" takes slot n of six, so
 * Speaker 1 is teal on every note, and Speaker 7 is teal again: past six the
 * palette repeats, and the name written beside every colour tells them apart.
 * "Others" (call voices the diarizer could not split) is a neutral, not a
 * person's colour. A label of any other shape is placed by its letters, so it
 * too keeps one colour.
 *
 * You and Speakers 1–3 are the four validated SERIES hues, so the common
 * meeting (four voices or fewer) is the donut's validated set exactly. The
 * three after them were picked by the data-viz validator against both desk
 * surfaces (#FFFFFF, #151210): lightness, chroma and 3:1 contrast pass in
 * both, and the closest pair across all seven is ΔE 13 under normal vision,
 * which is why a colour is never the only thing that says who.
 *
 * A box is a TINT, mixed from the speaker's colour into the theme's own sheet
 * (`color-mix`, as the charts already do), so one value is a soft wash on the
 * light sheet and a quiet glow on the dark one, and nothing waits on a build.
 */
const YOU_COLOR = SERIES[0];
export const SPEAKER_COLORS = ["#00977F", "#4B5BD0", "#D6456E", "#A06DBE", "#248FCC", "#A34D16"] as const;
const UNSPLIT = "color-mix(in srgb, var(--d-ink) 40%, var(--d-sheet))";
export function speakerColor(label: string): string {
  if (label === "You") return YOU_COLOR;
  if (!label || label === "Others") return UNSPLIT;
  const m = /^Speaker (\d+)$/.exec(label);
  let i = m ? Number(m[1]) - 1 : 0;
  if (!m) for (const ch of label) i = (i * 31 + ch.charCodeAt(0)) % 9973;
  return SPEAKER_COLORS[((i % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length]!;
}
/** A colour washed into the sheet: `pct` of it, the rest the theme's paper. */
const tint = (color: string, pctOf: number) => `color-mix(in srgb, ${color} ${pctOf}%, var(--d-sheet))`;

/** A round dot of a speaker's colour, for beside their name. */
const speakerDot = (color: string, size = 8): Node => stack([], { width: size, height: size, radius: "50%", background: color, flex: "none" });

/** A speaker as a small chip: a dot of their colour and their name. */
export function speakerChip(name: string, color: string): Node {
  return row([speakerDot(color, 7), text(name, "d-margin-strong", { color: "var(--d-ink)", whiteSpace: "nowrap" })], {
    gap: 7, align: "center", paddingTop: 4, paddingBottom: 4, paddingLeft: 9, paddingRight: 11,
    radius: 999, background: tint(color, 11), border: `1px solid ${tint(color, 24)}`,
  });
}

/**
 * One turn in "What mattered": what a speaker said in a row, in a soft box
 * of their colour, their dot and name at the top. Text stays in the ink; the
 * colour is only the wash, the hairline and the dot.
 */
export function speakerBox(name: string, color: string, points: string[]): Node {
  return stack([
    row([speakerDot(color), text(name, "d-margin-strong", { color: "var(--d-ink)" })], { gap: 8, align: "center" }),
    ...points.map((p, i) => /[ऀ-ॿ]/.test(p)
      ? text(p, "d-said d-deva", { fontSize: 16, lineHeight: "25px", color: "var(--d-ink)", marginTop: i ? 12 : 10 })
      : text(p, "d-said", { fontSize: 20, lineHeight: "27px", color: "var(--d-ink)", marginTop: i ? 12 : 8 })),
  ], {
    background: tint(color, 9), border: `1px solid ${tint(color, 22)}`, radius: 12,
    paddingTop: 14, paddingBottom: 18, paddingLeft: 20, paddingRight: 22,
  }, "d-speaker");
}
