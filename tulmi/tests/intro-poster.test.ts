import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { ensureVideoPosters, getMediaRegistry, loadMediaRegistry } from "../src/routes/media.js";
// eslint-disable-next-line import/first
import { buildScreen, setMediaRegistryAccessor } from "../src/experience/catalog.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

const find = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
  if (!n || typeof n !== "object") return out;
  if (pred(n)) out.push(n);
  for (const c of n.children ?? []) find(c, pred, out);
  return out;
};

describe("the opening film's first frame", () => {
  it.skipIf(!hasFfmpeg)("is cut by the server and drawn under the film, so the splash hands over without a blink", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tulmi-poster-test-"));
    const clip = path.join(dir, "abc123.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x0B0A0D:s=64x114:d=1", "-pix_fmt", "yuv420p", clip], { stdio: "ignore" });
    const url = "https://api.test/media/abc123.mp4";
    fs.writeFileSync(path.join(dir, "_registry_v1.json"), JSON.stringify({
      intro: { url, contentType: "video/mp4", size: fs.statSync(clip).size, uploadedAt: 1, key: "intro" },
    }));
    await loadMediaRegistry(dir);
    setMediaRegistryAccessor(getMediaRegistry);

    expect(await ensureVideoPosters({ mediaDir: dir, publicUrlPrefix: "https://api.test/media" })).toBe(1);
    const poster = getMediaRegistry().intro!.poster!;
    expect(poster.from).toBe(url);
    expect(poster.contentType).toBe("image/webp");
    expect(fs.existsSync(path.join(dir, poster.url.split("/").pop()!))).toBe(true);
    // Once is enough: nothing to cut on a second pass.
    expect(await ensureVideoPosters({ mediaDir: dir, publicUrlPrefix: "https://api.test/media" })).toBe(0);

    const root = (buildScreen("intro", { personality: {}, language: "en" } as never) as any).root;
    const kids = root.children.map((c: any) => c.type);
    expect(kids.indexOf("Image")).toBeGreaterThanOrEqual(0);
    expect(kids.indexOf("Image")).toBeLessThan(kids.indexOf("Video"));
    const img = root.children[kids.indexOf("Image")];
    const vid = root.children[kids.indexOf("Video")];
    expect(img.props.source.url).toBe(poster.url);
    // The same box, so the still sits exactly where the film will.
    expect({ ...img.style, backgroundColor: undefined }).toEqual({ ...vid.style, backgroundColor: undefined });
    expect(vid.style.backgroundColor).toBe("transparent");

    // A replaced film does not wear the old one's frame.
    getMediaRegistry().intro = { ...getMediaRegistry().intro!, url: "https://api.test/media/other.mp4" };
    const after = (buildScreen("intro", { personality: {}, language: "en" } as never) as any).root;
    expect(find(after, (n) => n.type === "Image" && n.props?.source?.url === poster.url).length).toBe(0);
  });
});
