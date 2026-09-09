import { beforeEach, describe, expect, it } from "vitest";

// The catalog reads the app's config now — the free tier it quotes has to be
// the one the meter enforces — so building a screen needs a valid environment.
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
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

  // The opening media's mark is not at the centre of its own frame, so `cover`
  // — which centres the FRAME — puts it off centre on screen, while the launch
  // screen draws the same mark dead centre. A nudge is how that is corrected
  // without touching the art or shipping a build.
  it("a nudge moves the window in PERCENT, not points", () => {
    withPresent({ nudgeX: 3.18, nudgeY: 2.85 });
    const n = mediaNode();
    // Percent because cover scales the art to the screen's HEIGHT, so the miss
    // grows with the device. A fixed number of points is right on one phone.
    expect(n.style.left).toBe("3.18%");
    expect(n.style.top).toBe("2.85%");
  });

  it("a nudge drops the pinned right/bottom and sizes from the parent", () => {
    withPresent({ nudgeY: 2.85 });
    const n = mediaNode();
    // A box cannot be pinned to an edge and moved off it.
    expect(n.style.right).toBeUndefined();
    expect(n.style.bottom).toBeUndefined();
    expect(n.style.width).toBe("100%");
    expect(n.style.height).toBe("100%");
    // The axis nobody asked about does not drift.
    expect(n.style.left).toBe("0%");
  });

  it("no nudge leaves the pinned box exactly as it was", () => {
    const n = mediaNode();
    expect(n.style.top).toBe(0);
    expect(n.style.right).toBe(0);
    expect(n.style.bottom).toBe(0);
  });

  // A launch screen's icon is a fixed size compiled into the binary. When the
  // opening film's subject comes out bigger, the film is the only side that can
  // move without a build.
  it("scale shrinks the box and centres what is left", () => {
    withPresent({ scale: 0.8 });
    const n = mediaNode();
    expect(n.style.width).toBe("80%");
    expect(n.style.height).toBe("80%");
    // (1 - 0.8) / 2 — the leftover split evenly, so the media stays centred.
    expect(n.style.top).toBe("10%");
    expect(n.style.left).toBe("10%");
  });

  it("a nudge means the same thing at any scale: distance from centre", () => {
    withPresent({ scale: 0.8, nudgeX: 2.5, nudgeY: 2.25 });
    const n = mediaNode();
    expect(n.style.left).toBe("12.5%");
    expect(n.style.top).toBe("12.25%");
  });

  it("scale 1 is exactly the unscaled nudge", () => {
    withPresent({ scale: 1, nudgeX: 3.2, nudgeY: 2.85 });
    const n = mediaNode();
    expect(n.style.left).toBe("3.2%");
    expect(n.style.width).toBe("100%");
  });

  // A launch screen's icon is 17pt on every phone. Media under `cover` is a
  // share of the screen. A percentage cannot equal a fixed number on more than
  // one screen size, so matching one means fixing the other in points too.
  it("a box in points anchors at the middle and pulls back half its size", () => {
    withPresent({ boxWidth: 358, boxHeight: 644 });
    const n = mediaNode();
    expect(n.style.width).toBe(358);
    expect(n.style.height).toBe(644);
    expect(n.style.left).toBe("50%");
    expect(n.style.top).toBe("50%");
    expect(n.style.marginLeft).toBe(-179);
    expect(n.style.marginTop).toBe(-322);
  });

  it("a nudge on a fixed box is percent OF THE BOX, so it stays fixed too", () => {
    withPresent({ boxWidth: 358, boxHeight: 644, nudgeX: 2.62, nudgeY: 2.85 });
    const n = mediaNode();
    // -179 + 2.62% of 358
    expect(n.style.marginLeft).toBe(-169.62);
    // -322 + 2.85% of 644
    expect(n.style.marginTop).toBe(-303.65);
  });

  it("each axis decides for itself", () => {
    withPresent({ boxHeight: 644, nudgeX: 3.2, nudgeY: 2.85 });
    const n = mediaNode();
    // Height fixed in points, width still a share of the screen.
    expect(n.style.height).toBe(644);
    expect(n.style.marginTop).toBe(-303.65);
    expect(n.style.width).toBe("100%");
    expect(n.style.left).toBe("3.2%");
    expect(n.style.marginLeft).toBeUndefined();
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
  // The paywall's art moved BEHIND the screen when the paywall went full
  // bleed, so it is no longer a hero in the column and has no margins to
  // cancel. Settings still carries one the old way, and is the subject for
  // everything about the in-column shape below.
  it("art behind a screen fills the window rather than sitting in the column", () => {
    const h = heroOf("paywall", "hero.paywall");
    expect(h.style.position).toBe("absolute");
    expect(h.style.top).toBe(0);
    expect(h.style.left).toBe(0);
    expect(h.style.right).toBe(0);
    expect(h.style.bottom).toBe(0);
  });

  it("an entry can send an in-column hero to the edges, and keep a radius there", () => {
    // Default is the card: a radius, and no margins pulling it outward.
    const card = heroOf("settings", "hero.settings");
    expect(card.style.marginLeft).toBeUndefined();
    expect(card.style.borderRadius).toBe(20);

    // "full" cancels the screen's own top padding and squares the corners,
    // unless the entry asks for a radius anyway.
    const full = heroOf("settings", "hero.settings", { shape: "full" });
    expect(full.style.marginTop).toBe(-12);
    expect(full.style.alignSelf).toBe("stretch");
    expect(full.style.borderRadius).toBe(0);

    const rounded = heroOf("settings", "hero.settings", { shape: "full", radius: 14 });
    expect(rounded.style.borderRadius).toBe(14);
  });

  it("aspectRatio and fit come off the entry", () => {
    const h = heroOf("settings", "hero.settings", { aspectRatio: 0.75, fit: "contain" });
    expect(h.style.aspectRatio).toBe(0.75);
    expect(h.children[0].props.contentFit).toBe("contain");
  });

  it("a clip in a hero slot builds a Video, not an invisible Image", () => {
    const h = heroOf("settings", "hero.settings", undefined, "video/mp4");
    expect(h.children[0].type).toBe("Video");
    expect(h.children[0].props.autoplay).toBe(true);
    expect(h.children[0].props.muted).toBe(true);
    // Older bundles have no Video node; a still is a far better hero than a hole.
    expect(h.children[0].fallback.type).toBe("Image");
  });

  // The rule the new flow clip needed: art whose full width IS the subject
  // must not be cropped to fill a window that is a different shape.
  it("fill:width gives the box the ART'S shape, so nothing is cropped", () => {
    const h = heroOf("flow_arm", "hero.flow_arm",
      { fill: "width", pin: "bottom", aspect: 9 / 16 }, "video/mp4");
    expect(h.style.aspectRatio).toBe(9 / 16);
    // One edge only — a fourth would give Yoga a height and the ratio would be
    // the constraint it dropped.
    expect(h.style.bottom).toBe(0);
    expect(h.style.top).toBeUndefined();
    // And it can no longer crop, whatever the call site asked for.
    expect(h.children[0].props.contentFit).toBe("contain");
  });

  it("fill:width without an aspect falls back to filling the window", () => {
    const h = heroOf("flow_arm", "hero.flow_arm", { fill: "width" }, "video/mp4");
    expect(h.style.aspectRatio).toBeUndefined();
    expect(h.style.top).toBe(-72);
    expect(h.style.bottom).toBe(0);
  });

  it("the flow clip fills the window, behind the words", () => {
    const h = heroOf("flow_arm", "hero.flow_arm", undefined, "video/mp4");
    // Pinned to the window, not inset from a column. A 9:16 clip at full
    // width is taller than what a heading and a paragraph leave behind, so
    // full bleed here can only mean behind them.
    //
    // NEGATIVE insets, by the screen's own padding: Yoga lays an absolute
    // child out against the parent's PADDING box, so top:0 on a screen with
    // 72pt of top padding starts 72pt down. Backdrop and background are the
    // same black, so that did not read as inset — it read as missing.
    expect(h.style.position).toBe("absolute");
    expect(h.style.top).toBe(-72);
    expect(h.style.left).toBe(-28);
    expect(h.style.right).toBe(-28);
    expect(h.style.bottom).toBe(0);
    expect(h.style.marginLeft).toBeUndefined();
    expect(h.children[0].props.contentFit).toBe("cover");
  });

  // The SHIPPED Video node boxes a plain { url } into { source: url }, and the
  // resolver behind it has never known that shape — so it resolved to "empty",
  // the player returned null, and every backend Video rendered nothing at all.
  // The payload carries both keys so the broken build and the fixed one each
  // find what they look for.
  it("a media source survives the shipped Video node", () => {
    const h = heroOf("flow_arm", "hero.flow_arm", undefined, "video/mp4");
    const src = h.children[0].props.source as Record<string, unknown>;
    // `source` puts the old node on its pass-through branch, so it stops
    // wrapping and the object reaches the resolver intact.
    expect(src.source).toBe(src.url);
    // `url` is what the resolver matches on — first, and it never looks at
    // `source`. The fixed node reads .source instead, and the resolver's string
    // branch turns that back into { url }.
    expect(String(src.url)).toMatch(/^https:\/\/.+\.mp4$/);
    expect(src.contentType).toBe("video/mp4");
  });

  it("the flow clip is not filtered by platform", () => {
    // It carried visibleIf:{platform:"ios"} because FLOW is iOS-only — true of
    // the feature, not of this screen. Anything that reaches here was routed by
    // a client that already decided. The filter could only subtract, and what
    // it subtracted was the art.
    const h = heroOf("flow_arm", "hero.flow_arm", undefined, "video/mp4");
    expect(h.visibleIf).toBeUndefined();
  });

  it("the flow clip is the FIRST child, so the words paint over it", () => {
    setMediaRegistryAccessor(() => ({
      "hero.flow_arm": {
        url: "https://api.tailzu.space/media/x.mp4",
        contentType: "video/mp4", size: 1, uploadedAt: 1,
      },
    }));
    const screen = buildScreen("flow_arm", {
      personality: {}, language: "en", onboarded: true, params: {}, email: "a@b.com",
    } as never) as any;
    // A Stack root, not a Screen: an absolute child of a ScrollView is placed
    // against the content, not the window.
    expect(screen.root.type).toBe("Stack");
    expect(screen.root.children[0].children[0].type).toBe("Video");
    expect(screen.root.children[1].type).toBe("Heading");
  });
});

describe("a hero clip plays itself", () => {
  function flowVideo(present?: MediaPresent) {
    setMediaRegistryAccessor(() => ({
      "hero.flow_arm": {
        url: "https://api.tailzu.space/media/f.mp4",
        contentType: "video/mp4", size: 1, uploadedAt: 1,
        ...(present ? { present } : {}),
      },
    }));
    const screen = buildScreen("flow_arm", {
      personality: {}, language: "en", onboarded: true, params: {}, email: "a@b.com",
    } as never) as any;
    return { screen, video: screen.root.children[0].children[0] };
  }

  it("autoplays, looping, by default", () => {
    const { video } = flowVideo();
    expect(video.props.autoplay).toBe(true);
    expect(video.props.loop).toBe(true);
  });

  it("loop:false plays once and holds the last frame", () => {
    const { video } = flowVideo({ loop: false });
    expect(video.props.loop).toBe(false);
    expect(video.props.autoplay).toBe(true);
  });

  it("NEVER hands the player a false `playing`", () => {
    // MediaPlayer resolves shouldPlay = playing ?? autoplay, and a paused
    // expo-video player that has never played renders nothing at all. A clip
    // that arrives paused is a clip that does not arrive.
    const { video } = flowVideo({ loop: false, holdMs: 4200 });
    expect(video.props.playing).toBeUndefined();
    expect(video.bind).toBeUndefined();
  });

  it("holdMs sets how long the screen stays", () => {
    const { screen } = flowVideo({ holdMs: 3000 });
    const delay = screen.actions.doArm.actions.find((a: any) => a.kind === "delay");
    expect(delay.ms).toBe(3000);
  });
});
