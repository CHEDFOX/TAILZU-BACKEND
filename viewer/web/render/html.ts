import { cdnLib } from "../../lib/cdn.js";
import { prepareHtml } from "../../lib/markup.js";
import { lineColAt, lineStarts } from "../../lib/text.js";
import { looksLikeTailwind } from "../../lib/tailwind.js";
import { ViewerError } from "../errors.js";
import { nextFrame, type Page, type RenderInput, type Renderer } from "./types.js";

/**
 * An HTML artifact lives in a frame of its own, inside the shell: a new document per version, so the scripts, timers and listeners
 * of the old version die with it. (The frame is sandboxed like the shell, so it has an opaque origin of its own and the shell cannot
 * touch it: the two talk by postMessage, see web/frame.ts.)
 *
 * The shell's CSP has no 'unsafe-inline', so the markup goes through lib/markup.ts first: element ids go in, `<script>` bodies and
 * `on…=` attributes come out, and the frame's bootstrap runs them from blob URLs in document order.
 *
 * While the source is streaming nothing runs: the markup so far is morphed into one visible frame, so it grows in place. When the
 * source is final a complete frame is built out of sight and swapped in when its scripts have run.
 */

const FRAME_WAIT_MS = 8000;

interface FrameData {
  mode: "page" | "stream";
  theme: "light" | "dark";
  kit: RenderInput["kit"];
  select: boolean;
  tailwind: { url: string } | null;
  scripts: unknown[];
  handlers: unknown[];
}

/** JSON that is safe inside a <script> element. */
const dataBlock = (d: FrameData): string => `<script type="application/json" id="tz-data">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`;

export function createHtmlRenderer(page: Page): Renderer {
  let streamFrame: HTMLIFrameElement | null = null;
  const frameUrl = (): string => import.meta.resolve("@tz/frame");
  const tailwindUrl = (): string => import.meta.resolve("@tz/tailwind");

  /** Resolves true when the frame says `k`, false after `ms`. Listen before the frame can speak. */
  function expect(frame: HTMLIFrameElement, k: "ready" | "done", ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const on = (e: MessageEvent): void => {
        const d = e.data as { tz?: number; k?: string } | null;
        if (e.source === frame.contentWindow && d?.tz === 1 && d.k === k) end(true);
      };
      const timer = setTimeout(() => end(false), ms);
      const end = (v: boolean): void => {
        removeEventListener("message", on);
        clearTimeout(timer);
        resolve(v);
      };
      addEventListener("message", on);
    });
  }

  function mount(srcdoc: string): HTMLIFrameElement {
    const f = document.createElement("iframe");
    f.className = "tz-frame";
    f.setAttribute("title", "artifact");
    f.style.visibility = "hidden";
    f.srcdoc = srcdoc;
    page.frames.appendChild(f);
    return f;
  }

  function reveal(f: HTMLIFrameElement): void {
    f.style.visibility = "visible";
    for (const other of Array.from(page.frames.children)) if (other !== f) other.remove();
    f.contentWindow?.postMessage({ tz: 1, k: "measure" }, "*");
  }

  // `crossorigin`: the frame's origin is opaque, so without it an error inside the bootstrap would reach window.onerror as "Script error."
  const bootstrap = (): string => `<script crossorigin="anonymous" src="${frameUrl()}"></script>`;
  const importMap = (): string => `<script type="importmap">${page.importMapText}</script>`;

  async function stream(i: RenderInput): Promise<void> {
    if (!streamFrame || !streamFrame.isConnected) {
      const data: FrameData = {
        mode: "stream",
        theme: i.theme,
        kit: i.kit,
        select: page.instrument.select.on,
        tailwind: i.kit?.tailwind || looksLikeTailwind(i.src) ? { url: tailwindUrl() } : null,
        scripts: [],
        handlers: [],
      };
      const f = mount(`<!doctype html><html><head><meta charset="utf-8">${importMap()}</head><body></body></html>${dataBlock(data)}${bootstrap()}`);
      const ready = expect(f, "ready", FRAME_WAIT_MS);
      streamFrame = f;
      await ready;
      if (i.isStale()) {
        f.remove();
        streamFrame = null;
        return;
      }
      reveal(f);
    }
    streamFrame.contentWindow?.postMessage({ tz: 1, k: "morph", html: prepareHtml(i.src, { streaming: true }).html }, "*");
  }

  async function full(i: RenderInput): Promise<void> {
    const babel = /<script\b[^>]*\btype\s*=\s*["']?text\/(?:babel|jsx)/i.exec(i.src);
    if (babel) {
      const at = lineColAt(lineStarts(i.src), babel.index);
      throw new ViewerError("compile", 'JSX inside an HTML page is not supported (there is no Babel here). Make this a "react" artifact, or write plain JavaScript.', at.line, at.col);
    }
    const p = prepareHtml(i.src, {
      afterDoctype: importMap(),
      atEnd: ({ scripts, handlers }) => {
        const wantsTailwind = !!i.kit?.tailwind || looksLikeTailwind(i.src) || scripts.some((s) => s.src !== null && cdnLib(s.src) === "tailwind");
        const data: FrameData = { mode: "page", theme: i.theme, kit: i.kit, select: page.instrument.select.on, tailwind: wantsTailwind ? { url: tailwindUrl() } : null, scripts, handlers };
        return dataBlock(data) + bootstrap();
      },
    });
    const f = mount(p.html);
    const done = expect(f, "done", FRAME_WAIT_MS);
    await done;
    await nextFrame(window);
    if (i.isStale()) {
      f.remove();
      return;
    }
    streamFrame = null;
    reveal(f);
  }

  return {
    async render(i) {
      if (i.final) await full(i);
      else await stream(i);
    },
    dispose() {
      page.frames.replaceChildren();
      streamFrame = null;
    },
  };
}
