/**
 * DUCKDUCKGO'S HTML PAGE: FREE GENERAL SEARCH, FOR LOW VOLUME ONLY.
 *
 *   html.duckduckgo.com/html/?q=
 *
 * This reads a web page meant for browsers, not an API. DuckDuckGo does not
 * promise it will keep its markup, and its terms do not offer it as a search
 * service for other products. It is here as the second discovery source so that
 * the bot works with nothing set up, at a small scale; the way to scale is a
 * SearXNG of our own (searxng.ts) or Brave (brave.ts). docs/web-search.md says so.
 *
 * Being a guest on it:
 *   - ONE REQUEST EVERY TWO SECONDS per process: callers take turns, and one that
 *     would wait more than 8 seconds stands aside instead (SearchSkip "busy"),
 *     so a burst of searches falls through to the next source rather than queueing;
 *   - a block is believed: DuckDuckGo answers a request it does not like with a
 *     202 and a page asking for a challenge to be solved. That, or a page with no
 *     results and the word "anomaly", means we have been noticed, and this source
 *     stands aside for ten minutes (SearchSkip "blocked") instead of trying again;
 *   - our own User-Agent, and no cookie.
 *
 * Results are read from the HTML: each has a link whose address is DuckDuckGo's
 * redirect (//duckduckgo.com/l/?uddg=<the real address>&rut=...), which is
 * unwrapped to the real address; advertisements (class result--ad, links through
 * y.js) are dropped.
 */
import { WebError } from "../../error.js";
import { getText } from "../http.js";
import { SearchSkip, type Result, type Source, type SourceOpts } from "../types.js";
import { clip, compact, decodeEntities, kindOfUrl, stripTags } from "./util.js";

/** Least time between two requests. */
export const DDG_GAP_MS = 2_000;
/** Longest a request waits its turn before it stands aside. */
export const DDG_MAX_WAIT_MS = 8_000;
/** How long a block is waited out. */
export const DDG_BLOCK_MS = 10 * 60_000;

let nextSlot = 0;
let blockedUntil = 0;

export function resetDdgForTests(): void { nextSlot = 0; blockedUntil = 0; }

/** The real address behind a result link: DuckDuckGo's redirect unwrapped, a scheme-less link given https. Null for an advertisement or anything that is not a web page. */
export function unwrapDdgLink(href: string): string | null {
  let s = decodeEntities(href).trim();
  if (s.startsWith("//")) s = `https:${s}`;
  let u: URL;
  try { u = new URL(s, "https://duckduckgo.com"); } catch { return null; }
  if (u.hostname.endsWith("duckduckgo.com")) {
    if (u.pathname === "/y.js") return null; // an ad
    const target = u.searchParams.get("uddg");
    if (!target) return null;
    try { u = new URL(target); } catch { return null; }
  }
  return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
};

/** The results on a DuckDuckGo HTML page, in order. */
export function parseDdg(html: string): Result[] {
  const out: Result[] = [];
  const seen = new Set<string>();
  // Each result starts at a div whose class list has "result" in it.
  const blocks = html.split(/(?=<div[^>]+class="[^"]*\bresult\b(?=[\s"])[^"]*")/);
  for (const block of blocks) {
    if (!block.includes("result__a")) continue;
    const open = /^<div[^>]*>/.exec(block)?.[0] ?? "";
    if (/result--ad\b/.test(open)) continue;
    const a = /(<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>)([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    const url = unwrapDdgLink(attr(a[1]!, "href") ?? "");
    const title = stripTags(a[2]!);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const sn = /<(?:a|div|td)\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block);
    out.push({
      title, url, snippet: clip(stripTags(sn?.[1] ?? ""), 300), source: "ddg",
      meta: compact({ kind: kindOfUrl(url) }),
    });
  }
  return out;
}

/** True for a page that is DuckDuckGo asking us to prove we are a person. */
function isChallenge(status: number, html: string): boolean {
  if (status === 202) return true;
  return !html.includes("result__a") && /anomaly|challenge|captcha|unusual traffic/i.test(html);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const ddg: Source = {
  id: "ddg",
  async search(q: string, o: SourceOpts = {}): Promise<Result[]> {
    const text = q.trim();
    if (!text) return [];
    const now = o.now ?? Date.now;
    if (blockedUntil > now()) throw new SearchSkip("blocked");

    // Take the next free slot, two seconds after the last one given out.
    const t = now();
    const at = Math.max(t, nextSlot);
    if (at - t > DDG_MAX_WAIT_MS) throw new SearchSkip("busy");
    nextSlot = at + DDG_GAP_MS;
    if (at > t) await (o.sleep ?? realSleep)(at - t);
    if (blockedUntil > now()) throw new SearchSkip("blocked"); // another request was turned away while this one waited

    const df = o.freshness === "month" ? "&df=m" : o.freshness === "year" ? "&df=y" : "";
    let page: { text: string; status: number };
    try {
      page = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(text)}${df}`, {
        fetchFn: o.fetchFn, headers: { Accept: "text/html" },
      });
    } catch (err) {
      // A 403 or 429 from this page is the same message as the challenge.
      if (err instanceof WebError && (err.code === "http_403" || err.code === "http_429")) {
        blockedUntil = now() + DDG_BLOCK_MS;
        throw new SearchSkip("blocked");
      }
      throw err;
    }
    if (isChallenge(page.status, page.text)) {
      blockedUntil = now() + DDG_BLOCK_MS;
      throw new SearchSkip("blocked");
    }
    return parseDdg(page.text).slice(0, Math.min(Math.max(o.limit ?? 10, 1), 20));
  },
};
