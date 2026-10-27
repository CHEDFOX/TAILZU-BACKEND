import { sanitizeSvg } from "../../lib/markup.js";
import { morphHtml } from "../morph.js";
import type { Page, Renderer } from "./types.js";

/** SVG, sanitised: no script, no event attributes, no external references (lib/markup.ts), with element ids for point-and-change. */
export function createSvgRenderer(page: Page): Renderer {
  return {
    async render(i) {
      morphHtml(page.root, `<div class="tz-svg">${sanitizeSvg(i.src).svg}</div>`);
      page.surfaceChanged(window);
    },
    dispose() {
      page.root.replaceChildren();
    },
  };
}
