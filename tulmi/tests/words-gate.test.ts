import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { buildBootstrap, buildScreen, buildKeyboardConfig, WORDS_GATE } from "../src/experience/catalog.js";

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

describe("the gate is one editable block", () => {
  // It used to be a list of numbers beside a map of copy keyed by those exact
  // numbers. Retuning a mark without editing the map left the lookup
  // undefined and threw on the next bootstrap — for every user at once, from
  // a change that looked like editing a number.

  it("carries its own words on every mark, so none can go missing", () => {
    for (const m of WORDS_GATE.milestones) {
      expect(m.at).toBeGreaterThan(0);
      for (const line of [m.kicker, m.title, m.body]) {
        expect(typeof line).toBe("string");
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  it("survives a mark being retuned to a number no copy was written for", () => {
    // The property the whole shape exists for: adding, moving or deleting a
    // mark is editing one entry and cannot desync anything.
    const original = [...WORDS_GATE.milestones];
    try {
      (WORDS_GATE.milestones as any).length = 0;
      (WORDS_GATE.milestones as any).push({
        at: 99, kicker: "{left} left", title: "New mark", body: "{used} of {total}.",
      });
      const c = buildBootstrap({ wordsUsed: 120, allowance: allow(120) }).launchCard!;
      expect(c.id).toBe("words-99");
      const texts = (c.root as any).children.map((k: any) => k.props?.content).filter(Boolean);
      // And the templating filled the reader's own figures in.
      expect(texts.join(" ")).toContain("680 left");
      expect(texts.join(" ")).toContain("120 of 800.");
    } finally {
      (WORDS_GATE.milestones as any).length = 0;
      (WORDS_GATE.milestones as any).push(...original);
    }
  });

  it("templates the numbers rather than computing them in code", () => {
    // Changing what a card says — including WHICH numbers it says — has to be
    // editing a string, or the copy is code and only a developer can touch it.
    const withNumbers = WORDS_GATE.milestones.filter((m) =>
      /\{(used|left|total)\}/.test(`${m.kicker}${m.title}${m.body}`));
    expect(withNumbers.length).toBeGreaterThan(0);
    // None of them leak an unfilled token to the reader.
    for (const m of [222, 446, 732]) {
      const c = buildBootstrap({ wordsUsed: m, allowance: allow(m) }).launchCard!;
      expect(JSON.stringify(c)).not.toMatch(/\{(used|left|total|streak)\}/);
    }
  });

  it("leaks no unfilled token on the out-of-words screen either", () => {
    const s = buildScreen("words_out", {
      personality: {}, language: "en",
      allowance: { ...(allow(800) as any), streakDays: 4 },
    } as never);
    expect(JSON.stringify(s)).not.toMatch(/\{(used|left|total|streak)\}/);
    expect(JSON.stringify(s)).toContain("4 days running");
  });

  it("names one destination that everything routes through", () => {
    // The paywall id and the out-of-words id each live in exactly one place,
    // so moving either is one edit and nothing is left pointing at the old.
    const c = buildBootstrap({ wordsUsed: 500, allowance: allow(500) }).launchCard!;
    const go = (c.root as any).children.find((k: any) => k.on?.onPress?.kind === "navigate");
    expect(go.on.onPress.screenId).toBe(WORDS_GATE.paywallScreenId);
    const f = buildKeyboardConfig(undefined, undefined, {
      quota: { remaining: 0, total: 800, entitled: false },
    }).flags as Record<string, any>;
    expect(f["kb.quota.screenId"]).toBe(WORDS_GATE.outScreenId);
    expect(buildScreen(WORDS_GATE.outScreenId, { personality: {}, language: "en" } as never)).not.toBeNull();
  });

  it("keeps the keyboard's warning thresholds as values, not arithmetic", () => {
    const low = (remaining: number, total: number) =>
      (buildKeyboardConfig(undefined, undefined, {
        quota: { remaining, total, entitled: false },
      }).flags as Record<string, any>)["kb.quota.low"];
    const floor = WORDS_GATE.lowFloor;
    const share = WORDS_GATE.lowShare;
    // The floor governs a small ceiling, the share governs a large one.
    expect(low(floor, 100)).toBe(true);
    expect(low(floor + 1, 100)).toBe(false);
    expect(low(Math.round(2900 * share), 2900)).toBe(true);
  });
});
