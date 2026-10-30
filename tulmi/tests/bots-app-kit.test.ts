import { describe, expect, it } from "vitest";
import type { Node, SvgShape } from "../../shared/types/sdui.js";
import {
  blip, botAvatar, button, chips, deskPage, FACE, listCard, listRow, meter, page, percent, phonePage, usageMeter, whenWords, duration, segmented,
  statusMark, switchRow, tabGlyph, text, timeline, title, C,
} from "../src/experience/bots/kit.js";
import { ctxFor, sampleLive } from "../src/experience/bots/fixtures.js";
import { botLook } from "../src/experience/bots/palette.js";
import { lintTree as checkTree } from "../src/experience/bots/lint.js";

const shapesOf = (n: Node): SvgShape[] => (n.props?.shapes ?? []) as SvgShape[];

describe("the kit's text", () => {
  it("names a Geist face per weight and never sets a weight, so the phone does not fall back to the system font", () => {
    const t = text("Hi", { weight: 600, size: 15 });
    expect(t.style).toMatchObject({ fontFamily: FACE.semibold, fontWeight: "normal", fontSize: 15, margin: 0 });
    expect(text("x", { mono: true }).style?.fontFamily).toBe(FACE.mono);
    expect(title("Budget").style).toMatchObject({ fontSize: 26, fontFamily: FACE.bold, letterSpacing: -0.5 });
  });
  it("use and time read as people say them, and no money at all", () => {
    expect(percent(0.64)).toBe("64%");
    expect(percent(1.7)).toBe("100%");
    const IST = 330, now = Date.UTC(2026, 9, 28, 6, 0);
    expect(whenWords(Date.UTC(2026, 9, 29, 18, 30), now, IST)).toBe("Fri");
    expect(whenWords(Date.UTC(2026, 9, 29, 3, 30), now, IST)).toBe("Thu 9 am");
    expect(whenWords(Date.UTC(2026, 10, 7, 18, 30), now, IST)).toBe("Sun 8 Nov");
    const m = JSON.stringify(usageMeter("This stretch", 0.64, { resets: "Resets Thu 9 am" }));
    expect(m).toContain("64% used");
    expect(m).not.toMatch(/₹|paise/);
    expect(duration(45)).toBe("45 min");
    expect(duration(124)).toBe("2 h");
    expect(duration(80)).toBe("1 h 20 min");
  });
});

describe("status marks (STYLE.md)", () => {
  it("working breathes in the bot's colour; the others are ink shapes that do not move", () => {
    expect(shapesOf(statusMark("working", { color: "#4F7A3A" }))).toEqual([{ circle: [4, 4, 4], fill: "#4F7A3A", motion: "breathe" }]);
    expect(shapesOf(statusMark("needs"))[0]).toMatchObject({ fill: C.ink });
    expect(shapesOf(statusMark("done"))[0]).toMatchObject({ stroke: C.ink, strokeWidth: 1.5 });
    expect(shapesOf(statusMark("waiting"))[0]).toMatchObject({ dash: "1.7 1.7" });
    expect(shapesOf(statusMark("failed"))[0]!.d).toBe("M1 1l6 6M7 1L1 7");
    expect(shapesOf(statusMark("working", { color: "#4F7A3A", still: true }))[0]!.motion).toBeUndefined();
    expect(statusMark("needs").props?.accessibilityLabel).toBe("needs you");
  });
});

describe("the living tab icons", () => {
  const live = sampleLive().tab;
  it("Bots: open, the four bots pop in 60 ms apart in their colours; at rest only a working bot's dot has colour", () => {
    const open = shapesOf(tabGlyph("bots", true, live));
    expect(open.map((s) => s.fill)).toEqual(["#4F7A3A", "#A9573A", "#8F6A1F", "#3E6E8E"]);
    expect(open.map((s) => s.delayMs ?? 0)).toEqual([0, 60, 120, 180]);
    expect(open.every((s) => s.motion === "pop")).toBe(true);
    const rest = shapesOf(tabGlyph("bots", false, live));
    expect(rest[0]).toMatchObject({ fill: "#4F7A3A", motion: "breathe" });
    expect(rest.slice(1).every((s) => s.stroke === "#8a8a8a" && !s.fill)).toBe(true);
  });
  it("Activity: the black bead is the badge, the working bead breathes, done is a ring", () => {
    const rest = shapesOf(tabGlyph("activity", false, live));
    expect(rest[1]).toMatchObject({ circle: [6, 5, 3], fill: C.ink });
    expect(rest[2]).toMatchObject({ fill: "#4F7A3A", motion: "breathe" });
    expect(rest[3]).toMatchObject({ fill: "#ffffff", stroke: "#8a8a8a" });
    const calm = shapesOf(tabGlyph("activity", false, { ...live, needs: 0, workingColor: undefined }));
    expect(calm.slice(1, 4).every((s) => s.fill === "#ffffff")).toBe(true);
    expect(shapesOf(tabGlyph("activity", true, live))[1]!.motion).toBe("pop");
  });
  it("You: the ring is how much of this stretch is used, drawn when the tab opens; at the limit it closes", () => {
    const rest = shapesOf(tabGlyph("you", false, { ...live, used: 184 / 500 }));
    expect(rest[1]).toMatchObject({ dash: "20.8 56.55", rotate: -90, stroke: "#8a8a8a" });
    expect(rest[1]!.motion).toBeUndefined();
    expect(shapesOf(tabGlyph("you", true, { ...live, used: 184 / 500 }))[1]).toMatchObject({ motion: "draw", stroke: C.ink });
    expect(shapesOf(tabGlyph("you", false, { ...live, used: 3 }))[1]!.dash).toBe("56.5 56.55");
    expect(shapesOf(tabGlyph("you", false, { ...live, used: 0 }))).toHaveLength(2);
  });
});

describe("bots and controls", () => {
  it("a built-in's avatar is its Blip head on the surface grey; a person's own is its colour with a white icon", () => {
    const head = botAvatar(botLook("code"), 30);
    expect(head.style).toMatchObject({ width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface });
    expect((head.children![0]!.props!.source as { url: string }).url).toMatch(/\/blip\/bots\/head-code\.png\?v=\d+$/);
    const own = botAvatar(botLook("gym-bot", "pine"), 30);
    expect(own.style?.backgroundColor).toBe("#2F5D50");
    expect(own.children![0]!.props).toMatchObject({ stroke: "#ffffff", d: expect.stringContaining("M6.5 8v8") });
  });
  it("Blip moves: each pose is its animated loop, as tall as asked and as wide as the loop", () => {
    const urlOf = (n: Node) => (n.children![0]!.props!.source as { url: string }).url;
    expect(urlOf(blip("hello", 140))).toMatch(/\/blip\/wave-l\.webp\?v=\d+$/);
    expect(urlOf(blip("listen", 120))).toMatch(/\/blip\/listen-s\.webp\?v=\d+$/);
    expect(urlOf(blip("think", 120))).toMatch(/\/blip\/think-s\.webp\?v=\d+$/);
    expect(urlOf(blip("needs", 84))).toMatch(/\/blip\/present-s\.webp\?v=\d+$/);
    expect(urlOf(blip("done", 120))).toMatch(/\/blip\/tada-s\.webp\?v=\d+$/);
    expect(urlOf(blip("done", 190))).toMatch(/\/blip\/tada-l\.webp\?v=\d+$/);
    expect(blip("think", 115).style).toMatchObject({ width: 106, height: 115 });
    expect(blip("hello", 159).style).toMatchObject({ width: 121, height: 159 });
  });
  it("buttons: the primary is the ink pill, a disabled one cannot be pressed", () => {
    const p = button("Go", { kind: "navigateBack" });
    expect(p.style).toMatchObject({ height: 54, borderRadius: 27, backgroundColor: C.ink });
    expect(p.on?.onPress).toEqual({ kind: "navigateBack" });
    expect(button("Go", { kind: "navigateBack" }, { kind: "secondary", size: "md" }).style).toMatchObject({ height: 44, borderWidth: 1, borderColor: C.outline });
    expect(button("Go", { kind: "navigateBack" }, { kind: "disabled" }).on).toBeUndefined();
  });
  it("chips and the segmented control follow their state path on both clients", () => {
    const seg = segmented([{ label: "Auto", value: "auto" }, { label: "Ask", value: "ask" }], "visuals");
    expect(seg.children![0]!.style!.backgroundColor).toEqual({ eq: ["visuals", "auto"], then: C.paper, else: "transparent" });
    expect(seg.children![1]!.on!.onPress).toEqual({ kind: "setState", path: "visuals", value: "ask" });
    const c = chips([{ label: "Hindi", value: "hi" }], "lang", { onChange: { kind: "refresh" } });
    expect(c.children![0]!.on!.onPress).toEqual({ kind: "sequence", actions: [{ kind: "setState", path: "lang", value: "hi" }, { kind: "refresh" }] });
  });
  it("a switch row toggles the whole row, then saves", () => {
    const r = switchRow("Show me the plan first", "planFirst", { onChange: { kind: "refresh" } });
    expect(r.on!.onPress).toEqual({ kind: "sequence", actions: [{ kind: "toggleState", path: "planFirst" }, { kind: "refresh" }] });
    expect(checkTree(listCard([r, listRow({ label: "Visuals", value: "Auto" })]))).toEqual([]);
  });
  it("a meter and a timeline", () => {
    const m = meter(420, 3000, { label: "This stretch", valueText: "14% used" });
    expect(m.children![1]!.children![0]!.style!.width).toBe("14.0%");
    const t = timeline([{ mark: "needs", title: "Plan Ease needs you" }, { mark: "working", color: "#4F7A3A", title: "Checkout redesign" }]);
    expect(t.children).toHaveLength(2);
    expect(checkTree(t)).toEqual([]);
  });
});

describe("the frames", () => {
  const live = sampleLive();
  it("a phone page: safe-area aware, dark status bar, a scrolling body, the tab bar last", () => {
    const s = phonePage(ctxFor("bots.x", "phone", live), { tab: "you", body: [text("Hi")] });
    expect(s).toMatchObject({ hideChrome: true, look: "bots", screenId: "bots.x", cacheTtlSeconds: 1 });
    expect(s.root).toMatchObject({ type: "SafeArea", props: { edges: ["top"], barStyle: "dark-content" } });
    const kids = s.root!.children!;
    expect(kids[0]!.type).toBe("Screen");
    expect(kids.at(-1)).toMatchObject({ type: "SafeArea", props: { edges: ["bottom"], inset: "max" } });
    const tabs = kids.at(-1)!.children!;
    expect(tabs.map((t) => t.on?.onPress ?? null)).toEqual([{ kind: "switchTab", tabId: "bots" }, { kind: "switchTab", tabId: "activity" }, null]);
    expect(checkTree(s.root!)).toEqual([]);
  });
  it("a phone page's footer (the ask bar, a composer) stays above the keyboard; the window has none to clear", () => {
    const field: Node = { type: "TextField", id: "ask", bind: { value: "ask" } };
    const phone = phonePage(ctxFor("bots.x", "phone", live), { tab: "bots", body: [text("Hi")], footer: [field] });
    const footer = phone.root!.children!.find((c) => c.children?.includes(field))!;
    expect(footer).toMatchObject({ type: "Stack", props: { keyboard: "above" } });
    expect(phone.root!.children!.at(-1)).toMatchObject({ type: "SafeArea", props: { edges: ["bottom"] } });
    expect(checkTree(phone.root!)).toEqual([]);
    const desk = deskPage(ctxFor("bots.x", "desktop", live), { tab: "bots", body: [text("Hi")], footer: [field] });
    expect(JSON.stringify(desk)).not.toContain('"keyboard"');
  });
  it("a pushed phone page has a back bar and no tab bar", () => {
    const s = phonePage(ctxFor("bots.x", "phone", live), { back: true, backTitle: "Budget", body: [text("Hi")] });
    expect(JSON.stringify(s)).toContain('"kind":"navigateBack"');
    expect(s.root!.children!.some((c) => c.props?.edges && (c.props.edges as string[]).includes("bottom"))).toBe(false);
  });
  it("a window page: the sidebar (the three tabs, your bots, the desk's pages) and a main column", () => {
    const s = deskPage(ctxFor("bots.x", "desktop", live), { tab: "activity", body: [text("Hi")] });
    const [side, main] = s.root!.children!;
    expect(side!.style).toMatchObject({ width: 240, borderRightWidth: 1 });
    const words = JSON.stringify(side);
    for (const w of ["Bots", "Activity", "You", "Your bots", "Xode", "Gym bot", "Make a bot", "Today", "Notes", "This computer helps", "Settings"]) expect(words).toContain(w);
    expect(words).toContain('"screenId":"desk_settings"');
    expect(main!.style).toMatchObject({ overflowY: "auto", flexGrow: 1 });
    expect(checkTree(s.root!)).toEqual([]);
    // Without the desk's pages there is no Today, and Settings is the app's own.
    const plain = JSON.stringify(deskPage(ctxFor("bots.x", "desktop", live, { desk: { pages: false, notes: false } }), { body: [] }).root);
    expect(plain).not.toContain('"screenId":"bots.notes"');
    expect(plain).toContain('"screenId":"settings"');
  });
  it("page() picks the frame by the client", () => {
    expect(page(ctxFor("bots.x", "phone", live), { body: [] }).root!.type).toBe("SafeArea");
    expect(page(ctxFor("bots.x", "desktop", live), { body: [] }).root!.type).toBe("Stack");
  });
});
