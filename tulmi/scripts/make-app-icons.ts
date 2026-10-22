/**
 * Cuts the app logos (tulmi/icons/<id>.png) from the Simple Icons set.
 *
 *   PLAYWRIGHT=/opt/node-tools/node_modules/playwright \
 *   CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *   npx tsx scripts/make-app-icons.ts
 *
 * Needs a Chromium (Playwright's) and, to keep the files small, ImageMagick's
 * `convert`. Neither is a dependency of the backend, and simple-icons is a
 * devDependency for this script alone: it is run by hand when an app is added
 * to the catalog, and the files it writes are committed (icons/*.png,
 * src/experience/appIconData.ts). Nothing here runs on the server, and no
 * logo is ever fetched from anywhere at run time.
 *
 * WHAT IT DRAWS. Each logo is a Simple Icons glyph (CC0) on a rounded square,
 * the way app tiles look: white on the brand's own colour, or, where the
 * brand's colour is too light for white (or the brand is shown in colour on
 * white, as Google's apps are), the glyph in the brand's colour on white. A
 * hairline keeps a white tile and a black tile visible on either theme.
 *
 * AN APP SIMPLE ICONS HAS NO GLYPH FOR (Granola, Otter, Fireflies, Monday.com,
 * Composio, Pipedream, UPI, Amazon, Flipkart) has no entry here and keeps the
 * letter badge. Phone, Shopping and Play are not one company's, so they keep
 * it too. An app a person added by link never gets a logo (appIcons.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as simple from "simple-icons";

const SIZE = 128;
/** The corner radius, as the tile's size is drawn in the screens (0.29 of it, like the letter badge's). */
const RADIUS = Math.round(SIZE * 0.22);
/** The glyph's share of the tile. */
const GLYPH = 0.58;
/** A file over this is squeezed to a smaller palette. */
const SQUEEZE_OVER = 5500;

/** "dark": white glyph on the brand's colour. "light": the brand's colour on white. */
type Look = "dark" | "light";
interface Spec { id: string; slug: string; look: Look; }

/** The catalog's ids (and the services the hand-offs open) that have a glyph. Everything else keeps the badge. */
const SPECS: Spec[] = [
  { id: "notion", slug: "notion", look: "light" },
  { id: "linear", slug: "linear", look: "dark" },
  { id: "github", slug: "github", look: "dark" },
  { id: "atlassian", slug: "atlassian", look: "dark" },
  { id: "asana", slug: "asana", look: "dark" },
  { id: "zapier", slug: "zapier", look: "dark" },
  { id: "google-calendar", slug: "googlecalendar", look: "light" },
  { id: "google-docs", slug: "googledocs", look: "light" },
  { id: "google-sheets", slug: "googlesheets", look: "light" },
  { id: "google-forms", slug: "googleforms", look: "light" },
  { id: "google-tasks", slug: "googletasks", look: "light" },
  { id: "google-classroom", slug: "googleclassroom", look: "light" },
  { id: "youtube", slug: "youtube", look: "light" },
  { id: "todoist", slug: "todoist", look: "dark" },
  { id: "calendly", slug: "calendly", look: "dark" },
  { id: "evernote", slug: "evernote", look: "dark" },
  { id: "clickup", slug: "clickup", look: "dark" },
  { id: "trello", slug: "trello", look: "dark" },
  { id: "calcom", slug: "caldotcom", look: "dark" },
  { id: "airtable", slug: "airtable", look: "light" },
  { id: "make", slug: "make", look: "dark" },
  // The hand-offs. Gmail, Maps, WhatsApp, Telegram, Uber, Threads and Booking.com are catalog ids;
  // Spotify and YouTube Music are two of the three services the Play hand-off opens (and Amazon and
  // Flipkart, the Shopping hand-off's, have no glyph), so they go by their own names, not Play's.
  { id: "email-handoff", slug: "gmail", look: "light" },
  { id: "whatsapp", slug: "whatsapp", look: "dark" },
  { id: "telegram", slug: "telegram", look: "dark" },
  { id: "maps", slug: "googlemaps", look: "light" },
  { id: "uber", slug: "uber", look: "dark" },
  { id: "threads", slug: "threads", look: "dark" },
  { id: "booking", slug: "bookingdotcom", look: "dark" },
  { id: "spotify", slug: "spotify", look: "light" },
  { id: "youtube-music", slug: "youtubemusic", look: "light" },
];

const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, "..", "icons");
const dataFile = path.join(here, "..", "src", "experience", "appIconData.ts");

const bySlug = new Map(Object.values(simple).filter((i): i is simple.SimpleIcon => !!i && typeof i === "object" && "slug" in i).map((i) => [i.slug, i]));

/** Is a colour dark enough for the hairline to be white? (relative luminance) */
function isDark(hex: string): boolean {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! < 0.08;
}

function tile(s: Spec): string {
  const icon = bySlug.get(s.slug);
  if (!icon) throw new Error(`Simple Icons has no ${s.slug} (for ${s.id}): take it out of SPECS, it keeps the badge`);
  const brand = `#${icon.hex}`;
  const bg = s.look === "dark" ? brand : "#ffffff";
  const fg = s.look === "dark" ? "#ffffff" : brand;
  const edge = isDark(s.look === "dark" ? icon.hex : "ffffff") ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.10)";
  const px = SIZE * GLYPH;
  const k = px / 24;
  const off = (SIZE - px) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${bg}"/>
<rect x="0.75" y="0.75" width="${SIZE - 1.5}" height="${SIZE - 1.5}" rx="${RADIUS - 0.75}" fill="none" stroke="${edge}" stroke-width="1.5"/>
<g transform="translate(${off} ${off}) scale(${k})"><path fill="${fg}" d="${icon.path}"/></g>
</svg>`;
}

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright") as { chromium: any }; // not a dependency: see the top
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.endsWith(".png")) fs.rmSync(path.join(outDir, f));

const files: Record<string, { bytes: number }> = {};
for (const s of SPECS) {
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${tile(s)}</body>`);
  const file = path.join(outDir, `${s.id}.png`);
  fs.writeFileSync(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } }));
  if (fs.statSync(file).size > SQUEEZE_OVER) {
    // Flat colour and a few anti-aliased edges: a small palette, with its alpha, loses nothing the eye can find.
    try {
      const tmp = `${file}.tmp.png`;
      execFileSync("convert", [file, "-strip", "-colors", "64", `PNG8:${tmp}`]);
      fs.renameSync(tmp, file);
    } catch { /* no ImageMagick: the file stays as drawn, and the test says if it is too big */ }
  }
  files[s.id] = { bytes: fs.statSync(file).size };
}
await browser.close();

const prev = /v: (\d+),/.exec(fs.existsSync(dataFile) ? fs.readFileSync(dataFile, "utf8") : "")?.[1];
const version = Number(process.env.ICONS_V ?? prev ?? 1);
fs.writeFileSync(
  dataFile,
  `/**
 * Written by scripts/make-app-icons.ts: do not edit. The version is in every
 * logo's URL (appIcons.ts), so a changed logo is a new URL; bump it with
 * ICONS_V=<n> when a picture changes. The sizes are in bytes.
 */
export const APP_ICON_BUILD: { v: number; size: number; files: Record<string, { bytes: number }> } = {
  v: ${version}, size: ${SIZE},
  files: {
${Object.entries(files).map(([id, f]) => `    ${JSON.stringify(id)}: { bytes: ${f.bytes} },`).join("\n")}
  },
};
`,
);
const total = Object.values(files).reduce((n, f) => n + f.bytes, 0);
console.log(`${SPECS.length} logos, ${total} bytes, largest ${Math.max(...Object.values(files).map((f) => f.bytes))}`);
