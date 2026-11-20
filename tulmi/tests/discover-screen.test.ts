/**
 * The Travel bot's onboarding screen (experience/bots/screens/firstLook.ts), built pure from a ctx and data.
 *
 *   - six tiles, each tappable, each able to show any of the six places in the order
 *   - a tile's number is drawn by the app from its own state: no round trip per tap
 *   - Done is offered only when the LAST place is filled, because a half-order must never be sent
 *   - Skip is there throughout
 *   - a photograph is used where the catalogue has one; a colour where it does not
 *   - no data at all still builds a screen, never an error
 */
import { describe, expect, it } from "vitest";

const { firstLookPage, FIRST_LOOK_PATH } = await import("../src/experience/bots/screens/firstLook.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { feedBlocks, placePage } = await import("../src/experience/bots/screens/discoverFeed.js");

type FeedView = import("../src/experience/bots/screens/discoverFeed.js").FeedView;
type TasteView = import("../src/experience/bots/screens/discoverFeed.js").TasteView;

type View = import("../src/experience/bots/screens/firstLook.js").FirstLookView;

const VIEW: View = {
  version: "1",
  title: "Put these in order",
  sub: "Most like you first.",
  images: [
    { id: "fjord", label: "Grey water, one red hut", sub: "Cold", colour: "#5F6B6E", photo: { url: "https://u/1.jpg", alt: "a fjord" } },
    { id: "lagoon", label: "Warm shallows", sub: "Bright", colour: "#3E6E8E", photo: null },
    { id: "carved", label: "Carved stone", sub: "Old", colour: "#7A6440", photo: null },
    { id: "night", label: "A street at midnight", sub: "Loud", colour: "#6E4A6B", photo: null },
    { id: "ridge", label: "A ridge above cloud", sub: "Steep", colour: "#2F5D50", photo: null },
    { id: "dunes", label: "A track over the dunes", sub: "Empty", colour: "#A9573A", photo: null },
  ],
};

/** Everything in the tree, flattened, so a test can look for a node anywhere in it. */
const nodes = (n: unknown): unknown[] => {
  if (!n || typeof n !== "object") return [];
  const self = n as { children?: unknown[] };
  const kids = Array.isArray(self.children) ? self.children.flatMap(nodes) : [];
  return [n, ...kids];
};

const treeOf = (screen: unknown): unknown[] => {
  const s = screen as { screen?: { root?: unknown }; root?: unknown };
  return nodes(s.screen?.root ?? s.root ?? s);
};

const json = (screen: unknown): string => JSON.stringify(screen);

describe("the six images, put in order", () => {
  const built = firstLookPage(ctxFor(SCREENS.travelFirstLook, "phone"), VIEW);

  it("starts with an empty order, so nothing is chosen for them", () => {
    const s = built as unknown as { screen?: { state?: Record<string, unknown> }; state?: Record<string, unknown> };
    const state = s.screen?.state ?? s.state ?? {};
    expect(state.order).toEqual([]);
  });

  it("makes every tile tappable, adding and removing it from the order", () => {
    const presses = treeOf(built)
      .map((n) => (n as { on?: { onPress?: unknown } }).on?.onPress)
      .filter(Boolean);
    expect(presses).toHaveLength(6);
    const all = JSON.stringify(presses);
    for (const id of ["fjord", "lagoon", "carved", "night", "ridge", "dunes"]) expect(all).toContain(id);
  });

  it("draws the number from its own state, so a tap needs no round trip", () => {
    const text = json(built);
    // one badge per place in the order, per tile: the app decides which is visible
    for (let i = 0; i < 6; i += 1) expect(text).toContain(`"order.${i}"`);
    const badged = treeOf(built).filter((n) => {
      const cond = (n as { visibleIf?: { eq?: [string, unknown] } }).visibleIf;
      return Array.isArray(cond?.eq) && cond.eq[0] === "order.0";
    });
    // the first place: a badge on each tile, plus each tile's ring condition mentions it
    expect(badged.length).toBeGreaterThanOrEqual(6);
  });

  it("has no Done at all: the tap that fills the last place is the end of it", () => {
    const text = json(built);
    expect(text).not.toContain('"Done"');
    // every tile checks, after its own toggle, whether that was the sixth
    expect(text).toContain('"truthy":"order.5"');
  });

  it("sends the whole order to the one endpoint that takes it", () => {
    const text = json(built);
    expect(text).toContain(FIRST_LOOK_PATH);
    expect(text).toContain('"$state.order"');
    expect(text).toContain('"method":"POST"');
  });

  it("offers no way out, because the six are the price of entry", () => {
    expect(json(built)).not.toContain("Skip for now");
  });

  it("uses a photograph where the catalogue has one, and a colour where it does not", () => {
    const text = json(built);
    expect(text).toContain("https://u/1.jpg");
    expect(text).toContain("#A9573A");
  });

  it("builds a screen even with nothing to show, rather than an error", () => {
    const empty = firstLookPage(ctxFor(SCREENS.travelFirstLook, "phone"), undefined);
    expect(json(empty)).toContain("on their way");
  });

  it("builds for the window too", () => {
    const desk = firstLookPage(ctxFor(SCREENS.travelFirstLook, "desktop"), VIEW);
    expect(json(desk)).toContain("$state.order");
  });
});

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

describe("the six as the first screen, with no way past", () => {
  const required = () => firstLookPage(ctxFor(SCREENS.travel, "phone"), VIEW);
  const asText = (s: unknown) => JSON.stringify(s);

  it("asks one short question and says nothing else", () => {
    const out = asText(required());
    expect(out).toContain("What looks most exciting?");
    expect(out).not.toContain("Most like you first");
    expect(out).not.toContain("Skip for now");
    expect(out).not.toContain("Tap all of them");
  });

  it("leaves the pictures unlabelled, so a reaction is what gets measured", () => {
    const out = asText(required());
    // A label would say what a picture is FOR, and then somebody ranks a phrase about themselves instead.
    expect(out).not.toContain("Grey water, one red hut");
    expect(out).not.toContain("A street at midnight");
    expect(out).not.toContain("Cold, and nobody about");
  });

  it("draws them as blocks with corners, not a full-bleed wall", () => {
    const out = asText(required());
    expect(out).toContain('"borderRadius":18');
  });

  it("still numbers them from its own state, one badge per place", () => {
    const out = asText(required());
    for (let i = 0; i < 6; i += 1) expect(out).toContain(`"order.${i}"`);
  });

  it("sends the order and goes, on the tap that fills the last place", () => {
    const presses = treeOf(required())
      .map((n) => (n as { on?: { onPress?: unknown } }).on?.onPress)
      .filter(Boolean);
    expect(presses).toHaveLength(6);

    const first = asText(presses[0]);
    expect(first).toContain("toggleInArray");
    // the condition is checked after the toggle: a sixth tap means they have just finished
    expect(first).toContain('"truthy":"order.5"');
    expect(first).toContain(FIRST_LOOK_PATH);
    expect(first).toContain("bots.travel");
  });

  it("is the same screen however it is reached: one layout, not two", () => {
    const direct = asText(firstLookPage(ctxFor(SCREENS.travelFirstLook, "phone"), VIEW));
    expect(direct).toContain("What looks most exciting?");
    expect(direct).not.toContain("Skip for now");
    expect(direct).not.toContain("Most like you first");
  });

  it("draws whatever it was given rather than a half-built screen", () => {
    const five = { ...VIEW, images: VIEW.images.slice(0, 5) };
    const out = asText(firstLookPage(ctxFor(SCREENS.travel, "phone"), five));
    expect(out).toContain("What looks most exciting?");
    // bots.travel only stands this in when all six are there (screens/bots.ts), so a short set is a direct visit
    expect(out).not.toContain("Skip for now");
  });
});
