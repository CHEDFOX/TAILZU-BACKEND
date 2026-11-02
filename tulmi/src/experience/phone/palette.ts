/**
 * Colours the phone screens share beyond the theme.
 */

/**
 * The brand accent — the warm amber sampled from the mic animation.
 *
 * The theme's `primary` is WHITE by design (black surface, white CTAs), so
 * anything reaching for `THEME.color.primary` to get "the brand colour" gets
 * white and silently disappears. That is exactly what happened to the
 * Languages heading. The accent has been living as a scattered literal;
 * this is the name the theme comment has always claimed exists.
 */
export const ACCENT_AMBER = "#E8A23C";

/**
 * On the dark ground: pale ink at falling weight, the TOP slice at full
 * strength. No amber — a ring is a count, not something live — so the share
 * that leads is marked by weight alone, and the steps are spaced evenly in
 * lightness (full → 0.7 → 0.52 → …) so the first two slices still part.
 */
export const CHART_ON_DARK = [
  "#F3E2C6", "rgba(243,226,198,0.7)", "rgba(243,226,198,0.52)",
  "rgba(243,226,198,0.32)", "rgba(243,226,198,0.16)",
];
