/**
 * Tailwind's browser runtime, loaded into a document only when an artifact wants it (see lib/tailwind.ts), with the project's
 * `kit.tailwind.config` (as `@theme` CSS) if the kit has one. The runtime watches the page and writes the CSS for the classes it finds.
 */
import type { DesignKitCss } from "../../tulmi/src/artifacts/protocol.js";
import { tailwindConfigToCss } from "../lib/tailwind.js";
import { KIT_ATTR } from "./kit.js";

const loads = new WeakMap<Document, Promise<void>>();

const nextFrame = (win: Window): Promise<void> => new Promise((r) => win.requestAnimationFrame(() => r()));

/** Make Tailwind available in `doc` (its window is `win`; `url` is the vendored runtime). Resolves when its first CSS is in. */
export function ensureTailwind(doc: Document, win: Window, kit: DesignKitCss | undefined, url: string): Promise<void> {
  const css = tailwindConfigToCss(kit?.tailwind?.config);
  const existing = doc.querySelector<HTMLStyleElement>('style[type="text/tailwindcss"]');
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css;
  } else {
    const style = doc.createElement("style");
    style.type = "text/tailwindcss";
    style.setAttribute(KIT_ATTR, "");
    style.textContent = css;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  let p = loads.get(doc);
  if (!p) {
    p = new Promise<void>((resolve) => {
      const script = doc.createElement("script");
      script.crossOrigin = "anonymous";
      script.src = url;
      script.onload = () => void nextFrame(win).then(() => nextFrame(win)).then(resolve);
      script.onerror = () => resolve();
      (doc.head ?? doc.documentElement).appendChild(script);
    });
    loads.set(doc, p);
  }
  return p;
}
