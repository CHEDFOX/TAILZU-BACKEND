/** The outline drawn round the element under the pointer in select mode. One per document (the shell, and each html artifact's frame). */

const CSS =
  "#tz-overlay{display:none;position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:2px solid #6d5efc;background:rgba(109,94,252,.12);border-radius:2px}" +
  '#tz-overlay::after{content:attr(data-tag);position:absolute;left:-2px;top:-1.5rem;padding:0 .4rem;font:600 11px/1.4rem ui-monospace,Menlo,monospace;color:#fff;background:#6d5efc;border-radius:3px 3px 0 0;white-space:nowrap}';

export function makeOverlay(doc: Document): (el: Element | null) => void {
  let box: HTMLElement | null = null;
  return (el) => {
    if (!el) {
      if (box) box.style.display = "none";
      return;
    }
    if (!box) {
      const style = doc.createElement("style");
      style.textContent = CSS;
      box = doc.createElement("div");
      box.id = "tz-overlay";
      doc.documentElement.append(style, box);
    }
    const r = el.getBoundingClientRect();
    box.dataset.tag = el.localName;
    box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  };
}
