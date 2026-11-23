/**
 * THE DESKTOP'S OVERLAY PAGES, AS PUBLISHED: the UI bundle the desktop's ui workflow sends to
 * deploy/receive-download.sh, which writes downloads/ui/<v>.json and then downloads/ui/latest.json
 * ({ format, v, sha256, size, minApp }). The bootstrap names it ("desktop.ui": { v, url, sha256, minApp }) and the
 * desktop fetches it from /downloads/ui/<v>.json, checks it against sha256, and loads it when it is new enough
 * (desktop src/main/uiBundle.js). Nothing published, or anything off in latest.json: no flag, built-in pages.
 */
import fs from "node:fs";
import path from "node:path";

export interface DesktopUiBundle {
  v: string;
  url: string;
  sha256: string;
  minApp: string;
}

const V_RE = /^[0-9]{14}-[0-9a-f]{7,40}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const TTL_MS = 60_000;
let cache: { at: number; value: DesktopUiBundle | null } | null = null;

function downloadsDir(): string {
  return process.env.DOWNLOADS_DIR || "/data/downloads";
}

/** What latest.json names, when it is well formed and its bundle is in place beside it (at the size it says). */
export function publishedUiBundle(now = Date.now()): DesktopUiBundle | null {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  let value: DesktopUiBundle | null = null;
  try {
    const dir = path.join(downloadsDir(), "ui");
    const m = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8")) as Record<string, unknown>;
    const v = String(m.v ?? ""), sha256 = String(m.sha256 ?? "").toLowerCase(), minApp = String(m.minApp ?? "");
    if (m.format === 1 && V_RE.test(v) && SHA_RE.test(sha256) && VERSION_RE.test(minApp)) {
      const st = fs.statSync(path.join(dir, `${v}.json`));
      if (st.isFile() && (m.size === undefined || m.size === st.size)) value = { v, url: `/downloads/ui/${v}.json`, sha256, minApp };
    }
  } catch { value = null; }
  cache = { at: now, value };
  return value;
}

/** Forget what was read, so a test (or a publish) is seen at once. */
export function resetPublishedUiBundle(): void {
  cache = null;
}

/** The bootstrap's word on it: nothing when there is none. */
export function uiBundleFlags(): Record<string, unknown> {
  const b = publishedUiBundle();
  return b ? { "desktop.ui": b } : {};
}
