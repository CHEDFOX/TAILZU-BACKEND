/**
 * THE FIRST SIX IMAGES, PUT IN ORDER — the Travel bot's whole onboarding (src/discover/onboarding.ts).
 *
 *   bots.travel.first-look     six photographs; tap them most-like-you first; Done sends the order
 *
 * TAP TO ORDER, NOT DRAG. Dragging tiles with a thumb is fiddly and people give up halfway, which would leave a
 * half-order — and a half-order is the one thing this must never fold, because a missing tap would become
 * evidence. Tapping puts a number on the tile; tapping it again takes it back out.
 *
 * THE NUMBERS ARE DRAWN BY THE APP, NOT FETCHED. Each tile carries six badges, one per place in the order, each
 * shown only when `order.<n>` is that tile (SDUI eq on a state path with an index). So six taps are six instant
 * redraws with no round trip — the screen never waits on us to say what somebody just did.
 *
 * NOTHING IS SENT UNTIL ALL SIX ARE IN. Done appears only when `order.5` exists, because the order has to be
 * complete to mean anything. Skip is on the bar throughout: a person who will not play this still gets a feed,
 * from the catalogue's own editorial order.
 */
import type { ActionRef, Condition, Node } from "../../../../../shared/types/sdui.js";
import {
  box, C, call, col, grid, meta, page, picture, primaryButton, quietButton, row, SCREENS, seq, text, title, when,
  type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

export const FIRST_LOOK_PATH = "/v1/discover/first-look";

/** What the app is told about one image (routes/bots/discover.ts). */
export interface FirstLookImageView {
  id: string;
  label: string;
  sub: string;
  /** Drawn while a photograph loads, and instead of one where the catalogue has none yet. */
  colour: string;
  photo?: { url: string; alt: string } | null;
}

export interface FirstLookView {
  version: string;
  title: string;
  sub: string;
  images: FirstLookImageView[];
}

/** Where the order is kept while they tap. */
const ORDER = "order";
const TILE_H = 132;

/** Tap to put it in the order; tap again to take it out. */
const toggle = (id: string): ActionRef => ({ kind: "toggleInArray", path: ORDER, value: id });

/** This tile is somewhere in the order. */
const chosen = (id: string, of: number): Condition => ({
  any: Array.from({ length: of }, (_, i) => ({ eq: [`${ORDER}.${i}`, id] as [string, unknown] })),
});

/** The number on a chosen tile: one node per place in the order, only one of them ever visible. */
function badges(id: string, of: number): Node[] {
  return Array.from({ length: of }, (_, i) =>
    when({ eq: [`${ORDER}.${i}`, id] }, box([
      text(String(i + 1), { size: 13, weight: 700, color: C.paper, lineHeight: 16 }),
    ], {
      position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
      backgroundColor: C.ink, alignItems: "center", justifyContent: "center",
    })),
  );
}

function tile(image: FirstLookImageView, of: number, width: number): Node {
  const inner: Node[] = [
    image.photo?.url
      ? picture(image.photo.url, width, TILE_H, { radius: 18, background: image.colour, fit: "cover", label: image.photo.alt })
      : box([], { width: "100%", height: TILE_H, borderRadius: 18, backgroundColor: image.colour }),
    // The label sits on a white pill so it reads over any photograph.
    box([text(image.label, { size: 12, weight: 600, lines: 2 })], {
      position: "absolute", left: 8, bottom: 8, right: 40, paddingHorizontal: 9, paddingVertical: 5,
      borderRadius: 10, backgroundColor: C.paper,
    }),
    // A ring, so a chosen tile reads as chosen even to somebody who cannot see the badge's colour.
    when(chosen(image.id, of), box([], {
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 18,
      borderWidth: 2.5, borderColor: C.ink,
    })),
    ...badges(image.id, of),
  ];

  return box(inner, { height: TILE_H, borderRadius: 18, overflow: "hidden", minWidth: 0 }, toggle(image.id));
}

export function firstLookPage(ctx: BotsCtx, data: FirstLookView | undefined): ReturnType<typeof page> {
  const view = data ?? { version: "0", title: "Put these in order", sub: "", images: [] };
  const of = view.images.length;
  const columns = ctx.client === "desktop" ? 3 : 2;
  const width = ctx.client === "desktop" ? 220 : 160;

  const done = call("POST", FIRST_LOOK_PATH, { order: `$state.${ORDER}` }, {
    ok: seq(
      { kind: "toast", message: "That is a start. Your feed is yours now." },
      { kind: "navigate", screenId: SCREENS.travel, replace: true },
    ),
    fail: { kind: "toast", message: "Could not save that. Try again.", tone: "error" },
  });

  const skip: ActionRef = { kind: "navigate", screenId: SCREENS.travel, replace: true };

  const body: Node[] = [
    col([
      title(view.title),
      ...(view.sub ? [meta(view.sub, { size: 13.5 })] : []),
    ], { gap: 8 }),
    ...(of === 0
      ? [meta("These are on their way.", { size: 13.5 })]
      : [grid(view.images.map((image) => tile(image, of, width)), columns, 12)]),
  ];

  const footer: Node[] = of === 0 ? [] : [
    col([
      // Only a complete order means anything, so Done is not offered until the last tile has a number.
      when({ truthy: `${ORDER}.${of - 1}` }, primaryButton("Done", done, { wide: true })),
      when({ falsy: `${ORDER}.${of - 1}` }, box([
        meta("Tap all of them, most like you first", { size: 13, align: "center" }),
      ], { height: 54, alignItems: "center", justifyContent: "center" })),
      row([quietButton("Skip for now", skip)], { justifyContent: "center" }),
    ], { gap: 4 }),
  ];

  return page(ctx, {
    title: "Put these in order",
    nav: "travel",
    back: true,
    backTitle: "Travel bot",
    body,
    footer,
    state: { [ORDER]: [] },
  });
}

export const firstLookScreens: BotsScreen[] = [
  screen<FirstLookView>({
    id: SCREENS.travelFirstLook,
    load: (_ctx, deps) => deps.api<FirstLookView>("GET", FIRST_LOOK_PATH),
    build: firstLookPage,
  }),
];
