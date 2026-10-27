/**
 * What the viewer puts on a window that runs artifact code (the shell's own, or an html artifact's frame): the `tailzu`
 * bridge, error watching, point-and-change, and a guard against the page navigating itself away.
 */
import { ELEMENT_ID_ATTR, type FrameMsg } from "../../tulmi/src/artifacts/protocol.js";
import type { Bridge } from "./bridge.js";
import type { Reporter } from "./errors.js";

export interface SelectState {
  on: boolean;
}

export interface InstrumentCtx {
  bridge: Bridge;
  reporter: Reporter;
  select: SelectState;
  post(m: FrameMsg): void;
  /** Hover feedback in select mode: the element under the pointer (or null), in the coordinates of the page the artifact is in. */
  hover(el: Element | null): void;
}

const SWALLOWED = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend"] as const;

export function elementText(el: Element): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return (raw || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** The element with an id at or above where the event happened. */
function targetWithId(e: Event): Element | null {
  let t = e.target as Node | null;
  while (t && t.nodeType !== 1) t = t.parentNode;
  return t ? (t as Element).closest(`[${ELEMENT_ID_ATTR}]`) : null;
}

export function instrument(win: Window, ctx: InstrumentCtx): void {
  const doc = win.document;
  Object.defineProperty(win, "tailzu", { value: ctx.bridge.api, configurable: false, enumerable: false, writable: false });
  ctx.reporter.watch(win);
  const cursor = doc.createElement("style");
  cursor.textContent = "html[data-tz-select] *{cursor:crosshair!important}";
  doc.documentElement.appendChild(cursor);

  // --- point and change -------------------------------------------------------------------------------------
  let raf = 0;
  let pending: Element | null = null;
  doc.addEventListener(
    "pointermove",
    (e) => {
      if (!ctx.select.on) return;
      pending = targetWithId(e);
      if (!raf) {
        raf = win.requestAnimationFrame(() => {
          raf = 0;
          ctx.hover(pending);
        });
      }
    },
    { capture: true, passive: true },
  );
  doc.addEventListener("pointerleave", () => ctx.select.on && ctx.hover(null), { capture: true, passive: true });

  win.addEventListener(
    "click",
    (e) => {
      if (!ctx.select.on) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = targetWithId(e);
      if (!el) return;
      const r = el.getBoundingClientRect();
      ctx.post({
        t: "select",
        elementId: el.getAttribute(ELEMENT_ID_ATTR) ?? "",
        tag: el.localName,
        text: elementText(el),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    },
    true,
  );
  for (const type of SWALLOWED) {
    win.addEventListener(
      type,
      (e) => {
        if (!ctx.select.on) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (type === "contextmenu" || type === "auxclick") e.preventDefault();
      },
      true,
    );
  }
  // Keyboard activation (Enter on a focused button) would click it too.
  win.addEventListener(
    "keydown",
    (e) => {
      if (ctx.select.on && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // --- the page must stay put -------------------------------------------------------------------------------
  // A link inside the artifact would load another page into this frame, and a form would submit; neither is wanted.
  win.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented) return;
      let t = e.target as Node | null;
      while (t && t.nodeType !== 1) t = t.parentNode;
      const a = t ? (t as Element).closest("a[href], area[href]") : null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#")) return; // scrolling inside the page is fine
      e.preventDefault();
    },
    false,
  );
  win.addEventListener("submit", (e) => e.preventDefault(), true);
}

/** Report the height of the page's content whenever it changes. */
export function watchHeight(win: Window, onHeight: (h: number) => void): () => void {
  const doc = win.document;
  let last = -1;
  let queued = 0;
  const measure = (): number => {
    const html = doc.documentElement;
    const h = Math.max(html.getBoundingClientRect().height, doc.body ? doc.body.scrollHeight : 0);
    return Math.ceil(h);
  };
  const check = (): void => {
    queued = 0;
    const h = measure();
    if (h !== last && h > 0) {
      last = h;
      onHeight(h);
    }
  };
  const schedule = (): void => {
    if (!queued) queued = win.requestAnimationFrame(check);
  };
  const ro = new (win as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver(schedule);
  ro.observe(doc.documentElement);
  if (doc.body) ro.observe(doc.body);
  schedule();
  return () => {
    ro.disconnect();
    if (queued) win.cancelAnimationFrame(queued);
  };
}
