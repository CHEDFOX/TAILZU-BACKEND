import { ViewerError } from "../errors.js";
import { morphHtml } from "../morph.js";
import type { Page, Renderer } from "./types.js";

type Mermaid = (typeof import("mermaid"))["default"];

let counter = 0;

/** A Mermaid diagram. The library (several MB, in chunks) is imported only now, the first time one is shown. */
export function createMermaidRenderer(page: Page): Renderer {
  let mermaid: Mermaid | null = null;
  let configuredFor = "";

  return {
    async render(i) {
      if (!mermaid) mermaid = (await import("mermaid")).default;
      if (i.isStale()) return;
      if (configuredFor !== i.theme) {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: i.theme === "dark" ? "dark" : "default", suppressErrorRendering: true, fontFamily: "inherit" });
        configuredFor = i.theme;
      }
      const id = `tzm${++counter}`;
      let svg: string;
      try {
        ({ svg } = await mermaid.render(id, i.src));
      } catch (e) {
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
        const message = String((e as { message?: unknown })?.message ?? e).split("\n").slice(0, 6).join("\n");
        const line = /line (\d+)/i.exec(message);
        throw new ViewerError("compile", message, line ? Number(line[1]) : undefined);
      }
      if (i.isStale()) return;
      morphHtml(page.root, `<div class="tz-mermaid">${svg}</div>`);
      page.surfaceChanged(window);
    },
    dispose() {
      page.root.replaceChildren();
    },
  };
}
