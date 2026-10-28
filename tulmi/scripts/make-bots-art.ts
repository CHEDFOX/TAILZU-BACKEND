/**
 * Cuts the Bots app's Blip pictures (tulmi/blip/bots/*.png) from the design's dithered SVGs.
 *
 *   npx tsx scripts/make-bots-art.ts <dir with n-{hello,listen,think,needs,done}{,-head}.svg>
 *
 * Needs Playwright's Chromium (require("playwright") resolves through NODE_PATH or /opt/node-tools). Run by hand when
 * the art changes; the PNGs it writes are committed and served from /blip/bots/ (server.ts serves tulmi/blip), and
 * experience/bots/art.ts names them. Raise ART_V there when a picture changes, so the apps fetch the new file.
 *
 *   head-<bot>.png   the "hello" head in the bot's colour, 144 px square (an avatar up to 48 pt at 3x)
 *   <pose>.png       Blip's whole body, 600 px tall (the big moments, up to 200 pt at 3x)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BOT_INK } from "../src/experience/bots/art.js";

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error("usage: npx tsx scripts/make-bots-art.ts <dir with the n-*.svg files>");
  process.exit(1);
}
const out = path.join(process.cwd(), "blip", "bots");
fs.mkdirSync(out, { recursive: true });

const req = createRequire(path.join(process.env.NODE_PATH?.split(":")[0] || "/opt/node-tools/node_modules", "x.js"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = req("playwright") as any;

const POSES = ["hello", "listen", "think", "needs", "done"] as const;
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shoot(svg: string, w: number, h: number, file: string): Promise<void> {
  const sized = svg.replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 width="${w}" height="${h}"`);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log("wrote", file, fs.statSync(path.join(out, file)).size, "bytes");
}

const head = fs.readFileSync(path.join(src, "n-hello-head.svg"), "utf8");
for (const [bot, ink] of Object.entries(BOT_INK)) {
  await shoot(head.replace(/fill="#0a0a0a"/g, `fill="${ink}"`), 144, 144, `head-${bot}.png`);
}
for (const pose of POSES) {
  await shoot(fs.readFileSync(path.join(src, `n-${pose}.svg`), "utf8"), 522, 600, `${pose}.png`);
}
await browser.close();
