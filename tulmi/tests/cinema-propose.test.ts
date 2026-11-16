/**
 * WHAT THE BOT THINKS YOU WANT (src/cinema/propose.ts): the card the session draws is a proposal read from the talk.
 *
 *   - one vague line is not a film: nothing is proposed, and the model is not even asked
 *   - the length and the shape come back clamped to what we can actually film, never trusted as given
 *   - a proposal that is not ready, or is missing its concept, draws no card
 *   - the ladder on the card always holds the length that was proposed, in its place
 */
import { describe, expect, it } from "vitest";
import { LADDER, clampSeconds, lengthsFor, propose, readProposal, SECONDS_MAX, SECONDS_MIN } from "../src/cinema/propose.js";

const think = (json: unknown, usd = 0.0004) => {
  const calls: unknown[] = [];
  const fn = async (o: { user: unknown }) => { calls.push(o.user); return { json, text: "", usd }; };
  return Object.assign(fn, { calls });
};
const talk = (...said: string[]) => said.map((t, i) => ({ role: (i % 2 === 0 ? "me" : "bot") as "me" | "bot", text: t }));

describe("reading a proposal", () => {
  it("draws no card until it is ready", () => {
    expect(readProposal({ ready: false, concept: "A film about chai", seconds: 20, aspect: "9:16" })).toBeNull();
    expect(readProposal({ concept: "A film about chai", seconds: 20 })).toBeNull();
  });

  it("needs a concept worth showing", () => {
    expect(readProposal({ ready: true, concept: "chai", seconds: 20, aspect: "9:16" })).toBeNull();
    expect(readProposal({ ready: true, seconds: 20, aspect: "9:16" })).toBeNull();
  });

  it("keeps the seconds inside what we film, whatever came back", () => {
    expect(clampSeconds(24)).toBe(24);
    expect(clampSeconds(2)).toBe(SECONDS_MIN);
    expect(clampSeconds(9000)).toBe(SECONDS_MAX);
    expect(clampSeconds(21.6)).toBe(22);
    expect(clampSeconds("x")).toBeNull();
    expect(clampSeconds(0)).toBeNull();
    expect(readProposal({ ready: true, concept: "A chai stall in the first monsoon rain", seconds: 500, aspect: "9:16" })!.seconds).toBe(SECONDS_MAX);
    expect(readProposal({ ready: true, concept: "A chai stall in the first monsoon rain", seconds: "soon", aspect: "9:16" })).toBeNull();
  });

  it("falls back to a vertical film when the shape is not one we make", () => {
    const p = readProposal({ ready: true, concept: "A chai stall in the first monsoon rain", seconds: 24, aspect: "banana" })!;
    expect(p.aspect).toBe("9:16");
    expect(readProposal({ ready: true, concept: "A chai stall in the first monsoon rain", seconds: 24, aspect: "21:9" })!.aspect).toBe("21:9");
  });

  it("reads a proposal out of a model that wrapped it in words", () => {
    const p = readProposal('Sure! {"ready":true,"concept":"A 24-second film of a chai stall in the first monsoon rain","seconds":24,"aspect":"4:5","because":"you said under half a minute, and the feed"}')!;
    expect(p.seconds).toBe(24);
    expect(p.aspect).toBe("4:5");
    expect(p.because).toBe("you said under half a minute, and the feed");
    expect(readProposal("not json at all")).toBeNull();
  });
});

describe("asking for one", () => {
  it("does not ask the model when nothing has been said", async () => {
    const t = think({ ready: true, concept: "x".repeat(40), seconds: 20, aspect: "9:16" });
    expect((await propose(t, [])).proposal).toBeNull();
    expect((await propose(t, talk("hi"))).proposal).toBeNull();
    expect(t.calls).toHaveLength(0);
  });

  it("reads the talk, newest last, and gives back what it cost", async () => {
    const t = think({ ready: true, concept: "A chai stall in the first monsoon rain, three shots", seconds: 24, aspect: "4:5" });
    const out = await propose(t, talk("something for my chai stall", "How long?", "short, under half a minute, for reels"));
    expect(out.proposal).toMatchObject({ seconds: 24, aspect: "4:5" });
    expect(out.usd).toBeGreaterThan(0);
    expect(String(t.calls[0])).toContain("THEM: something for my chai stall");
    expect(String(t.calls[0])).toContain("BOT: How long?");
  });

  it("proposes nothing when the model fails, and never throws", async () => {
    const bad = async () => { throw new Error("no"); };
    expect((await propose(bad as never, talk("a 30 second ad for my chai stall"))).proposal).toBeNull();
  });
});

describe("the ladder on the card", () => {
  it("always holds the length that was proposed, in its place", () => {
    expect(lengthsFor(24)).toEqual([10, 15, 20, 24, 30, 45, 60, 90, 120]);
    expect(lengthsFor(30)).toEqual([...LADDER]);
    expect(lengthsFor(7)).toEqual([7, 10, 15, 20, 30, 45, 60, 90, 120]);
    expect(lengthsFor(180)).toEqual([10, 15, 20, 30, 45, 60, 90, 120, 180]);
  });
});
