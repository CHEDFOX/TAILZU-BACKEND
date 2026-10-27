/**
 * THE HOST PAGE OF AN ARTIFACT'S SCREENSHOT (docs/artifacts.md section 11, viewer/docs/artifact-viewer.md section 14).
 *
 * The viewer is driven by postMessage: a parent page loads it in an iframe, waits for `ready`, sends `load`, and gets `rendered` back. A screenshot of an
 * artifact is therefore a screenshot of a PARENT PAGE, and this is that page. It is sent to the browser as inline HTML (Cloudflare's /screenshot takes
 * `html` instead of `url`), so there is nothing to host. The page
 *
 *   - puts the viewer in an iframe of exactly the viewport's size (`sandbox="allow-scripts"`, as the app does),
 *   - answers its `ready` with the artifact's `load` (and the project's kit, and the theme),
 *   - and when the viewer says `rendered`, waits a moment for web fonts and images (SETTLE_MS), then adds an element with id `done` to the page,
 *     which is what the screenshot waits for (`waitForSelector('#done')`).
 * An artifact that does not render never says `rendered`, so `#done` never comes and the shot times out instead of drawing something wrong.
 *
 * A page made from inline HTML has an OPAQUE origin ("null"). The viewer's `frame-ancestors` cannot name that, so the viewer used for shots is the one
 * deployed with VIEWER_PARENT_ORIGINS=null (viewer/docs section 14): it accepts a parent with no origin, and, because a policy cannot express it, can be
 * framed by any page. Keep it apart from the viewer the app uses. This file imports nothing but the protocol's types, so the viewer's own tests build the same page.
 */
import type { ArtifactPayload, DesignKitCss } from "./protocol.js";

export const SHOT_VIEWPORTS = {
  mobile: { width: 390, height: 844, mobile: true },
  desktop: { width: 1280, height: 800, mobile: false },
} as const;
export type ViewportName = keyof typeof SHOT_VIEWPORTS;
export const VIEWPORT_NAMES = Object.keys(SHOT_VIEWPORTS) as ViewportName[];

/** After `rendered`: the time web fonts and images are given before the picture is taken. */
export const SHOT_SETTLE_MS = 700;
/** The element the screenshot waits for. */
export const SHOT_DONE_SELECTOR = "#done";

export interface ShotHostOptions {
  /** The viewer's address (its origin; a path is ignored). */
  viewerUrl: string;
  artifact: Pick<ArtifactPayload, "id" | "type" | "title" | "content"> & { version: number };
  kit?: DesignKitCss;
  theme?: "light" | "dark";
  viewport: { width: number; height: number };
  settleMs?: number;
}

/** The viewer's origin, or null if `viewerUrl` is not an http(s) address. */
export function viewerOrigin(viewerUrl: string): string | null {
  try {
    const u = new URL(viewerUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** JSON that is safe inside a <script> element (and inside an HTML comment, and for old line terminators). */
const scriptJson = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const attr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function shotHostHtml(o: ShotHostOptions): string {
  const origin = viewerOrigin(o.viewerUrl);
  if (!origin) throw new Error("the viewer's address is not an http(s) address");
  const w = Math.max(1, Math.floor(o.viewport.width));
  const h = Math.max(1, Math.floor(o.viewport.height));
  const data = {
    artifact: { id: o.artifact.id, version: o.artifact.version, type: o.artifact.type, title: o.artifact.title, content: o.artifact.content },
    ...(o.theme ? { theme: o.theme } : {}),
    ...(o.kit ? { kit: o.kit } : {}),
    settleMs: Math.max(0, Math.floor(o.settleMs ?? SHOT_SETTLE_MS)),
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=${w},initial-scale=1"><title>shot</title>
<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}iframe{display:block;border:0;width:${w}px;height:${h}px}#done{position:fixed;left:0;top:0;width:0;height:0}</style></head>
<body><iframe id="v" title="artifact" sandbox="allow-scripts" src="${attr(origin)}/?type=${encodeURIComponent(o.artifact.type)}"></iframe>
<script>
(function () {
  var DATA = ${scriptJson(data)};
  var v = document.getElementById("v");
  var sent = false;
  var rendered = false;
  window.__shot = { events: [] };
  window.addEventListener("message", function (e) {
    if (e.source !== v.contentWindow) return;
    var m = e.data || {};
    window.__shot.events.push(String(m.t));
    if (m.t === "ready" && !sent) {
      sent = true;
      v.contentWindow.postMessage({ t: "load", artifact: DATA.artifact, theme: DATA.theme, kit: DATA.kit }, "*");
    } else if (m.t === "rendered" && !rendered) {
      rendered = true;
      setTimeout(function () {
        var d = document.createElement("div");
        d.id = "done";
        document.body.appendChild(d);
      }, DATA.settleMs);
    }
  });
})();
</script></body></html>`;
}

/**
 * The requests the browser may make while it shows the host page, as patterns for the screenshot's `allowRequestPattern`: the viewer's origin (its
 * page, runtime and libraries), Google's font hosts (the kit's fonts), and the schemes a page makes its own things with. An artifact's pictures from
 * other addresses are not fetched (the shot shows them blank: the compare is told).
 */
export function shotAllowPatterns(viewerUrl: string): string[] {
  const origin = viewerOrigin(viewerUrl);
  if (!origin) return [];
  const esc = origin.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [`^${esc}/`, "^https://fonts\\.googleapis\\.com/", "^https://fonts\\.gstatic\\.com/", "^data:", "^blob:", "^about:"];
}
