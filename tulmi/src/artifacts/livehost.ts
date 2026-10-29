/**
 * THE PAGE AN ARTIFACT RUNS IN, INSIDE THE APPS (the LiveView node: docs/bots-app.md section 8, viewer/docs/artifact-viewer.md section 2).
 *
 * The viewer is driven by postMessage from a parent page: wait for `ready`, send `load`, hear `rendered`, `select`, `error`, `open`. The phone
 * and the window have no web page of their own to be that parent, so the server writes one, and the app shows it in its LiveView node (the
 * phone: a WebView; the window: a webview in a session of its own), as the page's HTML with the origin it runs as (`origin`). This is that page:
 *
 *   - the viewer in an iframe that fills the page, `sandbox="allow-scripts"`, as viewer/docs section 2 asks;
 *   - `ready` answered by the artifact's `load` (its kit, the theme), and point-and-change switched on when `pick` is set;
 *   - what the app needs, passed UP as small, rebuilt messages: `{ t: "ready" }` once it has drawn, `{ t: "select", id, tag, text, name }` for a
 *     picked part, `{ t: "error", kind, message, line?, col? }` for the viewer's error, `{ t: "open", url }` for a link the person clicked (the
 *     app asks them before anything opens), `{ t: "failed", message }` when the viewer never starts or is sent away;
 *   - the app speaks DOWN through one function, `window.tzLive({ pick })`, to switch point-and-change on and off without reloading the page;
 *   - saved data and asking the bot are answered "not here" at once, so an artifact that uses them does not wait twenty seconds.
 *
 * UP is `window.ReactNativeWebView.postMessage` on the phone and `window.tailzuLive.post` in the window (its webview's own preload). Both can be
 * reached by the artifact's frames as well (a WebView's bridge is in every frame), so the apps treat every message as untrusted data: a
 * selection, an error to report, a link to OFFER. Nothing a message says is run.
 *
 * The page holds no token and no session: the apps run it in a WebView or a webview whose storage is its own and empty. Its origin (`origin`)
 * must be one the viewer lets frame it and talk to it (its VIEWER_PARENT_ORIGINS). The page's own policy allows its one script (by hash), the
 * viewer's frame, and nothing else: no network, no other frame, no form, no base.
 */
import { createHash } from "node:crypto";
import type { ArtifactPayload, DesignKitCss } from "./protocol.js";
import { viewerOrigin } from "./shothost.js";

/** How long the viewer has to say `ready` before the page says it failed. */
export const LIVE_START_MS = 15_000;

export interface LiveHostOptions {
  /** The app's viewer (its origin; a path is ignored). Not the viewer kept for screenshots. */
  viewerUrl: string;
  artifact: Pick<ArtifactPayload, "id" | "type" | "title" | "content"> & { version: number };
  kit?: DesignKitCss;
  theme?: "light" | "dark";
  /** Point to change from the start: a tap picks a part instead of using it. */
  pick?: boolean;
  startMs?: number;
}

/** JSON that is safe inside a <script> element (and inside an HTML comment, and for old line terminators). */
const scriptJson = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const attr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The page's one script. Kept as a function of its data so its hash names exactly what runs. */
function script(data: unknown): string {
  return `
(function () {
  var DATA = ${scriptJson(data)};
  var v = document.getElementById("v");
  var sent = false, pick = !!DATA.pick, gone = false, loads = 0, drawn = false;
  function up(m) {
    try {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function") window.ReactNativeWebView.postMessage(JSON.stringify(m));
      else if (window.tailzuLive && typeof window.tailzuLive.post === "function") window.tailzuLive.post(m);
    } catch (e) { /* nobody listening */ }
  }
  function down(m) { try { v.contentWindow.postMessage(m, "*"); } catch (e) { /* not there yet */ } }
  function cut(s, n) { return String(s == null ? "" : s).slice(0, n); }
  var KINDS = { button: "Button", a: "Link", input: "Field", textarea: "Field", select: "Field", img: "Picture", svg: "Picture", picture: "Picture",
    video: "Video", h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading", ul: "List", ol: "List", li: "List item",
    nav: "Menu", header: "Header", footer: "Footer", form: "Form", table: "Table", p: "Text", span: "Text", label: "Text", strong: "Text" };
  window.tzLive = function (m) {
    if (!m || typeof m !== "object" || typeof m.pick !== "boolean") return;
    pick = m.pick;
    if (sent) down({ t: "select-mode", on: pick });
  };
  v.addEventListener("load", function () {
    loads++;
    if (loads > 1 && !gone) { gone = true; up({ t: "failed", message: "The page went somewhere else." }); }
  });
  window.addEventListener("message", function (e) {
    if (e.source !== v.contentWindow || gone) return;
    var m = e.data;
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;
    switch (m.t) {
      case "ready":
        if (sent) return;
        sent = true;
        down({ t: "load", artifact: DATA.artifact, theme: DATA.theme, kit: DATA.kit });
        if (pick) down({ t: "select-mode", on: true });
        return;
      case "rendered":
        if (!drawn) { drawn = true; up({ t: "ready" }); }
        return;
      case "select": {
        var tag = cut(m.tag, 32).toLowerCase(), text = cut(m.text, 200).replace(/\\s+/g, " ").trim();
        var kind = KINDS[tag] || "Part";
        up({ t: "select", id: cut(m.elementId, 32), tag: tag, text: text, name: kind + (text ? " · " + text.slice(0, 40) : "") });
        return;
      }
      case "error":
        up({ t: "error", kind: cut(m.kind, 16), message: cut(m.message, 500),
          line: typeof m.line === "number" ? m.line : undefined, col: typeof m.col === "number" ? m.col : undefined });
        if (/navigated the viewer away/.test(String(m.message || ""))) { gone = true; up({ t: "failed", message: "The page went somewhere else." }); }
        return;
      case "open":
        if (typeof m.url === "string" && /^https?:\\/\\//i.test(m.url)) up({ t: "open", url: cut(m.url, 2000) });
        return;
      case "storage":
        down({ t: "storage-result", reqId: cut(m.reqId, 64), ok: false, error: "Saved data is not kept in this preview." });
        return;
      case "ask":
        down({ t: "ask-result", reqId: cut(m.reqId, 64), ok: false, error: "Asking the bot is not open in this preview." });
        return;
    }
  });
  setTimeout(function () { if (!sent && !gone) up({ t: "failed", message: "The preview did not start." }); }, DATA.startMs);
})();
`;
}

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("base64");

export function liveHostHtml(o: LiveHostOptions): string {
  const origin = viewerOrigin(o.viewerUrl);
  if (!origin) throw new Error("the viewer's address is not an http(s) address");
  const data = {
    artifact: { id: o.artifact.id, version: o.artifact.version, type: o.artifact.type, title: o.artifact.title, content: o.artifact.content },
    ...(o.theme ? { theme: o.theme } : {}),
    ...(o.kit ? { kit: o.kit } : {}),
    pick: o.pick === true,
    startMs: Math.max(1000, Math.floor(o.startMs ?? LIVE_START_MS)),
  };
  const js = script(data);
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256(js)}'`,
    "style-src 'unsafe-inline'",
    `frame-src ${origin}`,
    "img-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attr(csp)}"><meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${attr(o.artifact.title || "Preview")}</title>
<style>html,body{margin:0;padding:0;height:100%;background:#fff;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe id="v" title="${attr(o.artifact.title || "Preview")}" sandbox="allow-scripts" src="${attr(origin)}/?type=${encodeURIComponent(o.artifact.type)}"></iframe>
<script>${js}</script></body></html>`;
}

/** The address the apps' host page runs as, when the server names none: the viewer's own default parent (viewer/wrangler.jsonc). */
export const DEFAULT_APP_ORIGIN = "https://x0bot.com";

export interface LiveViewer {
  /** The app's viewer. */
  url: string;
  /** The origin the host page runs as in the apps: one of that viewer's VIEWER_PARENT_ORIGINS. */
  appOrigin: string;
}

/** The apps' viewer from the settings, or null when none is set (or either address is not usable). */
export function liveViewerOf(cfg: { ARTIFACT_VIEWER_URL?: string; ARTIFACT_APP_ORIGIN?: string }): LiveViewer | null {
  const url = (cfg.ARTIFACT_VIEWER_URL ?? "").trim();
  if (!url || !viewerOrigin(url)) return null;
  let appOrigin = DEFAULT_APP_ORIGIN;
  const named = (cfg.ARTIFACT_APP_ORIGIN ?? "").trim();
  if (named) {
    try {
      const u = new URL(named);
      if (u.protocol !== "https:") return null;
      appOrigin = u.origin;
    } catch {
      return null;
    }
  }
  return { url, appOrigin };
}
