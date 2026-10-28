import { describe, expect, it } from "vitest";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

// The window's arrival card and Keybot's card with this computer's Accessibility in the screen's state
// ($state.axGranted, written by a window that declares DeskAxState): the step goes on its own once it is on.
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

const ARRIVE = { "GET /v1/shell/started": { started: true }, "GET /v1/bots/first-run/arrival": { due: true } };
const MOTION = ["BotsMotion"];
const build = (screenId: string, can: string[], api: Record<string, unknown> = ARRIVE) =>
  buildBotsScreen({
    screenId, client: "desktop", tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya", email: "aanya@example.in" },
    can: new Set(["BotsKit", ...can]), desk: { pages: false, notes: false },
  }, fakeDeps({ api }));
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const cardOf = (n: Node) => walk(n).find((x) => x.type === "BotCard");
const stepOf = (n: Node, title: string) => walk(n).find((x) => x.type === "Stack" && x.visibleIf && texts(x).includes(title));
function actions(n: unknown, out: ActionSpec[] = []): ActionSpec[] {
  if (Array.isArray(n)) { n.forEach((x) => actions(x, out)); return out; }
  if (!n || typeof n !== "object") return out;
  const o = n as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o as unknown as ActionSpec);
  for (const v of Object.values(o)) if (v && typeof v === "object") actions(v, out);
  return out;
}

describe("the window's arrival card, with Accessibility in its state", () => {
  it("waits for both readings, shows Accessibility while it is off, and closes by itself once it is on", async () => {
    const s = await build("bots.home", [...MOTION, "DeskMicAsk", AX_STATE]);
    expect(s.state).toMatchObject({ micGranted: null, axGranted: null, micAsked: false, permitClosed: false });
    const card = cardOf(s.root!)!;
    expect(card.props).toMatchObject({
      overlay: true,
      readyWhen: { all: [{ neq: ["micGranted", null] }, { neq: ["axGranted", null] }] },
      doneWhen: { all: [{ any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] }, { truthy: "axGranted" }] },
    });
    const ax = stepOf(card, "Let Keybot type for you")!;
    expect(ax.visibleIf).toEqual({ all: [{ any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] }, { falsy: "axGranted" }] });
    // Its own button to the Mac's page (no Ask card in this window), and "Not now" instead of a Done to press.
    expect(actions(ax)).toEqual(expect.arrayContaining([{ kind: "ask.openAccessibility" }]));
    expect(texts(ax)).toContain("Not now");
    expect(texts(ax)).not.toContain("Done");
    expect(walk(ax).some((n) => n.type === "DeskAskSetup")).toBe(false);
    // Both on: the happy step, then the card's own close.
    expect(stepOf(card, "You're all set")!.visibleIf).toEqual(card.props?.doneWhen);
  });

  it("with Ask's card too: the row is the card's, and the step still goes once it is on", async () => {
    const s = await build("bots.home", [...MOTION, "DeskMicAsk", "DeskAskSetup", AX_STATE]);
    const ax = stepOf(cardOf(s.root!)!, "Let Keybot type for you")!;
    expect(walk(ax).find((n) => n.type === "DeskAskSetup")?.props).toMatchObject({ rows: [{ key: "read" }] });
    expect(actions(ax).some((a) => a.kind === "ask.openAccessibility")).toBe(false);
    expect(cardOf(s.root!)!.props?.doneWhen).toEqual({ all: [{ any: [{ truthy: "micGranted" }, { truthy: "micAsked" }] }, { truthy: "axGranted" }] });
  });

  it("Accessibility alone (no microphone to ask): ready on its reading, done once it is on", async () => {
    const s = await build("bots.home", [...MOTION, AX_STATE]);
    const card = cardOf(s.root!)!;
    expect(card.props).toMatchObject({ readyWhen: { neq: ["axGranted", null] }, doneWhen: { all: [{ truthy: "axGranted" }] } });
  });

  it("a window that cannot read it keeps today's card (Done to close)", async () => {
    const s = await build("bots.home", [...MOTION, "DeskMicAsk", "DeskAskSetup"]);
    const card = cardOf(s.root!)!;
    expect(card.props?.readyWhen).toEqual({ neq: ["micGranted", null] });
    expect(card.props?.doneWhen).toBeUndefined();
    expect(texts(stepOf(card, "Let Keybot type for you")!)).toContain("Done");
  });

  it("without the living tiles: a plain card, gone once it is all on", async () => {
    const s = await build("bots.home", ["DeskMicAsk", AX_STATE]);
    expect(cardOf(s.root!)).toBeUndefined();
    expect(texts(s.root!)).toContain("Let Keybot type for you");
    expect(lintTree(s.root!).filter((m) => !m.startsWith("type Desk"))).toEqual([]);
  });
});

describe("Keybot's page in a window that reads Accessibility", () => {
  it("shows the step only while it is off (declared on, so nothing flashes)", async () => {
    const s = await build("bots.keybot", [...MOTION, AX_STATE], {});
    expect(s.state).toMatchObject({ axGranted: true });
    const card = walk(s.root!).find((n) => n.type === "BotCard" && texts(n).includes("Let Keybot type for you"));
    expect(card?.visibleIf).toEqual({ falsy: "axGranted" });
    expect(actions(card)).toEqual(expect.arrayContaining([{ kind: "ask.openAccessibility" }]));
    // With Ask's card, that card carries it, as before.
    const ask = await build("bots.keybot", [...MOTION, AX_STATE, "DeskAskSetup"], {});
    expect(walk(ask.root!).filter((n) => texts(n).includes("Let Keybot type for you") && n.type === "BotCard")).toHaveLength(0);
    expect(walk(ask.root!).some((n) => n.type === "DeskAskSetup")).toBe(true);
  });
});
