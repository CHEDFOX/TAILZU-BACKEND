import { describe, expect, it } from "vitest";
import type { Node, ScreenResponse } from "../../shared/types/sdui.js";

// The keyboard's handoff screens in the Bots app (experience/bots/screens/handoff.ts): flow_arm, keyboard_record and
// keyboard_primer keep their ids and everything they do, and are drawn on the launch's cream with the icon's bot.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";

const { buildScreen } = await import("../src/experience/screens.js");
const { setMediaRegistryAccessor } = await import("../src/experience/mediaRegistry.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { CREAM } = await import("../src/experience/bots/screens/handoff.js");

const IDS = ["flow_arm", "keyboard_record", "keyboard_primer"] as const;
/** Where today's screens leave for the Stats tab, the Bots app's switch to Talk, the tab it opens on. */
const home = (s: string) => s.replaceAll('{"kind":"navigate","screenId":"stats"}', '{"kind":"switchTab","tabId":"talk"}');
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
    // flow_arm adds its typing ("Say it", typed on the keyboard); everything the catalog keeps is kept.
    expect(now.state).toEqual(id === "flow_arm" ? { ...old.state, flowTouch: "" } : old.state);
    // The same actions; the words in them in the Bots app's sentence case, where the catalog capitalises every word.
    const folded = (x: unknown) => JSON.parse(home(JSON.stringify(x)).toLowerCase());
    // flow_arm waits for its typing before it leaves: the one delay that changes, and only ever longer.
    const held = (x: unknown) => JSON.parse(JSON.stringify(x), (k, v) => (k === "ms" ? "ms" : v));
    if (id === "flow_arm") {
      expect(held(folded(now.actions))).toEqual(held(folded(old.actions)));
      const ms = (a: unknown) => ((a as { doArm: { actions: Array<{ kind: string; ms?: number }> } }).doArm.actions.find((x) => x.kind === "delay")!.ms!);
      expect(ms(now.actions)).toBeGreaterThanOrEqual(ms(old.actions));
      expect(ms(now.actions)).toBeGreaterThanOrEqual(4500);
    } else expect(folded(now.actions)).toEqual(folded(old.actions));
    expect(now.root!.props?.keepCase).toBe(true);
    expect(now.cacheTtlSeconds).toEqual(old.cacheTtlSeconds);
  });

  it.each(IDS)("%s does everything it did: every action fired, binding and condition (flow_arm adds only its typing)", (id) => {
    const now = doing(build(id, true).root!), old = doing(build(id, false).root!).map(home);
    if (id !== "flow_arm") expect(now).toEqual(old);
    else {
      for (const x of old) expect(now, x).toContain(x);
      // What it adds is the typing alone: its letters and its touches, nothing that leaves, asks or arms.
      const added = now.filter((x) => !old.includes(x)).join("\n");
      expect(added).not.toMatch(/navigate|switchTab|armFlowSession|requestPermission|callEndpoint/);
    }
  });

  it("flow_arm says what to do next, over Keylessbord's keyboard, with \"Say it\" typed out a letter and a touch at a time", () => {
    const s = build("flow_arm", true);
    const json = JSON.stringify(s);
    expect(json).toContain("Switch to the app you want to write in");
    expect(json).toContain("Apple has a little trauma about microphones");
    // Each letter: its key touched, the letter in, the key let go.
    const steps = JSON.stringify(walk(s.root!).map((n) => n.on?.onAppear).filter(Boolean));
    for (const k of ["s", "a", "y", " ", "i", "t"]) expect(steps).toContain(`{"kind":"setState","path":"flowTouch","value":"${k}"}`);
    // No box for the words: each letter shows on its own key, and only while that key is touched.
    expect(json).not.toContain("flowTyped");
    for (const k of ["s", "a", "y", "i", "t"]) {
      const shown = walk(s.root!).find((n) => JSON.stringify(n.visibleIf) === JSON.stringify({ eq: ["flowTouch", k] }));
      expect(shown, k).toBeTruthy();
      expect(JSON.stringify(shown)).toContain(`"content":"${k.toUpperCase()}"`);
    }
  });

  it("flow_arm is on black, with a light status bar", () => {
    const s = build("flow_arm", true);
    expect(s.theme?.color?.bg).toBe("#000000");
    expect(s.root!.style?.backgroundColor).toBe("#000000");
    expect(s.root!.props?.barStyle).toBe("light-content");
  });

  it("flow_arm leaves by switching to Talk, the tab the app opens on: never Stats, never Home pushed over it", () => {
    const s = JSON.stringify(build("flow_arm", true));
    expect(s).not.toContain('"screenId":"stats"');
    expect(s).not.toContain('"screenId":"home"');
    expect(s).toContain('{"kind":"switchTab","tabId":"talk"}');
  });

  it("the mic and the field it writes into are the catalog's own nodes", () => {
    const pick = (s: ScreenResponse, t: string) => walk(s.root!).find((n) => n.type === t);
    for (const t of ["VoiceToggle", "TextField"]) expect(pick(build("keyboard_record", true), t)).toEqual(pick(build("keyboard_record", false), t));
  });

  it.each(IDS)("%s is drawn in the launch's look, in the kit, with no old chrome", (id) => {
    const s = build(id, true);
    expect(s.hideChrome).toBe(true);
    // flow_arm is on black (the next test); the other two on the cream.
    if (id !== "flow_arm") {
      expect(s.theme?.color?.bg).toBe(CREAM);
      expect(s.root!.style?.backgroundColor).toBe(CREAM);
    }
    const art = walk(s.root!).filter((n) => n.type === "Image").map((n) => (n.props?.source as { url: string }).url);
    // flow_arm draws Keylessbord's keyboard in the bot's place; the other two keep the icon's bot.
    expect(art).toEqual(id === "flow_arm" ? [] : [expect.stringMatching(/\/blip\/bots\/x0-hang\.png\?v=\d+$/)]);
    // The kit's rules, save the mic (a phone part the kit has no helper for).
    expect(lintTree(s.root!).filter((m) => m !== "type VoiceToggle")).toEqual([]);
  });

  it("any other app gets the screens exactly as before", () => {
    for (const id of IDS) expect(build(id, false)).toEqual(buildScreen(id, {
      personality: {}, language: "en", onboarded: true, email: "a@b.com", params: { session: "s-1", host: "Notes" },
    } as never));
  });
});
