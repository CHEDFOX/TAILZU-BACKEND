/**
 * src/discover: the catalogue behind the Travel bot — the vocabulary, the months, the bar a place has to clear, the
 * order a feed comes out in, and what the model is allowed to hand back. No network, no model, no clock of its own.
 *
 *   - the tag list is closed: an invented tag is dropped, never kept
 *   - months: a season that wraps the new year is said as one run, and days left is counted to the end of it
 *   - the bar: an act at an hour or a dated history passes; a suburb with neither fails, and says why
 *   - the feed: out of season is never shown, the ask is honoured, one country does not fill it, the wildcard is
 *     marked and is NOT one of the tags asked for
 *   - a built card: fewer than two sources, an invented tag or a missing day is refused rather than shown
 *   - a person's built card is in their feed and in nobody else's
 */
import { describe, expect, it } from "vitest";

const { Discover } = await import("../src/discover/index.js");
const { store } = await import("../src/discover/store.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");

/** Rows in memory, so the catalogue tests read no config and reach no Supabase. */
const memory = () => store({ cards: new MemoryTable(), asks: new MemoryTable(), taste: new MemoryTable(), signals: new MemoryTable() });
const { CURATED, curatedBySlug } = await import("../src/discover/catalog.js");
const { judge, failures } = await import("../src/discover/bar.js");
const { parseBuilt } = await import("../src/discover/build.js");
const { pick } = await import("../src/discover/query.js");
const { DISCOVER_TOOLS, discoverFor, runDiscover, placesCardOf, askWords } = await import("../src/discover/tools.js");
const { daysLeftInSeason, seasonFrom, seasonWords, tagsOf } = await import("../src/discover/taxonomy.js");

type Card = import("../src/discover/types.js").Card;

const card = (over: Partial<Card> = {}): Card => ({
  id: "crd_test",
  slug: "test-place",
  title: "A walk at first light",
  where: "Somewhere, Nowhere",
  country: "zz",
  at: { lat: 0, lon: 0 },
  hook: "You walk up in the dark and the valley arrives all at once at dawn.",
  moment: "the climb in the dark, to be up for dawn",
  dated: null,
  story: "",
  tags: ["hiking", "mountains"],
  season: seasonFrom([6, 7, 8]),
  budget: "moderate",
  effort: 2,
  // Exceptional by default, so a test about the act/history/singular checks is not quietly also a test of the
  // exceptional one. The gate gets its own tests below.
  rarity: 0.5,
  wow: 0.92,
  photos: [],
  origin: "ours",
  sources: [],
  forUserId: null,
  advisory: null,
  ...over,
});

describe("the vocabulary", () => {
  it("drops a word that is not one of ours instead of inventing a tag", () => {
    expect(tagsOf(["warm", "spiritual", "beach"])).toEqual(["warm", "beach"]);
  });

  it("does not repeat a tag", () => {
    expect(tagsOf(["warm", "warm"])).toEqual(["warm"]);
  });
});

describe("months", () => {
  it("says a winter that wraps the new year as one run", () => {
    expect(seasonWords(seasonFrom([12, 1, 2]))).toBe("December to February");
  });

  it("says two runs with an and", () => {
    expect(seasonWords(seasonFrom([4, 5, 9, 10]))).toBe("April to May, and September to October");
  });

  it("says a single month, and a full year", () => {
    expect(seasonWords(seasonFrom([6]))).toBe("June");
    expect(seasonWords(seasonFrom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe("All year");
  });

  it("counts the days left to the end of the season, not of the month", () => {
    // In season December-February, standing on 20 February: 9 days to 1 March.
    const left = daysLeftInSeason(seasonFrom([12, 1, 2]), new Date(Date.UTC(2027, 1, 20)));
    expect(left).toBe(9);
  });

  it("gives no number when the place is out of season, or is good all year", () => {
    expect(daysLeftInSeason(seasonFrom([12, 1, 2]), new Date(Date.UTC(2027, 5, 1)))).toBeNull();
    expect(daysLeftInSeason(seasonFrom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), new Date(Date.UTC(2027, 5, 1)))).toBeNull();
  });
});

describe("the bar", () => {
  it("passes a place with something to do at an hour that matters", () => {
    expect(judge(card()).ok).toBe(true);
  });

  it("passes a place with a dated history and no act", () => {
    const v = judge(card({ moment: "", dated: "a capital of half a million people, emptied in 1565", title: "The ruins of Vijayanagara" }));
    expect(v.ok).toBe(true);
    expect(v.checks.find((c) => c.name === "history")?.pass).toBe(true);
  });

  it("fails a suburb with neither, and says which two failed", () => {
    const v = judge(card({ title: "Whitefield", moment: "", dated: null, hook: "A large neighbourhood on the east side of the city, with malls and offices." }));
    expect(v.ok).toBe(false);
    expect(failures(v).map((c) => c.name).sort()).toEqual(["act", "history"]);
  });

  it("fails a place with no months", () => {
    expect(judge(card({ season: 0 })).ok).toBe(false);
  });

  it("fails a ninth fort of the same kind in the same country", () => {
    const first = card({ slug: "fort-one", country: "in", tags: ["history", "architecture"] });
    const second = card({ slug: "fort-two", country: "in", tags: ["architecture", "history"] });
    const v = judge(second, [first]);
    expect(v.ok).toBe(false);
    expect(failures(v).map((c) => c.name)).toContain("singular");
  });

  it("fails a place that is beautiful and on every list", () => {
    const pretty = card({ wow: 0.82, rarity: 0.2 });
    const v = judge(pretty);
    expect(v.ok).toBe(false);
    expect(failures(v).map((c) => c.name)).toContain("exceptional");
  });

  it("passes on rarity alone, so somewhere obscure does not need to be a spectacle", () => {
    expect(judge(card({ wow: 0.4, rarity: 0.8 })).ok).toBe(true);
  });

  it("fails a place under a travel warning, however good it is", () => {
    const warned = card({ wow: 0.99, rarity: 0.99, advisory: "do_not_travel" });
    expect(judge(warned).ok).toBe(false);
    expect(failures(warned && judge(warned)).map((c) => c.name)).toContain("safe");
  });

  it("fails a place in a do-not-travel country nobody marked by hand, which is what protects a built card", () => {
    // The builder reads pages about a place and has no way to know what advisory stands over it, so the country
    // list in bar.ts is the only thing between a Level 4 zone and somebody's feed.
    const v = judge(card({ country: "ye", advisory: null }));
    expect(v.ok).toBe(false);
    expect(failures(v).map((c) => c.name)).toContain("safe");
  });

  it("holds the written catalogue to its own editorial bar, every card", () => {
    // Safety is the world's to change, not ours, so a card may sit written and held back on it (bar.ts). Every
    // other check is editorial, and failing one of those means we wrote a card we should not have.
    for (const written of CURATED) {
      const editorial = judge(written, CURATED).checks.filter((c) => c.name !== "safe");
      const bad = editorial.filter((c) => !c.pass).map((c) => c.name);
      const fatal = bad.filter((n) => n === "singular" || n === "season" || n === "exceptional");
      expect({ slug: written.slug, fatal }).toEqual({ slug: written.slug, fatal: [] });
      expect({ slug: written.slug, told: bad.includes("act") && bad.includes("history") }).toEqual({ slug: written.slug, told: false });
    }
  });

  it("has no two cards under one slug, which the singular check cannot catch", () => {
    // judge() compares a card against OTHERS (other.slug !== card.slug), so two rows sharing a slug are invisible
    // to it — and one would silently shadow the other everywhere, since curatedBySlug returns the first.
    const slugs = CURATED.map((c) => c.slug);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("keeps the held-back ones written rather than deleting them, so they come back when the warning lifts", () => {
    const held = CURATED.filter((c) => !judge(c, CURATED).ok);
    expect(held.length).toBeGreaterThan(0);
    for (const c of held) expect(failures(judge(c, CURATED)).map((f) => f.name)).toContain("safe");
  });
});

describe("the feed", () => {
  it("never shows a place that is out of season", () => {
    const out = pick(CURATED, { month: 7 });
    expect(out.length).toBeGreaterThan(0);
    for (const { card: c } of out) expect(seasonWords(c.season)).toBeTruthy();
    expect(out.some(({ card: c }) => c.slug === "erg-chebbi-silence")).toBe(false); // Erg Chebbi is Oct-Mar
  });

  it("puts what was asked for above what was not", () => {
    const out = pick(CURATED, { tags: ["desert"], month: 1 });
    expect(out[0]?.card.tags).toContain("desert");
  });

  it("marks the wildcard, and the wildcard is not one of the tags asked for", () => {
    const out = pick(CURATED, { tags: ["cold"], month: 1, limit: 8 });
    const odd = out.find((c) => c.wildcard);
    expect(odd).toBeTruthy();
    expect(odd?.card.tags).not.toContain("cold");
    expect(odd?.matched).toEqual([]);
  });

  it("does not let one country fill the feed", () => {
    const out = pick(CURATED, { tags: ["cold", "photography"], month: 1, limit: 8 });
    const first = out.slice(0, 3).map((c) => c.card.country);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it("gives the same feed twice for the same ask", () => {
    const a = pick(CURATED, { tags: ["mountains"], month: 7 }).map((c) => c.card.slug);
    const b = pick(CURATED, { tags: ["mountains"], month: 7 }).map((c) => c.card.slug);
    expect(a).toEqual(b);
  });

  it("honours the limit", () => {
    expect(pick(CURATED, { limit: 3 })).toHaveLength(3);
  });
});

describe("a card built for somebody", () => {
  const at = { slug: "hampi", where: "Hampi, Karnataka", country: "in", at: { lat: 15.335, lon: 76.46 } };
  const good = {
    title: "Boulders at dawn, over the Tungabhadra",
    hook: "Granite the size of houses, and a river that moated a capital, best walked at first light.",
    moment: "first light, before the coaches from Hospet",
    dated: "a capital of perhaps half a million people until 1565",
    story: "Until 1565 this was Vijayanagara, a capital of perhaps half a million people. The ruins run for miles, and at six in the morning you will share them with langurs and nobody else.",
    tags: ["history", "architecture", "solitude"],
    months: [11, 12, 1, 2],
    budget: "budget",
    effort: 2,
    rarity: 0.4,
    // Over the exceptional line (bar.ts): a built card has to clear the same bar as one we wrote, and a place
    // that is merely pleasant is answered in words rather than turned into a card.
    wow: 0.92,
    sources: [
      { url: "https://whc.unesco.org/en/list/241/", readAt: "2026-11-16" },
      { url: "https://en.wikipedia.org/wiki/Hampi", readAt: "2026-11-16" },
    ],
  };

  it("makes a card, filed under the place the geocoder settled", () => {
    const built = parseBuilt(good, at, "user_1");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.card.slug).toBe("hampi");
    expect(built.card.origin).toBe("built");
    expect(built.card.forUserId).toBe("user_1");
    expect(built.card.sources.map((s) => s.host)).toEqual(["whc.unesco.org", "en.wikipedia.org"]);
  });

  it("refuses one page agreeing with itself", () => {
    const built = parseBuilt({ ...good, sources: [good.sources[0]] }, at, "user_1");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.why).toMatch(/two sources/);
  });

  it("refuses a source with no day it was read", () => {
    const built = parseBuilt({ ...good, sources: [{ url: "https://a.example/x" }, good.sources[1]] }, at, "user_1");
    expect(built.ok).toBe(false);
  });

  it("drops an invented tag, and refuses the card when too few are left", () => {
    const built = parseBuilt({ ...good, tags: ["history", "spiritual", "vibes"] }, at, "user_1");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.why).toMatch(/three tags/);
  });

  it("refuses a place that does not clear the bar, and says which checks failed", () => {
    const dull = { ...good, title: "Whitefield", moment: "", dated: null, hook: "A large neighbourhood on the east side, with malls and offices nearby.", story: "A business district built out over the last few decades, with housing, offices and shopping centres. It is where many people in the city work." };
    const built = parseBuilt(dull, at, "user_1");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.why).toMatch(/neither a moment nor a date/);
  });
});

describe("two tiers, one bar", () => {
  it("keeps a built card in its own person's feed and out of everyone else's", async () => {
    const d = new Discover({ store: memory() });
    const built = parseBuilt(
      {
        title: "Boulders at dawn, over the Tungabhadra",
        hook: "Granite the size of houses, and a river that moated a capital, best walked at first light.",
        moment: "first light, before the coaches from Hospet",
        dated: "a capital of perhaps half a million people until 1565",
        story: "Until 1565 this was Vijayanagara, a capital of perhaps half a million people, and at six you have it to yourself.",
        tags: ["history", "architecture", "solitude"],
        months: [11, 12, 1, 2],
        budget: "budget",
        effort: 2,
        rarity: 0.4,
        wow: 0.92,
        sources: [
          { url: "https://whc.unesco.org/en/list/241/", readAt: "2026-11-16" },
          { url: "https://en.wikipedia.org/wiki/Hampi", readAt: "2026-11-16" },
        ],
      },
      { slug: "hampi", where: "Hampi, Karnataka", country: "in", at: { lat: 15.335, lon: 76.46 } },
      "user_1",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    await d.keep(built.card);

    expect((await d.open("hampi", "user_1"))?.title).toContain("Tungabhadra");
    expect(await d.open("hampi", "user_2")).toBeNull();
    // Membership, not a count: the written catalogue grows, and this is about whose card it is.
    const mine = (await d.ask({ country: "in", month: 12, userId: "user_1" })).map((c) => c.card.slug);
    const theirs = (await d.ask({ country: "in", month: 12, userId: "user_2" })).map((c) => c.card.slug);
    expect(mine).toContain("hampi");
    expect(theirs).not.toContain("hampi");
  });

  it("counts the people who searched a place, not the searches, and queues it once enough have", async () => {
    const d = new Discover({ writeAt: 3, store: memory() });
    expect(await d.searched("hampi", "user_1")).toBe(1);
    expect(await d.searched("hampi", "user_1")).toBe(1);
    expect(await d.toWrite()).toEqual([]);
    await d.searched("hampi", "user_2");
    expect(await d.searched("hampi", "user_3")).toBe(3);
    expect(await d.toWrite()).toEqual([{ slug: "hampi", people: 3 }]);
  });

  it("never queues a place we have already written", async () => {
    const d = new Discover({ writeAt: 1, store: memory() });
    await d.searched("erg-chebbi-silence", "user_1");
    expect(await d.toWrite()).toEqual([]);
    expect(curatedBySlug("erg-chebbi-silence")).toBeTruthy();
  });
});

describe("the tools, as a bot calls them", () => {
  const travel = { id: "travel", skills: {} };
  const writer = { id: "keybot", skills: {} };

  it("gives the tools to the Travel bot and to anything that searches the web, and to nothing else", () => {
    expect(discoverFor(travel)).toBe(true);
    expect(discoverFor({ id: "plan", skills: { web: true } })).toBe(true);
    expect(discoverFor(writer)).toBe(false);
  });

  it("offers only tags we know, so the model cannot invent one", () => {
    const def = DISCOVER_TOOLS.find((t) => t.name === "places_discover")!;
    const props = def.parameters as { properties: { tags: { items: { enum: string[] } } } };
    expect(props.properties.tags.items.enum).toContain("solitude");
    expect(props.properties.tags.items.enum).not.toContain("spiritual");
  });

  it("answers with lines the model can choose from, and a card the apps draw", async () => {
    const d = new Discover({ store: memory() });
    const cards: unknown[] = [];
    const out = await runDiscover(d, "user_1", "places_discover", { tags: ["warm"], month: 1 }, (c) => cards.push(c));
    expect(out.ok).toBe(true);
    expect(out.content).toContain("Erg Chebbi");
    expect(out.content).toMatch(/never a price/);
    expect(cards).toHaveLength(1);
    const card = cards[0] as { kind: string; query: string; results: Array<{ title: string; ours: boolean }> };
    expect(card.kind).toBe("places");
    expect(card.query).toBe("warm · January");
    expect(card.results[0]?.ours).toBe(true);
  });

  it("says plainly that we have nothing, instead of inventing a place", async () => {
    const d = new Discover({ store: memory() });
    const out = await runDiscover(d, "user_1", "places_discover", { country: "jp", month: 1 });
    expect(out.ok).toBe(true);
    expect(out.content).toMatch(/Nothing of ours/);
    expect(out.content).toMatch(/do not invent/);
  });

  it("refuses a tool name it does not have", async () => {
    const d = new Discover({ store: memory() });
    const out = await runDiscover(d, "user_1", "places_book_it", {});
    expect(out.ok).toBe(false);
    expect(out.content).toContain("no tool called");
  });

  it("opens one place by its slug, and says whose words it is", async () => {
    const d = new Discover({ store: memory() });
    const out = await runDiscover(d, "user_1", "place_open", { slug: "erg-chebbi-silence" });
    expect(out.ok).toBe(true);
    expect(out.content).toContain("The silence of Erg Chebbi");
    expect(out.content).toMatch(/Ours: our own words/);
  });

  it("puts the words of the ask on the card", () => {
    expect(askWords(["warm", "solitude"], 3)).toBe("warm, solitude · March");
    expect(askWords([], undefined, "in")).toBe("IN");
  });

  it("carries the first photograph and its credit onto the row", () => {
    const card = placesCardOf("warm", [{
      card: { ...CURATED[0]!, photos: [{ url: "https://u/a.jpg", alt: "dunes", credit: "Wikimedia Commons · CC0 · X" }] },
      score: 1, matched: [], wildcard: false,
    }], 1);
    expect(card.results[0]?.photo).toEqual({ url: "https://u/a.jpg", alt: "dunes", credit: "Wikimedia Commons · CC0 · X" });
  });
});
