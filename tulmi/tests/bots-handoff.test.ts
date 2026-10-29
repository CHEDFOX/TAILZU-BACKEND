import { describe, expect, it } from "vitest";
import type { Node, ScreenResponse } from "../../shared/types/sdui.js";

// The keyboard's handoff screens in the Bots app (experience/bots/screens/handoff.ts): flow_arm, keyboard_record and
// keyboard_primer keep their ids and everything they do, and are drawn on the launch's cream with the icon's bot.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";

const { buildScreen, setMediaRegistryAccessor } = await import("../src/experience/catalog.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { CREAM } = await import("../src/experience/bots/screens/handoff.js");

const IDS = ["flow_arm", "keyboard_record", "keyboard_primer"] as const;
const build = (id: string, bots: boolean) => buildScreen(id, {
  personality: {}, language: "en", onboarded: true, email: "a@b.com", params: { session: "s-1", host: "Notes" }, bots,
} as never) as ScreenResponse;

/** Everything a tree DOES: each control's actions, each binding, each condition, each motion, in order of appearance. */
const doing = (root: Node): string[] => walk(root)
  .flatMap((n) => [n.on && `on ${JSON.stringify(n.on)}`, n.bind && `bind ${JSON.stringify(n.bind)}`,
    n.visibleIf && `if ${JSON.stringify(n.visibleIf)}`, n.motion && `motion ${JSON.stringify(n.motion)}`])
  .filter((x): x is string => !!x).sort();

describe("the keyboard's handoff screens in the Bots app", () => {
  setMediaRegistryAccessor(() => ({}));

  it.each(IDS)("%s keeps its id, state, actions and timing", (id) => {
    const old = build(id, false), now = build(id, true);
    expect(now.screenId).toBe(id);
    expect(now.state).toEqual(old.state);
    // The same actions; the words in them in the Bots app's sentence case, where the catalog capitalises every word.
    const folded = (x: unknown) => JSON.parse(JSON.stringify(x).toLowerCase());
    expect(folded(now.actions)).toEqual(folded(old.actions));
    expect(now.root!.props?.keepCase).toBe(true);
    expect(now.cacheTtlSeconds).toEqual(old.cacheTtlSeconds);
  });

  it.each(IDS)("%s does exactly what it did: every action fired, binding and condition", (id) => {
    expect(doing(build(id, true).root!)).toEqual(doing(build(id, false).root!));
  });

  it("the mic and the field it writes into are the catalog's own nodes", () => {
    const pick = (s: ScreenResponse, t: string) => walk(s.root!).find((n) => n.type === t);
    for (const t of ["VoiceToggle", "TextField"]) expect(pick(build("keyboard_record", true), t)).toEqual(pick(build("keyboard_record", false), t));
  });

  it.each(IDS)("%s is drawn on the cream with the icon's bot, in the kit, with no old chrome", (id) => {
    const s = build(id, true);
    expect(s.hideChrome).toBe(true);
    expect(s.theme?.color?.bg).toBe(CREAM);
    expect(s.root!.style?.backgroundColor).toBe(CREAM);
    const art = walk(s.root!).filter((n) => n.type === "Image").map((n) => (n.props?.source as { url: string }).url);
    expect(art).toEqual([expect.stringMatching(/\/blip\/bots\/x0-hang\.png\?v=\d+$/)]);
    // The kit's rules, save the mic (a phone part the kit has no helper for).
    expect(lintTree(s.root!).filter((m) => m !== "type VoiceToggle")).toEqual([]);
  });

  it("any other app gets the screens exactly as before", () => {
    for (const id of IDS) expect(build(id, false)).toEqual(buildScreen(id, {
      personality: {}, language: "en", onboarded: true, email: "a@b.com", params: { session: "s-1", host: "Notes" },
    } as never));
  });
});
