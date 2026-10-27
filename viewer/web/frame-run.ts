/**
 * Running an html artifact's scripts inside its frame. The page's CSP has no 'unsafe-inline', so what the browser would have done with
 * `<script>` bodies and `on…=` attributes, this does, from blob URLs created in the frame itself (lib/markup.ts took the code out).
 */
import { cdnLib } from "../lib/cdn.js";
import type { HtmlHandler, HtmlScript } from "../lib/markup.js";
import { registerSource, type Locator, type Reporter } from "./errors.js";

const GLOBAL_SHIMS = {
  d3: `import * as m from "d3"; window.d3 = m;`,
  three: `import * as m from "three"; window.THREE = m;`,
} as const;

const HANDLER_ATTRS = ["onclick", "oninput", "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress", "onmousedown", "onmouseup", "onmouseover", "onmouseout", "onmousemove", "onmouseenter", "onmouseleave", "onfocus", "onblur", "ondblclick", "onpointerdown", "onpointerup", "onpointermove", "ontouchstart", "ontouchend", "onwheel", "onscroll", "oncontextmenu", "onload", "onerror", "ondrag", "ondrop", "ondragover", "onselect", "ontoggle", "onanimationend", "ontransitionend"];

/** A position in code that starts `preLines` lines into a blob → the position in the artifact's source, where that code began at (line, col). */
const offsetLocator = (preLines: number, line: number, col: number): Locator => (l, c) => (l <= preLines ? undefined : { line: line + (l - preLines - 1), col: l === preLines + 1 ? col + c - 1 : c });

const blobUrl = (code: string): string => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

/** Add a script element and resolve when it has run (or failed to load). */
function runScript(parent: Node, replace: Element | null, el: HTMLScriptElement): Promise<void> {
  return new Promise((resolve) => {
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => resolve(), { once: true });
    if (replace) replace.replaceWith(el);
    else parent.appendChild(el);
  });
}

export function bindHandler(el: Element, h: Pick<HtmlHandler, "event" | "code" | "line" | "col">): Promise<void> {
  const wrapped =
    `(function(){var s=document.currentScript,el=s.__tzEl;\n` +
    `el.addEventListener(${JSON.stringify(h.event)},function(event){var r=(function(event){\n${h.code}\n}).call(el,event);if(r===false)event.preventDefault()});\n})();`;
  const url = blobUrl(wrapped);
  registerSource(url, offsetLocator(2, h.line, h.col));
  const s = document.createElement("script");
  (s as unknown as { __tzEl: Element }).__tzEl = el;
  s.src = url;
  return runScript(document.head ?? document.documentElement, null, s).then(() => s.remove());
}

/** `innerHTML = '<button onclick="…">'`: handlers on elements the artifact adds later are bound as they appear. */
export function watchAddedHandlers(): void {
  const convert = (el: Element): void => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.length > 2 && attr.name.startsWith("on")) {
        el.removeAttribute(attr.name);
        void bindHandler(el, { event: attr.name.slice(2), code: attr.value, line: 1, col: 1 });
      }
    }
  };
  const scan = (node: Node): void => {
    if (node.nodeType !== 1) return;
    convert(node as Element);
    for (const d of Array.from((node as Element).querySelectorAll("*"))) convert(d);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") scan(r.target);
      else r.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: HANDLER_ATTRS });
}

export interface PageData {
  scripts: HtmlScript[];
  handlers: HtmlHandler[];
}

/** Bind the handlers, then run the scripts one after another in document order. */
export async function runPage(data: PageData, reporter: Reporter): Promise<void> {
  const byIndex = new Map<number, Element>();
  document.querySelectorAll("[data-tz-h]").forEach((el) => {
    for (const k of (el.getAttribute("data-tz-h") ?? "").split(",")) byIndex.set(Number(k), el);
    el.removeAttribute("data-tz-h");
  });
  await Promise.all(data.handlers.map((h) => (byIndex.has(h.index) ? bindHandler(byIndex.get(h.index)!, h) : undefined)));

  for (const s of data.scripts) {
    const tpl = document.querySelector(`template[data-tz-s="${s.index}"]`);
    if (!tpl) continue;
    if (s.src !== null) {
      const lib = cdnLib(s.src);
      if (!lib) {
        reporter.report(
          "import",
          `Blocked <script src="${s.src}">: artifacts have no network access. Write the code inline, or use a bundled library (d3, three, Tailwind) or the "react" / "mermaid" artifact types.`,
          { line: s.line, col: s.col },
        );
        tpl.remove();
      } else if (lib === "tailwind") {
        tpl.remove(); // the page's Tailwind is loaded before the scripts run
      } else {
        const el = document.createElement("script");
        el.type = "module";
        el.src = blobUrl(GLOBAL_SHIMS[lib]);
        await runScript(document.head, tpl, el);
      }
      continue;
    }
    const el = document.createElement("script");
    const url = blobUrl(s.code);
    registerSource(url, offsetLocator(0, s.line, s.col));
    if (s.kind === "module") el.type = "module";
    else el.async = false;
    el.src = url;
    el.addEventListener("error", () => reporter.report("runtime", "The script could not be started.", { line: s.line, col: s.col }), { once: true });
    await runScript(document.head, tpl, el);
  }
}
