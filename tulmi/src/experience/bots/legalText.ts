/**
 * THE PRIVACY POLICY, THE TERMS AND SUPPORT, IN SMALL TYPE FOR A CARD (the terms and privacy card on Home, firstRun/aiConsentCard.ts),
 * the way Apple shows its own terms: the whole of each, scrolling in a box above Agree, one at a time by its tab.
 *
 * Read from the very pages x0bot.com/privacy, /terms and /support serve (routes/site/policies), so the card can never say something they do not.
 * Each heading is its own line and the words under it one block (a list's items as "•" lines), which keeps the card to a few hundred
 * nodes. Built once: the pages are fixed in the build.
 */
import type { Node } from "../../../../shared/types/sdui.js";
import { PRIVACY_POLICY_EFFECTIVE, PRIVACY_POLICY_HTML } from "../../routes/site/policies/privacy.js";
import { SUPPORT_HTML, SUPPORT_UPDATED } from "../../routes/site/policies/support.js";
import { TERMS_EFFECTIVE, TERMS_HTML } from "../../routes/site/policies/terms.js";
import { C, text } from "./kit.js";

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&rarr;": "→", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
};
const plain = (h: string): string =>
  h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e).replace(/\s+/g, " ").trim();

/** The page's own text: what is between its <article class="prose"> and </article>. */
function articleOf(html: string): string {
  const open = '<article class="prose">';
  const a = html.indexOf(open), b = html.indexOf("</article>", a);
  return a < 0 || b < 0 ? "" : html.slice(a + open.length, b);
}

type Kind = "h1" | "h2" | "h3" | "p" | "li";

/** One document as nodes: its headings, and the words under each as one block. Its own title and date are left to the caller. */
function docNodes(html: string): Node[] {
  const out: Node[] = [];
  let body: string[] = [];
  const flush = () => {
    if (body.length) out.push(text(body.join("\n"), { size: 11, lineHeight: 16, color: C.grey70 }));
    body = [];
  };
  for (const m of articleOf(html).matchAll(/<(h1|h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const kind = m[1]!.toLowerCase() as Kind, words = plain(m[2]!);
    // The page's own date line: the card says it once, under the title.
    if (!words || kind === "h1" || /^(Effective|Updated):/i.test(words)) continue;
    if (kind === "h2" || kind === "h3") {
      flush();
      out.push(text(words, { size: kind === "h2" ? 12 : 11.5, weight: 600, lineHeight: 16, color: C.ink }));
    } else {
      body.push(kind === "li" ? `• ${words}` : words);
    }
  }
  flush();
  return out;
}

/** One of the card's three pages: the Privacy Policy, the Terms of Service or Support, each under its title and date. */
export type LegalPage = "privacy" | "terms" | "support";

const titled = (s: string, date: string, html: string): Node[] => [
  text(s, { size: 14, weight: 700, lineHeight: 19, color: C.ink }),
  text(date, { size: 11, lineHeight: 15, color: C.meta }),
  ...docNodes(html),
];
const built = new Map<LegalPage, Node[]>();

/** A page as nodes, built once (the pages are fixed in the build). */
export function legalPage(page: LegalPage): Node[] {
  let n = built.get(page);
  if (!n) {
    n = page === "privacy" ? titled("Privacy Policy", `Effective ${PRIVACY_POLICY_EFFECTIVE}`, PRIVACY_POLICY_HTML)
      : page === "terms" ? titled("Terms of Service", `Effective ${TERMS_EFFECTIVE}`, TERMS_HTML)
        : titled("Support", `Updated ${SUPPORT_UPDATED}`, SUPPORT_HTML);
    built.set(page, n);
  }
  return n;
}
