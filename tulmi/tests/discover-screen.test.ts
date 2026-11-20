/**
 * The Travel bot's feed screen (experience/bots/screens/discoverFeed.ts), built pure from a ctx and data.
 *
 * THERE IS NO ONBOARDING. The feed is the first thing a new person sees, ordered by wow and rarity until they have
 * done anything (query.ts) — which in a catalogue where every card had to clear the bar is a strong feed for
 * anybody. Nothing asks them to fill anything in first.
 */
import { describe, expect, it } from "vitest";

const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { feedBlocks, placePage } = await import("../src/experience/bots/screens/discoverFeed.js");

type FeedView = import("../src/experience/bots/screens/discoverFeed.js").FeedView;
type TasteView = import("../src/experience/bots/screens/discoverFeed.js").TasteView;

describe("the feed on the Travel bot's own screen", () => {
  const card = (over: Partial<FeedView["cards"][number]> = {}): FeedView["cards"][number] => ({
    slug: "erg-chebbi-silence",
    title: "The silence of Erg Chebbi",
    where: "Sahara, Morocco",
    hook: "Dunes the height of buildings, and a quiet so complete it feels physical.",
    tags: ["desert", "solitude"],
    budget: "budget",
    effort: 3,
    photos: [],
    origin: "ours",
    season: "December to March",
    ...over,
  });

  const feed: FeedView = {
    total: 14,
    cards: [card(), card({ slug: "hampi", title: "Boulders at dawn", reason: "because you keep places with a past" }), card({ slug: "petra", title: "Through the Siq", wildcard: true })],
  };

  const blank: TasteView = { known: 0, signals: 0, likes: [], dislikes: [] };
  const taught: TasteView = { known: 0.4, signals: 12, likes: [{ tag: "desert" }], dislikes: [] };
  const ctx = () => ctxFor(SCREENS.travel, "phone");
  const text = (nodes: unknown) => JSON.stringify(nodes);

  it("never invites anybody to the six, because they cannot get here without doing them", () => {
    // bots.travel shows the six INSTEAD of this screen while a profile is empty (screens/bots.ts), so an
    // invitation here could only ever appear when the six failed to load — and it would open the screen that
    // fetches the same six.
    expect(text(feedBlocks(ctx(), feed, blank))).not.toContain("Six pictures");
    expect(text(feedBlocks(ctx(), feed, taught))).not.toContain("Six pictures");
  });

  it("gives them a way to look up any place, which is the way into the build", () => {
    const out = text(feedBlocks(ctx(), feed, taught));
    expect(out).toContain("Search any place on earth");
    expect(out).toContain("/v1/discover/build");
    expect(out).toContain('"$state.dq"');
  });

  it("leads with one place, and says the season rather than a month number", () => {
    const out = text(feedBlocks(ctx(), feed, taught));
    expect(out).toContain("TODAY");
    expect(out).toContain("best December to March");
  });

  it("shows the honest season countdown only when the window is closing", () => {
    const soon = { ...feed, cards: [card({ daysLeft: 11 }), ...feed.cards.slice(1)] };
    const far = { ...feed, cards: [card({ daysLeft: 200 }), ...feed.cards.slice(1)] };
    expect(text(feedBlocks(ctx(), soon, taught))).toContain("11 days left in season");
    expect(text(feedBlocks(ctx(), far, taught))).not.toContain("days left in season");
  });

  it("carries the reason on a tile, and marks the wildcard as one", () => {
    const out = text(feedBlocks(ctx(), feed, taught));
    expect(out).toContain("because you keep places with a past");
    expect(out).toContain("Not your usual");
  });

  it("tells the profile before it navigates, so a person who leaves at once is still heard", () => {
    const out = text(feedBlocks(ctx(), feed, taught));
    expect(out).toContain("/v1/discover/signals");
    expect(out).toContain('"kind":"open"');
    expect(out).toContain("bots.travel.place");
  });

  it("draws the tile file in the grid and the full one on the page, because the feed is now the whole catalogue", () => {
    // Sixty-odd tiles at 160pt each, served the 1280px file, is a download rather than a feed.
    const withPics = { total: 1, cards: [card({ photos: [{ url: "/photos/x.jpg", tile: "/photos/tile/x.jpg", alt: "a dune", credit: "Illustration · x" }] })] };
    expect(text(feedBlocks(ctx(), withPics, taught))).toContain("/photos/tile/x.jpg");

    const opened = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), { card: withPics.cards[0]! }));
    expect(opened).toContain("/photos/x.jpg");
    expect(opened).not.toContain("/photos/tile/x.jpg");
  });

  it("falls back to the full picture when there is no tile, as on a card the bot built", () => {
    const built = { total: 1, cards: [card({ photos: [{ url: "/photos/y.jpg", alt: "a cave", credit: null }] })] };
    expect(text(feedBlocks(ctx(), built, taught))).toContain("/photos/y.jpg");
  });

  it("draws every card it was given, rather than a sample of them", () => {
    // This drew `columns * 3` tiles — six on a phone — so the feed showed seven places however many the server
    // sent. How many there are is the server's decision (query.ts); the grid's job is to draw them.
    const many = { total: 40, cards: Array.from({ length: 40 }, (_, i) => card({ slug: `place-${i}`, title: `Place ${i}` })) };
    const out = text(feedBlocks(ctx(), many, taught));
    // one leads as today's card, the other thirty-nine are tiles — all of them present
    for (let i = 0; i < 40; i += 1) expect(out).toContain(`place-${i}`);
  });

  it("draws nothing at all when the feed could not be read, so the trip below survives", () => {
    expect(feedBlocks(ctx(), undefined, taught)).toEqual([]);
    expect(feedBlocks(ctx(), { total: 0, cards: [] }, taught)).toEqual([]);
  });

  it("opens one place with its facts, and a way to say yes or no", () => {
    const out = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), { card: card() }));
    expect(out).toContain("The silence of Erg Chebbi");
    expect(out).toContain("Best season");
    expect(out).toContain("Keep it");
    expect(out).toContain('"kind":"not_for_me"');
  });

  it("tells somebody what it actually costs them: how long, how they get there, what can stop them", () => {
    const out = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), {
      card: card({
        takes: "Four days underground, six on the trip",
        getting: "Fly to Dong Hoi, then an hour to Phong Nha",
        need: "One of roughly a thousand permits a year, with a waiting list over a year",
      }),
    }));
    expect(out).toContain("How long");
    expect(out).toContain("Four days underground");
    expect(out).toContain("What you need");
    expect(out).toContain("thousand permits a year");
    expect(out).toContain("Fly to Dong Hoi");
  });

  it("leaves a fact out rather than showing an empty row for it", () => {
    // A built card has none of these: the bot read pages about a place, and a half-remembered quota is worse
    // than nothing. The table must simply be shorter, not have blanks in it.
    const out = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), { card: card() }));
    expect(out).not.toContain("How long");
    expect(out).not.toContain("What you need");
    expect(out).toContain("Effort");
  });

  it("shows the moment, which every card has carried from the start and no screen ever showed", () => {
    const out = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), {
      card: card({ moment: "six in the evening, when the wind drops" }),
    }));
    expect(out).toContain("six in the evening, when the wind drops");
  });

  it("counts the season down on the page too, not only on the tile", () => {
    const closing = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), { card: card({ daysLeft: 11 }) }));
    expect(closing).toContain("11 days left");
    const far = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), { card: card({ daysLeft: 200 }) }));
    expect(far).not.toContain("days left");
  });

  it("gives the place its past, and its tags, where it has them", () => {
    const out = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), {
      card: card({ dated: "a capital of half a million until 1565", tags: ["desert", "road_trip"] }),
    }));
    expect(out).toContain("ITS PAST");
    expect(out).toContain("half a million until 1565");
    expect(out).toContain("road trip");
  });

  it("shows the picture's credit on the page, so an illustration is never passed off as a photograph", () => {
    const shot = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), {
      card: card({ photos: [{ url: "/photos/x.jpg", alt: "a dune", credit: "Wikimedia Commons · CC BY-SA 4.0 · Someone · altered" }] }),
    }));
    expect(shot).toContain("Wikimedia Commons");
    expect(shot).toContain("altered");

    const drawn = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), {
      card: card({ photos: [{ url: "/photos/y.jpg", alt: "a cave", credit: "Illustration · made for this catalogue, not a photograph of the place" }] }),
    }));
    expect(drawn).toContain("not a photograph of the place");
  });

  it("says whose words a card is: ours, or the web's with its sources", () => {
    const ours = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), { card: card() }));
    expect(ours).toContain("our own words");

    const built = text(placePage(ctxFor(SCREENS.travelPlace, "phone"), {
      card: card({ origin: "built", sources: [{ host: "whc.unesco.org", url: "https://whc.unesco.org/x", readAt: "2026-11-20" }] }),
    }));
    expect(built).toContain("whc.unesco.org");
    expect(built).toContain("not by us");
  });

  it("says so plainly when the place has gone, rather than erroring", () => {
    expect(text(placePage(ctxFor(SCREENS.travelPlace, "phone"), undefined))).toContain("has gone");
  });
});

