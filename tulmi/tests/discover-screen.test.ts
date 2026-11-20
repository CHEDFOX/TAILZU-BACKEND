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
    const toggles = treeOf(built).filter((n) => {
      const press = (n as { on?: { onPress?: { kind?: string; path?: string } } }).on?.onPress;
      return press?.kind === "toggleInArray" && press.path === "order";
    });
    expect(toggles).toHaveLength(6);
    const values = toggles.map((n) => (n as { on: { onPress: { value: string } } }).on.onPress.value);
    expect(new Set(values)).toEqual(new Set(["fjord", "lagoon", "carved", "night", "ridge", "dunes"]));
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

  it("offers Done only once the last place is filled", () => {
    const shown = treeOf(built).filter((n) => {
      const cond = (n as { visibleIf?: { truthy?: string } }).visibleIf;
      return cond?.truthy === "order.5";
    });
    expect(shown.length).toBeGreaterThan(0);

    const hidden = treeOf(built).filter((n) => {
      const cond = (n as { visibleIf?: { falsy?: string } }).visibleIf;
      return cond?.falsy === "order.5";
    });
    expect(hidden.length).toBeGreaterThan(0);
  });

  it("sends the whole order to the one endpoint that takes it", () => {
    const text = json(built);
    expect(text).toContain(FIRST_LOOK_PATH);
    expect(text).toContain('"$state.order"');
    expect(text).toContain('"method":"POST"');
  });

  it("lets them out of it at any point", () => {
    expect(json(built)).toContain("Skip for now");
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
