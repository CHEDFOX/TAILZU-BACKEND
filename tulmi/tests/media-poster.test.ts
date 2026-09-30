import { afterEach, describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { buildScreen, setMediaRegistryAccessor } from "../src/experience/catalog.js";

// What the app's splash waits on at a later launch (SduiApp firstRemoteImage):
// the first Image or Slideshow, through children and fallbacks. Visibility is
// not considered, only the tree.
const firstRemoteImage = (n: any): string | null => {
  if (!n || typeof n !== "object") return null;
  if (n.type === "Image" || n.type === "Slideshow") {
    const src = n.props?.source ?? n.props?.frames?.[0];
    const url = typeof src === "string" ? src : src?.url;
    if (url && /^https?:\/\//.test(url)) return url;
  }
  for (const c of n.children ?? []) { const h = firstRemoteImage(c); if (h) return h; }
  return firstRemoteImage(n.fallback);
};

describe("the opening, handed over from the splash", () => {
  const P = { shape: "full", fit: "cover", holdMs: 5300, boxWidth: 480, boxHeight: 1080, aspect: 0.444444, background: "#0B0A0D" };
  const intro = { url: "https://m/splash.mp4", contentType: "video/mp4", size: 1, uploadedAt: 1, present: P };
  const screen = () => buildScreen("intro", { personality: {}, language: "en", onboarded: true, params: {} } as never) as any;
  afterEach(() => setMediaRegistryAccessor(() => ({})));

  it("every launch's splash waits on the film itself, so it lifts onto a loaded film", () => {
    setMediaRegistryAccessor(() => ({ intro, "intro.poster": { url: "https://m/first.webp", contentType: "image/webp" } } as any));
    const s = screen();
    expect(firstRemoteImage(s.root)).toBe("https://m/splash.mp4");
    const film = s.root.children[0];
    expect(film.type).toBe("Video");
    expect(film.props).toMatchObject({ autoplay: true, loop: false });
  });

  it("nothing on the first screen hangs on state or a timer of its own: the film plays as it always has", () => {
    setMediaRegistryAccessor(() => ({ intro, "intro.poster": { url: "https://m/first.webp", contentType: "image/webp" } } as any));
    const s = screen();
    expect(s.state).toEqual({});
    expect(s.root.children).toHaveLength(1);
    expect(s.root.children[0].bind).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("first.webp");
    expect(s.root.on.onAppear.actions[0]).toEqual({ kind: "delay", ms: 5300 });
  });
});
