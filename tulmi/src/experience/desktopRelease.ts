/**
 * WHICH DESKTOP BUILD IS CURRENT, read from what was actually published.
 *
 * The desktop-build workflow sends each installer to this server with its
 * version (deploy/receive-download.sh), and the receiver writes the version
 * beside the file: downloads/Tailzu-Setup.exe.version and so on. So the
 * moment a build lands, every older install on that OS is told — in the
 * window, as a card, and by the tray's notification — with no number to
 * remember to raise and no deploy.
 *
 * Per OS, because the three are built and published separately: a Windows
 * release must not tell a Mac there is an update it cannot download yet.
 */
import fs from "node:fs";
import path from "node:path";

export type DesktopOs = "mac" | "windows" | "linux";

const FILES: Record<DesktopOs, string> = {
  windows: "Tailzu-Setup.exe",
  mac: "Tailzu.dmg",
  linux: "Tailzu.AppImage",
};

/** Where the site serves the installers from. */
const SITE_ORIGIN = "https://tailzu.space";

/** "darwin", "win32", "mac", "windows", "Windows_NT" … → one of three. */
export function desktopOs(os: unknown): DesktopOs | null {
  const o = String(os ?? "").toLowerCase();
  if (!o) return null;
  if (o === "mac" || o === "darwin" || o.startsWith("mac")) return "mac";
  if (o.startsWith("win")) return "windows";
  if (o === "linux") return "linux";
  return null;
}

/** -1, 0 or 1, by dotted number. "0.2.10" is newer than "0.2.9". */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i] ?? "0", 10) || 0, y = parseInt(pb[i] ?? "0", 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const cache = new Map<DesktopOs, { at: number; version: string }>();
const TTL_MS = 60_000;

function downloadsDir(): string {
  return process.env.DOWNLOADS_DIR || "/data/downloads";
}

/** The published version for this OS, or "" when none was recorded. */
export function publishedVersion(os: DesktopOs, now = Date.now()): string {
  const hit = cache.get(os);
  if (hit && now - hit.at < TTL_MS) return hit.version;
  let version = "";
  try {
    const v = fs.readFileSync(path.join(downloadsDir(), `${FILES[os]}.version`), "utf8").trim();
    if (VERSION.test(v)) version = v;
  } catch { /* nothing published with a version yet */ }
  cache.set(os, { at: now, version });
  return version;
}

/** Forget what was read, so a test (or a publish) is seen at once. */
export function resetPublishedVersions(): void {
  cache.clear();
}

export interface DesktopUpdate {
  version: string;
  /** The installer itself, not the page: one click and it downloads. */
  url: string;
}

/**
 * The update this install should be offered, or null.
 *
 * Needs both halves: a build that says which version it is, and a published
 * version for its OS. A build that says nothing is not guessed at.
 */
export function updateFor(appVersion: unknown, os: unknown, fallbackLatest = ""): DesktopUpdate | null {
  const o = desktopOs(os);
  const current = String(appVersion ?? "").trim();
  if (!o || !VERSION.test(current)) return null;
  const latest = publishedVersion(o) || (VERSION.test(fallbackLatest) ? fallbackLatest : "");
  if (!latest || compareVersions(current, latest) >= 0) return null;
  return { version: latest, url: `${SITE_ORIGIN}/downloads/${FILES[o]}` };
}

/** The direct installer link for this OS, for the tray's notification. */
export function installerUrl(os: unknown): string | null {
  const o = desktopOs(os);
  return o ? `${SITE_ORIGIN}/downloads/${FILES[o]}` : null;
}
