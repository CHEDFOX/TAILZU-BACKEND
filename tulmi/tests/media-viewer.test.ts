/**
 * THE MEDIA VIEWER (screens/media.ts; docs/bots-app.md "Media"): one file seen or played in the app, saved or shared, opened from a space's
 * chat and from Kutt's pictures, and never a link from anywhere but this server.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.PUBLIC_ORIGIN = "https://api.x0bot.com"; });

type Node = import("../../shared/types/sdui.js").Node;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");
const { mediaKind, safeMediaUrl, openMedia } = await import("../src/experience/bots/screens/media.js");
const { fileNode } = await import("../src/experience/bots/screens/spaces/feed.js");

const BASE = ["BotsKit", "AudioPlay"];
const FILE = "/v1/botsapp/bots/threads/th1/files/m1/f1?v=u&exp=9&sig=abc";

async function view(params: Record<string, string>, o: { can?: string[]; blocks?: string[]; client?: "phone" | "desktop" } = {}) {
  const s = await buildBotsScreen({
    screenId: "bots.media", client: o.client ?? "phone", params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" },
    can: new Set(o.can ?? BASE), desk: { pages: false, notes: false }, ...(o.blocks ? { blocks: new Set(o.blocks) } : {}),
  } as never, fakeDeps({ api: {} }));
  const nodes = walk(s.root as Node);
  const acts = JSON.stringify(nodes.map((n) => n.on ?? {}));
  return { s, nodes, acts, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)), lint: lintTree(s.root as Node) };
}

describe("what a file is, and where it may come from", () => {
  it("reads the kind from the type, else the name", () => {
    expect([mediaKind("image/jpeg"), mediaKind("video/mp4"), mediaKind("audio/m4a"), mediaKind("application/pdf")]).toEqual(["image", "video", "audio", "file"]);
    expect([mediaKind("", "a.MOV"), mediaKind("", "note.opus"), mediaKind("", "x.heic")]).toEqual(["video", "audio", "image"]);
  });

  it("opens only this server's own files: a path on it, or https on its host", () => {
    expect(safeMediaUrl(FILE)).toBe(`https://api.x0bot.com${FILE}`);
    expect(safeMediaUrl("https://api.x0bot.com/v1/cinema/p.png")).toBe("https://api.x0bot.com/v1/cinema/p.png");
    for (const bad of ["https://evil.example/x.jpg", "http://api.x0bot.com/v1/x", "/v1/../etc", "javascript:alert(1)", "//evil.example/x", ""]) expect(safeMediaUrl(bad), bad).toBeNull();
  });
});

describe("the viewer", () => {
  it("a photo: whole, Save to Photos and Save to Files where the build can save, Share", async () => {
    const v = await view({ u: FILE, n: "cake.jpg", m: "image/jpeg", s: "234 KB" }, { can: [...BASE, "MediaSave"] });
    expect(v.lint).toEqual([]);
    expect(v.nodes.some((n) => n.type === "Image" && JSON.stringify(n.props).includes("/files/m1/f1"))).toBe(true);
    expect(v.texts).toEqual(expect.arrayContaining(["cake.jpg", "234 KB", "Save to Photos", "Save to Files", "Share"]));
    expect(v.acts).toContain('"kind":"download"');
    expect(v.acts).toContain('"then":"photos"');
    // An older build cannot save: the browser, where it can still be kept.
    const old = await view({ u: FILE, n: "cake.jpg", m: "image/jpeg" });
    expect(old.texts).toEqual(expect.arrayContaining(["Share", "Open in browser"]));
    expect(old.texts).not.toContain("Save to Photos");
  });

  it("a video: played in the app with the media block (a vocabulary-2 screen), else its frame opens it", async () => {
    const v2 = await view({ u: FILE, n: "dance.mp4", m: "video/mp4" }, { can: [...BASE, "MediaSave"], blocks: ["media"] });
    const player = v2.nodes.find((n) => n.type === "Video")!;
    expect(player.props).toMatchObject({ controls: true, source: `https://api.x0bot.com${FILE}` });
    expect((v2.s as { needs?: string[] }).needs).toContain("media");
    const v1 = await view({ u: FILE, n: "dance.mp4", m: "video/mp4" });
    expect(v1.nodes.some((n) => n.type === "Video")).toBe(false);
    expect(v1.texts).toContain("Tap to play it.");
    expect(v1.acts).toContain('"kind":"openUrl"');
  });

  it("a sound: play and pause in the app, how far it is, and Download to Files", async () => {
    const v = await view({ u: FILE, n: "Voice note · 0:42", m: "audio/m4a" }, { can: [...BASE, "MediaSave"] });
    expect(v.acts).toContain('"kind":"playAudio"');
    expect(v.texts).toEqual(expect.arrayContaining(["Download", "Share"]));
    expect(v.acts).toContain('"then":"files"');
  });

  it("any other file: Open, Download, Share; the window downloads and copies the link", async () => {
    const v = await view({ u: FILE, n: "fees.pdf", m: "application/pdf" }, { can: [...BASE, "MediaSave"] });
    expect(v.texts).toEqual(expect.arrayContaining(["fees.pdf", "Open", "Download", "Share"]));
    const desk = await view({ u: FILE, n: "fees.pdf", m: "application/pdf" }, { client: "desktop" });
    expect(desk.texts).toEqual(expect.arrayContaining(["Download", "Copy link"]));
  });

  it("a link from anywhere else is not opened as the person's file", async () => {
    const v = await view({ u: "https://evil.example/x.jpg", n: "x.jpg", m: "image/jpeg" });
    expect(v.texts).toContain("This file can't be opened here");
    expect(v.nodes.some((n) => n.type === "Image" && JSON.stringify(n.props).includes("evil"))).toBe(false);
  });
});

describe("where it opens from", () => {
  it("a file in a space's chat opens the viewer, with its name, type and size; a video or a sound has a play mark", () => {
    const f = { id: "f1", name: "dance.mp4", mime: "video/mp4", bytes: 18_400_000, kind: "video", url: FILE };
    const n = fileNode(f, false);
    expect(n.on?.onPress).toEqual(openMedia({ url: FILE, name: "dance.mp4", mime: "video/mp4", size: "17.5 MB" }));
    expect(JSON.stringify(n)).toContain("▶");
  });
});
