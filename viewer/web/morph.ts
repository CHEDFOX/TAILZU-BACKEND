/**
 * Update one DOM subtree to look like another with as few changes as possible: the nodes that stay the same stay the same
 * (so a CSS animation keeps running, a scroll position holds, an image does not reload) while a document streams in.
 */

const sameKind = (a: Node, b: Node): boolean =>
  a.nodeType === b.nodeType && (a.nodeType !== 1 || ((a as Element).localName === (b as Element).localName && (a as Element).namespaceURI === (b as Element).namespaceURI));

function syncAttributes(dst: Element, src: Element): void {
  for (const a of Array.from(dst.attributes)) {
    if (!src.hasAttributeNS(a.namespaceURI, a.localName)) dst.removeAttributeNS(a.namespaceURI, a.localName);
  }
  for (const a of Array.from(src.attributes)) {
    if (dst.getAttributeNS(a.namespaceURI, a.localName) !== a.value) dst.setAttributeNS(a.namespaceURI, a.name, a.value);
  }
}

/** Make the children of `dst` match the children of `src` (which may belong to another document). */
export function morphChildren(dst: Node, src: Node): void {
  const doc = dst.ownerDocument ?? (dst as Document);
  const srcKids = Array.from(src.childNodes);
  for (let i = 0; i < srcKids.length; i++) {
    const s = srcKids[i]!;
    const d = dst.childNodes[i];
    if (!d) {
      dst.appendChild(doc.importNode(s, true));
    } else if (!sameKind(d, s)) {
      dst.replaceChild(doc.importNode(s, true), d);
    } else if (d.nodeType === 1) {
      syncAttributes(d as Element, s as Element);
      morphChildren(d, s);
    } else if (d.nodeValue !== s.nodeValue) {
      d.nodeValue = s.nodeValue;
    }
  }
  while (dst.childNodes.length > srcKids.length) dst.removeChild(dst.lastChild!);
}

/** Replace the contents of `root` with parsed HTML, changing only what differs. */
export function morphHtml(root: Element, html: string): void {
  const t = root.ownerDocument.createElement("template");
  t.innerHTML = html;
  morphChildren(root, t.content);
}

export function morphAttributes(dst: Element, src: Element): void {
  syncAttributes(dst, src);
}
