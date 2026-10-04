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
  it("the voice card is the voice's own colour, its name and nothing else, not a poster", () => {
    // The refresh (phoneLook.ts): each voice wears its room's colour. The
    // sample said/written lines under the name were taken off at the
    // owner's request, and an uploaded poster no longer covers it.
    reg({ "you.voice.signature": entry("https://m/zu.png", "image/png"), "you.voice": entry("https://m/any.png", "image/png") });
    const voiceOf = (root: any) => find(root, (o) => o.type === "Stack" && JSON.stringify(o.on ?? {}).includes('"voices"'))[0];
    const zu = voiceOf(screen("personality").root);
    expect(zu.style.backgroundColor).toBe("#F3EDE2");
    expect(JSON.stringify(zu)).not.toContain("Haan bhai, kal milte hain paanch baje.");
    expect(withUrl(zu, "https://m/zu.png").length).toBe(0);
    const pirate = voiceOf(screen("personality", { personality: { activePresetId: "pirate" } }).root);
    expect(pirate.style.backgroundColor).toBe("#106A60");
  });

  it("dictionary, languages and haptics are cards in their own colours, each one tap from its screen", () => {
    reg({ "you.dictionary": entry("https://m/dict.png", "image/png"), "you.languages": entry("https://m/lang.png", "image/png"), "you.haptics": entry("https://m/hap.webp", "image/webp") });
    const root = screen("personality").root;
    const fills = ["#16463D", "#4B2240", "#253A5C"];
    const cards = find(root, (o) => o.type === "Stack" && o.style?.borderRadius === 20 && fills.includes(o.style?.backgroundColor));
    expect(cards.length).toBe(3);
    // Three colours, not one stamped three times, and none of them amber.
    expect(new Set(cards.map((c: any) => c.style.backgroundColor)).size).toBe(3);
    expect(JSON.stringify(cards)).not.toMatch(/E8A23C|232,\s*162,\s*60/i);
    for (const [name, id] of [["Dictionary", "dictionary"], ["Languages", "languages"], ["Haptics", "haptics"]]) {
      const card = cards.find((c: any) => JSON.stringify(c).includes(`"${name}"`));
      expect(JSON.stringify(card.on), name).toContain(`"screenId":"${id}"`);
    }
    for (const url of ["https://m/dict.png", "https://m/lang.png", "https://m/hap.webp"]) expect(withUrl(root, url).length).toBe(0);
  });

  it("training gets the microphone to itself on iPhone, and Flow comes back after", () => {
    const you = screen("personality");
    const go = JSON.stringify(you.actions.enterTraining);
    expect(go.indexOf('"endFlowSession"')).toBeGreaterThan(-1);
    expect(go.indexOf('"endFlowSession"')).toBeLessThan(go.indexOf('"training_live"'));
    expect(go).toContain('"platform":"ios"');
    const live = screen("training_live");
    const out = JSON.stringify(live.root.on.onDisappear);
    expect(out).toContain('"armFlowSession"');
    expect(out).toContain('"flag":"kb.flow.armOnForeground"');
    // The unhandled save is still made, once, only when the arrow did not.
    expect(out).toContain('"falsy":"leaving"');
    expect(out).toContain("/v1/train/portrait");
  });

  it("the training card shows its way in and answers a tap anywhere on it", () => {
    const root = screen("personality").root;
    const card = find(root, (o) => o.type === "Stack" && o.on?.onPress === "enterTraining")[0];
    expect(card.style.backgroundColor).toBe("#1E1946");
    const button = find(card, (o) => o.type === "Button")[0];
    expect(button.on).toEqual({ onPress: "enterTraining" });
    expect(button.props.label).toBe("BEGIN");
  });

  it("the training card always draws the live field, whatever is uploaded at you.train", () => {
    // The uploaded art carried a sentence of its own ("I don't know how you
    // sound yet…") that showed through behind the card's text. The field has
    // no words, and grows with the person.
    for (const media of [{}, { "you.train": entry("https://m/train.mp4", "video/mp4") }, { "you.train": entry("https://m/train.png", "image/png") }]) {
      reg(media as never);
      const root = screen("personality").root;
      expect(find(root, (o) => o.type === "NeuralField").length).toBe(1);
      expect(withUrl(root, "https://m/train.mp4").length + withUrl(root, "https://m/train.png").length).toBe(0);
    }
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

  it("the splash never waits on the mic step's clip: it goes by key", () => {
    reg({ intro: entry("https://m/splash.mp4", "video/mp4"), "onboarding.hero": entry("https://m/mic.mp4", "video/mp4") });
    const root = screen("onboarding", { onboarded: false }).root;
    // What the app's first-run splash gate collects: every http url under a source.
    const urls: string[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const src = n.props?.source; const u = typeof src === "string" ? src : src?.url;
      if (typeof u === "string" && /^https?:/.test(u)) urls.push(u);
      for (const k of Object.keys(n)) if (k !== "style") walk(n[k]);
    };
    walk(root);
    expect(urls).not.toContain("https://m/mic.mp4");
    const v = find(root, (o) => o.type === "Video")[0];
    expect(v.props.source).toEqual({ key: "onboarding.hero" });
    expect(v.fallback.props.source).toEqual({ key: "onboarding.hero" });
    // A still stays a url: prefetching an image is what keeps it from popping in.
    reg({ "onboarding.hero": entry("https://m/mic.webp", "image/webp") });
    const still = find(screen("onboarding", { onboarded: false }).root, (o) => o.type === "Image")[0];
    expect(still.props.source.url).toBe("https://m/mic.webp");
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
