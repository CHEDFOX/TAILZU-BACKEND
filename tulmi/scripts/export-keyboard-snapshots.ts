/**
 * The keyboard config the server would send a signed-out phone, written as
 * files for the keyboards to carry inside the app — so the very first open,
 * before any fetch has ever succeeded, draws the server's keyboard and not a
 * hand-built fallback. Re-run before a store build:
 *
 *   npx tsx scripts/export-keyboard-snapshots.ts ../../TAILZU-FRONTEND/app
 *
 * writes targets/keyboard/default-config.json (iOS) and
 * modules/tulmi-keyboard/android/res/raw/tailzu_default_config.json (Android).
 */
import fs from "node:fs";
import path from "node:path";

process.env.OPENROUTER_API_KEY ??= "snapshot";
process.env.OPENAI_API_KEY ??= "snapshot";
process.env.STT_PROVIDER ??= "openai";
process.env.DEV_SKIP_AUTH ??= "true";

const { buildKeyboardConfig } = await import("../src/experience/catalog.js");
const app = process.argv[2];
if (!app) { console.error("usage: export-keyboard-snapshots.ts <frontend app dir>"); process.exit(2); }
// The builds these snapshots ship inside: the bundled config is the one the
// NEW binary opens with, so it must be what the server sends that binary.
const BUILD = Number(process.env.KB_BUILD ?? 43);
const ANDROID_BUILD = Number(process.env.KB_ANDROID_BUILD ?? 4);
const targets: Array<[string, "ios" | "android"]> = [
  ["targets/keyboard/default-config.json", "ios"],
  ["modules/tulmi-keyboard/android/res/raw/tailzu_default_config.json", "android"],
];
for (const [rel, platform] of targets) {
  const cfg = buildKeyboardConfig(undefined, undefined, { platform, kbBuild: BUILD, androidBuild: ANDROID_BUILD });
  const file = path.join(app, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg));
  console.log(`${platform}: ${rel} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}
