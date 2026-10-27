import { renderMarkdown } from "../../lib/markdown.js";
import { morphHtml } from "../morph.js";
import type { Page, Renderer } from "./types.js";

/** Markdown → HTML by our own renderer (no raw HTML), morphed into the page so a streaming document grows without flicker. */
export function createMarkdownRenderer(page: Page): Renderer {
  return {
    async render(i) {
      morphHtml(page.root, renderMarkdown(i.src));
      page.surfaceChanged(window);
    },
    dispose() {
      page.root.replaceChildren();
    },
  };
}
