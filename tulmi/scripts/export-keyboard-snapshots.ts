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

const { buildKeyboardConfig } = await import("../src/experience/keyboard/config.js");
const { KEY_FACE_STAMPS } = await import("../../shared/types/keyboardFace.js");
const app = process.argv[2];
if (!app) { console.error("usage: export-keyboard-snapshots.ts <frontend app dir>"); process.exit(2); }
// THE REAL STAMP, not a number typed here once. It used to be `KB_BUILD ?? 42` while the iOS keyboard was K44, so the bundled
// snapshot was the config an OLDER build would get — and the first thing a phone saw was a keyboard missing whatever the real
// stamp unlocks. The stamp now comes from the one place both sides read it (shared/types/keyboardFace.ts KEY_FACE_STAMPS), and
// KB_BUILD still overrides it for a one-off export.
const BUILD = Number(process.env.KB_BUILD ?? KEY_FACE_STAMPS.ios.replace(/^K/, ""));
if (!Number.isFinite(BUILD)) { console.error(`export-keyboard-snapshots: "${KEY_FACE_STAMPS.ios}" is not a K-stamp`); process.exit(2); }
const targets: Array<[string, "ios" | "android"]> = [
  ["targets/keyboard/default-config.json", "ios"],
  ["modules/tulmi-keyboard/android/res/raw/tailzu_default_config.json", "android"],
];
// UNSKINNED, always. The bundled snapshot is what the keyboard draws with no network and no Full Access, and what the crash
// guard falls back to after its last strike, so it must never depend on code a skin brings. No `skin` block, no faces: the
// expansion (experience/keyboard/skin.ts) is not called here at all.
for (const [rel, platform] of targets) {
  const cfg = buildKeyboardConfig(undefined, undefined, { platform, kbBuild: BUILD });
  const file = path.join(app, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg));
  console.log(`${platform}: ${rel} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
}
