import { beforeEach, describe, expect, it } from "vitest";
import { buildScreen, setMediaRegistryAccessor } from "../src/experience/catalog.js";
import type { MediaPresent } from "../../shared/types/sdui.js";

// How the opening media is SHOWN is registry data, not code. These tests hold
// that line: the same file plays edge to edge, in a circle, or in a card,
// depending only on what a POST to /v1/media/present left on the entry.

const GIF = "https://api.tailzu.space/media/abc.gif";

function withPresent(present?: MediaPresent) {
  setMediaRegistryAccessor(() => ({
    intro: {
      url: GIF,
      contentType: "image/gif",
      size: 1234,
      uploadedAt: 1,
      ...(present ? { present } : {}),
    },
  }));
}

/** The node that actually carries the media, whatever shape it took. */
function mediaNode(): Record<string, any> {
  const screen = buildScreen("intro", {
    personality: {}, language: "en", onboarded: true, params: {},
  } as never) as any;
  const kids: any[] = screen.root?.children ?? [];
  const found = kids.find((n) => n.type === "Image" || n.type === "Video" || n.type === "Stack");
  return found ?? {};
}

/** The delay the screen holds for before it navigates away. */
function holdMs(): number {
  const screen = buildScreen("intro", {
    personality: {}, language: "en", onboarded: true, params: {},
  } as never) as any;
  const seq = screen.root?.on?.onAppear?.actions ?? [];
  return seq.find((a: any) => a.kind === "delay")?.ms;
}

describe("media presentation is registry data", () => {
  beforeEach(() => withPresent(undefined));

  it("defaults to edge-to-edge cover", () => {
    const n = mediaNode();
    expect(n.style.position).toBe("absolute");
    expect(n.style.top).toBe(0);
    expect(n.style.bottom).toBe(0);
    // No radius on a full-bleed default — a corner is a decision, not a default.
    expect(n.style.borderRadius).toBeUndefined();
    const img = n.children?.[0] ?? n;
    expect(img.props.contentFit).toBe("cover");
  });

  it("shape:plate puts it back in a circle", () => {
    withPresent({ shape: "plate", size: 160 });
    const n = mediaNode();
    expect(n.style.width).toBe(160);
    expect(n.style.height).toBe(160);
    expect(n.style.borderRadius).toBe(80);
    expect(n.style.position).toBeUndefined();
  });

  it("shape:card keeps a ratio and rounds the corners", () => {
    withPresent({ shape: "card", aspectRatio: 1, radius: 30, inset: 24 });
    const n = mediaNode();
    expect(n.style.aspectRatio).toBe(1);
    expect(n.style.borderRadius).toBe(30);
    expect(n.style.marginHorizontal).toBe(24);
  });

  it("fit:contain stops the crop", () => {
    withPresent({ fit: "contain" });
    const n = mediaNode();
    const img = n.children?.[0] ?? n;
    expect(img.props.contentFit).toBe("contain");
  });

  it("inset drops width/height so the pinned edges are the only geometry", () => {
    withPresent({ inset: 18 });
    const n = mediaNode();
    expect(n.style.top).toBe(18);
    expect(n.style.width).toBeUndefined();
    expect(n.style.height).toBeUndefined();
  });

  it("holdMs sets how long the scene runs", () => {
    withPresent({ holdMs: 4600 });
    expect(holdMs()).toBe(4600);
  });

  it("background paints behind the media", () => {
    withPresent({ background: "#101014" });
    expect(mediaNode().style.backgroundColor).toBe("#101014");
  });
});

// The same contract for the hero slots. A hero lives inside a padded screen,
// so "full" here means cancelling that padding, not absolute positioning.

function heroOf(screenId: string, key: string, present?: MediaPresent, contentType = "image/jpeg") {
  setMediaRegistryAccessor(() => ({
    [key]: {
      url: "https://api.tailzu.space/media/x." + (contentType.startsWith("video") ? "mp4" : "jpg"),
      contentType, size: 1, uploadedAt: 1,
      ...(present ? { present } : {}),
    },
  }));
  const screen = buildScreen(screenId, {
    personality: {}, language: "en", onboarded: true, params: {}, email: "a@b.com",
  } as never) as any;
  const walk = (n: any): any => {
    if (!n) return null;
    if (n.type === "Stack" && n.children?.length === 1 &&
        ["Image", "Video"].includes(n.children[0].type)) return n;
    for (const c of n.children ?? []) { const hit = walk(c); if (hit) return hit; }
    return null;
  };
  return walk(screen.root);
}

describe("hero slots take their presentation from the registry too", () => {
  it("the paywall hero is edge to edge by default", () => {
    const h = heroOf("paywall", "paywall.hero");
    // The screen's own padding is 20 all round, 12 at the top.
    expect(h.style.marginLeft).toBe(-20);
    expect(h.style.marginRight).toBe(-20);
    expect(h.style.marginTop).toBe(-12);
    expect(h.style.borderRadius).toBe(0);
    expect(h.style.alignSelf).toBe("stretch");
  });

  it("an entry can ask for the card back", () => {
    const h = heroOf("paywall", "paywall.hero", { shape: "card", radius: 20 });
    expect(h.style.marginLeft).toBeUndefined();
    expect(h.style.borderRadius).toBe(20);
  });

  it("aspectRatio and fit come off the entry", () => {
    const h = heroOf("paywall", "paywall.hero", { aspectRatio: 0.75, fit: "contain" });
    expect(h.style.aspectRatio).toBe(0.75);
    expect(h.children[0].props.contentFit).toBe("contain");
  });

  it("a clip in a hero slot builds a Video, not an invisible Image", () => {
    const h = heroOf("paywall", "paywall.hero", undefined, "video/mp4");
    expect(h.children[0].type).toBe("Video");
    expect(h.children[0].props.autoplay).toBe(true);
    expect(h.children[0].props.muted).toBe(true);
    // Older bundles have no Video node; a still is a far better hero than a hole.
    expect(h.children[0].fallback.type).toBe("Image");
  });

  it("the flow screen's hero cancels its own 28pt padding", () => {
    const h = heroOf("flow_arm", "hero.flow_arm");
    expect(h.style.marginLeft).toBe(-28);
    expect(h.style.marginRight).toBe(-28);
  });
});
