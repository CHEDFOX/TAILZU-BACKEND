/**
 * The bootstrap an html artifact's frame loads (a classic script, last in its document).
 *
 * The frame is a sandboxed document of its own (an opaque origin, different from the shell's), so the shell cannot reach into it:
 * everything goes by postMessage, in the shell's own small vocabulary:
 *
 *   frame → shell   { tz: 1, k: "up", msg }      a FrameMsg for the app (error, select, storage, ask, download, resize): the shell checks and relays it
 *                   { tz: 1, k: "done" }         the page has run its scripts and loaded
 *                   { tz: 1, k: "ready" }        (stream frames) ready for markup
 *   shell → frame   { tz: 1, k: "down", msg }    a storage-result / ask-result from the app
 *                   { tz: 1, k: "select", on }   point-and-change on or off
 *                   { tz: 1, k: "morph", html }  (stream frames) the markup so far
 *                   { tz: 1, k: "measure" }      report your height again
 *
 * The page's data (kit, theme, scripts, handlers) is in <script type="application/json" id="tz-data">.
 */
import type { DesignKitCss, FrameMsg } from "../../tulmi/src/artifacts/protocol.js";
import type { HtmlHandler, HtmlScript } from "../lib/markup.js";
import { createBridge } from "./bridge.js";
import { createReporter } from "./errors.js";
import { runPage, watchAddedHandlers } from "./frame-run.js";
import { instrument, watchHeight, type SelectState } from "./instrument.js";
import { applyTheme, installKit } from "./kit.js";
import { morphAttributes, morphChildren } from "./morph.js";
import { makeOverlay } from "./overlay.js";
import { ensureTailwind } from "./tailwind.js";

interface FrameData {
  mode: "page" | "stream";
  theme: "light" | "dark";
  kit?: DesignKitCss;
  select: boolean;
  tailwind: { url: string } | null;
  scripts: HtmlScript[];
  handlers: HtmlHandler[];
}

const toShell = (m: object): void => parent.postMessage({ tz: 1, ...m }, "*");
const post = (msg: FrameMsg): void => toShell({ k: "up", msg });

const data = JSON.parse(document.getElementById("tz-data")!.textContent!) as FrameData;
const reporter = createReporter(post);
const bridge = createBridge(post, (message) => reporter.report("limit", message));
const select: SelectState = { on: data.select };
const showOverlay = makeOverlay(document);

instrument(window, { bridge, reporter, select, post, hover: (el) => showOverlay(select.on ? el : null) });
applyTheme(document, data.theme);
installKit(document, data.kit, "before-head");
document.documentElement.toggleAttribute("data-tz-select", select.on);
watchAddedHandlers();

let lastHeight = 0;
watchHeight(window, (h) => {
  lastHeight = h;
  post({ t: "resize", height: h });
});

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== parent) return;
  const m = e.data as { tz?: number; k?: string; msg?: { t?: string; reqId?: string }; on?: boolean; html?: string };
  if (!m || m.tz !== 1) return;
  switch (m.k) {
    case "down":
      if (m.msg && (m.msg.t === "storage-result" || m.msg.t === "ask-result") && typeof m.msg.reqId === "string") bridge.handle(m.msg as Parameters<typeof bridge.handle>[0]);
      break;
    case "select":
      select.on = m.on === true;
      document.documentElement.toggleAttribute("data-tz-select", select.on);
      if (!select.on) showOverlay(null);
      break;
    case "measure":
      if (lastHeight) post({ t: "resize", height: lastHeight });
      break;
    case "morph":
      if (typeof m.html === "string") morph(m.html);
      break;
  }
});

let headHtml = "";
let tailwindStarted = false;
function morph(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  // The kit and anything the viewer added sit beside <head>, not in it, so the markup's head can be replaced as a whole.
  if (parsed.head.innerHTML !== headHtml) {
    headHtml = parsed.head.innerHTML;
    morphChildren(document.head, parsed.head);
  }
  morphAttributes(document.body, parsed.body);
  morphChildren(document.body, parsed.body);
  if (data.tailwind && !tailwindStarted && /\bclass(?:Name)?\s*=/.test(html)) {
    tailwindStarted = true;
    void ensureTailwind(document, window, data.kit, data.tailwind.url);
  }
}

async function main(): Promise<void> {
  if (data.mode === "stream") {
    toShell({ k: "ready" });
    return;
  }
  if (document.readyState === "loading") await new Promise<void>((r) => document.addEventListener("DOMContentLoaded", () => r(), { once: true }));
  if (data.tailwind) await ensureTailwind(document, window, data.kit, data.tailwind.url);
  await runPage(data, reporter);
  // The page's own scripts ran after the real DOMContentLoaded: give the listeners they added the event they were waiting for.
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  if (document.readyState === "complete") window.dispatchEvent(new Event("load"));
  toShell({ k: "done" });
}
void main().catch((e) => {
  reporter.reportError(e);
  toShell({ k: "done" });
});
