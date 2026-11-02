/**
 * The phone app's navigation: the tabs, their glyphs, the dock and the rail.
 */

import type { TabGlyph, NavigationShell } from "../../../../shared/types/sdui.js";

/**
 * Where the app opens.
 *
 * A first-time user has just finished onboarding and has never seen the inside
 * of the product: You is the tab that sets it up for them — their voices,
 * words, keys and languages — so that is where they land, once.
 *
 * Everyone after that lands on Stats, because it is the only tab that has
 * changed since they last looked. Train is where you go to do something; Stats
 * is what makes reopening the app worth it.
 */
const FIRST_TAB = "personality";
const RETURNING_TAB = "stats";

/**
 * THE TAB ICONS, AS DATA.
 *
 * The backend is the creator and the app is a renderer. Icons were the one
 * place that was quietly untrue: the app matched each tab's id against shapes
 * it carried itself, and the `icon` slot on the tab was never read. A redrawn
 * set meant a release. Now the geometry is here, on a 32-unit grid, and the
 * app draws whatever it is handed — so the next set ships with a cache bump.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT IS NOT ANY MORE.
 *
 * The old three were a conceit about one material: a thread through a node, a
 * thread folded into cloth, a label saying whose it is. It reads beautifully
 * written down and not at all on a phone. Drawn, the node became a small
 * square with a diagonal struck through it, which is the universal sign for
 * NOT ALLOWED; the folded thread became a numeral, which the comment here
 * admitted by adding a fourth row so it would stop reading as a 2; and the
 * label became a luggage tag, which says price, not person.
 *
 * A tab bar is read peripherally, in a fifth of a second, by someone who is
 * not looking at it. It is the one surface in a product where being understood
 * beats being interesting, and three glyphs nobody can name is a navigation
 * bar that has to be learned.
 *
 * So: a waveform, bars, a person. Train is speech becoming writing and a
 * waveform is what speech looks like everywhere. Stats is quantities and bars
 * are quantities. You is a person. None of them is clever and all three are
 * legible at 28 points, which is the size they are actually drawn at.
 *
 * The house style is kept where it costs nothing: one stroke weight family,
 * round caps and joins, the same 32-unit grid, everything optically centred on
 * 16. Active thickens the open strokes and fills the closed one, exactly as
 * before.
 */
/**
 * THE BAR'S TWO TONES.
 *
 * MALT is what the shapes are made of — sampled from the mark's own light
 * squares and warmed until it stops reading as white. PALE is what shows where
 * two of them overlap, lighter than either, so a stack reads as two things and
 * not as one silhouette with a seam.
 *
 * The accent is reserved: it is never the material, only the layer that has
 * been chosen.
 */
const TAB_MALT = "#D8C3A5";
/** The accent, by value. ACCENT_AMBER is declared further down the file and
 *  this block is read while the module is still being evaluated. The lit
 *  layer of the selected tab wears it: the owner's call, and the one place a
 *  tab says which room you are in. */
const TAB_ACCENT = "#E8A23C";
export const TAB_PALE = "#F3E2C6";

/**
 * DUOTONE, AND THE STATE IS A COLOUR RATHER THAN A SHAPE.
 *
 * At rest every layer is malt, so each icon is one flat silhouette and the bar
 * says nothing. Selected, ONE layer turns to the accent and the overlap turns
 * pale — the shape never moves. Nothing animates into place, nothing has to be
 * learned, and the eye is drawn by warmth rather than by a change of form.
 *
 * Layer order is paint order: back first, then front, then the overlap on top
 * of both. That third layer is drawn geometry rather than a blend mode, which
 * react-native-svg does not have.
 */
/**
 * Two overlapping discs — the You tab's mark.
 *
 * Declared before the set because the set uses it, and a `const` read while
 * the module is still being evaluated has to already exist.
 */
const TAB_GLYPH_CONTRAST: TabGlyph = {
  layers: [
    {
      d: "M5.80 16.00 A7.2 7.2 0 1 1 20.20 16.00 A7.2 7.2 0 1 1 5.80 16.00 Z",
      fill: true, activeFill: true, color: TAB_MALT,
    },
    {
      // Clearly the smaller of the two, and still substantial. Taken further
      // it stops reading as a pair and starts reading as a satellite.
      d: "M16.20 16.00 A4.6 4.6 0 1 1 25.40 16.00 A4.6 4.6 0 1 1 16.20 16.00 Z",
      fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT,
    },
    {
      // The overlap, drawn as its own shape. Two translucent discs would give
      // it for free and would also make the whole glyph translucent, which on
      // art rather than on black is a different colour every screen.
      d: "M18.87 11.83 A7.2 7.2 0 0 1 18.87 20.17 A4.6 4.6 0 0 1 18.87 11.83 Z",
      fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_PALE,
    },
  ],
};

const TAB_GLYPHS: Record<string, TabGlyph> = {
  // TRAIN — two plates, offset, the front one lifting off the back. Two takes
  // on the same thing, which is what this tab does.
  //
  // The corners are cut back along each edge and closed with a quadratic
  // through the original vertex, which is what a rounded corner IS on a shape
  // whose angles are not right angles. A border radius cannot help here.
  home: {
    layers: [
      {
        d: "M13.73 8.76 Q16.00 7.50 18.27 8.76 L22.73 11.24 Q25.00 12.50 22.73 13.76 " +
           "L18.27 16.24 Q16.00 17.50 13.73 16.24 L9.27 13.76 Q7.00 12.50 9.27 11.24 Z",
        fill: true, activeFill: true, color: TAB_MALT,
      },
      {
        d: "M13.73 15.76 Q16.00 14.50 18.27 15.76 L22.73 18.24 Q25.00 19.50 22.73 20.76 " +
           "L18.27 23.24 Q16.00 24.50 13.73 23.24 L9.27 20.76 Q7.00 19.50 9.27 18.24 Z",
        fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT,
      },
      {
        d: "M15.34 14.86 Q16.00 14.50 16.66 14.86 L18.04 15.64 Q18.70 16.00 18.04 16.36 " +
           "L16.66 17.14 Q16.00 17.50 15.34 17.14 L13.96 16.36 Q13.30 16.00 13.96 15.64 Z",
        fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_PALE,
      },
    ],
  },

  // STATS — a disc with one slice stepped out of it. The slice is the layer
  // that lights, so what the accent marks is the share, not the whole.
  stats: {
    layers: [
      { d: "M15.30 16.70 L22.39 15.45 A7.2 7.2 0 1 1 16.55 9.61 Z", fill: true, activeFill: true, color: TAB_MALT },
      { d: "M16.57 15.43 L17.82 8.34 A7.2 7.2 0 0 1 23.66 14.18 Z", fill: true, activeFill: true, color: TAB_MALT, activeColor: TAB_ACCENT },
    ],
  },

  // YOU — two overlapping discs, the large one plain and the small one lit.
  //
  // The person was the obvious drawing and that is the problem with it: a head
  // on shoulders is the same mark every app in the tray already carries, so
  // the one tab that is about THIS person looked like everyone else's account
  // button. The pair says the same thing sideways — you, and the part of you
  // the app is holding — and it is the only glyph in the bar with an overlap,
  // which is what makes it findable without being read.
  personality: TAB_GLYPH_CONTRAST,
};

/**
 * THE DOCK — three squares close together, not a bar across the screen.
 *
 * Spread across the full width, the three marks stopped being one control.
 * The eye has to travel the whole screen to take them in, nothing says they
 * belong to each other, and the gap between them is decided by the width of
 * the phone rather than by anyone. Pulled together and each given its own
 * ground, they read as one group with three positions in it — which is what a
 * tab bar is — and they say it without a panel drawn behind the lot of them.
 *
 * The ground is what lets them sit on anything. These tabs float over
 * full-bleed art on one tab and a black deck on another; a mark alone has to
 * hope the art behind it is dark, and a mark on its own square never does.
 *
 * 58 with a 19 radius is a squircle, not a circle and not a box — half of 58
 * would be a disc, and a disc under a glyph that is itself made of discs
 * turns the whole thing into a target. 10 between them is close enough to
 * group and far enough that the selected one is clearly one of three.
 */
const TAB_DOCK = {
  // Smaller since the refresh: the tabs are two quiet squares, not a bar.
  size: 50,
  radius: 16,
  gap: 10,
  /** Lighter than black so it reads on the deck, dark enough to sit on art. */
  background: "rgba(30,30,32,0.92)",
  /**
   * The one you are on is a LITTLE lighter, and no more than that. The icon
   * already carries the accent; a lit square as well would put the colour in
   * two places and the eye would go to the bigger one — which is the ground,
   * not the mark.
   */
  activeBackground: "rgba(52,52,56,0.96)",
  lift: 4,
};

export function navigationFor(landedBefore: boolean): NavigationShell {
  // NAV is the tabs shell; the narrowing keeps this honest if it ever is not.
  if (NAV.kind !== "tabs") return NAV;
  return {
    ...NAV,
    tabs: NAV.tabs.map((t) => ({ ...t, glyph: TAB_GLYPHS[t.id] })),
    rail: TAB_RAIL,
    dock: TAB_DOCK,
    initialTabId: landedBefore ? RETURNING_TAB : FIRST_TAB,
  };
}

/** The thread across the whole bar behind the icons. false hides it.
 *
 *  Off. The icons became circles that change into something when you choose
 *  them, and a wave running between them turns three quiet marks into a busy
 *  strip. The thread earned its place when the glyphs were outlines competing
 *  with it; against a single dot it is the loudest thing in the bar. */
const TAB_RAIL = false;

export const NAV: NavigationShell = {
  kind: "tabs",
  // Settings is no longer a bottom tab — it's reached via the ⚙ gear in the
  // top-right of the header (client renders it on the tab roots). The settings
  // screen itself still exists at screenId "settings" and is pushed on tap.
  tabs: [
    // TRAIN IS A CARD ON YOU NOW, not a tab. Training is how the app learns
    // the person, and You is the page about the person. "home" still names
    // the landing (see landingScreenId) and still opens the old screen for
    // any client that asks for it.
    { id: "stats", title: "Stats", screenId: "stats" },
    { id: "personality", title: "You", screenId: "personality" },
  ],
};
