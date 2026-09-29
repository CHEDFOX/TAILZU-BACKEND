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
const SHA512 = /^[a-f0-9]{128}$/;
const cache = new Map<DesktopOs, { at: number; version: string; sha512: string }>();
const TTL_MS = 60_000;

function downloadsDir(): string {
  return process.env.DOWNLOADS_DIR || "/data/downloads";
}

/**
 * What was published for this OS: its version, and the installer's SHA-512
 * (receive-download.sh writes both beside it). Either is "" when not recorded.
 */
export function publishedRelease(os: DesktopOs, now = Date.now()): { version: string; sha512: string } {
  const hit = cache.get(os);
  if (hit && now - hit.at < TTL_MS) return { version: hit.version, sha512: hit.sha512 };
  const read = (ext: string, ok: RegExp) => {
    try {
      const v = fs.readFileSync(path.join(downloadsDir(), `${FILES[os]}.${ext}`), "utf8").trim().toLowerCase();
      return ok.test(v) ? v : "";
    } catch { return ""; }
  };
  const version = read("version", VERSION), sha512 = read("sha512", SHA512);
  cache.set(os, { at: now, version, sha512 });
  return { version, sha512 };
}

/** The published version for this OS, or "" when none was recorded. */
export function publishedVersion(os: DesktopOs, now = Date.now()): string {
  return publishedRelease(os, now).version;
}

/** Forget what was read, so a test (or a publish) is seen at once. */
export function resetPublishedVersions(): void {
  cache.clear();
}

export interface DesktopUpdate {
  version: string;
  /** The installer itself, not the page: one click and it downloads. */
  url: string;
  /**
   * The installer's SHA-512, when it was recorded. A build that installs its
   * own update checks the download against it, and is offered that only when
   * there is one to check against.
   */
  sha512?: string;
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
  const rel = publishedRelease(o);
  const latest = rel.version || (VERSION.test(fallbackLatest) ? fallbackLatest : "");
  if (!latest || compareVersions(current, latest) >= 0) return null;
  // The checksum belongs to the published file, so it only stands for the
  // version that was published with it — never for the fallback number.
  const sha512 = rel.version === latest && rel.sha512 ? rel.sha512 : undefined;
  return { version: latest, url: `${SITE_ORIGIN}/downloads/${FILES[o]}`, ...(sha512 ? { sha512 } : {}) };
}

/** The direct installer link for this OS, for the tray's notification. */
export function installerUrl(os: unknown): string | null {
  const o = desktopOs(os);
  return o ? `${SITE_ORIGIN}/downloads/${FILES[o]}` : null;
}
