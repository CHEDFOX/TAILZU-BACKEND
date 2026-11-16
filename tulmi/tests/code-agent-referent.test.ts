/**
 * A DESIGN DIRECTION FOR A PERSON WHO HAS NONE (src/code/agent/referent.ts).
 *
 * Adjectives name a region and a model asked for a region gives its centre, which is the generic page everyone complains about. A specific thing
 * names a point, and carries its own restrictions: naming a lecture handout says it does not glow, without anyone writing that down.
 *
 * What these hold down:
 *   - a candidate must be a THING. "Clean modern design" names nothing and is thrown out;
 *   - the list must reach across at least three material worlds, or it stopped at the first obvious answer and is asked again — once;
 *   - THE HAND IS DEALT, NOT RANKED. Ranking hands the choice back to the taste that caused the sameness, and it takes the safe card every time;
 *   - the deal is the same after a restart, so a job cannot quietly change direction halfway through;
 *   - nothing to go on, or no model, is "unclear" and a question — never a guessed direction, which is the one mistake that is dear to undo;
 *   - the brief names the thing and does NOT list don'ts: a long list of them means the direction was too vague to carry them.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
noNetwork();

const { CANDIDATES, DEALT, FAMILIES_MIN, concrete, deal, familyCount, referentBrief, referentFor } = await import("../src/code/agent/referent.js");
const { fakeCall } = await import("./work-fixtures.js");
type Candidate = import("../src/code/agent/referent.js").Candidate;

const c = (thing: string, family: string): Candidate => ({ thing, family, why: "its customers know it", look: "ink on off-white, one red" });
const WIDE = [c("a hand-lettered butcher's window card", "signage"), c("a 1950s enamel kitchen scale", "instrument"), c("a market stall awning", "textile"), c("a greaseproof wrapping sheet", "print"), c("a tiled shopfront front", "architecture")];
const NARROW = [c("a menu board", "print"), c("a price list", "print"), c("a receipt", "print"), c("a paper bag", "print")];

const ctx = (...answers: unknown[]) => {
  const json = fakeCall();
  let n = 0;
  json.on("code.referent", () => answers[Math.min(n++, answers.length - 1)]);
  return { json, model: { userId: "u", budget: "none" as const, call: json.call } };
};
const SHOP = "a booking page for a two-chair barber shop in an old market town";

describe("what counts as a direction", () => {
  it("is a thing, not a mood", () => {
    expect(concrete("a 1970s university lecture handout")).toBe(true);
    expect(concrete("an enamel kitchen scale")).toBe(true);
    expect(concrete("clean modern minimal")).toBe(false);
    expect(concrete("premium")).toBe(false);
    expect(concrete("")).toBe(false);
  });

  it("counts the material worlds a list reaches across", () => {
    expect(familyCount(WIDE)).toBe(5);
    expect(familyCount(NARROW)).toBe(1);
  });
});

describe("the hand", () => {
  it("is dealt and not ranked, so the safe card does not always win", () => {
    // Over many seeds every candidate reaches the top, which a ranked list could never do.
    const first = new Set(Array.from({ length: 60 }, (_, i) => deal(WIDE, `job-${i}`)[0]!.thing));
    expect(first.size).toBeGreaterThan(1);
    expect(deal(WIDE, "x")).toHaveLength(DEALT);
    expect(deal(WIDE, "x").map((x) => x.thing)).toHaveLength(new Set(deal(WIDE, "x").map((x) => x.thing)).size);
  });

  it("is the same hand after a restart, so a job does not change direction halfway through", () => {
    expect(deal(WIDE, "job-7")).toEqual(deal(WIDE, "job-7"));
    expect(deal(WIDE, "job-7")).not.toEqual(deal(WIDE, "job-8"));
  });

  it("deals what there is when there are fewer than it wants", () => {
    expect(deal(WIDE.slice(0, 2), "x")).toHaveLength(2);
    expect(deal([], "x")).toEqual([]);
  });
});

describe("deriving one", () => {
  it("asks for things from the product's world and picks from a dealt hand", async () => {
    const k = ctx({ candidates: WIDE, rut: "a dark hero photograph with a gold script logo" });
    const out = await referentFor({ what: SHOP, seed: "job-1" }, k.model);
    expect(out.kind).toBe("one");
    if (out.kind !== "one") throw new Error("expected one");
    expect(WIDE.map((x) => x.thing)).toContain(out.chosen.thing);
    expect(out.dealt).toHaveLength(DEALT);
    expect(out.rut).toContain("gold script");
    // The product is sent as data, and nothing is asked twice when the list already spread.
    const sent = k.json.of("code.referent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.user).toContain("<product>");
  });

  it("asks again, once, when the list stopped at the first obvious world", async () => {
    const k = ctx({ candidates: NARROW }, { candidates: WIDE });
    const out = await referentFor({ what: SHOP, seed: "job-1" }, k.model);
    expect(k.json.of("code.referent")).toHaveLength(2);
    expect(k.json.of("code.referent")[1]!.user).toMatch(new RegExp(`at least ${FAMILIES_MIN}`));
    expect(out.kind).toBe("one");
  });

  it("gives up after asking again, and takes the best it had rather than looping", async () => {
    const k = ctx({ candidates: NARROW });
    const out = await referentFor({ what: SHOP, seed: "job-1" }, k.model);
    expect(k.json.of("code.referent")).toHaveLength(2);
    expect(out.kind).toBe("one");
  });

  it("throws out the moods and keeps the things", async () => {
    const k = ctx({ candidates: [...WIDE.slice(0, 3), c("clean modern minimal", "screen"), c("premium feel", "screen")] });
    const out = await referentFor({ what: SHOP, seed: "job-1" }, k.model);
    if (out.kind !== "one") throw new Error("expected one");
    for (const d of out.dealt) expect(concrete(d.thing)).toBe(true);
  });

  it("is unclear, never a guess, with nothing to go on, no model, or a model that is down", async () => {
    const k = ctx({ candidates: WIDE });
    expect((await referentFor({ what: "fix it", seed: "s" }, k.model)).kind).toBe("unclear");
    expect((await referentFor({ what: SHOP, seed: "s" }, null)).kind).toBe("unclear");
    const down = ctx({ candidates: WIDE });
    down.json.down = true;
    expect((await referentFor({ what: SHOP, seed: "s" }, down.model)).kind).toBe("unclear");
    // And nothing concrete coming back is also unclear, not a direction made of moods.
    const moods = ctx({ candidates: [c("clean modern", "screen"), c("premium", "screen"), c("sleek", "screen"), c("minimal", "screen")] });
    expect((await referentFor({ what: SHOP, seed: "s" }, moods.model)).kind).toBe("unclear");
  });

  it("takes the register as steering, because one word is what a person with no design idea can give", async () => {
    const k = ctx({ candidates: WIDE });
    await referentFor({ what: SHOP, seed: "s", register: "bolder" }, k.model);
    expect(k.json.of("code.referent")[0]!.user).toMatch(/Reach further/);
    const safe = ctx({ candidates: WIDE });
    await referentFor({ what: SHOP, seed: "s", register: "safer" }, safe.model);
    expect(safe.json.of("code.referent")[0]!.user).toMatch(/familiar and well made is a real destination/);
  });
});

describe("the brief the builder is given", () => {
  it("names the thing and lets its restrictions come with it, rather than listing don'ts", () => {
    const b = referentBrief(WIDE[0]!, "a dark hero photograph");
    expect(b).toContain("a hand-lettered butcher's window card");
    expect(b).toMatch(/you know what it is NOT/);
    expect(b).toMatch(/nobody has to list those out/);
    expect(b).toContain("a dark hero photograph");
    // The request always wins over the direction.
    expect(b).toMatch(/the request wins, always/);
    // And it stays short: a long list of don'ts would prove the direction was too vague to carry them.
    expect(b.split("\n").filter((l) => /^(Do not|Don't|Never)/.test(l))).toHaveLength(0);
    expect(b.length).toBeLessThan(1_200);
  });
});
