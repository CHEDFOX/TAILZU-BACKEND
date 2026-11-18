/**
 * THE ASK BAR'S INSERT KEY (experience/bots/ask.ts):
 *
 *   - a round + in its OWN circle to the left of the type box, with a gap — not another thing inside the box
 *   - it blurs the page and pops a small card with the ways in: a photo, the camera, a file, a screenshot, the clipboard
 *   - the card has a way out, because a card you opened and cannot close is a trap
 *   - a picked file rides with the words: the ask carries `attachments`, which is the door's own field
 *   - the camera is the phone's; the window has no camera to open
 *   - a build that cannot upload gets the bar exactly as it was, with no key at all
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { askBar, ASK_BAR_STATE } = await import("../src/experience/bots/ask.js");
const { ctxFor, sampleLive, fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { ICONS } = await import("../src/experience/bots/glyphs.js");

type Ctx = ReturnType<typeof ctxFor>;
const ME = "00000000-0000-4000-8000-00000000aaaa";
const CAN = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "KitExtras", "VoiceLive", "DoubleTap", "BotPeek", "FileUpload"];
const NO_UPLOAD = CAN.filter((c) => c !== "FileUpload");

const ctx = (client: "phone" | "desktop" = "phone", can: string[] = CAN): Ctx =>
  ctxFor(SCREENS.home, client, sampleLive(), { can: new Set(can) });
const req = (client: "phone" | "desktop" = "phone", can: string[] = CAN) => ({
  screenId: SCREENS.home, client, tzOffsetMinutes: 330, user: { id: ME, name: "Aanya" },
  can: new Set(can), desk: { pages: client === "desktop", notes: client === "desktop" },
});
const bar = (client: "phone" | "desktop" = "phone", can: string[] = CAN) => walk(askBar(client, { ctx: ctx(client, can) }));
const texts = (ns: ReturnType<typeof walk>) => ns.filter((n) => n.type === "Text").map((n) => n.props?.content);

describe("the key", () => {
  it("is a + in a circle of its own, outside the box", () => {
    const ns = bar();
    const plus = ns.find((n) => n.type === "SVG" && n.props?.d === ICONS.plus);
    expect(plus).toBeTruthy();
    // its circle: round, bordered, and not the box (the box has the field in it)
    const circle = ns.find((n) => n.style?.borderRadius === 23 && n.style?.width === 46 && n.style?.height === 46);
    expect(circle).toBeTruthy();
    expect(circle!.on?.onPress).toBeTruthy();
  });
  it("and the row that holds the key and the box leaves a gap between them", () => {
    const row = bar().find((n) => n.style?.gap === 10 && (n.children ?? []).some((c) => c.style?.borderRadius === 23));
    expect(row).toBeTruthy();
  });
  it("a build that cannot upload gets no key, and the bar it always had", () => {
    const ns = bar("phone", NO_UPLOAD);
    expect(ns.some((n) => n.type === "SVG" && n.props?.d === ICONS.plus)).toBe(false);
    expect(ns.some((n) => n.type === "TextField")).toBe(true);
    expect(ns.some((n) => n.type === "BotCard")).toBe(false);
  });
});

describe("the card", () => {
  it("blurs the page: it is an overlay, which is a real modal", () => {
    const card = bar().find((n) => n.type === "BotCard")!;
    expect(card.props!.overlay).toBe(true);
  });
  it("holds every way in", () => {
    expect(texts(bar())).toEqual(expect.arrayContaining(["Photo", "Camera", "File", "Screenshot", "Paste"]));
  });
  it("the camera is the phone's: the window has none to open", () => {
    expect(texts(bar("desktop"))).not.toContain("Camera");
    expect(texts(bar("desktop"))).toEqual(expect.arrayContaining(["Photo", "File", "Screenshot", "Paste"]));
  });
  it("HAS A WAY OUT, which is what draws its × and takes a swipe away", () => {
    const card = bar().find((n) => n.type === "BotCard")!;
    expect(card.on?.onDismiss).toEqual({ kind: "setState", path: "insert", value: false });  // botCard maps onLeave to it
  });
  it("each way in shuts the card FIRST, so the picker opens over the page and not under the card", () => {
    const photo = bar().find((n) => n.on?.onPress && JSON.stringify(n.on.onPress).includes('"pick":"photo"'));
    const acts = (photo!.on!.onPress as any).actions as any[];
    expect(acts[0]).toEqual({ kind: "setState", path: "insert", value: false });
    expect(acts[1].kind).toBe("uploadFile");
  });
  it("the camera is a pick of its own, not a photo from the library", () => {
    expect(JSON.stringify(bar())).toContain('"pick":"camera"');
  });
  it("a picked file lands where the ask reads it", () => {
    const up = JSON.stringify(bar().find((n) => JSON.stringify(n.on?.onPress ?? {}).includes('"pick":"photo"'))!.on!.onPress);
    expect(up).toContain('"path":"attach"');
    expect(up).toContain("/v1/files");
  });
});

describe("what the ask carries", () => {
  it("the files ride with the words, in the door's own field", () => {
    const send = JSON.stringify(bar().find((n) => n.type === "TextField")!.on!.onSubmit);
    expect(send).toContain('"attachments":"$state.attach"');
  });
  it("and a build with no upload sends no attachments at all", () => {
    const send = JSON.stringify(bar("phone", NO_UPLOAD).find((n) => n.type === "TextField")!.on!.onSubmit);
    expect(send).not.toContain("attachments");
  });
  it("once it is sent, the file comes off the ask: the next one starts empty", () => {
    const send = JSON.stringify(bar().find((n) => n.type === "TextField")!.on!.onSubmit);
    expect(send).toContain('{"kind":"clearState","path":"attach"}');
  });
  it("the screen starts with the card shut and nothing attached", () => {
    expect(ASK_BAR_STATE).toEqual({ insert: false, attach: [], up: null, sent: null });
  });
});

describe("on the real screen", () => {
  it("Home's bar has the key, and Home still lints clean with a modal card on it", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    const all = walk(s.root!);
    expect(all.some((n) => n.type === "SVG" && n.props?.d === ICONS.plus)).toBe(true);
    expect(all.filter((n) => n.type === "BotCard").length).toBe(1);
    expect(lintTree(s.root!, { client: "phone" })).toEqual([]);
    expect(s.state).toMatchObject({ insert: false, attach: [] });
  });
  it("and a build that cannot upload draws no card on Home", async () => {
    const s = await buildBotsScreen(req("phone", NO_UPLOAD), fakeDeps({}));
    expect(walk(s.root!).some((n) => n.type === "BotCard")).toBe(false);
    expect(lintTree(s.root!, { client: "phone" })).toEqual([]);
  });
});
