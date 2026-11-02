/**
 * The neural field: the animated backdrop that grows as the app learns the person.
 */

import type { Personality } from "../../../../shared/types/api.js";
import type { Node } from "../../../../shared/types/sdui.js";
import { FILL_STYLE } from "./layout.js";

/**
 * THE NEURAL FIELD — the training tab's hero, as data.
 *
 * A connectome: a region of interlinked systems, each its own core, branching
 * and colour family, wired to each other by a few great highways that every
 * long-range connection merges into. It fires in cascades and grows new fibres
 * while a session runs.
 *
 * Every number is here, so retuning the hero is a cache bump. `regions` is the
 * composition: each entry is a cluster of systems around a seat given in
 * fractions of the frame, so the layout holds on any phone. Seats outside 0..1
 * are deliberate — roughly a third of the field is past the edge, which is
 * what makes the picture read as a section of something larger.
 */
export const NEURAL_FIELD = {
  /** The whole field's opacity. Lower it where the field is scenery behind
   *  copy; leave it at 1 where the field IS the screen. */
  alpha: 1,
  bloom: 0.44,
  /** The z the lens is focused on. Everything either side of it softens. */
  focal: 0.35,
  maxPulses: 700,
  /** The one warm light: activity, and nothing else. Amber, because the
   *  field this default serves is the LIVE one (the training session, bound
   *  to sessionState). Where the field is scenery — nothing live — its
   *  placements pass FIELD_SIGNAL_AT_REST instead. */
  signal: [232, 162, 60],
  head: [255, 241, 214],
  regions: [
    { x: 0.55, y: 0.42, hue: 335, n: 6, z: 0.40, sc: 1.00 },
    { x: 0.02, y: 0.14, hue: 196, n: 5, z: -0.35, sc: 0.78 },
    { x: 1.04, y: 0.22, hue: 40, n: 5, z: 0.65, sc: 0.74 },
    { x: 0.10, y: 0.86, hue: 262, n: 6, z: 0.10, sc: 0.80 },
    { x: 0.98, y: 0.80, hue: 152, n: 5, z: -0.55, sc: 0.76 },
    { x: 0.55, y: 1.16, hue: 58, n: 4, z: 0.30, sc: 0.62 },
    { x: 0.60, y: -0.16, hue: 300, n: 4, z: -0.75, sc: 0.62 },
  ],
};

/** The field as a node. `dim` is how far back it sits behind whatever is on it. */
/**
 * HOW MUCH OF THE NETWORK HAS BEEN EARNED, 0..1.
 *
 * The screen's claim is that the thing inside gets bigger every time you talk
 * to it, and a field that looks identical on day one and month six is that
 * claim being false in the one place it is visible. So the density is a
 * measurement, not a constant: it comes off the same style portrait the stats
 * under the button are counted from — the person's own words, the modes they
 * write in, their hours, the sittings, the refines observed.
 *
 * Saturating rather than linear, because the difference between nothing and a
 * first session has to be obvious and the difference between the fiftieth and
 * the fifty-first does not.
 *
 * Never zero. A brand-new account still sees a network — the hubs are the
 * shape of the thing and they are all there from the start. What grows is the
 * CONNECTIONS between them, which is exactly what training makes.
 */
export function fieldGrowth(p: Personality | undefined): number {
  const sp = p?.stylePortrait;
  if (!sp) return 0.18;
  const learned =
    (sp.words?.length ?? 0) + (sp.styles?.length ?? 0) +
    (sp.rhythms?.length ?? 0) + Object.keys(sp.tones ?? {}).length;
  const evidence = learned + (sp.sessions ?? 0) * 2 + (sp.observed ?? 0) / 40;
  const g = 0.18 + 0.82 * (1 - Math.exp(-evidence / 60));
  return Math.max(0.18, Math.min(1, Number(g.toFixed(3))));
}

/**
 * The pulses' colour where the field is scenery rather than a live session:
 * pale ink. Amber is for what is live right now (recording, listening, a
 * voice session), and a field behind a title or on a card is not.
 */
export const FIELD_SIGNAL_AT_REST = [243, 226, 198];

/** `signal` overrides NEURAL_FIELD.signal — pass FIELD_SIGNAL_AT_REST for
 *  every placement that is not the live session. */
export function neuralField(dim: number, growth: number, bind?: Record<string, string>, signal?: readonly number[]): Node {
  return {
    type: "NeuralField",
    ...(bind ? { bind } : {}),
    props: { ...NEURAL_FIELD, alpha: NEURAL_FIELD.alpha * dim, growth, ...(signal ? { signal: [...signal] } : {}) },
    style: { ...FILL_STYLE },
    // A bundle without it draws nothing rather than a hole: the screens it
    // sits on are black, and black is what they were before it existed.
    fallback: { type: "Stack", style: { ...FILL_STYLE, backgroundColor: "#000000" } },
  };
}
