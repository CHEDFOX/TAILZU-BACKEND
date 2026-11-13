/**
 * SEE A DESIGN BEFORE A PHONE HAS IT (native/SPEC.md section 5.4).
 *
 *   cd tulmi && npx tsx scripts/native-render/render.ts --design x0.dusk --data working
 *   cd tulmi && npx tsx scripts/native-render/render.ts --all                 every design, every sample
 *   cd tulmi && npx tsx scripts/native-render/render.ts --design bots.night --data activity-needs
 *   KEYBOARD_SKINS=true npx tsx scripts/native-render/render.ts --skin clay-dusk   the keyboard skin (skin.ts)
 *
 * Writes into scripts/native-render/out/ (or --out):
 *   <design>.<data>.png          every root of that design, at its real point size, dark and light, side by side
 *   <design>.<data>.modes.png    the same small and rect roots in the modes the SYSTEM imposes: tinted, Always-On, the Lock
 *                                Screen's monochrome, StandBy. A design that only ever gets looked at on a Home Screen is a
 *                                design that will embarrass someone on a Lock Screen
 *   index.html                   all of it on one page, for a scroll through (also written by preview.ts, with a picker)
 *
 * HONESTY. The browser is not SwiftUI and not RemoteViews: text measures a little differently, so a line can break one word
 * earlier or later than on a device. Shapes, spacing, colour, the palette roles, what a bound path resolves to and what hides
 * are the real rules, read from the same files the phones read. The device snapshot tests (section 8) are the truth.
 *
 * As a module: `sheetFor()` builds one design's HTML, so preview.ts and a CI job can use it without a browser.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { NLookCatalog, NLookDesign, NLookPalette } from "../../../shared/types/nlook.js";
import { ROOT_SIZES, page, renderRoot, type Mode, type Scheme } from "./ref.js";
import { skinSheet } from "./skin.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const TULMI = path.resolve(HERE, "../..");
const CATALOG = path.resolve(TULMI, "../shared/native/looks.json");
const SAMPLES = path.join(HERE, "samples");

export function catalog(): NLookCatalog {
  return JSON.parse(fs.readFileSync(CATALOG, "utf8")) as NLookCatalog;
}

export function sample(name: string): Record<string, unknown> {
  const file = name.endsWith(".json") ? path.resolve(name) : path.join(SAMPLES, `${name}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** Which sample a design is drawn against by default: an activity design wants a ContentState, a widget wants a glance. */
export function defaultData(d: NLookDesign): string[] {
  if (d.surface === "activity") return ["activity-working", "activity-needs", "activity-done"];
  if (d.surface === "liveupdate") return ["activity-working"];
  return ["needs", "working", "done", "quiet"];
}

const paletteOf = (c: NLookCatalog, d: NLookDesign): NLookPalette =>
  c.palettes[d.palette ?? ""] ?? Object.values(c.palettes)[0]!;

/** Every root of one design, dark and light, at its real point size. */
export function sheetFor(c: NLookCatalog, d: NLookDesign, data: Record<string, unknown>, dataName: string): string {
  const palette = paletteOf(c, d);
  const cards: Array<{ label: string; html: string; dark: boolean }> = [];
  for (const root of Object.keys(d.roots ?? {})) {
    const size = ROOT_SIZES[root] ?? { w: 158, h: 158 };
    for (const scheme of ["dark", "light"] as Scheme[]) {
      // The island is black whatever the phone's appearance, so it is only ever shown once.
      if (root.startsWith("island") || root.startsWith("compact") || root === "minimal") { if (scheme === "light") continue; }
      const mode: Mode = root === "rect" || root === "circle" || root === "inline" ? "mono" : "full";
      cards.push({
        label: `${d.id} · ${root} · ${scheme}${mode === "mono" ? " · accessory" : ""} · ${dataName}`,
        html: renderRoot({ design: d, root, palette, scheme, mode, data, width: size.w, height: size.h, standby: mode === "mono" }),
        dark: scheme === "dark",
      });
    }
  }
  return page(`${d.id} — ${dataName}`, cards);
}

/** The modes the SYSTEM imposes, which a design does not get to opt out of: tinted, Always-On, accessory, StandBy. */
export function modesFor(c: NLookCatalog, d: NLookDesign, data: Record<string, unknown>): string {
  const palette = paletteOf(c, d);
  const root = d.roots?.small ? "small" : Object.keys(d.roots ?? {})[0] ?? "small";
  const size = ROOT_SIZES[root] ?? { w: 158, h: 158 };
  const shots: Array<[string, Partial<Parameters<typeof renderRoot>[0]>]> = [
    ["Home Screen", { mode: "full" }],
    ["tinted (iOS 18)", { mode: "accented" }],
    ["Always-On", { mode: "full", reduced: true }],
    ["StandBy", { mode: "full", standby: true }],
    ["accessory, monochrome", { mode: "mono", standby: true }],
  ];
  const cards = shots.map(([label, over]) => ({
    label: `${d.id} · ${root} · ${label}`,
    html: renderRoot({ design: d, root, palette, scheme: "dark", data, width: size.w, height: size.h, ...over }),
    dark: true,
  }));
  return page(`${d.id} — the system's own modes`, cards);
}

// ---------------------------------------------------------------- the browser

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function playwright(): any {
  const roots = [...(process.env.NODE_PATH ?? "").split(":").filter(Boolean), "/opt/node-tools/node_modules", path.join(TULMI, "node_modules")];
  for (const r of roots) {
    try { return createRequire(path.join(r, "x.js"))("playwright"); } catch { /* next */ }
  }
  throw new Error("native-render: Playwright not found (set NODE_PATH to a node_modules that has it)");
}

/** One HTML page to one PNG, cropped to what it drew. */
export async function shoot(html: string, file: string): Promise<void> {
  const browser = await playwright().chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await p.setContent(html, { waitUntil: "load" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- the command

function arg(name: string, fallback = ""): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] && !process.argv[at + 1]!.startsWith("--") ? process.argv[at + 1]! : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const c = catalog();
  const out = arg("out", path.join(HERE, "out"));
  // A KEYBOARD SKIN is not a design and has no roots: it is the expanded key tree (scripts/native-render/skin.ts).
  const skin = arg("skin");
  if (skin) {
    const sheet = skinSheet(skin);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `skin.${skin}.html`), sheet);
    if (!has("html-only")) await shoot(sheet, path.join(out, `skin.${skin}.png`));
    console.log(`skin ${skin}${has("html-only") ? "" : " · png"}\n${path.join(out, `skin.${skin}.png`)}`);
    return;
  }
  const only = arg("design");
  const designs = Object.values(c.designs).filter((d) => (only ? d.id === only : has("all") || d.id === "x0.dusk"));
  if (!designs.length) {
    console.error(`native-render: no design matched. The catalog holds: ${Object.keys(c.designs).join(", ")}`);
    process.exit(2);
  }
  const noShots = has("html-only");
  const links: string[] = [];
  for (const d of designs) {
    const datas = arg("data") ? [arg("data")] : defaultData(d);
    for (const name of datas) {
      const data = sample(name);
      const sheet = sheetFor(c, d, data, name);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `${d.id}.${name}.html`), sheet);
      links.push(`${d.id}.${name}.html`);
      if (!noShots) await shoot(sheet, path.join(out, `${d.id}.${name}.png`));
      console.log(`${d.id} · ${name}${noShots ? "" : " · png"}`);
    }
    if (d.surface === "widget") {
      const modes = modesFor(c, d, sample(defaultData(d)[0]!));
      fs.writeFileSync(path.join(out, `${d.id}.modes.html`), modes);
      links.push(`${d.id}.modes.html`);
      if (!noShots) await shoot(modes, path.join(out, `${d.id}.modes.png`));
    }
  }
  fs.writeFileSync(path.join(out, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>native looks</title><body style="font:400 14px system-ui;padding:24px">
<h1 style="font-size:18px">Native looks — catalog v${c.v}</h1><ul>${links.map((l) => `<li><a href="${l}">${l}</a></li>`).join("")}</ul></body>`);
  console.log(`\n${path.join(out, "index.html")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
