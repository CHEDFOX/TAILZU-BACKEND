/**
 * THE FEED, ON THE TRAVEL BOT'S OWN SCREEN (src/discover) — and one place, opened.
 *
 *   feedBlocks(ctx, feed, taste)   the blocks bots.travel leads with, before any trip
 *   bots.travel.place              one card in full (params: slug)
 *
 * THE BOT OPENS ON SOMETHING TO LOOK AT. An empty chat asks the person to do the hard part — think of a place. A
 * feed hands them one. So these blocks go ABOVE the trip on bots.travel, and they are there whether or not a trip
 * exists: a trip is what somebody does once a month, and this is what they do while waiting.
 *
 * ORDER OF THE BLOCKS, and why:
 *   1. a search field, because "I want to look up one place" is the other half of discovery
 *   2. today's one place, large, with its season window when it has one
 *   3. the rest as a grid, each with its "because you…" where the profile can say it
 *
 * EVERY TAP IS REPORTED. Opening a card sends `open` and then navigates, in that order, so the profile hears it
 * even if the person leaves at once. The viewport's own `shown` and `dwell` are the app's to send (the server
 * takes them in batches at POST /v1/discover/signals); nothing here fakes them.
 */
import type { ActionRef, Node } from "../../../../../shared/types/sdui.js";
import {
  box, C, call, col, grid, grow, icon, meta, page, picture, PALETTE_HEX, primaryButton, RADIUS, row,
  SCREENS, secondaryButton, seq, text, title, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import { clearState, field, ifFilled, inputBox, refresh, toast } from "./bots/parts.js";

export const FEED_PATH = "/v1/discover/feed";
/**
 * How many places the screen asks for. The whole catalogue, in effect: it is a feed to scroll, and a person who
 * reaches the end of it has seen everything we think is worth the journey — which is a better end than a wall.
 */
export const FEED_LIMIT = 80;
export const TASTE_PATH = "/v1/discover/taste";
export const BUILD_PATH = "/v1/discover/build";
export const SIGNALS_PATH = "/v1/discover/signals";
const PLACE_PATH = "/v1/discover/place";

const enc = encodeURIComponent;
const SEA = PALETTE_HEX.sea!;

export interface FeedPhoto { url: string; tile?: string; alt: string; credit: string | null }

export interface FeedCard {
  slug: string;
  title: string;
  where: string;
  hook: string;
  story?: string;
  moment?: string;
  dated?: string | null;
  tags: string[];
  budget: string;
  effort: number;
  photos: FeedPhoto[];
  origin: "ours" | "built";
  sources?: Array<{ host: string; url: string; readAt: string }>;
  /** How long it costs, how it is reached, and what can stop it (discover/catalog-detail.ts). */
  takes?: string | null;
  getting?: string | null;
  need?: string | null;
  /** Said in words by the server (taxonomy seasonWords). */
  season?: string | null;
  /** Honest urgency, when there is any. */
  daysLeft?: number | null;
  wildcard?: boolean;
  reason?: string | null;
}

export interface FeedView { total: number; cards: FeedCard[] }
export interface TasteView { known: number; signals: number; likes: Array<{ tag: string }>; dislikes: Array<{ tag: string }> }

/** Tell the profile, then go. In that order, so a person who leaves at once is still heard. */
const openCard = (slug: string): ActionRef =>
  seq(
    call("POST", SIGNALS_PATH, { signals: [{ kind: "open", slug }] }, { stay: true }),
    { kind: "navigate", screenId: SCREENS.travelPlace, params: { slug } },
  );

/**
 * The one picture a tile gets, or the bot's own colour where the catalogue has none yet.
 *
 * The TILE file, not the full one: the feed draws the whole catalogue now, and sixty 1280px files is a download
 * rather than a feed. Falls back to the full size for a built card, which has no tile of its own.
 */
function tileImage(card: FeedCard, w: number, h: number): Node {
  const photo = card.photos[0];
  return photo
    ? picture(photo.tile ?? photo.url, w, h, { radius: 18, background: C.surface, fit: "cover", label: photo.alt })
    : box([icon("pin", { size: 18, color: C.idle })], {
        width: "100%", height: h, borderRadius: 18, backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
      });
}

/** Today's place: the one card that gets room. */
function todayCard(ctx: BotsCtx, card: FeedCard): Node {
  const w = ctx.client === "desktop" ? 520 : 350;
  return col([
    box([
      tileImage(card, w, 196),
      row([
        box([text("TODAY", { size: 10.5, weight: 600, tracking: 0.3 })], {
          paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: C.paper,
        }),
      ], { position: "absolute", top: 9, left: 9, gap: 6 }),
      ...(card.daysLeft && card.daysLeft <= 30
        ? [box([text(`${card.daysLeft} days left in season`, { size: 10.5, weight: 500 })], {
            position: "absolute", bottom: 9, left: 9, paddingHorizontal: 9, paddingVertical: 5,
            borderRadius: 10, backgroundColor: C.paper,
          })]
        : []),
    ], { position: "relative", borderRadius: 18, overflow: "hidden" }),
    text(card.title, { size: 17, weight: 600, lineHeight: 22, tracking: -0.2 }),
    text(card.hook, { size: 13, lineHeight: 17, color: C.grey70, lines: 2 }),
    meta(card.season ? `${card.where} · best ${card.season}` : card.where, { size: 11.5, lines: 1 }),
  ], { gap: 6 }, openCard(card.slug));
}

/** One tile in the grid under it. */
function feedTile(ctx: BotsCtx, card: FeedCard): Node {
  const w = ctx.client === "desktop" ? 220 : 160;
  return col([
    tileImage(card, w, 118),
    row([
      text(card.title, { size: 13, weight: 600, lineHeight: 17, lines: 2, style: { flexShrink: 1, minWidth: 0 } }),
      ...(card.origin === "built" ? [] : []),
    ], { gap: 5, alignItems: "flex-start" }),
    meta(card.wildcard ? "Not your usual" : card.reason ?? card.where, { size: 11, lines: 2 }),
  ], { gap: 5, minWidth: 0 }, openCard(card.slug));
}

/** Look up one place by name: the other half of discovery, and the way into the build pipeline. */
function searchRow(): Node {
  const go = ifFilled(
    "dq",
    call("POST", BUILD_PATH, { place: "$state.dq" }, {
      ok: seq(toast("Read up on it — it is in your feed."), clearState("dq"), refresh),
      fail: toast("Could not read about that one. Try another spelling.", true),
    }),
    "Type a place first",
  );
  return inputBox([
    icon("search", { size: 17, color: C.meta }),
    field("dq", "dq", "Search any place on earth", { onSubmit: go }),
  ], { radius: 24 });
}

/**
 * The blocks bots.travel leads with. Returns nothing at all when the feed could not be read — the trip below is
 * what the screen is for, and a failed feed must never take it down with it.
 */
export function feedBlocks(ctx: BotsCtx, feed: FeedView | undefined, taste: TasteView | undefined): Node[] {
  if (!feed || feed.cards.length === 0) return [];
  const [first, ...rest] = feed.cards;
  const fresh = !taste || taste.signals === 0;
  const columns = ctx.client === "desktop" ? 3 : 2;

  // No invitation to the six here: a person with no profile never reaches this screen, because bots.travel
  // has no onboarding at all: the feed is the first screen. Nothing invites anybody to fill anything in
  // failed to load — and then the invitation would open the screen that fetches the same six.
  return [
    searchRow(),
    ...(first ? [todayCard(ctx, first)] : []),
    ...(rest.length
      ? [col([
          row([
            text(fresh ? "Worth a look" : "More for you", { size: 13.5, weight: 600 }),
            grow(),
            ...(fresh ? [] : [meta(`${feed.total} places`, { size: 11.5 })]),
          ], { gap: 8 }),
          // EVERY CARD WE WERE GIVEN, not a sample of them. This used to draw columns * 3 — six tiles on a
          // phone — so the feed showed seven places out of sixty whatever the server sent. Scrolling is the
          // whole point of the screen; the server decides how many there are (query.ts), not the grid.
          grid(rest.map((card) => feedTile(ctx, card)), columns, 12),
        ], { gap: 10 })]
      : []),
  ];
}

// ===================================================================== one place, opened

export interface PlaceView { card: FeedCard }

export function placePage(ctx: BotsCtx, data: PlaceView | undefined): ReturnType<typeof page> {
  const card = data?.card;
  if (!card) {
    return page(ctx, {
      title: "Place", nav: "travel", back: true, backTitle: "Travel bot",
      body: [meta("That one has gone. Search for it again.", { size: 13.5 })],
    });
  }

  const w = ctx.client === "desktop" ? 560 : 390;
  const photo = card.photos[0];

  // Everything a person needs to decide, in the order they need it: when, how long, how they get there, what
  // could stop them, how hard it is, what it costs. The season carries its own countdown when the window is
  // closing, because that is the one fact that makes this week different from next.
  const season = card.season
    ? card.daysLeft && card.daysLeft <= 60 ? `${card.season} · ${card.daysLeft} days left` : card.season
    : null;
  const facts: Node[] = [
    ...(season ? [factRow("Best season", season)] : []),
    ...(card.takes ? [factRow("How long", card.takes)] : []),
    ...(card.getting ? [factRow("Getting there", card.getting)] : []),
    ...(card.need ? [factRow("What you need", card.need)] : []),
    factRow("Effort", `${card.effort} of 5`),
    factRow("Budget", card.budget),
  ];

  const keep = call("POST", SIGNALS_PATH, { signals: [{ kind: "keep", slug: card.slug }] }, {
    ok: toast("Kept."),
    fail: toast("Couldn't keep that. Try again.", true),
    stay: true,
  });
  const notForMe = call("POST", SIGNALS_PATH, { signals: [{ kind: "not_for_me", slug: card.slug }] }, {
    ok: seq(toast("Noted — fewer like that."), { kind: "navigateBack" }),
    stay: true,
  });

  return page(ctx, {
    title: card.title,
    nav: "travel",
    back: true,
    backTitle: "Travel bot",
    body: [
      photo
        ? picture(photo.url, w, 240, { radius: 0, background: C.surface, fit: "cover", label: photo.alt })
        : box([icon("pin", { size: 22, color: C.idle })], { width: "100%", height: 200, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      // THE CREDIT IS SHOWN, NOT JUST STORED. Half these pictures are graded photographs somebody else took and
      // half are illustrations made for this catalogue, and a card that says "this is Deadvlei" has to say which
      // of the two the reader is looking at. A credit nobody ever sees is not a credit.
      ...(photo?.credit ? [meta(photo.credit, { size: 11 })] : []),
      col([
        meta(card.where.toUpperCase(), { size: 11, tracking: 0.9 }),
        title(card.title),
        text(card.hook, { size: 15, lineHeight: 21, color: C.grey70 }),
      ], { gap: 7 }),
      // THE MOMENT, which was stored on every card from the beginning and shown on none of them. It is the one
      // line that says why this is a thing to do rather than a place to be near, so it leads the body.
      ...(card.moment
        ? [row([
            box([], { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: SEA }),
            text(`Go ${card.moment}.`, { size: 15, lineHeight: 21, weight: 500 }),
          ], { gap: 11, alignItems: "flex-start" })]
        : []),
      ...(card.story ? [text(card.story, { size: 14, lineHeight: 21, color: C.grey70 })] : []),
      col(facts, { gap: 0, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.list, overflow: "hidden" }),
      // Its past, where the pull of the place IS the past. Null on somewhere whose pull is the weather.
      ...(card.dated
        ? [col([
            meta("ITS PAST", { size: 11, tracking: 0.8 }),
            text(card.dated.charAt(0).toUpperCase() + card.dated.slice(1) + ".", { size: 14, lineHeight: 20, color: C.grey70 }),
          ], { gap: 5 })]
        : []),
      ...(card.tags.length
        ? [row(card.tags.map((t) => box([text(t.replace(/_/g, " "), { size: 12, color: C.meta })], {
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.chip, backgroundColor: C.surface,
          })), { gap: 6, flexWrap: "wrap" })]
        : []),
      ...(card.origin === "built" && card.sources?.length
        ? [col([
            meta("WHERE THIS CAME FROM", { size: 11, tracking: 0.8 }),
            ...card.sources.map((s) => meta(`${s.host} · read ${s.readAt}`, { size: 11.5 })),
            meta("Written by the bot from those, not by us.", { size: 11 }),
          ], { gap: 5 })]
        : [row([icon("pin", { size: 13, color: SEA }), meta("Ours: our own words. Flights and stays are searched live, never quoted here.", { size: 11.5 })], { gap: 6 })]),
    ],
    footer: [
      row([
        primaryButton("Keep it", keep, { size: "md" }),
        secondaryButton("Not for me", notForMe, { size: "md" }),
      ], { gap: 8 }),
    ],
  });
}

function factRow(label: string, value: string): Node {
  return row([
    meta(label, { size: 13 }),
    grow(),
    text(value, { size: 13, weight: 500 }),
  ], { gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.divider });
}

export const discoverScreens: BotsScreen[] = [
  screen<PlaceView>({
    id: SCREENS.travelPlace,
    load: (ctx, deps) => deps.api<PlaceView>("GET", `${PLACE_PATH}/${enc(String(ctx.params.slug ?? ""))}`),
    build: placePage,
  }),
];
