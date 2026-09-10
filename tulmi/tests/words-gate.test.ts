import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { buildBootstrap, buildScreen, buildKeyboardConfig } from "../src/experience/catalog.js";

const allow = (used: number, total = 800) =>
  ({ base: total, earned: 0, total, used, remaining: Math.max(0, total - used), streakDays: 0, grants: [] } as never);
const card = (used: number, extra: Record<string, unknown> = {}) =>
  buildBootstrap({ wordsUsed: used, allowance: allow(used), ...extra }).launchCard;

describe("the words cards", () => {
  it("says nothing until the first mark is passed", () => {
    for (const used of [0, 5, 221]) expect(card(used)).toBeUndefined();
  });

  it("fires on PASSING a mark, not on landing exactly on it", () => {
    // Words arrive in whole cleanups: someone goes 210 → 264 and never equals
    // 222. A threshold that had to be hit exactly would fire for nobody.
    expect(card(222)!.id).toBe("words-222");
    expect(card(264)!.id).toBe("words-222");
  });

  it("shows the latest mark passed, not a queue of all of them", () => {
    // Someone who arrives at 800 having never opened the app gets one card.
    expect(card(500)!.id).toBe("words-446");
    expect(card(799)!.id).toBe("words-732");
  });

  it("gives each mark its own id, so each is shown exactly once", () => {
    const ids = [222, 446, 732].map((m) => card(m)!.id);
    expect(new Set(ids).size).toBe(3);
    for (const c of ids) expect(c).toMatch(/^words-\d+$/);
  });

  it("sends every one of them to the paywall", () => {
    for (const m of [222, 446, 732]) {
      const kids = (card(m)!.root as any).children;
      const go = kids.find((k: any) => k.type === "Button" && k.on?.onPress?.kind === "navigate");
      expect(go.on.onPress.screenId).toBe("paywall");
      // And a way out that is not buying. A card with one exit is a wall.
      expect(kids.some((k: any) => k.on?.onPress?.kind === "dismiss")).toBe(true);
    }
  });

  it("stops offering once there is nothing left to offer", () => {
    // Past the ceiling a different card takes over with a different job. An
    // offer and a stop sign must not arrive together.
    expect(card(800)).toBeUndefined();
    expect(card(900)).toBeUndefined();
  });

  it("never sells to someone who has already paid, or to a reviewer", () => {
    expect(card(500, { entitled: true })).toBeUndefined();
    expect(card(500, { isReviewer: true })).toBeUndefined();
  });

  it("counts against the EARNED ceiling, not the flat one", () => {
    // A user who came back four days running has more words, so "halfway" is
    // further along for them. The marks are fixed; the exhaustion is not.
    const earned = { ...(allow(760, 2900) as any) };
    expect(buildBootstrap({ wordsUsed: 760, allowance: earned }).launchCard!.id).toBe("words-732");
  });
});

describe("where the keyboard mic sends you when the words are gone", () => {
  const flags = (q?: Parameters<typeof buildKeyboardConfig>[2]) =>
    buildKeyboardConfig(undefined, undefined, q).flags as Record<string, any>;

  it("says nothing at all when the caller is anonymous", () => {
    // No number to trust → the mic behaves exactly as it always did, and the
    // 429 on the transcribe route catches it.
    expect(flags()["kb.quota.exhausted"]).toBeUndefined();
    expect(flags()["kb.quota.screenId"]).toBeUndefined();
  });

  it("marks exhausted only when there is nothing left AND nothing paid", () => {
    const out = { quota: { remaining: 0, total: 800, entitled: false } };
    const paid = { quota: { remaining: 0, total: 800, entitled: true } };
    const some = { quota: { remaining: 300, total: 800, entitled: false } };
    expect(flags(out)["kb.quota.exhausted"]).toBe(true);
    expect(flags(paid)["kb.quota.exhausted"]).toBe(false);
    expect(flags(some)["kb.quota.exhausted"]).toBe(false);
  });

  it("warns while there is still enough left for one real message", () => {
    // "Nearly out" has to mean something a person can act on.
    expect(flags({ quota: { remaining: 60, total: 800, entitled: false } })["kb.quota.low"]).toBe(true);
    expect(flags({ quota: { remaining: 300, total: 800, entitled: false } })["kb.quota.low"]).toBe(false);
    // Gone is not "low" — that is a different state with a different answer.
    expect(flags({ quota: { remaining: 0, total: 800, entitled: false } })["kb.quota.low"]).toBe(false);
  });

  it("names the destination, so it can move without a keyboard build", () => {
    expect(flags({ quota: { remaining: 0, total: 800, entitled: false } })["kb.quota.screenId"])
      .toBe("words_out");
  });
});

describe("the out-of-words screen", () => {
  const screen = (used = 800, total = 800) =>
    buildScreen("words_out", { personality: {}, language: "en", allowance: allow(used, total) } as never) as any;

  it("leads with what happened, and offers second", () => {
    const kids = screen().root.children;
    const texts = kids.filter((k: any) => k.type === "Text").map((k: any) => k.props.content);
    expect(texts[0]).toMatch(/out of words/i);
    const buttons = kids.filter((k: any) => k.type === "Button");
    // The offer is a button, not a price list to read before understanding.
    expect(buttons[0].props.label).toMatch(/words/i);
  });

  it("always leaves a way back to what they were writing", () => {
    // Reached by deep link from another app mid-message. A dead end here
    // strands someone on a screen they did not choose to open.
    const s = screen();
    const back = s.root.children.filter((k: any) => k.type === "Button").at(-1);
    expect(s.actions[back.on.onPress].kind).toBe("navigateBack");
  });

  it("is never cached, because it is a claim about a number that moves", () => {
    expect(screen().cacheTtlSeconds).toBe(0);
  });

  it("quotes the ceiling the server enforces, earned words included", () => {
    const s = screen(2900, 2900);
    expect(JSON.stringify(s)).toContain("2,900");
  });
});
