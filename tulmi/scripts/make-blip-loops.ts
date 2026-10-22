/**
 * Cuts Blip's animated pictures (tulmi/blip/*.webp) from the desktop's drawing.
 *
 *   PLAYWRIGHT=/opt/node-tools/node_modules/playwright \
 *   CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *   npx tsx scripts/make-blip-loops.ts [../../TAILZU-DESKTOP/blip.js]
 *
 * Needs a Chromium (Playwright's) and ffmpeg with libwebp. Neither is a
 * dependency of the backend: this is run by hand when Blip changes, and the
 * files it writes are committed (blip/*.webp, src/experience/blipData.ts).
 *
 * WHAT IT DOES. blip.js's walker draws Blip standing on a canvas, in whichever
 * pose, with a clock it can be held to. For each loop in BLIP_LOOPS it settles
 * the pose's spring, then draws FRAMES frames FRAME_MS apart, on a transparent
 * canvas at twice the points. Every size class is cropped to one box (the
 * union of its loops), so his feet stand in the same place in every picture of
 * a class and a step can swap one pose for another without anything moving.
 *
 * THE LOOPS CLOSE. blip.js's idle motions (the bob, the sway, the antenna, the
 * wave, the hop, the blink) each have a period of their own, and no loop short
 * enough to download would hold a whole number of every one of them. So the
 * copy of blip.js that is drawn here has those periods retuned (RETUNE below)
 * to ones that fit BLIP_LOOP_MS exactly: the same motion, a few percent slower
 * or faster. The desktop's file is read, never written, and a periods table
 * that no longer matches it stops the script rather than cutting a loop that
 * jumps.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

process.env.OPENROUTER_API_KEY ??= "blip";
process.env.OPENAI_API_KEY ??= "blip";
process.env.STT_PROVIDER ??= "openai";
process.env.DEV_SKIP_AUTH ??= "true";

const { OB } = await import("../src/experience/onboard.js");
const { BLIP_HEIGHT, BLIP_LOOPS, BLIP_LOOP_MS } = await import("../src/experience/blipLoops.js");

const FRAMES = Number(process.env.BLIP_FRAMES ?? 20);
const FRAME_MS = BLIP_LOOP_MS / FRAMES; // 100
const DPR = 2;
/** libwebp quality by size class: the big Blip is the heavier file, and is looked at for less time. */
const QUALITY: Record<string, number> = { s: Number(process.env.BLIP_QUALITY ?? 50), l: Number(process.env.BLIP_QUALITY_L ?? 22) };
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, "..", "blip");
const dataFile = path.join(here, "..", "src", "experience", "blipData.ts");
const blipJs = path.resolve(process.argv[2] ?? path.join(here, "..", "..", "..", "TAILZU-DESKTOP", "blip.js"));

/** [what to find in blip.js, what to draw instead, how many times it must be found]. */
const RETUNE: Array<[string, string, number]> = [
  // The idle bob and the sway of the head: 0.9 and 0.45 Hz -> 1 and 0.5 Hz.
  ["TAU * .9)", "TAU * 1)", 1], ["TAU * .45)", "TAU * .5)", 1],
  // The antenna's wobble, the nod and the wave's arm: 1.6, 1.6 and 1.45 Hz -> 1.5 Hz.
  ["TAU * 1.6)", "TAU * 1.5)", 2], ["TAU * 1.45)", "TAU * 1.5)", 1],
  // The hop of a tada, and the antenna blinking while he waits: 1.1 and 1.2 Hz -> 1 Hz.
  ["TAU * 1.1)", "TAU * 1)", 1], ["TAU * 1.2)", "TAU * 1)", 1],
  // The tile or key in his hand tilts: 2.2 rad/s -> once per loop.
  ["t * 2.2)", "t * Math.PI)", 2],
  // His blink, every 3.1 s -> once a loop.
  ["% 3100) < 130", `% ${BLIP_LOOP_MS}) < 130`, 1],
];

/**
 * The big Blip (Welcome and Done) is cut CALM: without the idle bob and sway.
 * Each of those moves the figure a fraction of a dot, which re-dithers all of
 * it, and in a loop that size that alone is more than the file may weigh. His
 * own move (the wave, the hop) is what is left, and it is what is looked at.
 */
const CALM: Array<[string, string]> = [
  ["Math.sin(t * TAU * .9) * .008 * H", "0"],
  ["Math.sin(t * TAU * .45) * .025 * st.swayK", "0"],
];
const CALM_SIZES = new Set(["l"]);

function retuned(src: string, calm: boolean): string {
  let out = src;
  if (calm) {
    for (const [from, to] of CALM) {
      if (!out.includes(from)) throw new Error(`blip.js lost ${JSON.stringify(from)}`);
      out = out.split(from).join(to);
    }
    out = out.replace("root.TailzuBlip = api", "root.TailzuBlipCalm = api");
  }
  for (const [from, to, times] of RETUNE) {
    // The peek's figure() has its own copies of a few; only the walker's are counted.
    const walker = src.slice(src.indexOf("function walkerFigure"));
    const mine = walker.split(from).length - 1;
    if (mine !== times) throw new Error(`blip.js has ${mine} of ${JSON.stringify(from)} in its walker, this script expects ${times}: update RETUNE`);
    out = out.split(from).join(to);
  }
  return out;
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright") as { chromium: any }; // not a dependency: see the top
const executablePath = process.env.CHROMIUM;

const original = fs.readFileSync(blipJs, "utf8");
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent("<!doctype html><body style='margin:0;background:transparent'></body>");
await page.addScriptTag({ content: retuned(original, false) });
await page.addScriptTag({ content: retuned(original, true) });

const loops = [...BLIP_LOOPS].map((name) => {
  const [pose, size] = name.split("-") as [string, "s" | "l"];
  return { name, pose, size, H: BLIP_HEIGHT[size], calm: CALM_SIZES.has(size) };
});

type Cut = { name: string; size: string; frames: string[] };
const pageFn = fs.readFileSync(path.join(here, "blip-loops.page.js"), "utf8");
const args = { loops, frames: FRAMES, frameMs: FRAME_MS, dpr: DPR, look: { dot: OB.dot, sticker: OB.sticker, glow: OB.neon, paper: OB.surf } };
const cuts = (await page.evaluate(`(${pageFn})(${JSON.stringify(args)})`)) as Cut[];
await browser.close();

fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blip-"));
const files: Record<string, { w: number; h: number; bytes: number }> = {};
for (const c of cuts) {
  const dir = path.join(tmp, c.name);
  fs.mkdirSync(dir);
  c.frames.forEach((b64, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, "0")}.png`), Buffer.from(b64, "base64")));
  const out = path.join(outDir, `${c.name}.webp`);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-framerate", String(1000 / FRAME_MS), "-i", path.join(dir, "f%02d.png"),
    "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(QUALITY[c.size]), "-compression_level", "6", "-loop", "0",
    "-pix_fmt", "yuva420p", out,
  ]);
  // The size in points: the picture's pixels at 2x.
  const png = fs.readFileSync(path.join(dir, "f00.png"));
  const w = png.readUInt32BE(16) / DPR, h = png.readUInt32BE(20) / DPR;
  files[c.name] = { w, h, bytes: fs.statSync(out).size };
  console.log(`${c.name.padEnd(10)} ${String(w).padStart(4)} x ${String(h).padEnd(4)} pt  ${(files[c.name]!.bytes / 1024).toFixed(1)} KB`);
}
fs.rmSync(tmp, { recursive: true, force: true });

// The version in the URLs moves only when a picture does.
const prev = /\bv: (\d+)/.exec(fs.readFileSync(dataFile, "utf8"))?.[1];
const same = (() => {
  try {
    const old = fs.readFileSync(dataFile, "utf8");
    return Object.entries(files).every(([k, f]) => old.includes(`"${k}": { w: ${f.w}, h: ${f.h}, bytes: ${f.bytes} }`));
  } catch { return false; }
})();
const v = same ? Number(prev ?? 1) : Number(prev ?? 0) + 1;
fs.writeFileSync(
  dataFile,
  `/**
 * Written by scripts/make-blip-loops.ts: do not edit. The version is in every
 * picture's URL (blipLoops.ts), so a changed picture is a new URL; the sizes
 * are in points, so a screen lays each out at its true size.
 */
export const BLIP_BUILD: { v: number; frames: number; frameMs: number; files: Record<string, { w: number; h: number; bytes: number }> } = {
  v: ${v}, frames: ${FRAMES}, frameMs: ${FRAME_MS},
  files: {
${Object.entries(files).map(([k, f]) => `    "${k}": { w: ${f.w}, h: ${f.h}, bytes: ${f.bytes} },`).join("\n")}
  },
};
`,
);
const total = Object.values(files).reduce((n, f) => n + f.bytes, 0);
console.log(`${Object.keys(files).length} loops, ${(total / 1024).toFixed(0)} KB in all, version ${v}`);
