import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

// THE ONE KEY on the window's pages (keybot.ts, firstRun.ts; the desktop's oneKey.js puts it in `desktop` state):
//   - this computer's keys are one line, the key main.js bound (desktop.holdKey), never the old list of three
//   - Keybot's settings offer a Mac's three keys and a PC's two, saved with desktop.config oneKey, only on a window that has it
//   - the clay key sits where the chosen key is on the keyboard
//   - the arrival card's last step names the key
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.BOTS_APP = "true";

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { AX_STATE } = await import("../src/experience/bots/screens/firstRun.js");

const build = (screenId: string, can: string[] = [], api: Record<string, unknown> = {}) =>
  buildBotsScreen({
    screenId, client: "desktop", params: {}, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" },
    can: new Set(["BotsKit", ...can]), desk: { pages: true, notes: false },
  }, fakeDeps({ api }));
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const bound = (n: Node, path: string) => walk(n).filter((x) => x.type === "Text" && (x.bind as { content?: string } | undefined)?.content === path);
/** The node shown only under `cond`, found by what it says. */
const shownWhen = (n: Node, cond: unknown) => walk(n).filter((x) => JSON.stringify(x.visibleIf) === JSON.stringify(cond));

describe("Keybot's pages: one key", () => {
  it("this computer's keys are one line: the held key by name, or a window's chord before the one key", async () => {
    for (const id of ["bots.keybot", "bots.keybot.settings"]) {
      const s = await build(id);
      const t = texts(s.root!);
      expect(t, id).not.toContain("Start or stop talking");
      expect(t, id).not.toContain("Meeting notes");
      expect(t, id).not.toContain("Hold to speak");
      const held = shownWhen(s.root!, { truthy: "desktop.hold" }).find((x) => texts(x).includes("Hold to talk, tap to keep listening"));
      expect(held, id).toBeTruthy();
      expect(bound(held!, "desktop.holdKey").length, id).toBe(1);
      const pressed = shownWhen(s.root!, { falsy: "desktop.hold" }).find((x) => texts(x).includes("Press to talk"));
      expect(bound(pressed!, "desktop.hotkey").length, id).toBe(1);
      expect(lintTree(s.root!), id).toEqual([]);
    }
  });

  it("settings offers the keys this system has, each saved as the one key, only where the window has it", async () => {
    const s = await build("bots.keybot.settings");
    const j = JSON.stringify(s);
    const choose = '{"kind":"desktop.config","key":"oneKey","value":"$state.desktop.oneKey"}';
    expect(j).toContain(choose);
    const mac = shownWhen(s.root!, { all: [{ truthy: "desktop.oneKey" }, { eq: ["desktop.os", "mac"] }] })[0]!;
    const pc = shownWhen(s.root!, { all: [{ truthy: "desktop.oneKey" }, { eq: ["desktop.os", "windows"] }] })[0]!;
    expect(texts(mac)).toEqual(["Fn", "Right ⌥", "Right ⌘"]);
    expect(texts(pc)).toEqual(["Right Ctrl", "Right Alt"]);
    for (const v of ["fn", "rightOption", "rightCommand"]) expect(JSON.stringify(mac)).toContain(`{"kind":"setState","path":"desktop.oneKey","value":"${v}"}`);
    for (const v of ["rightCtrl", "rightAlt"]) expect(JSON.stringify(pc)).toContain(`{"kind":"setState","path":"desktop.oneKey","value":"${v}"}`);
    // A key it could not bind is said; Fn's emoji setting is named for a Mac on Fn.
    expect(texts(shownWhen(s.root!, { all: [{ truthy: "desktop.oneKey" }, { falsy: "desktop.oneKeyOn" }] })[0]!).join(" ")).toMatch(/can't be used/);
    expect(texts(shownWhen(s.root!, { eq: ["desktop.oneKey", "fn"] })[0]!).join(" ")).toMatch(/Do Nothing/);
    // The tap switch says one tap with the one key, two without; the old "change these keys" row only without.
    expect(texts(shownWhen(s.root!, { truthy: "desktop.oneKey" }).find((x) => texts(x).includes("Tap to keep listening"))!)).toBeTruthy();
    expect(shownWhen(s.root!, { falsy: "desktop.oneKey" }).some((x) => texts(x).includes("Tap twice to keep listening"))).toBe(true);
    expect(shownWhen(s.root!, { falsy: "desktop.oneKey" }).some((x) => texts(x).includes("Change these keys in Settings."))).toBe(true);
    expect(j).toContain('"kind":"desktop.config","key":"tap","value":"$toggle"');
  });

  it("the clay key is where the chosen key is, named as bound", async () => {
    const s = await build("bots.keybot.settings");
    const clayAt = (cond: unknown) => {
      const r = shownWhen(s.root!, cond)[0]!;
      const keys = r.children!;
      return keys.findIndex((k) => bound(k, "desktop.holdKey").length > 0);
    };
    expect(clayAt({ eq: ["desktop.oneKey", "rightCommand"] })).toBe(5);
    expect(clayAt({ eq: ["desktop.oneKey", "rightOption"] })).toBe(6);
    expect(clayAt({ eq: ["desktop.oneKey", "rightCtrl"] })).toBe(5);
    expect(clayAt({ eq: ["desktop.oneKey", "rightAlt"] })).toBe(4);
    expect(clayAt({ not: { in: ["desktop.oneKey", ["rightCommand", "rightOption", "rightCtrl", "rightAlt"]] } })).toBe(0);
  });

  it("the arrival card's last step names the key this computer holds", async () => {
    const s = await build("bots.home", ["BotsMotion", "DeskMicAsk", AX_STATE], { "GET /v1/shell/started": { started: true }, "GET /v1/bots/first-run/arrival": { due: true } });
    const done = walk(s.root!).find((x) => x.type === "Stack" && x.visibleIf && texts(x).includes("You're all set"))!;
    const held = shownWhen(done, { truthy: "desktop.hold" })[0]!;
    expect(texts(held)).toEqual(["Hold", "Fn", "to talk, in any app."]);
    expect(bound(held, "desktop.holdKey").length).toBe(1);
    expect(texts(shownWhen(done, { falsy: "desktop.hold" })[0]!)).toEqual(["Hold the clay key to speak, in any app."]);
  });
});
