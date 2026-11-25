/**
 * GOING UP, NOT FORWARD (experience/bots/kit.ts up, backBar, sidebar): a back arrow that names where it goes, and the window's
 * sidebar, are sent as `replace`, so no build piles the parent (or the place) on top of where the person was and Back never has to
 * walk the whole way back through it.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

const { backBar, up, open, sidebar, SCREENS } = await import("../src/experience/bots/kit.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");

type A = { kind: string; replace?: boolean; root?: boolean; screenId?: string };
const actions = (n: unknown): A[] => walk(n as never).flatMap((x) => Object.values((x as { on?: Record<string, A> }).on ?? {}));

describe("up", () => {
  it("a navigate becomes a replace; anything else is left as it is", () => {
    expect(up(open(SCREENS.lingo))).toMatchObject({ kind: "navigate", screenId: SCREENS.lingo, replace: true });
    expect(up({ kind: "navigateBack" })).toEqual({ kind: "navigateBack" });
    expect(up("named")).toBe("named");
  });

  it("a back arrow that names where it goes replaces; a plain one goes back", () => {
    expect(actions(backBar({ onBack: open(SCREENS.code) }))[0]).toMatchObject({ kind: "navigate", replace: true });
    expect(actions(backBar())[0]).toEqual({ kind: "navigateBack" });
  });

  it("the window's sidebar opens its places afresh (root), and as a replace for a build before root", () => {
    const navs = actions(sidebar(ctxFor(SCREENS.talk, "desktop"), "talk")).filter((a) => a.kind === "navigate");
    expect(navs.length).toBeGreaterThan(3);
    for (const a of navs) expect(a, a.screenId).toMatchObject({ root: true, replace: true });
  });
});
