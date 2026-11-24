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

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true";
  // The insert key is an attach, so it needs MEDIA_INGEST as well as FileUpload (experience/bots/media.ts canUpload).
  process.env.MEDIA_INGEST = "true"; });

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
  it("HAS A VISIBLE WAY OUT, drawn by the server: the apps draw none, and an iPhone has no hardware back", () => {
    const card = bar().find((n) => n.type === "BotCard")!;
    const back = (card.children ?? [])[0]!;
    const press = JSON.stringify(back.on?.onPress ?? walk(back).find((n) => n.on?.onPress)?.on?.onPress);
    expect(press).toContain('"path":"insert"');
    expect(walk(back).some((n) => n.type === "SVG" && n.props?.d === ICONS.back)).toBe(true);
  });
  it("and the gestures too, which is all onDismiss is for now", () => {
    const card = bar().find((n) => n.type === "BotCard")!;
    expect(card.on?.onDismiss).toEqual({ kind: "setState", path: "insert", value: false });  // botCard maps onLeave to it
  });
  it("a pick shuts the card once the file is up, as an attach menu does — and not before", () => {
    const photo = bar().find((n) => n.on?.onPress && JSON.stringify(n.on.onPress).includes('"pick":"photo"'))!;
    const act = photo.on!.onPress as any;
    const inner = act.kind === "sequence" ? act.actions : [act];
    // Not as the picker opens: a cancelled pick leaves the card where it was.
    expect(inner.some((a: any) => a?.kind === "setState" && a.path === "insert")).toBe(false);
    const upload = inner.find((a: any) => a?.kind === "uploadFile");
    expect(upload).toBeTruthy();
    // Once the file is on the ask: the card goes, and the bar shows the file ready to send.
    expect(JSON.stringify(upload.onSuccess)).toContain('{"kind":"setState","path":"insert","value":false}');
    expect(JSON.stringify(upload.onError)).not.toContain('"path":"insert"');
  });
  it("pasting DOES shut it: there is nothing to come back to", () => {
    const paste = bar().find((n) => JSON.stringify(n.on?.onPress ?? {}).includes("readClipboard"))!;
    const acts = (paste.on!.onPress as any).actions as any[];
    expect(acts[0]).toEqual({ kind: "setState", path: "insert", value: false });
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
    expect(ASK_BAR_STATE).toEqual({ insert: false, attach: [], shots: [], up: null, sent: null });
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

describe("the card grows with what you chose", () => {
  it("every pick ADDS, up to the eight the ask door takes — it does not replace the one before", () => {
    const up = bar().find((n) => JSON.stringify(n.on?.onPress ?? {}).includes('"pick":"photo"'))!.on!.onPress as any;
    const ok = (up.kind === "sequence" ? up.actions : [up]).find((a: any) => a.kind === "uploadFile").onSuccess.actions;
    const adds = ok.filter((a: any) => a.kind === "appendState");
    expect(adds.map((a: any) => a.path)).toEqual(["attach", "shots"]);
    for (const a of adds) expect(a.max).toBe(8);
    expect(ok.some((a: any) => a.kind === "clearState" && a.path === "attach")).toBe(false);
  });
  it("the ref goes where the ask reads it, and the picture where the card draws it", () => {
    const up = bar().find((n) => JSON.stringify(n.on?.onPress ?? {}).includes('"pick":"photo"'))!.on!.onPress as any;
    const ok = (up.kind === "sequence" ? up.actions : [up]).find((a: any) => a.kind === "uploadFile").onSuccess.actions;
    expect(ok.find((a: any) => a.path === "attach").value).toBe("$state.sent.attachment");
    expect(ok.find((a: any) => a.path === "shots").value).toBe("$state.sent.pic");
  });
  /**
   * A PICTURE PER FILE, IN BOTH PLACES: in the card where it was chosen, and above the bar where it is typed. The
   * bar's set is the fix for a composer that looked empty the moment the card shut — the file was on the ask and
   * on its way, and nothing outside the card said so.
   */
  it("A PICTURE PER FILE, its source bound to the copy still on the phone", () => {
    const imgs = bar().filter((n) => n.type === "Image");
    expect(imgs.length, "eight in the card, eight above the bar").toBe(16);
    expect(imgs.map((n) => (n.bind as any).source)).toEqual(Array.from({ length: 2 }, () => Array.from({ length: 8 }, (_, i) => `shots.${i}`)).flat());
    for (const n of imgs) expect(n.props!.contentFit).toBe("cover");
  });
  it("each one is drawn only once there is a file in its place, so neither grows past what is on the ask", () => {
    const slots = bar().filter((n) => (n.children ?? []).some((c) => c.type === "Image"));
    expect(slots.length).toBe(16);
    expect(slots.map((n) => n.visibleIf)).toEqual(Array.from({ length: 2 }, () => Array.from({ length: 8 }, (_, i) => ({ truthy: `attach.${i}` }))).flat());
  });

  /** And the strip above the bar is there at all, with a cross on each file that takes THAT one off. */
  it("shows what is on the ask above the bar, each file with its own cross", () => {
    const any = { any: Array.from({ length: 8 }, (_, i) => ({ truthy: `attach.${i}` })) };
    const strip = bar().find((n) => JSON.stringify(n.visibleIf ?? {}) === JSON.stringify(any) && n.type === "Stack" && (n.style as any)?.flexDirection === "row");
    expect(strip, "a strip shown while anything is on the ask").toBeTruthy();
    const crosses = walk(strip!).filter((n) => n.props?.accessibilityLabel === "Remove this file");
    expect(crosses.length).toBe(8);
    // Each takes off its own file: the ref and its picture, at the same place in both lists.
    crosses.forEach((n, i) => {
      const p = JSON.stringify(n.on!.onPress);
      expect(p).toContain(`"path":"attach.${i}"`);
      expect(p).toContain(`"path":"shots.${i}"`);
    });
  });
  it("a file with no picture still shows something: its kind's glyph, under the image that draws nothing", () => {
    const box = bar().find((n) => n.visibleIf && JSON.stringify(n.visibleIf) === JSON.stringify({ truthy: "attach.0" }) && (n.children ?? []).some((c) => c.type === "Image"))!;
    expect((box.children ?? []).some((c) => c.type === "SVG" && c.props?.d === ICONS.clip)).toBe(true);
  });
  it("Clear takes them all off, both lists together, so they can never get out of step", () => {
    const press = (n: { on?: Record<string, unknown> }) => JSON.stringify(n.on?.onPress ?? {});
    const clear = bar().find((n) => press(n).includes('"path":"attach"') && press(n).includes('"path":"shots"'));
    expect(clear).toBeTruthy();
    // and nothing else clears one without the other
    for (const n of bar()) {
      const p = press(n);
      if (p.includes('"clearState","path":"shots"')) expect(p).toContain('"path":"attach"');
    }
  });
  it("the strip only exists once something is on the ask", () => {
    const label = bar().find((n) => n.type === "Text" && n.props?.content === "On the ask");
    expect(label).toBeTruthy();
    const strip = bar().find((n) => JSON.stringify(n.visibleIf ?? {}) === JSON.stringify({ truthy: "attach.0" }) && (n.children ?? []).length === 2);
    expect(strip).toBeTruthy();
  });
  it("the screen starts with both lists empty", () => {
    expect(ASK_BAR_STATE).toEqual({ insert: false, attach: [], shots: [], up: null, sent: null });
  });
});
