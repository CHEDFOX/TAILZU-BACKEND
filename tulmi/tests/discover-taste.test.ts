/**
 * src/discover/taste, signals and onboarding: what a person likes, learned from what they do. Pure maths and a
 * memory table — no network, no model, no clock of its own.
 *
 *   - an order of six becomes evidence both ways: first place as strong as a keep, last place against
 *   - a partial or repeated order is refused rather than folded (missing taps would become evidence)
 *   - keeping teaches the tags of the place AND the tags related to them, damped
 *   - opposites move the other way: liking cold is evidence against warm
 *   - one tap cannot commit the profile: shrinkage holds thin evidence near zero
 *   - being SHOWN something is never evidence of taste, and showing a lot damps what interest means
 *   - evidence fades: the same keep is worth less after half a year
 *   - a six-tag place does not produce six strong opinions
 *   - the feed: a profile orders it, an explicit ask still wins, and the wildcard is not chosen by the profile
 *   - "because you keep…" is said only when the evidence is there, never invented
 */
import { describe, expect, it } from "vitest";

const { Discover } = await import("../src/discover/index.js");
const { store } = await import("../src/discover/store.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { CURATED } = await import("../src/discover/catalog.js");
const { pick } = await import("../src/discover/query.js");
const {
  emptyTaste, fold, scoreOf, sureOf, known, likes, dislikes, because, match, decayAll,
  transferWeight, tagDilution, exposureNormalised, decayFactor, HALF_LIFE_DAYS,
  readingOf, weKnow, told, KNOWN_AT,
} = await import("../src/discover/taste.js");
const { budgetLevel, budgetBand } = await import("../src/discover/taxonomy.js");
const { weightOf, rankWeight, dwellWeight, DWELL_MIN_MS, DWELL_FULL_MS } = await import("../src/discover/signals.js");
const { seasonWords: words, daysLeftInSeason: left } = await import("../src/discover/taxonomy.js");

const memory = () => store({
  cards: new MemoryTable(), asks: new MemoryTable(), taste: new MemoryTable(), signals: new MemoryTable(),
});

const DAY = 86_400_000;
const T0 = "2026-11-20T09:00:00.000Z";
const at = (daysOn = 0) => new ISODate(daysOn).iso;
class ISODate {
  readonly iso: string;
  constructor(daysOn: number) { this.iso = new Date(Date.parse(T0) + daysOn * DAY).toISOString(); }
}

// rankWeight outlives the onboarding screen it was written for: the "ranked" signal still carries a position in
// a list, and the feed's own ordering is the obvious next thing to fold through it.
describe("where something sits in an order", () => {
  it("is symmetric: first as strong as a keep, last against, middle near nothing", () => {
    expect(rankWeight(1, 6)).toBeCloseTo(2.5, 5);
    expect(rankWeight(2, 6)).toBeCloseTo(1.5, 5);
    expect(rankWeight(3, 6)).toBeCloseTo(0.5, 5);
    expect(rankWeight(4, 6)).toBeCloseTo(-0.5, 5);
    expect(rankWeight(6, 6)).toBeCloseTo(-2.5, 5);
  });

  it("adds up to nothing overall, so ranking does not make somebody like everything", () => {
    const total = [1, 2, 3, 4, 5, 6].reduce((sum, r) => sum + rankWeight(r, 6), 0);
    expect(total).toBeCloseTo(0, 5);
  });

  it("is zero when there is nothing to compare against", () => {
    expect(rankWeight(1, 1)).toBe(0);
  });
});

describe("how hard and how dear, which are levels and not likes", () => {
  const keep = (effort: number, budget: number, weight = 3) =>
    ({ tags: ["desert"] as const, weight, at: at(), levels: { effort, budget } });

  it("knows nothing at the start, and says so rather than guessing a middle", () => {
    const t = emptyTaste(at());
    expect(readingOf(t, "effort")).toEqual({ of: 0, sure: 0 });
    expect(weKnow(t, "effort")).toBe(false);
    expect(weKnow(t, "budget")).toBe(false);
  });

  it("settles on what they keep going toward", () => {
    let t = emptyTaste(at());
    for (const _ of [1, 2, 3, 4]) t = fold(t, keep(4, 3));
    const r = readingOf(t, "effort");
    expect(r.of).toBeCloseTo(4, 5);
    expect(r.sure).toBeGreaterThan(KNOWN_AT);
    expect(weKnow(t, "effort")).toBe(true);
  });

  it("averages rather than following the last thing they tapped", () => {
    let t = emptyTaste(at());
    t = fold(t, keep(5, 4));
    t = fold(t, keep(1, 1));
    expect(readingOf(t, "effort").of).toBeCloseTo(3, 5);
  });

  it("learns NOTHING about a level from a rejection, because a rejection does not say which part", () => {
    // "Not for me" on a five-day trek could be the cold, the price, the country or the picture. Inferring
    // "they dislike effort" from it is how somebody ends up sent up a mountain or into a hostel.
    let t = emptyTaste(at());
    t = fold(t, { tags: ["desert"], weight: -5, at: at(), levels: { effort: 5, budget: 4 } });
    expect(readingOf(t, "effort")).toEqual({ of: 0, sure: 0 });
    // and the tags still move, which is what a rejection IS evidence about
    expect(scoreOf(t, "desert")).toBeLessThan(0);
  });

  it("learns nothing from a card merely shown, same as the tags", () => {
    let t = emptyTaste(at());
    t = fold(t, { tags: ["desert"], weight: 0, at: at(), onlyShown: true, levels: { effort: 5, budget: 4 } });
    expect(readingOf(t, "effort").sure).toBe(0);
  });

  it("stays unsure after one tap, so a plan still asks", () => {
    const t = fold(emptyTaste(at()), keep(2, 2));
    expect(weKnow(t, "effort")).toBe(false);
  });

  it("takes an answer when somebody is asked, and weighs it heavily enough to stop asking", () => {
    const t = told(emptyTaste(at()), "budget", 2, at());
    expect(weKnow(t, "budget")).toBe(true);
    expect(readingOf(t, "budget").of).toBeCloseTo(2, 5);
  });

  it("holds a budget band as a number and gives it back as a word", () => {
    expect(budgetLevel("budget")).toBe(1);
    expect(budgetLevel("luxury")).toBe(4);
    expect(budgetBand(1)).toBe("budget");
    expect(budgetBand(3.4)).toBe("premium");
    // out of range rounds into the scale rather than throwing: a mean can drift
    expect(budgetBand(0)).toBe("budget");
    expect(budgetBand(99)).toBe("luxury");
  });
});

describe("learning from what they do", () => {
  it("teaches the place's tags, and related tags more gently", () => {
    const t = fold(emptyTaste(at()), { tags: ["cold", "mountains"], weight: 3, at: at() });
    expect(scoreOf(t, "cold")).toBeGreaterThan(0);
    // solitude was never shown, but it travels with cold
    expect(scoreOf(t, "solitude")).toBeGreaterThan(0);
    expect(scoreOf(t, "solitude")).toBeLessThan(scoreOf(t, "cold"));
  });

  it("moves opposites the other way", () => {
    const t = fold(emptyTaste(at()), { tags: ["cold"], weight: 3, at: at() });
    expect(scoreOf(t, "warm")).toBeLessThan(0);
  });

  it("will not commit on one tap", () => {
    const t = fold(emptyTaste(at()), { tags: ["desert"], weight: 3, at: at() });
    // One keep is a clear lean and no more: both land exactly on half, by design (SHRINKAGE).
    expect(scoreOf(t, "desert")).toBeCloseTo(0.5, 5);
    expect(sureOf(t, "desert")).toBeCloseTo(0.5, 5);
  });

  it("sharpens as the same thing keeps happening", () => {
    let t = emptyTaste(at());
    for (let i = 0; i < 6; i += 1) t = fold(t, { tags: ["desert"], weight: 3, at: at(i) });
    expect(scoreOf(t, "desert")).toBeGreaterThan(0.55);
    expect(sureOf(t, "desert")).toBeGreaterThan(0.7);
  });

  it("takes a rejection harder than a keep, because somebody meant it", () => {
    const kept = fold(emptyTaste(at()), { tags: ["nightlife"], weight: weightOf({ kind: "keep" }), at: at() });
    const refused = fold(emptyTaste(at()), { tags: ["nightlife"], weight: weightOf({ kind: "not_for_me" }), at: at() });
    expect(Math.abs(scoreOf(refused, "nightlife"))).toBeGreaterThan(Math.abs(scoreOf(kept, "nightlife")));
  });

  it("never reads being shown something as taste", () => {
    const t = fold(emptyTaste(at()), { tags: ["luxury"], weight: 0, at: at(), onlyShown: true });
    expect(scoreOf(t, "luxury")).toBe(0);
    expect(sureOf(t, "luxury")).toBe(0);
    expect(t.dims.luxury?.shown).toBe(1);
  });

  it("divides out its own bias: the same interest counts for less once we have pushed a tag at them", () => {
    expect(exposureNormalised(3, 0)).toBeCloseTo(3, 5);
    expect(exposureNormalised(3, 90)).toBeLessThan(1.1);
    // negative evidence is never damped — a rejection after forty showings still means no.
    expect(exposureNormalised(-5, 90)).toBe(-5);
  });

  it("lets old evidence fade by half over the half-life", () => {
    expect(decayFactor(at(), Date.parse(at()))).toBe(1);
    expect(decayFactor(at(), Date.parse(at(HALF_LIFE_DAYS)))).toBeCloseTo(0.5, 2);

    // Fading on touch is not enough on its own: nothing had touched `beach`, so only loading the profile
    // (decayAll) brings every dimension up to now. This is what a year away must look like.
    const kept = fold(emptyTaste(at()), { tags: ["beach"], weight: 3, at: at() });
    const fresh = sureOf(kept, "beach");
    const toTouch = fold(kept, { tags: ["desert"], weight: 0.0001, at: at(HALF_LIFE_DAYS * 2) });
    expect(sureOf(toTouch, "beach")).toBeCloseTo(fresh, 5); // untouched: unchanged

    const aged = decayAll(kept, Date.parse(at(HALF_LIFE_DAYS)));
    expect(sureOf(aged, "beach")).toBeLessThan(fresh);
    expect(aged.dims.beach!.pos).toBeCloseTo(kept.dims.beach!.pos / 2, 1);
  });

  it("does not turn a six-tag place into six strong opinions", () => {
    expect(tagDilution(1)).toBe(1);
    expect(tagDilution(6)).toBeCloseTo(1 / Math.sqrt(6), 5);
    const one = fold(emptyTaste(at()), { tags: ["history"], weight: 3, at: at() });
    const six = fold(emptyTaste(at()), { tags: ["history", "culture", "architecture", "city", "food", "social"], weight: 3, at: at() });
    expect(scoreOf(six, "history")).toBeLessThan(scoreOf(one, "history"));
  });

  it("scales a look by how long it was, and never past a keep", () => {
    expect(dwellWeight(400)).toBeLessThan(0); // a scroll-past counts against
    expect(dwellWeight(DWELL_MIN_MS)).toBeCloseTo(0.5, 5);
    expect(dwellWeight(DWELL_FULL_MS)).toBeCloseTo(2, 5);
    expect(dwellWeight(60_000)).toBeCloseTo(2, 5); // staring adds nothing further
    expect(dwellWeight(DWELL_FULL_MS)).toBeLessThan(weightOf({ kind: "keep" }));
  });
});

describe("saying why, and only when we can", () => {
  it("says nothing on an empty profile", () => {
    expect(because(emptyTaste(at()), ["cold", "solitude"])).toBeNull();
  });

  it("says it in the person's own words once the evidence is there", () => {
    let t = emptyTaste(at());
    for (let i = 0; i < 8; i += 1) t = fold(t, { tags: ["solitude", "cold"], weight: 3, at: at(i) });
    const line = because(t, ["cold", "solitude"]);
    expect(line).toBeTruthy();
    expect(line).toMatch(/^because you keep /);
  });

  it("names what they like and what they turn down", () => {
    let t = emptyTaste(at());
    for (let i = 0; i < 8; i += 1) t = fold(t, { tags: ["history"], weight: 3, at: at(i) });
    for (let i = 0; i < 8; i += 1) t = fold(t, { tags: ["nightlife"], weight: -5, at: at(i) });
    expect(likes(t).map((l) => l.tag)).toContain("history");
    expect(dislikes(t).map((l) => l.tag)).toContain("nightlife");
    expect(known(t)).toBeGreaterThan(0);
    expect(known(t)).toBeLessThanOrEqual(1);
  });

  it("knows how much of somebody it knows, and starts at nothing", () => {
    expect(known(emptyTaste(at()))).toBe(0);
  });
});

describe("the feed, once there is a profile", () => {
  const liking = (tags: Parameters<typeof fold>[1]["tags"], times = 8) => {
    let t = emptyTaste(at());
    for (let i = 0; i < times; i += 1) t = fold(t, { tags, weight: 3, at: at(i) });
    return t;
  };

  it("orders two people's feeds differently from the same catalogue", () => {
    const ruins = liking(["history", "architecture"]);
    const cold = liking(["cold", "solitude"]);
    const a = pick(CURATED, { limit: 6 }, ruins).map((c) => c.card.slug);
    const b = pick(CURATED, { limit: 6 }, cold).map((c) => c.card.slug);
    expect(a).not.toEqual(b);
  });

  it("still gives people what they actually asked for", () => {
    const cold = liking(["cold", "solitude"]);
    const out = pick(CURATED, { tags: ["desert"], month: 1 }, cold);
    expect(out[0]?.card.tags).toContain("desert");
  });

  it("carries the reason with the card once it can", () => {
    const ruins = liking(["history", "architecture"]);
    const out = pick(CURATED, { limit: 8 }, ruins);
    expect(out.some((c) => typeof c.reason === "string" && c.reason.startsWith("because you keep"))).toBe(true);
  });

  it("keeps the wildcard off the profile, so the feed can still surprise", () => {
    const cold = liking(["cold", "solitude"]);
    const out = pick(CURATED, { tags: ["cold"], month: 1, limit: 8 }, cold);
    const odd = out.find((c) => c.wildcard);
    expect(odd).toBeTruthy();
    expect(odd?.card.tags).not.toContain("cold");
  });

  it("is unchanged for somebody with no profile at all", () => {
    const withNone = pick(CURATED, { tags: ["desert"], month: 1 }).map((c) => c.card.slug);
    const again = pick(CURATED, { tags: ["desert"], month: 1 }).map((c) => c.card.slug);
    expect(withNone).toEqual(again);
    // What is asked for leads. Naming a slug here would make this a test of the catalogue's contents instead.
    const top = CURATED.find((c) => c.slug === withNone[0])!;
    expect(top.tags).toContain("desert");
  });
});

describe("through Discover, as the server uses it", () => {
  it("has no opinion about somebody new", async () => {
    const d = new Discover({ store: memory() });
    const mine = await d.taste("user_1");
    expect(mine.known).toBe(0);
    expect(mine.likes).toEqual([]);
  });

  it("gets its whole shape from what they do, there being nothing to fill in first", async () => {
    const d = new Discover({ store: memory() });
    await d.did("user_1", { kind: "keep", slug: "deadvlei" });
    const mine = await d.taste("user_1");
    expect(mine.known).toBeGreaterThan(0);
    expect(mine.likes.map((l) => l.tag)).toContain("desert");
  });

  it("hears a rejection at once, rather than overnight", async () => {
    const d = new Discover({ store: memory() });
    await d.did("user_1", { kind: "not_for_me", slug: "deadvlei" });
    const mine = await d.taste("user_1");
    expect(mine.dislikes.length + mine.likes.length).toBeGreaterThan(0);
    expect(mine.taste.signals).toBe(1);
  });

  it("counts every card it put in a feed as shown, so interest is judged against what it pushed", async () => {
    const d = new Discover({ store: memory() });
    await d.did("user_1", { kind: "keep", slug: "deadvlei" });
    const before = (await d.taste("user_1")).taste;
    const shownBefore = Object.values(before.dims).reduce((n, dim) => n + (dim?.shown ?? 0), 0);

    await d.ask({ userId: "user_1", limit: 5 });
    const after = (await d.taste("user_1")).taste;
    const shownAfter = Object.values(after.dims).reduce((n, dim) => n + (dim?.shown ?? 0), 0);
    expect(shownAfter).toBeGreaterThan(shownBefore);
  });

  it("picks up how hard and how dear from the cards they keep, not from a question", async () => {
    const d = new Discover({ store: memory() });
    // son-doong is effort 5 and luxury; keeping it says something a tag never could
    for (const _ of [1, 2, 3, 4]) await d.did("user_1", { kind: "keep", slug: "son-doong" });
    const { taste } = await d.taste("user_1");
    expect(weKnow(taste, "effort")).toBe(true);
    expect(readingOf(taste, "effort").of).toBeCloseTo(5, 1);
    expect(budgetBand(readingOf(taste, "budget").of)).toBe("luxury");
  });

  it("ignores a signal about something that is not a place or an image", async () => {
    const d = new Discover({ store: memory() });
    const taste = await d.did("user_1", { kind: "keep", slug: "not-a-thing" });
    expect(taste.signals).toBe(0);
  });

  it("learns from how long a card sat on the screen, which is most of what it ever gets", async () => {
    const d = new Discover({ store: memory() });
    await d.did("user_1", { kind: "dwell", slug: "deadvlei", ms: 9000 });
    expect((await d.taste("user_1")).taste.signals).toBe(1);
    expect(scoreOf((await d.taste("user_1")).taste, "desert")).toBeGreaterThan(0);
  });
});

describe("what the app is sent, not what we hold", () => {
  it("says the season in a sentence, because a screen does no month arithmetic", () => {
    const erg = CURATED.find((c) => c.slug === "erg-chebbi-silence")!;
    // Held as a bitmask; sent as words. A card that went out raw would read "best 3585".
    expect(typeof erg.season).toBe("number");
    expect(words(erg.season)).toBe("October to March");
  });

  it("counts the days left of a window only while somebody is inside it", () => {
    const erg = CURATED.find((c) => c.slug === "erg-chebbi-silence")!;
    expect(left(erg.season, new Date(Date.UTC(2027, 1, 20)))).toBeGreaterThan(0); // February: in season
    expect(left(erg.season, new Date(Date.UTC(2027, 5, 20)))).toBeNull();          // June: out of it
  });
});

describe("the photographs", () => {
  it("gives every written place a picture, with a credit on it", () => {
    for (const card of CURATED) {
      const photo = card.photos[0];
      expect({ slug: card.slug, has: !!photo }).toEqual({ slug: card.slug, has: true });
      expect(photo!.url).toMatch(/^\/photos\/[a-z0-9-]+\.jpg$/);
      expect(photo!.alt.length).toBeGreaterThan(3);
      // Two kinds of picture, and the credit must say plainly which this is. A graded Commons photograph is a
      // derivative, so it names the licence and says it was altered. An illustration is not a photograph of the
      // place at all, and saying so is the whole point of the field.
      const credit = photo!.credit ?? "";
      const commons = credit.includes("Wikimedia Commons") && credit.includes("altered");
      const drawn = credit.startsWith("Illustration");
      expect({ slug: card.slug, honest: commons || drawn }).toEqual({ slug: card.slug, honest: true });
    }
  });

  it("points each place at its own file, never somebody else's", () => {
    for (const card of CURATED) {
      expect(card.photos[0]!.url).toBe(`/photos/${card.slug}.jpg`);
    }
  });
});
