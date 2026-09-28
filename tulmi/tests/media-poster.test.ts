import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { registerMediaPosterRoute } from "../src/routes/mediaCompress.js";
// eslint-disable-next-line import/first
import type { MediaRegistry } from "../src/routes/media.js";
// eslint-disable-next-line import/first
import { buildScreen, setMediaRegistryAccessor } from "../src/experience/catalog.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();
const clip = new URL("../media-seed/mic.mp4", import.meta.url);

describe("POST /v1/media/poster", () => {
  it.skipIf(!hasFfmpeg)("writes the clip's first frame as a lossless still under <key>.poster", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-test-"));
    fs.copyFileSync(clip, path.join(dir, "abc.mp4"));
    let reg: MediaRegistry = { intro: { url: "https://m/media/abc.mp4", contentType: "video/mp4", size: 1, uploadedAt: 1, key: "intro" } };
    const app = Fastify();
    registerMediaPosterRoute(app, {
      mediaDir: dir, publicUrlPrefix: "https://m/media", adminSecret: "s",
      registry: () => reg, writeRegistry: async (r) => { reg = r; },
      checkAdmin: (req: any, expected) => ({ ok: req.headers["x-admin-secret"] === expected, reason: "unauthorized" }),
    });
    expect((await app.inject({ method: "POST", url: "/v1/media/poster?key=intro" })).statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/v1/media/poster?key=intro", headers: { "x-admin-secret": "s" } });
    expect(res.statusCode).toBe(200);
    const p = reg["intro.poster"];
    expect(p.contentType).toBe("image/webp");
    const file = path.join(dir, p.url.split("/").pop()!);
    const head = fs.readFileSync(file).subarray(0, 16);
    expect(head.subarray(0, 4).toString()).toBe("RIFF");
    expect(head.subarray(12, 16).toString()).toBe("VP8L");   // lossless
    // The clip's own entry is untouched.
    expect(reg.intro.url).toBe("https://m/media/abc.mp4");
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the opening, handed over from the splash", () => {
  const P = { shape: "full", fit: "cover", holdMs: 5300, boxWidth: 480, boxHeight: 1080, aspect: 0.444444, background: "#0B0A0D" };
  const intro = { url: "https://m/splash.mp4", contentType: "video/mp4", size: 1, uploadedAt: 1, present: P };
  const screen = () => buildScreen("intro", { personality: {}, language: "en", onboarded: true, params: {} } as never) as any;
  afterEach(() => setMediaRegistryAccessor(() => ({})));

  it("without a poster, the film plays as it always has", () => {
    setMediaRegistryAccessor(() => ({ intro } as any));
    const s = screen();
    expect(s.state).toEqual({});
    expect(s.root.children).toHaveLength(1);
    expect(s.root.children[0].bind).toBeUndefined();
    expect(s.root.on.onAppear.actions[0]).toEqual({ kind: "delay", ms: 5300 });
  });

  it("with one, the still covers the parked film in its own box, then hands over", () => {
    setMediaRegistryAccessor(() => ({ intro, "intro.poster": { url: "https://m/first.webp", contentType: "image/webp", size: 1, uploadedAt: 1 } } as any));
    const s = screen();
    const [film, still] = s.root.children;
    expect(s.state).toEqual({ introPlaying: false, introPoster: true });
    expect(film.type).toBe("Video");
    expect(film.bind).toEqual({ playing: "introPlaying" });
    // Same box, same placement: the two are one picture until the film moves.
    expect(still.style).toEqual(film.style);
    expect(still.children[0].props).toMatchObject({ contentFit: film.props.contentFit, aspect: film.props.aspect });
    expect(still.children[0].props.source.url).toBe("https://m/first.webp");
    expect(still.visibleIf).toEqual({ truthy: "introPoster" });
    const steps = still.on.onAppear.actions;
    expect(steps[1]).toEqual({ kind: "setState", path: "introPlaying", value: true });
    expect(steps[3]).toEqual({ kind: "setState", path: "introPoster", value: false });
    // The film starts HOLD later, so the screen moves on HOLD later: it plays whole.
    expect(s.root.on.onAppear.actions[0].ms).toBe(5300 + steps[0].ms);
    // What the app's splash waits on at launch: the first remote image — the still.
    const firstImage = (n: any): string | null => {
      if (!n || typeof n !== "object") return null;
      if (n.type === "Image") return n.props?.source?.url ?? null;
      for (const c of n.children ?? []) { const h = firstImage(c); if (h) return h; }
      return null;
    };
    expect(firstImage(s.root)).toBe("https://m/first.webp");
  });
});
