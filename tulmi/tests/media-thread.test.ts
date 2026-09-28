import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { buildBootstrap, buildScreen, setMediaRegistryAccessor } from "../src/experience/catalog.js";

// The onboarding films and the You-tab posters are registry entries, not
// code: upload to the key and the slot shows it, on the phone and, with a
// ".desktop" twin, in the window. These hold each slot to that.

const entry = (url: string, contentType: string, present?: Record<string, unknown>) =>
  ({ url, contentType, size: 1, uploadedAt: 1, ...(present ? { present } : {}) });
const reg = (r: Record<string, ReturnType<typeof entry>>) => setMediaRegistryAccessor(() => r);
afterEach(() => reg({}));

const find = (n: any, pred: (o: any) => boolean, out: any[] = []): any[] => {
  if (!n) return out;
  if (pred(n)) out.push(n);
  for (const c of n.children ?? []) find(c, pred, out);
  if (n.fallback) find(n.fallback, pred, out);
  return out;
};
const screen = (id: string, ctx: Record<string, unknown> = {}) =>
  buildScreen(id, { personality: {}, language: "en", onboarded: true, params: {}, ...ctx } as never) as any;
const withUrl = (root: any, url: string) => find(root, (o) => (o.type === "Image" || o.type === "Video") && o.props?.source?.url === url);

describe("the You tab's posters", () => {
  it("the voice card wears its voice's poster, else the set's, else nothing", () => {
    expect(withUrl(screen("personality").root, "x").length).toBe(0);
    reg({ "you.voice.signature": entry("https://m/zu.png", "image/png"), "you.voice": entry("https://m/any.png", "image/png") });
    expect(withUrl(screen("personality").root, "https://m/zu.png").length).toBe(1);
    expect(withUrl(screen("personality", { personality: { activePresetId: "pirate" } }).root, "https://m/any.png").length).toBe(1);
  });

  it("dictionary and languages are cards of the voice card's size, with posters of their own", () => {
    const cards = (root: any) => find(root, (o) => o.type === "Stack" && o.style?.borderRadius === 22 && o.style?.height === 220);
    expect(cards(screen("personality").root).length).toBe(4);
    reg({ "you.dictionary": entry("https://m/dict.png", "image/png"), "you.languages": entry("https://m/lang.png", "image/png") });
    const root = screen("personality").root;
    expect(withUrl(root, "https://m/dict.png").length).toBe(1);
    expect(withUrl(root, "https://m/lang.png").length).toBe(1);
  });

  it("the voice card and the training card are one height, poster or not", () => {
    const voiceOf = (root: any) => find(root, (o) => o.type === "Stack" && o.style?.borderRadius === 22 && JSON.stringify(o.on ?? {}).includes('"voices"'))[0];
    const trainOf = (root: any) => find(root, (o) => o.type === "Stack" && o.style?.borderRadius === 22 && !o.on && o.style?.backgroundColor === "#000000")[0];
    const bare = screen("personality").root;
    expect(voiceOf(bare).style.height).toBe(trainOf(bare).style.height);
    reg({ "you.voice.signature": entry("https://m/zu.png", "image/png") });
    const dressed = screen("personality").root;
    expect(voiceOf(dressed).style.height).toBe(trainOf(dressed).style.height);
  });

  it("a clip at you.train replaces the live field, muted and looping, with a still behind it", () => {
    const before = screen("personality").root;
    expect(find(before, (o) => o.type === "NeuralField").length).toBe(1);
    reg({ "you.train": entry("https://m/train.mp4", "video/mp4") });
    const root = screen("personality").root;
    expect(find(root, (o) => o.type === "NeuralField").length).toBe(0);
    const v = find(root, (o) => o.type === "Video")[0];
    expect(v.props).toMatchObject({ autoplay: true, loop: true, muted: true });
    expect(v.fallback.type).toBe("Image");
  });
});

describe("the onboarding films", () => {
  it("the keyboard film carries the title: the heading steps aside only where there is a film", () => {
    const heading = (root: any) => find(root, (o) => o.type === "Heading" && o.props?.content === "Bring it everywhere.");
    expect(heading(screen("onboarding_keyboard").root)[0].visibleIf).toBeUndefined();
    reg({ "hero.onboarding_keyboard.card": entry("https://m/keys-ios.mp4", "video/mp4") });
    expect(heading(screen("onboarding_keyboard").root)[0].visibleIf).toEqual({ platform: "android" });
    reg({ "hero.onboarding_keyboard.card": entry("https://m/keys-ios.mp4", "video/mp4"), "hero.onboarding_keyboard.card.android": entry("https://m/keys-android.mp4", "video/mp4") });
    expect(heading(screen("onboarding_keyboard").root).length).toBe(0);
  });

  it("the keyboard step gets a hero per device, each shown only to its own", () => {
    expect(find(screen("onboarding_keyboard").root, (o) => o.type === "Video").length).toBe(0);
    reg({ "hero.onboarding_keyboard.card": entry("https://m/keys-ios.mp4", "video/mp4"), "hero.onboarding_keyboard.card.android": entry("https://m/keys-android.mp4", "video/mp4") });
    const root = screen("onboarding_keyboard").root;
    const holder = (url: string) => find(root, (o) => (o.children ?? []).some((c: any) => c.type === "Video" && c.props?.source?.url === url))[0];
    expect(holder("https://m/keys-ios.mp4").visibleIf).toEqual({ platform: "ios" });
    expect(holder("https://m/keys-android.mp4").visibleIf).toEqual({ platform: "android" });
  });

  it("the mic step's card takes its size from the upload", () => {
    reg({ "onboarding.hero": entry("https://m/mic.mp4", "video/mp4", { shape: "card", boxWidth: 300, aspectRatio: 1, radius: 32 }) });
    const box = find(screen("onboarding").root, (o) => o.type === "Stack" && (o.children ?? []).some((c: any) => c.type === "Video"))[0];
    expect(box.style).toMatchObject({ width: 300, aspectRatio: 1, borderRadius: 32, alignSelf: "center" });
    expect(box.style.height).toBeUndefined();
  });

  it("the opening is the splash film under intro, on every device, and the seed never touches it", () => {
    reg({ intro: entry("https://m/splash.mp4", "video/mp4"), "intro.desktop": entry("https://m/other.mp4", "video/mp4") });
    expect(withUrl(screen("intro", { formFactor: "desktop" }).root, "https://m/splash.mp4").length).toBeGreaterThan(0);
    expect(withUrl(screen("intro").root, "https://m/splash.mp4").length).toBeGreaterThan(0);
    expect((buildBootstrap({ onboarded: true, formFactor: "desktop" }).flags as any)["intro.media"]).toEqual({ url: "https://m/splash.mp4" });
    const seed = JSON.parse(fs.readFileSync(new URL("../media-seed/manifest.json", import.meta.url), "utf8")) as Array<{ key: string }>;
    expect(seed.filter((e) => /^intro/.test(e.key) || /^mic\.animation/.test(e.key))).toEqual([]);
  });
});
