/**
 * SMALL PURE HELPERS THE SOURCES SHARE: TURNING THE WEB'S MARKUP AND DATES
 * INTO PLAIN TEXT AND NUMBERS, AND A QUESTION INTO THE FEW WORDS THAT MATTER.
 *
 * Nothing here touches the network, a clock or a store.
 */
import { docsMatch, isIndexableHost } from "../catalog.js";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—" };

/** HTML character references (&amp; &#39; &#x2F;) as the characters they stand for. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      try { return String.fromCodePoint(code); } catch { return ""; }
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Markup removed: tags, then character references, then runs of space collapsed. A block end becomes a space, not a join. */
export function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(?:p|div|br|li|ul|ol|pre|blockquote|h[1-6]|tr|td|th)\b[^>]*>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  ).replace(/\s+/g, " ").trim();
}

/** At most `n` characters, cut at a space where one is near and marked with an ellipsis. */
export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Epoch ms of an ISO date or a number of seconds, else undefined. */
export function toMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** `undefined` keys left out, so a meta object holds only what the source knew. */
export function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k];
  return o;
}

/** A repository address as the plain https page: no git+ prefix, no .git, no ssh form. */
export function repoUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.trim().replace(/^git\+/, "");
  const ssh = /^git@([^:]+):(.+)$/.exec(s);
  if (ssh) s = `https://${ssh[1]}/${ssh[2]}`;
  s = s.replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://").replace(/\.git$/, "").replace(/\/$/, "");
  return /^https?:\/\//.test(s) ? s : undefined;
}

// ------------------------------------------------------------------ the words

const STOP = new Set((
  "a an the and or but if of to in on at by for from with without about as is are was were be been being do does did can could should would will " +
  "i me my we you your it its this that these those there here how what why when where which who whom whose vs versus than then so not no " +
  "please help need want get got use using used am has have had into out up over just any some very also"
).split(" "));

/** The words of a question that carry meaning: lower case, no stop words, in order, repeats dropped. */
export function significantWords(q: string, max = 8): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.#+-]*/gu) ?? [];
  const out: string[] = [];
  for (const w of words) {
    const t = w.replace(/^[.-]+|[.-]+$/g, "");
    if (!t || STOP.has(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Package-name-shaped tokens of a query (a registry name has no spaces), minus filler words. For the registries that can only be asked by exact name. */
const FILLER = new Set(["package", "packages", "library", "lib", "module", "crate", "npm", "pip", "pip3", "pypi", "cargo", "install", "python", "node", "nodejs", "rust", "javascript", "typescript", "js", "ts", "docs", "documentation", "version", "latest", "info", "about", "pkg"]);
const NAME_SHAPE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

export function packageCandidates(q: string, max = 2): string[] {
  const out: string[] = [];
  for (const raw of q.trim().split(/\s+/)) {
    const t = raw.replace(/^["'`]+|["'`,;:?!]+$/g, "");
    if (!t || t.length > 214 || !NAME_SHAPE.test(t)) continue;
    const lower = t.toLowerCase();
    if (FILLER.has(lower) || STOP.has(lower) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------- what an address is

const REGISTRY_PAGE = /^(?:npmjs\.com\/package\/|pypi\.org\/project\/|crates\.io\/crates\/)/;

/** The kind of result an address is, for a result from a search engine that says nothing of its own. */
export function kindOfUrl(raw: string): "package" | "repo" | "issue" | "question" | "doc" | "page" {
  let u: URL;
  try { u = new URL(raw); } catch { return "page"; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname;
  if (REGISTRY_PAGE.test(`${host}${path}`)) return "package";
  if (host === "github.com") {
    if (/^\/[^/]+\/[^/]+\/(issues|pull|discussions)\/\d+/.test(path)) return "issue";
    if (/^\/[^/]+\/[^/]+\/?$/.test(path)) return "repo";
    return "page";
  }
  if (host === "stackoverflow.com" || host.endsWith(".stackexchange.com")) return /^\/questions\/\d+/.test(path) ? "question" : "page";
  return docsMatch(raw) || (isIndexableHost(raw) && /docs|reference|guide|api/i.test(path)) ? "doc" : "page";
}
