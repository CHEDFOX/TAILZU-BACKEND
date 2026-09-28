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

  it("a voice card wearing a poster grows to give the sentence its band", () => {
    const cardOf = (root: any) => find(root, (o) => o.type === "Stack" && o.style?.borderRadius === 22 && JSON.stringify(o.on ?? {}).includes('"voices"'))[0];
    expect(cardOf(screen("personality").root).style.height).toBe(168);
    reg({ "you.voice.signature": entry("https://m/zu.png", "image/png") });
    expect(cardOf(screen("personality").root).style.height).toBe(220);
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
  it("the keyboard step gets a hero of its own at hero.onboarding_keyboard", () => {
    expect(find(screen("onboarding_keyboard").root, (o) => o.type === "Video").length).toBe(0);
    reg({ "hero.onboarding_keyboard": entry("https://m/keys.mp4", "video/mp4") });
    expect(find(screen("onboarding_keyboard").root, (o) => o.type === "Video" && o.props?.source?.url === "https://m/keys.mp4").length).toBe(1);
  });

  it("the mic step's card takes its size from the upload", () => {
    reg({ "onboarding.hero": entry("https://m/mic.mp4", "video/mp4", { shape: "card", boxWidth: 300, aspectRatio: 1, radius: 32 }) });
    const box = find(screen("onboarding").root, (o) => o.type === "Stack" && (o.children ?? []).some((c: any) => c.type === "Video"))[0];
    expect(box.style).toMatchObject({ width: 300, aspectRatio: 1, borderRadius: 32, alignSelf: "center" });
    expect(box.style.height).toBeUndefined();
  });

  it("a window opens with intro.desktop when there is one; a phone never does", () => {
    reg({ intro: entry("https://m/intro.mp4", "video/mp4"), "intro.desktop": entry("https://m/intro-desktop.mp4", "video/mp4") });
    expect(withUrl(screen("intro", { formFactor: "desktop" }).root, "https://m/intro-desktop.mp4").length).toBe(1);
    expect(withUrl(screen("intro", { formFactor: "phone" }).root, "https://m/intro.mp4").length).toBe(1);
    expect(withUrl(screen("intro").root, "https://m/intro.mp4").length).toBe(1);
    expect((buildBootstrap({ onboarded: true, formFactor: "desktop" }).flags as any)["intro.media"]).toEqual({ url: "https://m/intro-desktop.mp4" });
    expect((buildBootstrap({ onboarded: true }).flags as any)["intro.media"]).toEqual({ url: "https://m/intro.mp4" });
  });

  it("without a desktop twin, the window gets the phone's", () => {
    reg({ intro: entry("https://m/intro.mp4", "video/mp4") });
    expect(withUrl(screen("intro", { formFactor: "desktop" }).root, "https://m/intro.mp4").length).toBe(1);
  });
});
